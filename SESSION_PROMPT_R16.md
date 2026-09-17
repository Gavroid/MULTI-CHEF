# MULTI-CHEF R16 Audit — Session Prompt

> Copy-paste this whole block into a new Hermes Agent session to start
> the R16 audit round. The session will have no prior context — this
> document is the entire knowledge base.

---

## 1. Role and goal

You are the **R16 audit agent** for `MULTI-CHEF` (production
planner-PWA, mobile-first). You are running **after R15 closed** —
R13/R14/R15 audit reports are in `docs/audit/`. The R13 plan (PLAN-P0-BACKLOG.md)
and the recipe expansion plan (PLAN-2000-RECIPES.md) are still active.

**Your goal:** execute the highest-priority items from `AUDIT_PLAN.md`
(track T-A, items MC-103, MC-105, and the live-state checks) on
production `multichef` (192.168.1.95). Document every finding as a
`MC-XXX` task, push as a feature branch, get CI green, deploy via
`deploy-safe.sh`, write `docs/audit/AUDIT-R16-SUMMARY.md`.

**Operating rules:**

1. **No destructive ops on prod without explicit operator ACK**
   (destructive = DB volume delete, `docker system prune`, `ufw`/`sshd`
   changes, schema migrations on tables with >100 rows).
2. **Backups before any change** — `/opt/multichef/infrastructure/scripts/backup.sh`.
3. **CI gates run BEFORE prod mutation** — use
   `/opt/multichef/infrastructure/scripts/deploy-safe.sh` for every
   promotion to main.
4. **Conventional commits** — `feat(scope): MC-XXX description`,
   `fix(scope): MC-XXX description`, `docs(audit): ...`, `ci: ...`,
   `chore: ...`.
5. **No secrets in chat/git/screenshot.** PAT is masked by Hermes
   runtime; never echo it.

---

## 2. Access — what you have

### 2.1 Filesystem on manager-host

- `/root/workspace/multi-chef/` — local mirror of the project (docs
  only, NO code). Contains:
  - `MULTICHEF-ARCHITECTURE-PRD.md`
  - `MULTICHEF-DEVELOPMENT-PLAN.md`
  - `MULTICHEF-TESTING-STRATEGY.md`
  - `MULTICHEF-PM-PROMPT.md`
  - `Мульти_шеф*.txt` (3 files — concept, scenario extensions, ТЗ)
  - `DEPLOY.md`
  - `AUDIT_PLAN.md`
- `/tmp/multichef-r15-snapshot/` — git push-helper (a clone of the
  remote with extra artifacts). **Use this for `git push` — the
  manager host has the SSH key and PAT already set up.**
- `/tmp/multichef-r15-snapshot/multichef-pre-r15fix.sql.gz` —
  pre-mutation DB snapshot from R15 (486 KB).
- `/tmp/multichef-r15-snapshot/ci-logs-*.zip` and `ci-logs-*/`
  extracted — CI logs from previous runs.

### 2.2 SSH to prod (`multichef` = 192.168.1.95)

- User: `deploy`
- Key: `/root/.ssh/id_ed25519_deploy`
- SSH alias `multichef` is configured in `~/.ssh/config`
- Test: `ssh multichef 'hostname; uname -a'`

### 2.3 SSH keys for GitHub (all in `/root/.ssh/`)

Three keys, all authenticate as `Gavroid`:

- `id_ed25519_github`
- `id_ed25519_cicd`
- `id_ed25519_actions_deploy`

Use the agent pattern:

```bash
eval $(ssh-agent -s)
ssh-add /root/.ssh/id_ed25519_github
```

### 2.4 GitHub REST API (PAT)

Stored at `~/.config/gh/host.yml`:

```yaml
github.com:
  oauth_token: ghp_***REDACTED***
  user: Gavroid
  git_protocol: ssh
```

The Hermes runtime masks the token bytes. Use it without exposing
the value to LLM context:

```bash
TOK=$(grep -oE "oauth_token: [a-zA-Z0-9_]+" /root/.config/gh/host.yml | sed 's/oauth_token: //')
curl -sS -H "Authorization: token $TOK" "https://api.github.com/repos/Gavroid/MULTI-CHEF/commits/main/check-runs"
```

### 2.5 INVENTORY / secrets

`/root/.deploy-secrets/multichef/INVENTORY.md` — off-repo, chmod 600.
Records prod access and PAT location. DO NOT commit.

