/**
 * Jira CSV → Dendron notes importer (shared by CLI and HTTP API).
 * Supports wide legacy exports and compact exports (Resumen + Descripción + Comentarios).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const matter = require("gray-matter");
const { readSatisfactionFromRow } = require("./satisfaction-fields");

const ROOT = path.resolve(__dirname, "..");

const DESCRIPCION_KEYS = [
  "Descripción",
  "descripcion",
  "Descripcion",
  "Description",
  "Campo personalizado (Descripción de la falla)",
  "Campo personalizado (Descripcion de la falla)",
];

const AREA_USUARIA_KEYS = [
  "Campo personalizado (País - Área Usuaria / CC)",
  "Área usuaria",
  "Area usuaria",
  "area usuaria",
  "Área Usuaria",
  "Campo personalizado (Área usuaria)",
  "Campo personalizado (Area usuaria)",
  "Campo personalizado (Área Usuaria)",
];

const CAUSA_KEYS = ["Campo personalizado (Causa)", "Causa", "Causa Raíz"];
const SOLUCION_KEYS = [
  "Campo personalizado (Solución)",
  "Campo personalizado (Solución aplicada)",
  "Solución",
  "Solucion",
];

const SISTEMA_KEYS = [
  "Campo personalizado (Sistema)",
  "Campo personalizado (Proyecto/Sistema)",
  "Campo personalizado (Sistema(s))",
  "Campo personalizado (Sistema en producción)",
  "Sistema",
];

const WEAK_ANALYST_RE =
  /^(caso atendido|atendido|n\/a|na|pendiente|sin informaci[oó]n|no aplica|ver comentarios?|ver descripci[oó]n|s\/d|s\.d\.?)$/i;

const AREA_RULES = [
  { re: /reclamo|siniestro|reserva|finiquito|indemniz|deducible/i, area: "Reclamos" },
  { re: /reporte|vts|dwh|publicaci[oó]n del reporte|adendo|detalle de veh/i, area: "Reportes / BI" },
  { re: /emisi[oó]n|p[oó]liza|endoso|renovaci|reactivaci/i, area: "Emisiones" },
  { re: /comprobante|contab|mayoriz/i, area: "Contabilidad" },
  { re: /reaseguro|distribuci[oó]n del %/i, area: "Reaseguro" },
  { re: /recuperaci[oó]n|salvamento|dep[oó]sito|cobranza/i, area: "Cobranza / Recuperaciones" },
  { re: /[oó]ptico|documento optico/i, area: "Operaciones / Óptico" },
  { re: /cotizador|cotizaci/i, area: "Cotizador" },
  { re: /garant[ií]a|estado de cuenta/i, area: "Garantías" },
  { re: /\bauto\b|veh[ií]culo|daños a terceros/i, area: "Auto" },
  { re: /\bvida\b|cvs|desempleo|gastos funerarios/i, area: "Vida" },
  { re: /solicitud de pago|reversi[oó]n/i, area: "Pagos" },
];

const AUTO_CLOSE_RE =
  /cerrado el ticket de forma autom[aá]tica|lleva mas de tres d[ií]as en finalizado/i;

const NOISE_TOKENS = new Set(
  [
    "image", "width", "height", "alt", "bgcolor", "color", "https", "http", "www", "png", "jpg", "jpeg",
    "docx", "pdf", "null", "true", "false", "listo", "cerrado", "apoyo", "cambio", "error", "start", "slgms",
    "buenos", "dias", "tardes", "favor", "saludos", "compart", "adjunt", "captura", "pantalla", "validar",
    "revision", "informo", "regalan", "comparto", "smart", "link", "accountid", "width", "height",
  ].map((t) => t.toLowerCase())
);

const SYSTEM_RULES = [
  { re: /\b[oó]ptico\b/i, sistema: "OPTICO", modulo: "Documentos" },
  { re: /\bsisnet\b/i, sistema: "SISNET", modulo: "Reclamos" },
  { re: /\bflujo\b/i, sistema: "FLUJO", modulo: "Integracion" },
  { re: /\bcotizador\b/i, sistema: "COTIZADOR", modulo: "Cotizacion" },
  { re: /\bseguronet\b/i, sistema: "SEGURONET", modulo: "General" },
  { re: /\baxxis\b/i, sistema: "AXXIS", modulo: "Integracion" },
  { re: /\breaseguro\b/i, sistema: "SISNET", modulo: "Reaseguro" },
  { re: /\bcomprobante\b/i, sistema: "SISNET", modulo: "Contabilidad" },
  { re: /\brecuperaci[oó]n\b/i, sistema: "SISNET", modulo: "Recuperaciones" },
  { re: /\bemisi[oó]n\b|\bp[oó]liza\b/i, sistema: "SISNET", modulo: "Emisiones" },
  { re: /\breserva\b|\bsiniestro\b|\breclamo\b/i, sistema: "SISNET", modulo: "Reclamos" },
];

function resolveNotesDir(customDir) {
  if (customDir) return path.resolve(customDir);
  if (process.env.DENDRON_NOTES_DIR) return path.resolve(process.env.DENDRON_NOTES_DIR);
  return path.join(ROOT, "notes");
}

function defaultCsvPath() {
  return path.join(ROOT, "historial_jira.csv");
}

function hashContent(text) {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

function normalizeKey(key) {
  return String(key || "").trim().toUpperCase();
}

function firstNonEmpty(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      const hit = value.map(String).map((v) => v.trim()).find(Boolean);
      if (hit) return hit;
    } else {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

function collectAll(row, keys) {
  const parts = [];
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = String(item || "").trim();
        if (text) parts.push(text);
      }
    } else {
      const text = String(value).trim();
      if (text) parts.push(text);
    }
  }
  return parts;
}

function stripLabel(text, labels) {
  let out = String(text || "").trim();
  for (const label of labels) {
    const re = new RegExp(`^\\s*\\*?\\*?${label}\\*?\\*?\\s*[:\\-]\\s*`, "i");
    out = out.replace(re, "");
  }
  return out.trim();
}

function cleanCausa(text) {
  return stripLabel(text, ["Causa Ra[ií]z", "Causa"]).replace(/^Causa:\s*/i, "").trim();
}

