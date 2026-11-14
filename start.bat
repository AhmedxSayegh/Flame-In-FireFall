@echo off
rem ==== Flame in Freefall: start everything at http://127.0.0.1:5000 ====
rem 1) installs the backend's Python packages  2) builds the frontend if needed  3) starts the backend
title Flame in Freefall
cd /d "%~dp0"
set "PY=%USERPROFILE%\miniforge3\python.exe"
if not exist "%PY%" (
  echo Could not find Miniforge Python at %PY%. Edit the PY line in start.bat.
  pause & exit /b 1
)

rem One-time: reuse the API key from the old flame-dashboard folder if backend\.env is missing
if not exist "backend\.env" if exist "..\flame-dashboard\.env" copy "..\flame-dashboard\.env" "backend\.env" >nul
if not exist "backend\.env" copy "backend\.env.example" "backend\.env" >nul

echo Checking Python packages...
"%PY%" -m pip install --disable-pip-version-check -q -r backend\requirements.txt
if errorlevel 1 ( echo Python package install failed. & pause & exit /b 1 )

if not exist "frontend\dist\index.html" (
  echo The frontend is not built yet. Building it now...
  call build-frontend.bat nopause
  cd /d "%~dp0"
  if not exist "frontend\dist\index.html" ( echo Frontend build failed. See the messages above. & pause & exit /b 1 )
)

echo.
echo Open http://127.0.0.1:5000 in your browser. Keep this window open.
"%PY%" backend\app.py
pause
