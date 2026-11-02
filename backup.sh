#!/usr/bin/env bash
# Резервная копия ВСЕХ данных приложения (закупки, матрицы, каталог названий, связи/правки).
# Запускать на VPS из папки проекта:   ./backup.sh
# Секреты (пароль iiko, ключ Google, пароли пользователей) в копию НЕ попадают — их нет в архиве.
#
# По умолчанию копия кладётся локально в ~/pricecheck-backups. Чтобы ещё и отправить её на GitHub,
# создайте ОТДЕЛЬНЫЙ ПРИВАТНЫЙ репозиторий (данные нельзя класть в репозиторий с кодом) и запустите:
#   BACKUP_REPO=git@github.com:ВАШ/приватный-репозиторий.git ./backup.sh
set -euo pipefail

STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="${BACKUP_DIR:-$HOME/pricecheck-backups}"
TMP="$(mktemp -d)"
mkdir -p "$OUT"
trap 'rm -rf "$TMP"' EXIT

echo "→ Консистентная копия базы правок…"
docker exec pricecheck-api node -e "
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'); try { fs.unlinkSync('/app/data/edits.backup.db') } catch {}
new DatabaseSync('/app/data/edits.db').exec(\"VACUUM INTO '/app/data/edits.backup.db'\");
"

echo "→ Копирую данные из контейнера…"
docker cp pricecheck-api:/app/data "$TMP/data"
# в копии — свежий снимок базы, а не «живой» файл; секреты убираем
mv "$TMP/data/edits.backup.db" "$TMP/data/edits.db"
rm -f "$TMP/data/edits.db-wal" "$TMP/data/edits.db-shm" "$TMP/data/users.json"
find "$TMP/data" -name 'settings.json' -delete
docker exec pricecheck-api rm -f /app/data/edits.backup.db

FILE="$OUT/pricecheck-backup-$STAMP.tar.gz"
tar -czf "$FILE" -C "$TMP" data
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
