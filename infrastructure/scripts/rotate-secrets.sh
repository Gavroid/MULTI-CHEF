#!/usr/bin/env bash
# MC-090 — SESSION_SECRET rotation entry point. Full runbook:
# docs/runbooks/secret-rotation.md
set -euo pipefail
echo "rotate-secrets: see docs/runbooks/secret-rotation.md for the full checklist"
echo "1) new JWT_SECRET → /etc/multichef/multichef.env"
echo "2) systemctl restart multichef-api multichef-worker"
echo "3) verify login works; old sessions are invalidated by design"
