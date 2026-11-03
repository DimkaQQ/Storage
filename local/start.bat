@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Проверка цен
if exist "node\node.exe" (set "NODE=node\node.exe") else (set "NODE=node")

set PORT=8080
if exist "config.json" for /f %%p in ('"%NODE%" -e "try{console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')).port)}catch{console.log(8080)}"') do set PORT=%%p

if not exist ".setup-done" (
  echo Первая настройка. Сейчас Windows спросит разрешение - нажмите "Да".
  powershell -NoProfile -Command "Start-Process -FilePath netsh -ArgumentList 'advfirewall firewall add rule name=PriceCheck dir=in action=allow protocol=TCP localport=%PORT% profile=any' -Verb RunAs -Wait" >nul 2>&1
  schtasks /create /tn "PriceCheck" /tr "\"%~dp0start.bat\"" /sc onlogon /f >nul 2>&1
  powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\PriceCheck.lnk'); $s.TargetPath='%~dp0start.bat'; $s.WorkingDirectory='%~dp0'; $s.Save()" >nul 2>&1
  netsh advfirewall firewall show rule name=PriceCheck >nul 2>&1
  if errorlevel 1 (
    echo.
    echo ВНИМАНИЕ: доступ для других компьютеров не включён ^(вы нажали "Нет"^). На этом компьютере программа работает.
    echo Чтобы открыть доступ, закройте это окно и снова запустите start.bat, на вопрос Windows нажмите "Да".
    echo.
  ) else (
    echo done> ".setup-done"
  )
)

echo Запускаю Проверку цен... Это окно не закрывайте: пока оно открыто, программа работает.
echo (Адрес для сотрудников будет записан в файл "АДРЕС ДЛЯ СОТРУДНИКОВ.txt")
echo.
"%NODE%" launcher.mjs
echo.
echo Программа остановилась. Если это ошибка — сфотографируйте это окно и отправьте разработчику.
pause
