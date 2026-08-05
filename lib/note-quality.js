/**
 * Quality heuristics for analyst Causa / Solución fields (aligned with jira-import).
 */

const WEAK_ANALYST_RE =
  /^(caso atendido|atendido|n\/a|na|pendiente|sin informaci[oó]n|no aplica|ver comentarios?|ver descripci[oó]n|s\/d|s\.d\.?)$/i;

const PLACEHOLDER_RE =
  /sin (?:causa|soluci[oó]n) documentada en jira/i;

function cleanField(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakAnalystField(text) {
  const t = cleanField(text);
  if (!t) return true;
  if (t.length < 12) return true;
  if (WEAK_ANALYST_RE.test(t)) return true;
  if (PLACEHOLDER_RE.test(t)) return true;
  return false;
}

function hasUsefulSolution(solucion) {
  return !isWeakAnalystField(solucion);
}

function hasUsefulCausa(causa) {
  return !isWeakAnalystField(causa);
}

module.exports = {
  isWeakAnalystField,
  hasUsefulSolution,
  hasUsefulCausa,
};
