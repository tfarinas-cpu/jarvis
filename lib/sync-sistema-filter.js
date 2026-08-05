/**
 * Configurable Sistema filter for Jira sync (JQL, post-fetch, local purge).
 */

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { parseSistema } = require("./jira-import");

const DEFAULT_SISTEMA_FIELD = "customfield_10319";
const INDEX_FILE = "hd.jarvis.import.indice.md";
const JIRA_KEY_IN_FILENAME_RE = /slgms[-.]?\d+/i;

const SISTEMA_ROW_KEYS = [
  "Campo personalizado (Sistema)",
  "Campo personalizado (Proyecto/Sistema)",
  "Campo personalizado (Sistema(s))",
  "Campo personalizado (Sistema en producción)",
  "Sistema",
];

function parseFilterList(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const tokens = [];
  const re = /"([^"]+)"|'([^']+)'|([^,]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const token = (match[1] || match[2] || match[3] || "").trim();
    if (token) tokens.push(token.toUpperCase());
  }
  return [...new Set(tokens)];
}

function getSistemaFiltersFromEnv(env = process.env) {
  return parseFilterList(env.JIRA_SYNC_SISTEMA_FILTER);
}

function getSistemaFieldId(env = process.env) {
  return String(env.JIRA_FIELD_SISTEMA || DEFAULT_SISTEMA_FIELD).trim() || DEFAULT_SISTEMA_FIELD;
}

function fieldIdToCfClause(fieldId) {
  const id = String(fieldId || "").trim();
  const numeric = id.match(/(\d+)/);
  if (numeric) return `cf[${numeric[1]}]`;
  return id;
}

function normalizeSistemaRoot(rawSistema) {
  const { sistema } = parseSistema(rawSistema);
  return String(sistema || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function matchesSistemaFilter(rawSistema, filters) {
  if (!filters?.length) return true;
  const root = normalizeSistemaRoot(rawSistema);
  if (!root || root === "SIN-SISTEMA") return false;
  return filters.some((token) => root === token);
}

function readSistemaFromRow(row) {
  for (const key of SISTEMA_ROW_KEYS) {
    const val = row?.[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return "";
}

function matchesRowSistema(row, filters) {
  return matchesSistemaFilter(readSistemaFromRow(row), filters);
}

function filterRowsBySistema(rows, filters) {
  if (!filters?.length) {
    return { kept: rows, filteredOut: 0, filterActive: false, sistemaFilter: [] };
  }
  const kept = rows.filter((row) => matchesRowSistema(row, filters));
  return {
    kept,
    filteredOut: rows.length - kept.length,
    filterActive: true,
    sistemaFilter: filters,
  };
}

function escapeJqlString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSistemaJqlClause(filters, fieldId, optionValues) {
  if (!filters?.length) return "";
  const cf = fieldIdToCfClause(fieldId || getSistemaFieldId());

  if (Array.isArray(optionValues) && optionValues.length) {
    const quoted = optionValues.map((value) => `"${escapeJqlString(value)}"`).join(", ");
    return ` AND ${cf} in (${quoted})`;
  }

  // Select-list fields do not support ~ on roots; omit JQL and rely on post-filter.
  return "";
}

function expandFiltersToJqlValues(allOptionValues, filters) {
  if (!filters?.length || !allOptionValues?.length) return [];
  const wanted = new Set(filters.map((f) => f.toUpperCase()));
  return allOptionValues.filter((raw) => {
    const root = normalizeSistemaRoot(raw);
    return root && wanted.has(root);
  });
}

function readSistemaFromMarkdown(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { content, data } = matter(raw);
    if (data.sistema) return String(data.sistema).trim();

    const inline = content.match(/^\*\*Sistema:\*\*\s*(.+)$/im);
    if (inline?.[1]) return inline[1].replace(/\*\*/g, "").trim();

    const multiline = content.match(
      /^\*\*Sistema:\*\*\s*\n([\s\S]*?)(?=\n\*\*[^\\n]+:\*\*|\n#{1,6}\s|$)/im
    );
    if (multiline?.[1]) return multiline[1].replace(/\*\*/g, "").trim();
  } catch {
    /* ignore */
  }
  return "";
}

function isPurgeCandidateFile(filePath) {
  const base = path.basename(filePath);
  if (base === INDEX_FILE || !base.endsWith(".md")) return false;
  return JIRA_KEY_IN_FILENAME_RE.test(base);
}

function walkMdFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
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
      else if (entry.isFile() && entry.name.endsWith(".md")) acc.push(full);
    }
  }
  return acc;
}

function purgeNotesOutsideFilter(notesDir, filters, options = {}) {
  const dryRun = options.dryRun === true;
  if (!filters?.length) {
    return {
      purgedOutsideFilter: 0,
      wouldPurge: 0,
      scanned: 0,
      filterActive: false,
      sistemaFilter: [],
      dryRun,
    };
  }

  const jiraDir = path.join(notesDir, "jira");
  let purgedOutsideFilter = 0;
  let scanned = 0;

  for (const filePath of walkMdFiles(jiraDir)) {
    if (!isPurgeCandidateFile(filePath)) continue;
    scanned += 1;
    const sistema = readSistemaFromMarkdown(filePath);
    if (matchesSistemaFilter(sistema, filters)) continue;
    if (dryRun) {
      purgedOutsideFilter += 1;
      continue;
    }
    try {
      fs.unlinkSync(filePath);
      purgedOutsideFilter += 1;
    } catch {
      /* ignore */
    }
  }

  return {
    purgedOutsideFilter: dryRun ? 0 : purgedOutsideFilter,
    wouldPurge: dryRun ? purgedOutsideFilter : purgedOutsideFilter,
    scanned,
    filterActive: true,
    sistemaFilter: filters,
    dryRun,
  };
}

module.exports = {
  DEFAULT_SISTEMA_FIELD,
  parseFilterList,
  getSistemaFiltersFromEnv,
  getSistemaFieldId,
  fieldIdToCfClause,
  normalizeSistemaRoot,
  matchesSistemaFilter,
  readSistemaFromRow,
  matchesRowSistema,
  filterRowsBySistema,
  buildSistemaJqlClause,
  expandFiltersToJqlValues,
  readSistemaFromMarkdown,
  purgeNotesOutsideFilter,
  isPurgeCandidateFile,
};
