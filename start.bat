@echo off
cd /d "%~dp0"
start http://localhost:3000
npx http-server -p 3000 --cors -c-1
