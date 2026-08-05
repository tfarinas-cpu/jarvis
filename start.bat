@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo  JARVIS - Motor de Soluciones HD
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: No se encontro Node.js.
  echo Instala Node.js 18+ desde https://nodejs.org/
  pause
  exit /b 1
)

for /f "delims=" %%i in ('node --version') do echo Usando Node %%i
echo.

where git >nul 2>&1
if %ERRORLEVEL%==0 (
  if exist ".git" (
    echo [1/4] Actualizando repositorio con git pull...
    git pull --ff-only
    if errorlevel 1 (
      echo AVISO: git pull no pudo completarse. Continuando con el codigo local.
    )
  ) else (
    echo [1/4] No hay repositorio git. Se omite git pull.
  )
) else (
  echo [1/4] Git no encontrado. Se omite git pull.
)

echo.
echo [2/4] Instalando dependencias...
if exist "node_modules\express" (
  echo Dependencias ya instaladas. Omitiendo npm install.
) else (
  where npm.cmd >nul 2>&1
  if errorlevel 1 (
    echo AVISO: npm.cmd no encontrado. Ejecuta manualmente: npm install
  ) else (
    call npm.cmd install
    if errorlevel 1 (
      echo ERROR: npm install fallo.
      pause
      exit /b 1
    )
  )
)

echo.
echo [3/4] Sincronizando casos — Jira API tiene prioridad sobre CSV...
node scripts\startup-sync.js
if errorlevel 1 (
  echo AVISO: La sync Jira fallo. JARVIS arrancara con las notas existentes.
  echo Revisa JIRA_EMAIL y JIRA_API_TOKEN en .env
)

if "%DENDRON_NOTES_DIR%"=="" (
  set "DENDRON_NOTES_DIR=%~dp0notes"
)

echo.
echo [4/4] Levantando JARVIS en http://localhost:8000
echo Notas: %DENDRON_NOTES_DIR%
echo.
set PORT=8000
node server.js

pause