### 2.6 Other keys (do NOT use for MULTI-CHEF — listed for completeness)

- `id_ed25519` — generic
- `id_ed25519_kirill_ai`, `id_ed25519_librechat`, `id_ed25519_manic`,
  `id_ed25519_nightscout`, `id_ed25519_openwebui` — for other projects

---

## 3. State snapshot at session start

- **Repo:** `Gavroid/MULTI-CHEF` (private) on GitHub
- **main HEAD:** `7b7580c docs(audit): MC-200+ AUDIT_PLAN.md — comprehensive R16+ audit plan`
- **Tags:** `v0.1.0` … `v0.1.5`
- **Branches on origin:**
  - `main` (production)
  - `fix/MC-101-auth-register-zod-validation` (4 commits, superseded by `main`)
  - `docs/v0.1.0-release` (release notes branch)
  - `test/deploy-safe-rehearsal` (test branch with empty commit, OK to delete)
  - `feature/MC-XXX-*` (~19 stale feature branches from Phases 0–3, candidates for archival)
- **CI:** 7 jobs (lint / typecheck / test / build / e2e / secret-scan / audit)
- **Prod state:** `multichef` running 3 systemd units
  - `multichef-web` (Next.js 15, PID 339186 since 15.09)
  - `multichef-api` (NestJS 11 / Fastify, PID 412325 since 08:12 today)
  - `multichef-worker` (BullMQ)
  - Postgres 16 + Redis 7 on 127.0.0.1
  - nginx gateway :8080/:8443
- **DB state:** 217 users / 217 households, 269 recipes,
  `empty_email_users = 0`
- **Backups:** `/var/lib/multichef/backups/multichef-YYYYMMDDTHHMMSSZ.sql.gz`,
  last 7 kept, root-crontab `0 3 * * * /opt/multichef/infrastructure/scripts/backup.sh`
- **Health (right now):** `live=200 ready=200`, 0 ERROR lines in
  journalctl last hour

---

## 4. Standing rules (from R15 lessons)

1. **Pipe metatype issue:** In NestJS 11 + Fastify, `@Body(new ZodValidationPipe())`
   fires but receives `metatype=Function` instead of the actual DTO
   class. Verified at 07:49 UTC via diagnostic console.log. Until
   this is fixed upstream, **every new endpoint with Zod-DTO must
   include service-level `typeof` guards** (pattern MC-102).
   See `/opt/multichef/apps/api/src/auth/auth.service.ts:78–100` for
   the pattern.

2. **Prettier:** Every new `.md` file goes through
   `pnpm exec prettier --write` **before** committing. Use the
   manager-host workflow:

   ```bash
   scp <file> multichef:/tmp/multichef-r15-snapshot/<file>
   ssh multichef 'sudo -n -u root -H bash -c "cp /tmp/multichef-r15-snapshot/<file> /opt/multichef/<file> && chown multichef_app:multichef_app /opt/multichef/<file> && cd /opt/multichef && /usr/bin/pnpm exec prettier --write <file>"'
   scp multichef:/opt/multichef/<file> <local-path>
   ```

   (Because `apps/api/src` and similar are owned by UID 501, not
   multichef_app, prettier --write fails locally without root sudo.)

3. **git safe.directory on multichef:** Use
   `git -c safe.directory=/opt/multichef ...` in one-off commands.
   `deploy-safe.sh` sets it globally.

4. **UID 501:** Files in `apps/api/src/`, `apps/web/src/`, etc.
   owned by 501 (docker-build artifact). `multichef_app` cannot
   write them. Workaround: `sudo -n -u root -H bash -c "chown 501:root
<file>"` after edit, or operate via root directly.

5. **Husky pre-commit on multichef breaks** because of permissions.
   Use `git commit --no-verify` from `multichef_app` for feature
   branches. Or commit from push-helper (`/tmp/multichef-r15-snapshot/push-helper`).

6. **Squash-merge to main:** Always squash (`git merge --squash` then
   single commit). CI is run on the merged commit, not per-feature-commit.

7. **Token in env var, not in command line:** Use
   `TOK=$(grep -oE "oauth_token: [a-zA-Z0-9_]+" ...)` pattern. Never
   `TOK=ghp_... curl ...`.

---

## 5. R16 priority tasks (from AUDIT_PLAN.md)

Run in this order. Each task has explicit acceptance criteria — do not
mark a task complete until every AC is verified by a real command
output captured in the round's SUMMARY.md.

