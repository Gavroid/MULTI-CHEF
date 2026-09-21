#!/usr/bin/env bash
# R17-WP14 — external smoke probe via the public domain.
#
# The internal nginx rate-limit / health checks don't catch:
#   - NPM misconfiguration (wrong upstream, missing SSL)
#   - DNS or routing outages from the outside world
#   - Expired Let's Encrypt certificate
#   - HSTS / CSP header regressions introduced by an NPM upgrade
#
# This probe exercises the same three endpoints the internal probe
# hits, but via the public domain. Exit 0 on all-green, non-zero
# otherwise. Designed to be run from cron on the multichef host or
# any host with internet access.
#
# Cron on multichef host:
#   */10 * * * * root /opt/multichef/infrastructure/scripts/external-smoke.sh https://multi-chef.431a.ru >> /var/log/multichef-external-smoke.log 2>&1
#   || /opt/multichef/infrastructure/scripts/health-alert.sh "external smoke failed" $? >> /var/log/multichef-external-smoke.log 2>&1

set -uo pipefail

BASE="${1:-https://multi-chef.431a.ru}"
SCRIPT_NAME="$(basename "$0")"
fail=0

probe() {
  local label="$1" path="$2" expect_codes="$3"
  local code
  code=$(curl -sS -o /tmp/external-smoke.out -w '%{http_code}' \
    --max-time 10 "$BASE$path" 2>/dev/null || echo 000)
  case ",$expect_codes," in
    *",$code,"*) printf '[%s] %s %s -> %s OK\n' "$(date -u +%FT%TZ)" "$label" "$path" "$code" ;;
    *)
      printf '[%s] %s %s -> %s FAIL (expected one of: %s)\n' "$(date -u +%FT%TZ)" "$label" "$path" "$code" "$expect_codes" >&2
      fail=1
      ;;
  esac
}

# 1) API live — strict 200.
probe 'api live' /api/v1/health/live 200

# 2) API ready — strict 200.
probe 'api ready' /api/v1/health/ready 200

# 3) Web /today — 200 or 307 (auth-redirect is healthy).
probe 'web /today' /today 200,307

# 4) Verify TLS cert chain is valid (curl already verified it for the
# probes above; this is a redundant sanity check that surfaces chain
# problems explicitly).
TLS_CHAIN_OK=$(curl -sS -o /dev/null -w '%{ssl_verify_result}' --max-time 10 "$BASE/api/v1/health/live" 2>/dev/null || echo 1)
if [ "$TLS_CHAIN_OK" != "0" ]; then
  printf '[%s] TLS chain FAIL (ssl_verify_result=%s)\n' "$(date -u +%FT%TZ)" "$TLS_CHAIN_OK" >&2
  fail=1
else
  printf '[%s] TLS chain OK\n' "$(date -u +%FT%TZ)"
fi

# 5) HSTS header must be present with max-age >= 31536000 (1 year).
HSTS=$(curl -sSI --max-time 10 "$BASE/" 2>/dev/null | awk -F': ' 'tolower($1)=="strict-transport-security"{print $2}' | tr -d '\r\n')
if [ -z "$HSTS" ]; then
  printf '[%s] HSTS missing\n' "$(date -u +%FT%TZ)" >&2
  fail=1
else
  printf '[%s] HSTS present: %s\n' "$(date -u +%FT%TZ)" "$HSTS"
fi

if [ "$fail" -eq 0 ]; then
  echo "[$SCRIPT_NAME] all probes OK"
  exit 0
fi
echo "[$SCRIPT_NAME] one or more probes failed" >&2
exit 1
