#!/usr/bin/env bash
# MC-072.1 — idempotent host bootstrap for the MULTI-CHEF stack.
# Run as root on the prod host. Second run must produce no changes.
set -euo pipefail

APP_USER=multichef_app
APP_DIR=/opt/multichef
ENV_DIR=/etc/multichef

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" "$ENV_DIR" /var/lib/multichef/backups
[ -d "$APP_DIR/.git" ] || git clone "git@github.com:Gavroid/MULTI-CHEF.git" "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

# TLS: self-signed for the LAN until a public domain exists.
if [ ! -f /etc/nginx/ssl/multichef.crt ]; then
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/multichef.key -out /etc/nginx/ssl/multichef.crt \
    -subj "/CN=multichef.lan" >/dev/null 2>&1
fi

# Secrets: generate once, keep in /etc/multichef (root-only).
if [ ! -f "$ENV_DIR/multichef.env" ]; then
  {
    echo "NODE_ENV=production"
    echo "DATABASE_URL=postgresql://multichef:$(openssl rand -hex 12)@127.0.0.1:5432/multichef"
    echo "REDIS_URL=redis://127.0.0.1:6379"
    echo "JWT_SECRET=$(openssl rand -base64 32)"
    echo "SESSION_SECRET=$(openssl rand -base64 36)"
    echo "COOKIE_SECRET=$(openssl rand -base64 36)"
    echo "APP_BASE_URL=http://192.168.1.95:8080"
    echo "CORS_ORIGINS=http://192.168.1.95:8080,https://192.168.1.95:8443"
    echo "COOKIE_SECURE=false"
    echo "COOKIE_SAMESITE=lax"
    # NOTE: no COOKIE_DOMAIN for IP-only LAN hosts — browsers reject
    # Domain=IP attributes, which silently drops the session cookie.
    echo "NEXT_PUBLIC_APP_BASE_URL=http://192.168.1.95:8080"
    echo "NEXT_PUBLIC_USE_MEALPLAN_MOCK=0"
  } > "$ENV_DIR/multichef.env"
fi
chmod 600 "$ENV_DIR/multichef.env"

# nginx gateway.
cp "$APP_DIR/infrastructure/nginx/multichef.conf" /etc/nginx/sites-available/multichef.conf
ln -sf /etc/nginx/sites-available/multichef.conf /etc/nginx/sites-enabled/multichef.conf
nginx -t
systemctl reload nginx

# Postgres role/database (idempotent).
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='multichef'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE multichef LOGIN PASSWORD 'changeme'"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='multichef'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE multichef OWNER multichef"

echo "bootstrap: done"
