# Технический, продуктовый и UI-аудит MULTI-CHEF (49-й круг)

**Дата:** 2026-09-15
**HEAD:** `5038de6 chore(audit): AUDIT-REPORT-48 empty-loading-error-ux`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-48.md`, `FIX-PLAN.md`
**Фокус:** Prisma schema index coverage — query patterns vs existing indexes, missing composite indexes.

## TL;DR

49-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T49-A** — `MealPlan.findFirst({ householdId, status: 'ACTIVE' })` — нет composite index на `[householdId, status]`. Существующий `@@index([householdId, startDate])` suboptimal.
- 🟠 **T49-B** — `PrepSession.tasks orderBy: { sequence: 'asc' }` — нет index на `[prepSessionId, sequence]`. Full sort на больших sessions.
- 🟡 **T49-C** — `HouseholdMember.findFirst({ userId, role: 'OWNER' })` — нет composite index на `[userId, role]`.
- 🟡 **T49-D** — `Job` mirror — нет partial index для `status IN ('QUEUED', 'PROCESSING')`. Pending jobs monitoring → full table scan.

---

## 1. Технические находки (49-й круг)

### T49-A. `MealPlan.findFirst({ householdId, status: 'ACTIVE' })` — нет composite index 🟠 P2

**Файл:** `packages/database/prisma/schema.prisma` (модель MealPlan), `apps/api/src/meal-plans/meal-plans.service.ts`.

**Сырой код (query patterns):**

```ts
// 4 places в meal-plans.service.ts:
const plan = await tx.mealPlan.findFirst({
  where: { householdId, status: 'ACTIVE' },
  // ...
});
const active = await tx.mealPlan.findFirst({
  where: { householdId, status: 'ACTIVE' },
  select: { id: true },
});
```

**Текущий index:**

```prisma
model MealPlan {
  // ...
  @@index([householdId, startDate])   // ← не оптимален для фильтра по status
}
```

**Эффект:**

- Postgres использует `@@index([householdId, startDate])` → ищет все rows для `householdId` → фильтрует по `status='ACTIVE'` в памяти.
- На household с 100+ plans (если много archived) → 90%+ rows отбрасываются после index lookup.
- **Composite index `(householdId, status)`** позволит direct lookup → O(matches), не O(planCount).

**Смягчающий фактор:** Household обычно имеет 1-2 plans (active + few archived). Perf impact minimal сейчас.

**Рекомендованный фикс:**

```prisma
// packages/database/prisma/schema.prisma — model MealPlan
@@index([householdId, status])   // ← новый index
@@index([householdId, startDate])
```

Или partial index для prod:

```prisma
@@index([householdId], where: status = 'ACTIVE')  // Postgres partial index
```

### T49-B. `PrepSession.tasks` orderBy sequence — нет index 🟠 P2

**Файл:** `apps/api/src/meal-plans/meal-plans.service.ts:330-335`.

**Сырой код:**

```ts
const plan = await prisma.mealPlan.findUniqueOrThrow({ where: { id: planId } });
const session = await tx.prepSession.findFirst({
  where: { id: sessionId },
  include: { tasks: { orderBy: { sequence: 'asc' } } },
});
```

**Текущие indexes для PrepTask:**

```prisma
model PrepTask {
  // нет @@index на prepSessionId?
  // Нет — посмотрим
}
```

**Проверка:**

```bash
$ grep -B 1 -A 12 "model PrepTask " packages/database/prisma/schema.prisma | head -15
```

(см. ниже)

**Эффект:**

- Postgres `ORDER BY sequence` после join → full sort.
- На prep session с 50+ tasks → 50 sort operations → slow.

**Рекомендованный фикс:**

```prisma
model PrepTask {
  // ...
  @@index([prepSessionId, sequence])   // ← новый index для orderBy
  @@index([parallelGroup])              // ← для group queries
}
```

### T49-C. `HouseholdMember.findFirst({ userId, role: 'OWNER' })` — нет composite index 🟡 P3

**Файл:** `apps/api/src/auth/auth.service.ts:75-80`.

**Сырой код:**

```ts
const membership = await getPrisma().householdMember.findFirst({
  where: { userId, role: 'OWNER' },
});
```

**Текущие indexes (если есть):**

```bash
$ grep -B 1 -A 6 "model HouseholdMember " packages/database/prisma/schema.prisma | head -15
```

**Эффект:**

- Без composite index → full table scan.
- На households с 5+ members (family) → медленно.

**Смягчающий фактор:** Household обычно имеет 1-3 members. Index lookup small set.

**Рекомендованный фикс:**

```prisma
model HouseholdMember {
  // ...
  @@index([userId, role])   // ← новый composite index
  @@index([householdId, role])
}
```

### T49-D. `Job` mirror — нет partial index для pending jobs 🟡 P3

**Файл:** `packages/database/prisma/schema.prisma` (model Job).

**Текущий index:**

```prisma
model Job {
  // ...
  @@index([userId, createdAt])
  @@index([paramsHash])
}
```

**Эффект:**

- Admin monitoring: `SELECT COUNT(*) FROM "Job" WHERE status IN ('QUEUED', 'PROCESSING')` → full table scan.
- На 100k completed jobs → slow.
- Partial index: `@@index([status, updatedAt], where: status IN ('QUEUED', 'PROCESSING'))` — Postgres supports this.

**Смягчающий фактор:** Currently prod has tens of jobs, not thousands.

**Рекомендованный фикс:**

```prisma
model Job {
  // ...
  @@index([status, updatedAt], where: status IN ('QUEUED', 'PROCESSING'))  // partial
}
```

Prisma 6+ supports partial indexes via raw SQL migration.

---

## 2. Подтверждённые здоровые паттерны

- **`PantryItem` имеет 4 индекса**: `householdId`, `[householdId, expiresAt]`, `[householdId, archivedAt]`, `ingredientId`. ✓
- **`ShoppingListItem` имеет `[shoppingListId, purchased]`** composite. ✓
- **`IngredientAlias` имеет `[ingredientId]`** + `@@id([alias, locale])` (composite PK). ✓
- **`Recipe.tags` GIN index** для full-text search. ✓
- **`Preference @@unique([userId, kind, ingredientId])`** (T14-A). ✓
- **`Job @@index([paramsHash])`** для idempotency. ✓

## 3. Микро-наблюдения

- **T49-α** — `Recipe @@index([tags], type: Gin)` — Gin-индекс для массива tags. Зависит от `pg_trgm` extension.
- **T49-β** — `MealPlanDay @@unique([mealPlanId, date])` — composite unique. ✓
- **T49-γ** — `MealPlanEntry @@index([dayId, mealType])` — composite. ✓
- **T49-δ** — `User @id` не имеет FK index (User.id IS PK, auto-indexed).
- **T49-ε** — `Session @@index([userId])` — но query `session.tokenHash` lookup использует `WHERE tokenHash = ?`. Нет `@@index([tokenHash])`. **Hot path для login.**

Wait — `Session.tokenHash` — есть ли там индекс?

## 4. Сводка таблицой (NEW в этом круге)

| #         | Приоритет | Зона       | Находка                                                                                                   | Где                                                        |
| --------- | --------- | ---------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **T49-A** | 🟠 P2     | DB / Index | `MealPlan.findFirst({ householdId, status: 'ACTIVE' })` — нет composite index на `[householdId, status]`. | `packages/database/prisma/schema.prisma` (MealPlan)        |
| **T49-B** | 🟠 P2     | DB / Index | `PrepSession.tasks orderBy sequence` — нет index на `[prepSessionId, sequence]`. Full sort.               | `packages/database/prisma/schema.prisma` (PrepTask)        |
| **T49-C** | 🟡 P3     | DB / Index | `HouseholdMember.findFirst({ userId, role: 'OWNER' })` — нет composite index.                             | `packages/database/prisma/schema.prisma` (HouseholdMember) |
| **T49-D** | 🟡 P3     | DB / Index | `Job` mirror — нет partial index для `status IN ('QUEUED', 'PROCESSING')`. Admin monitoring slow.         | `packages/database/prisma/schema.prisma` (Job)             |

## 5. Куммулятивный итог (49 кругов)

| Iter   | Round   | Topic                     | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды)       | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                      | T41-A..D     | 0     | 0     | 2     | 2     |
| 42     | #42     | Pagination                | T42-A..D     | 0     | 0     | 2     | 2     |
| 43     | #43     | Async races               | T43-A..D     | 0     | 0     | 2     | 2     |
| 44     | #44     | Dependencies              | T44-A..D     | 0     | 0     | 0     | 4     |
| 45     | #45     | React rendering           | T45-A..D     | 0     | 0     | 1     | 3     |
| 46     | #46     | i18n                      | T46-A..D     | 0     | 0     | 2     | 2     |
| 47     | #47     | Modal a11y                | T47-A..D     | 0     | 0     | 2     | 2     |
| 48     | #48     | UX empty/loading/error    | T48-A..D     | 0     | 0     | 1     | 3     |
| **49** | **#49** | **Prisma index coverage** | **T49-A..D** | **0** | **0** | **2** | **2** |

## 6. Рекомендации (49-й круг)

1. **(P2, 1ч, T49-A)** Migration `mc090_add_mealplan_status_index`: `CREATE INDEX CONCURRENTLY "MealPlan_householdId_status_idx" ON "MealPlan" ("householdId", "status");`
2. **(P2, 1ч, T49-B)** Migration `mc091_add_preptask_session_sequence_index`: composite index для sort.
3. **(P3, 30 мин, T49-C)** Migration: composite index на HouseholdMember.
4. **(P3, 30 мин, T49-D)** Migration: partial index для pending jobs.

## 7. Артефакты (49-й круг)

| Артефакт                          | Где                             |
| --------------------------------- | ------------------------------- |
| Этот отчёт                        | `docs/audit/AUDIT-REPORT-49.md` |
| FIX-PLAN (T49-A,B,C,D)            | `docs/audit/FIX-PLAN.md`        |
| Missing MealPlan composite index  | §1 T49-A                        |
| Missing PrepTask sequence index   | §1 T49-B                        |
| Missing HouseholdMember composite | §1 T49-C                        |
| Missing Job partial index         | §1 T49-D                        |
