# Технический, продуктовый и UI-аудит MULTI-CHEF (33-й круг)

**Дата:** 2026-09-15
**HEAD:** `475689d chore(audit): AUDIT-REPORT-32 cookie-hygiene`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-32.md`, `FIX-PLAN.md`
**Фокус:** Prisma migration safety — Postgres lock semantics, `CREATE INDEX CONCURRENTLY`, transaction wrapping.

## TL;DR

33-й круг: **4 находки** — 0 P0, 1 🟠 P2 (no `CONCURRENTLY`), 3 🟡 P3.

- 🟠 **T33-A** — **ни одна миграция не использует `CREATE INDEX CONCURRENTLY`**. 8 из 8 миграций (mc003, mc022, mc050, mc085, mc086, mc087, mc088, mc089) создают индексы через `CREATE INDEX` (non-concurrent). На больших таблицах (Recipe, PantryItem) — длительный AccessExclusiveLock, минуты downtime на каждый index create.
- 🟡 **T33-B** — Migrations не имеют явных `BEGIN/COMMIT` блоков. Prisma migrate deploy оборачивает сам, но если кто-то применяет миграцию вручную через `psql -f migration.sql` — без транзакции.
- 🟡 **T33-C** — `mc086` сначала DELETE duplicates (`DELETE FROM "Preference" p USING ...`), потом CREATE UNIQUE INDEX. DELETE без `LIMIT` → долгий RowExclusiveLock на большой таблице. И без CONCURRENTLY.
- 🟡 **T33-D** — migrations не имеют rollback SQL (down-скриптов). Prisma convention — forward-only, но ADR упоминает rollback для mc087/mc089 в комментариях — нужно зафиксировать.

---

## 1. Технические находки (33-й круг)

### T33-A. Migrations без `CREATE INDEX CONCURRENTLY` — lock risk 🟠 P2

**Файлы:** все миграции в `packages/database/prisma/migrations/`.

**Сырой код (примеры):**

```sql
-- 20260909_mc022_add_pantryitem_archived_notes/migration.sql:14-15
CREATE INDEX "PantryItem_householdId_archivedAt_idx"
  ON "PantryItem" ("householdId", "archivedAt");

-- 20260912_mc050_job_paramshash/migration.sql:5-6
CREATE INDEX "Job_paramsHash_idx" ON "Job"("paramsHash");

-- 20260913_mc085_recipe_title_indexes/migration.sql:8-9
CREATE UNIQUE INDEX "Recipe_title_lower_key" ON "Recipe" (lower("title"));
CREATE INDEX "Recipe_title_trgm_idx" ON "Recipe" USING gin ("title" gin_trgm_ops);

-- 20260914_mc086_preference_unique/migration.sql:24-25
CREATE UNIQUE INDEX "Preference_userId_kind_ingredientId_key"
  ON "Preference"("userId", "kind", "ingredientId");
