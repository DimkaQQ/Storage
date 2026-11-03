#!/usr/bin/env bash
# Собирает архив для установки на один компьютер: pricecheck-local-win.zip (с встроенным Node.js для Windows)
# и pricecheck-local.zip (без Node, для Mac/Linux). Запускать из корня проекта:  ./local/build-package.sh
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_VER="${NODE_VER:-22.22.0}"
OUT="local-build"
rm -rf "$OUT"; mkdir -p "$OUT"

echo "→ Собираю сайт…"
npm run build >/dev/null

stage() { # $1 = папка
  local d="$1"
  mkdir -p "$d/server" "$d/dist" "$d/data"
  cp -r dist/. "$d/dist/"
  cp -r server/src server/seed server/package.json server/package-lock.json "$d/server/"
  (cd "$d/server" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
  cp local/launcher.mjs local/README.txt "$d/"
}

echo "→ Пакет для Windows (с Node.js $NODE_VER)…"
W="$OUT/pricecheck"; stage "$W"
cp local/start.bat local/open-firewall.bat local/autostart-off.bat "$W/"
ZIPFILE="$OUT/node-win.zip"
[ -f "$ZIPFILE" ] || curl -fsSL -o "$ZIPFILE" "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-win-x64.zip"
python3 -I - "$ZIPFILE" "$W/node" "$NODE_VER" <<'PY'
import sys, zipfile, os
z, dest, ver = sys.argv[1:4]
os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(z) as f:
    for n in ('node.exe',):
        data = f.read(f'node-v{ver}-win-x64/{n}')
        open(os.path.join(dest, n), 'wb').write(data)
PY
python3 -I -c "import shutil; shutil.make_archive('$OUT/pricecheck-local-win', 'zip', '$OUT', 'pricecheck')"

echo "→ Пакет для Mac/Linux…"
M="$OUT/pricecheck-mac-linux/pricecheck"; stage "$M"
cp local/start.sh "$M/"; chmod +x "$M/start.sh"
python3 -I -c "import shutil; shutil.make_archive('$OUT/pricecheck-local', 'zip', '$OUT/pricecheck-mac-linux', 'pricecheck')"

ls -lh "$OUT"/*.zip
