/**
 * Jira Cloud REST client for JARVIS sync.
 * Auth: email + API token (Atlassian account settings).
 */

const {
  getSistemaFiltersFromEnv,
  getSistemaFieldId,
  buildSistemaJqlClause,
} = require("./sync-sistema-filter");

const DEFAULT_JIRA_FIELDS = {
  causa: "customfield_10286",
  solucion: "customfield_10245",
  sistema: "customfield_10319",
  areaUsuaria: "customfield_10246",
};

function getJiraFields() {
  return {
    causa: String(process.env.JIRA_FIELD_CAUSA || DEFAULT_JIRA_FIELDS.causa).trim(),
    solucion: String(process.env.JIRA_FIELD_SOLUCION || DEFAULT_JIRA_FIELDS.solucion).trim(),
    sistema: getSistemaFieldId(),
    areaUsuaria: String(process.env.JIRA_FIELD_AREA_USUARIA || DEFAULT_JIRA_FIELDS.areaUsuaria).trim(),
  };
}

function getSearchFields() {
  const fields = getJiraFields();
  return [
    "summary",
    "description",
    "status",
    "issuetype",
    "priority",
    "resolution",
    "assignee",
    "reporter",
    "created",
    "updated",
    "resolutiondate",
    "comment",
    fields.causa,
    fields.solucion,
    fields.sistema,
    fields.areaUsuaria,
  ];
}

/** @deprecated use getJiraFields() — kept for importers that read JIRA_FIELDS.sistema */
const JIRA_FIELDS = new Proxy(
  {},
  {
    get(_target, prop) {
      return getJiraFields()[prop];
    },
  }
);

function getConfig() {
  const baseUrl = String(process.env.JIRA_BASE_URL || "https://seguroslafise.atlassian.net").replace(
    /\/$/,
    ""
  );
  const email = String(process.env.JIRA_EMAIL || "").trim();
  const apiToken = String(process.env.JIRA_API_TOKEN || "").trim();
  const project = String(process.env.JIRA_PROJECT || "SLGMS").trim();
  const pageSize = Math.min(Math.max(Number(process.env.JIRA_SYNC_PAGE_SIZE || 100), 1), 100);

  return { baseUrl, email, apiToken, project, pageSize };
}

function isConfigured(config = getConfig()) {
  return Boolean(config.email && config.apiToken);
}

function authHeader(config) {
  const token = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  return { Authorization: `Basic ${token}`, Accept: "application/json" };
}

function adfToText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).join("");

  const type = node.type || "";
  const content = node.content ? node.content.map(adfToText).join("") : "";

  if (type === "text") return node.text || "";
  if (type === "hardBreak") return "\n";
  if (type === "paragraph") return `${content}\n`;
  if (type === "heading") return `${content}\n`;
  if (type === "listItem") return `- ${content.trim()}\n`;
  if (type === "bulletList" || type === "orderedList") return content;
  if (type === "doc") return content.trim();
  if (type === "rule") return "\n";
  return content;
}

function fieldText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value.type === "doc") return adfToText(value).trim();
  if (typeof value === "object" && value.value != null) return String(value.value).trim();
  return "";
}

function formatAreaUsuaria(field) {
  if (!field) return "";
  const parent = field.value || "";
  const child = field.child?.value || "";
  if (parent && child) return `${parent} -> ${child}`;
  return parent || child || "";
}

function formatCommentEntry(comment) {
  if (!comment) return "";
  const created = comment.created || "";
  const author = comment.author?.displayName || comment.author?.name || "Unknown";
  const body =
    typeof comment.body === "string"
      ? comment.body
      : comment.body?.type === "doc"
        ? adfToText(comment.body)
        : String(comment.body || "");
  return `${created};${author};${body}`;
}

function issueToImportRow(issue) {
  const fields = issue.fields || {};
  const comments = fields.comment?.comments || [];
  const jiraFields = getJiraFields();

  return {
    "Clave de incidencia": issue.key,
    Resumen: fields.summary || "",
    Estado: fields.status?.name || "",
    "Tipo de Incidencia": fields.issuetype?.name || "",
    Informador: fields.reporter?.displayName || "",
    "Persona asignada": fields.assignee?.displayName || "",
    Prioridad: fields.priority?.name || "",
    Resolución: fields.resolution?.name || "",
    "Campo personalizado (Causa)": fieldText(fields[jiraFields.causa]),
    "Campo personalizado (Solución)": fieldText(fields[jiraFields.solucion]),
    "Campo personalizado (Sistema)": fieldText(fields[jiraFields.sistema]),
    "Campo personalizado (País - Área Usuaria / CC)": formatAreaUsuaria(fields[jiraFields.areaUsuaria]),
    Descripción: fieldText(fields.description),
    Comentarios: comments.map(formatCommentEntry).filter(Boolean),
    Comentario: comments.map(formatCommentEntry).filter(Boolean),
    Actualizada: fields.updated || "",
    Resuelta: fields.resolutiondate || fields.updated || "",
    Creada: fields.created || "",
  };
}

