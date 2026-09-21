#!/usr/bin/env bash
# R17-WP19 — Database retention cleanup.
#
# Deletes:
#   - Session rows with expiresAt < now() - 1 day (kept an extra day as
#     a safety margin in case of clock skew between api and worker).
#   - Job rows with status IN (COMPLETED, FAILED) AND updatedAt < now()
#     - 90 days. Active jobs (QUEUED, PROCESSING) are NEVER deleted.
#
# Idempotent: rerun is safe; only stale rows are removed.
# Output: row counts before/after for each table, with elapsed time.

set -euo pipefail

PG_HOST="${PGHOST:-127.0.0.1}"
PG_PORT="${PGPORT:-5432}"
PG_USER="${PGUSER:-multichef}"
PG_DB="${PGDATABASE:-multichef}"

SCRIPT_NAME="$(basename "$0")"
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Read PGPASSWORD from env file if not already exported.
if [ -z "${PGPASSWORD:-}" ] && [ -f /etc/multichef/multichef.env ]; then
  # shellcheck disable=SC1091
  set -a; . /etc/multichef/multichef.env; set +a
fi

before_session=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -At -c 'SELECT count(*) FROM "Session"')
before_job=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -At -c "SELECT count(*) FROM \"Job\"")

start=$(date +%s)

# Sessions — keep until 1 day past expiresAt to absorb clock skew.
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -q -c \
  'DELETE FROM "Session" WHERE "expiresAt" < now() - interval '\''1 day'\'''
deleted_session=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -At -c \
  "SELECT count(*) FROM \"Session\" WHERE \"expiresAt\" < now() - interval '1 day'")

# Jobs — only terminal-state jobs older than 90 days. Active jobs stay.
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -q -c \
  "DELETE FROM \"Job\" WHERE status IN ('COMPLETED', 'FAILED') AND \"updatedAt\" < now() - interval '90 days'"
deleted_job=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -At -c \
  "SELECT count(*) FROM \"Job\" WHERE status IN ('COMPLETED', 'FAILED') AND \"updatedAt\" < now() - interval '90 days'")

elapsed=$(( $(date +%s) - start ))

after_session=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -At -c 'SELECT count(*) FROM "Session"')
after_job=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -At -c 'SELECT count(*) FROM "Job"')

cat <<EOF
[$SCRIPT_NAME] retention cleanup done in ${elapsed}s
  Session: before=$before_session deleted=$deleted_session after=$after_session
  Job:     before=$before_job deleted=$deleted_job after=$after_job
EOF
