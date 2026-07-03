@echo off
cd /d "%~dp0"

REM Start server in background if not already running
curl -s -o NUL -w "%%{http_code}" http://localhost:8090/index.html 2>NUL | findstr /C:"200" >NUL
if errorlevel 1 (
    echo Starting http-server on port 8090...
    start /B npx http-server -p 8090 --cors -c-1
    timeout /t 2 /nobreak > NUL
) else (
    echo Server already running on port 8090.
)

REM Open Chrome as app (no browser chrome) at 390x844 CSS pixels with mobile UA
start chrome --app=http://localhost:8090 --window-size=390,844 --user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
