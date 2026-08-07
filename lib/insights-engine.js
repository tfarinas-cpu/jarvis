/**
 * Insights & Prevención — clustering of recurring Jira incidents.
 *
 * Two-stage approach to avoid O(n^2) over the whole corpus:
 * 1. Deterministic bucketing by sistema + strong token (ORA-xxxx, SP/report/table name).
 * 2. Greedy sub-clustering inside each bucket by causa-token Jaccard similarity.
 *
 * Deployment/admin noise: tickets assigned to the assignees listed in
 * config/insights-excluded-assignees.json (see loadExcludedAssigneesFromConfig)
 * are production deployments or repetitive account-administration chores
 * (altas/bajas/desbloqueos), not incidents with a diagnosable root cause,
 * and are fully excluded from clustering (see computeInsights). JARVIS does
 * not sync real Jira attachments (no /rest/api/3/issue/{key}/attachments
 * call in jira-api.js), so the deployment -> incident-cluster mapping below
 * is built from ticket-key references already present in the excluded
 * ticket's own text, not from inspecting attached files.
 */

const fs = require("fs");
const path = require("path");
const { tokenize, noteFingerprint, overlapScore, combineTokenMaps } = require("./similar-notes");

const ORA_RE = /\b(?:ORA|PLS|SP|IMP|RMAN|TNS)-\d{1,5}\b/gi;
const IDENT_RE = /\b[A-Z][A-Z0-9]{1,}(?:_[A-Z0-9]{2,}){1,}\b/g;
const GENERIC_STRONG = new Set([
  "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "INDEX",
  "TABLE", "BEGIN", "END", "NULL", "NOT", "INTO", "FROM", "WHERE",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

// Tickets assigned to these people are production deployments ("puestas en
// producción") or repetitive account-administration chores (altas, bajas,
// desbloqueos, resets), not incidents: their text (summary/causa/solución)
// must never feed incident clustering. Configurable via
// options.deploymentAssignees. Emergency fallback only — the primary source
// is config/insights-excluded-assignees.json (see loadExcludedAssigneesFromConfig).
const DEFAULT_DEPLOYMENT_ASSIGNEES = [
  "scarleth zoe rivera gonzalez",
  "ruddy salvador guevara rodriguez",
  "jose gregorio zamora urbina",
  "hector garcia",
  "julio cesar padilla guzman",
  "silvio roberto marin lopez",
];

// Versioned (git-tracked) config file so new analysts can be added without
// touching code. Read fresh on every computeInsights call — cheap (a few KB)
// compared to reparsing the full note corpus, and lets edits take effect
// within the existing 5-min insights cache TTL (server.js) without a restart.
const EXCLUDED_ASSIGNEES_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "config",
  "insights-excluded-assignees.json"
);

function loadExcludedAssigneesFromConfig() {
  try {
    const raw = fs.readFileSync(EXCLUDED_ASSIGNEES_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.assignees)) return parsed.assignees;
  } catch (err) {
    console.warn(
      `[insights] No se pudo leer ${EXCLUDED_ASSIGNEES_CONFIG_PATH}: ${err.message}`
    );
  }
  return DEFAULT_DEPLOYMENT_ASSIGNEES;
}

// Generic Jira ticket key pattern (project prefix + number), used to find
// references like "SLGMS-10402" inside a deployment ticket's own text.
const TICKET_KEY_REF_RE = /\b[A-Z]{2,10}-\d{2,6}\b/g;

// Tokens that carry no diagnostic meaning for cluster signatures:
// ticket keys, SQL noise, and generic support vocabulary.
const SIGNATURE_JUNK = new Set([
  "jira", "slgms", "script", "ejecutar", "atendida", "affected", "rows", "row",
  "error", "con", "sin", "para", "como", "desde", "hasta", "favor", "ayuda",
  "problema", "consulta", "solicitud", "reporte", "usuario", "usuarios",
  "sistema", "modulo", "nota", "ticket", "caso", "casos", "fecha",
  "adjunto", "adjunta", "mejora", "mejoras", "cambio", "cambios",
  "una", "uno", "unos", "unas", "del", "los", "las", "start",
]);

