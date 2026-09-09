#!/bin/bash
# merge-gate.example.sh — wrap merge-gate.py with the conventional
# token path and a README-style usage example.
#
# Usage:
#   ./scripts/merge-gate.example.sh <PR_NUMBER> <HEAD_SHA>
#
# Example:
#   ./scripts/merge-gate.example.sh 17 23e9f345609dcc6a666fde2c5f95be8e3fdfb046
#
# Then, after it prints ✅ MERGE-GATE PASSED, the manager can run:
#   gh pr merge <PR> --squash --sha <HEAD_SHA>
# to actually land the PR.

set -euo pipefail

PR_NUMBER="${1:?usage: merge-gate.example.sh <PR_NUMBER> <HEAD_SHA>}"
HEAD_SHA="${2:?usage: merge-gate.example.sh <PR_NUMBER> <HEAD_SHA>}"
REPO="${REPO:-Gavroid/MULTI-CHEF}"
TOKEN_FILE="${TOKEN_FILE:-/root/.config/gh/host.yml}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "${SCRIPT_DIR}/merge_gate.py" \
  --pr "${PR_NUMBER}" \
  --sha "${HEAD_SHA}" \
  --repo "${REPO}" \
  --token-file "${TOKEN_FILE}"
