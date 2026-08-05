/**
 * JARVIS — Solution & Incident Search Engine for Dendron / Jira notes (Node.js).
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/env");

loadEnv();

const express = require("express");
const matter = require("gray-matter");
const { importJiraCsv, csvExists, defaultCsvPath } = require("./lib/jira-import");
const { syncJiraFromApi, getSyncStatus, testConnection } = require("./lib/jira-sync");
const { createJiraSyncScheduler } = require("./lib/jira-sync-scheduler");
const { hasUsefulSolution, hasUsefulCausa } = require("./lib/note-quality");
const { applyFacetFilters, buildFacets, paginateNotes } = require("./lib/search-facets");
const { normalizeRating } = require("./lib/jira-satisfaction");
const { scoreRelevance, sortByRelevance } = require("./lib/search-relevance");
const { findSimilarNotes, findNoteByKey } = require("./lib/similar-notes");
const { computeQualityMetrics } = require("./lib/quality-metrics");

const BASE_DIR = __dirname;
const DOCS_DIR = path.join(BASE_DIR, "docs");
const GUIA_MD = path.join(DOCS_DIR, "guia-analistas-jarvis.md");
const GUIA_PDF = path.join(DOCS_DIR, "guia-analistas-jarvis.pdf");
const GUIA_HTML = path.join(DOCS_DIR, "guia-analistas-jarvis.html");
const INSTALACION_MD = path.join(DOCS_DIR, "guia-instalacion-equipo.md");
const INSTALACION_HTML = path.join(DOCS_DIR, "guia-instalacion-equipo.html");
const JIRA_BROWSE_BASE = String(
  process.env.JIRA_BASE_URL || "https://seguroslafise.atlassian.net"
).replace(/\/$/, "");
const NOTES_DIR = path.resolve(
  process.env.DENDRON_NOTES_DIR || path.join(BASE_DIR, "notes")
);
const PORT = Number(process.env.PORT || 8000);

function normalizeField(text, { preserveBreaks = false } = {}) {
  let out = String(text || "")
    .replace(/\*\*/g, "")
    .trim();
  if (!preserveBreaks) out = out.replace(/\s+/g, " ");
  return out;
}

/** Extract **Label:** value (same line or following lines until next **Label:** or ## heading). */
function extractLabeledField(body, labelPattern) {
  const multiline = new RegExp(
    `^\\*\\*${labelPattern}:\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[^\\n]+:\\*\\*|\\n#{1,6}\\s|$)`,
    "im"
  );
  const inline = new RegExp(`^\\*\\*${labelPattern}:\\*\\*\\s*(.+)$`, "im");

  const multilineMatch = body.match(multiline);
  if (multilineMatch && multilineMatch[1].trim()) {
    return normalizeField(multilineMatch[1], { preserveBreaks: true });
  }

  const inlineMatch = body.match(inline);
  if (inlineMatch && inlineMatch[1].trim()) {
    return normalizeField(inlineMatch[1]);
  }

  return "";
}

function extractSatisfaction(body, meta = {}) {
  const fromMeta = meta.jira_satisfaction_rating;
  if (fromMeta != null && fromMeta !== "") {
    const rating = normalizeRating(fromMeta);
    if (rating != null) {
      return {
        rating,
        comment: String(meta.jira_satisfaction_comment || "").trim(),
      };
    }
  }
  const match = body.match(/\*\*Satisfacción:\*\*\s*(\d)\s*\/\s*5/i);
  if (match) {
    return { rating: normalizeRating(match[1]), comment: "" };
  }
  return null;
}

function extractFields(body) {
  return {
    sistema: extractLabeledField(body, "Sistema"),
    modulo: extractLabeledField(body, "M[oó]dulo"),
    area_usuaria: extractLabeledField(body, "[ÁA]rea usuaria"),
    informador: extractLabeledField(body, "Informador"),
    assignee: extractLabeledField(body, "Asignado a"),
    causa: extractLabeledField(body, "Causa(?:\\s+Ra[ií]z)?"),
    solucion: extractLabeledField(body, "Soluci[oó]n"),
    reporte: extractLabeledField(body, "Reporte"),
    tabla: extractLabeledField(body, "Tabla(?:s)?"),
    etiquetas: extractLabeledField(body, "Etiquetas"),
  };
}