function cleanSolucion(text) {
  return stripLabel(text, ["Soluci[oó]n"]).replace(/^Soluci[oó]n:\s*/i, "").trim();
}

function slug(text, fallback = "general") {
  const base = String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^[.\-]+|[.\-]+$/g, "")
    .replace(/\.{2,}/g, ".");
  return base || fallback;
}

function ticketSlug(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function parseSistema(raw) {
  const text = String(raw || "").trim();
  if (!text) return { sistema: "", modulo: "", raw: "" };
  const parts = text.split(/[\/|]/).map((p) => p.trim()).filter(Boolean);
  return {
    sistema: parts[0] || text,
    modulo: parts[1] || parts[0] || "GENERAL",
    raw: text,
  };
}

function isWeakAnalystField(text) {
  const t = cleanJiraText(text);
  if (!t) return true;
  if (t.length < 12) return true;
  if (WEAK_ANALYST_RE.test(t)) return true;
  return false;
}

function resolveAnalystFields(row, comments, historico) {
  let causa = cleanCausa(firstNonEmpty(row, CAUSA_KEYS));
  let solucion = cleanSolucion(firstNonEmpty(row, SOLUCION_KEYS));
  const fromCsvCausa = !isWeakAnalystField(causa);
  const fromCsvSolucion = !isWeakAnalystField(solucion);

  const fromHist = extractFromHistorico(historico);
  const fromComments = extractFromComments(comments);
  const fromWiki = extractWikiSections(comments);

  if (!fromCsvCausa) {
    if (fromHist.causa && !isWeakAnalystField(fromHist.causa)) causa = fromHist.causa;
    else if (fromComments.causa && !isWeakAnalystField(fromComments.causa)) causa = fromComments.causa;
    else if (fromWiki.causa && !isWeakAnalystField(fromWiki.causa)) causa = fromWiki.causa;
  }

  if (!fromCsvSolucion) {
    if (fromHist.solucion && !isWeakAnalystField(fromHist.solucion)) solucion = fromHist.solucion;
    else if (fromComments.solucion && !isWeakAnalystField(fromComments.solucion)) solucion = fromComments.solucion;
    else if (fromWiki.solucion && !isWeakAnalystField(fromWiki.solucion)) solucion = fromWiki.solucion;
    else if (fromComments.cierre && scoreSolucion(fromComments.cierre) >= 5) solucion = fromComments.cierre;
  }

  return {
    causa,
    solucion,
    fromCsvCausa,
    fromCsvSolucion,
    fromComments,
  };
}

function inferAreaUsuaria(explicit, resumen, comments, informador) {
  const fromCsv = String(explicit || "").trim();
  if (fromCsv && fromCsv.length >= 3) return fromCsv;

  for (const rule of AREA_RULES) {
    if (rule.re.test(String(resumen || ""))) return rule.area;
  }

  const blob = [comments.join("\n"), informador].join("\n");
  for (const rule of AREA_RULES) {
    if (rule.re.test(blob)) return rule.area;
  }
  return informador ? "General" : "N/D";
}

function extractWikiSections(comments) {
  const blob = comments.map(commentBody).join("\n\n");
  let causa = "";
  let solucion = "";
  const solMatch = blob.match(
    /h2\.\s*[^\n]*soluci[oó]n[^\n]*\n([\s\S]*?)(?=h2\.|\n----|\Z)/i
  );
  const causaMatch = blob.match(
    /h2\.\s*[^\n]*(?:causa|problema)[^\n]*\n([\s\S]*?)(?=h2\.|\n----|\Z)/i
  );
  if (causaMatch) causa = cleanCausa(causaMatch[1]);
  if (solMatch) solucion = cleanSolucion(solMatch[1]);
  return { causa, solucion };
}

function inferSistemaModulo(resumen, ...rest) {
  for (const rule of SYSTEM_RULES) {
    if (rule.re.test(String(resumen || ""))) {
      return { sistema: rule.sistema, modulo: rule.modulo, raw: `${rule.sistema} / ${rule.modulo}` };
    }
  }
  const blob = [resumen, ...rest].join("\n");
  for (const rule of SYSTEM_RULES) {
    if (rule.re.test(blob)) {
      return { sistema: rule.sistema, modulo: rule.modulo, raw: `${rule.sistema} / ${rule.modulo}` };
    }
  }
  return { sistema: "SIN-SISTEMA", modulo: "GENERAL", raw: "SIN-SISTEMA" };
}

function cleanJiraText(text) {
  return String(text || "")
    .replace(/!\[[^\]]*\][^!\n]*/g, "")
    .replace(/![^!\n|]+(?:\|[^!]*)?!/g, "")
    .replace(/\[\~accountid:[^\]]+\]/gi, "")
    .replace(/\{\{([^}]+)\}\}/g, "$1")
    .replace(/\[\|[^\]]+\]/g, "")
    .replace(/\[https?:\/\/[^\]|]+\|[^\]]+\]/gi, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function commentBody(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parts = text.split(";");
  if (parts.length >= 3 && /\d{1,2}\/[a-z]{3}\/\d{2}/i.test(parts[0])) {
    return cleanJiraText(parts.slice(2).join(";"));
  }
  return cleanJiraText(text);
}

