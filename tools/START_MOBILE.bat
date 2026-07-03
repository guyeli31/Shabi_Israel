@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

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

REM Regular Chrome window (address bar + tabs, nothing special) — just a
REM modest phone-sized viewport (402x874, iPhone 17 CSS size) with mobile UA.
REM Uses Playwright's CLI (`playwright open`) instead of raw --window-size:
REM Chrome's --window-size sets the OS window in physical pixels, which on a
REM multi-monitor setup with mixed DPI/resolutions gets misjudged (tested:
REM asked for 402x874, got 1196x752 and other garbage). Playwright's
REM --viewport-size sets the CSS viewport directly via the DevTools protocol
REM (the same mechanism as Chrome's own Device Toolbar / Ctrl+Shift+M),
REM which is exact regardless of monitor geometry — only the OS window's
REM physical size varies, never the page's rendered width.
REM A dedicated --user-data-dir keeps this separate from your normal profile.
REM ?searchoverlay=force triggers the real mobile search sheet (see
REM js/render/searchOverlay.js) since this window has no real touch input.
start /B npx -y playwright open --browser cr --channel chrome --viewport-size "402,874" --user-data-dir "%TEMP%\shabi-israel-mobile-profile" --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" "http://localhost:!PORT!/index.html?searchoverlay=force"

call npx -y http-server -p !PORT! --cors -c-1
pause
