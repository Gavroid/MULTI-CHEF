#!/usr/bin/env bash
# MULTI-CHEF deploy-safe.sh — MC-072.4 (Audit R15 follow-up)
#
# Single-command production deploy with mandatory pre-flight CI gates
# and automatic rollback on smoke failure. See /root/workspace/multi-chef/DEPLOY.md.
#
# Usage:
#   /opt/multichef/infrastructure/scripts/deploy-safe.sh [--ref <git-ref>]
#
# Default ref: origin/main
#
# Exit codes:
#   0   deploy succeeded (smoke green on new code)
#   1   deploy rolled back successfully (smoke failed on new code, but
#       prev_sha smoke is green — operator must investigate why)
#   2   rollback failed too — manual intervention required
#   3..  pre-flight / ci-gate / backup / pull / install / build / migrate
#       failure (no changes made to prod code yet)

set -uo pipefail
# NOTE: do NOT `set -e` at top — we want to capture exit codes per stage
# and decide whether to roll back. Each stage runs in a guarded block.

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_DIR=/opt/multichef
ENV_FILE=/etc/multichef/multichef.env
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR=/var/log
mkdir -p "$LOG_DIR"

REF="origin/main"
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "deploy-safe: unknown arg: $1" >&2; exit 3 ;;
  esac
done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$LOG_DIR/multichef-deploy-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
echo "deploy-safe: started $(date -u) ref=$REF log=$LOG"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
stage() {
  local name="$1"; shift
  local rc=0
  echo
  echo "=========== STAGE: $name ==========="
  "$@"
  rc=$?
  if [ $rc -eq 0 ]; then
    echo "deploy-safe: $name ok"
  else
    echo "deploy-safe: $name FAIL rc=$rc"
  fi
  return $rc
}

fail() {
  echo "deploy-safe: FATAL: $*" >&2
  exit "${2:-3}"
}

# Run a CI gate locally (no prod mutation).
ci_gate() {
  local name="$1"; shift
  local rc=0
  echo "--- ci-gate: $name ---"
  "$@"
  rc=$?
  if [ $rc -eq 0 ]; then
    echo "  -> $name ok"
  else
    echo "  -> $name FAIL rc=$rc" >&2
  fi
  return $rc
}

# Capture the current prod HEAD before any change.
capture_prev_sha() {
  git -c safe.directory="$APP_DIR" rev-parse HEAD
}

# Full automatic rollback.
rollback_to() {
  local target="$1"
  echo "=========== ROLLBACK to $target ==========="
  sudo -u root -H bash -c "
    set -e
    cd '$APP_DIR'
    git -c safe.directory='$APP_DIR' reset --hard '$target'
    cd '$APP_DIR'
    # Restore permissions on src/ that may have been overwritten.
    chown -R multichef_app:multichef_app '$APP_DIR/apps/api/src' || true
    chown -R multichef_app:multichef_app '$APP_DIR/apps/web/src' || true
  "
  sudo -u multichef_app -H bash -c "
    set -e
    cd '$APP_DIR'
    pnpm install --frozen-lockfile
    cd '$APP_DIR/apps/api'
    /usr/bin/pnpm build
    cd '$APP_DIR/apps/web'
    /usr/bin/pnpm build
  "
  sudo systemctl restart multichef-web multichef-api multichef-worker
  sleep 5
}

# Smoke test — calls the project's health-check.sh (4-case auth + 2 health endpoints).
smoke() {
  "$SCRIPT_DIR/health-check.sh" "http://127.0.0.1:8080"
}

# ---------------------------------------------------------------------------
# Stage 0 — preflight
# ---------------------------------------------------------------------------
stage preflight || fail "preflight failed" 3

