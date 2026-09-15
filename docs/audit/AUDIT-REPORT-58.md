# Технический, продуктовый и UI-аудит MULTI-CHEF (58-й круг)

**Дата:** 2026-09-15
**Область:** Concurrent meal-plan generation safety
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

Генерация недельного плана — самая тяжёлая операция в системе
(7 дней × 3-5 приёмов × 300+ рецептов × pantry/preferences/profile).
Воркер пишет `MealPlan` через `withTenantContext` без явного
`isolationLevel: 'Serializable'`. Между шагами `updateMany` (архив
старого ACTIVE) и `create` (новый ACTIVE) есть окно, в которое
другой воркер может вклиниться. Дедупликация в `JobsService.enqueue`
ловит только случай «две кнопки в течение 5 минут с одинаковыми
параметрами», но не покрывает race «два BullMQ job'а от разных
HTTP-запросов, обрабатываемые параллельно».

Дополнительно: `data.jobId` используется как PK нового `MealPlan` —
схема с этим работает, но при retry-стратегии BullMQ (один jobId,
несколько попыток) `create` может упасть на уникальном ключе.

---

## Технические находки (58-й круг)

### T58-A · 🟠 P2 — `updateMany + create` не атомарен между двумя воркерами

**Где:** `apps/worker/src/plan-week.ts:255-275`,
`apps/api/src/jobs/jobs.service.ts:62-90`.

**Симптом.** Пайплайн генерации плана:

```ts
await tx.mealPlan.updateMany({
  where: { householdId: data.householdId, status: 'ACTIVE' },
  data: { status: 'ARCHIVED' },
});
const plan = await tx.mealPlan.create({
  data: { id: data.jobId, householdId: data.householdId, ..., status: 'ACTIVE', … },
});
```

Изоляция — **default** Postgres (Read Committed). На уровне Read
Committed два параллельных worker'а могут одновременно прочитать
«нет ACTIVE-плана», оба `updateMany` обновят 0 строк, оба `create`
пройдут успешно → у одного household'а **два ACTIVE-плана**.

Сценарий:

1. Пользователь A1 нажал «Сгенерировать план» → POST /meal-plans →
   Job1 (BullMQ id `01HFAKE…`), Postgres `Job.id = 01HFAKE…`.
2. Через 100 мс нажал ещё раз (фронт не успел показать loading) →
   Job2 (BullMQ id `01HFAKE2…`). `JobsService.enqueue` ищет в
   Postgres Job `paramsHash` совпадение в окне 5 минут — но
   `paramsHash` у двух запросов может отличаться (`{now: …}` поле
   или случайный `requestId`).
3. Worker поднимает оба job'а с `concurrency: 2`
   (`apps/worker/src/main.ts:23`).
4. Оба входят в `withTenantContext(...)` для одного household'а →
   читают активный план параллельно → оба пишут новый.

**Почему важно.** UI `/plan` читает `findFirst({status: 'ACTIVE'})`
без `orderBy` — детерминированно показывается **один** из двух
планов; второй висит как ACTIVE, в `ShoppingList` создаётся
привязка к нему, юзер видит два разных списка покупок для одного
household'а. Дальнейшая генерация архивирует оба, что хуже —
теряются обе версии.

**Гипотеза фикса.**

1. Перевести `withTenantContext(...)` блок в `plan-week.ts` на
   `{ isolationLevel: 'Serializable' }` — аналогично
   `meal-plans.service.ts:163` (где это уже сделано для PrepSession).
2. На конфликте `P2034` — retry с backoff (как в PrepSession).
3. Либо перед `create` сделать `tx.mealPlan.findFirst({status:'ACTIVE'})`
   и при наличии — вернуть существующий план без `create`.

---

### T58-B · 🟠 P2 — `data.jobId` используется как PK `MealPlan`

**Где:** `apps/worker/src/plan-week.ts:265`,
`apps/api/src/meal-plans/meal-plans.service.ts:31`.

**Симптом.**

```ts
const plan = await tx.mealPlan.create({
  data: {
    id: data.jobId,            // ← BullMQ jobId как PK
    householdId: data.householdId,
    ...
  },
});
```

И в `MealPlansService.create` (контроллер):

```ts
return this.jobs.enqueue(
  userId,
  householdId,
  'GENERATE_PLAN',
  setup as unknown as Record<string, unknown>,
);
```

`JobsService.enqueue` создаёт `Job.id = randomUUID()` (UUID v4, не
ULID — кросс-ссылка с **T56-C**), кладёт его в BullMQ payload
как `jobId`. Worker передаёт `data.jobId` напрямую как PK плана.

Проблема: при retry (если worker упал после archive, до create) —
тот же `jobId` попадает в `create` второй раз → `P2002 unique
constraint violation on MealPlan.id`. Сейчас это маскируется тем,
что BullMQ retry happens **до** archive+create, но если retry
happens **после** create (например, после первой записи Day row,
но падение до завершения всего графа) — вторая попытка упадёт
на PK collision. Worker не имеет явной retry-логики для этой
ошибки.

**Гипотеза фикса.**

- Добавить `tx.mealPlan.upsert({ where: { id: data.jobId }, create: …,
update: { … } })` вместо `create`. Альтернатива — отделить PK от
  jobId: создавать `MealPlan.id = ulid()`, сохранять `jobId` в
  отдельное поле `sourceJobId`.

---

### T58-C · 🟡 P3 — Дедупликация в `JobsService.enqueue` основана только на `paramsHash`

