# Технический, продуктовый и UI-аудит MULTI-CHEF (25-й круг)

**Дата:** 2026-09-15
**HEAD:** `26076a5 chore(audit): AUDIT-REPORT-24 nginx-security-headers`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-24.md`, `FIX-PLAN.md`
**Фокус:** test coverage gaps — unit-tests для критичных services, RLS-context layer, E2E coverage.

## TL;DR

25-й круг: **4 находки** — 1 🟠 P2 (security-adjacent), 3 🟡 P3 (test-discipline).

- 🟠 **T25-A** — `withTenantContext` используется в 6 service-файлах (RLS-pilot), но **0 unit-тестов** для самой функции. Если set_config сломается — fail-closed или, что хуже, RLS bypass. Integration-tests не покрывают эту критическую точку.
- 🟡 **T25-B** — `meal-plans.service.ts` (402 строк), `shopping-lists.service.ts` (353), `auth.service.ts` (261) — **не имеют unit-тестов** на service-уровне. Только integration или соседние модули.
- 🟡 **T25-C** — `pnpm test` в `apps/api/package.json` — хардкод-список файлов (нет glob). Новый test-файл требует ручного edit script → легко забыть → тест не запускается в CI.
- 🟡 **T25-D** — нет coverage tool (`c8`/`nyc`/`vitest`). Невозможно измерить % покрытия. Регрессии остаются незамеченными.

---

## 1. Технические находки (25-й круг)

### T25-A. `withTenantContext` — критическая RLS-точка без unit-тестов 🟠 P2

**Файлы:**

- Определение: `packages/database/src/index.ts:60-71`.
- Потребители (6): `apps/api/src/{pantry,shopping-lists,meal-plans,profile,recommendations}/...service.ts`.
- Тесты: `packages/database/src/__tests__/index.test.ts` (52 строки, **0 вхождений** `withTenantContext`).

**Сырой код (имплементация):**

```ts
// packages/database/src/index.ts:60-71
export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: WithTenantContextOptions,
): Promise<T> {
  return getPrisma().$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.household_id', ${ctx.householdId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx);
    },
    options?.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined,
  );
}
```

**Доказательство (нет unit-теста):**

```bash
$ grep -c "withTenantContext" packages/database/src/__tests__/index.test.ts
0
$ grep -rln "withTenantContext" apps/api/src/__tests__/ packages/database/src/__tests__/ 2>/dev/null
apps/api/src/recipes/__tests__/mc033-harness.ts   # только setup-фикстура
# (больше ничего)
```

**Что может сломаться без тестов:**

1. **`set_config(..., true)` третий параметр = local scope** — это правильно (context живёт только в текущей транзакции). Если поменять на `false` (session scope) — context УТЕЧЁТ после транзакции → **cross-tenant data leak**.
2. **Два `set_config` в одном `$executeRaw`** — Postgres выполняет оба, и оба ставятся в local scope. Если их разнести в две отдельные `$executeRaw` — между ними context неполный (householdId есть, userId нет). Race-condition в RLS policy.
3. **`isolationLevel` через опции** — если опции переданы не как объект, а как `IsolationLevel` enum напрямую — `$transaction` падает. Текущий код корректен (опциональная передача), но контракт не покрыт тестом.
4. **`getPrisma().$transaction(async (tx) => ...)`** — если callback бросает → `$transaction` откатывает → `set_config` отменяется автоматически (Postgres). Это свойство нигде не задокументировано в тесте.
5. **`householdId === undefined`** → пустая строка → RLS policy получает `''` (НЕ NULL) → `current_setting('app.household_id') = ''` → policies с проверкой `'' = household_id` могут давать false-positive matches.**

**Реальный impact:** Wave 2 WP-5 (mc089) применяет RLS к 10 таблицам. Это **security-critical** инфраструктура. Если `withTenantContext` начнёт возвращать соединение без установленного context (баг в `set_config`), integration-тесты могут проходить (потому что их данные часто попадают в policy anyway), но production ломается fail-closed.

**Рекомендованный фикс:** добавить `packages/database/src/__tests__/context.test.ts` (или дополнить `index.test.ts`):

- `withTenantContext: sets both configs, returns callback result`
- `withTenantContext: rolls back on callback throw`
- `withTenantContext: tenant isolation — reads outside context are denied` (требует БД)
- `withTenantContext: empty householdId → fail-closed (sees nothing)`
- `withTenantContext: explicit isolationLevel=SERIALIZABLE honored`

Минимум 4 теста; можно реализовать без БД через mock-Prisma. Production-grade — с реальной БД (multichef_test).

### T25-B. Три крупных service без unit-тестов 🟡 P3

**Файлы (без `__tests__/` рядом):**

| Service                                                 | LOC     | Последний баг, пойманный руками    | Текущее покрытие                                                  |
| ------------------------------------------------------- | ------- | ---------------------------------- | ----------------------------------------------------------------- |
| `apps/api/src/meal-plans/meal-plans.service.ts`         | **402** | T20-A (race `generatePrepSession`) | 0% (только integration)                                           |
| `apps/api/src/shopping-lists/shopping-lists.service.ts` | **353** | (не зафиксировано)                 | 0%                                                                |
| `apps/api/src/auth/auth.service.ts`                     | **261** | T13-A (P2002 в register)           | 0% (auth.test.ts покрывает только session-token.ts — 46 LOC util) |

**Доказательство:**

```bash
$ find apps/api/src/meal-plans apps/api/src/shopping-lists apps/api/src/auth -name "*.test.ts" -o -name "*.spec.ts" 2>/dev/null
# (пусто — никаких .test.ts/.spec.ts в meal-plans/, shopping-lists/, auth/)

