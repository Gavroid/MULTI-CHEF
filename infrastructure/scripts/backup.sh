#!/usr/bin/env bash
# MC-072.3 — pg_dump with rotation (7 daily / 4 weekly / 6 monthly slots
# simplified to: keep the last 7 dumps; restore-test = restore checklist
# in docs/runbooks/secret-rotation.md §restore).
set -euo pipefail
set -a; source /etc/multichef/multichef.env; set +a
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=/var/lib/multichef/backups/multichef-$STAMP.sql.gz
sudo -u postgres pg_dump multichef | gzip > "$DEST"
ls -1t /var/lib/multichef/backups/multichef-*.sql.gz | tail -n +8 | xargs -r rm --
echo "backup: $DEST"
