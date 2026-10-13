#!/usr/bin/env bash
# Собирает и запускает приложение в Docker. Запускать на VPS из папки проекта.
set -euo pipefail
cd "$(dirname "$0")"

BRANCH="claude/desktop-web-app-build-4nwh3c"

echo "→ Обновляю код (ветка $BRANCH)…"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "→ Собираю и перезапускаю контейнер…"
docker compose up -d --build

echo "→ Готово. Локальная проверка:"
sleep 2
curl -fsS -o /dev/null -w "  http://127.0.0.1:3000  →  HTTP %{http_code}\n" http://127.0.0.1:3000 || true
echo "  Контейнер:"
docker compose ps
