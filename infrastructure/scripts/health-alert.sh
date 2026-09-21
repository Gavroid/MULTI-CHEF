#!/usr/bin/env bash
# R17-WP20 — Send a single alert to Telegram Bot API / Slack incoming
# webhook when health-check fails.
#
# R18-WP31: Telegram Bot API needs {"chat_id":"...","text":"..."} format
# (not the generic {"text":"..."}). Detect Bot API URLs (path
# /sendMessage) and split them into base + chat_id form-encoded.
#
# URL forms supported:
#   Telegram Bot API:  https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CID>
#                      → POST as application/x-www-form-urlencoded (chat_id, text)
#   Slack webhook:     https://hooks.slack.com/services/.../.../...
#                      → POST JSON {"text":"..."}
#   Generic JSON:      anything else
#                      → POST JSON {"text":"..."}
#
# Optional env:
#   HEALTH_ALERT_WEBHOOK_URL — receiver URL (set in /etc/multichef/multichef.env)
#   HEALTH_ALERT_COOLDOWN_SEC — dedupe window, default 300s
#   HEALTH_ALERT_CHAT_ID — fallback Telegram chat_id if URL has no ?chat_id=
#
# Exit 0 on send success, non-zero otherwise.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"

# Read env
ENV_FILE="/etc/multichef/multichef.env"
if [ -z "${HEALTH_ALERT_WEBHOOK_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  HEALTH_ALERT_WEBHOOK_URL=$(grep '^HEALTH_ALERT_WEBHOOK_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
fi
if [ -z "${HEALTH_ALERT_CHAT_ID:-}" ] && [ -f "$ENV_FILE" ]; then
  HEALTH_ALERT_CHAT_ID=$(grep '^HEALTH_ALERT_CHAT_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
fi
HEALTH_ALERT_COOLDOWN_SEC="${HEALTH_ALERT_COOLDOWN_SEC:-300}"

if [ -z "${HEALTH_ALERT_WEBHOOK_URL:-}" ]; then
  echo "[$SCRIPT_NAME] HEALTH_ALERT_WEBHOOK_URL unset — skipping alert" >&2
  exit 0
fi

COOLDOWN_FILE="/var/run/multichef-health-alert.last"
COOLDOWN_SEC="$HEALTH_ALERT_COOLDOWN_SEC"
now=$(date +%s)
if [ -f "$COOLDOWN_FILE" ]; then
  last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  if [ $(( now - last )) -lt "$COOLDOWN_SEC" ]; then
    echo "[$SCRIPT_NAME] alert suppressed (cooldown ${COOLDOWN_SEC}s)" >&2
    exit 0
  fi
fi

# Compose message
DESC="${1:-multichef health-check failed}"
EXIT_CODE="${2:-?}"
TS="$(date -u +%FT%TZ)"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo 'multichef')"
TEXT="[$TS] $HOSTNAME_SHORT: $DESC (exit=$EXIT_CODE)"

# Decide receiver format
url="$HEALTH_ALERT_WEBHOOK_URL"
case "$url" in
  *api.telegram.org*/sendMessage*)
    # Telegram Bot API: form-encoded chat_id + text
    chat_id="${HEALTH_ALERT_CHAT_ID:-}"
    if [ -z "$chat_id" ]; then
      # Try to extract from URL query string (?chat_id=...)
      chat_id=$(printf '%s' "$url" | sed -n 's/.*[?&]chat_id=\([^&]*\).*/\1/p')
      url=$(printf '%s' "$url" | sed 's/[?&]chat_id=[^&]*//')
    fi
    if [ -z "$chat_id" ]; then
      echo "[$SCRIPT_NAME] telegram URL but no HEALTH_ALERT_CHAT_ID — skipping" >&2
      exit 1
    fi
    http_code=$(curl -sS -o /tmp/multichef-alert.resp -w '%{http_code}' \
      --max-time 10 \
      -X POST \
      --data-urlencode "chat_id=$chat_id" \
      --data-urlencode "text=$TEXT" \
      --data-urlencode "parse_mode=HTML" \
      "$url" 2>/dev/null || echo 000)
    ;;
  *hooks.slack.com*)
    # Slack incoming webhook: JSON {"text":"..."}
    payload="{\"text\":\"$TEXT\"}"
    http_code=$(curl -sS -o /tmp/multichef-alert.resp -w '%{http_code}' \
      --max-time 10 \
      -H 'Content-Type: application/json' \
      --data "$payload" \
      "$url" 2>/dev/null || echo 000)
    ;;
  *)
    # Generic JSON
    payload="{\"text\":\"$TEXT\"}"
    http_code=$(curl -sS -o /tmp/multichef-alert.resp -w '%{http_code}' \
      --max-time 10 \
      -H 'Content-Type: application/json' \
      --data "$payload" \
      "$url" 2>/dev/null || echo 000)
    ;;
esac

if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
  echo "$now" > "$COOLDOWN_FILE"
  echo "[$SCRIPT_NAME] alert sent (http $http_code)"
  exit 0
fi

echo "[$SCRIPT_NAME] alert FAILED (http $http_code)" >&2
cat /tmp/multichef-alert.resp 2>/dev/null >&2 || true
exit 1
