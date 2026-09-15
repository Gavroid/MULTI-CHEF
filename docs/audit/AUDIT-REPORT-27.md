# Технический, продуктовый и UI-аудит MULTI-CHEF (27-й круг)

**Дата:** 2026-09-15
**HEAD:** `d142207 chore(audit): AUDIT-REPORT-26 worker-pii-observability`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-26.md`, `FIX-PLAN.md`
**Фокус:** DB seed scripts / migrations / docker / infrastructure deploy pipeline.

## TL;DR

27-й круг: **4 находки** — 0 P0, 1 🟠 P2 (deploy rollback), 3 🟡 P3.

- 🟠 **T27-A** — `infrastructure/scripts/deploy.sh` НЕ имеет автоматического rollback. Если smoke-check падает после `migrate deploy + restart`, система остаётся в broken-состоянии (new migration applied, new build, new code, services broken) — только ручной `git revert + redeploy`.
- 🟡 **T27-B** — `packages/database/src/seed/index.ts` создаёт `Household`/`HouseholdMember` напрямую, без `withTenantContext`. Сегодня работает потому что RLS-policies на эти таблицы **declared but NOT enabled** (mc087 + ADR-0023). Когда следующая фаза RLS rollout включит ENFORCE на auth-bootstrap — **seed сломается**.
- 🟡 **T27-C** — `backup.sh` хранит только последние 7 дампов, **без off-site копий**. Disk-failure / ransomware на `/var/lib/multichef/backups/` = потеря всей истории.
- 🟡 **T27-D** — `health-check.sh` валидирует только что `GET /today = 200`. Next.js может вернуть 200 с HTML, содержащим client-side redirect → false-positive. Нет проверки реального content.

---

## 1. Технические находки (27-й круг)

### T27-A. `deploy.sh` без автоматического rollback 🟠 P2

**Файл:** `infrastructure/scripts/deploy.sh` (52 строки).

**Сырой код (полный pipeline):**

```bash
#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/multichef
ENV_FILE=/etc/multichef/multichef.env
cd "$APP_DIR"

echo "deploy: preflight"
git fetch origin
git status --porcelain | grep -q . && { echo "deploy: dirty tree, abort"; exit 1; }
set -a; source "$ENV_FILE"; set +a

echo "deploy: backup"
"$(dirname "$0")/backup.sh"

echo "deploy: pull"
git pull --ff-only origin main

echo "deploy: install + build"
sudo -u multichef_app env ... pnpm install --frozen-lockfile
sudo -u multichef_app env ... pnpm turbo run build --filter=@multichef/web... --filter=@multichef/api...

echo "deploy: migrate"
sudo -u multichef_app env DATABASE_URL="$DATABASE_URL" pnpm --filter @multichef/database exec prisma migrate deploy

echo "deploy: restart services"
systemctl restart multichef-web multichef-api multichef-worker
sleep 5

echo "deploy: smoke"
"$(dirname "$0")/health-check.sh" http://127.0.0.1:8080
echo "deploy: OK"
```

**Что упущено:**

1. **`set -euo pipefail`** + **нет `trap` на cleanup** — если `health-check.sh` падает, `set -e` сделает `exit 1`, но **никакого rollback не происходит**.
2. **Migration applied forward-only**: `prisma migrate deploy` НЕ имеет `down`-функции. Если migration добавляет constraint и он ломает runtime — БД остаётся в новом состоянии.
3. **New build / new code in dist/** — уже лежит на диске. Если откатываться к старому HEAD, нужно `git checkout HEAD~1 + pnpm install + pnpm build`.
4. **Systemd restart уже случился** — `multichef-web/api/worker` сейчас на новом коде, и если smoke fail → юзеры видят 500.

**Recovery procedure** (полностью ручная):

```bash
# Operator must:
1. ssh root@192.168.1.95
2. cd /opt/multichef
3. git revert HEAD --no-edit  # generate revert commit
4. git push origin main         # push revert
5. redeploy (re-run deploy.sh)  # this applies revert + builds + migrates
6. Если проблема в самой миграции — придётся писать mcXXX_revert.sql руками
```

В комментарии скрипта: «manual; automated rollback via `git revert` of the failing ref + restart» — то есть **rollback-стратегия не автоматизирована**.

**Реальный сценарий:**

- Деплой commit `abc123` добавляет `mc089_rls_enable_mealplans_shopping_profile` (RLS FORCE на MealPlan).
- `withTenantContext` НЕ применён в каком-то новом эндпойнте → этот эндпойт получает 500 на каждом запросе.
- Health-check возвращает 500 → `health-check.sh exit 1` → `deploy.sh exit 1` → **на диске уже:**
  - new code (meal-plans.service с багом)
  - applied migration (RLS FORCE)
  - new build (dist/)
  - **services restart'нуты** (юзеры получают 500)
- Operator должен: revert commit, redeploy, pray.

**Рекомендованный фикс:**

```bash
# deploy.sh — добавить:
PRE_DEPLOY_HEAD=$(git rev-parse HEAD)
trap 'rollback $PRE_DEPLOY_HEAD $?' ERR

