# Технический, продуктовый и UI-аудит MULTI-CHEF (59-й круг)

**Дата:** 2026-09-15
**Область:** Logging in worker / PII in job payload
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

Воркер использует `console.log` для всего жизненного цикла
(`main.ts:31,33,38`; `loop.ts:35,49`) — нет ни структурированного
логгера (pino/winston), ни trace-id, ни уровней. Это означает, что
при инциденте в проде невозможно отфильтровать события одного
job'а, нельзя отличить `filtering` от `scoring`, и Loki/Sentry
получают plain text без контекста.

Параллельно — `Job.error` колонка в Postgres записывается сырым
`err.message` (`job-runner.ts:64`), и эта же строка возвращается
через `GET /jobs/:id` пользователю. Для Prisma-ошибок это утечка
имён таблиц/колонок, в edge-кейсах — значений полей (например,
email при unique-violation на User.email).

Наконец, `params: Record<string, unknown>` целиком сериализуется в
BullMQ (Redis) — `MealPlanSetupDto` потенциально содержит
`noCookDays`, `budgetWeekKopecks`, `targetDailyCalories`, и это всё
в shared Redis без scrubbing.

---

## Технические находки (59-й круг)

### T59-A · 🟠 P2 — Воркер логирует только `console.log`

**Где:** `apps/worker/src/main.ts:31,33,38`,
`apps/worker/src/loop.ts:35,49`.

**Симптом.** Все события жизненного цикла — `console.log`/`console.warn`:

```ts
// main.ts:31
console.log(`worker: received ${signal}, draining…`);
// main.ts:33
console.log('worker: bye');
// main.ts:38
console.log('worker: planning queue consumer ready');
// queue-publisher.ts:45 (NoopQueuePublisher)
console.warn(`[jobs] REDIS_URL not configured — job ${payload.jobId} recorded but NOT queued`);
```

`plan-week.ts` **не имеет ни одного** `console.log`/`logger.*` —
никаких промежуточных логов между `report('filtering')` /
`report('scoring')` / `report('optimizing')` / `report('building-list')`.
При падении в одном из шагов оператор видит только финальный
`err.message` в `Job.error`.

**Почему важно.**

1. **Observability.** В проде на 10+ воркерах одновременно `console.log`
   уходит в stdout контейнера → перехватывается Vector/Fluentd.
   Но формат строк не стандартизирован: одна начинается с
   `"worker:"`, другая с `"[jobs]"`, третья — просто текст.
   Парсить руками или regex'ом — хрупко.
2. **Корреляция.** В payload BullMQ job'а есть `jobId`, но он
   **не** попадает в `console.log`. Нельзя сделать `grep $jobId` —
   придётся grep'ать по timestamp ± окно.
3. **Уровни.** `console.warn` vs `console.log` не различимы в
   Grafana/Loki без пост-обработки.

**Гипотеза фикса.**

1. Подключить `nestjs-pino` (уже есть в API через
   `LOG_FORMAT=pretty/json` env — см. `packages/config/src/env.schema.ts`).
2. Worker может использовать `pino` напрямую (без Nest), 1 файл
   `apps/worker/src/logger.ts` с `pino({ level: env.LOG_LEVEL,
formatters: ... })`.
3. Каждый log-event в `plan-week.ts` обогащать через
   `logger.child({ jobId, householdId, stage })`.

---

### T59-B · 🟠 P2 — Сырой `err.message` пишется в `Job.error` и возвращается клиенту

**Где:** `apps/worker/src/job-runner.ts:64`.

**Симптом.**

```ts
} catch (err) {
  await mirror.setError(jobId, err instanceof Error ? err.message : String(err));
  throw err;
}
```

`mirror.setError` (`job-runner.ts:31`):

```ts
setError: (jobId, error) => update(jobId, { status: 'FAILED', error }),
```

