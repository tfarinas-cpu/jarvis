#!/usr/bin/env node
/**
 * Sync closed SLGMS tickets from Jira Cloud → notes/jira/
 *
 * Usage:
 *   node scripts/sync-jira-api.js
 *   node scripts/sync-jira-api.js --full
 *   node scripts/sync-jira-api.js --test
 *   node scripts/sync-jira-api.js --dry-run-filter
 *   node scripts/sync-jira-api.js --full --dry-run-filter
 */

const { loadEnv } = require("../lib/env");
const { syncJiraFromApi, testConnection, getSyncStatus } = require("../lib/jira-sync");

loadEnv();

async function main() {
  const args = process.argv.slice(2);
  const fullSync = args.includes("--full");
  const testOnly = args.includes("--test");
  const dryRunFilter = args.includes("--dry-run-filter");

  if (testOnly) {
    const status = getSyncStatus();
    const conn = await testConnection();
    console.log(JSON.stringify({ status, connection: conn }, null, 2));
    process.exit(conn.ok ? 0 : 1);
  }

  if (dryRunFilter) {
    console.log(
      fullSync
        ? "Dry-run filtro Sistema (sync completo, sin importar ni purgar)…"
        : "Dry-run filtro Sistema (incremental, sin importar ni purgar)…"
    );
    const result = await syncJiraFromApi({ fullSync, dryRunFilter: true });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log(fullSync ? "Sync completo desde Jira API…" : "Sync incremental desde Jira API…");
  const result = await syncJiraFromApi({ fullSync });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
