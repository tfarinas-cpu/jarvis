#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "========================================"
echo " JARVIS - Motor de Soluciones HD"
echo "========================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: No se encontro Node.js."
  exit 1
fi

echo "Usando Node $(node --version)"
echo

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "[1/4] Actualizando repositorio (git pull)..."
  git pull --ff-only || echo "AVISO: git pull fallo. Continuando local."
else
  echo "[1/4] Se omite git pull."
fi

echo
echo "[2/4] Instalando dependencias..."
if [ -d node_modules/express ]; then
  echo "Dependencias ya instaladas."
else
  npm install
fi

echo
echo "[3/4] Importando casos Jira..."
if [ -f historial_jira.csv ]; then
  node scripts/import-jira-csv.js || echo "AVISO: import fallo."
else
  echo "No hay historial_jira.csv — usa el boton Importar Jira en la web."
fi

export DENDRON_NOTES_DIR="${DENDRON_NOTES_DIR:-$(pwd)/notes}"
export PORT="${PORT:-8000}"

echo
echo "[4/4] Levantando JARVIS en http://localhost:${PORT}"
echo "Notas: ${DENDRON_NOTES_DIR}"
node server.js
