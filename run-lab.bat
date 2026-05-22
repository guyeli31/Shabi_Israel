@echo off
setlocal

REM ============================================================
REM  run-lab.bat — start the dev server (if needed) and open
REM  the Player Page Lab in the default browser.
REM ============================================================

set "URL=http://localhost:8090/player-page-lab.html"
set "PROBE=http://localhost:8090/index.html"

REM Probe whether http-server is already up on 8090.
curl -sf -o NUL "%PROBE%"
if %errorlevel%==0 (
    echo Dev server already running on port 8090 - reusing.
) else (
    echo Starting http-server on port 8090...
    start "Shabi Israel Dev Server" /MIN cmd /c "npx http-server -p 8090 --cors -c-1"
    REM Give it a moment to bind before opening the browser.
    timeout /t 3 /nobreak >nul
)

echo Opening %URL% ...
start "" "%URL%"

endlocal
