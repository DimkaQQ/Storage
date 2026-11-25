#!/usr/bin/env bash
# Ставит ЕЖЕДНЕВНЫЙ автоматический бэкап на сервере (каждую ночь в 03:15, хранится 30 дней в ~/pricecheck-backups).
# Запускать на VPS один раз из папки проекта:   ./install-backup-cron.sh
# Копия ПОЛНАЯ (FULL=1: с пользователями и настройками, в архиве есть пароли) — файлы с правами только для владельца.
# Хотите без паролей — запустите  FULL=0 ./install-backup-cron.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${BACKUP_DIR:-$HOME/pricecheck-backups}"
mkdir -p "$OUT"; chmod 700 "$OUT"
LINE="15 3 * * * cd $DIR && FULL=${FULL:-1} BACKUP_DIR=$OUT ./backup.sh >> $OUT/backup.log 2>&1 # pricecheck-backup"
( crontab -l 2>/dev/null | grep -v '# pricecheck-backup' || true; echo "$LINE" ) | crontab -
echo "✓ Ежедневный бэкап включён: каждую ночь в 03:15, папка $OUT, хранится 30 дней."
echo "  Проверить сразу:  ./backup.sh   (лог: $OUT/backup.log)"
echo "  ВАЖНО: копии лежат на том же сервере. Чтобы они пережили потерю сервера, скачивайте их к себе: ./pull-backup.sh"