rollback() {
  local previous_head=$1
  local exit_code=$2
  echo "deploy: smoke FAILED (exit $exit_code), rolling back to $previous_head"
  systemctl restart multichef-web multichef-api multichef-worker  # restart with old code first
  # Migration rollback is manual: see docs/runbooks/rollback.md
  exit $exit_code
}
```

Альтернатива — **Blue/Green deploy** (systemd запускает два instance'а, переключение через nginx upstream). Сложнее, но надёжнее.

Минимум: задокументировать в `docs/runbooks/rollback.md` exact steps + добавить `trap` в `deploy.sh`.

### T27-B. Seed script работает только потому что RLS policies NOT enabled 🟡 P3

**Файл:** `packages/database/src/seed/index.ts:155-180` (demo household creation), `packages/database/src/seed/recipes/index.ts` (recipe creation).

**Сырой код (Household create — без tenant context):**

```ts
// packages/database/src/seed/index.ts:158-170
if (!existingHh) {
  await prisma.household.create({
    data: {
      id: DEMO_HOUSEHOLD.id,
      name: DEMO_HOUSEHOLD.name,
      ownerId: demoUser.id,
      defaultPeopleCount: DEMO_HOUSEHOLD.defaultPeopleCount,
      currency: DEMO_HOUSEHOLD.currency,
    },
  });
  // ...
}
```

**Состояние RLS на эти таблицы (mc087 + mc089):**

```sql
-- packages/database/prisma/migrations/20260914_mc087_rls_policies/migration.sql
CREATE POLICY tenant_isolation ON "Household"
  USING ("id" = current_setting('app.household_id', true))
  WITH CHECK ("id" = current_setting('app.household_id', true));

CREATE POLICY tenant_isolation ON "HouseholdMember"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

-- policies declared but NOT enabled (per ADR-0023 phase 3 comment):
-- NOT enabled here (auth-bootstrap redesign pending, user decision):
-- "User", "Session", "Household", "HouseholdMember", "Job"
```

**Эффект сегодня:**

- `prisma.household.create({ data: {...} })` — Postgres **не проверяет** policy (FORCE не стоит) → insert проходит.
- Когда auth-bootstrap фаза завершится и кто-то напишет `mc090_rls_enable_household_user_session.sql` с `ALTER TABLE "Household" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Household" FORCE ROW LEVEL SECURITY;` → seed сломается.

**Что нужно:**

- Migrate seed-script на `withTenantContext({ householdId: DEMO_HOUSEHOLD.id, userId: demoUser.id }, async (tx) => tx.household.create(...))` уже сейчас, чтобы он был готов к следующей фазе.
- То же для `User`, `HouseholdMember`, `Job` (когда их RLS включат).

**Рекомендованный фикс:**

