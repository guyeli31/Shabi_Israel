@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  ensure-docker-supabase.bat
rem  Make sure Docker Desktop + the local Supabase stack are up.
rem  Idempotent and FAST when everything is already running
rem  (a couple of quick probes, no restarts). Only does the heavy
rem  boot work when something is actually down.
rem
rem  Used by:
rem   - tools\START_SITE.bat  (runs it before serving the site)
rem   - the PreToolUse hook for Playwright MCP (see .claude/settings.local.json)
rem ============================================================

rem --- 1. Docker Desktop daemon ---
docker info >nul 2>&1
if not errorlevel 1 goto DOCKER_UP

echo [ensure] Docker is not running - starting Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo [ensure] Waiting for Docker to become ready (can take a minute)...
:WAIT_DOCKER
rem ping-based sleep (~3s): works when stdin is redirected, unlike `timeout`
rem which errors "input redirection is not supported" under the MCP hook.
ping -n 4 127.0.0.1 >nul
docker info >nul 2>&1
if errorlevel 1 (
    echo   [ensure] still waiting for Docker...
    goto WAIT_DOCKER
)
:DOCKER_UP
echo [ensure] Docker is up.

rem --- 2. Local Supabase REST endpoint (127.0.0.1:54321) ---
rem curl returns 0 on any HTTP reply (even 401 without an apikey) and
rem non-zero only when the connection is refused / times out.
curl -s -o NUL -m 2 http://127.0.0.1:54321/rest/v1/ >nul 2>&1
if not errorlevel 1 goto SUPA_UP

echo [ensure] Starting local Supabase stack (if not already up)...
pushd "%~dp0..\supabase-migration"
rem -y so a missing supabase CLI installs without an interactive prompt
rem (which would hang the non-interactive MCP hook).
call npx -y supabase start
popd
:SUPA_UP
echo [ensure] Supabase is up.

endlocal
exit /b 0
