#!/usr/bin/env bash
# PLAN-PROD-LAUNCH WP-12 — Off-host / off-fs backup mirror.
#
# Why: keeping the only copy of every backup on the same disk as the
# live DB defeats the purpose of having backups. This script rsyncs the
# latest /opt/multichef-internal backup into a separate mount-point
# (default: /var/lib/multichef/backups-offhost) so that a disk failure
# cannot wipe the timeline.
#
# Idempotency: rsync --link-dest=previous-link is the standard
# incremental pattern. The script records the timestamp of the most
# recent offhost dump in OFFHOST_CURRENT and uses it as the hard-link
# base for the next run. The cron that calls this script runs weekly;
# one full dump stays on-disk regardless of source rotation.
#
# Exit codes:
#   0 = ok (mirrored at least one new file)
#   2 = source backup dir is missing or unreadable
#   3 = target directory unwritable
#   4 = rsync itself failed

set -euo pipefail

SRC_DIR=${BACKUP_SRC:-/var/lib/multichef/backups}
DST_DIR=${BACKUP_DST:-/var/lib/multichef/backups-offhost}
OFFHOST_CURRENT="${DST_DIR}/.current"
KEEP_MONTHS=${BACKUP_KEEP_MONTHS:-3}

log() { printf '[offhost-backup] %s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit "${2:-1}"; }

# 1) Pick the most recent source dump. We rotate 7 in $SRC_DIR via
# `backup.sh`, so the latest is the link source.
if [ ! -d "$SRC_DIR" ]; then
  die "source dir $SRC_DIR not found" 2
fi
LATEST_SRC=$(ls -1t "$SRC_DIR"/multichef-*.sql.gz 2>/dev/null | head -n1 || true)
if [ -z "${LATEST_SRC:-}" ]; then
  die "no *.sql.gz in $SRC_DIR — run backup.sh first" 2
fi
log "source = $LATEST_SRC ($(stat -c%s "$LATEST_SRC") bytes)"

# 2) Prepare destination. mkdir -p is safe and atomic on ext4.
if ! mkdir -p "$DST_DIR"; then
  die "cannot mkdir $DST_DIR" 3
fi

# 3) Compute the previous offhost link (set once on first run).
PREV_LINK=""
if [ -f "$OFFHOST_CURRENT" ] && [ -d "$(cat "$OFFHOST_CURRENT" 2>/dev/null || true)" ]; then
  PREV_LINK=$(cat "$OFFHOST_CURRENT")
fi

# 4) Atomic timestamp folder so concurrent cron jobs don't collide.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DST_NEW="${DST_DIR}/${STAMP}"

log "dest = $DST_NEW (previous link: ${PREV_LINK:-none})"
mkdir -p "$DST_NEW"

# 5) rsync incremental. --link-dest makes unchanged files hardlinks to
#    the previous dump, so each weekly run costs ≈ size of new rows.
RSYNC_OPTS=(
  -a
  --link-dest="$(dirname "$LATEST_SRC")"
  --include='multichef-*.sql.gz'
  --include='/'
  --exclude='*'
)
if ! rsync "${RSYNC_OPTS[@]}" "$(dirname "$LATEST_SRC")/" "$DST_NEW/"; then
  rm -rf "$DST_NEW"
  die "rsync failed" 4
fi

# 6) Verify that the new dump exists and is non-empty in offhost.
FILE_COUNT=$(find "$DST_NEW" -name 'multichef-*.sql.gz' | wc -l)
if [ "$FILE_COUNT" -lt 1 ]; then
  rm -rf "$DST_NEW"
  die "rsync copy did not produce a dump in $DST_NEW" 4
fi
log "mirrored $FILE_COUNT dump file(s)"

# 7) Write the new "current" pointer for the next run.
printf '%s\n' "$DST_NEW" > "$OFFHOST_CURRENT"

# 8) Drop offhost directories older than KEEP_MONTHS months.
CUTOFF_EPOCH=$(date -u -d "${KEEP_MONTHS} months ago" +%s 2>/dev/null || \
  date -u -v "-${KEEP_MONTHS}m" +%s 2>/dev/null || echo 0)
PRUNED=0
if [ "$CUTOFF_EPOCH" -gt 0 ]; then
  while IFS= read -r d; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    case "$name" in
      .current) continue ;;
    esac
    dir_epoch=$(date -u -d "$name" +%s 2>/dev/null || echo 0)
    if [ "$dir_epoch" -gt 0 ] && [ "$dir_epoch" -lt "$CUTOFF_EPOCH" ]; then
      rm -rf "$d"
      PRUNED=$((PRUNED + 1))
    fi
  done < <(find "$DST_DIR" -mindepth 1 -maxdepth 1 -type d)
fi
log "pruned $PRUNED dumps older than ${KEEP_MONTHS} months"

log "ok (offhost dir = $DST_NEW)"
exit 0