```

**Проблема:**

`CREATE INDEX` (без `CONCURRENTLY`) берёт **`ACCESS EXCLUSIVE`** lock на таблице. Это самая строгая блокировка в Postgres — все reads/writes ждут завершения.

**Эффект на production:**

1. **`Recipe` таблица** — каталог ~2000 строк (маленький). Lock ~1-2 sec. **ОК**.
2. **`PantryItem` таблица** — потенциально 10k-1M строк на активный household * N households. Lock ~10-100 sec. **Проблема**.
3. **`Job` таблица** — растёт постоянно (одна строка на каждое enqueue). Lock ~5-30 sec. **Проблема** (запросы meal-plan-generate блокируются).
4. **`Preference`** — может быть 100-1000 строк на user * N users. Lock ~1-10 sec. **Marginal**.

**Без CONCURRENTLY:**

- Index creation is **online** to readers (Postgres 11+) только для plain b-tree.
- Writers **блокируются полностью**.
- GIN index (mc085 `Recipe_title_trgm_idx`) — full table rebuild под AccessExclusiveLock. На 100k rows → minutes.

**С CONCURRENTLY:**

- Index creation is **online** для всех readers AND writers.
- Takes 2-3x longer (needs to track changes during build).
- Cannot run inside transaction (Prisma wraps migration в transaction — conflict!).

**Prisma migrate deploy и CONCURRENTLY:**

Prisma convention: `prisma migrate deploy` запускает каждую миграцию в **single transaction**. `CREATE INDEX CONCURRENTLY` **не может** выполняться в транзакции → Postgres error.

**Решение:** создавать индексы через **raw SQL outside Prisma** или через **двухшаговую миграцию**:

1. Migration 1: `CREATE INDEX CONCURRENTLY` (raw SQL, no transaction).
2. Migration 2: standard Prisma migration (uses the index).

**Доказательство:**

```bash
$ grep -rn "CONCURRENTLY" packages/database/prisma/migrations/ 2>/dev/null
# (пусто — ни одной миграции с CONCURRENTLY)
```

**Смягчающий фактор:** текущий prod — маленький dataset (LAN dev). Lock ~1 sec. Но для production growth (10k+ households) — критично.

**Рекомендованный фикс:**

1. **Audit существующие индексы** — определить, какие на больших таблицах (PantryItem, Job, MealPlan). Мигрировать на `CONCURRENTLY` в рамках **online maintenance window**.
2. **Pattern для новых миграций**:
   ```sql
   -- Step 1: raw SQL outside transaction
   -- File: migration_concurrent.sql (not migration.sql)
   CREATE INDEX CONCURRENTLY "PantryItem_householdId_archivedAt_idx"
     ON "PantryItem" ("householdId", "archivedAt");
   ```
3. **Migration lock helper** — `scripts/migration-with-concurrent.ts`:
   - Detect `CREATE INDEX CONCURRENTLY` в raw SQL.
   - Run **outside** transaction.
   - Wrap non-CONCURRENTLY operations в transaction.
4. **Runbook** — задокументировать online-maintenance procedure в `docs/runbooks/migrations.md`.

### T33-B. Migrations без явных `BEGIN/COMMIT` 🟡 P3

**Файлы:** все миграции (каждая — отдельный SQL файл без transaction wrapper).

**Сырой код (пример):**

```sql
-- 20260914_mc086_preference_unique/migration.sql:8-25
DELETE FROM "Preference" p
USING "Preference" q
WHERE p."userId" = q."userId"
  AND ...;

CREATE UNIQUE INDEX "Preference_userId_kind_ingredientId_key"
  ON "Preference"("userId", "kind", "ingredientId");
```

Нет `BEGIN;` / `COMMIT;` обёртки.

**Эффект:**

- **Prisma migrate deploy** автоматически оборачивает миграцию в `BEGIN/COMMIT`. ✓
- **Manual apply через psql**: `psql -f migration.sql` — каждая команда отдельная транзакция (autocommit mode). Если DELETE проходит, а CREATE INDEX fails → БД остаётся с дубликатами (хотя бы частично) и без индекса. Manual recovery.

**Смягчающий фактор:** стандартная практика — применять миграции только через `prisma migrate deploy`, не вручную. Если это правило соблюдается — фикс не критичен.

**Рекомендованный фикс:** (опционально) добавить `BEGIN;` / `COMMIT;` в каждой миграции (но Prisma тогда будет жаловаться на nested transactions — нужно проверить). Лучше — задокументировать «always use prisma migrate deploy».

### T33-C. `mc086` — DELETE без LIMIT + UNIQUE INDEX без CONCURRENTLY 🟡 P3

**Файл:** `packages/database/prisma/migrations/20260914_mc086_preference_unique/migration.sql:8-25`.

**Сырой код:**

```sql
DELETE FROM "Preference" p
USING "Preference" q
WHERE p."userId" = q."userId"
  AND p."kind" = q."kind"
  AND p."ingredientId" IS NOT NULL
  AND p."ingredientId" = q."ingredientId"
  AND p."id" > q."id";    -- ← keep oldest (ULID sorts by creation time)