function isTicketKeyToken(token) {
  return /^[a-z]{2,}-(?:start-)?\d{3,}$/.test(token) || /^[a-z]{2,}\d{3,}$/.test(token);
}

function isNoiseToken(token) {
  return SIGNATURE_JUNK.has(token) || isTicketKeyToken(token) || /^\d+$/.test(token);
}

function normalizeDeploymentAssignees(list) {
  const names = Array.isArray(list) && list.length ? list : loadExcludedAssigneesFromConfig();
  return new Set(names.map((n) => String(n || "").trim().toLowerCase()).filter(Boolean));
}

function isDeploymentAssignee(note, deploymentAssigneeSet) {
  const assignee = String(note.assignee || "").trim().toLowerCase();
  return assignee ? deploymentAssigneeSet.has(assignee) : false;
}

function extractReferencedTicketKeys(note) {
  const ownKey = String(note.jira_key || note.id || "").toUpperCase();
  const text = [note.title, note.causa, note.solucion].filter(Boolean).join(" ").toUpperCase();
  const keys = new Set();
  for (const match of text.matchAll(TICKET_KEY_REF_RE)) {
    if (match[0] !== ownKey) keys.add(match[0]);
  }
  return keys;
}

// Secondary mapping: correlate excluded deployment tickets with the incident
// cluster they resolved, using ticket-key references already present in the
// deployment ticket's own text (JARVIS does not sync real Jira attachments,
// so file-level script inspection is not available — see insights-engine
// module docs).
function attachDeploymentRefs(clusters, deploymentNotes) {
  const keyToCluster = new Map();
  for (const cluster of clusters) {
    cluster.deployment_refs = [];
    for (const ticket of cluster.tickets || []) {
      const key = String(ticket.key || "").toUpperCase();
      if (key) keyToCluster.set(key, cluster);
    }
  }

  for (const note of deploymentNotes) {
    const referenced = extractReferencedTicketKeys(note);
    if (!referenced.size) continue;
    const seenClusters = new Set();
    for (const refKey of referenced) {
      const cluster = keyToCluster.get(refKey);
      if (!cluster || seenClusters.has(cluster.id)) continue;
      seenClusters.add(cluster.id);
      cluster.deployment_refs.push({
        key: note.jira_key || note.id,
        title: note.title,
        url: note.jira_url || "",
        updated: note.updated,
        assignee: normalizeFacet(note.assignee),
        referenced_ticket: refKey,
      });
    }
  }

  for (const cluster of clusters) {
    cluster.deployment_refs.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  }
  return clusters;
}

function normalizeFacet(text) {
  const t = String(text || "").trim();
  if (!t || t === "N/D") return "";
  return t;
}

function extractStrongTokens(note) {
  const found = new Map();
  const sources = [
    [note.reporte, 3],
    [note.tabla, 3],
    [note.causa, 1],
    [note.sintoma, 1],
    [note.title, 1],
  ];

  for (const [text, weight] of sources) {
    const raw = String(text || "");
    if (!raw) continue;
    for (const match of raw.matchAll(ORA_RE)) {
      addStrong(found, match[0].toLowerCase(), weight + 2);
    }
    for (const match of raw.matchAll(IDENT_RE)) {
      const token = match[0];
      if (GENERIC_STRONG.has(token)) continue;
      addStrong(found, token.toLowerCase(), weight);
    }
  }

  // Structured report/table fields are strong signals even without underscores
  // (e.g. reporte "OPTICO"), which the identifier regex above would miss.
  for (const field of [note.reporte, note.tabla]) {
    const value = normalizeFacet(field);
    if (!value) continue;
    const token = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    if (token.length >= 4 && !isNoiseToken(token)) addStrong(found, token, 3);
  }
  return found;
}

function addStrong(map, token, weight) {
  if (!token || token.length < 4) return;
  if (/^slgms-\d+$/.test(token)) return;
  map.set(token, (map.get(token) || 0) + weight);
}