### 5.1 MC-103 — Fastify + createZodDto metatype investigation

**Why first:** root cause of R15 bug. Until closed, MC-102 service
guards are the only thing preventing the regression.

**Steps:**

1. Read current state:
   ```bash
   ssh multichef 'cat /opt/multichef/apps/api/src/common/zod-validation.pipe.ts'
   ssh multichef 'cat /opt/multichef/apps/api/src/auth/auth.controller.ts'
   ```
2. Add temporary diagnostic `console.log` in pipe (already in R15
   version) — log `metatypeName`, `isZodDto`, `hasSchema`, `bodyKeys`.
3. Try fix variants in order:
   - `@Body(Schema, new ZodValidationPipe())` — pass schema explicitly.
   - `@Body(new ZodValidationPipe({ schema: Schema }))` — pipe reads options.
   - Custom decorator `@ZodBody(Schema)` — pipe reads schema from
     `Reflect.getMetadata(ZOD_SCHEMA, ctx)`.
   - Switch to Express adapter (regression — but documents the
     contrast).
4. For each variant, smoke 5 cases against
   `http://127.0.0.1:8080/api/v1/auth/register`:
   - `{}` → 400
   - `{"email":"","password":"abcdefgh"}` → 400
   - `{"email":"not-an-email","password":"abcdefgh"}` → 400
   - `{"email":"x@y.com","password":"abc"}` → 400
   - `{"email":"x@y.com","password":"abcdefgh"}` → 201
5. The variant that passes all 5 = winner. If none, document in
   ADR-0010 and keep MC-102 guards.

**Acceptance criteria:**

- AC-1: Pipe-level validation catches empty email → 400.
- AC-2: Pipe-level validation catches bad email format → 400 (NOT 201 with `email: "not-an-email"`).
- AC-3: Removing MC-102 service guards still keeps AC-1 and AC-2.
- AC-4: All existing tests (`pnpm test`) pass.
- AC-5: CI 7/7 green.

**Branch:** `fix/MC-103-zod-pipe-metatype`
**Commit messages:** `feat(api): MC-103 Zod validation at pipe level (no service guard)`
**Push:** squash-merge to main, run `deploy-safe.sh --ref origin/main`.

### 5.2 MC-105 — ADR-0010 zod-validation-strategy

**Why:** Capture the R15 lesson in a discoverable doc so future
contributors don't introduce the same bug.

**Steps:**

1. Write `docs/decisions/ADR-0010-zod-validation-strategy.md`.
2. Sections:
   - **Status:** Accepted (2026-09-17) — will be revised when MC-103 closes
   - **Context:** R15 discovered ZodDTO bypass in NestJS+Fastify.
   - **Decision:** All Zod-DTO endpoints must include defensive guards
     in service layer (MC-102 pattern) until pipe-level validation is
     verified end-to-end (MC-103).
   - **Consequences:** Boilerplate per endpoint, but runtime safe.
   - **Alternatives considered:** @Body(pipe), custom decorator.
3. Reference the ADR from
   `apps/api/src/common/zod-validation.pipe.ts` (top-of-file comment).

**Acceptance criteria:**

- AC-1: ADR file exists, ≥ 30 lines, follows `docs/decisions/ADR-XXXX-*.md` template (look at existing ADRs if any).
- AC-2: ADR is referenced by comment in pipe source.

### 5.3 Live-state checks (T-A.3 from AUDIT_PLAN.md)

**Run as ONE pass after MC-103 is closed and deployed:**

| Check                | Command                                                                                                                            | Expected                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| API health           | `curl -sf http://127.0.0.1:8080/api/v1/health/live`                                                                                | 200                                                                         |
| API ready            | `curl -sf http://127.0.0.1:8080/api/v1/health/ready`                                                                               | 200                                                                         |
| Auth CSRF            | `curl -i -X POST http://127.0.0.1:8080/api/v1/auth/register -d '{"email":"x","password":"y"}' -H 'Content-Type: application/json'` | 400 (no mc_csrf needed for register), or 201 with `Set-Cookie: mc_csrf=...` |
| Auth smoke 4 cases   | `health-check.sh`                                                                                                                  | exit 0                                                                      |
| Planner КБЖУ         | `pnpm --filter @multichef/api test:integration` on CI runner                                                                       | ≤ 10% deviation                                                             |
| Port binding         | `ssh multichef 'ss -tlnp                                                                                                           | grep -E ":3000                                                              | :3001"'`    | `127.0.0.1:3000`, `127.0.0.1:3001` (NOT `0.0.0.0`) |
| Backups fresh        | `ssh multichef 'ls -la /var/lib/multichef/backups/multichef-*.sql.gz                                                               | tail -1'`                                                                   | mtime ≤ 26h |
| No empty-email users | `ssh multichef 'sudo -n -u postgres psql multichef -c "SELECT count(*) FROM \"User\" WHERE email = '\''\'\'';"'`                   | 0                                                                           |
| No 5xx in last hour  | `ssh multichef 'sudo journalctl -u multichef-api --since "1 hour ago" --no-pager                                                   | grep -c "5xx"'`                                                             | 0           |
| Gitleaks             | `cd /opt/multichef && sudo -n -u root gitleaks detect --source . --no-banner`                                                      | no leaks                                                                    |

