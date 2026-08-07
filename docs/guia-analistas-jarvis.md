# JARVIS — Guía de instalación y uso para analistas

**LAFISE · Motor de búsqueda de soluciones Jira (SLGMS)**  
Versión JARVIS: **1.5.0** · Puerto por defecto: `8000`

---

## 1. ¿Qué es JARVIS?

JARVIS indexa tickets **cerrados** del proyecto Jira **SLGMS** y te permite encontrar en segundos:

- Causa raíz documentada
- Solución aplicada (pasos y scripts)
- SQL reutilizable
- Casos similares ya resueltos
- Calificación CSAT del solicitante (cuando existe en JSM)

**No reemplaza Jira** — complementa la mesa de servicios cuando necesitás responder: *¿alguien ya resolvió esto?*

---

## 2. Requisitos

| Requisito | Detalle |
|-----------|---------|
| **Navegador** | Chrome, Edge o Firefox (solo para usar JARVIS) |
| **Node.js 18+** | Solo si instalás JARVIS en tu PC o en un servidor |
| **Git** | Recomendado para actualizar el repositorio |
| **Red** | Acceso a `localhost:8000` o al servidor compartido del equipo |

Comprobar Node (CMD o PowerShell):

```bat
node --version
npm --version
```

---

## 3. Instalación rápida (Windows)

### Opción A — Solo usar JARVIS (servidor del equipo)

1. Abrí el navegador en la URL que te indique el equipo (ej. `http://servidor-jarvis:8000`).
2. Listo — no necesitás instalar nada.

### Opción B — Instalar en tu PC

1. **Clonar** el repositorio JARVIS o descomprimí el ZIP `jarvis-1.5.0-*.zip`.
2. Entrá a la carpeta del proyecto.
3. **Doble clic** en `start.bat` **o** ejecutá:

```bat
npm install
npm start
```

4. Abrí **http://localhost:8000**

`start.bat` hace automáticamente: `git pull` → `npm install` → levanta el servidor.

### Opción C — Configurar sync con Jira (opcional, administrador)

1. Copiá `.env.example` → `.env`
2. Completá:

```env
JIRA_EMAIL=tu.usuario@lafise.com
JIRA_API_TOKEN=token_desde_atlassian
JIRA_PROJECT=SLGMS
JIRA_SYNC_ON_START=1
```