const SQL_BLOCK_RE = /```(?:sql|SQL)?\s*\n([\s\S]*?)```/g;
const CODE_BLOCK_RE = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g;
const CIERRE_HD_RE =
  /^#{1,6}\s*.*?✅\s*Cierre\s+de\s+(?:HD|CASO)\s*\n([\s\S]*?)(?=^#{1,6}\s|\Z)/ims;

const NOTES_CACHE_TTL_MS = Number(process.env.NOTES_CACHE_TTL_MS || 15000);
let notesCache = { loadedAt: 0, notes: [], fileCount: 0 };

function clean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCierreHd(body) {
  const match = body.match(CIERRE_HD_RE);
  return match ? match[1].trim() : "";
}

function extractSql(body) {
  const scripts = [];
  for (const match of body.matchAll(SQL_BLOCK_RE)) {
    const content = match[1].trim();
    if (content) scripts.push(content);
  }
  return scripts;
}

function extractCodeBlocks(body) {
  const blocks = [];
  for (const match of body.matchAll(CODE_BLOCK_RE)) {
    const content = match[2].trim();
    if (!content) continue;
    blocks.push({ lang: (match[1] || "text").toLowerCase(), content });
  }
  return blocks;
}

function walkMarkdownFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
        files.push(full);
      }
    }
  }
  return files;
}

function extractSintoma(body, meta = {}) {
  if (meta.desc) return String(meta.desc).trim();
  const descSection = body.match(
    /^##\s*Descripci[oó]n(?:\s+original)?\s*\n([\s\S]*?)(?=^##\s|\Z)/im
  );
  if (descSection) {
    return descSection[1].replace(/_Sin descripción\._/i, "").trim();
  }
  return "";
}

function jiraKeyFromMeta(meta, id) {
  const raw = String(meta.jira_key || meta.id || id || "").trim();
  if (!raw) return "";
  const m = raw.match(/^(slgms-\d+)$/i);
  return m ? m[1].toUpperCase() : raw.toUpperCase();
}

function jiraBrowseUrl(key) {
  if (!key) return "";
  return `${JIRA_BROWSE_BASE}/browse/${encodeURIComponent(key)}`;
}

function toCard(doc) {
  return {
    path: doc.path,
    id: doc.id,
    jira_key: doc.jira_key,
    jira_url: doc.jira_url,
    title: doc.title,
    updated: doc.updated,
    tags: doc.tags,
    sistema: doc.sistema,
    modulo: doc.modulo,
    area_usuaria: doc.area_usuaria,
    informador: doc.informador,
    assignee: doc.assignee,
    jira_status: doc.jira_status,
    jira_type: doc.jira_type,
    jira_prioridad: doc.jira_prioridad,
    etiquetas: doc.etiquetas,
    causa: doc.causa,
    solucion: doc.solucion,
    sintoma: doc.sintoma,
    reporte: doc.reporte,
    tabla: doc.tabla,
    cierre_hd: doc.cierre_hd,
    sql_scripts: doc.sql_scripts,
    code_blocks: doc.code_blocks,
    has_useful_solution: doc.has_useful_solution,
    has_useful_solution: doc.has_useful_solution,
    has_useful_causa: doc.has_useful_causa,
    satisfaction_rating: doc.satisfaction_rating,
    satisfaction_comment: doc.satisfaction_comment,
    relevance_score: doc.relevance_score ?? null,
  };
}

