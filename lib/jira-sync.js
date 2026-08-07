/**
 * Sync Jira Cloud issues → Dendron notes (reuses jira-import buildNote pipeline).
 */

const fs = require("fs");
const path = require("path");
const {
  getConfig,
  isConfigured,
  issueToImportRow,
  buildSyncJql,
  searchAllIssues,
  testConnection,
  fetchSistemaFieldOptions,
} = require("./jira-api");
const { importJiraRows, resolveNotesDir } = require("./jira-import");
const {
  getSistemaFiltersFromEnv,
  getSistemaFieldId,
  filterRowsBySistema,
  purgeNotesOutsideFilter,
  expandFiltersToJqlValues,
} = require("./sync-sistema-filter");
const { attachSatisfactionToRows, isSatisfactionSyncEnabled } = require("./jira-satisfaction");

const ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(ROOT, ".jarvis");
const STATE_FILE = path.join(STATE_DIR, "jira-sync-state.json");

const DEFAULT_INITIAL_DAYS = Number(process.env.JIRA_SYNC_INITIAL_DAYS || 365);
const OVERLAP_MS = Number(process.env.JIRA_SYNC_OVERLAP_MS || 3600000);
const MIN_LOOKBACK_MS = Number(process.env.JIRA_SYNC_MIN_LOOKBACK_MS || 24 * 60 * 60 * 1000);

function readSyncState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeSyncState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function resolveUpdatedSince(options = {}) {
  if (options.fullSync) return null;
  if (options.updatedSince) return new Date(options.updatedSince);

  const state = readSyncState();
  if (state.lastSuccessAt) {
    const fromLast = new Date(state.lastSuccessAt);
    fromLast.setTime(fromLast.getTime() - OVERLAP_MS);
    const floor = new Date(Date.now() - MIN_LOOKBACK_MS);
    return new Date(Math.min(fromLast.getTime(), floor.getTime()));
  }

  if (options.initialDays != null) {
    return null;
  }

  return null;
}

