#!/usr/bin/env node
/**
 * Startup data source: Jira API first; CSV only when explicitly opted in.
 *
 * Default: sync from Jira API if JIRA_EMAIL + JIRA_API_TOKEN are set.
 * CSV: only when JARVIS_IMPORT_CSV_ON_START=1 (never auto-imports just because the file exists).
 */

const { loadEnv } = require("../lib/env");
const { isConfigured } = require("../lib/jira-api");
const { syncJiraFromApi } = require("../lib/jira-sync");
const { importJiraCsv, csvExists, defaultCsvPath } = require("../lib/jira-import");

loadEnv();

async function main() {
  const csvOnStart = String(process.env.JARVIS_IMPORT_CSV_ON_START || "").trim() === "1";
  const fullOnStart = String(process.env.JARVIS_SYNC_FULL_ON_START || "").trim() === "1";

  if (isConfigured()) {
    console.log(
      fullOnStart
        ? "[sync] Jira API — sync completo (JARVIS_SYNC_FULL_ON_START=1)…"
        : "[sync] Jira API — sync incremental…"
    );
    const result = await syncJiraFromApi({ fullSync: fullOnStart });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (csvOnStart && csvExists()) {
    console.log("[sync] CSV — JARVIS_IMPORT_CSV_ON_START=1");
    const result = importJiraCsv({
      removeOrphans: false,
      syncSource: "csv",
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (csvExists()) {
    console.log(
      `[sync] Omitido: historial_jira.csv existe pero la fuente activa es Jira API.\n` +
        `       Configura JIRA_EMAIL y JIRA_API_TOKEN en .env, o usa JARVIS_IMPORT_CSV_ON_START=1 para CSV.\n` +
        `       CSV manual: node scripts/import-jira-csv.js`
    );
    process.exit(0);
  }

  console.log(
    "[sync] Sin fuente configurada. Define JIRA_EMAIL + JIRA_API_TOKEN en .env " +
      "o coloca historial_jira.csv con JARVIS_IMPORT_CSV_ON_START=1."
  );
  console.log(`CSV path esperado: ${defaultCsvPath()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
