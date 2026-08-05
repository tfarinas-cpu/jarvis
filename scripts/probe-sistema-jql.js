require("../lib/env").loadEnv();
const { searchAllIssues, getJiraFields } = require("../lib/jira-api");

async function tryJql(label, jql) {
  try {
    const r = await searchAllIssues({ jql, maxIssues: 3 });
    console.log(`${label}: total=${r.total} sample=${(r.issues || []).map((i) => i.key).join(", ") || "(none)"}`);
    if (r.total === 0) console.log(`  jql: ${jql}`);
  } catch (err) {
    console.log(`${label} ERROR: ${err.message.slice(0, 250)}`);
  }
}

async function main() {
  const base = "project = SLGMS AND statusCategory = Done AND updated >= -365d";
  await tryJql("exact SISNET/EMISIONES cf", `${base} AND cf[10319] = "SISNET/EMISIONES"`);
  await tryJql("exact quoted ES", `${base} AND "Campo personalizado (Sistema)" = "SISNET/EMISIONES"`);
  await tryJql("in two values", `${base} AND "Campo personalizado (Sistema)" in ("SISNET/EMISIONES", "OPTICO / Documentos")`);
  await tryJql("contains word SISNET text", `${base} AND text ~ "SISNET" AND cf[10319] is not EMPTY`);
}

main();