**Где:** `apps/api/src/jobs/jobs.service.ts:60-70`.

**Симптом.**

```ts
const existing = await this.db.job.findFirst({
  where: {
    userId,
    type,
    paramsHash: hash,
    status: { in: ['QUEUED', 'PROCESSING'] },
    createdAt: { gte: windowStart },
  },
  ...
});
if (existing) {
  return { jobId: existing.id, deduplicated: true };
}
```

Условия дедупа:

1. Один `userId`.
2. Один `type`.
3. Одинаковый `paramsHash`.
4. `status ∈ {QUEUED, PROCESSING}` (после COMPLETED дедуп не работает).
5. Окно 5 минут.

**Дыры:**

- (4) Если пользователь нажал «генерировать» → план создан → через
  30 секунд нажал ещё раз, первый job уже COMPLETED → создаётся
  второй job. Оба запускаются worker'ом → race (см. T58-A).
- (3) Если `params` отличаются одним полем (`excludedAllergens`
  передан пустым массивом vs не передан), `paramsHash` будет разным,
  дедупа не сработает.

**Гипотеза фикса.**

- Расширить окно дедупа до `status ∈ {QUEUED, PROCESSING, COMPLETED}`
  для plan-генерации, плюс укоротить окно до 60 секунд (план обычно
  занимает > 60 с).
- Добавить `idempotencyKey` из HTTP-заголовка
  `Idempotency-Key` в `paramsHash` — это индустриальный стандарт
  (Stripe-style).

---

### T58-D · 🟡 P3 — `concurrency: 2` без rate-limit на воркере

**Где:** `apps/worker/src/main.ts:23`.

**Симптом.**

```ts
return new Worker<ProcessPayload>(QUEUE_NAME, processJob, {
  connection: createConnection(),
  concurrency: 2,
});
```

Concurrency 2 — значит до 2 планов генерируются одновременно. Каждый
план — десятки SQL-запросов + planning heuristic ~1-3 сек на 7 дней.
При пиковом наплыве (все household'ы утром в 9:00) очередь
накапливается, BullMQ `maxStalledCount`/`lockDuration` (см. **T53-A**)
не настроены — jobs могут залипнуть.

**Почему важно.** Нет backpressure: API продолжает принимать
`POST /meal-plans` без ограничения, очередь растёт до предела
Redis maxmemory, всё встаёт.

**Гипотеза фикса.** Добавить в API rate-limit на
`POST /meal-plans` (1 план / household / 60 секунд) — отдельный
guard или reuse существующего `ThrottlerGuard` (см. `@nestjs/throttler`
в `package.json`).

---

## Подтверждённые здоровые паттерны

- `withTenantContext({householdId, userId}, …)` корректно выставляет
  RLS-контекст на весь блок — все INSERT/UPDATE проходят через
  tenant-политику.
- `paramsHash` через `stableStringify` корректно канонизирует ключи
  (sort by key) → дедупа не ломается от `{a:1,b:2}` vs `{b:2,a:1}`.
- `IDEMPOTENCY_WINDOW_MS = 5 * 60_000` экспортируется как named
  constant — тестируемо.
- `data.jobId` используется как «trace-id» плана (видно в логах) —
  плюс для observability.

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                   | Файл / место                                     |
| ----- | --- | ---- | -------------------------------------------------------- | ------------------------------------------------ |
| T58-A | 🟠  | P2   | `updateMany + create` под Read Committed → race между    | apps/worker/src/plan-week.ts:255-275,            |
|       |     |      | двумя worker'ами → 2 ACTIVE-плана у одного household'а   | jobs.service.ts:62-90                            |
| T58-B | 🟠  | P2   | `data.jobId` (BullMQ UUID) используется как PK MealPlan. | apps/worker/src/plan-week.ts:265,                |
|       |     |      | Retry после частичной записи → P2002 PK collision        | apps/api/src/meal-plans/meal-plans.service.ts:31 |
| T58-C | 🟡  | P3   | Дедуп enqueue покрывает только QUEUED+PROCESSING в       | apps/api/src/jobs/jobs.service.ts:60-70          |
|       |     |      | 5-мин окне. После COMPLETED race открыт                  |                                                  |
| T58-D | 🟡  | P3   | `concurrency: 2` без rate-limit на `POST /meal-plans`.   | apps/worker/src/main.ts:23                       |
|       |     |      | При пике очередь растёт, нет backpressure                |                                                  |

---

## Куммулятивный итог (58 кругов)

- **Всего найдено проблем:** 232 (T21–T58).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  132 · 🟡 P3: 74.
- **Раунды с нулевыми находками:** 0 из 58.
- **Топ-5 зон:** rate-limiting / DTO-валидация (29), observability /
  healthchecks (24), money / числовая арифметика (19), BullMQ / worker
  (18), RLS / tenant context (15).
- **Новые зоны в этом круге:** concurrency / race conditions.

---

## Рекомендации (58-й круг)

1. **T58-A — на этой неделе.** Перевести `plan-week.ts:255` блок на
   `Serializable`, добавить retry на `P2034` (по образцу PrepSession).
2. **T58-B — на этой неделе.** `mealPlan.upsert` вместо `create`,
   либо отделить PK от jobId.
3. **T58-C, T58-D — на спринт.** Расширить дедуп-окно для планов
   до `COMPLETED`, добавить HTTP-rate-limit на `POST /meal-plans`.

---

## Артефакты (58-й круг)

- `docs/audit/AUDIT-REPORT-58.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T58-A…T58-D.
