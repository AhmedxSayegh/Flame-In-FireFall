@echo off
rem ==== Build the React frontend into frontend\dist (served by the backend) ====
rem Run this after you change anything in frontend\src. Needs Node.js (npm).
setlocal
cd /d "%~dp0frontend"
where npm >nul 2>nul || ( echo Node.js / npm was not found. Install Node.js LTS from nodejs.org. & if not "%1"=="nopause" pause & exit /b 1 )
if not exist "node_modules" (
  echo Installing frontend packages, first time only...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed. & if not "%1"=="nopause" pause & exit /b 1 )
)
echo Building the frontend...
call npm run build
if errorlevel 1 ( echo Build failed. & if not "%1"=="nopause" pause & exit /b 1 )
echo Done: frontend\dist is ready. Restart start.bat or reload the page.
if not "%1"=="nopause" pause