function scoreCausa(text) {
  if (!text || text.length < 20 || AUTO_CLOSE_RE.test(text)) return 0;
  let score = 0;
  if (/se identific[oó]|se debe a|particularidad|inconveniente|causa ra[ií]z|no es un error|impide el registro|no permite|bloqueo en el proceso/i.test(text)) score += 8;
  if (/valida|observa|revisando|error de distribuci[oó]n|montosumaaseg|decimales/i.test(text)) score += 4;
  if (/favor su apoyo|buenos d[ií]as|me regalan|tienes el curl|seguimos validando/i.test(text)) score -= 5;
  return score + Math.min(text.length / 80, 5);
}

function scoreSolucion(text) {
  if (!text || text.length < 15 || AUTO_CLOSE_RE.test(text)) return 0;
  let score = 0;
  if (/exitoso|resultados fueron exitosos|ya puede validar|listo|se hizo insert|proceder como|publicado en produccion|correcci[oó]n manual|eliminar la configuraci[oó]n|actualizaci[oó]n los resultados|qued[oó] resuelto|se procedi[oó] a|correcci[oó]n aplicada/i.test(text)) score += 10;
  if (/se realiza pruebas|genera n[uú]mero de comprobante|se logra generar|validar en produccion|validar en soporte|workaround|pasos|insert en|publicaci[oó]n del reporte|ya no se presenta/i.test(text)) score += 6;
  if (/se crea jira|escala|integraci[oó]n/i.test(text)) score += 4;
  if (/favor su apoyo|me regalan|tienes el curl|seguimos validando/i.test(text)) score -= 6;
  if (/buenos d[ií]as|buenas tardes/i.test(text) && !/exitoso|resultados fueron|ya puede validar|validar en produccion/i.test(text)) score -= 2;
  return score + Math.min(text.length / 60, 4);
}

function scoreCierre(text) {
  if (!text || AUTO_CLOSE_RE.test(text)) return 0;
  let score = scoreSolucion(text);
  if (/prueba|valid|confirm|cerrad|resuel/i.test(text)) score += 3;
  return score;
}

function extractFromHistorico(historico) {
  const causaMatch = historico.match(/Causa:\s*([\s\S]*?)(?:\n\s*Soluci[oó]n:|\n----|\Z)/i);
  const solMatch = historico.match(/Soluci[oó]n:\s*([\s\S]*?)(?:\n----|\nFecha:|\Z)/i);
  return {
    causa: cleanCausa(causaMatch ? causaMatch[1] : ""),
    solucion: cleanSolucion(solMatch ? solMatch[1] : ""),
  };
}

