@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "node\node.exe" (set "NODE=node\node.exe") else (set "NODE=node")
set PORT=8080
if exist "config.json" for /f %%p in ('"%NODE%" -e "try{console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')).port)}catch{console.log(8080)}"') do set PORT=%%p
netsh advfirewall firewall delete rule name="PriceCheck" >nul 2>&1
netsh advfirewall firewall add rule name="PriceCheck" dir=in action=allow protocol=TCP localport=%PORT% profile=any >nul 2>&1
schtasks /delete /tn "PriceCheck" /f >nul 2>&1
schtasks /create /tn "PriceCheck" /tr "\"%~dp0run-service.bat\"" /sc onstart /ru SYSTEM /rl highest /f >nul 2>&1
if errorlevel 1 exit /b 1
echo done> "%~dp0.setup-v2"
schtasks /run /tn "PriceCheck" >nul 2>&1
