@echo off
rem ==== Development mode: edit the frontend and see changes instantly ====
rem Starts the backend in its own window (port 5000), then the Vite dev server (port 5173).
rem Open http://localhost:5173 . Every /api call is forwarded to the backend (see frontend\vite.config.ts).
title Flame in Freefall (frontend dev server)
cd /d "%~dp0"
set "PY=%USERPROFILE%\miniforge3\python.exe"
if not exist "backend\.env" if exist "..\flame-dashboard\.env" copy "..\flame-dashboard\.env" "backend\.env" >nul
if not exist "backend\.env" copy "backend\.env.example" "backend\.env" >nul
"%PY%" -m pip install --disable-pip-version-check -q -r backend\requirements.txt
start "Flame in Freefall backend" "%PY%" backend\app.py
cd frontend
if not exist "node_modules" call npm install --no-audit --no-fund
call npm run dev
pause
