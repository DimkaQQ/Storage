#!/usr/bin/env bash
# Скачивает бэкапы с сервера на ЭТОТ компьютер (запускать у себя дома/на своём ноутбуке, не на сервере):
#   ./pull-backup.sh пользователь@адрес-сервера [папка-для-копий]
# Скачиваются только новые файлы; уже скачанные не трогаются. Лучше поставить на ежедневный запуск (cron / Планировщик задач).
set -euo pipefail
SERVER="${1:?Укажите сервер: ./pull-backup.sh пользователь@адрес-сервера}"
REMOTE_DIR="${REMOTE_DIR:-pricecheck-backups}"   # у версии клиента — pricecheck-prod-backups
DEST="${2:-$HOME/$REMOTE_DIR-copy}"                # у каждой копии своя папка
mkdir -p "$DEST"; chmod 700 "$DEST"
rsync -av --ignore-existing --include='*-backup*.tar.gz' --exclude='*' "$SERVER:$REMOTE_DIR/" "$DEST/"
echo "✓ Копии лежат в $DEST ($(ls "$DEST"/*-backup*.tar.gz 2>/dev/null | wc -l) шт.)"