async function syncJiraFromApi(options = {}) {
  const config = getConfig();
  if (!isConfigured(config)) {
    return {
      ok: false,
      error: "Jira API no configurada. Define JIRA_EMAIL y JIRA_API_TOKEN en el entorno.",
      configHint: ".env.example",
    };
  }

  const notesDir = resolveNotesDir(options.notesDir);
  const updatedSince = resolveUpdatedSince(options);
  const initialDays = options.fullSync ? null : options.initialDays ?? (updatedSince ? null : DEFAULT_INITIAL_DAYS);
  const sistemaFilters = options.sistemaFilters ?? getSistemaFiltersFromEnv();
  const sistemaFieldId = options.sistemaFieldId ?? getSistemaFieldId();
  const dryRunFilter = options.dryRunFilter === true;

  let sistemaJqlValues = options.sistemaJqlValues;
  let sistemaJqlWarning = null;
  if (sistemaFilters.length && !Array.isArray(sistemaJqlValues)) {
    try {
      const allOptions = await fetchSistemaFieldOptions(config);
      sistemaJqlValues = expandFiltersToJqlValues(allOptions, sistemaFilters);
      if (!sistemaJqlValues.length) {
        sistemaJqlWarning =
          "Sistema filter active but no Jira field options matched; using post-filter only.";
      }
    } catch (err) {
      sistemaJqlWarning = `Could not load Sistema field options: ${String(err.message || err)}`;
      sistemaJqlValues = [];
    }
  }

  const jql = options.jql ||
    buildSyncJql({
      project: options.project,
      updatedSince: updatedSince || undefined,
      initialDays: updatedSince ? undefined : initialDays,
      issueTypes: options.issueTypes,
      statuses: options.statuses,
      sistemaFilters,
      sistemaFieldId,
      sistemaJqlValues,
    });

  const startedAt = new Date().toISOString();
  let fetchStats = { fetched: 0, total: 0 };

  const { issues, total } = await searchAllIssues({
    jql,
    maxIssues: options.maxIssues,
    onPage: (p) => {
      fetchStats = { fetched: p.fetched, total: p.total };
    },
  });

  const allRows = issues.map(issueToImportRow);
  const { kept: rows, filteredOut, filterActive, sistemaFilter } = filterRowsBySistema(
    allRows,
    sistemaFilters
  );

  let rowsToImport = rows;
  let satisfactionStats = { enabled: false, fetched: 0 };
  if (!dryRunFilter && isSatisfactionSyncEnabled()) {
    const sat = await attachSatisfactionToRows(rows);
    rowsToImport = sat.rows;
    satisfactionStats = { enabled: sat.enabled, fetched: sat.fetched, error: sat.error || null };
  }

  if (dryRunFilter) {
    const purgePreview = filterActive
      ? purgeNotesOutsideFilter(notesDir, sistemaFilters, { dryRun: true })
      : { wouldPurge: 0, scanned: 0 };

    return {
      ok: true,
      dryRun: true,
      mode: updatedSince ? "incremental" : initialDays ? `initial-${initialDays}d` : "full",
      jql,
      startedAt,
      finishedAt: new Date().toISOString(),
      fetched: issues.length,
      reportedTotal: total,
      fetchStats,
      filterActive,
      sistemaFilter,
      sistemaJqlValues,
      sistemaJqlWarning,
      rowsBeforeFilter: allRows.length,
      rowsAfterFilter: rows.length,
      filteredOut,
      purgePreview,
      notesDir,
    };
  }

  const persist = importJiraRows(rowsToImport, {
    notesDir,
    removeOrphans: false,
    syncSource: "api",
    sourceLabel: "Jira API",
  });

  const purgeStats = filterActive
    ? purgeNotesOutsideFilter(notesDir, sistemaFilters)
    : {
        purgedOutsideFilter: 0,
        scanned: 0,
        filterActive: false,
        sistemaFilter: [],
      };

  const finishedAt = new Date().toISOString();
  writeSyncState({
    lastSyncAt: finishedAt,
    lastSuccessAt: finishedAt,
    lastJql: jql,
    issuesFetched: issues.length,
    filterActive,
    sistemaFilter,
    sistemaJqlValues,
    filteredOut,
    purgedOutsideFilter: purgeStats.purgedOutsideFilter,
    ...persist,
  });

  return {
    ok: true,
    mode: updatedSince ? "incremental" : initialDays ? `initial-${initialDays}d` : "full",
    jql,
    startedAt,
    finishedAt,
    fetched: issues.length,
    reportedTotal: total,
    fetchStats,
    filterActive,
    sistemaFilter,
    sistemaJqlValues,
    sistemaJqlWarning,
    satisfaction: satisfactionStats,
    filteredOut,
    rowsImported: rowsToImport.length,
    ...purgeStats,
    notesDir,
    config: {
      baseUrl: config.baseUrl,
      project: config.project,
      email: config.email,
    },
    ...persist,
  };
}

function getSyncStatus() {
  const config = getConfig();
  const state = readSyncState();
  const sistemaFilter = getSistemaFiltersFromEnv();
  return {
    configured: isConfigured(config),
    baseUrl: config.baseUrl,
    project: config.project,
    email: config.email ? `${config.email.slice(0, 3)}***@${config.email.split("@")[1] || ""}` : "",
    stateFile: STATE_FILE,
    filterActive: sistemaFilter.length > 0,
    sistemaFilter,
    sistemaFieldId: getSistemaFieldId(),
    lastSyncAt: state.lastSyncAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    lastJql: state.lastJql || null,
    lastStats: state.created != null
      ? {
          created: state.created,
          updated: state.updated,
          unchanged: state.unchanged,
          issuesFetched: state.issuesFetched,
          filteredOut: state.filteredOut ?? null,
          purgedOutsideFilter: state.purgedOutsideFilter ?? null,
        }
      : null,
  };
}

module.exports = {
  syncJiraFromApi,
  getSyncStatus,
  testConnection,
  readSyncState,
  writeSyncState,
  STATE_FILE,
};
