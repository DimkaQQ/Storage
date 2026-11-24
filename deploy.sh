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

if [ -d /etc/caddy ] && command -v caddy >/dev/null 2>&1; then
  echo "→ Обновляю блоки Caddy (все домены из папки caddy/)…"
  sudo mkdir -p /etc/caddy/sites
  for f in caddy/*.caddy; do sudo install -m 644 "$f" "/etc/caddy/sites/$(basename "$f")"; done
  if sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    sudo systemctl reload caddy
  else
    echo "  ⚠ Caddyfile не проходит проверку, Caddy не перезагружен (sudo caddy validate --config /etc/caddy/Caddyfile)"
  fi
fi

echo "→ Готово. Локальная проверка:"
sleep 2
curl -fsS -o /dev/null -w "  http://127.0.0.1:3000  →  HTTP %{http_code}\n" http://127.0.0.1:3000 || true
echo "  Контейнер:"
docker compose ps
