@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

REM ============================================================
REM  Banner Editor launcher
REM  Opens banner-poc.html (the hybrid hero-banner designer).
REM  The page loads ES modules + CSS via relative paths and reads
REM  assets/banner/banner-config.json, so it MUST be served over
REM  http:// (not opened as a file). "Save to site" writes the
REM  config file directly via the File System Access API (Chrome).
REM  Reuses an http-server already on 8090; otherwise starts one
REM  on the first free port in 8090-8099.
REM ============================================================

REM --- Reuse a server already listening on 8090 (project default) ---
netstat -ano -p tcp | findstr /c:":8090 " | findstr /c:"LISTENING" >nul
if not errorlevel 1 (
    echo Reusing existing server on port 8090.
    start "" "http://localhost:8090/shabi-israel/banner-poc.html"
    echo Banner Editor opened. You can close this window.
    timeout /t 2 >nul
    exit /b 0
)

REM --- No server on 8090 — find a free port in 8090-8099 ---
set "PORT="
for /l %%P in (8090,1,8099) do (
    if not defined PORT (
        netstat -ano -p tcp | findstr /c:":%%P " | findstr /c:"LISTENING" >nul
        if errorlevel 1 (
            set "PORT=%%P"
        ) else (
            echo Port %%P is in use, trying next...
        )
    )
)

if not defined PORT (
    echo No free port found in range 8090-8099.
    pause
    exit /b 1
)

echo Starting server on port !PORT!...
REM Server runs in its own minimized window so it survives after this one closes.
start "Shabi http-server (!PORT!)" /min cmd /c npx -y http-server -p !PORT! --cors -c-1

REM Give the server a moment to bind, then open the editor in the default browser.
timeout /t 2 >nul
start "" "http://localhost:!PORT!/shabi-israel/banner-poc.html"

echo.
echo Banner Editor: http://localhost:!PORT!/shabi-israel/banner-poc.html
echo The server runs in the minimized "Shabi http-server (!PORT!)" window.
echo Close that window to stop the server.
pause
