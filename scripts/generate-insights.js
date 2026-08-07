#!/usr/bin/env node
/**
 * Offline Insights & Prevención report generator.
 *
 * Usage:
 *   node scripts/generate-insights.js [--days 30|90] [--top 10] [--minTickets 2]
 *                                     [--sistema "SISNET/..."] [--out report.md]
 *
 * Defaults: --days 0 (histórico) --top 10 --minTickets 2 --out release/insights-report.md
 */

const fs = require("fs");
const path = require("path");

const { parseNote, NOTES_DIR } = require("../server");
const { computeInsights } = require("../lib/insights-engine");
const { buildImprovementProposal, buildInsightsMarkdown } = require("../lib/insights-proposals");

function parseArgs(argv) {
  const args = { days: 0, top: 10, minTickets: 2, sistema: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--days" && value != null) { args.days = Number(value) || 0; i += 1; }
    else if (flag === "--top" && value != null) { args.top = Number(value) || 10; i += 1; }
    else if (flag === "--minTickets" && value != null) { args.minTickets = Number(value) || 2; i += 1; }
    else if (flag === "--sistema" && value != null) { args.sistema = String(value); i += 1; }
    else if (flag === "--out" && value != null) { args.out = String(value); i += 1; }
  }
  return args;
}

function loadAllNotesFromDisk() {
  const jiraDir = path.join(NOTES_DIR, "jira");
  const notes = [];
  if (fs.existsSync(jiraDir)) {
    for (const file of fs.readdirSync(jiraDir)) {
      if (!file.endsWith(".md")) continue;
      notes.push(parseNote(path.join(jiraDir, file), { jira: true }));
    }
  }
  return notes.filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(
    args.out || path.join(__dirname, "..", "release", "insights-report.md")
  );

  console.log(`[insights] Notes dir: ${NOTES_DIR}`);
  const t0 = Date.now();
  const notes = loadAllNotesFromDisk();
  console.log(`[insights] ${notes.length} notas cargadas en ${Date.now() - t0} ms`);

  const t1 = Date.now();
  const insights = computeInsights(notes, {
    days: args.days,
    sistema: args.sistema,
    minTickets: args.minTickets,
    top: args.top,
  });
  for (const cluster of insights.clusters) {
    cluster.proposal = buildImprovementProposal(cluster);
  }
  console.log(
    `[insights] ${insights.clusters.length} clústeres (${insights.buckets_evaluated} buckets, ` +
      `${insights.notes_in_period} notas en periodo) en ${Date.now() - t1} ms`
  );

  const md = buildInsightsMarkdown(insights.clusters, {
    days: insights.filters.days,
    sistema: insights.filters.sistema,
    total_notes: insights.total_notes,
    notes_in_period: insights.notes_in_period,
    deployment_notes_excluded: insights.deployment_notes_excluded,
    generated_at: insights.generated_at,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`[insights] Informe escrito en ${outPath}`);

  for (const c of insights.clusters) {
    console.log(
      `  #${c.rank} [score ${c.priority_score}] ${c.signature} — ${c.sistema} — ` +
        `${c.ticket_count} tickets (${c.first_seen} → ${c.last_seen})`
    );
  }
}

main();
