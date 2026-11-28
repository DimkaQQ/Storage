#!/usr/bin/env bash
# Запуск на Mac/Linux (нужен установленный Node.js 22.13 или новее: https://nodejs.org)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Не найден Node.js. Установите версию 22 LTS с https://nodejs.org"; exit 1; fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then echo "Нужен Node.js 22 или новее (сейчас $(node -v))."; exit 1; fi
echo "Запускаю Проверку цен... Окно не закрывайте."
exec node launcher.mjs
