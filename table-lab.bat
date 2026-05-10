@echo off
cd /d "%~dp0"

:: Check if server is already running on 8090
curl -s -o nul -w "%%{http_code}" http://localhost:8090/index.html 2>nul | findstr "200" >nul
if %errorlevel%==0 (
    echo Server already running on port 8090.
    start http://localhost:8090/table-lab/
) else (
    echo Starting server on port 8090...
    start http://localhost:8090/table-lab/
    npx http-server -p 8090 --cors -c-1
)
