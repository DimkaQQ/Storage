#!/usr/bin/env bash
# Заливает в копию КЛИЕНТА его данные из restore.tar (из «Скачать бэкап» его прежней программы) — для версий, где нет кнопки
# «Восстановить всё из копии». Запускать на сервере из папки копии клиента:   bash restore-data.sh /путь/к/restore.tar
# ЗАМЕНЯЕТ все данные этой копии (организации, пользователей, закупки, привязки, настройки, доступы iiko/Google) данными из файла.
# Перед заменой текущие данные сохраняются в ~/<APP_NAME>-before-restore-<время>.tar.gz. Логины и пароли — те, что были в программе клиента.
# Если что-то пошло не так, контейнер запускается обратно, а путь к сохранённым данным выводится.
set -euo pipefail
cd "$(dirname "$0")"
envv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"\r' || true; }
APP="$(envv APP_NAME)"; APP="${APP:-pricecheck}"
FILE="${1:?Укажите файл: bash restore-data.sh /путь/к/restore.tar}"
[ -f "$FILE" ] || { echo "✗ Нет файла $FILE"; exit 1; }
tar -tf "$FILE" | grep -qx "orgs.json" || { echo "✗ Это не копия программы (нет orgs.json в архиве)"; exit 1; }
docker inspect "$APP-api" >/dev/null 2>&1 || { echo "✗ Нет контейнера $APP-api — сначала bash deploy.sh"; exit 1; }

TMP="$(mktemp -d)"; SAFE="$HOME/$APP-before-restore-$(date +%Y-%m-%d_%H%M%S).tar.gz"
cleanup() { rc=$?; rm -rf "$TMP"; if [ $rc -ne 0 ]; then docker start "$APP-api" >/dev/null 2>&1 || true; echo "✗ Не получилось. Контейнер запущен обратно. Прежние данные сохранены: $SAFE (если файл создан)"; fi; }
trap cleanup EXIT

echo "→ Проверяю архив…"
mkdir -p "$TMP/new" && tar -xf "$FILE" -C "$TMP/new"
[ -f "$TMP/new/orgs.json" ] && [ -d "$TMP/new/orgs" ] || { echo "✗ В архиве нет orgs.json или папки orgs"; exit 1; }

echo "→ Останавливаю $APP-api и сохраняю текущие данные: $SAFE"
docker stop "$APP-api" >/dev/null
mkdir -p "$TMP/old" && docker cp "$APP-api:/app/data/." "$TMP/old/" && tar -czf "$SAFE" -C "$TMP/old" . && chmod 600 "$SAFE"
tar -tzf "$SAFE" >/dev/null

echo "→ Заменяю данные данными из $FILE…"
docker run --rm --volumes-from "$APP-api" alpine sh -c 'find /app/data -mindepth 1 -delete'
docker cp "$TMP/new/." "$APP-api:/app/data/"
docker start "$APP-api" >/dev/null
trap - EXIT; rm -rf "$TMP"
echo "✓ Готово. Заходите прежним логином клиента. Данные до замены лежат в $SAFE"