function buildSyncJql(options = {}) {
  const config = getConfig();
  const project = options.project || config.project;
  const statusMode = String(process.env.JIRA_SYNC_STATUS_MODE || "category").toLowerCase();

  let jql = `project = ${project}`;

  if (statusMode === "list" && options.statuses?.length) {
    const statusClause = options.statuses.map((s) => `"${s}"`).join(", ");
    jql += ` AND status in (${statusClause})`;
  } else if (statusMode === "list") {
    // Jira JQL names: "Cerrado" + "Done" (UI may show "Finalizado" for Done)
    jql += ` AND status in ("Cerrado", "Done")`;
  } else {
    jql += " AND statusCategory = Done";
  }

  if (options.issueTypes?.length) {
    const types = options.issueTypes.map((t) => `"${t}"`).join(", ");
    jql += ` AND issuetype in (${types})`;
  }

  if (options.updatedSince) {
    const since = new Date(options.updatedSince);
    if (!Number.isNaN(since.getTime())) {
      const hours = Math.ceil((Date.now() - since.getTime()) / 3600000);
      const lookbackHours = Math.max(1, Math.min(hours, 24 * 14));
      jql += ` AND (updated >= -${lookbackHours}h OR resolutiondate >= -${lookbackHours}h)`;
    }
  } else if (options.initialDays) {
    jql += ` AND updated >= -${options.initialDays}d`;
  }

  const sistemaFilters = options.sistemaFilters ?? getSistemaFiltersFromEnv();
  const sistemaFieldId = options.sistemaFieldId ?? getSistemaFieldId();
  jql += buildSistemaJqlClause(sistemaFilters, sistemaFieldId, options.sistemaJqlValues);

  jql += " ORDER BY updated DESC";
  return jql;
}

async function fetchSistemaFieldOptions(config = getConfig()) {
  if (!isConfigured(config)) {
    throw new Error("Jira API no configurada: define JIRA_EMAIL y JIRA_API_TOKEN");
  }

  const fieldId = encodeURIComponent(getSistemaFieldId());
  const contextsPage = await jiraFetch(config, `/rest/api/3/field/${fieldId}/context?maxResults=50`);
  const values = [];

  for (const ctx of contextsPage.values || []) {
    let startAt = 0;
    let isLast = false;
    while (!isLast) {
      const page = await jiraFetch(
        config,
        `/rest/api/3/field/${fieldId}/context/${ctx.id}/option?startAt=${startAt}&maxResults=100`
      );
      for (const opt of page.values || []) {
        if (opt?.value) values.push(String(opt.value).trim());
      }
      isLast = page.isLast === true;
      startAt += (page.values || []).length;
      if (!(page.values || []).length) break;
    }
  }

  return [...new Set(values.filter(Boolean))];
}

async function jiraFetch(config, urlPath, { method = "GET", body } = {}) {
  const url = `${config.baseUrl}${urlPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeader(config),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jira API ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }

  return res.json();
}

async function searchIssuesPage(config, { jql, maxResults, nextPageToken }) {
  const body = {
    jql,
    maxResults: maxResults || config.pageSize,
    fields: getSearchFields(),
  };
  if (nextPageToken) body.nextPageToken = nextPageToken;

  return jiraFetch(config, "/rest/api/3/search/jql", { method: "POST", body });
}

async function searchAllIssues(options = {}) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error("Jira API no configurada: define JIRA_EMAIL y JIRA_API_TOKEN");
  }

  const jql = options.jql || buildSyncJql(options);
  const maxIssues = options.maxIssues ? Number(options.maxIssues) : Infinity;
  const pageSize = options.pageSize || config.pageSize;

  const issues = [];
  let nextPageToken = undefined;
  let isLast = false;

  while (!isLast && issues.length < maxIssues) {
    const page = await searchIssuesPage(config, {
      jql,
      maxResults: pageSize,
      nextPageToken,
    });
    const batch = page.issues || [];
    issues.push(...batch);
    isLast = page.isLast === true || !page.nextPageToken;
    nextPageToken = page.nextPageToken;
    if (!batch.length) break;
    if (typeof options.onPage === "function") {
      options.onPage({ fetched: issues.length, isLast, nextPageToken: nextPageToken || null });
    }
  }

  return { jql, issues: issues.slice(0, maxIssues), total: issues.length };
}

async function getIssue(key) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error("Jira API no configurada: define JIRA_EMAIL y JIRA_API_TOKEN");
  }

  const params = new URLSearchParams({ fields: getSearchFields().join(",") });
  return jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(key)}?${params.toString()}`);
}

async function testConnection() {
  const config = getConfig();
  if (!isConfigured(config)) {
    return { ok: false, error: "Faltan JIRA_EMAIL o JIRA_API_TOKEN" };
  }

  try {
    const myself = await jiraFetch(config, "/rest/api/3/myself");
    const jql = buildSyncJql({ initialDays: 7, issueTypes: ["[System] Incident"] });
    const sample = await searchIssuesPage(config, { jql, maxResults: 1 });
    return {
      ok: true,
      user: myself.displayName || myself.emailAddress,
      email: myself.emailAddress,
      baseUrl: config.baseUrl,
      project: config.project,
      sampleCount: (sample.issues || []).length,
      hasMore: !sample.isLast,
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

module.exports = {
  JIRA_FIELDS,
  DEFAULT_JIRA_FIELDS,
  getJiraFields,
  getSearchFields,
  getConfig,
  isConfigured,
  adfToText,
  fieldText,
  issueToImportRow,
  buildSyncJql,
  fetchSistemaFieldOptions,
  searchAllIssues,
  getIssue,
  testConnection,
};
