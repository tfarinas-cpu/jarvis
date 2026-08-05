/**
 * Aggregate documentation quality metrics for analyst dashboards.
 */

const { hasUsefulSolution, hasUsefulCausa } = require("./note-quality");

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function facetValue(text) {
  const t = String(text || "").trim();
  if (!t || t === "N/D") return "";
  return t;
}

function buildGroupMetrics(notes, getter, limit = 12) {
  const groups = new Map();
  for (const note of notes) {
    const key = getter(note);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { value: key, total: 0, useful_solution: 0, useful_causa: 0, with_sql: 0 });
    }
    const row = groups.get(key);
    row.total += 1;
    if (note.has_useful_solution) row.useful_solution += 1;
    if (note.has_useful_causa) row.useful_causa += 1;
    if ((note.sql_scripts || []).length > 0) row.with_sql += 1;
  }

  return [...groups.values()]
    .map((row) => enrichGroupRow(row))
    .sort((a, b) => b.total - a.total || a.value.localeCompare(b.value, "es"))
    .slice(0, limit);
}

function compositeQualityScore(row) {
  return row.useful_solution_pct * 0.5 + row.useful_causa_pct * 0.3 + row.with_sql_pct * 0.2;
}

function enrichGroupRow(row) {
  const enriched = {
    ...row,
    useful_solution_pct: pct(row.useful_solution, row.total),
    useful_causa_pct: pct(row.useful_causa, row.total),
    with_sql_pct: pct(row.with_sql, row.total),
  };
  enriched.quality_score = Math.round(compositeQualityScore(enriched) * 10) / 10;
  return enriched;
}

function buildAssigneeRanking(notes, minCases = 5, limit = 20) {
  const groups = new Map();
  for (const note of notes) {
    const key = facetValue(note.assignee);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { value: key, total: 0, useful_solution: 0, useful_causa: 0, with_sql: 0 });
    }
    const row = groups.get(key);
    row.total += 1;
    if (note.has_useful_solution) row.useful_solution += 1;
    if (note.has_useful_causa) row.useful_causa += 1;
    if ((note.sql_scripts || []).length > 0) row.with_sql += 1;
  }

  return [...groups.values()]
    .map((row) => enrichGroupRow(row))
    .filter((row) => row.total >= minCases)
    .sort((a, b) => b.quality_score - a.quality_score || b.total - a.total || a.value.localeCompare(b.value, "es"))
    .slice(0, limit)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function computeQualityMetrics(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const total = list.length;

  let usefulSolution = 0;
  let usefulCausa = 0;
  let withSql = 0;
  let withCierre = 0;
  let weakBoth = 0;
  let satisfactionRated = 0;
  let satisfactionSum = 0;

  for (const note of list) {
    const solOk = note.has_useful_solution ?? hasUsefulSolution(note.solucion);
    const causaOk = note.has_useful_causa ?? hasUsefulCausa(note.causa);
    if (solOk) usefulSolution += 1;
    if (causaOk) usefulCausa += 1;
    if ((note.sql_scripts || []).length > 0) withSql += 1;
    if (String(note.cierre_hd || "").trim()) withCierre += 1;
    if (!solOk && !causaOk) weakBoth += 1;
    const rating = note.satisfaction_rating;
    if (rating != null && rating >= 1 && rating <= 5) {
      satisfactionRated += 1;
      satisfactionSum += rating;
    }
  }

  return {
    total,
    useful_solution: usefulSolution,
    useful_causa: usefulCausa,
    with_sql: withSql,
    with_cierre_hd: withCierre,
    weak_both: weakBoth,
    useful_solution_pct: pct(usefulSolution, total),
    useful_causa_pct: pct(usefulCausa, total),
    with_sql_pct: pct(withSql, total),
    with_cierre_hd_pct: pct(withCierre, total),
    weak_both_pct: pct(weakBoth, total),
    satisfaction_rated: satisfactionRated,
    satisfaction_rated_pct: pct(satisfactionRated, total),
    satisfaction_avg: satisfactionRated
      ? Math.round((satisfactionSum / satisfactionRated) * 10) / 10
      : null,
    by_sistema: buildGroupMetrics(list, (n) => facetValue(n.sistema)),
    by_area: buildGroupMetrics(list, (n) => facetValue(n.area_usuaria), 15),
    by_assignee: buildAssigneeRanking(list),
    ranking_min_cases: 5,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  computeQualityMetrics,
  buildAssigneeRanking,
  compositeQualityScore,
};
