@echo off
rem Фоновый запуск (сам включается вместе с компьютером, без входа в Windows) и сам перезапускается после сбоя.
cd /d "%~dp0"
if exist "node\node.exe" (set "NODE=node\node.exe") else (set "NODE=node")
if not exist "logs" mkdir "logs"
set NO_BROWSER=1
:loop
"%NODE%" launcher.mjs >> "logs\app.log" 2>&1
timeout /t 10 /nobreak >nul
goto loop
