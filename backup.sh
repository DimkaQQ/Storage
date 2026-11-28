#!/usr/bin/env bash
# Резервная копия ВСЕХ данных приложения (закупки, матрицы, каталог названий, связи/правки).
# Запускать на VPS из папки проекта:   ./backup.sh
# Секреты (пароль iiko, ключ Google, пароли пользователей, ключ подписи входа) в копию НЕ попадают — их нет в архиве.
#
# Перенос на компьютер клиента («локальная установка», папка local/): нужна ПОЛНАЯ копия, вместе с пользователями
# и настройками подключения — запускайте  FULL=1 ./backup.sh  (в архиве будут пароли! Не отправляйте его посторонним).
# Содержимое архива (папку data) положите в папку data установленной программы, пока она остановлена.
#
# По умолчанию копия кладётся локально в ~/pricecheck-backups. Чтобы ещё и отправить её на GitHub,
# создайте ОТДЕЛЬНЫЙ ПРИВАТНЫЙ репозиторий (данные нельзя класть в репозиторий с кодом) и запустите:
#   BACKUP_REPO=git@github.com:ВАШ/приватный-репозиторий.git ./backup.sh
set -euo pipefail
cd "$(dirname "$0")"
umask 077   # файлы копий (в FULL-режиме с паролями) — только для владельца с момента создания

envv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"\r' || true; }
APP="$(envv APP_NAME)"; APP="${APP:-pricecheck}"   # имя копии берём ТОЛЬКО из .env этой папки (у версии клиента — pricecheck-prod)
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="${BACKUP_DIR:-$HOME/$APP-backups}"
TMP="$(mktemp -d)"
mkdir -p "$OUT"
trap 'rm -rf "$TMP"' EXIT

echo "→ Консистентная копия базы правок…"
docker exec $APP-api node -e "
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'); try { fs.unlinkSync('/app/data/edits.backup.db') } catch {}
new DatabaseSync('/app/data/edits.db').exec(\"VACUUM INTO '/app/data/edits.backup.db'\");
"

echo "→ Копирую данные из контейнера…"
docker cp $APP-api:/app/data "$TMP/data"
# в копии — свежий снимок базы, а не «живой» файл; секреты убираем
mv "$TMP/data/edits.backup.db" "$TMP/data/edits.db"
rm -f "$TMP/data/edits.db-wal" "$TMP/data/edits.db-shm" "$TMP/data/jwt-secret.txt"
if [ "${FULL:-}" != "1" ]; then
  rm -f "$TMP/data/users.json"
  find "$TMP/data" -name 'settings.json' -delete
else
  echo "⚠ ПОЛНАЯ копия: в архиве пароли и ключи — храните и передавайте только владельцу."
fi
docker exec $APP-api rm -f /app/data/edits.backup.db

SUFFIX=""; [ "${FULL:-}" = "1" ] && SUFFIX="-FULL"
FILE="$OUT/$APP-backup$SUFFIX-$STAMP.tar.gz"
tar -czf "$FILE" -C "$TMP" data
chmod 600 "$FILE"
echo "✓ Готово: $FILE ($(du -h "$FILE" | cut -f1))"

if [ -n "${BACKUP_REPO:-}" ]; then
  echo "→ Отправляю на GitHub (приватный репозиторий)…"
  REPO_DIR="$OUT/.repo"
  if [ ! -d "$REPO_DIR/.git" ]; then git clone "$BACKUP_REPO" "$REPO_DIR"; fi
  cp "$FILE" "$REPO_DIR/"
  cd "$REPO_DIR"
  git add -A
  git commit -m "Бэкап $STAMP" -q
  git push -q
  echo "✓ Отправлено на GitHub"
fi

# хранить копии за последние KEEP_DAYS дней (по умолчанию 30): чистим только ПОСЛЕ того, как новая копия готова и отправлена.
# Папка BACKUP_DIR должна быть отдельной, только для копий этой программы.
find "$OUT" -maxdepth 1 -name "$APP-backup*.tar.gz" -mtime +"${KEEP_DAYS:-30}" -delete || true
