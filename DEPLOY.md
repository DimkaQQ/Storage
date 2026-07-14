# Развёртывание на VPS (замена priceguard)

Приложение — это статический сайт (HTML/JS/CSS), данные вшиты внутрь. Значит,
разворачивается очень просто: собрать и раздать через nginx. Ниже — безопасный
план: сначала поднимаем новую систему **рядом**, проверяем, и только потом
переключаем домен и гасим старое. Так сайт не «упадёт» во время замены.

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