То есть полный текст ошибки сохраняется в Postgres `Job.error` и
**возвращается** через `GET /jobs/:id` (см. `apps/api/src/jobs/jobs.controller.ts`).

Для типовых ошибок:

- Prisma `P2002 unique constraint on User.email` → в `err.message`
  попадает имя колонки + значение email (Prisma 5+ по умолчанию
  включает значение в сообщение для unique violations, если
  включён `errorFormat: 'pretty'`).
- Prisma `P2003 foreign key constraint` → имя таблицы/колонки.
- Любое `throw new Error("user-friendly message")` — если в API
  кто-то бросит с PII (имя, email, телефон), это утечёт.

**Почему важно.** GDPR / 152-ФЗ: «информация об ошибках» не должна
содержать PII субъекта. Текущая реализация потенциально возвращает
email пользователя (или `householdId`, который сам по себе не PII,
но в комбинации с другими полями — quasi-identifier) обратно в
браузер.

**Гипотеза фикса.**

1. В `mirror.setError` сохранять в Postgres **хеш** ошибки + короткий
   `code` (например, `E_PLANNER_EMPTY`, `E_DB_CONFLICT`).
2. Полный текст ошибки — в отдельный **серверный** лог
   (pino-sink → Loki), не в Postgres Job.
3. Контракт `GET /jobs/:id` отдаёт `{ status, code, userMessage }`,
   а не raw error.

---

### T59-C · 🟡 P3 — BullMQ хранит полный `params` без scrubbing

**Где:** `apps/api/src/jobs/queue-publisher.ts:30`,
`apps/worker/src/processor.ts:6-11`.

**Симптом.**

```ts
// queue-publisher.ts:30
await this.queue.add(QUEUE_NAME, payload, { jobId: payload.jobId });
// payload.params = Record<string, unknown> — полный MealPlanSetupDto
```

`MealPlanSetupDto` (см. `packages/contracts/src/plan.ts` если есть)
содержит user-provided поля: `noCookDays`, `excludedAllergens`
(ingredient IDs), `targetBudgetKopecks`, `repeatPolicy`. Сейчас
этих полей немного, но контракт `Record<string, unknown>` разрешает
что угодно, а Zod-схема контроллера (см. `meal-plans.dto.ts`)
может расширяться без аудита BullMQ.

**Почему важно.** Redis — часто shared infra (AWS ElastiCache,
Upstash, managed Redis). Команда инфраструктуры может случайно
открыть Redis для read-only-инспекции (например, `redis-cli MONITOR`
в debug-сессии) и увидеть `params` целиком, включая draft-поля,
которые ещё не должны быть видны (например, `notes: "аллергия на
арахис у ребёнка"`).

**Гипотеза фикса.** В `JobsService.enqueue` или в `queue-publisher.ts`:

```ts
const SAFE_PARAMS_KEYS = ['days', 'peopleCount', 'noCookDays', 'budgetMode',
                          'targetBudgetKopecks', 'repeatPolicy', 'startDate',
                          'mealsPerDay', 'maxMinutes', 'targetDailyCalories'] as const;
const sanitized = Object.fromEntries(
  Object.entries(params).filter(([k]) => SAFE_PARAMS_KEYS.includes(k as never))
);
await this.publisher.publish({ ..., params: sanitized });
```

Плюс — структурированный `pino`-лог «job enqueued, sanitized» без
самих значений.

---

### T59-D · 🟡 P3 — Нет correlation-id между HTTP-запросом и BullMQ job'ом

**Где:** `apps/api/src/jobs/jobs.service.ts`,
`apps/worker/src/processor.ts`.

**Симптом.** HTTP-запрос `POST /meal-plans` создаёт `Job.id` и
публикует в BullMQ с этим же `jobId`. Worker получает `data.jobId`
и пишет в `Job.error`. Но:

1. HTTP-запрос имеет свой `request-id` (из Fastify adapter или
   установленный отдельно через `x-request-id` header).