function bucketKey(note, strongMap) {
  const sistema = normalizeFacet(note.sistema).toLowerCase() || "sin-sistema";
  if (!strongMap.size) return `${sistema}::general`;
  const sorted = [...strongMap.entries()].sort((a, b) => b[1] - a[1]);
  return `${sistema}::${sorted[0][0]}`;
}

function noteMs(note) {
  const d = new Date(note.updated_at || note.updated || "");
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function filterByPeriod(notes, days) {
  if (!days || days <= 0) return notes;
  const cutoff = Date.now() - days * DAY_MS;
  return notes.filter((n) => noteMs(n) >= cutoff);
}

function causaJaccard(fpA, fpB) {
  const score = overlapScore(fpA, fpB);
  return score / 100;
}

function clusterBucket(notesInBucket, options) {
  const threshold = options.causaThreshold ?? 0.3;
  const fingerprints = notesInBucket.map((note) => ({
    note,
    fp: noteFingerprint(note),
  }));

  const clusters = [];
  for (const item of fingerprints) {
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = causaJaccard(item.fp, cluster.centroidFp);
      if (score > bestScore) {
        bestScore = score;
        best = cluster;
      }
    }
    if (best && bestScore >= threshold) {
      best.members.push(item.note);
      mergeTokenMaps(best.centroidFp, item.fp);
    } else {
      clusters.push({
        members: [item.note],
        centroidFp: new Map(item.fp),
      });
    }
  }
  return clusters;
}

function mergeTokenMaps(target, source) {
  for (const [k, v] of source) {
    target.set(k, (target.get(k) || 0) + v);
  }
}

