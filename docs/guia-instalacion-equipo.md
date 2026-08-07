# JARVIS — Guía de instalación para el equipo

**LAFISE · Motor de búsqueda de soluciones HD (Jira SLGMS)**  
Versión empaquetado: **1.5.0** · Puerto: `8000`

---

## 1. Objetivo

JARVIS indexa tickets **cerrados** de Jira (SLGMS) y permite buscar causa raíz, solución, SQL, casos similares y CSAT en segundos.

Esta guía cubre la **instalación desde el ZIP** que comparte el administrador del equipo.

---

## 2. Contenido del paquete

| Incluye | No incluye (por seguridad) |
|---------|----------------------------|
| Aplicación Node.js + interfaz web (modo claro/oscuro) | Token Jira (cada equipo configura el suyo) |
| `start.bat` para Windows | Casos sincronizados (`notes/jira/` vacío al inicio) |
| Plantilla `.env.example` | `node_modules` (se instala con npm) |
| Guías en `docs/` | Archivo `.env` con secretos |

Tras la primera sync con Jira API tendrás casos en tu PC o servidor (cantidad según filtro de sistema configurado).

---

## 3. Requisitos

| Requisito | Versión |
|-----------|---------|
| **Node.js** | 18 o superior — [https://nodejs.org/](https://nodejs.org/) |
| **Windows** | 10/11 (recomendado `start.bat`) |
| **Red** | Acceso a Jira Cloud (`seguroslafise.atlassian.net`) |
| **Git** | Opcional (solo si actualizás desde repositorio) |

Comprobar en CMD o PowerShell:

```bat
node --version
npm --version
```

---

## 4. Instalación paso a paso (Windows)

### Paso 1 — Descomprimir

1. Descomprimí `jarvis-1.5.0-*.zip` en una carpeta local, por ejemplo:
   ```
   C:\JARVIS
   ```
2. No uses rutas con permisos restringidos (evitá `Program Files`).

### Paso 2 — Configurar Jira API

1. Copiá el archivo de ejemplo:
   ```bat
   copy .env.example .env
   ```
2. Editá `.env` con Bloc de notas y completá:

   ```env
   JIRA_BASE_URL=https://seguroslafise.atlassian.net
   JIRA_EMAIL=tu.correo@lafise.com
   JIRA_API_TOKEN=tu_token_de_atlassian

   JIRA_PROJECT=SLGMS
   JIRA_SYNC_ON_START=1

   # CSAT JSM (activo por defecto). 0 = desactivar.
   JIRA_SATISFACTION_SYNC=1

   # Opcional: solo ciertos sistemas (purga notas SLGMS locales fuera del filtro)
   # JIRA_SYNC_SISTEMA_FILTER=SISNET,OPTICO
   ```

3. **Token API:** [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) → Create API token.

> **Importante:** No compartas el `.env` ni lo subas a Git.

> **Filtro Sistema:** Si activás `JIRA_SYNC_SISTEMA_FILTER`, hacé backup de `notes/jira/` antes del primer `--full`. Podés probar sin cambios con `node scripts\sync-jira-api.js --dry-run-filter`.

> **Analistas excluidos de Insights:** `config/insights-excluded-assignees.json` (versionado en git, no es un secreto) lista los analistas cuyos tickets son soporte/despliegue repetitivo (accesos, desbloqueos, altas) y no representan incidentes con causa raíz. Sus tickets **siguen sincronizados y buscables** en JARVIS — solo se excluyen del clustering de **Insights**. Para agregar o quitar un nombre, editá el JSON directamente: el cambio se ve reflejado en hasta 5 minutos (cache de Insights), sin tocar código ni reiniciar el servidor.

### Paso 3 — Primera sincronización (obligatoria)

La primera vez hay que traer el histórico desde Jira:

```bat
npm install
node scripts\sync-jira-api.js --full
```

Duración aproximada: 2–5 minutos. Sin filtro de sistema: miles de tickets; con `SISNET,OPTICO`: ~2 500 casos (varía según Jira).

### Paso 4 — Backfill CSAT (recomendado, una vez)

Para calificaciones históricas JSM en notas ya importadas:

```bat
npm run sync:satisfaction:backfill
```

Opcional: `node scripts\backfill-satisfaction.js --days 365 --dry-run` para ver cuántos se actualizarían sin escribir.

### Paso 5 — Arrancar JARVIS

Doble clic en **`start.bat`** o:

```bat
npm start
```

Abrí el navegador en: **http://localhost:8000**

---

## 5. Uso diario

| Acción | Cómo |
|--------|------|
| Arrancar | `start.bat` |
| Buscar | Tokens: `SISNET`, `ORA-00942`, reporte, `SLGMS-1234` |
| Filtros | Sistema, Área, Analista, **Solicitante** |
| Modo oscuro | Botón **Tema** en la barra (no usar forzado de Chrome) |
| Sync incremental | Botón **Sincronizar Jira** en la web |
| Métricas | Botón **Calidad** (documentación + CSAT global) |
| Detener | `Ctrl+C` en la consola donde corre JARVIS |

Guía de uso para analistas: `docs/guia-analistas-jarvis.md`

---

## 6. Variables `.env` recomendadas

```env
# Obligatorias para sync API
JIRA_EMAIL=...
JIRA_API_TOKEN=...

# Sync incremental cada vez que arranca
JIRA_SYNC_ON_START=1

# CSAT en sync incremental (default 1)
JIRA_SATISFACTION_SYNC=1

# Full sync automático al arrancar — SOLO la primera vez; luego comentar:
# JARVIS_SYNC_FULL_ON_START=1

# Sync cada hora en background (opcional)
# JIRA_SYNC_INTERVAL_MINUTES=60

# Solo ciertos sistemas (vacío = todos). Purga notas SLGMS locales fuera del filtro.
# JIRA_SYNC_SISTEMA_FILTER=SISNET,OPTICO
# JIRA_FIELD_SISTEMA=customfield_10319
```

---

## 7. Servidor compartido (opcional)

Para que todo el equipo use la misma instancia:

1. Instalá JARVIS en un servidor Windows con Node.js.
2. Ejecutá la sync completa una vez (`--full`).
3. Ejecutá backfill CSAT una vez (`npm run sync:satisfaction:backfill`).
4. Dejá corriendo `start.bat` o configuren un servicio Windows.
5. Compartí la URL: `http://nombre-servidor:8000`
6. Abrí firewall puerto **8000** solo para la red interna.

Los analistas **no necesitan instalar nada** — solo el navegador.

---

## 8. Solución de problemas

| Problema | Solución |
|----------|----------|
| `start.bat` se cierra al instante | Instalá Node.js 18+ y volvé a ejecutar |
| `localhost:8000` sigue abierto tras cerrar terminal | `netstat -ano \| findstr :8000` → `taskkill /PID <pid> /F` |
| Sync falla / 401 | Revisá `JIRA_EMAIL` y `JIRA_API_TOKEN` en `.env` |
| Sync falla `getConfig` / circular | Actualizá a JARVIS **1.3.0+** (fix incluido) |
| Pocos casos | Corré `node scripts\sync-jira-api.js --full` |
| Quiero solo SISNET/OPTICO | `JIRA_SYNC_SISTEMA_FILTER=SISNET,OPTICO` + backup + `--dry-run-filter` + `--full` |
| Sin CSAT en tickets viejos | `npm run sync:satisfaction:backfill` |
| Modo oscuro feo en Chrome | Usar botón **Tema** de JARVIS, no forzar dark en el navegador |
| Puerto ocupado | Cambiá `PORT=8001` en `.env` |

Probar conexión Jira:

```bat
node scripts\sync-jira-api.js --test
```

---

## 9. Documentación adicional

| Archivo | Contenido |
|---------|-----------|
| `docs/guia-analistas-jarvis.md` | Uso del buscador, filtros, CSAT, modo oscuro |
| `docs/guia-analistas-jarvis.html` | Guía analistas — imprimir / PDF |
| `docs/guia-instalacion-equipo.html` | Esta guía — imprimir / PDF |
| `README.md` | Referencia técnica completa |
| `LEEME-INSTALACION.txt` | Resumen rápido en la raíz del ZIP |

---

## 10. Seguridad

- El token Jira es personal — no lo envíes por chat ni correo sin cifrar.
- El paquete **no incluye** tickets exportados; cada instalación sincroniza desde Jira con permisos del usuario del token.
- No documentes contraseñas ni datos personales en las notas.

---

## 11. Novedades recientes (1.3.0 – 1.5.0)

| Versión | Destacado |
|---------|-----------|
| **1.5.0** | Botón **Insights**: top incidencias recurrentes + propuestas de mejora |
| **1.4.0** | Modo oscuro nativo + botón **Tema** |
| **1.3.0** | CSAT JSM, filtro **Solicitante**, badge ★ en cards |
| **1.2.0** | Filtro sync por Sistema (`JIRA_SYNC_SISTEMA_FILTER`) |

---

**Soporte interno:** contactá al administrador JARVIS del equipo o al área que distribuyó el ZIP.
