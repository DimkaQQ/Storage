@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Проверка цен
if exist "node\node.exe" (set "NODE=node\node.exe") else (set "NODE=node")
set PORT=8080
if exist "config.json" for /f %%p in ('"%NODE%" -e "try{console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')).port)}catch{console.log(8080)}"') do set PORT=%%p

rem 1) программа уже работает (например, запущена в фоне) - просто открываем её
call :probe
if not errorlevel 1 goto running

rem 2) первая настройка: один вопрос Windows, затем программа запускается в фоне и включается вместе с компьютером
if not exist ".setup-v2" (
  echo Первая настройка. Сейчас Windows спросит разрешение - нажмите "Да".
  echo (это нужно, чтобы программа сама включалась вместе с компьютером и открывалась с других компьютеров)
  powershell -NoProfile -Command "Start-Process -FilePath '%~dp0setup-admin.bat' -Verb RunAs -Wait" >nul 2>&1
  if exist ".setup-v2" (
    powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\PriceCheck.lnk'); $s.TargetPath='%~dp0start.bat'; $s.WorkingDirectory='%~dp0'; $s.Save()" >nul 2>&1
    echo Запускаю Проверку цен... подождите несколько секунд.
    timeout /t 12 /nobreak >nul
    call :probe
    if not errorlevel 1 goto running
    echo.
    echo Программа ещё запускается. Подождите минуту и откройте в браузере  http://localhost:%PORT%
    echo Если не откроется - запустите start.bat ещё раз.
    pause
    exit /b
  )
  echo.
  echo Вы нажали "Нет", поэтому программа запустится только в этом окне и без доступа с других компьютеров.
  echo Чтобы включить всё полностью - закройте это окно и снова запустите start.bat, на вопрос Windows нажмите "Да".
  echo.
  goto foreground
)

rem 3) настройка сделана, но программа ещё не отвечает (компьютер только включили) - ждём фоновый запуск
echo Жду запуска программы...
timeout /t 12 /nobreak >nul
call :probe
if not errorlevel 1 goto running
goto foreground

:running
echo.
echo Данные для входа при первом запуске без переноса данных (если есть):
findstr /c:"Почта" /c:"Пароль" "logs\app.log" 2>nul
echo.
echo Адрес для сотрудников:
type "АДРЕС ДЛЯ СОТРУДНИКОВ.txt" 2>nul
start "" "http://localhost:%PORT%"
echo.
echo Программа работает в фоне и сама включается вместе с компьютером. Это окно можно закрыть.
pause
exit /b

:foreground
echo Запускаю Проверку цен... Это окно не закрывайте: пока оно открыто, программа работает.
echo.
"%NODE%" launcher.mjs
echo.
echo Программа остановилась.
echo Если выше написано EADDRINUSE - программа УЖЕ запущена в фоне: просто откройте http://localhost:%PORT%
echo Иначе сфотографируйте это окно и отправьте разработчику.
pause
exit /b

:probe
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
exit /b %errorlevel%
