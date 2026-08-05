# JARVIS — Guía de instalación y uso para analistas

**LAFISE · Motor de búsqueda de soluciones Jira (SLGMS)**  
Versión: 2026 · Puerto por defecto: `8000`

---

## 1. ¿Qué es JARVIS?

JARVIS indexa tickets **cerrados** del proyecto Jira **SLGMS** y te permite encontrar en segundos:

- Causa raíz documentada
- Solución aplicada (pasos y scripts)
- SQL reutilizable
- Casos similares ya resueltos

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

1. **Clonar** el repositorio JARVIS (pedí la URL al administrador).
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
```

3. Token API: [Atlassian → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
4. Sync manual: botón **Sincronizar Jira** en la web, o `node scripts\sync-jira-api.js`

---

## 4. Uso diario — Buscar soluciones

### 4.1 Búsqueda por texto

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

### 4.2 Filtros facetados

Debajo del buscador podés filtrar por:

- **Sistema**
- **Área usuaria**
- **Analista**
- **Solicitante** (Informador del ticket en Jira)

Escribí en el campo para **autocompletar** opciones con conteo de casos.  
**Limpiar filtros** restablece todo.

### 4.3 Orden y fecha

| Control | Uso |
|---------|-----|
| **Más reciente** | Ver últimos cierres (default) |
| **Relevancia** | Prioriza solución/causa útil y coincidencias en SQL |
| **Últimos 7/30/90 días** | Acota por fecha de actualización |
| **Solo solución útil** | Oculta cierres débiles (“caso atendido”, etc.) |

### 4.4 Tarjeta de resultado

Cada ticket muestra:

- Enlace **SLGMS-XXXX ↗** → abre Jira
- **Causa raíz** y **Solución** completas (copiables)
- Bloques **SQL / comandos** con botón Copiar
- **Casos similares** (expandir para ver tickets parecidos)
- Badge **Solución débil** si el cierre no ayuda al siguiente analista
- Badge **★ N/5** si el solicitante calificó el ticket en JSM (CSAT)

### 4.5 Paginación

Se muestran **40 resultados por página**. Usá **Anterior / Siguiente** al pie de la lista.

---

## 5. Documentar bien en Jira (Tips JIRA)

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

## 6. Calidad y ranking por analista

Botón **Calidad** en el header:

| Métrica | Significado |
|---------|-------------|
| Solución útil | Cierre con pasos reales (no placeholder) |
| Causa útil | Causa raíz documentada |
| Con SQL | Al menos un bloque ` ```sql ` en la nota |
| Cierre Jira | Sección de cierre presente |
| CSAT promedio | Promedio 1–5 de tickets calificados en JSM |
| % calificados | Porcentaje de casos con calificación CSAT |

**Ranking documentación por analista** (mínimo 5 casos):

**Score** = 50% solución útil + 30% causa útil + 20% con SQL

Usalo en revisiones de mesa para mejorar la base de conocimiento del equipo.

---

## 7. Sincronizar Jira

| Método | Cuándo |
|--------|--------|
| **Web → Sincronizar Jira → API** | Uso normal; incremental tras la primera vez |
| `node scripts\sync-jira-api.js` | Desde terminal |
| `node scripts\sync-jira-api.js --test` | Solo probar conexión |
| CSV manual | Respaldo con `historial_jira.csv` |
| `npm run sync:satisfaction:backfill` | Una vez: CSAT histórico en notas existentes |

**Primera sync:** ~1 año de tickets cerrados (1–3 min).  
**Siguientes:** solo tickets actualizados desde la última sync.

Sync automática en servidor (admin): `JIRA_SYNC_INTERVAL_MINUTES=60` en `.env`.

---

## 8. Problemas frecuentes

| Síntoma | Qué hacer |
|---------|-----------|
| No abre la página | Verificar que JARVIS esté corriendo; probar otro puerto (`set PORT=8001`) |
| “No hay notas” | Ejecutar sync Jira o revisar carpeta `notes/jira/` |
| Mi ticket no aparece | Debe estar **Cerrado/Finalizado** en SLGMS y sincronizado |
| No encuentro por error ORA | Probar solo `ORA-00942` o sistema + error |
| SQL no suma en Calidad | Usar bloque ` ```sql ` en Solución y re-sync |

---

## 9. Flujo recomendado del analista

```
Incidente nuevo en Jira
        ↓
Buscar en JARVIS (sistema + error + reporte)
        ↓
¿Hay solución similar? → Casos similares / Relevancia
        ↓
Resolver y cerrar Jira con Tips JIRA (4 preguntas + SQL)
        ↓
Sync Jira → JARVIS indexa para el equipo
```

---

## 10. Contacto

- **Administrador JARVIS / repositorio:** quien mantenga el servidor o el repo del equipo.
- **Formato de notas técnicas:** archivo `.cursorrules` en el repositorio.
- **Guía en la web:** botón **Guía** → descargar Markdown o PDF.

---

*JARVIS — LAFISE · Repositorio de soluciones · Proyecto SLGMS*
