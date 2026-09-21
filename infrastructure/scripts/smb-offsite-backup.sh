#!/usr/bin/env bash
# R18-WP32 — Off-host / off-fs backup via SMB to 192.168.1.91 (NAS).
# Mirrors the ns-analytics pattern (deploy/backup/ns-analytics-backup-offsite.sh):
#   1) tar.gz code + configs + .env files from /opt/multichef → local _out/
#   2) upload fresh artifacts to //192.168.1.91/Kirill-AI/multichef/offsite/
#   3) verify: size + md5 re-download
#   4) retention: local 14d, SMB 30d
#   5) fail-closed: any error → exit 1
#
# Cron (multichef, /etc/cron.d/multichef-smb-offsite), UTC:
#   30 4 * * 1 root /opt/multichef/infrastructure/scripts/smb-offsite-backup.sh >> /var/log/multichef-smb-offsite.log 2>&1
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/multichef}"
BACKUP_OUT="${BACKUP_OUT:-$APP_ROOT/backup/_out}"
SMB_HOST="${SMB_HOST:-192.168.1.91}"
SMB_SHARE="${SMB_SHARE:-Kirill-AI}"
SMB_CREDS="${SMB_CREDS:-/etc/multichef/smb-offsite.creds}"
SMB_DIR="${SMB_DIR:-multichef/offsite}"
RETENTION_LOCAL_DAYS=14
RETENTION_SMB_DAYS=30
LOG="/var/log/multichef-smb-offsite.log"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# smbclient does not mkdir -p — create path level-by-level (idempotent).
smb_mkdir_p() {
  local remote_dir="$1" cur=""
  IFS='/' read -ra PARTS <<< "$remote_dir"
  for p in "${PARTS[@]}"; do
    [ -z "$p" ] && continue
    cur="${cur}${p}"
    smbclient "//$SMB_HOST/$SMB_SHARE" -A "$SMB_CREDS" \
      -c "mkdir ${cur}" 2>&1 | grep -E "(NT_STATUS|Error)" | grep -v "OBJECT_NAME_COLLISION" || true
    cur="${cur}/"
  done
}

# 1) prerequisites
command -v smbclient >/dev/null 2>&1 || { log "FAIL: smbclient not installed"; exit 1; }
[ -r "$SMB_CREDS" ] || { log "FAIL: SMB creds $SMB_CREDS not readable"; exit 1; }
[ -d "$APP_ROOT" ] || { log "FAIL: $APP_ROOT not found"; exit 1; }
mkdir -p "$BACKUP_OUT"

# 2) local tar + manifest
TARBALL="$BACKUP_OUT/code-$TS.tar.gz"
# Code + config + infra scripts. Exclude node_modules, build artifacts, dist.
tar -czf "$TARBALL" -C "$APP_ROOT" \
  --exclude='*/node_modules' --exclude='*/dist' --exclude='*/.next' \
  --exclude='*/tsconfig*.tsbuildinfo' --exclude='*/backup' \
  --exclude='.git' --exclude='*/.git' \
  infrastructure docs scripts \
  $(cd "$APP_ROOT" && ls -d apps packages 2>/dev/null || true) \
  $(cd "$APP_ROOT" && ls -d .env .env.example 2>/dev/null || true)
[ -s "$TARBALL" ] || { log "FAIL: tarball $TARBALL is empty"; exit 1; }
# Sanity: infrastructure/scripts inside (защита от «пустого» бэкапа).
LISTING="$(tar -tzf "$TARBALL")"
grep -q '^infrastructure/scripts/' <<<"$LISTING" || { log "FAIL: tarball has no infrastructure/scripts"; exit 1; }
MANIFEST="$BACKUP_OUT/manifest-$TS.md5"
( cd "$BACKUP_OUT" && md5sum "code-$TS.tar.gz" ) > "$MANIFEST"
log "local backup: $(basename "$TARBALL") $(stat -c '%s' "$TARBALL") bytes"

# 3) SMB connectivity + directory
SMB_TEST=$(smbclient "//$SMB_HOST/$SMB_SHARE" -A "$SMB_CREDS" -c "ls" 2>&1 || true)
if echo "$SMB_TEST" | grep -qE "NT_STATUS_(ACCESS_DENIED|LOGON_FAILURE|NETWORK_NAME_DELETED|BAD_NETWORK_NAME)"; then
  log "FAIL: SMB auth/connectivity: $(echo "$SMB_TEST" | head -1)"
  exit 1
