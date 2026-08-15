@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem Make sure Docker + local Supabase are up before serving, so the site
rem talks to a live DB instead of hanging on "Loading dashboard..." for the
rem 10s fetch timeout. Idempotent + fast when the stack is already running.
call "%~dp0ensure-docker-supabase.bat"
if errorlevel 1 (
    echo.
    echo *** WARNING: local Supabase is unreachable - the site will show
    echo *** "Failed to load leagues". Append ?datasource=files to the URL
    echo *** to browse the static CSV/JSON copies instead.
    echo.
)

set "PORT="
for /l %%P in (8090,1,8094) do (
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
    echo No free port found in range 8090-8094.
    pause
    exit /b 1
)

echo Using port !PORT!
start "" http://localhost:!PORT!/shabi-israel/
call npx -y http-server -p !PORT! --cors -c-1
pause