3. Token API: [Atlassian → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
4. Primera sync: `node scripts\sync-jira-api.js --full`
5. Sync manual diaria: botón **Sincronizar Jira** en la web, o `node scripts\sync-jira-api.js`

---

## 4. Interfaz — barra superior

| Botón | Función |
|-------|---------|
| **Guía** | Descargar esta guía (Markdown) o abrir versión para imprimir/PDF |
| **Tips JIRA** | Regla de los 4 datos mínimos para un cierre fuerte |
| **Calidad** | Métricas de documentación y CSAT global del índice |
| **Insights** | Top incidencias recurrentes + propuestas de mejora preventiva |
| **Tema** | Alternar modo claro / oscuro (se recuerda en el navegador) |
| **Sincronizar Jira** | Traer tickets cerrados nuevos o actualizados desde SLGMS |

Contadores **Notas indexadas** y **Resultados** se actualizan al buscar.

---

## 5. Uso diario — Buscar soluciones

### 5.1 Búsqueda por texto

Escribí tokens que recuerdes (todas las palabras deben aparecer — operador **AND**):

| Tipo | Ejemplos |
|------|----------|
| Sistema | `SISNET`, `CORE`, `SeguroNet` |
| Error | `ORA-00942`, `ORA-00001`, `timeout`, `NullReference` |
| Reporte / SP | `REPORTE_1`, `PR_PROC_PAGOS` |
| Ticket | `SLGMS-2076` |
| Tabla | `facturas`, `polizas_master` |

**Atajos de teclado**

- `/` — enfoca el buscador
- `Esc` — limpia la búsqueda

### 5.2 Filtros facetados

Debajo del buscador podés filtrar por:

- **Sistema**
- **Área usuaria**
- **Analista** (asignado al ticket)
- **Solicitante** (campo *Informador* en Jira)

Escribí en el campo para **autocompletar** opciones con conteo de casos.  
Podés combinar filtros con texto libre (ej. `ORA-00942` + Sistema `SISNET` + Solicitante con nombre parcial).  
**Limpiar filtros** restablece búsqueda, filtros, orden y fecha.

### 5.3 Orden y fecha

| Control | Uso |
|---------|-----|
| **Más reciente** | Ver últimos cierres (default) |
| **Relevancia** | Prioriza solución/causa útil y coincidencias en SQL |
| **Últimos 7/30/90 días** | Acota por fecha de actualización |
| **Solo solución útil** | Oculta cierres débiles (“caso atendido”, etc.) |

### 5.4 Tarjeta de resultado

Cada ticket muestra:

- Enlace **SLGMS-XXXX ↗** → abre Jira
- **Causa raíz** y **Solución** completas (copiables)
- Bloques **SQL / comandos** con botón Copiar
- **Casos similares** (expandir para ver tickets parecidos)
- Metadatos: área, analista, solicitante
- Badge **Solución débil** si el cierre no ayuda al siguiente analista
- Badge **★ N/5** si el solicitante calificó el ticket en JSM (CSAT)
- Badge de **relevancia** cuando ordenás por Relevancia

### 5.5 Paginación

Se muestran **40 resultados por página**. Usá **Anterior / Siguiente** al pie de la lista.

### 5.6 Modo oscuro

- Botón **Tema** (sol / luna) en la barra superior.
- JARVIS usa su propio tema oscuro (`lafise-dark`); **no hace falta** forzar modo oscuro en Chrome.
- La preferencia se guarda en el navegador (`localStorage`).
- Si nunca elegiste tema, respeta el modo del sistema (claro/oscuro).

---

## 6. Documentar bien en Jira (Tips JIRA)

En la interfaz: botón **Tips JIRA** → regla de los **4 datos mínimos**:

1. **¿Qué falló?** — Sistema + módulo + síntoma/error  
2. **¿Por qué?** — Causa raíz concreta  
3. **¿Cómo se arregló?** — Pasos + script si aplica  
4. **¿Cómo se validó?** — Evidencia (usuario, ambiente PRE/PRO)

### Evitar

- “Caso atendido”, “N/A”, “Ver comentarios”
- SQL solo en captura de pantalla
- Texto muy corto sin acción ni resultado

### Subir el % SQL en JARVIS

JARVIS detecta scripts dentro de bloques Markdown en la nota:

````markdown
```sql
CREATE INDEX IDX_FACT_FECHA ON facturas(fecha);
```
````

Pegá el SQL con fences ` ```sql ` en el campo **Solución** de Jira y re-sincronizá el ticket.

---

## 7. Calidad, ranking por analista e Insights

Botón **Calidad** en el header:

| Métrica | Significado |
|---------|-------------|
| Solución útil | Cierre con pasos reales (no placeholder) |
| Causa útil | Causa raíz documentada |
| Con SQL | Al menos un bloque ` ```sql ` en la nota |
| Cierre Jira | Sección de cierre presente |
| CSAT promedio | Promedio 1–5 de tickets calificados en JSM (global) |
| % calificados | Porcentaje de casos con calificación CSAT |

**Ranking documentación por analista** (mínimo 5 casos):

**Score** = 50% solución útil + 30% causa útil + 20% con SQL

Tabla adicional **Por sistema** para ver cobertura por aplicación.

Usalo en revisiones de mesa para mejorar la base de conocimiento del equipo.

### Insights & Prevención (botón Insights)

Botón **Insights** en el header: agrupa los tickets cerrados en **clústeres recurrentes** (mismo patrón de causa/sistema) y genera una **propuesta de mejora preventiva** por clúster.

| Concepto | Significado |
|----------|-------------|
| **Frecuencia** | Cantidad de tickets del patrón en el periodo elegido |
| **Impacto** | Tickets × áreas afectadas × diversidad de informadores |
| **CSAT bajo** | Badge rojo cuando hay tickets del patrón calificados ≤ 3 |
| **Score** | Ranking combinado: 55% frecuencia + 30% impacto + 15% riesgo CSAT |

Cómo usarlo:

1. Abrí **Insights** y elegí el **periodo** (30 / 90 días / histórico), opcionalmente un **sistema**, y cuántos clústeres **mostrar** (Top 10/20/30/50).
2. Revisá las tarjetas ordenadas por prioridad; expandí un clúster para ver problema, causa probable, **acciones preventivas recomendadas** y tickets de referencia con enlace a Jira.
3. Usá **Copiar resumen** en el clúster para pegarlo en un ticket de mejora, o **Exportar MD** para llevar el informe completo a la reunión con desarrollo/infraestructura.

- Solo aparecen patrones con **2+ tickets**; patrones de un solo caso no se muestran.
- Los tickets de **despliegue/Cambio a producción** y los **trámites administrativos repetitivos de soporte** (altas, desbloqueos, resets, accesos) quedan **fuera del cálculo de patrones**: su texto no define causas ni tendencias de incidentes. La lista de analistas de soporte se administra en `config/insights-excluded-assignees.json` (no en esta guía, para no desactualizarse); sus tickets siguen apareciendo en **Buscar** y **Calidad** con normalidad, solo se excluyen de Insights. Cuando uno de esos tickets referencia el ticket de incidente que resolvió (ej. "Ejecutar script para solventar jira SLGMS-2076"), aparece como **ticket relacionado** dentro del clúster de ese incidente, con badge "Relacionado" en la tarjeta.
- El cálculo es bajo demanda con caché de 5 minutos: no afecta la velocidad de búsqueda.
- Admin (informe offline): `npm run insights:generate` genera `release/insights-report.md` (opciones: `--days 90 --top 10 --sistema "SISNET/..."`).

---

## 8. CSAT (satisfacción JSM)

JARVIS lee la calificación nativa de Jira Service Management (1–5 estrellas al cerrar):

| Dónde se ve | Qué muestra |
|-------------|-------------|
| Tarjeta de búsqueda | Badge **★ N/5** |
| Modal Calidad | Promedio global y % de tickets calificados |
| Nota indexada | Campo `Satisfacción` en el detalle del ticket |

- **Sync incremental:** cada sync trae CSAT de tickets recién calificados.
- **Histórico (admin, una vez):** `npm run sync:satisfaction:backfill`
- Tickets sin calificación no afectan el promedio CSAT.

---

## 9. Sincronizar Jira

| Método | Cuándo |
|--------|--------|
| **Web → Sincronizar Jira → API** | Uso normal; incremental tras la primera vez |
| `node scripts\sync-jira-api.js` | Desde terminal |
| `node scripts\sync-jira-api.js --full` | Re-importar todo el histórico |
| `node scripts\sync-jira-api.js --test` | Solo probar conexión |
| CSV manual | Respaldo con `historial_jira.csv` |
| `npm run sync:satisfaction:backfill` | Una vez: CSAT histórico en notas existentes |

**Primera sync:** ~1 año de tickets cerrados (1–5 min según filtro de sistema).  
**Siguientes:** solo tickets actualizados desde la última sync.

Sync automática en servidor (admin): `JIRA_SYNC_INTERVAL_MINUTES=60` en `.env`.

---

## 10. Problemas frecuentes

| Síntoma | Qué hacer |
|---------|-----------|
| No abre la página | Verificar que JARVIS esté corriendo; probar otro puerto (`set PORT=8001`) |
| “No hay notas” | Ejecutar sync Jira o revisar carpeta `notes/jira/` |
| Mi ticket no aparece | Debe estar **Cerrado/Finalizado** en SLGMS y sincronizado |
| No encuentro por error ORA | Probar solo `ORA-00942` o sistema + error |
| SQL no suma en Calidad | Usar bloque ` ```sql ` en Solución y re-sync |
| Modo oscuro se ve mal | Usar botón **Tema** de JARVIS; desactivar forzado de Chrome |
| No veo CSAT en tickets viejos | Pedir al admin ejecutar `sync:satisfaction:backfill` |
| Filtro Solicitante vacío | El ticket debe tener *Informador* en Jira y estar sincronizado |
| Insights no muestra clústeres | Ampliar el periodo o quitar filtro de sistema (mínimo 2 tickets por patrón) |

---

## 11. Flujo recomendado del analista

```
Incidente nuevo en Jira
        ↓
Buscar en JARVIS (sistema + error + reporte / solicitante)
        ↓
¿Hay solución similar? → Casos similares / Relevancia
        ↓
Resolver y cerrar Jira con Tips JIRA (4 preguntas + SQL)
        ↓
Sync Jira → JARVIS indexa para el equipo (+ CSAT si el usuario califica)
```

---

## 12. Contacto

- **Administrador JARVIS / repositorio:** quien mantenga el servidor o el repo del equipo.
- **Formato de notas técnicas:** archivo `.cursorrules` en el repositorio.
- **Guía en la web:** botón **Guía** → descargar Markdown o abrir HTML para PDF.

---

*JARVIS 1.5.0 — LAFISE · Repositorio de soluciones · Proyecto SLGMS*