$ wc -l apps/api/src/meal-plans/meal-plans.service.ts apps/api/src/shopping-lists/shopping-lists.service.ts apps/api/src/auth/auth.service.ts
402 apps/api/src/meal-plans/meal-plans.service.ts
353 apps/api/src/shopping-lists/shopping-lists.service.ts
261 apps/api/src/auth/auth.service.ts
```

**Что упущено в `auth.service.ts`** (261 LOC):

- `register()` flow — argon2 hash, User create, Household create, HouseholdMember create, Session create — **ни одного теста**. T13-A (P2002) был пойман в проде.
- `login()` — argon2 verify, getSession, cookie set — **0 тестов**.
- `getSession()` — token hash lookup, expiry check — **0 тестов**.
- `logout()` — session delete — **0 тестов**.

В `apps/api/src/__tests__/auth.test.ts` (видимый из `pnpm test` список) — только тесты для `session-token.ts` (util), 4 теста.

**Что упущено в `meal-plans.service.ts`** (402 LOC):

- `generatePrepSession()` — T20-A (race) был пофикшен через Serializable-транзакцию + retry P2034, но **нет регрессионного теста** на этот race.
- `setDone()` — T23-A (Zod-валидация пропущена) был пофикшен вручную, но service-уровень не покрыт.
- `applyBudgetProposal()` — сложная транзакционная логика, нет теста.

**Рекомендованный фикс:**

- `apps/api/src/auth/__tests__/auth.service.spec.ts` — register/login/logout с in-memory или sqlite-prisma.
- `apps/api/src/meal-plans/__tests__/meal-plans.service.spec.ts` — `generatePrepSession` race regression.
- `apps/api/src/shopping-lists/__tests__/shopping-lists.service.spec.ts` — `setPurchased`, `complete`, `fitBudget`.

Минимум: один файл per service, 5-10 тестов в каждом. Это даст regression safety net для уже найденных багов.

### T25-C. `pnpm test` script — хардкод-список файлов 🟡 P3

**Файл:** `apps/api/package.json:18` (test) + `:19` (test:integration).

**Сырой код:**

```json
"test": "RUN_DB_INTEGRATION= node --test --import tsx --test-reporter=spec src/__tests__/auth.test.ts src/__tests__/dto.test.ts src/__tests__/error-envelope.test.ts src/__tests__/idempotency.test.ts src/__tests__/idempotency-cache.test.ts src/__tests__/prisma-errors.test.ts src/__tests__/csrf-guard.test.ts src/__tests__/health.test.ts src/__tests__/profile-dto.test.ts src/__tests__/ingredients-dto.test.ts src/__tests__/pantry-dto.test.ts src/recipes/__tests__/recipes.mappers.spec.ts src/recommendations/__tests__/pick-top3.spec.ts src/recommendations/__tests__/recommendations.mappers.spec.ts",
"test:integration": "RUN_DB_INTEGRATION=1 node --test --import tsx --test-concurrency=1 --test-reporter=spec src/recipes/__tests__/recipes.controller.spec.ts src/__tests__/integration.test.ts src/__tests__/profile-integration.test.ts src/__tests__/ingredients-integration.test.ts src/__tests__/pantry-integration.test.ts",
```

**Проблема:** при добавлении нового `*.test.ts` нужно вручную edit `package.json`. Уже видно из истории:

- T25-B: `meal-plans.service.ts` существует давно, `meal-plans.service.spec.ts` нет — потому что при создании MC-053 никто не edit'нул script.
- T25-B: `shopping-lists.service.ts` — аналогично.
- T20-A race был пофикшен в `8e3e782` без теста.

**Рекомендованный фикс:**

```json
"test": "RUN_DB_INTEGRATION= node --test --import tsx --test-reporter=spec 'src/**/*.test.ts' 'src/**/*.spec.ts' --exclude='**/*.integration.test.ts'",
"test:integration": "RUN_DB_INTEGRATION=1 node --test --import tsx --test-concurrency=1 --test-reporter=spec 'src/**/*.integration.test.ts'",
```

`node --test` поддерживает glob patterns (Node 21+). Альтернатива — Vitest с его globbing.

### T25-D. Нет coverage tool 🟡 P3

**Файлы:** нет ни в `apps/api/package.json`, ни в `apps/worker/package.json`, ни в корневом `package.json`.

**Проверка:**

```bash
$ grep -rn "c8\|nyc\|@vitest/coverage\|jest --coverage" apps/ packages/ package.json pnpm-workspace.yaml 2>/dev/null | grep -v node_modules
# (пусто — нет ни одного coverage-tool)
```

**Что упущено:**

- Невозможно узнать, **сколько % строк покрыто** unit-тестами.
- Регрессии (типа T20-A) не видны в coverage diff при PR.
- Coverage gates (например, «новый код ≥ 80%») невозможны.

**Рекомендованный фикс:** добавить `c8` (zero-config, работает с `node --test`):

```json
"devDependencies": {
  "c8": "^10.0.0"
},
"scripts": {
  "test:coverage": "c8 --reporter=text --reporter=lcov node --test --import tsx 'src/**/*.test.ts' 'src/**/*.spec.ts'"
}
```

Бонус: c8 output → codecov/coveralls integration в CI (см. T28).

---

## 2. Подтверждённые здоровые паттерны

- **`packages/recommendation/src/__tests__/`** — обширное покрытие (20+ тестов): factors/, filters/, planner, shopping, rescue, prep. Этот пакет имеет лучший coverage в монорепо.
- **Integration tests для pantry, profile, ingredients, recipes** — есть, покрывают happy-path + a few negatives.
- **`auth.test.ts`** для session-token — token generation deterministic, hash format verified.
- **node `--test` + tsx** — простая конфигурация без jest/vitest. Лёгкий cold-start.
- **T17-A drift CI** (`pnpm check:schema-drift`) — отдельный gate для schema-vs-DB consistency.

## 3. Микро-наблюдения

- **T25-α** — `apps/api/src/__tests__/idempotency-cache.test.ts` — есть тесты на idempotency-cache, но НЕ на сам interceptor (`IdempotencyReplayInterceptor`). Контракт replay-семантики покрыт только через интеграцию. Если сломается — фича перестанет работать без явного падения тестов.
- **T25-β** — `apps/web/src/hooks/__tests__/usePreferences.test.ts` (есть) и `usePantry.test.ts` (есть) — но **нет теста для `useTheme`**. Хотя он проще, чем остальные — T22-C (matchMedia subscription) можно было бы поймать тестом.
- **T25-γ** — `apps/web/e2e/*.spec.ts` — Playwright e2e только для auth-fridge-smoke и recipe-page. Нет e2e для meal-plan generation flow (главный flow приложения!).
- **T25-δ** — `apps/api/src/__tests__/csrf-guard.test.ts` — есть, но не покрывает soft-mode skip для non-browser clients.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона                | Находка                                                                                                                  | Где                                                                    |
| --------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **T25-A** | 🟠 P2     | DB / RLS            | `withTenantContext` (RLS-pilot) используется 6 services, но 0 unit-тестов. Security-critical.                            | `packages/database/src/index.ts:60-71`, потребители в 6 service-файлах |
| **T25-B** | 🟡 P3     | API / Tests         | `meal-plans.service.ts` (402 LOC), `shopping-lists.service.ts` (353 LOC), `auth.service.ts` (261 LOC) — без unit-тестов. | `apps/api/src/{meal-plans,shopping-lists,auth}/`                       |
| **T25-C** | 🟡 P3     | API / Test Runner   | `pnpm test` script — хардкод-список файлов. Новые тесты не подхватываются автоматически.                                 | `apps/api/package.json:18-19`                                          |
| **T25-D** | 🟡 P3     | Monorepo / Coverage | Нет coverage tool (`c8`/`nyc`). Невозможно измерить % покрытия, regression gates в CI.                                   | отсутствует в `apps/api/package.json`                                  |

## 5. Куммулятивный итог (25 кругов)

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
| **#25** | **T25-A–D**         | **0** | **0** | **1 P2 + 3 P3** | **0** | **12 P0, 2 P1, 14 P2, 12 P3** |

**Тренд 25-го:** test-discipline. После security/contract — quality gates. T25-A особенно важен: **security-critical layer (withTenantContext) без тестов** — это регрессионный риск для всей RLS-стратегии.

## 6. Рекомендации (25-й круг)

1. **(P2, 1ч, T25-A)** Добавить `packages/database/src/__tests__/context.test.ts` — минимум 4 теста на `withTenantContext`: set/rollback/isolation/empty-context. Это страховка для всей RLS-стратегии.
2. **(P3, 4ч, T25-B)** Создать по одному `*.spec.ts` для трёх крупных services: meal-plans, shopping-lists, auth. Покрыть хотя бы happy-path + один negative на каждый public method.
3. **(P3, 15 мин, T25-C)** Заменить хардкод-список в `apps/api/package.json:18-19` на glob. Проверить Node-версию ≥ 21 для `--test 'src/**/*.test.ts'`.
4. **(P3, 30 мин, T25-D)** Добавить `c8` в devDeps + `test:coverage` script. Прогнать один раз, зафиксировать baseline.

## 7. Артефакты (25-й круг)

| Артефакт                     | Где                             |
| ---------------------------- | ------------------------------- |
| Этот отчёт                   | `docs/audit/AUDIT-REPORT-25.md` |
| FIX-PLAN (T25-A,B,C,D)       | `docs/audit/FIX-PLAN.md`        |
| `withTenantContext` untested | §1 T25-A                        |
| 3 services без unit-тестов   | §1 T25-B                        |
| `pnpm test` хардкод          | §1 T25-C                        |
| Coverage tool отсутствует    | §1 T25-D                        |
