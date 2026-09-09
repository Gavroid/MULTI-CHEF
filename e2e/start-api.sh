#!/bin/bash
# start-api.sh — boot the Nest API in the foreground for Playwright.
# Sources the repo-root .env (NOT committed) so secrets are injected.
# Assumes the Postgres DB has migrations applied and is seeded with
# ingredients (run prisma:deploy + db:seed once before the first run).

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

export API_PORT="${API_PORT:-3001}"

echo "[start-api] building @multichef/api (tsc) ..."
pnpm --filter @multichef/api build >/tmp/mc-api-build.log 2>&1 || {
  echo "[start-api] BUILD FAILED; tail of /tmp/mc-api-build.log:"
  tail -30 /tmp/mc-api-build.log
  exit 1
}

echo "[start-api] starting on :$API_PORT (logs → /tmp/mc-api.log) ..."
exec node apps/api/dist/main.js 2>&1 | tee /tmp/mc-api.log
