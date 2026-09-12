#!/usr/bin/env bash
# MC-072.2 — deploy pipeline: preflight → backup → pull → build →
# migrate → restart → smoke → health. Rolls back by re-running with the
# previous commit when the smoke fails (manual; automated rollback via
# `git revert` of the failing ref + restart).
set -euo pipefail

APP_DIR=/opt/multichef
ENV_FILE=/etc/multichef/multichef.env
cd "$APP_DIR"

echo "deploy: preflight"
git fetch origin
git status --porcelain | grep -q . && { echo "deploy: dirty tree, abort"; exit 1; }

echo "deploy: backup"
"$(dirname "$0")/backup.sh"

echo "deploy: pull"
git pull --ff-only origin main

echo "deploy: install + build"
sudo -u multichef_app pnpm install --frozen-lockfile
sudo -u multichef_app pnpm turbo run build --filter=@multichef/web... --filter=@multichef/api...

echo "deploy: migrate"
set -a; source "$ENV_FILE"; set +a
sudo -u multichef_app env DATABASE_URL="$DATABASE_URL" pnpm --filter @multichef/database exec prisma migrate deploy

echo "deploy: restart services"
systemctl restart multichef-web multichef-api multichef-worker
sleep 5

echo "deploy: smoke"
"$(dirname "$0")/health-check.sh" http://127.0.0.1:8080
echo "deploy: OK"
