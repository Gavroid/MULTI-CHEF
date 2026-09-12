#!/usr/bin/env bash
# MC-072.4 — smoke + health. Usage: health-check.sh [gateway-base-url]
set -euo pipefail
BASE=${1:-http://127.0.0.1:8080}
curl -sf "$BASE/api/v1/health/live" >/dev/null || { echo "health: api live FAILED"; exit 1; }
curl -sf "$BASE/api/v1/health/ready" >/dev/null || { echo "health: api ready FAILED"; exit 1; }
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/today")
[ "$STATUS" = "200" ] || { echo "health: web /today FAILED ($STATUS)"; exit 1; }
echo "health: OK ($BASE)"