2. `Job.id` (UUID v4) **не равен** HTTP `request-id` (обычно UUID v7
   или ULID).
3. Worker не логирует HTTP `request-id` (его и нет в payload'е).

В результате при разборе инцидента нельзя слинковать HTTP-запрос
→ enqueue → worker processing → result.

**Гипотеза фикса.** В `EnqueueResult` отдавать `requestId` (=
`Job.id` пока что), и:

1. На HTTP-уровне прокидывать `x-request-id` в BullMQ payload.
2. Worker использует `logger.child({ requestId })` для всех событий.
3. `mirror.setError` принимает `requestId` вторым аргументом,
   сохраняет в `Job.errorRequestId`.

---

## Подтверждённые здоровые паттерны

- `LOG_LEVEL` и `LOG_FORMAT` env-переменные (`packages/config`) —
  инфраструктура готова, нужно только подключить pino в worker.
- Argon2id с timing-safe login (`auth.service.ts:7-15` SECURITY
  POSTURE комментарий) — корректный подход к паролям.
- `hashSessionToken` хранит только SHA-256 хэш сессии в БД, raw
  token только в cookie — нет PII-утечки сессий.
- `console.warn` (не `console.error`) для `[jobs] REDIS_URL not
configured` — правильный уровень для recoverable-ситуации.
- `paramsHash` для fingerprint params в БД (sha256 hex) — не
  reversible, не PII.

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                            | Файл / место                                             |
| ----- | --- | ---- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| T59-A | 🟠  | P2   | Worker логирует только `console.log`. Нет structured logger,      | apps/worker/src/main.ts:31,33,38;                        |
|       |     |      | нет trace-id, нет уровней. `plan-week.ts` без промежуточных логов | apps/worker/src/loop.ts:35,49; plan-week.ts (отсутствие) |
| T59-B | 🟠  | P2   | `mirror.setError(jobId, err.message)` сохраняет сырой текст       | apps/worker/src/job-runner.ts:64,                        |
|       |     |      | ошибки в `Job.error` и возвращает клиенту. Утечка PII/стектрейса  | apps/api/src/jobs/jobs.controller.ts                     |
| T59-C | 🟡  | P3   | BullMQ хранит полный `params: Record<string, unknown>` без        | apps/api/src/jobs/queue-publisher.ts:30,                 |
|       |     |      | scrubbing в shared Redis                                          | apps/worker/src/processor.ts:6-11                        |
| T59-D | 🟡  | P3   | Нет correlation-id между HTTP request и BullMQ job.               | apps/api/src/jobs/jobs.service.ts,                       |
|       |     |      | Worker не видит x-request-id                                      | apps/worker/src/processor.ts                             |

---

## Куммулятивный итог (59 кругов)

- **Всего найдено проблем:** 236 (T21–T59).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  134 · 🟡 P3: 76.
- **Раунды с нулевыми находками:** 0 из 59.
- **Топ-5 зон:** rate-limiting / DTO-валидация (29), observability /
  healthchecks (26 — включает этот раунд), money / числовая арифметика
  (19), BullMQ / worker (20), RLS / tenant context (15).
- **Новые зоны в этом круге:** logging / observability в worker'е,
  PII handling.

---

## Рекомендации (59-й круг)

1. **T59-A — на этой неделе.** Подключить `pino` в worker, завести
   `logger.child({ jobId, householdId, stage })` в `runPlanWeek`.
2. **T59-B — на этой неделе.** `mirror.setError` сохраняет только
   `code`, raw error в pino с scrub'ом PII. Обновить контракт
   `GET /jobs/:id`.
3. **T59-C, T59-D — на спринт.** Whitelist params перед queue.add,
   прокидывать `x-request-id` через BullMQ payload.

---

## Артефакты (59-й круг)

- `docs/audit/AUDIT-REPORT-59.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T59-A…T59-D.
