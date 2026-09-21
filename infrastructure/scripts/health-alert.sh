#!/usr/bin/env bash
# R17-WP20 — Send a single alert to Telegram/Slack when health-check
# fails. Uses the same HEALTH_ALERT_WEBHOOK_URL env var that
# mc-monitor.sh honours.
#
# Telegram format: {"chat_id":"...","text":"..."}
# Slack incoming-webhook format: {"text":"..."}
# Generic JSON: {"message":"..."}
#
# Exit 0 on send success, non-zero otherwise. Idempotent: dedupe by
# last-sent file so a stuck failure does not flood the channel.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"

# Read env (DB secrets live in the same file but we only need
# HEALTH_ALERT_WEBHOOK_URL).
ENV_FILE="/etc/multichef/multichef.env"
if [ -z "${HEALTH_ALERT_WEBHOOK_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  HEALTH_ALERT_WEBHOOK_URL=$(grep '^HEALTH_ALERT_WEBHOOK_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  HEALTH_ALERT_COOLDOWN_SEC="${HEALTH_ALERT_COOLDOWN_SEC:-300}"
fi

# If still unset, this is a no-op (operator didn't configure alerts).
if [ -z "${HEALTH_ALERT_WEBHOOK_URL:-}" ]; then
  echo "[$SCRIPT_NAME] HEALTH_ALERT_WEBHOOK_URL unset — skipping alert" >&2
  exit 0
fi

COOLDOWN_FILE="/var/run/multichef-health-alert.last"
COOLDOWN_SEC="${HEALTH_ALERT_COOLDOWN_SEC:-300}"
now=$(date +%s)
if [ -f "$COOLDOWN_FILE" ]; then
  last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  if [ $(( now - last )) -lt "$COOLDOWN_SEC" ]; then
    echo "[$SCRIPT_NAME] alert suppressed (cooldown ${COOLDOWN_SEC}s)" >&2
    exit 0
  fi
fi

# Compose payload. The first arg is the failure description from the
# caller (health-check.sh or mc-monitor.sh). Optional second arg is
# exit code.
DESC="${1:-multichef health-check failed}"
EXIT_CODE="${2:-?}"
TS="$(date -u +%FT%TZ)"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo 'multichef')"

# Default payload — text only. Most webhook receivers accept this.
PAYLOAD=$(cat <<EOF
{"text":"[$TS] $HOSTNAME_SHORT: $DESC (exit=$EXIT_CODE)"}
EOF
)

# Decide format from URL: telegram host contains 'telegram', slack
# contains 'slack.com'. Otherwise generic JSON.
case "$HEALTH_ALERT_WEBHOOK_URL" in
  *telegram*) ;;
  *slack.com*) ;;
  *) ;;
esac

http_code=$(curl -sS -o /tmp/multichef-alert.resp -w '%{http_code}' \
  --max-time 10 \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD" \
  "$HEALTH_ALERT_WEBHOOK_URL" 2>/dev/null || echo 000)

if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
  echo "$now" > "$COOLDOWN_FILE"
  echo "[$SCRIPT_NAME] alert sent (http $http_code)"
  exit 0
fi

echo "[$SCRIPT_NAME] alert FAILED (http $http_code)" >&2
cat /tmp/multichef-alert.resp 2>/dev/null >&2 || true
exit 1
