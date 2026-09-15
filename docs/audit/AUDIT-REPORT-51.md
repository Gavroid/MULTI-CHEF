# Технический, продуктовый и UI-аудит MULTI-CHEF (51-й круг)

**Дата:** 2026-09-15
**HEAD:** `193d0ea chore(audit): AUDIT-REPORT-50 date-time-finale`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-50.md`, `FIX-PLAN.md`
**Фокус:** Healthcheck endpoints — API readiness + worker liveness, queue depth, dependency breakdown.

## TL;DR

51-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T51-A** — **Worker process НЕ имеет healthcheck endpoint**. Только API `/health/live` + `/health/ready`. Если worker hangs → k8s не знает → pod не restart'ится.
- 🟠 **T51-B** — API `/health/ready` не проверяет **BullMQ queue depth**. Если queue растёт (worker не успевает) — silent backup. Нужна visibility.
- 🟡 **T51-C** — `pingDatabase()` = `SELECT 1` без latency metric. Healthcheck binary — не детектит "responding but slow".
- 🟡 **T51-D** — Healthcheck 503 generic. Не distinguish "DB pool exhausted" vs "DB unreachable" vs "Redis queue full".

---

## 1. Технические находки (51-й круг)

### T51-A. Worker process без healthcheck endpoint 🟠 P2

**Файл:** `apps/worker/src/main.ts`.

**Сырой код (worker entry):**

```ts
async function main(): Promise<void> {
  const worker = await startWorker();
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`worker: received ${signal}, draining…`);
    await worker.close();
    console.log('worker: bye');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  console.log('worker: planning queue consumer ready');
}
```

**Что упущено:**

- Worker — long-running process. Если процесс зависает (infinite loop, deadlock, GC pause 30s), **нет способа узнать снаружи**.
- k8s/docker healthcheck → если endpoint не отвечает → restart. Но нет endpoint → нет auto-restart.
- Operations проверяет `ps` + logs — **manual**.

**Смягчающий фактор:** BullMQ Worker может stalled-detect через `lastHeartbeat` (если включён), но это Redis-side.

**Рекомендованный фикс:**

Добавить minimal HTTP server в worker:

```ts
// apps/worker/src/health.ts
import http from 'node:http';