**Acceptance criteria:**

- AC-1: All 10 checks pass (capture output).
- AC-2: Any failure → open a follow-up MC-XXX task.

### 5.4 Other tasks (lower priority, run only if time)

- MC-200 — recipe catalogue to 2000 (PLAN-2000-RECIPES.md, ~2 days)
- WP-2 — `<img>` loading/decoding/dimensions (~0.5 day)
- WP-3 — SEO basics (~0.5 day)
- WP-4 — WCAG a11y (~1 day)
- T-D.1 — backup restore-test runbook
- T-E.1 — account deletion flow

These are documented in `AUDIT_PLAN.md` with full AC and test cases.

---

## 6. Test harness (canonical)

A single command runs every gate locally on prod. **Run this before
declaring a task done.**

```bash
ssh multichef 'cd /opt/multichef && \
  sudo -u root /usr/bin/pnpm --silent lint && \
  sudo -u root bash -c "cd /opt/multichef/apps/api && /usr/bin/pnpm --silent typecheck" && \
  sudo -u multichef_app /usr/bin/pnpm --silent test && \
  sudo -u root /usr/bin/pnpm --silent format:check && \
  sudo -u root /usr/bin/pnpm --silent build && \
  sudo -u root /usr/bin/pnpm --silent audit --prod --audit-level=high && \
  sudo -u root gitleaks detect --source . --no-banner && \
  sudo /opt/multichef/infrastructure/scripts/health-check.sh http://127.0.0.1:8080'
```

Exit 0 = all gates green. Non-zero = which stage failed (look for the
last successful "ok" line in output).

---

## 7. Deploy workflow (canonical)

For every promotion to main:

```bash
# 1. Pre-flight: local CI gates against the about-to-be-deployed ref
ssh multichef 'cd /opt/multichef && \
  sudo -u root git fetch origin && \
  sudo -u root git reset --hard origin/main && \
  sudo -u root bash -c "cd /opt/multichef/apps/api && /usr/bin/pnpm typecheck"'

# 2. CI gates (same as .github/workflows/ci.yml) — runs in worktree
#    This script aborts BEFORE any prod mutation if any gate fails.
ssh multichef 'sudo /opt/multichef/infrastructure/scripts/deploy-safe.sh --ref origin/main'

# 3. Watch the deploy log
ssh multichef 'sudo tail -f /var/log/multichef-deploy-*.log'

# 4. Verify CI on GitHub
TOK=$(grep -oE "oauth_token: [a-zA-Z0-9_]+" /root/.config/gh/host.yml | sed 's/oauth_token: //')
SHA=$(ssh multichef 'cd /opt/multichef && git -c safe.directory=/opt/multichef rev-parse HEAD')
curl -sS -H "Authorization: token $TOK" \
  "https://api.github.com/repos/Gavroid/MULTI-CHEF/commits/$SHA/check-runs" \
  | python3 -c "import sys, json; [print(r['name'], r['conclusion']) for r in json.load(sys.stdin)['check_runs']]"

# 5. Run smoke once more (operator sanity)
ssh multichef 'sudo /opt/multichef/infrastructure/scripts/health-check.sh http://127.0.0.1:8080'
```

---

## 8. Branch + PR + commit conventions

### Branch naming

- `fix/MC-XXX-short-description` — bug fixes
- `feat/MC-XXX-short-description` — new functionality
- `chore/MC-XXX-short-description` — tooling / non-functional
- `docs/MC-XXX-short-description` — documentation only

### Commit message format

