/**
 * Insights & Prevención — deterministic improvement proposals per cluster.
 *
 * Each rule inspects the cluster's signature, causa/solución text and metrics,
 * and emits an explainable preventive action. No LLM: rules are transparent
 * and can be tuned by the team.
 */

const ORA_MISSING_RE = /\bora-?00942\b|\bora-?00904\b/i;
const ORA_UNIQUE_RE = /\bora-?00001\b/i;
const PERF_RE = /timeout|time-?out|lento|lentitud|tarda|demora|performance|rendimiento|colgad/i;
const MANUAL_STEPS_RE = /\b(paso\s*\d|manualmente|manual\b|\d+\.\s)/i;
const OPERATIONAL_RE =
  /publicaci[oó]n|ejecuci[oó]n|accesos?\b|creaci[oó]n|desbloqueo|habilit|reseteo|contrase|alta de|baja de/i;
const GENERIC_REPORTE_RE = /^(sisnet|core|n\/?d|reportes?|sistema|m[oó]dulo)$/i;

function haystack(cluster) {
  return [
    cluster.signature,
    cluster.common_causa,
    cluster.common_solucion,
    ...(cluster.top_tokens || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function recommendActions(cluster) {
  const text = haystack(cluster);
  const actions = [];

  if (OPERATIONAL_RE.test(text)) {
    actions.push({
      regla: "tramite-operativo",
      accion:
        "Evaluar self-service o automatización del trámite repetitivo (formulario de solicitud, ejecución programada o permisos delegados) para sacarlo de la cola de soporte.",
      evidencia: "Los tickets repiten el mismo trámite operativo (publicación / ejecución / altas / accesos).",
    });
  }

  if (ORA_MISSING_RE.test(text)) {
    actions.push({
      regla: "objeto-o-permiso-faltante",
      accion:
        "Validar existencia del objeto y permisos del usuario de aplicación en cada ambiente; agregar verificación al checklist de despliegue.",
      evidencia: "Firma/causa menciona ORA-00942/ORA-00904 (tabla o columna inexistente).",
    });
  }

  if (ORA_UNIQUE_RE.test(text)) {
    actions.push({
      regla: "violacion-unique",
      accion:
        "Revisar secuencia o constraint único involucrado; entregar script de corrección de datos y ajustar la lógica de inserción.",
      evidencia: "Firma/causa menciona ORA-00001 (restricción única violada).",
    });
  }

  if (PERF_RE.test(text) || (cluster.sql_hits || []).length >= 2) {
    actions.push({
      regla: "performance",
      accion:
        "Revisar plan de ejecución de las consultas frecuentes del clúster; evaluar índices o reescritura del SP/reporte afectado.",
      evidencia: "Causa/solución menciona demoras o hay SQL recurrente en los tickets.",
    });
  }

  if (
    cluster.reportes?.length >= 1 &&
    cluster.reportes.length <= 2 &&
    cluster.ticket_count >= 4 &&
    !GENERIC_REPORTE_RE.test(String(cluster.reportes[0]).trim())
  ) {
    actions.push({
      regla: "reporte-recurrente",
      accion: `Elevar a desarrollo el reporte/módulo "${cluster.reportes[0]}" como candidato a refactor o validación de parámetros de entrada.`,
      evidencia: `${cluster.ticket_count} tickets concentrados en el mismo reporte/módulo.`,
    });
  }

  if (cluster.informadores?.length >= 1 && cluster.informadores.length <= 2 && cluster.ticket_count >= 4) {
    actions.push({
      regla: "patron-de-uso",
      accion:
        "Coordinar capacitación o guía rápida para los usuarios que más reportan este patrón; evaluar validación en frontend que prevenga el error.",
      evidencia: `Patrón concentrado en ${cluster.informadores.length} informador(es) (${cluster.informadores.join(", ")}).`,
    });
  }

  if (cluster.low_csat_risk || (cluster.low_csat_count || 0) >= 2) {
    actions.push({
      regla: "csat-bajo",
      accion:
        "Priorizar atención con desarrollo y comunicar plan de acción a los usuarios afectados; la recurrencia está afectando la satisfacción.",
      evidencia: `${cluster.low_csat_count} ticket(s) con CSAT ≤ 3` +
        (cluster.avg_csat != null ? ` (promedio ${cluster.avg_csat}/5).` : "."),
    });
  }

  if (
    MANUAL_STEPS_RE.test(String(cluster.common_solucion || "")) ||
    (cluster.sql_hits || []).length >= 1
  ) {
    actions.push({
      regla: "automatizacion",
      accion:
        "Convertir la solución manual recurrente en un script automatizado o validador ejecutable por soporte sin intervención de desarrollo.",
      evidencia: "La solución documentada incluye pasos manuales o SQL repetido entre tickets.",
    });
  }

  if (!actions.length) {
    actions.push({
      regla: "revision-general",
      accion:
        "Revisar los tickets de referencia con el equipo de desarrollo para definir acción preventiva; el patrón supera el umbral de recurrencia.",
      evidencia: "Clúster recurrente sin regla específica disparada.",
    });
  }

  return actions;
}

function buildImprovementProposal(cluster) {
  const acciones = recommendActions(cluster);
  return {
    problema: `Recurrencia de ${cluster.signature} en ${cluster.sistema} (${cluster.ticket_count} casos)`,
    volumen_impacto: {
      tickets: cluster.ticket_count,
      areas: cluster.areas,
      informadores: cluster.informadores,
      primera: cluster.first_seen,
      ultima: cluster.last_seen,
      avg_csat: cluster.avg_csat,
      low_csat_count: cluster.low_csat_count,
    },
    causa_probable: cluster.common_causa || "Sin causa documentada en las notas del clúster.",
    solucion_frecuente: cluster.common_solucion || "",
    acciones_preventivas: acciones,
    tickets_referencia: (cluster.tickets || []).slice(0, 12),
    despliegues_relacionados: cluster.deployment_refs || [],
  };
}

function mdEscape(text) {
  return String(text || "").replace(/\r?\n/g, " ").trim();
}

function periodLabel(days) {
  if (days === 30) return "últimos 30 días";
  if (days === 90) return "últimos 90 días";
  return "histórico completo";
}

function buildClusterMarkdown(cluster, proposal) {
  const lines = [];
  lines.push(`## ${cluster.rank}. ${cluster.signature} — ${cluster.sistema}`);
  lines.push("");
  lines.push(`**Problema:** ${proposal.problema}`);
  lines.push("");
  const v = proposal.volumen_impacto;
  const csatPart =
    v.avg_csat != null ? ` · CSAT promedio ${v.avg_csat}/5 (${v.low_csat_count} ≤ 3)` : "";
  lines.push(
    `**Volumen e impacto:** ${v.tickets} tickets · ${v.areas.length} área(s) (${v.areas.join(", ") || "N/D"}) · ${v.informadores.length} informador(es) · ${v.primera} → ${v.ultima}${csatPart}`
  );
  lines.push("");
  lines.push(`**Causa probable:** ${mdEscape(proposal.causa_probable)}`);
  lines.push("");
  lines.push("**Acciones preventivas recomendadas:**");
  for (const a of proposal.acciones_preventivas) {
    lines.push(`- ${a.accion} _(${a.evidencia})_`);
  }
  lines.push("");
  lines.push("**Tickets de referencia:**");
  for (const t of proposal.tickets_referencia) {
    const link = t.url ? `[${t.key}](${t.url})` : t.key;
    const csat = t.csat != null ? ` · CSAT ${t.csat}/5` : "";
    const cleanTitle = mdEscape(t.title).replace(/^[A-Z][A-Z0-9]*-\d+\s*—?\s*/, "");
    lines.push(`- ${link} — ${cleanTitle} (${t.updated || "s/f"}${csat})`);
  }
  lines.push("");
  if ((proposal.despliegues_relacionados || []).length) {
    lines.push("**Tickets relacionados (despliegue/trámite excluido):**");
    for (const d of proposal.despliegues_relacionados) {
      const link = d.url ? `[${d.key}](${d.url})` : d.key;
      const cleanTitle = mdEscape(d.title).replace(/^[A-Z][A-Z0-9]*-\d+\s*—?\s*/, "");
      lines.push(`- ${link} — ${cleanTitle} (${d.updated || "s/f"}) · ref. ${d.referenced_ticket}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildInsightsMarkdown(clusters, meta = {}) {
  const days = meta.days ?? 0;
  const lines = [];
  lines.push("# JARVIS — Insights & Prevención");
  lines.push("");
  lines.push(`- Generado: ${meta.generated_at || new Date().toISOString()}`);
  lines.push(`- Periodo: ${periodLabel(days)}`);
  if (meta.sistema) lines.push(`- Sistema: ${meta.sistema}`);
  if (meta.notes_in_period != null) {
    lines.push(`- Notas analizadas: ${meta.notes_in_period} de ${meta.total_notes ?? "?"}`);
  }
  if (meta.deployment_notes_excluded != null) {
    lines.push(`- Tickets de despliegue/trámite administrativo excluidos del análisis: ${meta.deployment_notes_excluded}`);
  }
  lines.push(`- Clústeres detectados: ${clusters.length}`);
  lines.push("");
  lines.push(
    "Ranking por score combinado (55% frecuencia, 30% impacto, 15% riesgo CSAT). " +
      "Impacto considera cantidad de tickets, áreas afectadas e informadores distintos."
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const cluster of clusters) {
    const proposal = cluster.proposal || buildImprovementProposal(cluster);
    lines.push(buildClusterMarkdown(cluster, proposal));
  }
  return lines.join("\n");
}

module.exports = {
  recommendActions,
  buildImprovementProposal,
  buildInsightsMarkdown,
};
