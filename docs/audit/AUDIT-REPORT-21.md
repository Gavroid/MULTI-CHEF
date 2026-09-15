# Технический, продуктовый и UI-аудит MULTI-CHEF (21-й круг)

**Дата:** 2026-09-15
**HEAD:** `17e5fd8 docs(audit): FIXES-1-12 — RLS wave-2 rollout evidence (10 tables)`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-20.md`, `FIXES-1-12.md`, `FIXES-13-20.md`
**Фокус:** apps/worker — BullMQ consumer lifecycle, retry/DLQ, observability.

## TL;DR

21-й круг: **4 находки** в worker-зоне — 0 P0, 2 🟠 P2 (контрактные), 2 🟡 P3 (hygiene/observability).

- 🟠 **T21-A** — `runWithMirror` оставляет `Job.status = PROCESSING` когда domain возвращает `void` (default-case `processor.ts`). Пользователь видит «готово на 100%, но PROCESSING» бесконечно. Тест на эту ветку отсутствует.
- 🟠 **T21-B** — BullMQ `Worker` создан без `attempts`/`backoff`. Транзиентный сбой (Redis hiccup, мимолётный DB-blip) → job уходит в failed навсегда, без DLQ-семантики.
- 🟡 **T21-C** — worker пишет только `console.log`/`console.warn`. Нет структурного логгера (pino/winston). При падении job stack-trace не попадает в stdout — только в `Job.error` в БД.
- 🟡 **T21-D** — `NoopQueuePublisher` при отсутствии `REDIS_URL` создаёт `Job` row в статусе `QUEUED` и молча выходит. Если прод запустят без `REDIS_URL`, очередь встанет и алёрта нигде нет.

---

## 1. Технические находки (21-й круг)

### T21-A. `runWithMirror` не закрывает `Job.status` на void-return пути 🟠 P2

**Файл:** `apps/worker/src/job-runner.ts:51-65` + `apps/worker/src/processor.ts:18-27`.

**Сырой код (`runWithMirror`):**

```ts
export async function runWithMirror(
  payload: RunnerPayload,
  domain: (report: (stage: Stage) => Promise<void>) => Promise<string | void>,
  mirror: JobMirror = createPrismaJobMirror(),
): Promise<void> {
  const { jobId } = payload;
  try {
    await mirror.setStatus(jobId, 'PROCESSING', 'filtering');
    const report = async (stage: Stage): Promise<void> => {
      await mirror.setStage(jobId, stage);
    };
    const resultRef = await domain(report);
    if (typeof resultRef === 'string') {
      await mirror.setResult(jobId, resultRef); // status=COMPLETED
    } else {
      await mirror.setStage(jobId, 'done'); // status остаётся PROCESSING
    }
  } catch (err) {
    await mirror.setError(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
```

**Сырой код (`processor.ts` default-case):**

```ts
switch (type) {
  case 'GENERATE_PLAN':
    return runPlanWeek(bullJob.data, report, new Date());
  default:
    // Unknown types complete immediately (mirror stays consistent).
    return undefined;
}
```

Контракт `runWithMirror` асимметричный: ветка `setResult` пишет `status=COMPLETED`, ветка `setStage('done')` — нет. Для зарегистрированного сейчас `GENERATE_PLAN` (`runPlanWeek` возвращает `plan.id: string`) баг не триггерится, но:

1. **Документированное намерение «mirror stays consistent» ложно** — статус остаётся PROCESSING при stage=done/progress=100. Это inconsistent state.
2. **Любой будущий job-тип** (например, RECOMPUTE_PREFERENCES, REBUILD_SHOPPING), который вернёт `void`, молча зависнет в PROCESSING. Клиент, опрашивающий `GET /api/v1/jobs/:id`, увидит `status: PROCESSING`, `stage: done`, `progress: 100` — и не сможет отличить «ещё работает» от «застряло».
3. **Тестовое покрытие** (`apps/worker/src/__tests__/stages.test.ts:42-66`) проверяет только string-return ветку. Void-return не покрыт ни позитивным, ни негативным кейсом → регрессия невидима.

**Проверка через grep:**

```bash
$ grep -n "setStage\|setResult\|setStatus" apps/worker/src/job-runner.ts
14:  setStatus(jobId: string, status, stage)
17:  setStage(jobId: string, stage: Stage)
20:  setResult(jobId: string, resultRef: string)
23:  setError(jobId: string, error: string)
35:    setStatus: (jobId, status, stage) => update(jobId, { status, stage, progress: progressFor(stage) }),
36:    setStage: (jobId, stage) => update(jobId, { stage, progress: progressFor(stage) }),
37:    setResult: (jobId, resultRef) =>
38:      update(jobId, { status: 'COMPLETED', stage: 'done', progress: 100, resultRef }),
```

**Эффект на проде (если добавится новый тип):**

```sql
-- псевдо-проверка состояния Job после void-return job
SELECT id, status, stage, progress FROM "Job" WHERE id = '01HFAKEFAKEFAKEFAKEFAKEFAKE';
-- status = PROCESSING (НЕ COMPLETED)
-- stage = done
-- progress = 100
-- Пользователь видит это через GET /api/v1/jobs/:id бесконечно.
```

**Рекомендованный фикс:** добавить в `JobMirror` метод `complete(jobId)` либо расширить `setStage` опциональным параметром `finalStatus: 'COMPLETED' | 'FAILED'`, и в void-ветке вызывать `complete(jobId)`. Покрыть тестом `runWithMirror: void return → status COMPLETED`.

### T21-B. BullMQ `Worker` без `attempts` и DLQ 🟠 P2

**Файл:** `apps/worker/src/main.ts:21-25`.

**Сырой код:**

```ts
export async function startWorker(): Promise<Worker<ProcessPayload>> {
  return new Worker<ProcessPayload>(QUEUE_NAME, processJob, {
    connection: createConnection(),
    concurrency: 2,
    // ← нет attempts, backoff, removeOnFail, drainDelay
  });
}
```

BullMQ `Worker` по умолчанию имеет `attempts: 0` (без retry). Любая ошибка в `processJob`:

1. Прогоняется через `runWithMirror` → `setError` → `Job.status = FAILED` (в Postgres mirror).
2. Re-throw → BullMQ помечает job failed в своей Redis-side очереди.
3. **Retry отсутствует.** Транзиентный сбой (Redis reconnect, кратковременный Postgres failover, RLS-context race) = permanent failure.

Дополнительно:

- **Нет DLQ.** BullMQ поддерживает `failedJobs` отдельным списком, но без явных `removeOnFail: false` они очищаются, и в Redis нет очереди «failed jobs to inspect».
- **Mirror-таблица Job не помечает retry-счётчик** — если бы `attempts: 3` стояло, БД-row всё равно бы прыгнул в FAILED сразу после первого re-throw. Несогласованность между BullMQ state и Postgres mirror.

**Проверка:**

```bash
$ grep -n "attempts\|backoff\|removeOnFail\|failedJobs" apps/worker/src/*.ts
# пусто — конфигурации retry/DLQ нет нигде в worker
```

**Рекомендованный фикс:**

- `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }` в `Worker`-options.
- В `runWithMirror` ловить domain-error и писать в `Job` mirror-таблицу `attempts` (новый столбец) перед re-throw.
- Опционально: создать DLQ через `QueueEvents` listener → класть failed jobs в отдельный Redis-stream для ручного разбора.

### T21-C. Worker без структурного логгера 🟡 P3

**Файл:** `apps/worker/src/main.ts`, `apps/worker/src/loop.ts`, `apps/api/src/jobs/queue-publisher.ts`.

**Сырой код:**

```ts
// main.ts:31-33
const shutdown = async (signal: string): Promise<void> => {
  console.log(`worker: received ${signal}, draining…`);
  await worker.close();
  console.log('worker: bye');
  process.exit(0);
};

// loop.ts:35
console.log(`worker: received ${signal}, shutting down`);

// queue-publisher.ts:40
console.warn(`[jobs] REDIS_URL not configured — job ${payload.jobId} recorded but NOT queued`);
```

Проверка:

```bash
$ grep -rn "console\.\|logger\|pino\|winston" apps/worker/src/ apps/api/src/jobs/ | grep -v __tests__ | grep -v "\.d\.ts"
apps/worker/src/loop.ts:35:    console.log(`worker: received ${signal}, shutting down`);
apps/worker/src/loop.ts:49:    console.log('worker ready');
apps/worker/src/main.ts:31:    console.log(`worker: received ${signal}, draining…`);
apps/worker/src/main.ts:33:    console.log('worker: bye');
apps/worker/src/main.ts:38:    console.log('worker: planning queue consumer ready');
apps/api/src/jobs/queue-publisher.ts:40:    console.warn(`[jobs] REDIS_URL not configured — job ${payload.jobId} recorded but NOT queued`);
```

Падение job → `Job.error` пишется в Postgres, но **stack trace и structured fields (jobId, type, attempt, durationMs)** теряются. В stdout попадают только shutdown/startup сообщения. Operations не сможет:

- Грепнуть «все упавшие GENERATE_PLAN за последний час».
- Отфильтровать по `householdId` (PII или нет — пока неясно, но auditability нужна).
- Построить алёрт на «>5 failures за 10 мин» — нет machine-readable метрики.

**Рекомендованный фикс:** подключить `pino` (если уже в зависимостях — стоит проверить). Минимум — `logger.info({ jobId, type, stage, durationMs }, 'job.completed')` и `logger.error({ err, jobId, type }, 'job.failed')`. Бонус: добавить correlation-id (`X-Request-Id` от API в payload) → логи можно корелировать с api access-log.

### T21-D. `NoopQueuePublisher` молчит при отсутствии `REDIS_URL` 🟡 P3

**Файл:** `apps/api/src/jobs/queue-publisher.ts:38-43`.

**Сырой код:**

```ts
class NoopQueuePublisher implements QueuePublisher {
  async publish(payload: PublishPayload): Promise<void> {
    console.warn(`[jobs] REDIS_URL not configured — job ${payload.jobId} recorded but NOT queued`);
  }
}
```

В API-процессе `createQueuePublisher()` выбирает `NoopQueuePublisher` если `process.env['REDIS_URL']` пуст. Сценарии:

1. **Dev/test без Redis** — ожидаемое поведение. Warn в порядке.
2. **Production с опечаткой в env** (`REDIS_URI`, `REDISHOST`) — каждый `POST /meal-plans/generate` создаёт `Job` row в `QUEUED` и логирует warn. Worker не подхватит. Пользователь видит 200 OK и «job в очереди», но ничего не происходит. Через 5 мин idempotency-window протухает, новый POST = новый row. БД пухнет, пользователь ничего не получает.

В текущем `apps/api/.env` (если он на проде) `REDIS_URL` есть, но **в `multichef.env` (см. /etc/multichef) нет fallback-проверки**. Healthcheck `/health/ready` упоминает Redis, но не проверяет, что API-process действительно публикует в очередь (только connection к Redis проверяется).

**Рекомендованный фикс:**

- В `apps/api/src/health/health.controller.ts` readiness-проверке делать фактический `queue.count()` (дёшево) или dry-run publish.
- В `main.ts` worker-процесса сделать `assert(process.env['REDIS_URL'], ...)` с `process.exit(1)` — fail-fast.
- Опционально: `NoopQueuePublisher` → `throw new Error('REDIS_URL required')` вместо warn, чтобы прод-fail стал громким.

---

## 2. Подтверждённые здоровые паттерны

- **`runWithMirror` error-handling**: доменная ошибка → `setError` → `throw` → BullMQ retry-handler (когда появится). Контракт корректен для случая когда retry сконфигурирован (T21-B).
- **`withTenantContext` в `runPlanWeek`**: ADR-0023 phase 3 применён: PantryItem/Preference/NutritionProfile читаются через явный tenant-context, RLS не ломается при FORCE.
- **`mealPlanEntry.id = ${plan.id}-d${e.dayIndex}-${e.mealType}`** — детерминированные PK предотвращают duplicate-key при ретрае транзакции (если он появится). T20-C закрыт корректно.
- **`STAGES` константа + `progressFor`** — единый источник правды для UI-progress-bar (100 → done).

## 3. Микро-наблюдения

- **T21-α** — `plan-week.ts:52-60` `GROUP_KEYWORDS` дублирует логику `apps/api/src/recipes/recipes.mappers.ts`. TODO в коде это признаёт, но без даты/трекера. Hygiene: перенести в `@multichef/contracts` или отдельный `@multichef/category-classifier`.
- **T21-β** — `processor.ts:18` default-case комментарий «Unknown types complete immediately (mirror stays consistent)» — ложный комментарий (см. T21-A). Когда найдут баг, удалить/исправить.
- **T21-γ** — `main.ts:14` — `new IORedis(url, { maxRetriesPerRequest: null })`. Это правильное значение для BullMQ, но без `enableReadyCheck: false` может флапать на старте. Стоит задокументировать, почему именно эти опции.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона                | Находка                                                                                                               | Где                                                          |
| --------- | --------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **T21-A** | 🟠 P2     | Worker / Job mirror | `runWithMirror` не выставляет `status=COMPLETED` на void-return пути (default-case `processor.ts`). Тест отсутствует. | `apps/worker/src/job-runner.ts:51-65` + `processor.ts:18-27` |
| **T21-B** | 🟠 P2     | Worker / BullMQ     | `Worker` без `attempts`/`backoff`/`DLQ`. Транзиентные сбои = permanent.                                               | `apps/worker/src/main.ts:21-25`                              |
| **T21-C** | 🟡 P3     | Worker / Logging    | Только `console.log/warn`. Нет structured logger, stack-trace падений не попадает в stdout.                           | `apps/worker/src/main.ts`, `loop.ts`, `queue-publisher.ts`   |
| **T21-D** | 🟡 P3     | API / Health        | `NoopQueuePublisher` при пустом `REDIS_URL` молчит warn-ом → прод может работать без очереди без алёрта.              | `apps/api/src/jobs/queue-publisher.ts:38-43`                 |

## 5. Куммулятивный итог (21 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3        | 🟡 ℹ️ | Cumulative                  |
| ------- | ------------------- | ----- | ----- | --------------- | ----- | --------------------------- |
| #1–3    | 26                  | 9     | 0     | 6               | 11    | —                           |
| #4–10   | 13                  | 0     | 0     | 13              | 0     | —                           |
| #11     | T11-A, T11-B        | 0     | 0     | 2               | 0     | —                           |
| #12     | T12-A               | 0     | 0     | 1               | 0     | —                           |
| #13     | T13-A               | 1 P0  | 0     | 0               | 0     | 10 P0                       |
| #14     | T14-A               | 0     | 0     | 1               | 0     | 10 P0                       |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1               | 0     | 11 P0                       |
| #16     | T16-A, T16-B        | 0     | 0     | 2               | 0     | 11 P0                       |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0               | 0     | 11 P0, 2 P1                 |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 11 P0, 2 P1, 2 P2           |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2            | 0     | 11 P0, 2 P1, 4 P2           |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2            | 0     | 12 P0, 2 P1, 6 P2           |
| **#21** | **T21-A–D**         | **0** | **0** | **2 P2 + 2 P3** | **0** | **12 P0, 2 P1, 8 P2, 4 P3** |

**Тренд 21-го:** фокус сместился на **infrastructure-качество worker'а** (BullMQ lifecycle, observability, config-safety). Все находки — non-P0 contract/hygiene; продовая функциональность (`GENERATE_PLAN` end-to-end) корректна благодаря тому, что `runPlanWeek` возвращает строку. Фиксы T21-A и T21-B желательно объединить (одна тема: «worker job lifecycle»).

## 6. Рекомендации (21-й круг)

1. **(P2, 30 мин, T21-A)** Расширить `JobMirror` методом `complete(jobId)` либо в `setStage(jobId, stage, { final?: 'COMPLETED' })`. Покрыть тестом «void return → status COMPLETED, stage done».
2. **(P2, 1ч, T21-B)** Добавить `attempts: 3` + `backoff: { type: 'exponential', delay: 5000 }` в `Worker`-options. Опционально: новая колонка `Job.attempts` для mirror-таблицы.
3. **(P3, 2ч, T21-C)** Подключить `pino` в worker (проверить, есть ли уже в монорепо) — `logger.info({ jobId, type, durationMs }, 'job.completed')`, `logger.error({ err, ... }, 'job.failed')`.
4. **(P3, 30 мин, T21-D)** В worker `main.ts`: `assert(process.env['REDIS_URL'])` с `process.exit(1)`. В API `NoopQueuePublisher`: заменить warn на throw при `NODE_ENV === 'production'`.
5. **(P3 hygiene)** Удалить/исправить ложный комментарий в `processor.ts:18`.

## 7. Артефакты (21-й круг)

| Артефакт              | Где                              |
| --------------------- | -------------------------------- |
| Этот отчёт            | `docs/audit/AUDIT-REPORT-21.md`  |
| FIX-PLAN              | `docs/audit/FIX-PLAN.md` (новый) |
| `runWithMirror` ветка | §1 T21-A                         |
| `Worker`-options      | §1 T21-B                         |
| `console.*` инвентарь | §1 T21-C                         |
| `NoopQueuePublisher`  | §1 T21-D                         |