function parseNote(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data: meta, content: body } = matter(raw);
    const fields = extractFields(body);
    const sqlScripts = extractSql(body);
    const codeBlocks = extractCodeBlocks(body);
    const cierreHd = extractCierreHd(body);
    const satisfaction = extractSatisfaction(body, meta);

    let tags = meta.tags || [];
    if (typeof tags === "string") {
      tags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }

    const relative = path.relative(NOTES_DIR, filePath).split(path.sep).join("/");
    const sintoma = extractSintoma(body, meta);
    const updatedAt = normalizeNoteUpdated(meta);
    const doc = {
      path: relative,
      id: String(meta.id || path.basename(filePath, ".md")),
      title: String(meta.title || path.basename(filePath, ".md")),
      updated: displayUpdatedDate(updatedAt),
      updated_at: updatedAt,
      tags: tags.map(String),
      sistema: fields.sistema || "",
      modulo: fields.modulo || "",
      area_usuaria: fields.area_usuaria || meta.jira_area_usuaria || "",
      informador: fields.informador || meta.jira_informador || "",
      assignee: fields.assignee || meta.jira_assignee || "",
      jira_status: meta.jira_status || "",
      jira_type: meta.jira_type || "",
      jira_prioridad: meta.jira_prioridad || "",
      etiquetas: fields.etiquetas || "",
      causa: fields.causa || "",
      solucion: fields.solucion || "",
      sintoma,
      reporte: fields.reporte || "",
      tabla: fields.tabla || "",
      cierre_hd: cierreHd,
      sql_scripts: sqlScripts,
      code_blocks: codeBlocks,
      satisfaction_rating: satisfaction?.rating ?? null,
      satisfaction_comment: satisfaction?.comment || "",
      body,
    };

    const jiraKey = jiraKeyFromMeta(meta, doc.id);
    doc.jira_key = jiraKey;
    doc.jira_url = jiraBrowseUrl(jiraKey);
    doc.has_useful_solution = hasUsefulSolution(doc.solucion);
    doc.has_useful_causa = hasUsefulCausa(doc.causa);

    doc.search_blob = [
      doc.title,
      doc.id,
      doc.jira_key,
      doc.sistema,
      doc.modulo,
      doc.area_usuaria,
      doc.informador,
      doc.assignee,
      doc.causa,
      doc.solucion,
      doc.sintoma,
      doc.reporte,
      doc.tabla,
      doc.cierre_hd,
      doc.jira_status,
      doc.jira_type,
      doc.tags.join(" "),
      doc.sql_scripts.join(" "),
      body,
    ]
      .join(" ")
      .toLowerCase();

    return doc;
  } catch {
    return null;
  }
}

function loadNotes(force = false) {
  const now = Date.now();
  if (!force && notesCache.notes.length && now - notesCache.loadedAt < NOTES_CACHE_TTL_MS) {
    return notesCache.notes;
  }

  const files = walkMarkdownFiles(NOTES_DIR);
  const notes = [];
  for (const filePath of files) {
    const doc = parseNote(filePath);
    if (doc) {
      if (String(doc.id || "").toLowerCase() === "jira-import-index") continue;
      notes.push(doc);
    }
  }

  notes.sort(compareNotesByRecency);
  notesCache = { loadedAt: now, notes, fileCount: files.length };
  return notes;
}

function invalidateNotesCache() {
  notesCache = { loadedAt: 0, notes: [], fileCount: 0 };
}

