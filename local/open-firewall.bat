@echo off
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Нужны права администратора: нажмите на этот файл ПРАВОЙ кнопкой мыши и выберите "Запуск от имени администратора".
  pause
  exit /b 1
)
if exist "node\node.exe" (set "NODE=node\node.exe") else (set "NODE=node")
set PORT=8080
for /f %%p in ('"%NODE%" -e "try{console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')).port)}catch{console.log(8080)}"') do set PORT=%%p
netsh advfirewall firewall delete rule name="PriceCheck" >nul 2>&1
netsh advfirewall firewall add rule name="PriceCheck" dir=in action=allow protocol=TCP localport=%PORT% profile=any
echo.
echo Готово: другие компьютеры в этой сети смогут открыть программу (порт %PORT%).
pause
