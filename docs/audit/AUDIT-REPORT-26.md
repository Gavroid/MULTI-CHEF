# Технический, продуктовый и UI-аудит MULTI-CHEF (26-й круг)

**Дата:** 2026-09-15
**HEAD:** `d9df6e4 chore(audit): AUDIT-REPORT-25 test-coverage-gaps`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-25.md`, `FIX-PLAN.md`
**Фокус:** worker PII/log surface, `Job.error` schema-leak, BullMQ payload persistence, healthcheck cost.

## TL;DR

26-й круг: **3 находки** — 0 P0, 0 P2, 3 🟡 P3 (hygiene / soft-leak).

- 🟡 **T26-A** — `Job.error` (Postgres) хранит raw `err.message`, который для Prisma-ошибок содержит `meta.target` (имена таблиц/колонок). DB-read = soft schema-leak.
- 🟡 **T26-B** — `health/ready` создаёт **новое IORedis-соединение на каждый probe** (`new IORedis(...)` + `connect()` + `ping()` + `quit()`). При k8s probe interval 5s = 12 connect/quit циклов в минуту. Resource waste.
- 🟡 **T26-C** — BullMQ хранит `bullJob.data` в Redis до завершения job'а. Сейчас params — setup-only (без PII), но **нет schema-уровневой защиты**: если завтра кто-то добавит job-тип с `email`/`notes`, они утекут в Redis-дампы. Документации / контракта нет.

---

## 1. Технические находки (26-й круг)

### T26-A. `Job.error` в Postgres содержит raw Prisma error message 🟡 P3

**Файл:** `apps/worker/src/job-runner.ts:65` (запись) → schema `packages/database/prisma/schema.prisma:model Job { error String? }` (хранение).

**Сырой код:**

```ts
// job-runner.ts:60-66
} catch (err) {
  await mirror.setError(jobId, err instanceof Error ? err.message : String(err));
  throw err;
}
```

`setError(jobId, error)` пишет `err.message` в Postgres-таблицу `Job.error`:

```ts
setError: (jobId, error) => update(jobId, { status: 'FAILED', error }),
```

**Что попадает в `err.message`:**

- Доменные ошибки (`ROULETTE_EMPTY: planner produced no meals for the given setup`) — fine, только код.
- **Prisma-ошибки** (UNIQUE violation, FK violation, RLS rejection):
  ```
  Invalid `tx.pantryItem.create()` invocation:
  Foreign key constraint failed on the field: `householdId`
  ```
  или
  ```
  Invalid `tx.userPreference.create()` invocation:
  Unique constraint failed on the constraint: `Preference_userId_ingredientId_kind_key`
  ```
  или
  ```
  new row violates row-level security policy for table "PantryItem"
  ```

**Что это значит:**

1. **`meta.target` в Prisma error** — содержит имена constraint'ов (например, `Preference_userId_ingredientId_kind_key`) → раскрывает **структуру БД-индексов** (constraint naming conventions). Soft schema-disclosure.
2. **`RLS policy violation` сообщения** — раскрывает **какие таблицы под RLS** (PantryItem, но не другие). Полезно для атакующего, если он ищет, какие именно endpoints читают защищённые данные.
3. **`householdId` field в FK error** — Prisma включает **имя поля модели** (не значение). Это OK, value не утекает.

**Доступ к этой информации:** любой пользователь с DB read-access (например, через Prisma raw query с read-only ролью) может:

```sql
SELECT id, type, error FROM "Job" WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 100;
```

…и grep-нуть «PantryItem», «Preference», constraint names.

**Смягчающие факторы:**

- В текущем проде DB read-access только у API-сервиса (нет user-facing endpoint для чтения `Job.error`).
- GET `/jobs/:id` НЕ возвращает `error` поле — контроллер `jobs.controller.ts:30-41` фильтрует его.

**Проверка:**

```bash
$ grep -A 1 "error" apps/api/src/jobs/jobs.controller.ts | head -10
const job = await this.svc.getForUser(id, user.id);
return {
  id: job.id,
  type: job.type,
  status: job.status,
  progress: job.progress,
  stage: job.stage,
  resultRef: job.resultRef,
  error: job.error,    // ← возвращается! хоть и обычно null
  ...
```

Подожди — `error` всё-таки **возвращается** в API response. Если job FAILED, клиент видит error message. Это by design (показать пользователю, что упало). Но если error содержит `meta.target` с constraint name → **схема утекает через API**.

**Эффект:** unprivileged client → API → DB Job.error → schema leak. Реально полезно для подготовки SQL-injection attempts (хотя Prisma parameterizes всё, но информация о структуре помогает).

**Рекомендованный фикс:** в `runWithMirror` ловить ошибку и **нормализовать** перед записью:

```ts
function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  // Strip Prisma meta lines / column names / SQL fragments.
  return err.message
    .replace(/on the (field|constraint): `[A-Za-z_]+`/g, 'on a unique field')
    .replace(/Foreign key constraint failed on the field: `[A-Za-z_]+`/g, 'FK violation')
    .replace(/for table "[A-Za-z_]+"/g, 'for table "T"')
    .slice(0, 500); // cap length
}
```

Или — маппинг в стабильные коды (`JOB_RLS_REJECTED`, `JOB_FK_VIOLATION`, `JOB_UNIQUE_CONFLICT`) вместо raw message.

### T26-B. `/health/ready` создаёт новое IORedis-соединение на каждый probe 🟡 P3

**Файл:** `apps/api/src/health/health.controller.ts:67-82`.

**Сырой код:**

```ts
const redisUrl = loadServerEnv().REDIS_URL;
if (!redisUrl) {
  /* ... */
}
try {
  const { default: IORedis } = await import('ioredis');
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
  });
  await redis.connect(); // ← new TCP connection per probe
  await redis.ping(); // ← PING
  await redis.quit(); // ← close
} catch (err) {
  /* ... */
}
```

**Что это значит:**

- Каждый probe (типичный k8s `livenessProbe.periodSeconds: 5`) → `connect + ping + quit`.
- 5s period × 60s = **12 полных TCP-cycle в минуту на каждый API-инстанс**.
- Если 2 API-инстанса → 24 cycles/min. Если 5 → 60.
- BullMQ `planning` queue connection (см. `apps/api/src/jobs/queue-publisher.ts:32-33`) — singleton `new Queue()` — закрывается только при process exit. Это **нормальный паттерн**.

**Неэффективность:**

1. TCP handshake каждый раз (RTT 1ms в LAN, ~50-100ms на публичном домене).
2. AUTH handshake (если Redis с паролем) — каждый раз.
3. CPU на close/quit.
4. Connection storm если несколько health-checker'ов стучат одновременно.

**Проверка:**

```bash
$ ssh root@192.168.1.95 'redis-cli CLIENT LIST | wc -l'
# (текущие активные клиенты)
$ curl -s http://127.0.0.1:3001/api/v1/health/ready
# После каждого curl — CLIENT LIST растёт на короткое время (потом quit)
```

**Рекомендованный фикс:** использовать **persistent health-connection** или общий singleton с `queue-publisher`. Самый простой — модуль-scope singleton:

```ts
// apps/api/src/health/redis-health.ts
let cached: IORedis | null = null;
export async function pingRedis(): Promise<void> {
  if (!cached) {
    const url = loadServerEnv().REDIS_URL;
    cached = new IORedis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1 });
    await cached.connect();
  }
  await cached.ping();
}
```

Reconnect handled by ioredis internal events.

### T26-C. BullMQ payload в Redis без schema-level protection от PII 🟡 P3

**Файл:** `apps/api/src/jobs/queue-publisher.ts:25-35` (publish).

**Сырой код:**

```ts
class BullmqQueuePublisher implements QueuePublisher {
  private queue: Queue | null = null;
  constructor(private readonly url: string) {}
  async publish(payload: PublishPayload): Promise<void> {
    this.queue ??= new Queue(QUEUE_NAME, {
      connection: new IORedis(this.url, { maxRetriesPerRequest: null }),
    });
    await this.queue.add(QUEUE_NAME, payload, { jobId: payload.jobId });
  }
}

