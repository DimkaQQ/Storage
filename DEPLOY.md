# Развёртывание на VPS (замена priceguard)

Приложение состоит из двух контейнеров (docker-compose):
- **web** — фронтенд (nginx, отдаёт сайт на порту 3000);
- **api** — бэкенд (Node), тянет закупки из iiko, хранит настройки и плановые
  цены в volume `pricecheck-data`.

`docker compose up -d --build` собирает и запускает оба. Бэкенд работает сразу
в **демо-режиме** (встроенные данные) — подключение к iiko настраивается уже в
интерфейсе, в разделе **«Обновление»**. Если бэкенд недоступен, фронт
автоматически показывает последние данные, сайт не падает.

Ниже — безопасный план замены: поднимаем новую систему **рядом**, проверяем, и
только потом переключаем домен и гасим старое.

---

## Шаг 0. Диагностика — что сейчас крутится

Зайдите на сервер по SSH и выполните команды. Скопируйте вывод — по нему
понятно, как заменять.

```bash
# что слушает порты (ищем :80, :443 и порт старого приложения)
sudo ss -tlnp

# запущены ли контейнеры Docker
docker ps

# какой веб-сервер стоит впереди (обычно nginx держит домен и HTTPS)
sudo nginx -T 2>/dev/null | grep -E "server_name|proxy_pass|root|listen" | head -50

# systemd-сервисы с похожим именем
systemctl list-units --type=service | grep -iE "price|guard|node|pm2" || true
```

Ключевой вопрос: **priceguard — это Docker-контейнер или папка со статикой,
которую раздаёт nginx?** Ответ виден из `docker ps` и `nginx -T`.

---

## Вариант A. Docker (рекомендуется — так же, как было раньше)

Нужен установленный Docker. Проверить: `docker --version`.

```bash
# 1. Забрать проект (первый раз)
git clone <URL-репозитория> pricecheck
cd pricecheck
git checkout claude/desktop-web-app-build-4nwh3c

# 2. Собрать и запустить на порту 8080 (рядом со старым, ничего не ломаем)
docker compose up -d --build

# 3. Проверить, что новая система отвечает
curl -I http://127.0.0.1:8080        # ждём HTTP/1.1 200 OK
```

Откройте `http://IP-СЕРВЕРА:8080` в браузере — убедитесь, что открывается
новый дашборд. Если да — переходите к разделу «Переключение домена».

> В следующий раз для обновления достаточно `./deploy.sh` из папки проекта.

---

## Вариант B. Без Docker — статикой в существующий nginx

Нужен Node.js 18+ (`node -v`).

```bash
git clone <URL-репозитория> pricecheck
cd pricecheck
git checkout claude/desktop-web-app-build-4nwh3c

npm ci
npm run build            # результат появится в папке dist/
```

Скопируйте содержимое `dist/` в корень сайта (узнать корень: `root ...` из
`nginx -T`). **Сначала сделайте бэкап старого:**

```bash
# пример: старый сайт лежит в /var/www/priceguard
sudo cp -r /var/www/priceguard /var/www/priceguard.backup
sudo rm -rf /var/www/priceguard/*
sudo cp -r dist/* /var/www/priceguard/
sudo systemctl reload nginx
```

Важно для SPA: в nginx-конфиге сайта в блоке `location /` должно быть
`try_files $uri $uri/ /index.html;` (иначе при обновлении страницы будет 404).

---

## Переключение домена (у вас домен + HTTPS)

Впереди почти наверняка стоит nginx, который держит ваш домен и SSL. Нужно,
чтобы он отдавал новую систему.

**Если пошли по Варианту A (Docker на :8080)** — в конфиге вашего домена
(обычно `/etc/nginx/sites-available/…` или `/etc/nginx/conf.d/…`) в блоке
`server { … }` для вашего домена замените то, что раздаёт старое, на прокси:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Проверить и применить:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Блоки с SSL-сертификатом (`listen 443 ssl; ssl_certificate …`) не трогайте —
HTTPS остаётся как был.

