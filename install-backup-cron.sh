#!/usr/bin/env bash
# Ставит ЕЖЕДНЕВНЫЙ автоматический бэкап на сервере (каждую ночь в 03:15 (у копии клиента — 03:45), хранится 30 дней в ~/pricecheck-backups).
# Запускать на VPS один раз из папки проекта:   ./install-backup-cron.sh
# Копия ПОЛНАЯ (FULL=1: с пользователями и настройками, в архиве есть пароли) — файлы с правами только для владельца.
# Хотите без паролей — запустите  FULL=0 ./install-backup-cron.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
envv() { grep -E "^$1=" "$DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"\r' || true; }
APP="$(envv APP_NAME)"; APP="${APP:-pricecheck}"
OUT="${BACKUP_DIR:-$HOME/$APP-backups}"
mkdir -p "$OUT"; chmod 700 "$OUT"
MIN=15; [ "$APP" != "pricecheck" ] && MIN=45   # копия клиента — на 30 минут позже, чтобы две копии не бэкапились одновременно
LINE="$MIN 3 * * * cd $DIR && FULL=${FULL:-1} BACKUP_DIR=$OUT ./backup.sh >> $OUT/backup.log 2>&1 # $APP-backup"
( crontab -l 2>/dev/null | grep -v "# $APP-backup" || true; echo "$LINE" ) | crontab -
echo "✓ Ежедневный бэкап включён: каждую ночь в 03:15 (у копии клиента — 03:45), папка $OUT, хранится 30 дней."
echo "  Проверить сразу:  ./backup.sh   (лог: $OUT/backup.log)"
echo "  ВАЖНО: копии лежат на том же сервере. Чтобы они пережили потерю сервера, скачивайте их к себе: ./pull-backup.sh"
