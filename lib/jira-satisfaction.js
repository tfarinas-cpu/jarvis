/**
 * Jira Service Management CSAT (customer satisfaction) feedback client.
 */

const {
  SATISFACTION_ROW_RATING,
  SATISFACTION_ROW_COMMENT,
  SATISFACTION_ROW_AT,
  isSatisfactionSyncEnabled,
  normalizeRating,
  mergeFeedbackIntoRow,
  readSatisfactionFromRow,
  enrichRowsWithFeedback,
  patchNoteContentWithSatisfaction,
} = require("./satisfaction-fields");

function authHeader(config) {
  const token = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    Accept: "application/json",
    "X-ExperimentalApi": "opt-in",
  };
}

function parseFeedbackPayload(data) {
  if (!data || typeof data !== "object") return null;
  const rating = normalizeRating(data.rating);
  if (rating == null) return null;

  let comment = "";
  if (typeof data.comment === "string") comment = data.comment.trim();
  else if (data.comment?.body != null) {
    comment =
      typeof data.comment.body === "string"
        ? data.comment.body.trim()
        : String(data.comment.body || "").trim();
  }

  const createdAt =
    data.createdDate ||
    data.created ||
    data.date ||
    data.submittedDate ||
    data.submittedAt ||
    "";

  return {
    rating,
    comment,
    createdAt: createdAt ? String(createdAt) : "",
  };
}

async function serviceDeskFetch(config, urlPath) {
  const url = `${config.baseUrl}${urlPath}`;
  const res = await fetch(url, { headers: authHeader(config) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`JSM API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchRequestFeedback(config, issueKey) {
  if (!issueKey) return null;
  const key = encodeURIComponent(String(issueKey).trim());
  try {
    const data = await serviceDeskFetch(config, `/rest/servicedeskapi/request/${key}/feedback`);
    return parseFeedbackPayload(data);
  } catch (err) {
    if (String(err.message || "").includes("404")) return null;
    throw err;
  }
}

function feedbackEntryFromReportItem(item) {
  if (!item || typeof item !== "object") return null;
  const key =
    item.issueKey ||
    item.requestKey ||
    item.key ||
    item.issue?.key ||
    item.request?.key ||
    "";
  const rating = normalizeRating(
    item.rating ?? item.rate ?? item.score ?? item.satisfaction ?? item.feedbackRating
  );
  if (!key || rating == null) return null;

  const comment =
    typeof item.comment === "string"
      ? item.comment.trim()
      : String(item.comment?.body || item.feedbackComment || "").trim();

  const createdAt = item.date || item.createdDate || item.submittedDate || item.created || "";

  return {
    key: String(key).toUpperCase(),
    feedback: { rating, comment, createdAt: createdAt ? String(createdAt) : "" },
  };
}

function collectReportFeedbackItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const buckets = [
    payload.values,
    payload.feedback,
    payload.feedbacks,
    payload.results,
    payload.data,
    payload.overall?.values,
    payload.overall?.feedback,
  ];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length) return bucket;
  }
  return [];
}

async function fetchProjectFeedbackReportPage(config, options = {}) {
  const project = encodeURIComponent(options.project || config.project || "SLGMS");
  const params = new URLSearchParams();
  if (options.startDate) params.set("startDate", options.startDate);
  if (options.endDate) params.set("endDate", options.endDate);
  params.set("start", String(options.start ?? 0));
  params.set("limit", String(options.limit ?? 100));
  params.set("expand", "overall");

  const path = `/rest/servicedesk/1/projects/${project}/report/feedback/date-range?${params.toString()}`;
  return serviceDeskFetch(config, path);
}

async function fetchProjectFeedbackReport(config, options = {}) {
  const map = new Map();
  let start = options.start ?? 0;
  const limit = options.limit ?? 100;
  let pageCount = 0;
  const maxPages = options.maxPages ?? 200;

  while (pageCount < maxPages) {
    const page = await fetchProjectFeedbackReportPage(config, {
      ...options,
      start,
      limit,
    });
    if (!page) break;

    const items = collectReportFeedbackItems(page);
    if (!items.length) break;

    for (const item of items) {
      const entry = feedbackEntryFromReportItem(item);
      if (entry) map.set(entry.key, entry.feedback);
    }

    if (items.length < limit) break;
    start += items.length;
    pageCount += 1;
  }

  return map;
}

async function fetchFeedbackForIssueKeys(config, issueKeys, options = {}) {
  const concurrency = Math.min(Math.max(Number(options.concurrency) || 5, 1), 10);
  const keys = [...new Set((issueKeys || []).map((k) => String(k || "").trim()).filter(Boolean))];
  const map = new Map();

  let index = 0;
  async function worker() {
    while (index < keys.length) {
      const i = index++;
      const key = keys[i];
      try {
        const feedback = await fetchRequestFeedback(config, key);
        if (feedback) map.set(key.toUpperCase(), feedback);
      } catch {
        /* skip single key failures */
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, keys.length) }, () => worker());
  await Promise.all(workers);
  return map;
}

async function attachSatisfactionToRows(rows, options = {}) {
  if (!isSatisfactionSyncEnabled() || !rows?.length) {
    return { rows, fetched: 0, enabled: false };
  }

  const { getConfig, isConfigured } = require("./jira-api");
  const config = getConfig();
  if (!isConfigured(config)) {
    return { rows, fetched: 0, enabled: false, error: "Jira not configured" };
  }

  const keys = rows.map((r) => r["Clave de incidencia"]).filter(Boolean);
  const feedbackMap = await fetchFeedbackForIssueKeys(config, keys, options);
  return {
    rows: enrichRowsWithFeedback(rows, feedbackMap),
    fetched: feedbackMap.size,
    enabled: true,
  };
}

function patchNoteFileWithSatisfaction(filePath, feedback) {
  const matter = require("gray-matter");
  const fs = require("fs");
  const rating = normalizeRating(feedback?.rating);
  if (rating == null || !filePath) return false;

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  data.jira_satisfaction_rating = rating;
  data.jira_satisfaction_comment = String(feedback.comment || "").trim();
  if (feedback.createdAt) {
    data.jira_satisfaction_at = String(feedback.createdAt);
  }

  const newContent = patchNoteContentWithSatisfaction(content, feedback);
  fs.writeFileSync(filePath, matter.stringify(newContent, data), "utf8");
  return true;
}

module.exports = {
  SATISFACTION_ROW_RATING,
  SATISFACTION_ROW_COMMENT,
  SATISFACTION_ROW_AT,
  isSatisfactionSyncEnabled,
  normalizeRating,
  fetchRequestFeedback,
  fetchProjectFeedbackReport,
  fetchProjectFeedbackReportPage,
  fetchFeedbackForIssueKeys,
  mergeFeedbackIntoRow,
  readSatisfactionFromRow,
  enrichRowsWithFeedback,
  attachSatisfactionToRows,
  patchNoteContentWithSatisfaction,
  patchNoteFileWithSatisfaction,
};