- Добавить **тест**: `seed-integration.test.ts` запускает `pnpm db:seed` против `multichef_test`, проверяет что все таблицы, на которых сейчас RLS declared-but-disabled, остаются writable. Когда RLS enable-нут — тест сразу зафейлится → оператор увидит и поправит seed.
- Уже сейчас обернуть seed операции в `withTenantContext`, чтобы при enablement они работали.

### T27-C. `backup.sh` без off-site копий 🟡 P3

**Файл:** `infrastructure/scripts/backup.sh` (12 строк).

**Сырой код:**

```bash
#!/usr/bin/env bash
set -euo pipefail
set -a; source /etc/multichef/multichef.env; set +a
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=/var/lib/multichef/backups/multichef-$STAMP.sql.gz
sudo -u postgres pg_dump multichef | gzip > "$DEST"
ls -1t /var/lib/multichef/backups/multichef-*.sql.gz | tail -n +8 | xargs -r rm --
echo "backup: $DEST"
```

**Проблемы:**

1. **Только локальный диск** — `/var/lib/multichef/backups/` на том же хосте, что и Postgres. Disk failure (SSD corruption, OOM kill of Postgres VM, ransomware) = всё потеряно.
2. **Rotation только 7 dumps** — `tail -n +8` = «оставить только последние 7». Если deploy ежедневный → 7 дней истории. Для incident response на 30-дневной ретроспективе — не хватит.
3. **`sudo -u postgres pg_dump`** — credentials в `/etc/multichef/multichef.env`, без отдельного backup user. Если этот env скомпрометирован → backup тоже скомпрометирован.
4. **Нет проверки целостности backup** — `pg_dump | gzip` сразу удаляет. Если dump corrupt (postgres mid-write) — оператор узнает только когда пытается restore.

**Рекомендованный фикс:**

1. **Off-site**: добавить `aws s3 cp ... || rsync ...` после `pg_dump`. Минимум — `rclone copy /var/lib/multichef/backups/ remote:multichef-backups/` (Google Drive / S3 / Backblaze B2).
2. **Longer retention**: оставить `daily: 7`, добавить `weekly: 4`, `monthly: 6` = 6+ месяцев истории.
3. **Verify integrity**: после дампа — `gunzip -t` (проверить gzip), `pg_restore --list` в test-DB (если возможно).
4. **Restore drill**: ежеквартально документированный restore-test (см. `docs/runbooks/secret-rotation.md §restore`, упомянутый в backup.sh комментарии — но реального теста нет).

### T27-D. `health-check.sh` валидирует только HTTP 200, не контент 🟡 P3

**Файл:** `infrastructure/scripts/health-check.sh` (12 строк).

**Сырой код:**

```bash
BASE=${1:-http://127.0.0.1:8080}
curl -sf "$BASE/api/v1/health/live" >/dev/null || { echo "health: api live FAILED"; exit 1; }
curl -sf "$BASE/api/v1/health/ready" >/dev/null || { echo "health: api ready FAILED"; exit 1; }
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/today")
[ "$STATUS" = "200" ] || { echo "health: web /today FAILED ($STATUS)"; exit 1; }
```

**Проблемы:**

1. **`GET /today` всегда 200**, потому что middleware redirect (см. T19-B / `apps/web/src/middleware.ts`) возвращает 307 redirect на `/auth/login` если нет session. Но это НЕ 200, это 307. Если 307 → script exit 1. ✓
2. **Но если Next.js возвращает 200 с HTML, содержащим client-side `redirect`** (старая версия до T19-B, или при ошибке middleware) → script думает «OK» → smoke passes → broken deploy.
3. **Health-check не проверяет API write** (например, `POST /api/v1/profile/preferences` с тестовыми данными). Только read endpoints.
4. **Нет timeout** — если `curl -sf` зависает на TCP-уровне (slowloris), скрипт тоже зависнет (нет `--max-time`).
5. **Не учитывает разные инстансы**: только `127.0.0.1:8080` (nginx). Если API/web упал, а nginx работает (например, неправильный proxy_pass) → health-check passes, но приложение не работает.

