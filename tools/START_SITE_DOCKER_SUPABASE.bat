@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo ===============================================
echo  Shabi Israel - Local site + Local Supabase (Docker)
echo ===============================================

rem --- 1+2. Docker Desktop + the local Supabase stack ---
rem Single source of truth, shared with START_SITE.bat and the Playwright MCP
rem hook. It also repairs a half-dead stack (published-but-dead port proxy),
rem which a bare `supabase start` reports as "already running".
call "%~dp0ensure-docker-supabase.bat"
if errorlevel 1 (
    echo.
    echo *** WARNING: local Supabase is unreachable - the site will show
    echo *** "Failed to load leagues". Append ?datasource=files to the URL
    echo *** to browse the static CSV/JSON copies instead.
    echo.
)

rem --- 3. Find a free port and start the local web server ---
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
echo Site will connect to the LOCAL Supabase ^(Docker^) since it's opened via localhost.
start "" http://localhost:!PORT!
call npx -y http-server -p !PORT! --cors -c-1
pause
