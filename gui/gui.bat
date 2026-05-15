@echo off
setlocal EnableExtensions
title DDS Robot GUI (production)

rem For a desktop shortcut: link to THIS file in the repo (do not copy only the .bat to the desktop).
rem Always run from this folder so npm finds package.json and node_modules.
rem For a native Windows installer (no Node on end-user PCs), maintainers run: npm run dist  (see README.md).
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js LTS and ensure "npm" is on your PATH, then try again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run: installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

rem Optional: set BEFORE "npm run build" so the URL is baked into the bundle (not needed at serve time).
rem set "REACT_APP_GRAPHQL_HTTP_URL=http://localhost:8000/graphql"

if /i "%~1"=="rebuild" goto dobuild
if not exist "build\index.html" goto dobuild
goto serve

:dobuild
echo Building optimized production bundle...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  pause
  exit /b 1
)

:serve
echo Serving production build at http://localhost:3000  (fast startup^). Close this window to stop.
echo To force a fresh build after code changes: gui.bat rebuild
echo.
call npm run serve
if errorlevel 1 (
  echo.
  echo [ERROR] npm run serve failed. Is port 3000 already in use?
  pause
  exit /b 1
)

endlocal
