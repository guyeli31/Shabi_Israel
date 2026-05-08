@echo off
cd /d "%~dp0"

REM Start server in background if not already running on port 8090
curl -s -o NUL -w "%%{http_code}" http://localhost:8090/index.html 2>NUL | findstr /C:"200" >NUL
if errorlevel 1 (
    echo Starting http-server on port 8090...
    start /B npx http-server -p 8090 --cors -c-1
    timeout /t 2 /nobreak > NUL
) else (
    echo Server already running on port 8090.
)

REM Open the typography editor in the default browser
start http://localhost:8090/typo-editor.html