**Рекомендованный фикс:**

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=${1:-http://127.0.0.1:8080}
TIMEOUT=10

# 1. Liveness (process up)
curl -sf --max-time "$TIMEOUT" "$BASE/api/v1/health/live" >/dev/null

# 2. Readiness (DB+Redis reachable)
curl -sf --max-time "$TIMEOUT" "$BASE/api/v1/health/ready" >/dev/null

# 3. Web SSR — extract <title> from /today HTML
HTML=$(curl -sf --max-time "$TIMEOUT" "$BASE/today")
echo "$HTML" | grep -q "<title>" || { echo "health: /today has no <title>"; exit 1; }

# 4. Web static asset (favicon, sw.js)
curl -sf --max-time "$TIMEOUT" "$BASE/icons/icon.svg" >/dev/null

echo "health: OK ($BASE)"
```

Опционально: гонять через localhost:3000 (web direct) и localhost:3001 (api direct), а не только через nginx. Если nginx fallback сломан, это тоже увидим.

---

## 2. Подтверждённые здоровые паттерны

- **Migrations numbered и reversible**: `mc022`, `mc050`, `mc085`, `mc086`, `mc087`, `mc088`, `mc089` — каждая с явным rollback comment (см. `mc089`). ✓
- **`migration_lock.toml`** в `packages/database/prisma/migrations/` — Prisma convention. ✓
- **Seed script idempotency**: `upsert by slug`, `createMany skipDuplicates`, `findUnique before create`. Можно запускать много раз. ✓
- **`deploy.sh` preflight**: проверяет dirty tree, `git pull --ff-only` (отвергает non-FF), `--frozen-lockfile` для pnpm. ✓
- **Backup rotates**: 7 последних дампов не накапливаются бесконечно. ✓
- **Systemd unit-files существуют** (`multichef-{web,api,worker}.service`). ✓
- **`migrate deploy` (forward-only) — Prisma production pattern** ✓

## 3. Микро-наблюдения

- **T27-α** — `infrastructure/scripts/bootstrap.sh` — есть, но не прочитан. Потенциально содержит TLS cert generation, systemd setup. Hygiene: убедиться, что он тоже в git (не только в `/etc/`).
- **T27-β** — `infrastructure/scripts/rotate-secrets.sh` — упомянут в комментарии backup.sh, реально не прочитан. Если secrets rotated нечасто — потенциальный stale credentials.
- **T27-γ** — Нет `docker-compose.yml` — bare-metal deploy (systemd + nginx + pnpm). Для CI/локальной разработки без БД — нет `docker-compose.dev.yml`. Это **намеренный выбор** (avoid Docker drift), но ограничивает onboarding новых разработчиков.
- **T27-δ** — `mc087_rls_policies` создаёт policies на **5 auth-bootstrap таблиц** (User, Session, Job, Household, HouseholdMember), но они **declared-but-disabled**. Если кто-то случайно напишет `ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY` в следующей миграции — `Job` создаётся в `auth.service.register()` без `set_config` → fail-closed. Защиты от этого нет (нет CI check на «случайный ENABLE для таблицы без tenant-context flow»).
- **T27-ε** — `seed/nutrition/*` (3930 строк `nutrition-data.ts`) — большой payload. Если seed-network latency высокая (cross-region prod), загрузка занимает минуты. Hygiene: идемпотентность OK, но throughput не меряется.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона           | Находка                                                                                                                            | Где                                           |
| --------- | --------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **T27-A** | 🟠 P2     | Infra / Deploy | `deploy.sh` без автоматического rollback. Failed smoke = broken state (migration applied, services restarted, manual recovery).    | `infrastructure/scripts/deploy.sh`            |
| **T27-B** | 🟡 P3     | DB / Seed      | Seed создаёт Household/HouseholdMember/User напрямую (без `withTenantContext`). Работает сегодня, сломается на следующей RLS-фазе. | `packages/database/src/seed/index.ts:155-180` |
| **T27-C** | 🟡 P3     | Infra / Backup | `backup.sh` — только локальный диск, 7 дампов, без off-site / integrity verify.                                                    | `infrastructure/scripts/backup.sh`            |
| **T27-D** | 🟡 P3     | Infra / Health | `health-check.sh` валидирует только HTTP 200, не контент / не write endpoint / не timeout. False-positive возможен.                | `infrastructure/scripts/health-check.sh`      |

## 5. Куммулятивный итог (27 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3        | 🟡 ℹ️ | Cumulative                    |
| ------- | ------------------- | ----- | ----- | --------------- | ----- | ----------------------------- |
| #1–3    | 26                  | 9     | 0     | 6               | 11    | —                             |
| #4–10   | 13                  | 0     | 0     | 13              | 0     | —                             |
| #11     | T11-A, T11-B        | 0     | 0     | 2               | 0     | —                             |
| #12     | T12-A               | 0     | 0     | 1               | 0     | —                             |
| #13     | T13-A               | 1 P0  | 0     | 0               | 0     | 10 P0                         |
| #14     | T14-A               | 0     | 0     | 1               | 0     | 10 P0                         |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1               | 0     | 11 P0                         |
| #16     | T16-A, T16-B        | 0     | 0     | 2               | 0     | 11 P0                         |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0               | 0     | 11 P0, 2 P1                   |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 11 P0, 2 P1, 2 P2             |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2            | 0     | 11 P0, 2 P1, 4 P2             |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2            | 0     | 12 P0, 2 P1, 6 P2             |
| #21     | T21-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 12 P0, 2 P1, 8 P2, 4 P3       |
| #22     | T22-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 9 P2, 6 P3       |
| #23     | T23-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 10 P2, 8 P3      |
| #24     | T24-A–D             | 0     | 0     | 3 P2 + 1 P3     | 0     | 12 P0, 2 P1, 13 P2, 9 P3      |
| #25     | T25-A–D             | 0     | 0     | 1 P2 + 3 P3     | 0     | 12 P0, 2 P1, 14 P2, 12 P3     |
| #26     | T26-A–C             | 0     | 0     | 0               | 3 P3  | 12 P0, 2 P1, 14 P2, 15 P3     |
| **#27** | **T27-A–D**         | **0** | **0** | **1 P2 + 3 P3** | **0** | **12 P0, 2 P1, 15 P2, 18 P3** |

**Тренд 27-го:** infrastructure / deployment. После observability (26) — переходим к **deploy-pipeline** (T27-A — самый рискованный, потенциально downtime на проде при failed deploy). T27-B латентный баг, который сработает на следующей RLS-фазе.

## 6. Рекомендации (27-й круг)

1. **(P2, 1ч, T27-A)** Добавить `trap` и `rollback` функцию в `deploy.sh`. Минимум — задокументировать runbook `docs/runbooks/rollback.md` с exact steps. В идеале — blue/green deploy.
2. **(P3, 1ч, T27-B)** Завернуть seed-операции с `Household`/`HouseholdMember`/`User` в `withTenantContext`. Добавить regression-test в `seed-integration.test.ts`.
3. **(P3, 2ч, T27-C)** Добавить off-site backup (`rclone copy` → S3/B2/Drive). Увеличить retention до 7d+4w+6m. Добавить `gunzip -t` integrity check.
4. **(P3, 30 мин, T27-D)** Расширить `health-check.sh`: `--max-time 10`, проверка `<title>` в HTML `/today`, проверка `/icons/icon.svg`, опционально — проба на `127.0.0.1:3000` (web) и `127.0.0.1:3001` (api) напрямую.

## 7. Артефакты (27-й круг)

| Артефакт                         | Где                             |
| -------------------------------- | ------------------------------- |
| Этот отчёт                       | `docs/audit/AUDIT-REPORT-27.md` |
| FIX-PLAN (T27-A,B,C,D)           | `docs/audit/FIX-PLAN.md`        |
| `deploy.sh` rollback             | §1 T27-A                        |
| seed без tenant context          | §1 T27-B                        |
| `backup.sh` без off-site         | §1 T27-C                        |
| `health-check.sh` false-positive | §1 T27-D                        |
