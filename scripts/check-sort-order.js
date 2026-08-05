const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const NOTES_DIR = path.join(__dirname, "..", "notes", "jira");

function noteUpdatedMs(note) {
  const d = new Date(note.updated_at || note.updated || "");
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function normalizeNoteUpdated(meta) {
  if (meta.jira_updated_at) return String(meta.jira_updated_at);
  const raw = meta.updated;
  if (raw instanceof Date) return raw.toISOString();
  const text = String(raw || meta.created || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T12:00:00.000Z`;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}

function jiraKeyNumber(key) {
  const m = String(key || "").match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

function compareNotesByRecency(a, b) {
  const diff = noteUpdatedMs(b) - noteUpdatedMs(a);
  if (diff) return diff;
  return jiraKeyNumber(b.key) - jiraKeyNumber(a.key);
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".md") && !e.name.includes("indice")) acc.push(p);
  }
  return acc;
}

const notes = walk(NOTES_DIR).map((filePath) => {
  const { data } = matter(fs.readFileSync(filePath, "utf8"));
  const key = data.jira_key || data.id || "";
  return {
    key,
    updated: normalizeNoteUpdated(data),
    file: path.basename(filePath),
  };
});

notes.sort(compareNotesByRecency);

console.log("Top 15 by updated_desc (current logic):");
for (const n of notes.slice(0, 15)) {
  console.log(n.updated.slice(0, 19), n.key);
}

const today = new Date().toISOString().slice(0, 10);
const counts = { today: 0, yesterday: 0, other: 0 };
for (const n of notes) {
  const day = n.updated.slice(0, 10);
  if (day === today) counts.today++;
  else if (day === new Date(Date.now() - 86400000).toISOString().slice(0, 10)) counts.yesterday++;
  else counts.other++;
}
console.log("\nCounts:", counts);
console.log("13091 rank:", notes.findIndex((n) => n.key === "SLGMS-13091") + 1, "updated:", notes.find((n) => n.key === "SLGMS-13091")?.updated);
