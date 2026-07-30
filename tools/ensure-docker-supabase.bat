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
rem Escalating repair: probe -> restart Kong -> full stop/start -> give up.
rem Rationale: after a Docker Desktop / WSL restart the stack can be left in a
rem half-dead state where `docker ps` still shows 0.0.0.0:54321->8000 published
rem and every container "healthy", but the host-side port proxy no longer
rem forwards - curl gets an empty reply (exit 52) in a few ms. In that state
rem `supabase start` just prints "already running" and exits 0, so the old
rem probe-then-start logic left the breakage in place and the site loaded with
rem no data ("get_site_bundle recently failed; retry shortly").

call :PROBE && goto SUPA_UP

rem --- 2a. Republish the port by restarting the API gateway ---
set "KONG="
for /f "delims=" %%C in ('docker ps -a --filter "name=supabase_kong" --format "{{.Names}}" 2^>nul') do (
    if not defined KONG set "KONG=%%C"
)
if not defined KONG goto SUPA_COLD

echo [ensure] Supabase port 54321 is not answering - restarting %KONG%...
docker restart "%KONG%" >nul 2>&1
ping -n 6 127.0.0.1 >nul
call :PROBE && goto SUPA_UP

rem --- 2b. Full stop/start of the stack ---
echo [ensure] Gateway restart did not help - cycling the whole stack...
pushd "%~dp0..\supabase-migration"
call npx -y supabase stop
popd
call :PROBE && goto SUPA_UP

:SUPA_COLD
echo [ensure] Starting local Supabase stack...
pushd "%~dp0..\supabase-migration"
rem -y so a missing supabase CLI installs without an interactive prompt
rem (which would hang the non-interactive MCP hook).
call npx -y supabase start
popd
call :PROBE && goto SUPA_UP

echo [ensure] ERROR: http://127.0.0.1:54321 is still not answering.
echo [ensure] The site will load with NO DATA. Check: docker ps, and
echo [ensure]   cd supabase-migration ^&^& npx supabase status
endlocal
exit /b 1

:SUPA_UP
echo [ensure] Supabase is up.

endlocal
exit /b 0

rem ------------------------------------------------------------
rem :PROBE - sets errorlevel 0 only when the REST gateway actually
rem replies over the published host port. Used with `call :PROBE &&`.
rem ------------------------------------------------------------
:PROBE
curl -s -o NUL -m 5 http://127.0.0.1:54321/rest/v1/ >nul 2>&1
exit /b %errorlevel%
