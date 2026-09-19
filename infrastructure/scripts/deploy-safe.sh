#!/usr/bin/env bash
# MULTI-CHEF deploy-safe.sh — MC-072.4 (Audit R15 follow-up, R20-fixes rework)
#
# Single-command production deploy with mandatory pre-flight CI gates
# and automatic rollback on smoke failure.
#
# Usage:
#   infrastructure/scripts/deploy-safe.sh [--ref <git-ref>] [--force]
#
#   --ref <ref>   git ref to deploy (default: origin/main)
#   --force       redeploy even when HEAD == ref (restorations, rehearsals)
#
# Exit codes:
#   0   deploy succeeded (smoke green on new code)
#   1   deploy rolled back successfully (smoke failed on new code, but
#       prev_sha smoke is green — operator must investigate why)
#   2   rollback failed too — manual intervention required
#   3..  pre-flight / ci-gate / backup / pull / install / build / migrate
#       failure (no changes made to prod code yet)
#
# R20-fixes (2026-09-19):
#   * stage() now REQUIRES a command — every call site passes one, so a
#     stage failure actually aborts/rolls back (previously `stage smoke`
#     executed nothing and always returned 0: backup/migrate/restart/
#     smoke were all unguarded no-op wrappers).
#   * prisma generate runs in the ci-gate worktree and on prod after
#     install (typecheck/build need the generated client).
#   * the test gate runs with NODE_ENV=test (React act() breaks under
#     NODE_ENV=production).
#   * --force skips the HEAD==ref early exit (restoration redeploy).
#   * post-build chown covers the whole APP_DIR.
#   * dist/main.js + web/.next existence verified BEFORE restart.

set -uo pipefail
# NOTE: no `set -e` — exit codes are captured per stage and decide
# whether to roll back.

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_DIR=/opt/multichef
ENV_FILE=/etc/multichef/multichef.env
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR=/var/log
mkdir -p "$LOG_DIR"

REF="origin/main"
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "deploy-safe: unknown arg: $1" >&2; exit 3 ;;
  esac