function extractFromComments(comments) {
  let causa = "";
  let solucion = "";
  let cierre = "";
  let causaScore = 0;
  let solScore = 0;
  let cierreScore = 0;

  for (const raw of comments) {
    const body = commentBody(raw);
    if (!body || body.length < 12) continue;

    const labeledC = body.match(/\*?Causa\*?\s*[:\-]\s*([\s\S]*?)(?=\*?Soluci[oó]n\*?\s*[:\-]|\*?Pruebas\*?\s*[:\-]|$)/i);
    const labeledS = body.match(/\*?Soluci[oó]n\*?\s*[:\-]\s*([\s\S]*?)(?=\*?Pruebas\*?\s*[:\-]|\*?Publicaci[oó]n\*?\s*[:\-]|$)/i);
    if (labeledC && labeledC[1].trim().length > causa.length) causa = cleanCausa(labeledC[1]);
    if (labeledS && labeledS[1].trim().length > solucion.length) solucion = cleanSolucion(labeledS[1]);

    const cs = scoreCausa(body);
    if (cs > causaScore) {
      causaScore = cs;
      if (cs >= 4) causa = cleanCausa(body);
    }

    const ss = scoreSolucion(body);
    if (ss > solScore) {
      solScore = ss;
      if (ss >= 4) solucion = cleanSolucion(body);
    }

    const cls = scoreCierre(body);
    if (cls > cierreScore) {
      cierreScore = cls;
      cierre = body;
    }
  }

  return { causa, solucion, cierre };
}

function firstReportComment(comments) {
  for (const raw of comments) {
    const body = commentBody(raw);
    if (body.length >= 40 && !AUTO_CLOSE_RE.test(body) && !/^favor su apoyo/i.test(body)) {
      return body;
    }
  }
  return "";
}