function pickDominant(values) {
  const counts = new Map();
  for (const v of values) {
    const key = normalizeFacet(v);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return "";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function topTokens(fp, limit = 4) {
  return [...fp.entries()]
    .filter(([token]) => !isNoiseToken(token))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

// Fingerprint used only for naming clusters: excludes informador/area_usuaria
// so person names never leak into signatures.
function signatureFingerprint(note) {
  return combineTokenMaps(
    tokenize(note.title),
    tokenize(note.sintoma),
    tokenize(note.causa),
    tokenize(note.reporte),
    tokenize(note.tabla),
    tokenize(note.modulo)
  );
}

function clusterSignature(members, fp, sistema) {
  const blocked = new Set(
    String(sistema || "").toLowerCase().split(/[\s/]+/).filter(Boolean)
  );
  for (const note of members) {
    for (const field of [note.informador, note.assignee]) {
      for (const part of String(field || "").toLowerCase().split(/[\s,.;/]+/)) {
        if (part.length >= 3) blocked.add(part);
      }
    }
  }
  const oraCounts = new Map();
  const identCounts = new Map();
  for (const note of members) {
    const strong = extractStrongTokens(note);
    for (const [token, weight] of strong) {
      if (blocked.has(token)) continue;
      if (/^(?:ora|pls|tns|rman|imp|sp)-\d+/.test(token)) {
        oraCounts.set(token.toUpperCase(), (oraCounts.get(token.toUpperCase()) || 0) + weight);
      } else if (!isNoiseToken(token)) {
        identCounts.set(token.toUpperCase(), (identCounts.get(token.toUpperCase()) || 0) + weight);
      }
    }
  }
  const ora = [...oraCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const ident = [...identCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (ora && ident) return `${ora[0]} · ${ident[0]}`;
  if (ora) return ora[0];
  if (ident) return ident[0];
  const fallback = topTokens(fp, 3).filter((t) => !blocked.has(t));
  return fallback.length
    ? fallback.join(" · ").toUpperCase()
    : "Patrón recurrente";
}

function excerpt(text, max = 260) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function normSistemaKey(sistema) {
  return String(sistema || "").toLowerCase().replace(/\s*\/\s*/g, "/").trim();
}

function computeGroupFp(members) {
  const fp = new Map();
  for (const note of members) mergeTokenMaps(fp, signatureFingerprint(note));
  return fp;
}

// Second-pass merge: sub-clusters that landed in different buckets but describe
// the same pattern (same sistema, high signature-token overlap) are unified.
function mergeGroups(groups, threshold = 55) {
  const sorted = [...groups].sort((a, b) => b.members.length - a.members.length);
  const merged = [];
  for (const group of sorted) {
    let best = null;
    let bestScore = 0;
    for (const candidate of merged) {
      if (normSistemaKey(candidate.sistema) !== normSistemaKey(group.sistema)) continue;
      const score = overlapScore(group.fp, candidate.fp);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best && bestScore >= threshold) {
      best.members.push(...group.members);
      mergeTokenMaps(best.fp, group.fp);
      best.sistema = pickDominant(best.members.map((n) => n.sistema)) || best.sistema;
    } else {
      merged.push({
        members: [...group.members],
        fp: new Map(group.fp),
        sistema: group.sistema,
      });
    }
  }
  return merged;
}

function buildClusterRecord(members, options) {
  const signatureFp = new Map();
  for (const note of members) mergeTokenMaps(signatureFp, signatureFingerprint(note));

  const sistema = pickDominant(members.map((n) => n.sistema)) || "N/D";
  const areas = [...new Set(members.map((n) => normalizeFacet(n.area_usuaria)).filter(Boolean))];
  const informadores = [...new Set(members.map((n) => normalizeFacet(n.informador)).filter(Boolean))];
  const assignees = [...new Set(members.map((n) => normalizeFacet(n.assignee)).filter(Boolean))];
  const reportes = [...new Set(members.map((n) => normalizeFacet(n.reporte)).filter(Boolean))];

  const sortedByDate = [...members].sort((a, b) => noteMs(a) - noteMs(b));
  const firstSeen = sortedByDate[0]?.updated || "";
  const lastSeen = sortedByDate[sortedByDate.length - 1]?.updated || "";

  let ratedCount = 0;
  let csatSum = 0;
  let lowCsatCount = 0;
  for (const note of members) {
    const rating = note.satisfaction_rating;
    if (rating != null && rating >= 1 && rating <= 5) {
      ratedCount += 1;
      csatSum += rating;
      if (rating <= 3) lowCsatCount += 1;
    }
  }
  const avgCsat = ratedCount ? Math.round((csatSum / ratedCount) * 10) / 10 : null;

  const pickRichest = (field, flag) => {
    const candidates = members.filter((n) => String(n[field] || "").trim());
    if (!candidates.length) return null;
    const useful = candidates.filter((n) => n[flag]);
    const pool = useful.length ? useful : candidates;
    return pool.sort((a, b) => String(b[field]).length - String(a[field]).length)[0];
  };
  const causaNote = pickRichest("causa", "has_useful_causa");
  const solucionNote = pickRichest("solucion", "has_useful_solution");

  const sqlHits = [];
  for (const note of members) {
    for (const sql of note.sql_scripts || []) {
      if (sqlHits.length >= 3) break;
      const oneLine = excerpt(sql, 140);
      if (oneLine && !sqlHits.includes(oneLine)) sqlHits.push(oneLine);
    }
  }

  const tickets = members
    .map((note) => ({
      key: note.jira_key || note.id,
      title: note.title,
      updated: note.updated,
      url: note.jira_url || "",
      csat: note.satisfaction_rating ?? null,
      sistema: normalizeFacet(note.sistema),
    }))
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));

  const ticketCount = members.length;
  const impactScore =
    ticketCount * (1 + 0.3 * Math.max(0, areas.length - 1) + (informadores.length > 3 ? 0.2 : 0));
  const lowCsatRisk = ratedCount >= 2 && avgCsat != null && avgCsat <= 3;

  return {
    sistema,
    signature: clusterSignature(members, signatureFp, sistema),
    ticket_count: ticketCount,
    tickets,
    areas,
    informadores,
    assignees,
    reportes,
    first_seen: firstSeen,
    last_seen: lastSeen,
    rated_count: ratedCount,
    avg_csat: avgCsat,
    low_csat_count: lowCsatCount,
    low_csat_risk: lowCsatRisk,
    impact_score: Math.round(impactScore * 10) / 10,
    common_causa: excerpt(causaNote?.causa),
    common_solucion: excerpt(solucionNote?.solucion),
    top_tokens: topTokens(signatureFp, 6),
    sql_hits: sqlHits,
  };
}

function normalizeScores(clusters) {
  const maxTickets = Math.max(1, ...clusters.map((c) => c.ticket_count));
  const maxImpact = Math.max(1, ...clusters.map((c) => c.impact_score));
  for (const cluster of clusters) {
    const freq = cluster.ticket_count / maxTickets;
    const impact = cluster.impact_score / maxImpact;
    const csatRisk = cluster.low_csat_risk
      ? 1
      : cluster.low_csat_count > 0
        ? 0.5
        : 0;
    cluster.priority_score =
      Math.round((0.55 * freq + 0.3 * impact + 0.15 * csatRisk) * 1000) / 10;
  }
  return clusters;
}

function computeInsights(notes, options = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const days = Number(options.days) || 0;
  const sistemaFilter = normalizeFacet(options.sistema);
  const minTickets = Math.max(2, Number(options.minTickets) || 2);
  const top = Math.max(1, Number(options.top) || 10);
  const deploymentAssigneeSet = normalizeDeploymentAssignees(options.deploymentAssignees);

  let scoped = filterByPeriod(list, days);
  if (sistemaFilter) {
    scoped = scoped.filter((n) => normalizeFacet(n.sistema) === sistemaFilter);
  }

  // Deployment tickets (puestas en producción) never feed incident
  // clustering — see DEFAULT_DEPLOYMENT_ASSIGNEES. They are kept aside only
  // to build the secondary deployment -> cluster mapping below.
  const deploymentNotes = [];
  const incidentNotes = [];
  for (const note of scoped) {
    if (isDeploymentAssignee(note, deploymentAssigneeSet)) {
      deploymentNotes.push(note);
    } else {
      incidentNotes.push(note);
    }
  }

  const buckets = new Map();
  for (const note of incidentNotes) {
    const strong = extractStrongTokens(note);
    const key = bucketKey(note, strong);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(note);
  }

  const groups = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    for (const group of clusterBucket(members, options)) {
      groups.push({
        members: group.members,
        fp: computeGroupFp(group.members),
        sistema: pickDominant(group.members.map((n) => n.sistema)),
      });
    }
  }

  const merged = mergeGroups(groups, options.mergeThreshold ?? 55);
  const rawClusters = merged
    .filter((g) => g.members.length >= minTickets)
    .map((g) => buildClusterRecord(g.members, options));

  normalizeScores(rawClusters);
  rawClusters.sort(
    (a, b) =>
      b.priority_score - a.priority_score ||
      b.ticket_count - a.ticket_count ||
      a.signature.localeCompare(b.signature, "es")
  );

  const clusters = rawClusters.slice(0, top).map((cluster, index) => ({
    rank: index + 1,
    id: `${cluster.sistema}::${cluster.signature}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80),
    ...cluster,
  }));

  attachDeploymentRefs(clusters, deploymentNotes);

  return {
    filters: {
      days,
      sistema: sistemaFilter || null,
      minTickets,
      top,
    },
    total_notes: list.length,
    notes_in_period: incidentNotes.length,
    deployment_notes_excluded: deploymentNotes.length,
    deployment_assignees: [...deploymentAssigneeSet],
    buckets_evaluated: buckets.size,
    clusters,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  computeInsights,
  extractStrongTokens,
  bucketKey,
  filterByPeriod,
  isDeploymentAssignee,
  extractReferencedTicketKeys,
  loadExcludedAssigneesFromConfig,
  DEFAULT_DEPLOYMENT_ASSIGNEES,
  EXCLUDED_ASSIGNEES_CONFIG_PATH,
};