CREATE UNIQUE INDEX "Preference_userId_kind_ingredientId_key"
  ON "Preference"("userId", "kind", "ingredientId");
```

**Проблема:**

1. **`DELETE ... USING` (self-join)** — может матчить несколько дубликатов для одной строки, удаляя все кроме одной. Но если у одного user'а 1000 preferences — full-table scan + full-table comparison.
2. **`CREATE UNIQUE INDEX`** — AccessExclusiveLock на большой таблице.
3. **Нет `LIMIT`** — DELETE deletes всё за один statement. Long transaction = long lock.

**Смягчающие факторы:**

- Текущая таблица Preference маленькая.
- Migration уже применена в проде.

**Рекомендованный фикс:** для будущих dedup-migrations:

1. Batched DELETE: `DELETE ... WHERE id IN (SELECT ... LIMIT 1000)` в цикле.
2. UNIQUE INDEX через CONCURRENTLY.
3. Pre-flight check: `SELECT COUNT(*)` для оценки объёма.

### T33-D. Migrations без rollback SQL 🟡 P3

**Файлы:** все миграции (Prisma convention — forward-only).

**Что есть:**

- Комментарии в `mc087` и `mc089` объясняют rollback pattern:
  ```sql
  -- Rollback: per table —
  --   ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;
  --   ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
  ```
- Но **фактический rollback SQL** — нигде не зафиксирован.

**Эффект:**

- Если mc089 (RLS FORCE на MealPlan etc) сломается на production — единственный recovery это **forward-fix** (новая миграция, которая disable'ит RLS).
- Документация rollback в комментариях — хорошо, но не machine-readable.

**Рекомендованный фикс:** (опционально) создать `packages/database/prisma/rollback/` директорию с SQL файлами `mcXXX_down.sql`. Задокументировать в `docs/runbooks/rollback.md`.

---

## 2. Подтверждённые здоровые паттерны

- **Migrations numbered & self-contained** — каждая в своей директории с одним `migration.sql`. ✓
- **`migration_lock.toml`** присутствует (Prisma convention). ✓
- **Rollback hints в комментариях** (`mc087`, `mc089`) — оператор знает, как откатить. ✓
- **mc089 включает `IF NOT EXISTS`-style guards** — partial protection (но не везде).
- **Initial migration self-contained** — все CREATE TYPE / CREATE EXTENSION / CREATE TABLE в одном файле.
- **Идемпотентные миграции** через `IF NOT EXISTS` для extensions (`mc003:587-589`).

## 3. Микро-наблюдения

- **T33-α** — `CREATE TYPE` (enums) в mc003 — не используется `IF NOT EXISTS`. Для initial migration OK, но если когда-нибудь понадобится re-run — сломается.
- **T33-β** — Migrations не имеют `precondition` checks (например, `IF EXISTS (SELECT ... FROM pg_indexes WHERE ...)`) перед DROP. Для forward-only это OK, но для zero-downtime deployments — может быть полезно.
- **T33-γ** — `mc022` ALTER TABLE дважды (ADD COLUMN x2) — может быть объединено в один ALTER для краткости, но Prisma convention — отдельные statements. ✓
- **T33-δ** — Migrations не содержат `ANALYZE` после bulk operations (`ANALYZE "Preference";` после DELETE) — query planner может использовать stale statistics. Hygiene.
- **T33-ε** — `mc088` и `mc089` — отдельные миграции для RLS. Правильный incremental rollout (не пытаться всё в одной миграции). ✓
- **T33-ζ** — `mc087` создаёт policies для **5 таблиц, которые НЕ включены** (User, Session, Job, Household, HouseholdMember). Latent bug (T27-B).

## 4. Сводка таблицей (NEW в этом круге)

| # | Приоритет | Зона | Находка | Где |
| --------- | --------- | | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **T33-A** | 🟠 P2 | DB / Migrations | **Ни одна миграция не использует `CREATE INDEX CONCURRENTLY`**. 8/8 миграций с `CREATE INDEX` — AccessExclusiveLock на больших таблицах. | `packages/database/prisma/migrations/*/migration.sql` (все) |
| **T33-B** | 🟡 P3 | DB / Migrations | Migrations без явных `BEGIN/COMMIT` блоков. Manual `psql -f` apply не-transactional. | Все миграции |
| **T33-C** | 🟡 P3 | DB / mc086 | `mc086` DELETE без LIMIT + UNIQUE INDEX без CONCURRENTLY — long locks на больших таблицах. | `packages/database/prisma/migrations/20260914_mc086_preference_unique/migration.sql` |
| **T33-D** | 🟡 P3 | DB / Rollback | Migrations не имеют rollback SQL файлов (только комментарии в `mc087`/`mc089`). | Все миграции |

## 5. Куммулятивный итог (33 кругов)

| Iter   | Round   | Topic                     | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21     | #21     | Worker job lifecycle      | T21-A..D     | 0     | 0     | 2     | 2     |
| 22     | #22     | Web dialog a11y           | T22-A..C     | 0     | 0     | 1     | 2     |
| 23     | #23     | TS validation             | T23-A..C     | 0     | 0     | 1     | 2     |
| 24     | #24     | nginx security headers    | T24-A..D     | 0     | 0     | 3     | 1     |
| 25     | #25     | Test coverage gaps        | T25-A..D     | 0     | 0     | 1     | 3     |
| 26     | #26     | Worker PII/observability  | T26-A..C     | 0     | 0     | 0     | 3     |
| 27     | #27     | Infra/deploy pipeline     | T27-A..D     | 0     | 0     | 1     | 3     |
| 28     | #28     | CI/CD coverage            | T28-A..D     | 0     | 0     | 1     | 3     |
| 29     | #29     | Multi-tab cache           | T29-A..C     | 0     | 0     | 1     | 2     |
| 30     | #30     | WCAG / a11y               | T30-A..D     | 0     | 0     | 0     | 4     |
| 31     | #31     | API Zod validation        | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene            | T32-A..D     | 0     | 0     | 2     | 2     |
| **33** | **#33** | **DB / migration safety** | **T33-A..D** | **0** | **0** | **1** | **3** |

Cumulative after 33: P0=12, P1=2, P2=19, P3=38.

**Тренд 33-го:** migrations / DB safety. После API validation (31), cookie hygiene (32) — фокус на DB migrations. T33-A главный — `CONCURRENTLY` отсутствует везде, что создаёт lock risk для production growth.

## 6. Рекомендации (33-й круг)

1. **(P2, 4ч, T33-A)** Создать `scripts/migration-with-concurrent.ts` — обёртка для `prisma migrate deploy`, которая:
   - Парсит каждую миграцию на наличие `CONCURRENTLY`.
   - Если есть — запускает вне transaction.
   - Если нет — стандартный apply.
     Задокументировать в `docs/runbooks/migrations.md`.
2. **(P3, 1ч, T33-B)** Задокументировать: «migrations apply only via prisma migrate deploy; manual psql discouraged». В `CONTRIBUTING.md`.
3. **(P3, 30 мин, T33-C)** В будущих dedup-migrations: batched DELETE с LIMIT, CONCURRENTLY UNIQUE INDEX.
4. **(P3, 4ч, T33-D)** Опционально создать `packages/database/prisma/rollback/mcXXX_down.sql` для критичных миграций (mc086, mc087, mc088, mc089).

## 7. Артефакты (33-й круг)

| Артефакт                     | Где                             |
| ---------------------------- | ------------------------------- |
| Этот отчёт                   | `docs/audit/AUDIT-REPORT-33.md` |
| FIX-PLAN (T33-A,B,C,D)       | `docs/audit/FIX-PLAN.md`        |
| No CREATE INDEX CONCURRENTLY | §1 T33-A                        |
| Migrations no BEGIN/COMMIT   | §1 T33-B                        |
| mc086 DELETE without LIMIT   | §1 T33-C                        |
| No rollback SQL files        | §1 T33-D                        |
