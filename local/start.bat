@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Проверка цен
if exist "node\node.exe" (set "NODE=node\node.exe") else (set "NODE=node")
echo Запускаю Проверку цен... Это окно не закрывайте — пока оно открыто, программа работает.
echo.
"%NODE%" launcher.mjs
echo.
echo Программа остановилась. Если это ошибка — сфотографируйте это окно и отправьте разработчику.
pause