function extractSearchTokens(...texts) {
  const blob = texts.join("\n");
  const tokens = [];

  const push = (t) => {
    const hit = String(t || "").trim();
    if (!hit) return;
    tokens.push(hit);
  };

  for (const m of blob.matchAll(/\b(SLGMS-\d+|SLNI-\d+)\b/gi)) push(m[1].toUpperCase());
  for (const m of blob.matchAll(/\b(ORA-\d{5})\b/gi)) push(m[1].toUpperCase());
  for (const m of blob.matchAll(/\b(SISNET|CORE|REASEGUROS|EMISIONES|OPTICO|FLUJO)\b/gi)) push(m[1].toUpperCase());
  for (const m of blob.matchAll(/\b(?:siniestro|reclamo|caso)\s*[#:]?\s*(\d{4,7})\b/gi)) {
    push(`SINIESTRO_${m[1]}`);
    push(m[1]);
  }
  for (const m of blob.matchAll(/\b([A-Z]{2,5}-\d{5,}-\d+(?:-\d+)?)\b/g)) push(m[1]);
  for (const m of blob.matchAll(/\b(?:p[oó]liza|poliza)\s*[#:]?\s*([A-Z0-9-]{8,})\b/gi)) push(m[1]);
  for (const m of blob.matchAll(/\bramo\s*[:#]?\s*(\d{2,4})\b/gi)) {
    push(`RAMO_${m[1]}`);
    push(m[1]);
  }
  for (const m of blob.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)) push(m[1]);
  for (const m of blob.matchAll(/\b([a-z][a-z0-9_]{3,40})\b/gi)) {
    const w = m[1];
    if (/^(tipo_|montosuma|comprobante|reaseguro|reserva|cobertura|recuperaci)/i.test(w)) push(w);
  }
  for (const m of blob.matchAll(/\b(comprobante|reaseguro|reserva|recuperaci[oó]n|endoso|cobertura|deducible|salvamento|distribuci[oó]n)\b/gi)) {
    push(m[1].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  }
  for (const m of blob.matchAll(/(?:"([^"]{3,80})"|'([^']{3,80})'|`([^`]{3,80})`)/g)) {
    push(m[1] || m[2] || m[3]);
  }
  for (const m of blob.matchAll(/\b([A-Za-z][A-Za-z0-9_]*(?:VSM|Reporte|Maestra|PDF)[A-Za-z0-9_]*)\b/g)) push(m[1]);
  for (const m of blob.matchAll(/\boferta\s*[:#]?\s*(\d{5,})\b/gi)) push(`OFERTA_${m[1]}`);

  return unique(
    tokens
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter((t) => {
        if (t.length < 3 || t.length > 60) return false;
        if (/\s/.test(t) && !/^SINIESTRO_/.test(t)) return false;
        if (/^image[-_]/i.test(t) || /\.(png|jpg|jpeg|gif|docx?|xlsx)$/i.test(t)) return false;
        if (NOISE_TOKENS.has(t.toLowerCase())) return false;
        if (/^\d+$/.test(t) && t.length < 4) return false;
        return true;
      })
  ).slice(0, 25);
}

function yamlEscape(text) {
  return String(text || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim();
}

function toIsoDate(jiraDate) {
  if (!jiraDate) return new Date().toISOString().slice(0, 10);
  const months = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
  const m = String(jiraDate).match(/(\d{1,2})\/([a-z]{3})\/(\d{2,4})/i);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = months[m[2].toLowerCase()] || "01";
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  const iso = String(jiraDate).match(/(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : new Date().toISOString().slice(0, 10);
}

/** Full ISO timestamp for sort order (preserves hora de cierre/actualización Jira). */
function toSortTimestamp(jiraDate) {
  if (!jiraDate) return new Date().toISOString();
  const d = new Date(jiraDate);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const day = toIsoDate(jiraDate);
  return `${day}T12:00:00.000Z`;
}

function latestTimestamp(...values) {
  let best = "";
  let bestMs = 0;
  for (const value of values) {
    if (!value) continue;
    const iso = toSortTimestamp(value);
    const ms = new Date(iso).getTime();
    if (ms >= bestMs) {
      bestMs = ms;
      best = iso;
    }
  }
  return best || new Date().toISOString();
}

function readSyncSource(filePath) {
  try {
    const { data } = matter(fs.readFileSync(filePath, "utf8"));
    return String(data.jira_sync_source || "").toLowerCase();
  } catch {
    return "";
  }
}

function buildNote(row, options = {}) {
  const key = firstNonEmpty(row, ["Clave de incidencia"]);
  if (!key) return null;
  const syncSource = options.syncSource ? String(options.syncSource).toLowerCase() : "";

  const resumen = firstNonEmpty(row, ["Resumen"]) || key;
  const estado = firstNonEmpty(row, ["Estado"]);
  const tipo = firstNonEmpty(row, ["Tipo de Incidencia"]);
  const informador = firstNonEmpty(row, ["Informador"]);
  const assignee = firstNonEmpty(row, ["Persona asignada"]);
  const prioridad = firstNonEmpty(row, ["Prioridad"]);
  const resolucion = firstNonEmpty(row, ["Resolución", "Resolucion"]);
  const areaUsuariaRaw = firstNonEmpty(row, AREA_USUARIA_KEYS);
  const descripcion = firstNonEmpty(row, DESCRIPCION_KEYS);
  const historico = firstNonEmpty(row, ["Campo personalizado (Histórico de causa y solución)"]);
  const reporting = collectAll(row, ["Campo personalizado (Reporting Services)"]).join(", ");
  const comments = collectAll(row, ["Comentario", "Comentarios"]);

  const analyst = resolveAnalystFields(row, comments, historico);
  let causa = analyst.causa;
  let solucion = analyst.solucion;
  const { fromComments } = analyst;

  const descripcionFinal = descripcion || resumen;

  if (isWeakAnalystField(causa)) {
    const symptom = cleanJiraText(descripcionFinal);
    if (symptom.length >= 20) causa = symptom.slice(0, 1200);
    else {
      const alt = cleanJiraText(resumen);
      if (alt.length >= 15) causa = alt;
    }
  }
  if (isWeakAnalystField(causa)) causa = "Sin causa documentada en Jira.";
  if (isWeakAnalystField(solucion)) solucion = "Sin solución documentada en Jira.";

  const areaUsuaria = inferAreaUsuaria(areaUsuariaRaw, resumen, comments, informador);

  const sistemaRaw = firstNonEmpty(row, SISTEMA_KEYS);

  let sistemaInfo = parseSistema(sistemaRaw);
  if (!sistemaRaw) {
    sistemaInfo = inferSistemaModulo(resumen, descripcionFinal, comments.join("\n"), causa, solucion);
  }

  const { sistema, modulo, raw: sistemaFull } = sistemaInfo;
  const tokens = extractSearchTokens(
    resumen,
    descripcionFinal,
    causa,
    solucion,
    reporting,
    historico,
    comments.join("\n"),
    areaUsuaria,
    informador
  );
  if (areaUsuaria && areaUsuaria !== "N/D") tokens.unshift(slug(areaUsuaria, "area").replace(/\./g, "_").toUpperCase());
  const reportes = tokens.filter((t) => /reporte|vsm|maestra|pdf|endoso|documento|tipo_/i.test(t));
  const reporte = reportes[0] || tokens.find((t) => /^[A-Za-z][A-Za-z0-9_]{4,}$/.test(t)) || "";
  const ramoMatch = `${resumen}\n${descripcionFinal}\n${comments.join("\n")}`.match(/\bramo\s*[:#]?\s*(\d{2,4})\b/i);
  const tablas = unique(
    [...(`${descripcionFinal}\n${causa}\n${solucion}`.match(/\b(?:FROM|INTO|UPDATE|TABLE|tabla)\s+([A-Za-z0-9_\.]+)/gi) || [])].map((x) =>
      x.replace(/^(FROM|INTO|UPDATE|TABLE|tabla)\s+/i, "")
    )
  );
  for (const m of `${descripcionFinal}\n${comments.join("\n")}`.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)) {
    tablas.push(m[1]);
  }

  const resolvedRaw = firstNonEmpty(row, ["Resuelta"]);
  const updatedRaw = firstNonEmpty(row, ["Actualizada", "Creada"]);
  const jiraUpdatedAt = latestTimestamp(updatedRaw, resolvedRaw);
  const updated = toIsoDate(jiraUpdatedAt);
  const tags = unique([
    "hd",
    "jira",
    slug(sistema, "sisnet").split(".")[0],
    slug(modulo, "general").split(".")[0],
    ...tokens.slice(0, 10).map((t) => slug(t).split(".")[0]).filter((t) => t.length >= 3 && t.length <= 24),
  ]).slice(0, 14);

  const causaOut = cleanJiraText(causa);
  const solucionOut = cleanJiraText(solucion);
  const descripcionOut = cleanJiraText(descripcionFinal);
  const cierreRaw = [
    `Ticket ${key} (${estado || "N/D"}).`,
    areaUsuaria && areaUsuaria !== "N/D" ? `Área usuaria: ${areaUsuaria}.` : "",
    causaOut ? `Causa: ${causaOut}` : "",
    solucionOut ? `Solución: ${solucionOut}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const cierre = cleanJiraText(cierreRaw);

  const satisfaction = readSatisfactionFromRow(row);
  const satisfactionYaml = satisfaction
    ? `jira_satisfaction_rating: ${satisfaction.rating}
jira_satisfaction_comment: "${yamlEscape(satisfaction.comment)}"
jira_satisfaction_at: "${yamlEscape(satisfaction.createdAt)}"
`
    : "";
  const satisfactionBody = satisfaction
    ? `**Satisfacción:** ${satisfaction.rating}/5\n`
    : "";

  const fileName = `hd.${slug(sistema)}.${slug(modulo)}.${ticketSlug(key)}.md`;
  const title = `${key} — ${resumen}`.slice(0, 160);
  const body = `---
id: ${key.toLowerCase()}
title: "${yamlEscape(title)}"
desc: "${yamlEscape(resumen)}"
updated: "${updated}"
jira_updated_at: "${jiraUpdatedAt}"
tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]
${syncSource ? `jira_sync_source: ${syncSource}\n` : ""}jira_key: ${key}
jira_status: "${yamlEscape(estado)}"
jira_type: "${yamlEscape(tipo)}"
jira_informador: "${yamlEscape(informador)}"
jira_area_usuaria: "${yamlEscape(areaUsuaria)}"
jira_assignee: "${yamlEscape(assignee)}"
jira_prioridad: "${yamlEscape(prioridad)}"
jira_resolucion: "${yamlEscape(resolucion)}"
${satisfactionYaml}---

**Sistema:** ${sistemaFull || sistema}
**Módulo:** ${modulo}
**Área usuaria:** ${areaUsuaria}
**Informador:** ${informador || "N/D"}
**Asignado a:** ${assignee || "N/D"}
${satisfactionBody}**Reporte:** ${reporte || "N/D"}
**Tabla:** ${unique(tablas)[0] || "N/D"}
**Ramo:** ${ramoMatch ? ramoMatch[1] : "N/D"}
**Etiquetas:** ${tags.filter((t) => !["hd", "jira"].includes(t)).slice(0, 12).join(", ") || "N/D"}

**Causa Raíz:**
${causaOut}

**Solución:**
${solucionOut}

## Descripción original
${descripcionOut || "_Sin descripción._"}

${reporting ? `## Reporting Services\n${reporting}\n` : ""}
## ✅ Cierre de HD
${cierre}
`;

  return { fileName, key: normalizeKey(key), body, tokens, hash: hashContent(body) };
}

function extractKeyFromFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data } = matter(raw);
    const key = data.jira_key || data.id || "";
    if (key) return normalizeKey(key);
  } catch {
    /* ignore */
  }
  const base = path.basename(filePath, ".md");
  const m = base.match(/(slgms[-.]?\d+)/i);
  return m ? normalizeKey(m[1].replace(".", "-")) : "";
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
      else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) acc.push(full);
    }
  }
  return acc;
}

function buildExistingIndex(notesDir) {
  const index = new Map();
  const scanRoots = [path.join(notesDir, "jira"), notesDir];
  const seenPaths = new Set();

  for (const root of scanRoots) {
    for (const filePath of walkMdFiles(root)) {
      if (seenPaths.has(filePath)) continue;
      seenPaths.add(filePath);
      const key = extractKeyFromFile(filePath);
      if (!key || key === "JIRA-IMPORT-INDEX") continue;
      let hash = "";
      try {
        hash = hashContent(fs.readFileSync(filePath, "utf8"));
      } catch {
        /* ignore */
      }
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ path: filePath, hash });
    }
  }
  return index;
}

function collectColumnIndices(headers, matcher) {
  return headers.map((h, i) => (matcher(String(h).trim()) ? i : -1)).filter((i) => i >= 0);
}

function enrichRowFromMatrix(row, raw, headers) {
  const commentIdx = collectColumnIndices(headers, (h) => /^Comentarios?$/i.test(h));
  const descripcionIdx = collectColumnIndices(
    headers,
    (h) => /^descripci[oó]n$/i.test(h) || /^description$/i.test(h) || /descripci[oó]n de la falla/i.test(h)
  );
  const areaIdx = collectColumnIndices(
    headers,
    (h) =>
      /^[aá]rea usuaria$/i.test(h) ||
      /[aá]rea usuaria/i.test(h) ||
      /pa[ií]s.*[aá]rea/i.test(h)
  );
  const sistemaIdx = collectColumnIndices(headers, (h) => /Campo personalizado \(Sistema/i.test(h) || /^Sistema$/i.test(h));
  const causaIdx = collectColumnIndices(headers, (h) => /Campo personalizado \(Causa\)/i.test(h));
  const solucionIdx = collectColumnIndices(headers, (h) => /Campo personalizado \(Soluci[oó]n\)/i.test(h));

  row.Comentario = commentIdx.map((idx) => raw[idx]).filter(Boolean);
  row.Comentarios = row.Comentario;

  if (!firstNonEmpty(row, DESCRIPCION_KEYS) && descripcionIdx.length) {
    for (const idx of descripcionIdx) {
      if (raw[idx] && String(raw[idx]).trim()) {
        row["Descripción"] = String(raw[idx]).trim();
        break;
      }
    }
  }

  if (!firstNonEmpty(row, AREA_USUARIA_KEYS) && areaIdx.length) {
    for (const idx of areaIdx) {
      if (raw[idx] && String(raw[idx]).trim()) {
        row["Campo personalizado (País - Área Usuaria / CC)"] = String(raw[idx]).trim();
        break;
      }
    }
  }

  if (!firstNonEmpty(row, CAUSA_KEYS) && causaIdx.length) {
    for (const idx of causaIdx) {
      if (raw[idx] && String(raw[idx]).trim()) {
        row["Campo personalizado (Causa)"] = String(raw[idx]).trim();
        break;
      }
    }
  }

  if (!firstNonEmpty(row, SOLUCION_KEYS) && solucionIdx.length) {
    for (const idx of solucionIdx) {
      if (raw[idx] && String(raw[idx]).trim()) {
        row["Campo personalizado (Solución)"] = String(raw[idx]).trim();
        break;
      }
    }
  }

  if (!firstNonEmpty(row, SISTEMA_KEYS)) {
    for (const idx of sistemaIdx) {
      if (raw[idx] && String(raw[idx]).trim()) {
        row["Campo personalizado (Sistema)"] = String(raw[idx]).trim();
        break;
      }
    }
  }
}

function csvExists(csvPath = defaultCsvPath()) {
  return fs.existsSync(csvPath);
}

function importJiraRows(rows, options = {}) {
  const notesDir = resolveNotesDir(options.notesDir);
  const outDir = path.join(notesDir, "jira");
  const removeOrphans = options.removeOrphans === true;
  const sourceLabel = options.sourceLabel || "historial_jira.csv";
  const syncSource =
    options.syncSource ||
    (String(sourceLabel).toLowerCase().includes("api") ? "api" : "csv");

  fs.mkdirSync(outDir, { recursive: true });

  const existingIndex = buildExistingIndex(notesDir);
  const seen = new Set();
  const canonicalPaths = new Map();

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  let skippedApiProtected = 0;
  let duplicatesRemoved = 0;
  let orphansRemoved = 0;
  let withCsvCausa = 0;
  let withCsvSolucion = 0;
  let withCsvArea = 0;
  let withCsvSistema = 0;
  let withDescripcion = 0;
  const tokenFreq = new Map();

  for (const row of rows) {
    if (!isWeakAnalystField(firstNonEmpty(row, CAUSA_KEYS))) withCsvCausa += 1;
    if (!isWeakAnalystField(firstNonEmpty(row, SOLUCION_KEYS))) withCsvSolucion += 1;
    if (firstNonEmpty(row, AREA_USUARIA_KEYS)) withCsvArea += 1;
    if (firstNonEmpty(row, SISTEMA_KEYS)) withCsvSistema += 1;
    if (firstNonEmpty(row, DESCRIPCION_KEYS)) withDescripcion += 1;

    const note = buildNote(row, { syncSource });
    if (!note) {
      skippedInvalid += 1;
      continue;
    }
    if (seen.has(note.key)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(note.key);

    const targetPath = path.join(outDir, note.fileName);
    canonicalPaths.set(note.key, targetPath);

    const existing = existingIndex.get(note.key) || [];
    const existingAtTarget = existing.find((e) => path.resolve(e.path) === path.resolve(targetPath));

    if (
      syncSource === "csv" &&
      (fs.existsSync(targetPath) || existingAtTarget) &&
      readSyncSource(existingAtTarget?.path || targetPath) === "api"
    ) {
      skippedApiProtected += 1;
      continue;
    }

    if (existingAtTarget && existingAtTarget.hash === note.hash) {
      unchanged += 1;
    } else if (existing.length > 0 || fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, note.body, "utf8");
      updated += 1;
    } else {
      fs.writeFileSync(targetPath, note.body, "utf8");
      created += 1;
    }

    for (const token of note.tokens) {
      tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1);
    }
  }

  for (const [key, entries] of existingIndex.entries()) {
    const keep = canonicalPaths.get(key);
    if (!keep) continue;
    for (const entry of entries) {
      if (path.resolve(entry.path) !== path.resolve(keep) && fs.existsSync(entry.path)) {
        try {
          fs.unlinkSync(entry.path);
          duplicatesRemoved += 1;
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (removeOrphans) {
    for (const filePath of walkMdFiles(outDir)) {
      const base = path.basename(filePath);
      if (base === "hd.jarvis.import.indice.md") continue;
      const key = extractKeyFromFile(filePath);
      if (key && !seen.has(key)) {
        try {
          fs.unlinkSync(filePath);
          orphansRemoved += 1;
        } catch {
          /* ignore */
        }
      }
    }
  }

  const topTokens = [...tokenFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const indexBody = `---
id: jira-import-index
title: "Índice de importación Jira — tokens de búsqueda"
updated: ${new Date().toISOString().slice(0, 10)}
tags: ["hd", "jira", "indice", "busqueda"]
---

**Sistema:** JARVIS
**Módulo:** Import

**Causa Raíz:**
Índice generado automáticamente desde ${sourceLabel}.

**Solución:**
Usar los tokens abajo en el buscador JARVIS.

## Tokens frecuentes
${topTokens.map(([t, n]) => `- \`${t}\` (${n})`).join("\n")}

## ✅ Cierre de HD
Import: ${created} creadas, ${updated} actualizadas, ${unchanged} sin cambios. Campos Jira: causa ${withCsvCausa}, solución ${withCsvSolucion}, área ${withCsvArea}, sistema ${withCsvSistema}, descripción ${withDescripcion}. Fuente: ${sourceLabel}.
`;
  fs.writeFileSync(path.join(outDir, "hd.jarvis.import.indice.md"), indexBody, "utf8");

  return {
    ok: true,
    notesDir,
    outDir,
    totalInSource: rows.length,
    processed: seen.size,
    created,
    updated,
    unchanged,
    skippedCsvDuplicate: skippedDuplicate,
    skippedInvalid,
    skippedApiProtected,
    duplicatesRemoved,
    orphansRemoved,
    syncSource,
    withCsvCausa,
    withCsvSolucion,
    withCsvArea,
    withCsvSistema,
    withDescripcion,
    topTokens: topTokens.slice(0, 15),
  };
}

function importJiraCsv(options = {}) {
  const csvPath = path.resolve(options.csvPath || defaultCsvPath());
  const notesDir = resolveNotesDir(options.notesDir);
  const outDir = path.join(notesDir, "jira");
  const removeOrphans = options.removeOrphans === true;
  const syncSource = options.syncSource || "csv";

  if (!fs.existsSync(csvPath)) {
    return {
      ok: false,
      error: `CSV no encontrado: ${csvPath}`,
      csvPath,
      notesDir,
      outDir,
    };
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parse(text, {
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    cast: false,
  });

  const matrix = parse(text, { columns: false, relax_column_count: true, skip_empty_lines: true, bom: true, relax_quotes: true });
  const headers = matrix[0] || [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const raw = matrix[i + 1] || [];
    enrichRowFromMatrix(row, raw, headers);
  }

  const result = importJiraRows(rows, {
    notesDir,
    removeOrphans,
    syncSource,
    sourceLabel: path.basename(csvPath),
  });

  return {
    ...result,
    csvPath,
    totalInCsv: rows.length,
  };
}

module.exports = {
  importJiraCsv,
  importJiraRows,
  buildNote,
  parseSistema,
  csvExists,
  defaultCsvPath,
  resolveNotesDir,
};
