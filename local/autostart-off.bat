@echo off
chcp 65001 >nul
schtasks /delete /tn "PriceCheck" /f
echo.
echo Автозапуск выключен.
pause
