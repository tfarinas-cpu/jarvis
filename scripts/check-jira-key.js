require("../lib/env").loadEnv();
const { getIssue, buildSyncJql, searchAllIssues, issueToImportRow } = require("../lib/jira-api");
const { buildNote } = require("../lib/jira-import");


async function main() {
  const key = process.argv[2] || "SLGMS-13091";
  console.log("Checking", key);

  try {
    const issue = await getIssue(key);
    const f = issue.fields || {};
    console.log("\n=== Jira issue ===");
    console.log("key:", issue.key);
    console.log("status:", f.status?.name);
    console.log("type:", f.issuetype?.name);
    console.log("updated:", f.updated);
    console.log("resolutiondate:", f.resolutiondate);
    console.log("summary:", f.summary);

    const row = issueToImportRow(issue);
    const note = buildNote(row, { syncSource: "api" });
    console.log("\n=== Import pipeline ===");
    console.log("buildNote:", note ? `OK → ${note.fileName}` : "NULL (skipped)");
    if (!note) {
      console.log("row key:", row["Clave de incidencia"]);
    }

    const statuses = ["Cerrado", "Finalizado"];
    const inStatus = statuses.includes(f.status?.name);
    console.log("\n=== Sync filters ===");
    console.log("status in (Cerrado, Finalizado):", inStatus);

    const jqls = [
      [`key only`, `key = ${key}`],
      [`key + status Finalizado`, `key = ${key} AND status = Finalizado`],
      [`key + status quoted`, `key = ${key} AND status = "Finalizado"`],
      [`key + statusCategory Done`, `key = ${key} AND statusCategory = Done`],
      [`sync filter`, `project = SLGMS AND key = ${key} AND status in ("Cerrado", "Finalizado")`],
      [`incremental 24h`, buildSyncJql({ updatedSince: new Date(Date.now() - 24 * 3600000) })],
    ];

    for (const [label, jql] of jqls) {
      const r = await searchAllIssues({ jql, maxIssues: 5000 });
      const has = r.issues.some((i) => i.key === key);
      console.log(`\nJQL [${label}]`);
      console.log(`  ${jql}`);
      console.log(`  total: ${r.total}, fetched: ${r.issues.length}, has ${key}: ${has}`);
    }
  } catch (err) {
    console.error("ERROR:", err.message || err);
    process.exit(1);
  }
}

main();