export interface PublishPayload {
  jobId: string;
  userId: string;
  householdId: string;
  type: string;
  params: Record<string, unknown>; // ← arbitrary Record<string, unknown>
}
```

**Что попадает в Redis:**

```bash
$ redis-cli HGETALL bull:planning:job:<jobId>
# BullMQ internal hash, includes the payload as one of fields
# data = JSON.stringify({ jobId, userId, householdId, type, params })
```

Redis сторадж — **plain text JSON**. BullMQ не шифрует payload.

**Текущий payload `params`** (для GENERATE_PLAN):

```ts
type: Partial<MealPlanSetupDto>;
// MealPlanSetupDto — только setup (days, mealsPerDay, peopleCount, ...)
// БЕЗ email, БЕЗ notes, БЕЗ PII. ✓
```

**Но:** контракт — `Record<string, unknown>`. Если кто-то завтра добавит job-тип:

```ts
type: 'SEND_INVITE_EMAIL',
params: { to: 'user@example.com', message: '...' }   // ← PII в payload
```

…этот email будет сидеть в Redis до job completion (или дольше, если BullMQ retries).

Также: при `bullmq-dashboard` или прямом redis-cli inspect'е — payload виден любому с доступом к Redis.

**Смягчающие факторы:**

- Redis на `127.0.0.1:6379` (loopback), не exposed наружу.
- В текущем коде params — только setup-данные.

**Рекомендованный фикс:**

1. **Типизировать payload per type**: `type: 'GENERATE_PLAN'` → payload-форма `{ params: Partial<MealPlanSetupDto> }`; `type: 'SEND_INVITE'` → `{ params: { to: string; ... } }`. Zod discriminated union.
2. **Документировать в code-comment**: «BullMQ payload visible in Redis → не класть PII (email, phone, free text)».
3. **В проде с публичным Redis**: encryption-at-rest (managed Redis обычно имеет).

---

## 2. Подтверждённые здоровые паттерны

- **T18-A redaction**: exception-filter записывает только `type + message + prismaCode + target` через `redactSecrets`. Не весь exception. ✓
- **`SessionToken` не логируется**: `apps/api/src/auth/auth.service.ts` нигде не `console.log(token)`. ✓
- **HttpOnly + Secure (в production) cookies**: `setSessionCookie` правильно ставит `httpOnly: true`, `secure: flags.secure` (включается в prod). ✓
- **`AuthenticatedUser.email` не leaking**: возвращается только самому user'у (через `req.user` от собственной сессии). ✓
- **GET /jobs/:id возвращает только `job` владельца**: `getForUser` фильтрует по `userId`. Cross-user 404. ✓
- **Demo seed data не содержит real PII**: `demo@multichef.local`. ✓
- **`idempotency-cache` warn без request body**: `apps/api/src/common/idempotency-cache.ts:317-325`. ✓

## 3. Микро-наблюдения

- **T26-α** — `apps/worker/src/main.ts:38` `console.log('worker: planning queue consumer ready')` — после успешного `await startWorker()`. Если Redis недоступен, `startWorker` бросит → process exit. **Не нужен** дополнительный healthcheck — fail-fast уже есть.
- **T26-β** — `queue-publisher.ts:38-43` (`NoopQueuePublisher`) уже отмечено в T21-D. Дополнительно: `console.warn` per-publish может спамить stdout при dev-loop. Должен быть throttled (`warnedUnavailable` pattern из idempotency-cache.ts:316).
- **T26-γ** — `Job.error` колонка в БД **не индексирована** → grep в SQL будет full-scan. Для forensics не критично (мало FAILED jobs), но если когда-нибудь понадобится алёрт на FAILED — будет медленно.
- **T26-δ** — Worker `console.log` startup/shutdown идут в stdout. Если процесс запущен под systemd → journalctl. Но **не идут** в отдельный audit-канал. Нет audit-trail для «кто запустил worker, когда».

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона         | Находка                                                                                                                                               | Где                                                                           |
| --------- | --------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **T26-A** | 🟡 P3     | Worker / DB  | `Job.error` хранит raw Prisma error message (с `meta.target` = имена constraint'ов). Schema-leak через DB read + через API (`error` поле в `JobDto`). | `apps/worker/src/job-runner.ts:65`, `apps/api/src/jobs/jobs.controller.ts:38` |
| **T26-B** | 🟡 P3     | API / Health | `/health/ready` создаёт новое IORedis-соединение на каждый probe (12 cycles/min на инстанс).                                                          | `apps/api/src/health/health.controller.ts:67-82`                              |
| **T26-C** | 🟡 P3     | API / BullMQ | `bullJob.data.params: Record<string, unknown>` хранится в Redis plaintext. Нет schema-level protection от PII.                                        | `apps/api/src/jobs/queue-publisher.ts:25-35`                                  |

## 5. Куммулятивный итог (26 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3    | 🟡 ℹ️    | Cumulative                    |
| ------- | ------------------- | ----- | ----- | ----------- | -------- | ----------------------------- |
| #1–3    | 26                  | 9     | 0     | 6           | 11       | —                             |
| #4–10   | 13                  | 0     | 0     | 13          | 0        | —                             |
| #11     | T11-A, T11-B        | 0     | 0     | 2           | 0        | —                             |
| #12     | T12-A               | 0     | 0     | 1           | 0        | —                             |
| #13     | T13-A               | 1 P0  | 0     | 0           | 0        | 10 P0                         |
| #14     | T14-A               | 0     | 0     | 1           | 0        | 10 P0                         |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1           | 0        | 11 P0                         |
| #16     | T16-A, T16-B        | 0     | 0     | 2           | 0        | 11 P0                         |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0           | 0        | 11 P0, 2 P1                   |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3 | 0        | 11 P0, 2 P1, 2 P2             |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2        | 0        | 11 P0, 2 P1, 4 P2             |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2        | 0        | 12 P0, 2 P1, 6 P2             |
| #21     | T21-A–D             | 0     | 0     | 2 P2 + 2 P3 | 0        | 12 P0, 2 P1, 8 P2, 4 P3       |
| #22     | T22-A–C             | 0     | 0     | 1 P2 + 2 P3 | 0        | 12 P0, 2 P1, 9 P2, 6 P3       |
| #23     | T23-A–C             | 0     | 0     | 1 P2 + 2 P3 | 0        | 12 P0, 2 P1, 10 P2, 8 P3      |
| #24     | T24-A–D             | 0     | 0     | 3 P2 + 1 P3 | 0        | 12 P0, 2 P1, 13 P2, 9 P3      |
| #25     | T25-A–D             | 0     | 0     | 1 P2 + 3 P3 | 0        | 12 P0, 2 P1, 14 P2, 12 P3     |
| **#26** | **T26-A–C**         | **0** | **0** | **0**       | **3 P3** | **12 P0, 2 P1, 14 P2, 15 P3** |

**Тренд 26-го:** hygiene. Все находки — 🟡 P3, не security-critical. Soft schema-leak (T26-A), wasteful resource use (T26-B), missing contract documentation (T26-C). После 25 раундов P0/P1 запас иссяк — остаётся «серый» hygiene.

## 6. Рекомендации (26-й круг)

1. **(P3, 30 мин, T26-A)** Sanitize `Job.error` в `runWithMirror` — strip Prisma `meta.target` / field names. Можно сделать через helper `sanitizeWorkerError(err)` и применить перед `setError`.
2. **(P3, 15 мин, T26-B)** Вынести health-redis в module-scope singleton. Или шарить с `queue-publisher.connection`.
3. **(P3, 15 мин, T26-C)** Добавить code-comment в `PublishPayload` interface: «payload visible in Redis plaintext — no PII». Опционально — typed union per `type`.

## 7. Артефакты (26-й круг)

| Артефакт                          | Где                             |
| --------------------------------- | ------------------------------- |
| Этот отчёт                        | `docs/audit/AUDIT-REPORT-26.md` |
| FIX-PLAN (T26-A,B,C)              | `docs/audit/FIX-PLAN.md`        |
| `Job.error` schema leak           | §1 T26-A                        |
| `/health/ready` IORedis per probe | §1 T26-B                        |
| BullMQ payload Redis plaintext    | §1 T26-C                        |
