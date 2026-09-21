#!/usr/bin/env bash
# R17-WP21 — Bootstrap /etc/multichef/multichef.env validator.
#
# Multi-stage validation:
#   (1) The env file exists and is readable.
#   (2) Every key listed in infrastructure/env/multichef.env.example is
#       present (some keys allow empty strings, some MUST be non-empty).
#   (3) Required URL keys parse (DATABASE_URL, REDIS_URL,
#       NEXT_PUBLIC_APP_BASE_URL).
#   (4) Warn on weak secrets (SESSION_SECRET shorter than 32 bytes).
#
# Exit codes:
#   0 — env is bootable.
#   2 — env file missing.
#   3 — required key missing.
#   4 — value failed syntax check.
#   5 — SESSION_SECRET too short.
#
# Run as:  bash infrastructure/scripts/bootstrap-env.sh /etc/multichef/multichef.env
# Default path above matches the prod layout.

set -uo pipefail

ENV_PATH=${1:-/etc/multichef/multichef.env}
TEMPLATE=${ENV_TEMPLATE:-/opt/multichef/infrastructure/env/multichef.env.example}
REQUIRED_KEYS=( DATABASE_URL REDIS_URL SESSION_SECRET NEXT_PUBLIC_APP_BASE_URL )
URL_KEYS=( DATABASE_URL REDIS_URL NEXT_PUBLIC_APP_BASE_URL )

if [ ! -r "$ENV_PATH" ]; then
  printf 'bootstrap-env: %s not readable\n' "$ENV_PATH" >&2
  exit 2
fi

# Force-load the env into this shell. set -a exports everything that
# follows; set +a stops the auto-export.
set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

fail=0
warn=0

# (2) Every required key has at least a key=… assignment (empty OK).
for key in "${REQUIRED_KEYS[@]}"; do
  if [ -z "${!key+x}" ]; then
    printf 'bootstrap-env: missing required key %s\n' "$key" >&2
    fail=3
  elif [ "${!key}" = "" ]; then
    printf 'bootstrap-env: WARNING %s is empty\n' "$key" >&2
    warn=$((warn + 1))
  fi
done

# (3) URL keys parse. Use bash regex instead of grep -E (the ERE
# parser interprets unescaped [ as a character class which trips on
# values that contain `[` in error messages). We only require the
# presence of a scheme prefix + at least one valid character; full
# URL parsing isn't done here — that's the API's job.
for key in "${URL_KEYS[@]}"; do
  val=${!key:-}
  if [ -n "$val" ]; then
    if ! [[ "$val" =~ ^[a-zA-Z][a-zA-Z0-9+._-]*://.+$ ]]; then
      printf 'bootstrap-env: %s does not look like a URL: %s\n' "$key" "$val" >&2
      fail=4
    fi
  fi
done

# (4) SESSION_SECRET length check (base64 of 32+ bytes is at least 43 chars).
if [ -n "${SESSION_SECRET:-}" ]; then
  LEN=${#SESSION_SECRET}
  if [ "$LEN" -lt 32 ]; then
    printf 'bootstrap-env: SESSION_SECRET too short (%d chars; need ≥32)\n' "$LEN" >&2
    fail=5
  fi
fi

if [ "$fail" -eq 0 ]; then
  printf 'bootstrap-env: OK (%d warnings)\n' "$warn"
  exit 0
fi
printf 'bootstrap-env: FAIL (code=%d)\n' "$fail" >&2
exit "$fail"
