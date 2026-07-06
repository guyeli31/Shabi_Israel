@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo ===============================================
echo  Shabi Israel - Local site + Local Supabase (Docker)
echo ===============================================

rem --- 1. Make sure Docker Desktop is running ---
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker is not running yet. Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"

    echo Waiting for Docker to become ready, this can take a minute...
    :WAIT_DOCKER
    timeout /t 3 >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        echo   still waiting for Docker...
        goto WAIT_DOCKER
    )
    echo Docker is up.
) else (
    echo Docker is already running.
)

rem --- 2. Make sure the local Supabase stack is running ---
echo Starting local Supabase stack ^(if not already up^)...
pushd supabase-migration
call npx supabase start
popd

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
