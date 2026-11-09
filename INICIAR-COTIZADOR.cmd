@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Se necesita Node.js para abrir el cotizador.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo Preparando las herramientas del cotizador...
  call npm ci
  if errorlevel 1 (
    echo No se pudieron preparar las herramientas. Revisa la conexion a Internet.
    pause
    exit /b 1
  )
)
echo.
echo Cotizador EM Agency
echo Abre http://127.0.0.1:4173 en tu navegador.
echo Esta es la vista local. Cierra esta ventana para detenerla.
echo.
call npm run dev -- --port 4173 --strictPort

