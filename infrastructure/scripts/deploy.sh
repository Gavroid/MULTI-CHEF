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
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git fetch origin
git status --porcelain | grep -q . && { echo "deploy: dirty tree, abort"; exit 1; }
# NEXT_PUBLIC_* are inlined at BUILD time — env must be loaded first.
set -a; source "$ENV_FILE"; set +a

echo "deploy: backup"
"$(dirname "$0")/backup.sh"

echo "deploy: pull"
git pull --ff-only origin main

echo "deploy: install + build"
# sudo resets the environment (env_reset) — NEXT_PUBLIC_* are inlined at
# BUILD time, so they must be passed through explicitly (audit fix).
sudo -u multichef_app env \
  NEXT_PUBLIC_APP_BASE_URL="$NEXT_PUBLIC_APP_BASE_URL" \
  NEXT_PUBLIC_USE_MEALPLAN_MOCK="$NEXT_PUBLIC_USE_MEALPLAN_MOCK" \
  NEXT_PUBLIC_USE_RECIPE_FIXTURES="$NEXT_PUBLIC_USE_RECIPE_FIXTURES" \
  NODE_ENV="$NODE_ENV" \
  pnpm install --frozen-lockfile
sudo -u multichef_app env \
  NEXT_PUBLIC_APP_BASE_URL="$NEXT_PUBLIC_APP_BASE_URL" \
  NEXT_PUBLIC_USE_MEALPLAN_MOCK="$NEXT_PUBLIC_USE_MEALPLAN_MOCK" \
  NEXT_PUBLIC_USE_RECIPE_FIXTURES="$NEXT_PUBLIC_USE_RECIPE_FIXTURES" \
  NODE_ENV="$NODE_ENV" \
  pnpm turbo run build --filter=@multichef/web... --filter=@multichef/api...

echo "deploy: migrate"
set -a; source "$ENV_FILE"; set +a
sudo -u multichef_app env DATABASE_URL="$DATABASE_URL" pnpm --filter @multichef/database exec prisma migrate deploy

echo "deploy: restart services"
systemctl restart multichef-web multichef-api multichef-worker
sleep 5

echo "deploy: smoke"
"$(dirname "$0")/health-check.sh" http://127.0.0.1:8080
echo "deploy: OK"
