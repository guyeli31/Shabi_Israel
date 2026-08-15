@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "PORT="
for /l %%P in (8090,1,8099) do (
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
    echo No free port found in range 8090-8099.
    pause
    exit /b 1
)

echo Using port !PORT!

REM Regular Chrome window (address bar + tabs, nothing special) driven by
REM Playwright's CLI (`playwright open`) rather than raw Chrome flags: Chrome's
REM --window-size sets the OS window in PHYSICAL pixels, which on a multi-monitor
REM setup with mixed DPI gets misjudged (tested: asked for 402x874, got 1196x752
REM and other garbage). Playwright sets the CSS viewport directly over the
REM DevTools protocol — the same mechanism as Chrome's Device Toolbar — so the
REM rendered width is exact regardless of monitor geometry.
REM
REM --device does what --viewport-size + --user-agent could NOT: it sets
REM `hasTouch` on the browser context, so `pointer: coarse` / maxTouchPoints /
REM ontouchstart are all real, and the site's isTouchDevice() (js/render/searchOverlay.js)
REM returns true on EVERY page. The old window faked mobile with a viewport and a
REM UA string and then leaned on ?searchoverlay=force to reach the search sheet —
REM but that param belongs to ONE url, so the first navigation (hub → a league)
REM silently dropped the preview back to a narrow desktop. Touch has to come from
REM the context at creation; there is no runtime way to add it.
REM
REM The device MUST be a Chromium one. Every descriptor carries a
REM `defaultBrowserType`, and --device applies it — overriding --browser cr — so
REM "iPhone 15 Pro Max" (defaultBrowserType: webkit) makes the CLI try to open
REM WebKit with `--channel chrome` and die on `Unsupported webkit channel
REM "chrome"`. "Pixel 10 Pro" is 427x876 dsf3 with hasTouch and
REM defaultBrowserType: chromium — 3px narrower than the iPhone, on the engine
REM this project is actually tested against.
REM A dedicated --user-data-dir keeps this separate from your normal profile.
start /B npx -y playwright open --browser cr --channel chrome --device "Pixel 10 Pro" --user-data-dir "%TEMP%\shabi-israel-mobile-profile" "http://localhost:!PORT!/shabi-israel/index.html"

call npx -y http-server -p !PORT! --cors -c-1
pause
