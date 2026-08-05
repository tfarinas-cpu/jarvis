/**
 * Find similar HD notes for "someone already solved this" discovery.
 */

const STOPWORDS = new Set([
  "para", "como", "este", "esta", "estos", "estas", "desde", "donde", "cuando",
  "porque", "sobre", "entre", "hacia", "pero", "solo", "tambien", "tiene",
  "hacer", "hecho", "caso", "ticket", "error", "solicita", "solicitud", "usuario",
  "sistema", "area", "saludos", "buenos", "dias", "tardes", "favor", "ayuda",
  "the", "and", "for", "with", "from", "that", "this", "have", "has", "was",
]);

function tokenize(text) {
  const counts = new Map();
  for (const raw of String(text || "").toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const t = raw.trim();
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    if (/^slgms-\d+$/.test(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

function combineTokenMaps(...parts) {
  const merged = new Map();
  for (const part of parts) {
    for (const [k, v] of part) {
      merged.set(k, (merged.get(k) || 0) + v);
    }
  }
  return merged;
}

function overlapScore(mapA, mapB) {
  if (!mapA.size || !mapB.size) return 0;
  let intersection = 0;
  let union = 0;
  for (const [k, v] of mapA) {
    union += v;
    if (mapB.has(k)) intersection += Math.min(v, mapB.get(k));
  }
  for (const [k, v] of mapB) {
    if (!mapA.has(k)) union += v;
  }
  if (!union) return 0;
  return (intersection / union) * 100;
}

function facetMatch(a, b, field, weight) {
  const va = String(a[field] || "").trim();
  const vb = String(b[field] || "").trim();
  if (!va || !vb || va === "N/D" || vb === "N/D") return 0;
  return va.toLowerCase() === vb.toLowerCase() ? weight : 0;
}

function noteFingerprint(note) {
  return combineTokenMaps(
    tokenize(note.title),
    tokenize(note.causa),
    tokenize(note.solucion),
    tokenize(note.sintoma),
    tokenize(note.reporte),
    tokenize(note.tabla),
    tokenize((note.tags || []).join(" "))
  );
}

function similarityScore(source, candidate, sourceFp) {
  if (!candidate || !source) return 0;
  const sourceKey = String(source.jira_key || source.id || "").toLowerCase();
  const candidateKey = String(candidate.jira_key || candidate.id || "").toLowerCase();
  if (sourceKey && candidateKey === sourceKey) return 0;

  let score = 0;
  score += facetMatch(source, candidate, "sistema", 28);
  score += facetMatch(source, candidate, "modulo", 18);
  score += facetMatch(source, candidate, "reporte", 32);
  score += facetMatch(source, candidate, "tabla", 26);
  score += facetMatch(source, candidate, "area_usuaria", 10);

  const candidateFp = noteFingerprint(candidate);
  score += overlapScore(sourceFp, candidateFp);

  if (source.has_useful_solution && candidate.has_useful_solution) score += 6;
  if ((candidate.sql_scripts || []).length > 0) score += 4;

  return score;
}

function findSimilarNotes(sourceNote, notes, limit = 5) {
  if (!sourceNote) return [];

  const sourceFp = noteFingerprint(sourceNote);
  const scored = [];

  for (const note of notes) {
    const score = similarityScore(sourceNote, note, sourceFp);
    if (score < 12) continue;
    scored.push({ note, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.note.updated || "").localeCompare(String(a.note.updated || ""));
  });

  return scored.slice(0, Math.max(1, Math.min(10, limit)));
}

function findNoteByKey(notes, key) {
  const needle = String(key || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    notes.find((n) => String(n.jira_key || "").toLowerCase() === needle) ||
    notes.find((n) => String(n.id || "").toLowerCase() === needle) ||
    null
  );
}

module.exports = {
  findSimilarNotes,
  findNoteByKey,
  similarityScore,
};