fi
smb_mkdir_p "$SMB_DIR"
log "SMB: ensured $SMB_DIR/ on //$SMB_HOST/$SMB_SHARE"

# 4) upload свежих артефактов (tar+manifest за последние 7 дней) + size-verify
UPLOAD_COUNT=0; FAILED=0
for f in $(find "$BACKUP_OUT" -maxdepth 1 -type f \( -name 'code-*.tar.gz' -o -name 'manifest-*.md5' \) -mtime -7); do
  bn=$(basename "$f")
  LOCAL_SIZE=$(stat -c '%s' "$f")
  [ "$LOCAL_SIZE" -gt 0 ] || { log "FAIL: $bn is 0 bytes"; FAILED=$((FAILED+1)); continue; }
  if smbclient "//$SMB_HOST/$SMB_SHARE" -A "$SMB_CREDS" \
       -c "cd $SMB_DIR; put $f $bn" >/dev/null 2>&1; then
    REMOTE_SIZE=$(smbclient "//$SMB_HOST/$SMB_SHARE" -A "$SMB_CREDS" \
      -c "cd $SMB_DIR; ls" 2>/dev/null | awk -v fname="$bn" '$1 == fname {print $3; exit}')
    if [ -z "$REMOTE_SIZE" ] || [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
      log "FAIL: $bn size mismatch local=$LOCAL_SIZE remote=${REMOTE_SIZE:-NOT_FOUND}"
      FAILED=$((FAILED+1))
    else
      UPLOAD_COUNT=$((UPLOAD_COUNT+1))
    fi
  else
    log "FAIL: upload failed: $bn"
    FAILED=$((FAILED+1))
  fi
done
[ "$FAILED" -eq 0 ] || { log "FAIL: $FAILED upload problem(s)"; exit 1; }
log "SMB: uploaded $UPLOAD_COUNT files (size-verified)"

# 5) md5-verify свежего manifest (скачать обратно, сравнить)
SRC_HASH=$(md5sum "$MANIFEST" | awk '{print $1}')
TMP_DL="/tmp/multichef-offsite-verify-$(basename "$MANIFEST")"
smbclient "//$SMB_HOST/$SMB_SHARE" -A "$SMB_CREDS" \
  -c "cd $SMB_DIR; get $(basename "$MANIFEST") $TMP_DL" >/dev/null 2>&1 \
  || { log "FAIL: cannot re-download manifest for verify"; exit 1; }
DEST_HASH=$(md5sum "$TMP_DL" | awk '{print $1}')
rm -f "$TMP_DL"
[ "$SRC_HASH" = "$DEST_HASH" ] || { log "FAIL: md5 mismatch $SRC_HASH != $DEST_HASH"; exit 1; }
log "SMB: md5 verified $(basename "$MANIFEST") ($SRC_HASH)"

# 6) retention: локально и на SMB
find "$BACKUP_OUT" -maxdepth 1 -type f \( -name 'code-*.tar.gz' -o -name 'manifest-*.md5' \) \
  -mtime +$RETENTION_LOCAL_DAYS -delete
SMB_LIST=$(smbclient "//$SMB_HOST/$SMB_SHARE" -A "$SMB_CREDS" -c "cd $SMB_DIR; ls" 2>/dev/null)
DELETED=0
for f in $(printf '%s\n' "$SMB_LIST" | awk '/^[[:space:]]+[A-Za-z0-9_.-]+[[:space:]]+A[[:space:]]+[0-9]+/ {print $1}'); do
  TS_RAW=$(echo "$f" | sed -E 's/^(code|manifest)-([0-9]{8}T[0-9]{6}Z).*$/\2/')
  [ -n "$TS_RAW" ] || continue
  TS_HUMAN=$(echo "$TS_RAW" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3 \4:\5:\6/')
  AGE_DAYS=$(( ( $(date +%s) - $(date -d "$TS_HUMAN" +%s 2>/dev/null || echo 0) ) / 86400 ))
  if [ "$AGE_DAYS" -gt "$RETENTION_SMB_DAYS" ]; then
    smbclient "//$SMB_HOST/$SMB_SHARE" -A "$SMB_CREDS" \
      -c "cd $SMB_DIR; del $f" >/dev/null 2>&1 && DELETED=$((DELETED+1))
  fi
done

log "OK: uploaded=$UPLOAD_COUNT smb_deleted=$DELETED (retention local=${RETENTION_LOCAL_DAYS}d smb=${RETENTION_SMB_DAYS}d)"
