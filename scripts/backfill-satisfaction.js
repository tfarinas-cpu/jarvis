#!/usr/bin/env node
/**
 * Backfill JSM CSAT ratings into existing notes/jira/*.md via date-range report API.
 *
 * Usage:
 *   node scripts/backfill-satisfaction.js
 *   node scripts/backfill-satisfaction.js --days 30
 *   node scripts/backfill-satisfaction.js --days 365 --dry-run
 */

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { loadEnv } = require("../lib/env");
const { getConfig, isConfigured } = require("../lib/jira-api");
const {
  fetchProjectFeedbackReport,
  patchNoteFileWithSatisfaction,
  isSatisfactionSyncEnabled,
} = require("../lib/jira-satisfaction");

loadEnv();

const BASE_DIR = path.resolve(__dirname, "..");
const NOTES_DIR = process.env.DENDRON_NOTES_DIR
  ? path.resolve(process.env.DENDRON_NOTES_DIR)
  : path.join(BASE_DIR, "notes");

function walkMarkdownFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
        files.push(full);
      }
    }
  }
  return files;
}

function buildKeyIndex(notesDir) {
  const jiraDir = path.join(notesDir, "jira");
  const index = new Map();
  for (const file of walkMarkdownFiles(jiraDir)) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const { data } = matter(raw);
      const key = String(data.jira_key || data.id || "").trim().toUpperCase();
      if (/^SLGMS-\d+$/.test(key)) index.set(key, file);
    } catch {
      /* skip unreadable */
    }
  }
  return index;
}

function monthRanges(daysBack) {
  const ranges = [];
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, daysBack));
  let cursor = new Date(start);
  while (cursor < end) {
    const rangeStart = new Date(cursor);
    const rangeEnd = new Date(cursor);
    rangeEnd.setMonth(rangeEnd.getMonth() + 1);
    if (rangeEnd > end) rangeEnd.setTime(end.getTime());
    ranges.push({
      startDate: rangeStart.toISOString().slice(0, 10),
      endDate: rangeEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(rangeEnd);
  }
  return ranges;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 365 : 365;

  if (!isSatisfactionSyncEnabled()) {
    console.error("JIRA_SATISFACTION_SYNC is disabled. Set JIRA_SATISFACTION_SYNC=1 in .env");
    process.exit(1);
  }

  const config = getConfig();
  if (!isConfigured(config)) {
    console.error("Jira not configured. Set JIRA_EMAIL and JIRA_API_TOKEN in .env");
    process.exit(1);
  }

  const keyIndex = buildKeyIndex(NOTES_DIR);
  console.log(`Notes index: ${keyIndex.size} SLGMS tickets in ${path.join(NOTES_DIR, "jira")}`);

  const ranges = monthRanges(days);
  const feedbackMap = new Map();

  for (const range of ranges) {
    console.log(`Fetching CSAT report ${range.startDate} → ${range.endDate}…`);
    try {
      const chunk = await fetchProjectFeedbackReport(config, {
        project: config.project,
        startDate: range.startDate,
        endDate: range.endDate,
      });
      for (const [key, feedback] of chunk.entries()) {
        feedbackMap.set(key, feedback);
      }
      console.log(`  +${chunk.size} ratings (total unique: ${feedbackMap.size})`);
    } catch (err) {
      console.warn(`  Report failed for ${range.startDate}: ${err.message}`);
    }
  }

  let patched = 0;
  let skipped = 0;
  let missing = 0;

  for (const [key, feedback] of feedbackMap.entries()) {
    const filePath = keyIndex.get(key);
    if (!filePath) {
      missing += 1;
      continue;
    }
    if (dryRun) {
      patched += 1;
      continue;
    }
    try {
      if (patchNoteFileWithSatisfaction(filePath, feedback)) patched += 1;
      else skipped += 1;
    } catch (err) {
      console.warn(`Failed ${key}: ${err.message}`);
      skipped += 1;
    }
  }

  const result = {
    ok: true,
    dryRun,
    days,
    reportEntries: feedbackMap.size,
    notesIndexed: keyIndex.size,
    patched,
    skipped,
    missingNote: missing,
    notesDir: NOTES_DIR,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
