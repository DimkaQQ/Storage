@echo off
chcp 65001 >nul
cd /d "%~dp0"
schtasks /create /tn "PriceCheck" /tr "\"%~dp0start.bat\"" /sc onlogon /rl highest /f
echo.
echo Готово: программа будет запускаться сама при входе в Windows.
pause