export function startHealthServer(port: number = 3002): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else if (req.url === '/health/ready') {
      // Worker is "ready" if it has BullMQ worker reference alive.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port);
  return server;
}
```

В `main.ts`:

```ts
const healthServer = startHealthServer(parseInt(process.env.WORKER_HEALTH_PORT ?? '3002'));
// graceful shutdown:
await healthServer.close();
```

### T51-B. API healthcheck без queue depth visibility 🟠 P2

**Файл:** `apps/api/src/health/health.controller.ts:67-83`.

**Что упущено:**

- `pingDatabase()` + Redis ping = "DB+Redis reachable".
- Но **не проверяется BullMQ queue depth** (сколько jobs ждут обработки).
- Если worker упал → queue растёт → API говорит "ready" → пользователи получают 200 + медленные jobs.

**Рекомендованный фикс:**

```ts
@Get('ready')
async readiness(): Promise<ReadyResponse> {
  await pingDatabase();
  await pingRedis();

  // Optional: check queue depth (don't fail readiness, just include in response)
  try {
    const queue = new Queue(QUEUE_NAME, { connection: { /* ... */ } });
    const waiting = await queue.getWaitingCount();
    const failed = await queue.getFailedCount();
    if (waiting > 1000) {
      // log warning but don't fail
      console.warn(`queue backlog: ${waiting} jobs waiting`);
    }
    await queue.close();
  } catch { /* swallow */ }

  return { status: 'ready' };
}
```

Or add separate endpoint:

```ts
@Get('queue')
async queueMetrics() {
  const waiting = await queue.getWaitingCount();
  const failed = await queue.getFailedCount();
  return { waiting, failed, healthy: waiting < 1000 && failed < 100 };
}
```

### T51-C. `pingDatabase()` без latency metric 🟡 P3

**Файл:** `packages/database/src/index.ts:75-79`.

**Сырой код:**

```ts
export async function pingDatabase(): Promise<void> {
  const client = getPrisma();
  await client.$queryRaw`SELECT 1`;
}
```

**Что упущено:**

- Healthcheck binary: ping succeeds → DB "ready", ping fails → DB "not ready".
- Не измеряется latency. Если DB отвечает за 5 sec — это НЕ OK, но healthcheck зелёный.
- Latency degradation — common prod symptom перед failure.

**Рекомендованный фикс:**

```ts
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const client = getPrisma();
  const start = Date.now();
  try {
    await client.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return { ok: true, latencyMs };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
```

В health controller:

```ts
const result = await pingDatabase();
if (!result.ok || result.latencyMs > 1000) {
  // not-ready
}
```

### T51-D. Generic 503 — no triage info 🟡 P3

**Файл:** `apps/api/src/health/health.controller.ts`.

**Что упущено:**

- 503 body: `{ status: 'not-ready', reason: 'db' | 'redis' }`.
- Не distinguish:
  - DB unreachable (network) vs DB pool exhausted (transient).
  - Redis unreachable (network) vs Redis queue full (transient).

**Рекомендованный фикс:**

```ts
type NotReadyReason =
  | 'db-unreachable'
  | 'db-pool-exhausted'
  | 'db-slow'
  | 'redis-unreachable'
  | 'redis-slow'
  | 'queue-backlog';

if (err.code === 'P2024' /* connection timeout */) {
  reason = 'db-pool-exhausted';
} else {
  reason = 'db-unreachable';
}
```

---

## 2. Подтверждённые здоровые паттерны

- **API `/health/live`** — process up check. ✓
- **API `/health/ready`** — DB + Redis ping. ✓
- **Healthcheck отключён в production Swagger** (Swagger не exposes /health). ✓
- **Не leak connection string в error** (`comment: «Do not leak the underlying Prisma error message — it can include the connection string»`). ✓
- **Worker SIGTERM handler** (graceful shutdown). ✓

## 3. Микро-наблюдения

- **T51-α** — `console.error(\`health/ready: postgres unreachable: ${message}\`)`— message может содержать DB credentials. T36-A covered SECRET_KEYS but`pingDatabase` not in redaction path. Potentially leak DB URL.
- **T51-β** — Redis URL из env schema (`REDIS_URL`) required, но **нет fallback** — если missing → throws at startup, не silent "not-ready".
- **T51-γ** — `/health/ready` does sequential DB + Redis ping. Total latency ~ 4 sec (2 sec timeout each). Healthcheck становится slow.
- **T51-δ** — No `/health/startup` endpoint (k8s convention for slow-startup pods). Worker might take 10s+ to connect to Redis at startup.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона            | Находка                                                                                      | Где                                              |
| --------- | --------- | --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **T51-A** | 🟠 P2     | Worker / Health | Worker process НЕ имеет healthcheck endpoint. k8s не знает что worker alive.                 | `apps/worker/src/main.ts`                        |
| **T51-B** | 🟠 P2     | API / Health    | API `/health/ready` не проверяет BullMQ queue depth. Worker stuck → silent backup.           | `apps/api/src/health/health.controller.ts:67-83` |
| **T51-C** | 🟡 P3     | API / Health    | `pingDatabase()` = `SELECT 1` без latency metric. Healthcheck binary — slow DB not detected. | `packages/database/src/index.ts:75-79`           |
| **T51-D** | 🟡 P3     | API / Health    | Generic 503. Не distinguish "DB unreachable" vs "pool exhausted" vs "Redis queue full".      | `apps/api/src/health/health.controller.ts`       |

## 5. Куммулятивный итог (51 кругов)

| Iter   | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–50  | #21–#50 | (предыдущие раунды) | —            | 0     | 0     | 33    | 74    |
| **51** | **#51** | **Healthchecks**    | **T51-A..D** | **0** | **0** | **2** | **2** |

## 6. Рекомендации (51-й круг)

1. **(P2, 2ч, T51-A)** Add minimal HTTP server в worker (`/health/live`, `/health/ready` на отдельном порту). Test k8s probe.
2. **(P2, 1ч, T51-B)** Добавить `/health/queue` endpoint с BullMQ counts. Wire в monitoring.
3. **(P3, 30 мин, T51-C)** `pingDatabase()` returns `{ ok, latencyMs }`. Healthcheck threshold 1000ms.
4. **(P3, 30 мин, T51-D)** Refine `NotReadyReason` enum: `db-unreachable`, `db-pool-exhausted`, `redis-unreachable`, `queue-backlog`.

## 7. Артефакты (51-й круг)

| Артефакт                  | Где                             |
| ------------------------- | ------------------------------- |
| Этот отчёт                | `docs/audit/AUDIT-REPORT-51.md` |
| FIX-PLAN (T51-A,B,C,D)    | `docs/audit/FIX-PLAN.md`        |
| No worker healthcheck     | §1 T51-A                        |
| No queue depth visibility | §1 T51-B                        |
| No latency metric         | §1 T51-C                        |
| Generic 503               | §1 T51-D                        |
