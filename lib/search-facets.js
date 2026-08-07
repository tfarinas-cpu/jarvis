/**
 * Faceted filter helpers for JARVIS search.
 */

const FACET_LIMIT = 50;

function facetValue(text) {
  const t = String(text || "").trim();
  if (!t || t === "N/D") return "";
  return t;
}

function applyFacetFilters(notes, options = {}) {
  let list = notes;
  const sistema = facetValue(options.sistema);
  const area = facetValue(options.area);
  const assignee = facetValue(options.assignee);
  const informador = facetValue(options.informador);

  if (sistema) {
    list = list.filter((n) => facetValue(n.sistema) === sistema);
  }
  if (area) {
    list = list.filter((n) => facetValue(n.area_usuaria) === area);
  }
  if (assignee) {
    list = list.filter((n) => facetValue(n.assignee) === assignee);
  }
  if (informador) {
    list = list.filter((n) => facetValue(n.informador) === informador);
  }
  return list;
}

function buildFacetCounts(notes, getter, limit = FACET_LIMIT) {
  const counts = new Map();
  for (const note of notes) {
    const v = getter(note);
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildFacets(notes, limit = FACET_LIMIT) {
  return {
    sistema: buildFacetCounts(notes, (n) => facetValue(n.sistema), limit),
    area: buildFacetCounts(notes, (n) => facetValue(n.area_usuaria), limit),
    assignee: buildFacetCounts(notes, (n) => facetValue(n.assignee), limit),
    informador: buildFacetCounts(notes, (n) => facetValue(n.informador), limit),
  };
}

function paginateNotes(list, page, limit) {
  const total = list.length;
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 40));
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (safePage - 1) * safeLimit;
  return {
    total,
    page: safePage,
    limit: safeLimit,
    pages,
    results: list.slice(start, start + safeLimit),
  };
}

module.exports = {
  FACET_LIMIT,
  facetValue,
  applyFacetFilters,
  buildFacets,
  paginateNotes,
};