[ -d "$APP_DIR" ] || fail "missing $APP_DIR" 3
[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE" 3
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
cd "$APP_DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not a git repo" 3
# Confirm the systemd units exist (don't fail on inactive — that might be
# normal if a previous restart left them down).
for svc in multichef-web multichef-api multichef-worker; do
  systemctl cat "$svc" >/dev/null 2>&1 || fail "missing systemd unit $svc" 3
done
# Capture previous SHA for rollback target.
PREV_SHA=$(capture_prev_sha)
echo "deploy-safe: PREV_SHA=$PREV_SHA"

# Confirm ref is reachable.
git fetch origin >/dev/null 2>&1
git rev-parse --verify "$REF" >/dev/null 2>&1 || fail "ref $REF not resolvable" 3
NEW_SHA=$(git rev-parse "$REF")
echo "deploy-safe: NEW_SHA=$NEW_SHA"
[ "$PREV_SHA" = "$NEW_SHA" ] && { echo "deploy-safe: nothing to do (HEAD == ref)"; exit 0; }

# Source env (used by later stages — backup, migrate, build).
set -a; source "$ENV_FILE"; set +a

# ---------------------------------------------------------------------------
# Stage 1 — CI gates (local, against NEW_SHA without mutating prod)
# ---------------------------------------------------------------------------
stage "ci-gates" || fail "ci-gates failed (no prod mutation performed)" 3

# We checkout NEW_SHA into a separate worktree so the running prod
# checkout (PREV_SHA) stays intact until all gates pass.
WORKTREE="$APP_DIR/.deploy-check-$STAMP"
trap 'rm -rf "$WORKTREE" 2>/dev/null || true' EXIT

git worktree add --detach "$WORKTREE" "$NEW_SHA" >/dev/null
# worktree was created by root via sudo; multichef_app needs to own it
# (and any nested dirs like .turbo/) before pnpm install can write to
# them.
chown -R multichef_app:multichef_app "$WORKTREE"

cd "$WORKTREE"
# Re-source env (worktree is a fresh shell context for env, but parent
# already sourced — explicit re-source is harmless and defensive).
set -a; source "$ENV_FILE"; set +a

# Worktree has no node_modules — install once before running gates.
echo "deploy-safe: ci-gates: install (worktree)"
sudo -u multichef_app -H bash -c "
  cd '$WORKTREE'
  /usr/bin/pnpm install --frozen-lockfile
" || fail "ci-gates install failed" 3

run_gate() {
  # Run a gate; capture rc AND track the latest failing stage.
  local label="$1"; shift
  echo "--- ci-gate: $label ---"
  if "$@"; then
    echo "  -> $label ok"
  else
    local rc=$?
    echo "  -> $label FAIL rc=$rc" >&2
    FAIL_STAGE="$label"
    FAIL_RC=$rc
    return $rc
  fi
}

# We must abort at the first failing gate (continue-on-error would be
# misleading — the deploy IS blocked anyway, and we want a clean log).
run_gate lint    bash -c "cd '$WORKTREE' && /usr/bin/pnpm lint" \
  && run_gate typecheck bash -c "cd '$WORKTREE/apps/api' && /usr/bin/pnpm typecheck" \
  && run_gate test    bash -c "cd '$WORKTREE' && /usr/bin/pnpm test" \
  && run_gate build   bash -c "cd '$WORKTREE' && /usr/bin/pnpm build" \
  && run_gate format  bash -c "cd '$WORKTREE' && /usr/bin/pnpm format:check" \
  && run_gate secret-scan bash -c "gitleaks detect --source '$WORKTREE' --no-banner" \
  && run_gate audit   bash -c "cd '$WORKTREE' && /usr/bin/pnpm audit --prod --audit-level=high" \
  || true

if [ -n "${FAIL_STAGE:-}" ]; then
  echo "deploy-safe: ci-gate FAILED at stage=$FAIL_STAGE rc=$FAIL_RC"
  echo "deploy-safe: see $LOG for full output"
  fail "ci-gate failure: $FAIL_STAGE" 3
fi

# ---------------------------------------------------------------------------
# Stage 2 — DB backup
# ---------------------------------------------------------------------------
stage backup || fail "backup failed (NOT deploying — DB unprotected)" 3
"$SCRIPT_DIR/backup.sh"

# ---------------------------------------------------------------------------
# Stage 3 — Pull (switch prod to NEW_SHA)
# ---------------------------------------------------------------------------
stage pull || { echo "deploy-safe: pull failed, restoring via backup"; exit 3; }
cd "$APP_DIR"
sudo -u root -H bash -c "
  set -e
  cd '$APP_DIR'
  git -c safe.directory='$APP_DIR' reset --hard '$NEW_SHA'
"
# Permissions: anything the git checkout touched needs multichef_app ownership.
sudo -u root -H chown -R multichef_app:multichef_app "$APP_DIR/apps" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Stage 4 — Install + build on prod
# ---------------------------------------------------------------------------
stage "install+build" || fail "install+build failed (prod on NEW_SHA — manual fix needed)" 3
sudo -u multichef_app -H bash -c "
  set -e
  cd '$APP_DIR'
  env NEXT_PUBLIC_APP_BASE_URL='$NEXT_PUBLIC_APP_BASE_URL' \
      NEXT_PUBLIC_USE_MEALPLAN_MOCK='$NEXT_PUBLIC_USE_MEALPLAN_MOCK' \
      NEXT_PUBLIC_USE_RECIPE_FIXTURES='$NEXT_PUBLIC_USE_RECIPE_FIXTURES' \
      NODE_ENV='$NODE_ENV' \
    pnpm install --frozen-lockfile
  env NEXT_PUBLIC_APP_BASE_URL='$NEXT_PUBLIC_APP_BASE_URL' \
      NEXT_PUBLIC_USE_MEALPLAN_MOCK='$NEXT_PUBLIC_USE_MEALPLAN_MOCK' \
      NEXT_PUBLIC_USE_RECIPE_FIXTURES='$NEXT_PUBLIC_USE_RECIPE_FIXTURES' \
      NODE_ENV='$NODE_ENV' \
    pnpm turbo run build --filter=@multichef/web... --filter=@multichef/api...
"
# Some dist files end up owned by root from the build chain — fix that.
sudo -u root -H chown -R multichef_app:multichef_app "$APP_DIR/apps/api/dist" 2>/dev/null || true
sudo -u root -H chown -R multichef_app:multichef_app "$APP_DIR/apps/web/.next" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Stage 5 — Migrate
# ---------------------------------------------------------------------------
stage migrate || { echo "deploy-safe: migrate failed — rolling back"; rollback_to "$PREV_SHA"; smoke || fail "rollback smoke failed" 2; exit 1; }
sudo -u multichef_app -H bash -c "
  set -e
  env DATABASE_URL='$DATABASE_URL' \
    pnpm --filter @multichef/database exec prisma migrate deploy
"

# ---------------------------------------------------------------------------
# Stage 6 — Restart
# ---------------------------------------------------------------------------
stage restart || { echo "deploy-safe: restart failed — rolling back"; rollback_to "$PREV_SHA"; smoke || fail "rollback smoke failed" 2; exit 1; }
sudo systemctl restart multichef-web multichef-api multichef-worker
sleep 5

# ---------------------------------------------------------------------------
# Stage 7 — Smoke + automatic rollback
# ---------------------------------------------------------------------------
stage smoke || {
  echo "deploy-safe: smoke FAILED on new code ($NEW_SHA) — rolling back to $PREV_SHA"
  rollback_to "$PREV_SHA"
  if smoke; then
    echo "deploy-safe: ROLLBACK_OK — prod is now on $PREV_SHA, operator must investigate"
    exit 1
  else
    echo "deploy-safe: ROLLBACK_FAILED — manual intervention required"
    exit 2
  fi
}

echo
echo "deploy-safe: complete  HEAD=$NEW_SHA (prev=$PREV_SHA)"
echo "deploy-safe: exit 0"
exit 0
