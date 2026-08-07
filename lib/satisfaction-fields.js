/**
 * Pure CSAT field helpers (no Jira API deps — safe for jira-import / sync-sistema-filter chain).
 */

const SATISFACTION_ROW_RATING = "Satisfacción (rating)";
const SATISFACTION_ROW_COMMENT = "Satisfacción (comentario)";
const SATISFACTION_ROW_AT = "Satisfacción (fecha)";

function isSatisfactionSyncEnabled(env = process.env) {
  const raw = String(env.JIRA_SATISFACTION_SYNC ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function normalizeRating(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return Math.round(n);
}

function mergeFeedbackIntoRow(row, feedback) {
  if (!row || !feedback || feedback.rating == null) return row;
  return {
    ...row,
    [SATISFACTION_ROW_RATING]: feedback.rating,
    [SATISFACTION_ROW_COMMENT]: feedback.comment || "",
    [SATISFACTION_ROW_AT]: feedback.createdAt || "",
  };
}

function readSatisfactionFromRow(row) {
  const rating = normalizeRating(row?.[SATISFACTION_ROW_RATING] ?? row?.satisfaction_rating);
  if (rating == null) return null;
  return {
    rating,
    comment: String(row?.[SATISFACTION_ROW_COMMENT] || row?.satisfaction_comment || "").trim(),
    createdAt: String(row?.[SATISFACTION_ROW_AT] || row?.satisfaction_at || "").trim(),
  };
}

function enrichRowsWithFeedback(rows, feedbackMap) {
  if (!feedbackMap?.size) return rows;
  return rows.map((row) => {
    const key = String(row["Clave de incidencia"] || "").trim().toUpperCase();
    const feedback = feedbackMap.get(key);
    return feedback ? mergeFeedbackIntoRow(row, feedback) : row;
  });
}

function patchNoteContentWithSatisfaction(content, feedback) {
  const rating = normalizeRating(feedback?.rating);
  if (rating == null) return content;
  const satLine = `**Satisfacción:** ${rating}/5\n`;
  if (/\*\*Satisfacción:\*\*/i.test(content)) {
    return content.replace(/\*\*Satisfacción:\*\*[^\n]*\n?/i, satLine);
  }
  const assigneeRe = /(\*\*Asignado a:\*\*[^\n]*\n)/i;
  if (assigneeRe.test(content)) {
    return content.replace(assigneeRe, `$1${satLine}`);
  }
  return `${satLine}${content}`;
}

module.exports = {
  SATISFACTION_ROW_RATING,
  SATISFACTION_ROW_COMMENT,
  SATISFACTION_ROW_AT,
  isSatisfactionSyncEnabled,
  normalizeRating,
  mergeFeedbackIntoRow,
  readSatisfactionFromRow,
  enrichRowsWithFeedback,
  patchNoteContentWithSatisfaction,
};
