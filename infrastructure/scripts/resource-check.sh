#!/usr/bin/env bash
# R18-WP35 — VPS resource check: disk/RAM/loadavg + health-alert.sh on
# thresholds. Called by /etc/cron.d/multichef-resources every 10 min.
#
# Thresholds (override via env if needed):
#   DISK_WARN=80    # % used on / → alert
#   RAM_WARN=90     # % used → alert
#   LOAD_WARN=4     # loadavg > N cores → alert
#
# Exit 0 if everything OK, exit 1 if any alert fired. health-alert.sh
# handles dedupe (5-min cooldown) so this can be called freely.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"
ENV_FILE="/etc/multichef/multichef.env"

# Thresholds
DISK_WARN="${DISK_WARN:-80}"
RAM_WARN="${RAM_WARN:-90}"
LOAD_WARN="${LOAD_WARN:-4}"

# Read env
if [ -f "$ENV_FILE" ]; then
  HEALTH_ALERT_WEBHOOK_URL=$(grep '^HEALTH_ALERT_WEBHOOK_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  HEALTH_ALERT_CHAT_ID=$(grep '^HEALTH_ALERT_CHAT_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  export HEALTH_ALERT_WEBHOOK_URL HEALTH_ALERT_CHAT_ID
fi

ALERTS=()

# 1. Disk usage on /
disk_used=$(df -P / | awk 'NR==2 {sub("%","",$5); print $5}')
if [ -n "$disk_used" ] && [ "$disk_used" -ge "$DISK_WARN" ]; then
  ALERTS+=("disk: ${disk_used}% on / (warn at ${DISK_WARN}%)")
fi

# 2. RAM usage
if [ -f /proc/meminfo ]; then
  mem_total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  if [ -n "$mem_total" ] && [ -n "$mem_avail" ] && [ "$mem_total" -gt 0 ]; then
    mem_used_pct=$(( (mem_total - mem_avail) * 100 / mem_total ))
    if [ "$mem_used_pct" -ge "$RAM_WARN" ]; then
      ALERTS+=("ram: ${mem_used_pct}% used (warn at ${RAM_WARN}%)")
    fi
  fi
fi

# 3. Load average (1-minute) vs CPU cores
load1=$(awk '{print $1}' /proc/loadavg)
cpu_cores=$(nproc)
# Use integer compare
load1_int=${load1%.*}
if [ -n "$load1_int" ] && [ "$load1_int" -ge "$LOAD_WARN" ]; then
  ALERTS+=("load: ${load1} (cores=${cpu_cores}, warn at ${LOAD_WARN})")
fi

# 4. Check service status (cheap)
for svc in multichef-api multichef-web multichef-worker; do
  if ! systemctl is-active --quiet "$svc" 2>/dev/null; then
    ALERTS+=("service: ${svc} is not active")
  fi
done

if [ "${#ALERTS[@]}" -eq 0 ]; then
  echo "[$SCRIPT_NAME] OK disk=${disk_used}% ram=${mem_used_pct:-?}% load=${load1}"
  exit 0
fi

# Compose alert message
MSG="resource alert: $(IFS='; '; echo "${ALERTS[*]}")"

# Fire alert (health-alert.sh handles cooldown)
if [ -x /opt/multichef/infrastructure/scripts/health-alert.sh ]; then
  /opt/multichef/infrastructure/scripts/health-alert.sh "$MSG" 1
  rc=$?
  echo "[$SCRIPT_NAME] alert exit=$rc"
  exit "$rc"
fi

echo "[$SCRIPT_NAME] $MSG" >&2
exit 1