---

## Погасить старое (только после того, как новое заработало на домене)

```bash
# если priceguard в Docker:
docker ps                      # найдите имя контейнера
docker stop <имя_priceguard>
docker rm <имя_priceguard>     # удалять не обязательно, можно оставить остановленным

# если priceguard — systemd-сервис:
sudo systemctl stop <имя-сервиса>
sudo systemctl disable <имя-сервиса>
```

Если что-то пойдёт не так — старое можно вернуть: запустить контейнер обратно
или восстановить папку из `*.backup`.

---

## Обновления в будущем

- **Docker:** зайти в папку проекта и выполнить `./deploy.sh` (сам подтянет
  код и пересоберёт контейнер).
- **Статика:** `git pull` → `npm run build` → скопировать `dist/` в корень →
  `sudo systemctl reload nginx`.

Правки справочников и плановых цен, которые пользователь делает в разделе
«Данные», хранятся в его браузере (не на сервере) — при обновлении кода они
не теряются. Для переноса на другой компьютер есть кнопка «Экспорт».


---

## Две версии на одном сервере: разработка (sklad) и клиент (horeca)

| | Разработка | Клиент |
|---|---|---|
| Адрес | `sklad.dimkaprojects.xyz` | `horeca.mirelli.eu` |
| Папка на сервере | `~/Storage` | `~/Storage-prod` |
| Порт Caddy | 3000 | 3001 |
| Контейнеры | `pricecheck-api`, `pricecheck` | `pricecheck-prod-api`, `pricecheck-prod` |
| Данные | своё хранилище | своё хранилище (совсем отдельное) |
| Версия | последняя ветка (`./deploy.sh` берёт новое) | закреплена на коммите `DEPLOY_REF`, сама не меняется |

**Первый раз (клиентская копия):**
```bash
cd ~ && git clone <URL-репозитория> Storage-prod && cd Storage-prod
cat > .env <<'EOF'
APP_NAME=pricecheck-prod
COMPOSE_PROJECT_NAME=pricecheck-prod
WEB_PORT=3001
CADDY_SITES=horeca.caddy
DEPLOY_REF=<sha-коммита-со-скриптами>
APP_REF=ea94d294dd77e0df54647cb79e80404216370beb
APP_SRC=.app-src
EOF
./deploy.sh
docker exec pricecheck-prod-api node src/create-org.js "Название сети" почта@клиента "сильный-пароль"
```
ВАЖНО: пока клиентская копия не поднята, `horeca.mirelli.eu` (если Caddy уже получил старый `horeca.caddy`) указывает на порт 3000 — то есть на разработку; `./deploy.sh` в копии разработки предупредит об этом. `DEPLOY_REF` должен быть коммитом не старше этого разделения (`docker-compose.yml` с `APP_NAME`), иначе deploy.sh остановится. Бэкапы копии клиента называются `pricecheck-prod-backup-….tar.gz`.

Перед этим в DNS должна быть A-запись `horeca.mirelli.eu` на IP сервера, а порты 80 и 443 открыты (в Oracle — ещё и в правилах сети).
Дальше клиент заходит на `https://horeca.mirelli.eu`, «Для разработчика» → «Резервная копия» → «Восстановить всё из копии».

**Обновить версию клиента** (когда вы проверили новое на `sklad`): в `~/Storage-prod/.env` меняете `DEPLOY_REF` на нужный коммит и запускаете `./deploy.sh`. Данные клиента не затрагиваются.
**Обновить разработку:** в `~/Storage` просто `./deploy.sh`.
**Бэкапы клиента:** в `~/Storage-prod` — `./install-backup-cron.sh` (папка `~/pricecheck-prod-backups`); скачивать: `REMOTE_DIR=pricecheck-prod-backups ./pull-backup.sh пользователь@сервер`.
