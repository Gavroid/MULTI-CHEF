#!/bin/bash
# start-web.sh — boot the Next dev server in the foreground for Playwright.
# Uses `next dev` so we exercise the same HMR-warmed bundle the user
# would see locally. NEXT_PUBLIC_APP_BASE_URL is baked in at build time
# so we set it BEFORE the dev process starts.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

export WEB_PORT="${WEB_PORT:-3000}"
export NEXT_PUBLIC_APP_BASE_URL="${NEXT_PUBLIC_APP_BASE_URL:-http://localhost:${API_PORT:-3001}}"

echo "[start-web] starting next dev on :$WEB_PORT (API=${NEXT_PUBLIC_APP_BASE_URL}) ..."
exec pnpm --filter @multichef/web dev 2>&1 | tee /tmp/mc-web.log
