require("../lib/env").loadEnv();
const fs = require("fs");
const path = require("path");
const { buildSyncJql, searchAllIssues, issueToImportRow } = require("../lib/jira-api");
const { readSyncState } = require("../lib/jira-sync");
const {
  getSistemaFiltersFromEnv,
  getSistemaFieldId,
  buildSistemaJqlClause,
  filterRowsBySistema,
} = require("../lib/sync-sistema-filter");

const OVERLAP_MS = Number(process.env.JIRA_SYNC_OVERLAP_MS || 3600000);
const MIN_LOOKBACK_MS = Number(process.env.JIRA_SYNC_MIN_LOOKBACK_MS || 24 * 60 * 60 * 1000);

function resolveUpdatedSince(state) {
  if (!state.lastSuccessAt) return null;
  const fromLast = new Date(state.lastSuccessAt);
  fromLast.setTime(fromLast.getTime() - OVERLAP_MS);
  const floor = new Date(Date.now() - MIN_LOOKBACK_MS);
  return new Date(Math.min(fromLast.getTime(), floor.getTime()));
}

function noteExists(jiraDir, key) {
  const needle = String(key || "").toLowerCase();
  return fs.readdirSync(jiraDir).some((f) => f.toLowerCase().includes(needle));
}

async function main() {
  const st = readSyncState();
  const since = resolveUpdatedSince(st) || new Date(Date.now() - MIN_LOOKBACK_MS);
  const sistemaFilters = getSistemaFiltersFromEnv();
  const sistemaFieldId = getSistemaFieldId();

  console.log("Sistema filter:", sistemaFilters.length ? sistemaFilters.join(", ") : "(none — sync all)");
  console.log("Sistema field:", sistemaFieldId);
  if (sistemaFilters.length) {
    console.log("JQL clause:", buildSistemaJqlClause(sistemaFilters, sistemaFieldId));
  }

  const queries = [
    ["incremental (actual)", buildSyncJql({ updatedSince: since })],
    ["incremental sin filtro", buildSyncJql({ updatedSince: since, sistemaFilters: [] })],
    ["updated last 24h", 'project = SLGMS AND statusCategory = Done AND updated >= -1d'],
  ];

  for (const [label, jql] of queries) {
    const r = await searchAllIssues({ jql, maxIssues: 8 });
    const sample = r.issues
      .map((i) => `${i.key} u=${(i.fields.updated || "").slice(0, 16)}`)
      .join(" | ");
    console.log(`\n${label}`);
    console.log(`  total: ${r.total}`);
    console.log(`  jql: ${jql}`);
    console.log(`  sample: ${sample || "(none)"}`);
  }

  if (sistemaFilters.length) {
    const jql = buildSyncJql({ updatedSince: since });
    const { issues, total } = await searchAllIssues({ jql, maxIssues: 500 });
    const rows = issues.map((issue) => issueToImportRow(issue));
    const { kept, filteredOut } = filterRowsBySistema(rows, sistemaFilters);
    console.log(`\npost-filter sample (max 500 fetched)`);
    console.log(`  fetched: ${total}`);
    console.log(`  kept: ${kept.length}`);
    console.log(`  filteredOut: ${filteredOut}`);
  }

  const jiraDir = path.join(__dirname, "..", "notes", "jira");
  if (fs.existsSync(jiraDir)) {
    const { issues, total } = await searchAllIssues({
      jql: 'project = SLGMS AND statusCategory = Done AND resolutiondate >= startOfDay()',
      maxIssues: 50,
    });
    const missing = issues.filter((issue) => !noteExists(jiraDir, issue.key)).map((i) => i.key);
    console.log(`\nclosed today: ${total} in Jira (sample cap 50), ${missing.length} missing on disk`);
    if (missing.length) console.log(`  missing: ${missing.slice(0, 25).join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
