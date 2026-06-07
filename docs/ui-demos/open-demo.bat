@echo off
REM ============================================================================
REM  Shabi Israel — Modern Data-UI Patterns Demo
REM  Double-click this file to open the demo in your default browser.
REM  - Probes the local http-server on port 8090.
REM  - If it isn't running, starts it in a minimised background window.
REM  - Then opens the demo URL.
REM ============================================================================

setlocal
title Shabi Israel — UI Demo Launcher

REM Move to repo root (this BAT lives in docs\ui-demos\)
pushd "%~dp0..\.."

set "PORT=8090"
set "URL=http://localhost:%PORT%/docs/ui-demos/progressive-disclosure-demo.html"

echo.
echo  [1/3] Probing http://localhost:%PORT% ...

REM curl ships with Windows 10 1803+. -s silent, -o NUL discard body, -w write status.
REM %% escapes % inside a BAT file.
for /f %%C in ('curl -s -o NUL -w "%%{http_code}" http://localhost:%PORT%/index.html 2^>NUL') do set "PROBE=%%C"

if "%PROBE%"=="200" (
    echo        Server already up. Reusing it.
    goto :open
)

echo        Server not running. Starting npx http-server ...
echo  [2/3] Launching http-server on port %PORT% in a background window ...
start "Shabi Israel http-server (port %PORT%)" /MIN cmd /k "npx http-server -p %PORT% --cors -c-1"

REM Give Node a moment to bind the port. 4 seconds is enough for a warm cache;
REM if npx has to download http-server the first time you may need more.
timeout /t 4 /nobreak >NUL

REM Re-probe — if still not up, warn but try to open the URL anyway.
for /f %%C in ('curl -s -o NUL -w "%%{http_code}" http://localhost:%PORT%/index.html 2^>NUL') do set "PROBE=%%C"
if not "%PROBE%"=="200" (
    echo        Warning: server still not responding ^(HTTP %PROBE%^).
    echo        It may still be installing http-server via npx. Waiting 6 more seconds...
    timeout /t 6 /nobreak >NUL
)

:open
echo  [3/3] Opening demo: %URL%
start "" "%URL%"

popd
endlocal
exit /b 0
