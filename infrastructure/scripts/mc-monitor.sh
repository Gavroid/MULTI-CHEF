#!/usr/bin/env bash
# R17-WP10 — synthetic health probe for Uptime Kuma / node_exporter.
#
# Exit 0 iff all three layers (api live, api ready, web responding)
# answer green. Exit 1 otherwise with a single-line reason. Designed
# to be wired into:
#   * Uptime Kuma  — HTTP(s) push probe with 1-min interval
#   * node_exporter textfile collector (writes last_status to
#     /var/lib/node_exporter/textfile_collector/multichef.prom)
#   * a systemd timer if cron isn't wanted
#
# The script does NOT depend on jq or curl --silent-flags so it stays
# portable across Debian/Ubuntu LTS images used by SRE boxes.

set -uo pipefail
BASE=${BASE:-http://127.0.0.1:8080}
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

fail=0
msg=""

# 1) /api/v1/health/live
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 5 "$BASE/api/v1/health/live" 2>/dev/null || echo 000)
if [ "$CODE" != "200" ]; then
  msg="$msg live=$CODE"
  fail=1
fi

# 2) /api/v1/health/ready
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 5 "$BASE/api/v1/health/ready" 2>/dev/null || echo 000)
if [ "$CODE" != "200" ]; then
  msg="$msg ready=$CODE"
  fail=1
fi

# 3) /today — must answer 200 or 307 (the latter is auth-redirect which
# is the correct health response for an unauthenticated GET).
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 5 "$BASE/today" 2>/dev/null || echo 000)
case "$CODE" in
  200|307) ;;
  *) msg="$msg today=$CODE"; fail=1 ;;
esac

if [ "$fail" -eq 0 ]; then
  echo "OK $(date -u +%FT%TZ)"
  exit 0
fi
echo "FAIL $(date -u +%FT%TZ)$msg"
exit 1
