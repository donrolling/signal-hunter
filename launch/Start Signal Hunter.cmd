@echo off
rem Runs Signal Hunter in your browser, without Live. Close this window to stop it.
title Signal Hunter
cd /d "%~dp0"
"bin\node-win32-x64.exe" server.js --open
pause
