/**
 * Optional background Jira sync on a fixed interval.
 */

const { readSyncState, writeSyncState } = require("./jira-sync");

function parseIntervalMinutes(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(24 * 60, Math.floor(n));
}

function createJiraSyncScheduler(options = {}) {
  const intervalMinutes = parseIntervalMinutes(
    options.intervalMinutes ?? process.env.JIRA_SYNC_INTERVAL_MINUTES
  );
  const runOnStart =
    options.runOnStart ??
    String(process.env.JIRA_SYNC_ON_START || "").trim() === "1";

  let timer = null;
  let running = false;
  let lastRunAt = null;
  let lastError = null;
  let lastResult = null;

  async function runOnce() {
    if (running) {
      return { skipped: true, reason: "sync_in_progress" };
    }
    if (typeof options.syncFn !== "function") {
      return { skipped: true, reason: "no_sync_fn" };
    }

    running = true;
    lastRunAt = new Date().toISOString();
    try {
      const result = await options.syncFn();
      lastResult = {
        ok: Boolean(result?.ok),
        mode: result?.mode || null,
        created: result?.created ?? null,
        updated: result?.updated ?? null,
        unchanged: result?.unchanged ?? null,
        fetched: result?.fetched ?? null,
      };
      lastError = result?.ok ? null : String(result?.error || "sync_failed");
      return result;
    } catch (err) {
      lastError = String(err.message || err);
      lastResult = { ok: false };
      throw err;
    } finally {
      running = false;
      try {
        const state = readSyncState();
        writeSyncState({
          ...state,
          scheduler: {
            intervalMinutes,
            lastRunAt,
            lastError,
            lastResult,
          },
        });
      } catch {
        /* ignore state write errors */
      }
    }
  }

  function start() {
    if (runOnStart) {
      runOnce().catch(() => {
        /* ignore startup sync errors */
      });
    }

    if (!intervalMinutes) return runOnStart;

    if (timer) return true;

    timer = setInterval(() => {
      runOnce().catch(() => {
        /* errors recorded in lastError */
      });
    }, intervalMinutes * 60 * 1000);

    return true;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function getStatus() {
    const state = readSyncState();
    const persisted = state.scheduler || {};
    return {
      enabled: Boolean(intervalMinutes),
      intervalMinutes,
      runOnStart,
      running,
      lastRunAt: lastRunAt || persisted.lastRunAt || null,
      lastError: lastError || persisted.lastError || null,
      lastResult: lastResult || persisted.lastResult || null,
    };
  }

  return {
    start,
    stop,
    runOnce,
    getStatus,
    intervalMinutes,
  };
}

module.exports = {
  createJiraSyncScheduler,
  parseIntervalMinutes,
};
