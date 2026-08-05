require("../lib/env").loadEnv();
const { searchAllIssues } = require("../lib/jira-api");

async function main() {
  const jqls = [
    'project = SLGMS AND status = Cerrado',
    'project = SLGMS AND status = "Cerrado"',
    'project = SLGMS AND status = Finalizado',
    'project = SLGMS AND status = "Finalizado"',
    'project = SLGMS AND status = Done',
    'project = SLGMS AND status = "Done"',
    'project = SLGMS AND statusCategory = Done',
    'project = SLGMS AND status in ("Cerrado", "Finalizado")',
    'project = SLGMS AND statusCategory = Done AND updated >= -7d',
  ];
  for (const jql of jqls) {
    const r = await searchAllIssues({ jql, maxIssues: 1 });
    console.log(`${String(r.total).padStart(6)} | ${jql}`);
  }
}

main().catch(console.error);
