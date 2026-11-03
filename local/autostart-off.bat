@echo off
chcp 65001 >nul
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Нужны права администратора: нажмите на этот файл ПРАВОЙ кнопкой мыши и выберите "Запуск от имени администратора".
  pause
  exit /b 1
)
schtasks /end /tn "PriceCheck" >nul 2>&1
schtasks /delete /tn "PriceCheck" /f
del ".setup-v2" >nul 2>&1
echo.
echo Автозапуск выключен и программа остановлена. Чтобы включить снова - запустите start.bat.
pause
