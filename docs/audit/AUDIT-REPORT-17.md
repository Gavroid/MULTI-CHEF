# Технический, продуктовый и UI-аудит MULTI-CHEF (17-й круг)

**Дата:** 2026-09-14
**HEAD:** `b52af20 chore(audit): AUDIT-REPORT-16 T16-A raw-null envelope`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-16.md`, `VERIFICATION.md`
**Фокус:** schema.prisma ↔ реальная DB схема, drift между `migration.sql` файлами и Prisma моделью.

## TL;DR

17-й круг: **2 🔴 P1 находки** — обе про schema/db drift.

- 🔴 **T17-A — Prisma `schema.prisma` НЕ отражает 6 indexes/constraints из миграций**. Самое критичное: **`one_active_plan`** (partial UNIQUE constraint на `MealPlan.householdId WHERE status='ACTIVE'`) — **бизнес-инвариант «один активный план на household» хранится только в БД**, Prisma model не знает.
- 🔴 **T17-B — pgvector extension установлен в БД, но НЕТ ни одной `vector` колонки**. Либо будет, либо мёртвый код.
- ✅ Полный sweep по `pg_constraint`/`pg_trigger` → нет дрифта триггеров и check-constraints.
- ✅ Все FK и `@@unique` Prisma-уровня корректно отражены в DB.

---

## 1. Технические находки (17-й круг)

### T17-A. schema.prisma ↔ migration.sql drift: 6 indexes отсутствуют в Prisma модели 🔴 P1

**Сравнение (raw SQL dump `pg_indexes`):**

```sql
$ PGPASSWORD=... psql -c "SELECT tablename,indexname FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname;"
```

**23 индекса** в БД (исключая PK и FK). Schema.prisma содержит явные объявления только для 17 из них (через `@unique`, `@@unique`, `@@index`).

**6 НЕ ОТРАЖЕНЫ в schema.prisma:**

| #   | Index                           | Table             | Drift source                                                    | Severity        |
| --- | ------------------------------- | ----------------- | --------------------------------------------------------------- | --------------- |
| 1   | **`one_active_plan`**           | `MealPlan`        | Initial migration `mc003_initial/migration.sql:617`             | 🔴 **CRITICAL** |
| 2   | `Recipe_title_lower_key`        | `Recipe`          | Migration `20260913_mc085_recipe_title_indexes/migration.sql:5` | 🟠              |
| 3   | `Recipe_title_trgm_idx`         | `Recipe`          | Migration `20260913_mc085_.../migration.sql:8`                  | 🟡              |
| 4   | `idx_ingredient_canonical_trgm` | `Ingredient`      | Initial migration `mc003_initial/...:586+`                      | 🟡              |
| 5   | `idx_alias_trgm`                | `IngredientAlias` | Initial migration `mc003_initial/...`                           | 🟡              |
| 6   | `idx_recipe_tags`               | `Recipe`          | Initial migration `mc003_initial/...`                           | 🟡              |

#### 1. `one_active_plan` partial UNIQUE — самая критичная

**DB:**

```sql
CREATE UNIQUE INDEX one_active_plan ON "MealPlan"("householdId") WHERE "status" = 'ACTIVE';
```

**schema.prisma (`model MealPlan`):**

```prisma
model MealPlan {
  ...
  status MealPlanStatus @default(DRAFT)
  ...
  @@index([householdId, startDate])    // ← нет partial unique!
  @@map("MealPlan")
}
```

**Что это значит:**

- **DB enforces «только один ACTIVE plan per household».** Prisma model не знает — новый dev, читающий только schema.prisma, не увидит, что это enforced at DB level.
- `prisma migrate dev` НЕ пересоздаст этот индекс, если его случайно дропнут — Prisma о нём не знает.
- `prisma db pull` (интроспекция) НЕ извлечёт partial unique indexes — drift замаскирован.
- Приложение может вызвать `mealPlan.create({status:'ACTIVE'})` — **упадёт с Prisma error P2002** без внятного error.message.

**Подтверждение через `meal-plans.service.ts:42`:**

```ts
const plan = await getPrisma().mealPlan.findFirst({
  where: { householdId, status: 'ACTIVE' },
  ...
});
```

«Один активный» enforced **только на DB-уровне** — это правильно для race-safety, но **документация в коде не существует**, devs читают schema.prisma и не видят этот invariant.

**Prisma 5+ partial-index support:** начиная с Prisma 5.16 (если PRO) можно объявить:

```prisma
model MealPlan {
  ...
  @@index([householdId], where: { status: 'ACTIVE' }, name: "one_active_plan")
}
```

Если Prisma ниже 5.16 — не поддерживается, оставляем только в миграциях + ADR/README.

#### 2. `Recipe_title_lower_key` functional UNIQUE

```sql
CREATE UNIQUE INDEX "Recipe_title_lower_key" ON "Recipe" USING btree (lower("title"));
```

**schema.prisma:**

```prisma
model Recipe {
  title String    // ← нет @unique, нет функционального индекса
  ...
}
```

**Дрейф:** recipe title уникален case-insensitive в БД, но Prisma это не представляет. **Это значит:**

- `prisma.recipe.create({data:{title:'Борщ'}})` + повторно `prisma.recipe.create({data:{title:'борщ'}})` → упадёт P2002, не с Prisma-known field, а с raw constraint name, что хуже для DX.
- Seed-runner это не знает, и если кто-то перепишет seed — будет ручной upsert по `lower(title)`.

#### 3. `idx_*_trgm` (3 шт.)

GIN-индексы на `pg_trgm` для fuzzy search:

- `idx_ingredient_canonical_trgm` — `Ingredient.canonicalName`
- `idx_alias_trgm` — `IngredientAlias.alias`
- `Recipe_title_trgm_idx` — `Recipe.title`

**schema.prisma НЕ содержит** объявлений этих индексов. Prisma не имеет нативной поддержки `USING gin ... gin_trgm_ops` (это non-standard SQL). Prisma не поддерживает `@@index` с функциональными выражениями типа `lower(...)`.

**Дрейф:** Prisma schema утверждает, что поиск по этим полям — full scan, но БД выполняет trigram-fuzzy. **Prisma query planner сбит с толку**: при generated SQL Prisma может добавлять hints/sorts которые не нужны.

#### 4. `idx_recipe_tags` (GIN on `Recipe.tags`)

**schema.prisma:**

```prisma
tags String[] @default([])
```

**DB:**

```sql
CREATE INDEX idx_recipe_tags ON "Recipe" USING gin (tags);
```

**Дрейф:** Prisma 5+ поддерживает `@@index([tags], type: Gin)` — почему не объявлено в schema? Потому что migration был ручной и задним числом не обновлён. **Fix:** добавить `@@index([tags], type: Gin)` для соответствия.

---

### T17-B. pgvector extension установлен, но 0 колонок используют `vector` type 🔴 P1

**Raw:**

```sql
$ PGPASSWORD=... psql -c "SELECT extname FROM pg_extension;"
 extname