done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$LOG_DIR/multichef-deploy-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
echo "deploy-safe: started $(date -u) ref=$REF force=$FORCE log=$LOG"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Run one stage: stage <name> <command...>. A stage without a command is
# a caller bug — fail fast on it (the old no-op behaviour masked every
# downstream failure).
stage() {
  local name="$1"; shift
  if [ $# -eq 0 ]; then
    echo "deploy-safe: BUG: stage '$name' called without a command" >&2
    return 64
  fi
  echo
  echo "=========== STAGE: $name ==========="
  "$@"
  local rc=$?
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

# CI gate inside the worktree (no prod mutation).
run_gate() {
  local label="$1"; shift
  echo "--- ci-gate: $label ---"
  if "$@"; then
    echo "  -> $label ok"
    return 0
  fi
  local rc=$?
  echo "  -> $label FAIL rc=$rc" >&2
  return $rc
}

capture_prev_sha() {
  git -c safe.directory="$APP_DIR" rev-parse HEAD
}

rollback_to() {
  local target="$1"
  echo "=========== ROLLBACK to $target ==========="
  git -c safe.directory="$APP_DIR" reset --hard "$target"
  chown -R multichef_app:multichef_app "$APP_DIR" 2>/dev/null || true
  sudo -u multichef_app -H bash -c "
    set -e
    cd '$APP_DIR'
    pnpm install --frozen-lockfile
    pnpm --filter @multichef/database exec prisma generate
    cd '$APP_DIR/apps/api'
    /usr/bin/pnpm build
    cd '$APP_DIR/apps/web'
    /usr/bin/pnpm build
  "
  systemctl restart multichef-web multichef-api multichef-worker
  sleep 5
}

smoke() {
  "$SCRIPT_DIR/health-check.sh" "http://127.0.0.1:8080"
}

# Fail fast when the built artefacts are missing (restart would 502).
verify_dist() {
  [ -f "$APP_DIR/apps/api/dist/main.js" ] || {
    echo "deploy-safe: apps/api/dist/main.js is missing"; return 1;
  }
  [ -d "$APP_DIR/apps/web/.next" ] || {
    echo "deploy-safe: apps/web/.next is missing"; return 1;
  }
  return 0
}

# ---------------------------------------------------------------------------
# Stage 0 — preflight
# ---------------------------------------------------------------------------
[ -d "$APP_DIR" ] || fail "missing $APP_DIR" 3
[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE" 3
[ -f "$SCRIPT_DIR/health-check.sh" ] || fail "missing health-check.sh" 3
[ -f "$SCRIPT_DIR/backup.sh" ] || fail "missing backup.sh" 3
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
cd "$APP_DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not a git repo" 3
for svc in multichef-web multichef-api multichef-worker; do
  systemctl cat "$svc" >/dev/null 2>&1 || fail "missing systemd unit $svc" 3
done
PREV_SHA=$(capture_prev_sha)
echo "deploy-safe: PREV_SHA=$PREV_SHA"

git fetch origin >/dev/null 2>&1
git rev-parse --verify "$REF" >/dev/null 2>&1 || fail "ref $REF not resolvable" 3
NEW_SHA=$(git rev-parse "$REF")
echo "deploy-safe: NEW_SHA=$NEW_SHA"
if [ "$PREV_SHA" = "$NEW_SHA" ] && [ "$FORCE" -ne 1 ]; then
  echo "deploy-safe: nothing to do (HEAD == ref); use --force to redeploy"
  exit 0
fi

set -a; source "$ENV_FILE"; set +a

# ---------------------------------------------------------------------------
# Stage 1 — CI gates (worktree at NEW_SHA, prod untouched)
# ---------------------------------------------------------------------------
echo "=========== STAGE: ci-gates ==========="
WORKTREE="$APP_DIR/.deploy-check-$STAMP"
trap 'rm -rf "$WORKTREE" 2>/dev/null || true' EXIT

git worktree add --detach "$WORKTREE" "$NEW_SHA" >/dev/null
chown -R multichef_app:multichef_app "$WORKTREE"
cd "$WORKTREE"
set -a; source "$ENV_FILE"; set +a

echo "--- ci-gate: install (worktree) ---"
if ! sudo -u multichef_app -H bash -c "cd '$WORKTREE' && /usr/bin/pnpm install --frozen-lockfile"; then
  fail "ci-gates install failed" 3
fi
if ! sudo -u multichef_app -H bash -c "cd '$WORKTREE' && /usr/bin/pnpm --filter @multichef/database exec prisma generate"; then
  fail "ci-gates prisma generate failed" 3
fi

GATES_OK=1
run_gate lint    bash -c "cd '$WORKTREE' && env NODE_ENV=test /usr/bin/pnpm lint"                  || GATES_OK=0
run_gate typecheck bash -c "cd '$WORKTREE/apps/api' && env NODE_ENV=test NODE_OPTIONS='--max-old-space-size=8192' /usr/bin/pnpm typecheck" || GATES_OK=0
run_gate test    bash -c "cd '$WORKTREE' && env NODE_ENV=test /usr/bin/pnpm test"                  || GATES_OK=0
run_gate build   bash -c "cd '$WORKTREE' && env NODE_ENV=production /usr/bin/pnpm build"           || GATES_OK=0
run_gate format  bash -c "cd '$WORKTREE' && /usr/bin/pnpm format:check"                            || GATES_OK=0
run_gate secret-scan bash -c "gitleaks detect --source '$WORKTREE' --no-banner"                    || GATES_OK=0
run_gate audit   bash -c "cd '$WORKTREE' && /usr/bin/pnpm audit --prod --audit-level=high"         || GATES_OK=0

if [ "$GATES_OK" -ne 1 ]; then
  echo "deploy-safe: ci-gate FAILED"
  echo "deploy-safe: see $LOG for full output"
  fail "ci-gate failure" 3
fi

# ---------------------------------------------------------------------------
# Stage 2 — DB backup
# ---------------------------------------------------------------------------
stage backup "$SCRIPT_DIR/backup.sh" || {
  fail "backup failed (NOT deploying — DB unprotected)" 3
}

# ---------------------------------------------------------------------------
# Stage 3 — Pull (switch prod to NEW_SHA)
# ---------------------------------------------------------------------------
stage pull bash -c "
  set -e
  cd '$APP_DIR'
  git -c safe.directory='$APP_DIR' reset --hard '$NEW_SHA'
" || fail "pull failed (prod unchanged)" 3
chown -R multichef_app:multichef_app "$APP_DIR" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Stage 4 — Install + generate + build on prod
# ---------------------------------------------------------------------------
stage install-build bash -c "
  set -e
  cd '$APP_DIR'
  env NEXT_PUBLIC_APP_BASE_URL='$NEXT_PUBLIC_APP_BASE_URL' \
      NEXT_PUBLIC_USE_RECIPE_FIXTURES='$NEXT_PUBLIC_USE_RECIPE_FIXTURES' \
      NODE_ENV=production \
    pnpm install --frozen-lockfile
  env NEXT_PUBLIC_APP_BASE_URL='$NEXT_PUBLIC_APP_BASE_URL' \
      NEXT_PUBLIC_USE_RECIPE_FIXTURES='$NEXT_PUBLIC_USE_RECIPE_FIXTURES' \
      NODE_ENV=production \
    pnpm --filter @multichef/database exec prisma generate
  env NEXT_PUBLIC_APP_BASE_URL='$NEXT_PUBLIC_APP_BASE_URL' \
      NEXT_PUBLIC_USE_RECIPE_FIXTURES='$NEXT_PUBLIC_USE_RECIPE_FIXTURES' \
      NODE_ENV=production \
    pnpm turbo run build --filter=@multichef/web... --filter=@multichef/api... --filter=@multichef/worker...
" || {
  echo "deploy-safe: install+build failed — rolling back"
  rollback_to "$PREV_SHA"
  smoke || fail "rollback smoke failed" 2
  exit 1
}
chown -R multichef_app:multichef_app "$APP_DIR" 2>/dev/null || true

# Fail fast on missing artefacts (restart would 502).
stage verify-dist verify_dist || {
  echo "deploy-safe: artefacts missing — rolling back"
  rollback_to "$PREV_SHA"
  smoke || fail "rollback smoke failed" 2
  exit 1
}

# ---------------------------------------------------------------------------
# Stage 5 — Migrate
# ---------------------------------------------------------------------------
stage migrate bash -c "
  set -e
  cd '$APP_DIR'
  env DATABASE_URL='$DATABASE_URL' \
    pnpm --filter @multichef/database exec prisma migrate deploy
" || {
  echo "deploy-safe: migrate failed — rolling back"
  rollback_to "$PREV_SHA"
  smoke || fail "rollback smoke failed" 2
  exit 1
}

# ---------------------------------------------------------------------------
# Stage 6 — Restart
# ---------------------------------------------------------------------------
stage restart systemctl restart multichef-web multichef-api multichef-worker || {
  echo "deploy-safe: restart failed — rolling back"
  rollback_to "$PREV_SHA"
  smoke || fail "rollback smoke failed" 2
  exit 1
}
sleep 5

# ---------------------------------------------------------------------------
# Stage 7 — Smoke + automatic rollback
# ---------------------------------------------------------------------------
stage smoke smoke || {
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
