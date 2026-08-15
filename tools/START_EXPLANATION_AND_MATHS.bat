@echo off
setlocal
cd /d "%~dp0.."

REM ============================================================
REM  START_EXPLANATION_AND_MATHS.bat — start the dev server (if needed) and
REM  open the Explanation and Maths tool (question-mark explanations +
REM  Luck Confidence Lab).
REM ============================================================

set "URL=http://localhost:8090/shabi-israel/explanation-and-maths.html"
set "PROBE=http://localhost:8090/shabi-israel/index.html"

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