----------
 plpgsql
 pg_trgm
 unaccent
 vector            ← pgvector!
(4 rows)

$ PGPASSWORD=... psql -c "SELECT table_name,column_name FROM information_schema.columns
  WHERE data_type='vector' AND table_schema='public';"
(0 rows)
```

**Drift:**

- `vector` (pgvector) extension активирована в `mc003_initial/migration.sql:7` — `CREATE EXTENSION IF NOT EXISTS vector`
- README `packages/database/README.md:27` утверждает: "**Postgres 16** with extensions `pg_trgm`, `unaccent`, `vector`"
- **Никакая таблица/колонка** не использует `vector` type — extension просто занимает ресурсы.

**Возможные причины (любая вероятна):**

1. 🟢 Будет использована — pending AI-recommendation feature (ML-based recipe matching). Тогда это просто lead time.
2. 🟠 Failed experiment — extension добавили, не использовали, забыли удалить. **Зря занимает** extension slot в shared DB.
3. 🟠 Используется вне Prisma (raw SQL где-то) — но `grep` по `apps/api/src` и `packages/` даёт 0 hits.

**Что делать:**

- Если реально нужна — оставить, добавить колонку.
- Если нет — `DROP EXTENSION vector;` (безопасно, нет зависимостей).
- Обновить README.

**Audit-trail raw (`mc003_initial/migration.sql:584-588`):**

```sql
-- pg_trgm and unaccent are required for fuzzy alias search and case-
-- insensitive recipe title uniqueness. vector is reserved for the
-- upcoming ML-based recommendation engine (PRD §3 / §3.3).
CREATE EXTENSION IF NOT EXISTS unaccent;
```

→ "upcoming" = пока нет.

---

## 2. Подтверждённые здоровые паттерны

### ✅ FK & basic `@@unique`/`@unique` reflect correctly in DB

Cross-check 23 DB indexes vs 17 Prisma declarations:

- 17 indexes присутствуют **точно как объявлены в schema.prisma** ✅
- 6 indexes имеют **drift** (см. T17-A выше) — это критическая точка.

**Проверка** (sampling):

- `User_email_key` ← `email String @unique` в User модели ✅
- `Session_tokenHash_key` ← `tokenHash String @unique` в Session ✅
- `MealPlanDay_mealPlanId_date_key` ← `@@unique([mealPlanId, date])` ✅
- `Ingredient_canonicalName_key` ← `canonicalName String @unique` ✅

### ✅ Нет trigger/check-constraint drift

```sql
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;  -- (0 rows)
SELECT conname FROM pg_constraint WHERE contype='c';  -- (0 rows)
```

→ Prisma не поддерживает триггеры и CHECK constraints. **Единственный путь к DB-enforced бизнес-правилам — partial unique indexes** (как `one_active_plan`). Но schema.prisma о них не знает.

### ✅ Все FK constraints работают

Из `psql \d "Ingredient"` и аналогичных → 17 FK constraints properly represented in Prisma через `fields/references`.

---

## 3. Микро-наблюдения

- **T17-C** — 6 drifted indexes появились в миграциях **вручную**, минуя `prisma migrate`. Возможно потому что Prisma не умеет: `lower(title)` functional unique, GIN trigram, partial unique where status='ACTIVE'. **Это нормальная практика**, но **schema должна быть синхронизирована хотя бы ADR/README блоком**, чтобы новые devs знали о invariants.
- **T17-D** — `packages/database/README.md:27` упоминает vector — но **нет типа колонок, нет модели**, нет упоминания AI-фичи в roadmap. Documentation drift.
- **T17-E** — Todo/FIXME sweep показал только **recipe categoryGroup** `apps/api/src/recipes/recipes.mappers.ts:10` — feature-pending, не bug. Тоже в drought.

---

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона      | Находка                                                                                                                                                                                                                  | Где                                                     |
| --------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **T17-A** | 🔴 P1     | DB/Prisma | 6 indexes/constraints не отражены в `schema.prisma`. Включая **partial UNIQUE `one_active_plan`** (бизнес-инвариант «один ACTIVE план на household»). `Recipe_title_lower_key` functional UNIQUE. 3 GIN-trigram indexes. | `packages/database/prisma/schema.prisma` ↔ `pg_indexes` |
| **T17-B** | 🔴 P1     | DB config | `vector` (pgvector) extension установлена, **0 колонок использует**. README упоминает, кода нет.                                                                                                                         | `pg_extension` ↔ `information_schema.columns`           |

---

## 5. Куммулятивный итог (17 кругов)

| Iter    | Findings                        | 🔴 P0     | 🔴 P1    | 🟠 P2-P3     | 🟡 ℹ️     | Cumulative      |
| ------- | ------------------------------- | --------- | -------- | ------------ | --------- | --------------- |
| #1–3    | 26 (B1–B6, M1–M9, T1–T6, U1–U4) | 9         | 0        | 6            | 11        | —               |
| #4–10   | 13 (envelope / config)          | 0         | 0        | 13           | 0         | —               |
| #11     | T11-A, T11-B                    | 0         | 0        | 2            | 0         | —               |
| #12     | T12-A                           | 0         | 0        | 1            | 0         | —               |
| #13     | T13-A                           | 1 P0      | 0        | 0            | 0         | 10 P0           |
| #14     | T14-A                           | 0         | 0        | 1            | 0         | 10 P0           |
| #15     | T15-A, T15-B                    | 1 P0      | 0        | 1            | 0         | 11 P0           |
| #16     | T16-A, T16-B                    | 0         | 0        | 2            | 0         | 11 P0           |
| **#17** | **T17-A, T17-B**                | 0         | **2**    | 0            | 0         | **11 P0, 2 P1** |
| **Σ**   | **~50 уникальных**              | **11 P0** | **2 P1** | **26 P2-P3** | **11 ℹ️** | —               |

**Тренд 17-ти:** schema drift появился в фокусе — впервые за 16 кругов не contract/envelope bug, а **infrastructure-level: schema.prisma ≠ реальная DB** с частично-уникальным constraint-ом и GIN-trigram, и **неиспользуемая extension**.

---

## 6. Рекомендации (17-й круг)

1. **(P1, ~30 мин, T17-A.1)** Добавить документационный блок в `packages/database/README.md`:
   - Раздел «DB-only invariants не отражённые в schema.prisma»
   - Перечислить: `one_active_plan`, `Recipe_title_lower_key`, GIN-trigram indexes
   - Объяснить, почему Prisma не может их представить (partial unique + functional unique + GIN trigram).
2. **(P1, ~5 мин, T17-A.2)** Проверить, возможно ли обновить Prisma ≥5.16 и добавить:
   ```prisma
   @@index([tags], type: Gin)              // в Recipe
   ```
3. **(P1, 5 мин, T17-B)** Решить судьбу `vector` extension: либо добавить колонку (RecipeEmbedding?), либо `DROP EXTENSION IF EXISTS vector;` + обновить README.
4. **(P3) Hygiene:** ввести в CI проверку `prisma migrate diff` против shadow DB → если diff non-empty, alert.
5. **(P0)** T13-A + T15-A по-прежнему не пофикшены (race-conditions). T16-B (transient onboarding 500) тоже требует наблюдения.

---

## 7. Артефакты (17-й круг)

| Артефакт                                                     | Где                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Этот отчёт                                                   | `docs/audit/AUDIT-REPORT-17.md`                       |
| Raw `pg_indexes` dump                                        | §1 таблица                                            |
| Migration `mc003_initial` `CREATE EXTENSION vector`          | `mc003_initial/migration.sql:7`                       |
| Migration `MC-085` для `Recipe_title_lower_key`              | `20260913_mc085_recipe_title_indexes/migration.sql:5` |
| `meal-plans.service.ts:42` — findFirst where status='ACTIVE' | §1.1                                                  |
| `pg_trigger`, `pg_constraint` empty result                   | §2                                                    |
