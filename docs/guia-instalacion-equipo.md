# JARVIS — Guía de instalación para el equipo

**LAFISE · Motor de búsqueda de soluciones HD (Jira SLGMS)**  
Versión empaquetado: 1.0 · Puerto: `8000`

---

## 1. Objetivo

JARVIS indexa tickets **cerrados** de Jira (SLGMS) y permite buscar causa raíz, solución, SQL y casos similares en segundos.

Esta guía cubre la **instalación desde el ZIP** que comparte el administrador del equipo.

---

## 2. Contenido del paquete

| Incluye | No incluye (por seguridad) |
|---------|----------------------------|
| Aplicación Node.js + interfaz web | Token Jira (cada equipo configura el suyo) |
| `start.bat` para Windows | Casos sincronizados (`notes/jira/` vacío al inicio) |
| Plantilla `.env.example` | `node_modules` (se instala con npm) |
| Guías en `docs/` | Archivo `.env` con secretos |

Tras la primera sync con Jira API tendrás miles de casos en tu PC o servidor.

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

1. Descomprimí `jarvis-*.zip` en una carpeta local, por ejemplo:
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

   # Opcional: solo SISNET y OPTICO (purga notas locales de otros sistemas al sync)
   # JIRA_SYNC_SISTEMA_FILTER=SISNET,OPTICO
   ```

3. **Token API:** [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) → Create API token.

> **Importante:** No compartas el `.env` ni lo subas a Git.

> **Filtro Sistema:** Si activás `JIRA_SYNC_SISTEMA_FILTER`, hacé backup de `notes/jira/` antes del primer `--full`. Podés probar sin cambios con `node scripts\sync-jira-api.js --dry-run-filter`.

### Paso 3 — Primera sincronización (obligatoria)

La primera vez hay que traer el histórico completo desde Jira:

```bat
npm install
node scripts\sync-jira-api.js --full
```

Duración aproximada: 2–5 minutos (~7 000+ tickets). Al terminar verás `"processed": 7777` (aprox.).

### Paso 4 — Arrancar JARVIS

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
| Buscar | Escribí tokens: `SISNET`, `ORA-00942`, nombre de reporte |
| Sync incremental | Botón **Sincronizar** en la web (solo lo nuevo) |
| Detener | `Ctrl+C` en la consola donde corre JARVIS |

---

## 6. Variables `.env` recomendadas

```env
# Obligatorias para sync API
JIRA_EMAIL=...
JIRA_API_TOKEN=...

# Sync incremental cada vez que arranca
JIRA_SYNC_ON_START=1

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
3. Dejá corriendo `start.bat` o configuren un servicio Windows.
4. Compartí la URL: `http://nombre-servidor:8000`
5. Abrí firewall puerto **8000** solo para la red interna.

Los analistas **no necesitan instalar nada** — solo el navegador.

---

## 8. Solución de problemas

| Problema | Solución |
|----------|----------|
| `start.bat` se cierra al instante | Instalá Node.js 18+ y volvé a ejecutar |
| `localhost:8000` sigue abierto tras cerrar terminal | `netstat -ano \| findstr :8000` → `taskkill /PID <pid> /F` |
| Sync falla / 401 | Revisá `JIRA_EMAIL` y `JIRA_API_TOKEN` en `.env` |
| Pocos casos (~2500) | Corré `node scripts\sync-jira-api.js --full` |
| Quiero solo SISNET/OPTICO | `JIRA_SYNC_SISTEMA_FILTER=SISNET,OPTICO` + backup + `--dry-run-filter` + `--full` |
| Puerto ocupado | Cambiá `PORT=8001` en `.env` |

Probar conexión Jira:

```bat
node scripts\sync-jira-api.js --test
```

---

## 9. Documentación adicional

| Archivo | Contenido |
|---------|-----------|
| `docs/guia-analistas-jarvis.md` | Uso del buscador y calidad de cierre |
| `docs/guia-instalacion-equipo.html` | Esta guía — imprimir / PDF |
| `README.md` | Referencia técnica completa |
| `LEEME-INSTALACION.txt` | Resumen rápido en la raíz del ZIP |

---

## 10. Seguridad

- El token Jira es personal — no lo envíes por chat ni correo sin cifrar.
- El paquete **no incluye** tickets exportados; cada instalación sincroniza desde Jira con permisos del usuario del token.
- No documentes contraseñas ni datos personales en las notas.

---

**Soporte interno:** contactá al administrador JARVIS del equipo o al área que distribuyó el ZIP.
