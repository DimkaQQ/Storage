#!/usr/bin/env bash
# Собирает и запускает приложение в Docker. Запускать на VPS из папки проекта.
#
# На одном сервере живут ДВЕ независимые копии (у каждой своя папка, свой .env, свои данные):
#   разработка  — папка /opt/docker/Storage       (sklad.dimkaprojects.xyz, порт 3000, последняя версия ветки), .env можно не создавать;
#   клиент      — папка /opt/docker/Storage-prod  (horeca.mirelli.eu, порт 3001, версия закреплена), см. DEPLOY.md.
# Различия задаются в .env рядом со скриптом: APP_NAME, WEB_PORT, COMPOSE_PROJECT_NAME, DEPLOY_REF, APP_REF + APP_SRC, CADDY_SITES (см. .env.example).
# Весь скрипт лежит в одном блоке { … }: git checkout может подменить сам deploy.sh, а bash должен дочитать уже прочитанную версию.
set -euo pipefail
cd "$(dirname "$0")"

{
envv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"\r' || true; }

BRANCH="claude/desktop-web-app-build-4nwh3c"
APP_REF="$(envv APP_REF)"         # версия КОДА ПРИЛОЖЕНИЯ копии клиента (может быть старой); скрипты и docker-compose — из DEPLOY_REF/ветки
APP_SRC="$(envv APP_SRC)"
REF="$(envv DEPLOY_REF)"          # пусто — идём за веткой; задан коммит — копия стоит ровно на нём, пока вы сами его не смените
PORT="$(envv WEB_PORT)"; PORT="${PORT:-3000}"
SITES="$(envv CADDY_SITES)"; SITES="${SITES:-sklad.caddy}"

# APP_REF и APP_SRC=.app-src — только вместе (иначе docker compose соберёт не тот код)
if [ -n "$APP_REF" ] && [ "$APP_SRC" != ".app-src" ]; then echo "✗ В .env есть APP_REF, но нет строки APP_SRC=.app-src"; exit 1; fi
if [ -z "$APP_REF" ] && [ -n "$APP_SRC" ]; then echo "✗ В .env есть APP_SRC, но нет APP_REF (уберите APP_SRC, чтобы вернуться к последней версии)"; exit 1; fi

echo "→ Обновляю код…"
if [ -n "$REF" ]; then
  echo "  версия скриптов закреплена на $REF"
  git fetch origin "$BRANCH"; git fetch origin
  git checkout --detach "$REF" || { echo "✗ Коммит $REF не найден — проверьте DEPLOY_REF в .env"; exit 1; }
  # закреплённый коммит должен уметь жить рядом с другой копией (APP_NAME/WEB_PORT в docker-compose.yml)
  if ! grep -q "APP_NAME" docker-compose.yml; then
    echo "✗ Коммит $REF старше разделения копий (в docker-compose.yml нет APP_NAME): перезапуск затронул бы копию разработки. Выберите более новый коммит."; exit 1
  fi
else
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
fi

if [ -n "$APP_REF" ]; then
  echo "→ Код приложения — версия $APP_REF (папка .app-src)…"
  git fetch origin "$APP_REF" 2>/dev/null || true
  git cat-file -e "$APP_REF^{commit}" 2>/dev/null || { echo "✗ Коммит $APP_REF не найден — проверьте APP_REF в .env"; exit 1; }
  if [ -e .app-src/.git ]; then
    git -C .app-src checkout --detach -f "$APP_REF"
  else
    rm -rf .app-src; git worktree prune
    git worktree add --detach .app-src "$APP_REF"
  fi
fi

echo "→ Собираю и перезапускаю контейнер…"
docker compose up -d --build

if [ -d /etc/caddy ] && command -v caddy >/dev/null 2>&1; then
  echo "→ Обновляю блоки Caddy ($SITES)…"
  sudo mkdir -p /etc/caddy/sites
  for f in $SITES; do sudo install -m 644 "caddy/$f" "/etc/caddy/sites/$f"; done
  if sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    sudo systemctl reload caddy
  else
    echo "  ⚠ Caddyfile не проходит проверку, Caddy не перезагружен (sudo caddy validate --config /etc/caddy/Caddyfile)"
  fi
fi

if [ -f /etc/caddy/sites/horeca.caddy ] && grep -q "127.0.0.1:3000" /etc/caddy/sites/horeca.caddy; then
  echo "  ⚠ horeca.mirelli.eu пока указывает на порт 3000 (РАЗРАБОТКА). Настройте копию клиента: DEPLOY.md → «Две версии на одном сервере»."
fi

echo "→ Готово. Локальная проверка:"
sleep 2
curl -fsS -o /dev/null -w "  http://127.0.0.1:$PORT  →  HTTP %{http_code}\n" "http://127.0.0.1:$PORT" || true
echo "  Контейнеры:"
docker compose ps
exit 0
}
