# MULTI-CHEF — Deploy Guide

> Single source of truth for promoting code from a developer commit
> to live traffic on `multichef` (192.168.1.95). **Read this end-to-end
> before running anything.**

---

## 1. Topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Developer (manager host: /root/workspace/multi-chef)                     │
│    - git push to origin (PR → main via squash-merge)                      │
│    - PR triggers GitHub Actions ci.yml                                    │
└──────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  GitHub: Gavroid/MULTI-CHEF (private)                                     │
│    - main = production branch                                             │
│    - PR checks: lint / typecheck / test / build / e2e / secret-scan /     │
│      audit (T44-A) — see .github/workflows/ci.yml                         │
└──────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼  (after PR is merged to main)
┌──────────────────────────────────────────────────────────────────────────┐
│  Prod host: multichef = 192.168.1.95 (LXC, Ubuntu 24.04)                 │
│    - /opt/multichef  →  systemd units: multichef-{web,api,worker}         │
│    - /etc/multichef/multichef.env  →  secrets + NEXT_PUBLIC_*             │
│    - Postgres 16 (127.0.0.1:5432) + Redis 7 (127.0.0.1:6379)              │
│    - nginx gateway :8080 (HTTP) + :8443 (TLS, self-signed)                │
│    - backups: /var/lib/multichef/backups/multichef-*.sql.gz (7 daily)     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. GitHub access

### SSH keys (manager host: `/root/.ssh/`)

| Private key | GitHub account | Purpose |
|---|---|---|
| `id_ed25519_github` | `Gavroid` | `git push` / `git fetch` (read+write) |
| `id_ed25519_cicd` | `Gavroid` | (alternate, same account) |
| `id_ed25519_actions_deploy` | `Gavroid` | GitHub Actions deploy key |

All three authenticate as `Gavroid` for `git@github.com:Gavroid/MULTI-CHEF.git`. SSH keys give **write to git only** — they do NOT grant REST API access.

### REST API access (GitHub PAT)

Stored in `~/.config/gh/host.yml`:

```yaml
github.com:
    oauth_token: ghp_***REDACTED***   # Personal Access Token
    user: Gavroid
    git_protocol: ssh
```

The Hermes runtime masks the actual token bytes in any tool output.
To use it from a shell without exposing the value to LLM context:

```bash
TOK=$(grep -oE "oauth_token: [a-zA-Z0-9_]+" /root/.config/gh/host.yml | sed 's/oauth_token: //')
curl -sS -H "Authorization: token $TOK" "https://api.github.com/repos/Gavroid/MULTI-CHEF/commits/main/check-runs"
```

