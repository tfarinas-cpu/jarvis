/**
 * Weighted relevance scoring for JARVIS search results.
 */

const ERROR_TOKEN_RE =
  /^(?:ora-\d{4,5}|sql\d+|error\d+|timeout|nullreference|sqlexception|violation|deadlock)$/i;

const TECH_TOKEN_RE =
  /^(?:grant|index|indice|sp_|pk_|fk_|select|update|insert|delete|procedure|job|batch)$/i;

function normalizeToken(token) {
  return String(token || "").trim().toLowerCase();
}

function fieldIncludes(field, token) {
  return String(field || "").toLowerCase().includes(token);
}

function allTokensInField(field, tokens) {
  if (!tokens.length) return false;
  const hay = String(field || "").toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function scoreTokenInNote(note, token) {
  let score = 0;
  const key = String(note.jira_key || note.id || "").toLowerCase();

  if (/^slgms-\d+$/i.test(token) && key === token) {
    return 1000;
  }

  if (fieldIncludes(note.solucion, token)) score += 14;
  if (fieldIncludes(note.causa, token)) score += 11;
  if (fieldIncludes(note.title, token)) score += 9;
  if (fieldIncludes(note.cierre_hd, token)) score += 8;
  if (fieldIncludes(note.sistema, token)) score += 7;
  if (fieldIncludes(note.modulo, token)) score += 6;
  if (fieldIncludes(note.reporte, token)) score += 6;
  if (fieldIncludes(note.tabla, token)) score += 5;
  if (fieldIncludes(note.sintoma, token)) score += 4;
  if (note.search_blob?.includes(token)) score += 1;

  if (ERROR_TOKEN_RE.test(token) || TECH_TOKEN_RE.test(token)) {
    if (
      fieldIncludes(note.solucion, token) ||
      fieldIncludes(note.causa, token) ||
      fieldIncludes(note.title, token)
    ) {
      score += 6;
    }
  }

  for (const sql of note.sql_scripts || []) {
    if (String(sql).toLowerCase().includes(token)) {
      score += 16;
      break;
    }
  }

  return score;
}

function scoreRelevance(note, tokens) {
  const normalized = tokens.map(normalizeToken).filter(Boolean);
  if (!normalized.length) return 0;

  let score = 0;
  for (const token of normalized) {
    score += scoreTokenInNote(note, token);
  }

  if (note.has_useful_solution) score += 8;
  if (note.has_useful_causa) score += 4;
  if ((note.sql_scripts || []).length > 0) score += 5;
  if (note.cierre_hd) score += 3;

  if (allTokensInField(note.solucion, normalized)) score += 10;
  if (allTokensInField(note.causa, normalized)) score += 7;
  if (allTokensInField(note.title, normalized)) score += 5;

  if (!note.has_useful_solution) score -= 6;
  if (!note.has_useful_causa) score -= 2;

  return Math.max(0, score);
}

function sortByRelevance(notes, tokens, tieBreakMs) {
  const list = [...notes];
  list.sort((a, b) => {
    const diff = scoreRelevance(b, tokens) - scoreRelevance(a, tokens);
    if (diff !== 0) return diff;
    return tieBreakMs(b) - tieBreakMs(a);
  });
  return list;
}

module.exports = {
  scoreRelevance,
  sortByRelevance,
};
