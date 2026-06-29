#!/bin/bash
set -e

DOMAIN="sklad.dimkaprojects.xyz"
EMAIL="dimash210775@gmail.com"

echo "==> Installing certbot..."
apt-get install -y certbot

echo "==> Getting SSL certificate..."
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --non-interactive

echo "==> Building and starting Docker container..."
docker compose down 2>/dev/null || true
docker compose up -d --build

echo "==> Setting up auto-renewal..."
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && docker compose -f $(pwd)/docker-compose.yml restart warehouse") | crontab -

echo ""
echo "Done! App is running at https://$DOMAIN"