Required scopes (verify at <https://github.com/settings/tokens>):
- `repo` (full control of private repositories)
- `read:org` (optional, only if you query org-level data)

### Updating INVENTORY

The PAT itself MUST NOT be written into `/root/.deploy-secrets/multichef/INVENTORY.md` (it would get committed on the next PR). INVENTORY §2.3 should record:

```markdown
### 2.3. Personal Access Token (for REST API)
| Field | Value |
|---|---|
| Token location | `~/.config/gh/host.yml` (`oauth_token`) |
| Account | Gavroid |
| Scopes | `repo`, `read:org` |
| Created | YYYY-MM-DD |
| Expires | YYYY-MM-DD |
| Rotation runbook | https://github.com/settings/tokens → "Regenerate" → update `~/.config/gh/host.yml` → test with `curl .../check-runs` |
```

---

## 3. SSH access to prod (multichef)

| Field | Value |
|---|---|
| Hostname / IP | `multichef` / `192.168.1.95` |
| User | `deploy` |
| Key | `~/.ssh/id_ed25519_deploy` (manager → prod) |
| `~/.ssh/config` | includes `Host multichef` alias |
| `deploy` privileges | `NOPASSWD sudo` for systemd, pnpm build, postgres ops |
| Service user | `multichef_app` (UID 1000-ish, owns /opt/multichef contents) |
| Service files owner | sometimes **UID 501** (docker-build artifact, see §6.2) |

---

## 4. Deploy pipeline (the one command)

```bash
ssh multichef '/opt/multichef/infrastructure/scripts/deploy-safe.sh'
```

Or with an explicit ref:

```bash
ssh multichef '/opt/multichef/infrastructure/scripts/deploy-safe.sh --ref origin/main'
```

The script (`infrastructure/scripts/deploy-safe.sh`) executes the **seven-stage** pipeline below. **Every stage is a hard gate** — failure aborts and (if the failure is post-deploy) rolls back automatically.

### Stage 0 — Pre-flight

1. Verify git remote, branch, and clean working tree on `multichef`.
2. Confirm `/etc/multichef/multichef.env` is present and sourceable.
3. Confirm systemd units `multichef-{web,api,worker}` exist.
4. Confirm `/opt/multichef` is writable by `deploy` (via `sudo`).
5. Capture the **current** commit SHA on prod as `PREV_SHA` — this is the rollback target.

**Gate:** any failure → abort (no changes made).

### Stage 1 — CI gates (local, before any prod mutation)

Run **exactly the same 7 checks that GitHub Actions runs** on `multichef` against the **about-to-be-deployed** commit. If any gate fails, abort.

| # | Gate | Command | Same as CI? |
|---|---|---|---|
| 1 | `lint` | `pnpm lint` | ✅ exact (`pnpm turbo run lint`) |
| 2 | `typecheck` | `cd apps/api && pnpm typecheck` (+ parallel for web/worker/packages) | ✅ exact |
| 3 | `test` | `pnpm test` (unit only; integration requires Docker) | ✅ exact |
| 4 | `build` | `pnpm build` | ✅ exact |
| 5 | `format:check` | `pnpm format:check` | ✅ exact |
| 6 | `secret-scan` | `gitleaks detect --source . --redact` | ✅ exact |
| 7 | `audit` | `pnpm audit --prod --audit-level=high` | ✅ exact |

**Note:** the `e2e (T28-B)` CI job requires a fresh web build + Playwright + a running app; it is NOT run by `deploy-safe.sh` (it would race with the running prod). `e2e` runs in GitHub Actions on PR.

**Gate:** any of {lint, typecheck, test, build, format:check, secret-scan, audit} failing → **abort, no changes**. Print the failing command + exit code + last 30 lines of output.

### Stage 2 — DB backup

Run `infrastructure/scripts/backup.sh` (already exists, MC-072.3). Writes `/var/lib/multichef/backups/multichef-<UTC>.sql.gz` (keeps last 7).

**Gate:** backup must succeed. If backup fails → abort (never deploy without a recoverable snapshot).

### Stage 3 — Pull new code

`git fetch origin && git reset --hard origin/<ref>` (only if the ref is reachable from origin — never push to prod from an un-pushed local commit).

**Gate:** `git` exit 0; HEAD matches expected ref.

### Stage 4 — Install + build

`sudo -u multichef_app env NEXT_PUBLIC_*=$NEXT_PUBLIC_* pnpm install --frozen-lockfile && pnpm turbo run build`.

**Gate:** `pnpm install` + `pnpm build` both exit 0.

### Stage 5 — Migrate (DB)

`sudo -u multichef_app env DATABASE_URL=$DATABASE_URL pnpm --filter @multichef/database exec prisma migrate deploy`.

**Gate:** migrate exit 0. On failure → **automatic rollback** (stage 7).

### Stage 6 — Restart services

`sudo systemctl restart multichef-web multichef-api multichef-worker && sleep 5`.

### Stage 7 — Smoke + automatic rollback

Run `infrastructure/scripts/health-check.sh http://127.0.0.1:8080`. The check probes:

- `GET /api/v1/health/live`  →  200
- `GET /api/v1/health/ready` →  200
- 4-case auth smoke:
  - `POST /auth/register` no email  →  400
  - `POST /auth/register` empty email → 400
  - `POST /auth/register` short pwd  →  400
  - `POST /auth/register` valid      →  201
- Plus any project-specific smoke cases added at the top of `health-check.sh`.

**Gate:** all green → ✅ **deploy complete**.

**On ANY smoke failure → automatic rollback:**

1. `git reset --hard $PREV_SHA`
2. `pnpm install --frozen-lockfile && pnpm build` (rebuild against old code)
3. `systemctl restart multichef-{web,api,worker}`
4. Repeat `health-check.sh` against the rolled-back state.
5. If rolled-back state is green → exit 1 with `ROLLBACK_OK` (operator must still investigate).
6. If rolled-back state is ALSO broken → exit 2 with `ROLLBACK_FAILED` (manual intervention required).

The exit code is what the operator's cron / CI / wrapper sees. **Non-zero is always a stop-and-investigate signal.**

---

## 5. What "good" looks like

A successful deploy prints:

```
deploy-safe: preflight        ok
deploy-safe: ci-gates         ok (7/7)
deploy-safe: backup           ok (/var/lib/multichef/backups/multichef-20260917T075500Z.sql.gz)
deploy-safe: pull             ok (HEAD=46c0093)
deploy-safe: install+build    ok
deploy-safe: migrate          ok
deploy-safe: restart          ok
deploy-safe: smoke            ok (4/4)
deploy-safe: complete         HEAD=a484201 (prev=a6680fe)
deploy-safe: exit 0
```

---

## 6. Operator's quick reference

### 6.1. Manual rollback (if `deploy-safe.sh` is broken)

```bash
ssh multichef 'cd /opt/multichef && \
  sudo -u root git reset --hard <PREV_SHA> && \
  sudo -u multichef_app pnpm install --frozen-lockfile && \
  sudo -u root bash -c "cd /opt/multichef/apps/api && pnpm build" && \
  sudo systemctl restart multichef-web multichef-api multichef-worker'
```

### 6.2. The `UID 501` ownership trap

Files written by CI runner or by Docker-build sometimes have `UID 501` (not `multichef_app` / not `root`). `multichef_app` cannot `rm` or `chown` them. Fixes:

- **Source files** (`apps/api/src/...`): `sudo -u root -H bash -c 'chown -R multichef_app:multichef_app /opt/multichef/apps/api/src'`
- **Build artifacts** (`apps/api/dist/...`): same — they get overwritten on next build, so just `sudo -u root pnpm build`.
- **For deployment automation:** `deploy-safe.sh` runs `pnpm install` + `pnpm build` as `multichef_app`, then uses `sudo` only for `systemctl`, `pg_dump`, and `git reset --hard`. The `UID 501` files are inert after rebuild.

### 6.3. Inspecting a failure mid-deploy

If `deploy-safe.sh` exits non-zero, the script writes a transcript to `/var/log/multichef-deploy-<UTC>.log`. Read it:

```bash
ssh multichef 'sudo tail -n 200 /var/log/multichef-deploy-*.log | tail -n 200'
```

### 6.4. Inspecting CI on GitHub (without UI)

```bash
TOK=$(grep -oE "oauth_token: [a-zA-Z0-9_]+" /root/.config/gh/host.yml | sed 's/oauth_token: //')
SHA=$(git -C /opt/multichef rev-parse HEAD)
curl -sS -H "Authorization: token $TOK" \
  "https://api.github.com/repos/Gavroid/MULTI-CHEF/commits/$SHA/check-runs" \
  | python3 -c "import sys, json; d=json.load(sys.stdin); [print(r['name'], r['conclusion']) for r in d['check_runs']]"
```

### 6.5. Restoring a DB backup (last-resort)

```bash
ssh multichef 'sudo -u postgres dropdb multichef && \
  sudo -u postgres createdb multichef && \
  sudo -u postgres pg_restore -d multichef /var/lib/multichef/backups/multichef-20260917T030001Z.sql.gz'
```

---

## 7. Why this design

The **CI gates run BEFORE any prod mutation** because:

1. If CI is red on a commit, deploying it is pointless — the GitHub merge
   gate should have caught it, but defense in depth: a local CI re-run
   catches the case where GitHub Actions missed something (Node version
   drift, missing `.env`, monorepo cache state).

2. If CI is red and the deploy script proceeded anyway, the prod code
   would diverge from "what CI approved" — that's how R13/R14 bugs
   slipped through (audit-r14 TC-1: real planner never tested because
   `USE_MEALPLAN_MOCK=1` was on prod, off CI).

3. **Stage 7's automatic rollback** is the safety net for the case where
   CI is green but prod runtime is broken (e.g., a Prisma migration
   that's valid in schema but breaks against real data).

The script is intentionally verbose — every stage prints ok/FAIL — so
the operator's `tail -f /var/log/multichef-deploy-*.log` shows exactly
where things stopped.

---

## 8. Known limitations

| Limitation | Mitigation |
|---|---|
| e2e (Playwright) is not in `deploy-safe.sh` | Runs in GitHub Actions on PR; operator runs manually before risky deploys |
| Postgres integration tests require Docker | Only run on CI runner or a dedicated test host, not prod |
| `pnpm audit` may flag transitive deps that we can't fix immediately | `--audit-level=high` keeps the noise down; high-severity issues block deploy |
| `UID 501` files block `multichef_app` writes | See §6.2 |
| `safe.directory` for git on multichef | Always run `git -c safe.directory=/opt/multichef ...` in one-off commands; `deploy-safe.sh` sets it globally |

---

## 9. Change history

| Date | Author | Change |
|---|---|---|
| 2026-09-17 | Hermes Agent (Audit R15) | Initial document + `deploy-safe.sh` v1 |