function parseDateBoundary(str, endOfDay = false) {
  if (!str) return null;
  const d = new Date(String(str).trim());
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeNoteUpdated(meta) {
  if (meta.jira_updated_at) return String(meta.jira_updated_at);
  const raw = meta.updated;
  if (raw instanceof Date) return raw.toISOString();
  const text = String(raw || meta.created || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T12:00:00.000Z`;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}

function displayUpdatedDate(isoOrDate) {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) {
    const m = String(isoOrDate || "").match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : String(isoOrDate || "");
  }
  return d.toISOString().slice(0, 10);
}

function jiraKeyNumber(note) {
  const m = String(note.jira_key || note.id || "").match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

function compareNotesByRecency(a, b) {
  const diff = noteUpdatedMs(b) - noteUpdatedMs(a);
  if (diff) return diff;
  return jiraKeyNumber(b) - jiraKeyNumber(a);
}

function noteUpdatedMs(note) {
  const d = new Date(note.updated_at || note.updated || "");
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function sortNotes(notes, sort, tokens) {
  const mode = sort || "updated_desc";
  if (mode === "updated_asc") {
    return [...notes].sort((a, b) => -compareNotesByRecency(a, b));
  }
  if (mode === "relevance" && tokens.length) {
    return sortByRelevance(notes, tokens, noteUpdatedMs);
  }
  return [...notes].sort(compareNotesByRecency);
}

function filterNotes(notes, options = {}) {
  let list = notes;

  if (options.quality === "documented") {
    list = list.filter((n) => n.has_useful_solution);
  }

  const from = parseDateBoundary(options.from, false);
  const to = parseDateBoundary(options.to, true);
  if (from || to) {
    list = list.filter((n) => {
      const ms = noteUpdatedMs(n);
      if (!ms) return false;
      if (from && ms < from.getTime()) return false;
      if (to && ms > to.getTime()) return false;
      return true;
    });
  }

  return list;
}

function searchNotes(query, notes = loadNotes(), options = {}) {
  const q = String(query || "").trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

  let list = notes;
  if (tokens.length) {
    list = list.filter((note) => tokens.every((token) => note.search_blob.includes(token)));
  }

  list = filterNotes(list, options);
  const facets = buildFacets(list);
  list = applyFacetFilters(list, options);
  list = sortNotes(list, options.sort, tokens);

  const pageInfo = paginateNotes(list, options.page, options.limit);
  const attachScores = options.sort === "relevance" && tokens.length;

  return {
    tokens,
    facets,
    ...pageInfo,
    results: attachScores
      ? pageInfo.results.map((note) => ({
          ...note,
          relevance_score: scoreRelevance(note, tokens),
        }))
      : pageInfo.results,
  };
}

const app = express();
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(BASE_DIR, "templates"));

const jiraSyncScheduler = createJiraSyncScheduler({
  syncFn: async () => {
    const result = await syncJiraFromApi({ notesDir: NOTES_DIR });
    if (result.ok) invalidateNotesCache();
    return result;
  },
});
jiraSyncScheduler.start();

app.get("/", (req, res) => {
  res.render("index", {
    initialQuery: String(req.query.q || ""),
    notes_dir: NOTES_DIR,
  });
});

app.use("/docs", express.static(DOCS_DIR));

app.get("/api/docs/guia", (req, res) => {
  const format = String(req.query.format || "info").toLowerCase();
  const info = {
    markdown: fs.existsSync(GUIA_MD),
    pdf: fs.existsSync(GUIA_PDF),
    html: fs.existsSync(GUIA_HTML),
    urls: {
      markdown: "/api/docs/guia/download?format=md",
      pdf: "/api/docs/guia/download?format=pdf",
      html: "/docs/guia-analistas-jarvis.html",
    },
  };
  if (format === "info") {
    return res.json(info);
  }
  return res.status(400).json({ error: "Use format=info or /api/docs/guia/download" });
});

app.get("/api/docs/guia/download", (req, res) => {
  const format = String(req.query.format || "md").toLowerCase();
  if (format === "md") {
    if (!fs.existsSync(GUIA_MD)) {
      return res.status(404).json({ error: "Markdown guide not found" });
    }
    return res.download(GUIA_MD, "guia-analistas-jarvis.md");
  }
  if (format === "pdf") {
    if (!fs.existsSync(GUIA_PDF)) {
      return res.status(404).json({
        error: "PDF not built yet",
        hint: "Run: npm run docs:guia-pdf",
        fallback: "/docs/guia-analistas-jarvis.html",
      });
    }
    return res.download(GUIA_PDF, "guia-analistas-jarvis.pdf");
  }
  return res.status(400).json({ error: "Invalid format", allowed: ["md", "pdf"] });
});

app.get("/api/docs/instalacion/download", (req, res) => {
  const format = String(req.query.format || "md").toLowerCase();
  if (format === "md") {
    if (!fs.existsSync(INSTALACION_MD)) {
      return res.status(404).json({ error: "Install guide not found" });
    }
    return res.download(INSTALACION_MD, "guia-instalacion-equipo.md");
  }
  return res.status(400).json({ error: "Invalid format", allowed: ["md"] });
});

app.get("/api/search", (req, res) => {
  const query = String(req.query.q || "");
  const sort = String(req.query.sort || "updated_desc");
  const quality = String(req.query.quality || "all");
  const from = req.query.from ? String(req.query.from) : "";
  const to = req.query.to ? String(req.query.to) : "";
  const sistema = req.query.sistema ? String(req.query.sistema) : "";
  const area = req.query.area ? String(req.query.area) : "";
  const assignee = req.query.assignee ? String(req.query.assignee) : "";
  const informador = req.query.informador
    ? String(req.query.informador)
    : req.query.solicitante
      ? String(req.query.solicitante)
      : "";
  const page = req.query.page ? String(req.query.page) : "1";
  const limit = req.query.limit ? String(req.query.limit) : "40";

  const search = searchNotes(query, loadNotes(), {
    sort,
    quality,
    from,
    to,
    sistema,
    area,
    assignee,
    informador,
    page,
    limit,
  });

  res.json({
    query,
    sort,
    quality,
    from: from || null,
    to: to || null,
    sistema: sistema || null,
    area: area || null,
    assignee: assignee || null,
    informador: informador || null,
    page: search.page,
    limit: search.limit,
    pages: search.pages,
    total: search.total,
    tokens: search.tokens,
    facets: search.facets,
    notes_dir: NOTES_DIR,
    jira_browse_base: JIRA_BROWSE_BASE,
    results: search.results.map(toCard),
  });
});

app.get("/api/facets", (_req, res) => {
  const notes = loadNotes();
  res.json({
    total_notes: notes.length,
    facets: buildFacets(notes),
  });
});

app.get("/api/similar", (req, res) => {
  const key = String(req.query.key || req.query.id || "").trim();
  const limit = req.query.limit ? String(req.query.limit) : "5";
  if (!key) {
    return res.status(400).json({ error: "Missing key (jira_key or id)" });
  }

  const notes = loadNotes();
  const source = findNoteByKey(notes, key);
  if (!source) {
    return res.status(404).json({ error: "Note not found", key });
  }

  const matches = findSimilarNotes(source, notes, limit);
  res.json({
    key: source.jira_key || source.id,
    title: source.title,
    similar: matches.map(({ note, score }) => ({
      score: Math.round(score * 10) / 10,
      ...toCard(note),
    })),
  });
});

app.get("/api/quality/metrics", (_req, res) => {
  const notes = loadNotes();
  res.json(computeQualityMetrics(notes));
});

app.get("/api/health", (_req, res) => {
  const notes = loadNotes();
  res.json({
    status: "ok",
    notes_dir: NOTES_DIR,
    notes_count: notes.length,
    files_scanned: notesCache.fileCount,
    cache_age_ms: Date.now() - notesCache.loadedAt,
  });
});

app.get("/api/import/status", (_req, res) => {
  const csvPath = defaultCsvPath();
  res.json({
    csv_path: csvPath,
    csv_exists: csvExists(csvPath),
    csv_name: path.basename(csvPath),
    notes_dir: NOTES_DIR,
    jira_notes_dir: path.join(NOTES_DIR, "jira"),
  });
});

app.post("/api/import/jira", (_req, res) => {
  try {
    const result = importJiraCsv({
      notesDir: NOTES_DIR,
      removeOrphans: false,
      syncSource: "csv",
    });
    if (!result.ok) {
      return res.status(404).json(result);
    }
    invalidateNotesCache();
    const notes = loadNotes(true);
    res.json({ ...result, notes_count: notes.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/api/sync/jira/status", async (_req, res) => {
  const status = getSyncStatus();
  let connection = null;
  if (status.configured) {
    connection = await testConnection();
  }
  res.json({
    ...status,
    connection,
    scheduler: jiraSyncScheduler.getStatus(),
  });
});

app.post("/api/sync/jira", async (req, res) => {
  try {
    const fullSync = req.query.full === "1" || req.body?.full === true;
    const result = await syncJiraFromApi({ notesDir: NOTES_DIR, fullSync });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    invalidateNotesCache();
    const notes = loadNotes(true);
    res.json({ ...result, notes_count: notes.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post("/api/reload", (_req, res) => {
  invalidateNotesCache();
  const notes = loadNotes(true);
  res.json({ status: "ok", notes_count: notes.length });
});

app.listen(PORT, "0.0.0.0", () => {
  const sched = jiraSyncScheduler.getStatus();
  console.log(`JARVIS listening on http://localhost:${PORT}`);
  console.log(`Notes dir: ${NOTES_DIR}`);
  if (sched.enabled) {
    console.log(`Jira auto-sync: every ${sched.intervalMinutes} min`);
  }
});