```
<type>(<scope>): MC-XXX <short summary>

<paragraph: what & why>

<reproducible test command + observed output>

<acceptance criteria met: AC-1, AC-2, ...>

Refs: docs/audit/AUDIT-R16-SUMMARY.md (if closing a round)
```

### PR body template (use this verbatim)

```markdown
## Summary

<one-paragraph>

## Repro / Before

<command + observed output>

## After

<command + observed output>

## Acceptance criteria

- AC-1: <verified how>
- AC-2: <verified how>

## Out-of-scope

<what was deliberately NOT touched>
```

---

## 9. Closing the round

When all R16 tasks are done:

1. Write `docs/audit/AUDIT-R16-SUMMARY.md` (template at the end of this prompt).
2. Commit + push to main.
3. Verify CI 7/7 green.
4. Run `deploy-safe.sh --ref origin/main` (no-op if HEAD == ref).
5. Report to operator:
   - List of MCs delivered
   - Live-state check results table
   - CI status
   - Known follow-ups for R17

### AUDIT-R16-SUMMARY.md template

```markdown
# MULTI-CHEF Audit R16 — <one-line summary>

**Date:** YYYY-MM-DD
**HEAD at audit start:** <sha>
**HEAD at audit end:** <sha>

---

## Сводка

| Task                     | AC met                   | Status |
| ------------------------ | ------------------------ | ------ |
| MC-103 Zod pipe metatype | AC-1/AC-2/AC-3/AC-4/AC-5 | ✅     |
| MC-105 ADR-0010          | AC-1/AC-2                | ✅     |
| Live-state checks        | 10/10                    | ✅     |

## Live-state checks (output captured below)

...

## Test command outputs

(paste real outputs from the test harness)

## Files touched

- path/to/file1 — what changed
- path/to/file2 — what changed

## Known follow-ups for R17

- ...
```

---

## 10. Anti-patterns (do NOT do)

- ❌ Commit secrets, `.env`, PATs, or any token to git.
- ❌ `git push --force` to main.
- ❌ `git reset --hard` on main before backing up.
- ❌ `pnpm db push` on prod (only `prisma migrate deploy`).
- ❌ `docker system prune` without operator ACK.
- ❌ `ufw`/`sshd` changes outside MC-080.
- ❌ Echo the GitHub PAT in chat or command output.
- ❌ Skip `deploy-safe.sh` "just this once" — every promotion goes through it.
- ❌ Mark a task complete without a real test command output captured in SUMMARY.md.
- ❌ Claim success from "it should work" — the verification-before-completion rule applies.
- ❌ Push to main without squash-merge from a feature branch.
- ❌ Revert a closed MC — open a new MC that supersedes it.
- ❌ Create a `package-lock.json` — the project uses pnpm.

---

## 11. Quick links

- Audit plan: `/root/workspace/multi-chef/AUDIT_PLAN.md` and `/opt/multichef/AUDIT_PLAN.md`
- Deploy doc: `/root/workspace/multi-chef/DEPLOY.md` and `/opt/multichef/DEPLOY.md`
- Architecture PRD: `/root/workspace/multi-chef/MULTICHEF-ARCHITECTURE-PRD.md`
- Dev plan: `/root/workspace/multi-chef/MULTICHEF-DEVELOPMENT-PLAN.md`
- Test strategy: `/root/workspace/multi-chef/MULTICHEF-TESTING-STRATEGY.md`
- Р15 SUMMARY: `docs/audit/AUDIT-R15-SUMMARY.md` (in repo)
- Р14 SUMMARY: `docs/audit/AUDIT-R14-SUMMARY.md` (in repo)
- Р13 SUMMARY: `docs/audit/AUDIT-R13-SUMMARY.md` (in repo)
- Existing ADRs: `docs/decisions/ADR-0006-*.md` and others

---

## 12. First action

```bash
# Verify all access is alive (one command)
ssh multichef 'hostname && uname -a && curl -sf http://127.0.0.1:8080/api/v1/health/live && echo "PROD OK"'
TOK=$(grep -oE "oauth_token: [a-zA-Z0-9_]+" /root/.config/gh/host.yml | sed 's/oauth_token: //')
curl -sS -H "Authorization: token $TOK" "https://api.github.com/repos/Gavroid/MULTI-CHEF" | python3 -c "import sys, json; d=json.load(sys.stdin); print('REPO:', d['full_name'], 'private=', d['private'])"
```

Both must return OK. If not, stop and ask the operator.

Then start with **MC-103** (highest priority — root cause unfixed).

Good luck.
