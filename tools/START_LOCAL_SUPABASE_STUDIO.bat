@echo off
setlocal
cd /d "%~dp0.."

echo ===============================================
echo  Shabi Israel - Local Supabase Studio (Docker)
echo ===============================================

rem --- Make sure Docker Desktop is running ---
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

rem --- Make sure the local Supabase stack is running ---
echo Starting local Supabase stack ^(if not already up^)...
pushd supabase-migration
call npx supabase start
popd

echo Opening local Supabase Studio...
start "" "http://127.0.0.1:54323"
