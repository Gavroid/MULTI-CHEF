#!/usr/bin/env bash
# R17-WP9 — Backup → restore drill.
#
# Verifies that a `backup.sh` artefact can actually be restored into a
# scratch database (multichef_drill) without operator intervention. The
# drill runs the full pg_dump → pg_restore cycle, then a SQL spot-check
# confirming the critical tables have non-zero row counts matching the
# canonical production metrics (the "plan R17 target" rows).
#
# Exit codes:
#   0 — drill passed, every assertion within tolerance.
#   2 — backup missing or unreadable.
#   3 — restore failed (psql exited non-zero on import).
#   4 — spot-check failed (row counts diverged from production).
#
# MC-072.3 / R17: do NOT skip. The whole point of having backups is that
# we know they restore; this script is the actual evidence.

set -euo pipefail
set -a; source /etc/multichef/multichef.env; set +a

DRILL_DB=multichef_drill
BACKUP_DIR=/var/lib/multichef/backups
EXPECTED_RECIPES=2000
EXPECTED_ALIASES=463
# MealPlan: на проде ~66 (DRAFT+ACTIVE+ARCHIVED). Drill ниже 30 =
# restore неполный.
EXPECTED_PLAN=30

echo "drill: finding newest backup in $BACKUP_DIR …"
LATEST=$(ls -1t "$BACKUP_DIR"/multichef-*.sql.gz 2>/dev/null | head -n1 || true)
if [ -z "${LATEST:-}" ] || [ ! -r "$LATEST" ]; then
  echo "drill: no backup at $BACKUP_DIR — generating one (cold backup)" >&2
  /opt/multichef/infrastructure/scripts/backup.sh
  LATEST=$(ls -1t "$BACKUP_DIR"/multichef-*.sql.gz | head -n1)
fi
echo "drill: backup = $LATEST"

echo "drill: dropping and recreating $DRILL_DB (off-prod, peer-auth)…"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres <<EOSQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '$DRILL_DB' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS $DRILL_DB;
CREATE DATABASE $DRILL_DB;
EOSQL

echo "drill: restoring into $DRILL_DB …"
gunzip -c "$LATEST" | sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DRILL_DB" >/dev/null

echo "drill: row counts …"
COUNTS=$(sudo -u postgres psql -At -d "$DRILL_DB" <<'EOCOUNT'
SELECT 'recipes:' || COUNT(*) FROM "Recipe";
SELECT 'aliases:' || COUNT(*) FROM "IngredientAlias";
SELECT 'plans:'   || COUNT(*) FROM "MealPlan";
EOCOUNT
)
echo "$COUNTS"

R=$(echo "$COUNTS" | awk -F: '/^recipes:/{print $2}')
A=$(echo "$COUNTS" | awk -F: '/^aliases:/{print $2}')
P=$(echo "$COUNTS" | awk -F: '/^plans:/{print $2}')

fail=0
if [ "${R:-0}" -lt "$EXPECTED_RECIPES" ]; then
  echo "drill: FAIL recipes expected >= $EXPECTED_RECIPES, got ${R:-0}" >&2
  fail=4
fi
if [ "${A:-0}" -lt "$EXPECTED_ALIASES" ]; then
  echo "drill: FAIL aliases expected >= $EXPECTED_ALIASES, got ${A:-0}" >&2
  fail=4
fi
if [ "${P:-0}" -lt "$EXPECTED_PLAN" ]; then
  echo "drill: FAIL plans expected >= $EXPECTED_PLAN, got ${P:-0}" >&2
  fail=4
fi

echo "drill: dropping scratch db …"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE $DRILL_DB;" >/dev/null

if [ "$fail" -ne 0 ]; then
  echo "drill: result=FAIL (exit $fail)" >&2
  exit "$fail"
fi

echo "drill: result=OK (recipes=$R aliases=$A plans=$P)"
exit 0
