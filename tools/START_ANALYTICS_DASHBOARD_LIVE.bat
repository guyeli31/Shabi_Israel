@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

REM ============================================================
REM  Analytics Dashboard (LIVE / cloud) launcher
REM  Opens analytics.html against the PRODUCTION Supabase project,
REM  showing real visitor data from the live domain — not the local
REM  Docker sandbox (compare: START_ANALYTICS_DASHBOARD.bat, which
REM  opens via "localhost" and therefore reads the local Docker DB).
REM
REM  Trick: js/data/supabaseClient.js only treats the exact hostnames
REM  "localhost"/"127.0.0.1" as local. 127.0.0.2 is still loopback
REM  (routes to this machine, no config needed) but isn't in that
REM  list, so the site connects to the cloud project instead — while
REM  still being served from a plain local http-server, no deploy
REM  needed.
REM ============================================================

REM --- Reuse a server already listening on 8090 (project default) ---
netstat -ano -p tcp | findstr /c:":8090 " | findstr /c:"LISTENING" >nul
if not errorlevel 1 (
    echo Reusing existing server on port 8090.
    start "" "http://127.0.0.2:8090/shabi-israel/analytics.html"
    echo Live Analytics Dashboard opened. You can close this window.
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

REM Give the server a moment to bind, then open the dashboard in the default browser.
timeout /t 2 >nul
start "" "http://127.0.0.2:!PORT!/shabi-israel/analytics.html"

echo.
echo Live Analytics Dashboard: http://127.0.0.2:!PORT!/shabi-israel/analytics.html
echo This reads the PRODUCTION Supabase project (real visitor data).
echo The server runs in the minimized "Shabi http-server (!PORT!)" window.
echo Close that window to stop the server.
pause
