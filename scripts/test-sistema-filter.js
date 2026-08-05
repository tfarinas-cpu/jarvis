#!/usr/bin/env node
/**
 * Unit-style checks for Sistema sync filter (no Jira API required).
 */

const assert = require("assert");
const {
  parseFilterList,
  matchesSistemaFilter,
  buildSistemaJqlClause,
  expandFiltersToJqlValues,
  filterRowsBySistema,
  fieldIdToCfClause,
} = require("../lib/sync-sistema-filter");

function row(sistema) {
  return { "Campo personalizado (Sistema)": sistema };
}

assert.deepStrictEqual(parseFilterList(""), []);
assert.deepStrictEqual(parseFilterList("SISNET, OPTICO"), ["SISNET", "OPTICO"]);
assert.deepStrictEqual(parseFilterList('"SISNET", OPTICO'), ["SISNET", "OPTICO"]);

assert.strictEqual(matchesSistemaFilter("SISNET", ["SISNET"]), true);
assert.strictEqual(matchesSistemaFilter("SISNET/EMISIONES", ["SISNET"]), true);
assert.strictEqual(matchesSistemaFilter("SISNET / Emisiones", ["SISNET"]), true);
assert.strictEqual(matchesSistemaFilter("OPTICO / Documentos", ["SISNET"]), false);
assert.strictEqual(matchesSistemaFilter("OPTICO / Documentos", ["OPTICO"]), true);
assert.strictEqual(matchesSistemaFilter("SEGURONET", ["SISNET", "OPTICO"]), false);
assert.strictEqual(matchesSistemaFilter("", ["SISNET"]), false);
assert.strictEqual(matchesSistemaFilter("SIN-SISTEMA", ["SISNET"]), false);
assert.strictEqual(matchesSistemaFilter("anything", []), true);

const filtered = filterRowsBySistema(
  [row("SISNET/EMISIONES"), row("SEGURONET"), row("OPTICO / Documentos")],
  ["SISNET", "OPTICO"]
);
assert.strictEqual(filtered.kept.length, 2);
assert.strictEqual(filtered.filteredOut, 1);

assert.strictEqual(
  buildSistemaJqlClause(["SISNET"], "customfield_10319", ["SISNET/EMISIONES"]),
  ' AND cf[10319] in ("SISNET/EMISIONES")'
);
assert.strictEqual(buildSistemaJqlClause(["SISNET"], "customfield_10319"), "");
assert.deepStrictEqual(
  expandFiltersToJqlValues(["SISNET/EMISIONES", "SEGURONET"], ["SISNET"]),
  ["SISNET/EMISIONES"]
);
assert.strictEqual(fieldIdToCfClause("customfield_10319"), "cf[10319]");

console.log("OK — sync-sistema-filter tests passed");
