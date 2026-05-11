@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT="
for /l %%P in (8090,1,8110) do (
    if not defined PORT (
        netstat -ano -p tcp | findstr /r /c:":%%P  *LISTENING" >nul
        if errorlevel 1 set "PORT=%%P"
    )
)

if not defined PORT (
    echo No free port found in range 8090-8110.
    pause
    exit /b 1
)

echo Using port !PORT!
start "" http://localhost:!PORT!
call npx -y http-server -p !PORT! --cors -c-1
pause
