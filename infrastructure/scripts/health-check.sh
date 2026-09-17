#!/usr/bin/env bash
# MC-072.4 — smoke + health. Usage: health-check.sh [gateway-base-url]
#
# Stages:
#   1) API health endpoints (live + ready)
#   2) Web /today (200)
#   3) Auth /auth/register 4-case smoke (Audit R15 — noemail / empty /
#      shortpwd / valid) — catches the Zod-validation regression that
#      audit-r13 missed because of USE_MEALPLAN_MOCK=1.
#
# Exit 0 on all-green; non-zero on first failure.

set -uo pipefail
BASE=${1:-http://127.0.0.1:8080}

echo "health: api live"
curl -sf "$BASE/api/v1/health/live" >/dev/null || { echo "health: api live FAILED"; exit 1; }

echo "health: api ready"
curl -sf "$BASE/api/v1/health/ready" >/dev/null || { echo "health: api ready FAILED"; exit 1; }

STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/today")
# /today may 307-redirect to /login when no session cookie is present
# (that's correct auth behaviour, not a deploy failure). 200 and 307
# are both healthy responses.
case "$STATUS" in
  200|307) echo "health: web /today ok (status=$STATUS)" ;;
  *) echo "health: web /today FAILED ($STATUS)"; exit 1 ;;
esac

# MC-WP1 (Audit R17): port-binding gate per ADR-0025.
# API (3001) and Web (3000) must bind to a loopback interface. If either
# listens on 0.0.0.0 / :: / a public IP, the Node.js process is
# reachable directly from the LAN, bypassing nginx.
for PORT_PORT in 3000 3001; do
  BIND=$(ss -tlnH "sport = :${PORT_PORT}" 2>/dev/null | awk '{print $4}' | head -1)
  if [ -z "$BIND" ]; then
    # Port not listening at all — surface as a separate health failure
    # (systemd-managed service is down).
    echo "health: port ${PORT_PORT} NOT LISTENING"
    exit 1
  fi
  case "$BIND" in
    127.0.0.1:*|[::1]:*) echo "health: port ${PORT_PORT} bound to ${BIND} (loopback OK)" ;;
    *) echo "health: port ${PORT_PORT} bound to ${BIND} (NON-LOOPBACK — fails ADR-0025)"; exit 1 ;;
  esac
done

# Audit-R15 auth smoke. Each case uses a unique Idempotency-Key that
# embeds the current timestamp (>= 16 chars) so we don't trip the
# Idempotency validator before our own checks run.
TS=$(date -u +%Y%m%dT%H%M%S)

assert_http() {
  local label="$1"; local expected="$2"; local body_file="$3"
  # body_file contains: JSON body (one line) + blank + status=NNN
  # We strip everything from the first newline to get pure JSON for
  # python3 to parse. If python3 fails, treat it as a smoke failure.
  local json_line got
  json_line=$(head -n 1 "$body_file" 2>/dev/null || echo "")
  got=$(printf '%s' "$json_line" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read() or '{}')
    print(d.get('status', '-'))
except Exception:
    print('-')
" 2>/dev/null)
  if [ "$got" = "$expected" ]; then
    echo "health: $label ok (status=$got)"
  else
    echo "health: $label FAILED (got=$got expected=$expected)"
    cat "$body_file" >&2
    exit 1
  fi
}

# noemail -> 400
TMP=$(mktemp)
curl -sS -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-${TS}-noemail-1234567890" \
  -d '{"password":"abcdefgh"}' \
  -w '\nstatus=%{http_code}\n' >"$TMP" 2>&1 || true
echo "health: case noemail" >>"$TMP"
assert_http "auth smoke: noemail" "400" "$TMP"
rm -f "$TMP"

# empty email -> 400
TMP=$(mktemp)
curl -sS -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-${TS}-empty-1234567890" \
  -d '{"email":"","password":"abcdefgh"}' \
  -w '\nstatus=%{http_code}\n' >"$TMP" 2>&1 || true
echo "health: case empty" >>"$TMP"
assert_http "auth smoke: empty" "400" "$TMP"
rm -f "$TMP"

# short pwd -> 400
TMP=$(mktemp)
curl -sS -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-${TS}-short-1234567890" \
  -d '{"email":"smoke@example.com","password":"abc"}' \
  -w '\nstatus=%{http_code}\n' >"$TMP" 2>&1 || true
echo "health: case short" >>"$TMP"
assert_http "auth smoke: short" "400" "$TMP"
rm -f "$TMP"

# valid -> 201 (the test email is unique-per-second, so collisions are
# unlikely; on the off chance it hits an existing user, retry once)
EMAIL="smoke-${TS}-valid@example.com"
TMP=$(mktemp)
HTTP=$(curl -sS -o "$TMP" -w '%{http_code}' \
  -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-${TS}-valid-1234567890" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"abcdefgh\"}" 2>&1) || true
if [ "$HTTP" != "201" ] && [ "$HTTP" != "409" ]; then
  echo "health: auth smoke: valid FAILED (got=$HTTP expected=201 or 409)"
  cat "$TMP" >&2
  rm -f "$TMP"
  exit 1
fi
echo "health: auth smoke: valid ok (status=$HTTP)"
rm -f "$TMP"

echo "health: OK ($BASE)"
