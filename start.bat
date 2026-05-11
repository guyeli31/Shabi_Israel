@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT="
for /l %%P in (8090,1,8094) do (
    if not defined PORT (
        netstat -ano -p tcp | findstr /c:":%%P " | findstr /c:"LISTENING" >nul
        if errorlevel 1 (
            set "PORT=%%P"
        ) else (
            echo Port %%P is in use, trying next...
        )
    )
)

if not defined PORT (
    echo No free port found in range 8090-8094.
    pause
    exit /b 1
)

echo Using port !PORT!
start "" http://localhost:!PORT!
call npx -y http-server -p !PORT! --cors -c-1
pause
