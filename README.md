# JARVIS — Guía de uso para el equipo

JARVIS es el **motor de búsqueda de soluciones e incidencias** del equipo. Indexa notas Markdown/Dendron (tickets Jira/HD ya resueltos) y te deja encontrar causa raíz, solución, scripts SQL y texto de cierre en segundos.

Stack: Node.js + Express · UI en modo oscuro · puerto por defecto `8000`.

---

## Para quién es esta guía

| Rol | Qué necesitas |
|-----|----------------|
| **Usar el buscador** | Clonar, arrancar, buscar |
| **Documentar un HD** | Escribir notas con la plantilla correcta |
| **Montar servidor compartido** | Variables de entorno + host en red |

---

## 1. Requisitos (una sola vez)

1. **Node.js 18+** — [https://nodejs.org/](https://nodejs.org/) (versión LTS).
2. **Git**.
3. Acceso al repositorio de JARVIS (y, si aplica, al vault de notas Dendron).

Comprueba en una terminal:

```bat
node --version
npm --version
git --version
```

Si `node` no existe, instálalo o pide a IT el paquete aprobado (en redes con Zscaler a veces el instalador de python.org/nodejs.org está bloqueado).

---

## 2. Arranque en 3 minutos

### Paso 1 — Clonar

```bat
git clone <URL_DEL_REPO_JARVIS>.git
cd jarvis
```

### Paso 2 — (Opcional) Apuntar a tus notas Dendron

Por defecto JARVIS lee la carpeta `notes/` del propio repo (incluye ejemplos).

Si el equipo guarda las notas en otro vault:

**Windows (PowerShell):**

```powershell
$env:DENDRON_NOTES_DIR = "C:\ruta\a\tu\vault\notes"
```

**Windows (CMD):**

```bat
set DENDRON_NOTES_DIR=C:\ruta\a\tu\vault\notes
```

**Linux / Mac:**

```bash
export DENDRON_NOTES_DIR="$HOME/dendron/notes"
```

### Paso 3 — Arrancar

**Windows (recomendado):** doble clic en `start.bat`, o:

```bat
start.bat
```

**Linux / Mac:**

```bash
chmod +x start.sh
./start.sh
```

**Con npm:**

```bash
npm install
npm start
```

Abre el navegador en:

**http://localhost:8000**

`start.bat` / `start.sh` hacen automáticamente:

1. `git pull` (actualizar notas/código del equipo)
2. `npm install`
3. Levantar el servidor

---

## 3. Cómo buscar (uso diario)

1. Arranca JARVIS.
2. En la caja de búsqueda escribe tokens que recuerdes:
   - Sistema: `SISNET`, `CORE`
   - Error / log: `ORA-00942`, `timeout`
   - Reporte: `REPORTE_1`, `CONCILIA_DIA`
   - Tabla: `APP.FACTURAS`
   - Palabras de la solución: `GRANT`, `indice`
3. Abre la tarjeta del ticket.
4. Usa **Copiar** en los bloques SQL o comandos.
5. Reutiliza la sección **# ✅ Cierre de HD** para el comentario en Jira.

### Ejemplos de prueba (notas demo del repo)

| Búsqueda | Qué deberías ver |
|----------|------------------|
| `SISNET` | JIRA-12345 — ORA-00942 en REPORTE_1 |
| `ORA-00942` | Misma nota, con SQL `GRANT SELECT` |
| `timeout` | HD-9876 — batch de conciliación CORE |
| `cierre` | Notas que tienen sección de cierre |

La búsqueda es por **todas las palabras** (AND): `SISNET ORA` exige que ambas aparezcan.

---

## 4. Cómo documentar un HD (para que salga en JARVIS)

La calidad del buscador depende de cómo escribas la nota. Sigue **exactamente** estos labels (también están en `.cursorrules` para Cursor).

### Nombre de archivo (Dendron)

```
hd.<sistema>.<modulo>.<ticket>.md
```

Ejemplo: `hd.sisnet.reportes.jira-12345.md`

### Plantilla lista para copiar

```markdown
---
id: jira-12345
title: "JIRA-12345 — Error ORA-00942 en REPORTE_1"
desc: "Breve resumen indexable (error + sintoma)"
updated: 2026-07-30
tags: [hd, sisnet, reporte, oracle]
---

**Sistema:** SISNET
**Módulo:** Reportes
**Reporte:** REPORTE_1
**Tabla:** APP.FACTURAS

**Causa Raíz:**
Explicacion concreta de la causa (no solo el sintoma).

**Solución:**
1. Paso 1
2. Paso 2

```sql
GRANT SELECT ON APP.FACTURAS TO RPT_USER;
```

## ✅ Cierre de HD
Texto listo para pegar en Jira/HD: que se hizo, evidencia y estado final.
```

### Checklist antes de hacer commit

- [ ] Título con ticket + síntoma real (`ORA-...`, nombre de reporte, sistema)
- [ ] Labels `Sistema`, `Módulo`, `Causa Raíz`, `Solución`
- [ ] SQL dentro de bloque ` ```sql `
- [ ] Sección `## ✅ Cierre de HD`
- [ ] Sin contraseñas, tokens ni datos personales
- [ ] `git add` + `git commit` + `git push` para que el equipo lo vea tras el próximo `git pull`

### Calidad en Jira (impacto en JARVIS)

JARVIS prioriza en **Relevancia** los casos con solución útil, SQL documentado y tokens de error en causa/solución. Evitá estos cierres débiles — no ayudan al siguiente analista:

| Evitar | Mejor |
|--------|--------|
| `caso atendido` | Pasos concretos: qué se cambió, dónde, evidencia |
| `ver comentarios` | Resumen en el campo **Solución** |
| Texto &lt; 12 caracteres | Al menos síntoma + acción + resultado |
| SQL solo en screenshot | Bloque ` ```sql ` en la nota o script en Solución |

En la UI de JARVIS, los botones **Tips JIRA** y **Calidad** muestran la guía de cierre, el ranking por analista y el % de casos bien documentados por sistema.

Si usas **Cursor**, el archivo `.cursorrules` del repo guía a la IA para generar notas en este formato.

---

## 5. Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `DENDRON_NOTES_DIR` | `./notes` | Carpeta raíz de las notas `.md` |
| `PORT` | `8000` | Puerto HTTP del servidor |
| `JIRA_EMAIL` | — | Correo Atlassian (sync API) |
| `JIRA_API_TOKEN` | — | Token API Atlassian |
| `JIRA_BASE_URL` | `https://seguroslafise.atlassian.net` | Instancia Jira |
| `JIRA_PROJECT` | `SLGMS` | Proyecto a sincronizar |
| `JIRA_SYNC_INITIAL_DAYS` | `365` | Días en la primera sync API |
| `JIRA_SYNC_INTERVAL_MINUTES` | — | Sync automática cada N minutos (ej. `60`) |
| `JIRA_SYNC_ON_START` | — | `1` = sync incremental al arrancar el servidor |
| `JIRA_SYNC_SISTEMA_FILTER` | — | Raíces de Sistema a sync (ej. `SISNET,OPTICO`). Vacío = todos |
| `JIRA_FIELD_SISTEMA` | `customfield_10319` | ID del campo Sistema en Jira (otra instancia) |

Ver también sección 8 para sync Jira.

---

## 6. Servidor compartido (opcional)

En un host de la red del equipo:

```bash
cd jarvis
git pull
npm install
export DENDRON_NOTES_DIR=/ruta/compartida/notes   # o set en Windows
export PORT=8000
npm start
```

El resto del equipo abre `http://<nombre-o-ip-del-servidor>:8000` **sin** instalar nada (solo navegador).

Buenas prácticas:

- Mantén las notas en Git y haz `git pull` periódico en el servidor (o un scheduled task / cron).
- No expongas el puerto fuera de la red corporativa.
- Un solo proceso Node es suficiente para un equipo pequeño/mediano.

---

## 7. API (integraciones / scripts)

| Endpoint | Descripción |
|----------|-------------|
| `GET /` | UI web (`?q=texto`) |
| `GET /api/search?q=texto` | JSON con resultados (filtros, paginación, facets) |
| `GET /api/similar?key=SLGMS-1234` | Casos similares por ticket |
| `GET /api/quality/metrics` | Métricas de calidad de documentación |
| `GET /api/docs/guia?format=info` | Disponibilidad de guía (md/pdf/html) |
| `GET /api/docs/guia/download?format=md\|pdf` | Descargar guía para analistas |
| `GET /docs/guia-analistas-jarvis.html` | Guía imprimible (Ctrl+P → PDF) |
| `GET /api/sync/jira/status` | Estado conexión Jira + última sync + scheduler |
| `POST /api/sync/jira` | Sync desde Jira API (`?full=1` sync completo) |
| `POST /api/import/jira` | Import CSV manual |

Ejemplo:

```bat
curl "http://localhost:8000/api/search?q=SISNET"
curl "http://localhost:8000/api/health"
```

---

## 8. Sincronizar casos desde Jira (API — recomendado)

JARVIS puede traer tickets cerrados de **Jira Cloud** sin exportar CSV manualmente.

### Paso 1 — API token de Atlassian

1. Entra a [API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) con tu cuenta `@lafise.com`.
2. Crea un token y cópialo (solo se muestra una vez).

### Paso 2 — Configurar `.env`

Copia `.env.example` → `.env` en la raíz de JARVIS:

```bat
copy .env.example .env
```

Edita `.env`:

```env
JIRA_EMAIL=tu.usuario@lafise.com
JIRA_API_TOKEN=el_token_que_copiaste
JIRA_PROJECT=SLGMS
```

### Paso 3 — Sincronizar

**Desde la web:** botón **Sincronizar Jira** → pestaña **API Jira** → **Sincronizar ahora**.

**Desde terminal:**

```bat
node scripts\sync-jira-api.js
```

- **Primera vez:** trae tickets cerrados de los últimos 365 días (configurable con `JIRA_SYNC_INITIAL_DAYS`).
- **Siguientes veces:** solo tickets **actualizados** desde la última sync (incremental).
- **Sync completo:** `node scripts\sync-jira-api.js --full`
- **Probar conexión:** `node scripts\sync-jira-api.js --test`
- **Dry-run filtro Sistema:** `node scripts\sync-jira-api.js --dry-run-filter` (cuenta fetched/kept/purge sin escribir)
- **Sync automática (servidor compartido):** en `.env` define `JIRA_SYNC_INTERVAL_MINUTES=60` (y opcional `JIRA_SYNC_ON_START=1`). JARVIS sincroniza en background sin abrir la UI.

Notas generadas en `notes/jira/`. El estado de sync se guarda en `.jarvis/jira-sync-state.json` (no se sube a Git).

### Filtro por Sistema (opcional)

Si solo necesitás tickets de ciertos sistemas (ej. mesa SISNET + OPTICO):

```env
JIRA_SYNC_SISTEMA_FILTER=SISNET,OPTICO
```

- El JQL de sync incluye el campo Sistema de Jira (`cf[10319]` por defecto).
- Post-filtro por raíz exacta: `SISNET`, `SISNET/EMISIONES`, `OPTICO / Documentos`, etc.
- **Purga local:** al terminar el sync, elimina de `notes/jira/` los `.md` con ticket `SLGMS-*` que no coincidan (hacé backup antes de la primera vez).
- Otro equipo / otra instancia Jira: ajustá `JIRA_PROJECT`, `JIRA_FIELD_SISTEMA` y la lista de filtros.
- Vacío o sin variable = comportamiento anterior (todos los sistemas).

```bat
node scripts\sync-jira-api.js --dry-run-filter
node scripts\sync-jira-api.js --full
```

### Variables Jira

| Variable | Default | Descripción |
|----------|---------|-------------|
| `JIRA_BASE_URL` | `https://seguroslafise.atlassian.net` | Instancia Jira |
| `JIRA_EMAIL` | — | Correo Atlassian |
| `JIRA_API_TOKEN` | — | Token de API |
| `JIRA_PROJECT` | `SLGMS` | Proyecto a sincronizar |
| `JIRA_SYNC_INITIAL_DAYS` | `365` | Ventana inicial si no hay sync previa |
| `JIRA_SYNC_SISTEMA_FILTER` | — | Raíces Sistema (coma). Vacío = todos |
| `JIRA_FIELD_SISTEMA` | `customfield_10319` | Custom field Sistema en Jira |

---

## 9. Importar historial de Jira (CSV — respaldo)

### Opción A — Pestaña CSV en la web

1. Coloca `historial_jira.csv` en la raíz del proyecto JARVIS.
2. **Sincronizar Jira** → pestaña **CSV manual** → **Importar CSV**.

### Opción B — Línea de comandos

```bat
node scripts\import-jira-csv.js
```

### Deduplicación

- Mismo ticket Jira **no se duplica**: si ya existe, se **actualiza** solo si cambió el contenido.
- El sync API **no borra** notas que no vengan en el lote incremental (a diferencia del CSV con orphans).
- Con **`JIRA_SYNC_SISTEMA_FILTER` activo**, el sync **sí purga** notas locales fuera del filtro (solo archivos `SLGMS-*`).

---

## 10. Estructura del proyecto

```
jarvis/
├── server.js                 # Servidor Express + parser de notas
├── templates/index.ejs       # Interfaz web (modo oscuro)
├── notes/                    # Notas Dendron / demos
│   └── jira/                 # Notas generadas desde historial_jira.csv
├── lib/
│   ├── jira-api.js           # Cliente REST Jira Cloud
│   ├── jira-sync.js          # Orquestación sync API → notas
│   ├── jira-sync-scheduler.js # Sync automática en background
│   ├── jira-import.js        # CSV + buildNote compartido
│   ├── note-quality.js       # Heurísticas causa/solución útil
│   ├── search-facets.js      # Filtros facetados + paginación
│   ├── search-relevance.js     # Puntuación de relevancia
│   ├── similar-notes.js      # Casos similares
│   └── quality-metrics.js    # Métricas agregadas de calidad
├── docs/
│   ├── guia-analistas-jarvis.md    # Guía analistas (descargable)
│   ├── guia-analistas-jarvis.html  # Versión imprimible
│   └── guia-analistas-jarvis.pdf   # Opcional (npm run docs:guia-pdf)
├── scripts/
│   ├── import-jira-csv.js
│   └── sync-jira-api.js
├── .env.example                # Plantilla credenciales Jira
├── package.json
├── start.bat / start.sh
├── .cursorrules
└── README.md
```

---

## 11. Problemas frecuentes

| Síntoma | Qué hacer |
|---------|-----------|
| `node` no se reconoce | Instalar Node.js LTS y reabrir la terminal |
| Puerto 8000 ocupado | `set PORT=8001` (CMD) o `$env:PORT=8001` (PowerShell) y volver a arrancar |
| “No hay notas” | Revisa `DENDRON_NOTES_DIR` o que existan `.md` en `notes/` |
| No aparece mi ticket nuevo | Confirma labels de la plantilla; reinicia JARVIS (lee las notas al buscar); haz `git pull` |
| `npm install` falla por red/proxy | Usa la red corporativa / registry interno que indique IT; reintenta |
| `git pull` falla en `start.bat` | El script continúa igual; resuelve conflictos o credenciales Git aparte |
| Zscaler bloquea descargas | Pedir excepción a Ciberseguridad o usar el instalador/paquete interno de Node |

---

## 12. Flujo recomendado del equipo

```
Incidente resuelto en Jira/HD
        ↓
JARVIS sincroniza desde Jira API (automático o botón)
        ↓
Buscar causa/solución en JARVIS
        ↓
(Opcional) Enriquecer nota Dendron manualmente + git push
```

---

## 13. Contacto / mantenimiento

- **Código y notas de ejemplo:** este repositorio.
- **Formato de notas:** `.cursorrules` + sección 4 de este README.
- **Dudas de arranque:** quien mantenga el repo o el servidor compartido del equipo.

Con Node instalado, clonar + `start.bat` debería bastar para estar buscando en menos de 3 minutos.

---

## 14. Guía para analistas (descarga)

Documento orientado al equipo de mesa (instalación, búsqueda, Tips JIRA, calidad):

| Formato | Cómo obtenerlo |
|---------|----------------|
| **Web** | Botón **Guía** en el header de JARVIS |
| **Markdown** | `docs/guia-analistas-jarvis.md` o `/api/docs/guia/download?format=md` |
| **HTML / PDF** | `/docs/guia-analistas-jarvis.html` (Imprimir → Guardar como PDF) |
| **PDF build** | `npm run docs:guia-pdf` (requiere `md-to-pdf`, genera `docs/guia-analistas-jarvis.pdf`) |
