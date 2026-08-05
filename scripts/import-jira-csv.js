/**
 * CLI: Import historial_jira.csv into Dendron-style notes.
 * Uses node directly (no npm.ps1) — safe on Windows PowerShell.
 *
 * Usage:
 *   node scripts/import-jira-csv.js [path/to/historial_jira.csv]
 *   node scripts/import-jira-csv.js --prune-orphans   # also delete notes not in CSV
 */

const path = require("path");
const { importJiraCsv, defaultCsvPath } = require("../lib/jira-import");

const args = process.argv.slice(2);
const pruneOrphans = args.includes("--prune-orphans");
const csvArg = args.find((a) => !a.startsWith("--"));
const csvPath = csvArg ? path.resolve(csvArg) : defaultCsvPath();
const result = importJiraCsv({ csvPath, removeOrphans: pruneOrphans });

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
