# Технический, продуктовый и UI-аудит MULTI-CHEF (68-й круг)

**Дата:** 2026-09-15
**Область:** Database connection pool tuning
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

`getPrisma()` в `packages/database/src/index.ts:26-34` создаёт
`PrismaPg` adapter с **только** `{connectionString}` — ни
`max`, ни `connectionTimeoutMillis`, ни `idle_in_transaction_session_timeout`,
ни `statement_timeout`. `DATABASE_POOL_MAX=10` объявлена в env
schema, но **нигде не читается**.

Это означает:

1. **Нельзя override pool size** через env (типичная потребность
   для прод-настройки).
2. **Нет protection от runaway транзакций** — воркер-планировщик
   может занять connection на минуты, не отпуская pool slot.
3. **Нет pool metrics** — оператор не видит, когда pool близок к
   исчерпанию.

Параллельно: `cached` singleton в `getPrisma()` разделяет client
между API и worker (если они в одном процессе — что типично для
dev, но не для prod).

---

## Технические находки (68-й круг)

### T68-A · 🟠 P2 — `DATABASE_POOL_MAX` объявлена, но не используется

**Где:** `packages/config/src/env.schema.ts:84`,
`packages/database/src/index.ts:28-30`.

**Симптом.**

```ts
// env.schema.ts:84
DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

// database/src/index.ts:28-30
const env = loadServerEnv();
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
cached = new PrismaClient({ adapter, log: ... });
```

`env.DATABASE_POOL_MAX` парсится и валидируется, но **не передаётся**
в `PrismaPg`. По умолчанию `pg` (на котором основан `PrismaPg`)
использует `max: 10` — что **совпадает** с дефолтом в env schema,
поэтому в dev/prod с дефолтами баг не виден. Но при
`DATABASE_POOL_MAX=20` в `.env` — pool остаётся 10.

**Почему важно.** На проде (3 пода API × 1 воркер × 10 соединений =
40 соединений к Postgres) часто нужно поднять pool до 25-30 на
инстанс для обработки пиков. Сейчас это невозможно без
перекомпиляции.

**Гипотеза фикса.**

```ts
// database/src/index.ts:28-30
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  // pg-pool options:
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
```

Заодно — расширить `PrismaPg` опции через кастомную обёртку.

---

### T68-B · 🟠 P2 — Нет таймаутов на connection / statement / transaction

**Где:** `packages/database/src/index.ts:28-30`.

**Симптом.** `new PrismaPg({ connectionString })` — единственный
аргумент. `pg` имеет важные таймауты:

- `connectionTimeoutMillis` (default 0 = wait forever)
- `idle_in_transaction_session_timeout` (default 0 = wait forever)
- `statement_timeout` (default 0 = no timeout)

В контексте проекта:

- **Воркер** `plan-week.ts` выполняет `tx.mealPlan.create` + 7 дней
  × ~5 entries × `recipe.findMany` — это десятки SQL-запросов.
  При медленной БД (replica lag, lock contention) транзакция
  может висеть минуты.
- **API** `withTenantContext` в hot path — каждый запрос берёт
  connection из pool. Если connection висит в idle-in-transaction,
  pool истощается за 10 запросов.

**Гипотеза фикса.**

```ts
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: 5_000, // acquire connection ≤ 5s
  idleTimeoutMillis: 30_000, // idle connection released
  // pg-specific:
  statement_timeout: 30_000, // any single query ≤ 30s
  idle_in_transaction_session_timeout: 60_000, // txn ≤ 60s
});
```

Это даёт «predictable backpressure»: API получает 503 через 5s
вместо зависания, воркер через 60s фейлит job с понятным
`statement_timeout` кодом (Postgres `57014`).

---

### T68-C · 🟡 P3 — `cached` PrismaClient singleton не тестируется отдельно

**Где:** `packages/database/src/index.ts:22-34`.

**Симптом.** `let cached: PrismaClient | undefined;` создаёт
**module-level singleton**. Любой импорт `getPrisma()` получает
тот же client. Тесты интеграции (видны 5+ файлов в
`apps/api/src/__tests__/*-integration.test.ts`) обходят этот
механизм и создают **отдельные** клиенты через `new PrismaClient
({ adapter: new PrismaPg(...) })`.

**Дыры:**

- В dev-режиме, если API и worker живут в одном процессе
  (turbo-orchestration), оба делят singleton — pool = 10
  на двоих, не 10+10.
- Тесты интеграции **не могут замокать** `getPrisma()` без
  monkey-patch. Каждый тест держит свой client, что не
  рефлексит prod.
- При hot-reload в Next.js dev singleton может устаревать —
  Prisma не любит, когда client'ы пересоздаются.

**Гипотеза фикса.** Заменить singleton на factory + DI:

```ts
// database/src/index.ts
let client: PrismaClient | undefined;
export function setPrisma(c: PrismaClient | undefined) {
  client = c;
}
export function getPrisma(): PrismaClient {
  if (!client) {
    const env = loadServerEnv();
    client = createPrismaClient(env);
  }
  return client;
}
```

Тесты вызывают `setPrisma(mockClient)` в `beforeEach` /
`afterEach`. Prod вызывает `getPrisma()` без mock'а.

---

### T68-D · 🟡 P3 — Нет pool metrics / observability

**Г где:** весь `packages/database/src`.

**Симптом.** Нет ни одного места, где логируется состояние pool
(`{totalCount, idleCount, waitingCount}`). Когда pool близок к
исчерпанию, API начинает тормозить, но в логах — тишина. При
инциденте оператор не может ответить «это pool exhausted или
просто DB медленная».

**Гипотеза фикса.** Экспортировать из `getPrisma()` функцию
`getPoolStats()`:

```ts
export function getPoolStats() {
  // через PrismaPg internal — есть $on('query') event, но нет pool events.
  // Альтернатива: pg pool предоставляет stats через `pool.totalCount` и пр.
  const pgPool = (cached as any)._engine.adapter.pool; // internal
  return {
    total: pgPool.totalCount,
    idle: pgPool.idleCount,
    waiting: pgPool.waitingCount,
  };
}
```

И хук в `/health/ready`:

```ts
const stats = getPoolStats();
if (stats.waiting > 0) {
  response.body.warning = 'pool has waiting acquirers';
}
```

Плюс периодический log (раз в 30 сек) в production.

---

## Подтверждённые здоровые паттерны

- `getPrisma()` — lazy initialization, дешёвый import-time (важно
  для тестов и CLI).
- `closePrisma()` — корректный shutdown hook, не оставляет zombie
  connections.
- `pingDatabase()` через `SELECT 1` — корректный cheap liveness
  probe (см. **T51-C** про latency).
- `cached = undefined` после `$disconnect` — нет утечки singleton'а
  между процессами тестов.
- `PrismaPg` adapter-based подход — официальный путь для
  Prisma 6.x, поддерживает prepared statements, COPY, и т.д.
- `loadServerEnv()` вызывается внутри `getPrisma()`, не на
  module-init — нет проблемы с circular imports в test-сетапе.

---

## Сводка таблицой (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                              | Файл / место                                 |
| ----- | --- | ---- | ------------------------------------------------------------------- | -------------------------------------------- |
| T68-A | 🟠  | P2   | `DATABASE_POOL_MAX=10` объявлена в env schema, но НЕ читается       | packages/config/src/env.schema.ts:84,        |
|       |     |      | в `new PrismaPg({...})`. Override через env невозможен              | packages/database/src/index.ts:28-30         |
| T68-B | 🟠  | P2   | Нет таймаутов `connectionTimeoutMillis` / `statement_timeout` /     | packages/database/src/index.ts:28-30         |
|       |     |      | `idle_in_transaction_session_timeout`. Runaway tx = pool starvation |                                              |
| T68-C | 🟡  | P3   | `cached` PrismaClient singleton не тестируется отдельно. Tests      | packages/database/src/index.ts:22-34,        |
|       |     |      | bypass'ят через `new PrismaClient({...})` — рассинхрон с prod       | apps/api/src/**tests**/*-integration.test.ts |
| T68-D | 🟡  | P3   | Нет pool metrics (`totalCount`, `idleCount`, `waitingCount`).       | packages/database/src (отсутствие)           |
|       |     |      | Pool exhaustion неотличим от slow DB в логах                        |                                              |

---

## Куммулятивный итог (68 кругов)

- **Всего найдено проблем:** 272 (T21–T68).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  152 · 🟡 P3: 94.
- **Раунды с нулевыми находками:** 0 из 68.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33), observability /
  healthchecks (28 — включая этот раунд), DB pool/indexes (8),
  error handling (4), bundle (4).

---

## Рекомендации (68-й круг)

1. **T68-A — на этой неделе.** Передать `max: env.DATABASE_POOL_MAX`
   в `PrismaPg`. 1 строка + миграция env (опционально).
2. **T68-B — на этой неделе.** Добавить
   `connectionTimeoutMillis: 5_000`,
   `idle_in_transaction_session_timeout: 60_000`,
   `statement_timeout: 30_000`.
3. **T68-C, T68-D — на спринт.** Factory + `setPrisma()` для
   тестов; `getPoolStats()` для healthcheck.

---

## Артефакты (68-й круг)

- `docs/audit/AUDIT-REPORT-68.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T68-A…T68-D.
