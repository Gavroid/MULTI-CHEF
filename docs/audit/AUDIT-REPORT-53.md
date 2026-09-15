# Технический, продуктовый и UI-аудит MULTI-CHEF (53-й круг)

**Дата:** 2026-09-15
**HEAD:** `4e26214 chore(audit): AUDIT-REPORT-52 money-kopecks`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-52.md`, `FIX-PLAN.md`
**Фокус:** Background job restart / stuck job recovery — BullMQ Worker config, lockDuration, retry policy.

## TL;DR**

53-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T53-A** — BullMQ Worker options (`apps/worker/src/main.ts:21-25`) — missing `lockDuration`, `stalledInterval`, `lockRenewTime`. Default 30 sec lock too short for long-running `runPlanWeek`.
- 🟠 **T53-B** — BullMQ Queue options — missing `removeOnComplete`, `removeOnFail`, `defaultJobOptions.attempts`. Redis memory leak over time.
- 🟡 **T53-C** — Worker process freeze detection отсутствует (no `lastHeartbeat` tracking beyond BullMQ defaults).
- 🟡 **T53-D** — No admin endpoint для purge failed jobs. Manual `redis-cli` cleanup.

---

## 1. Технические находки (53-й круг)

### T53-A. BullMQ Worker — default lockDuration too short 🟠 P2

**Файл:** `apps/worker/src/main.ts:21-25`.

**Сырой код:**

```ts
return new Worker<ProcessPayload>(QUEUE_NAME, processJob, {
  connection: createConnection(),
  concurrency: 2,
  // missing: lockDuration, stalledInterval, maxStalledCount, lockRenewTime
});
```

**Что упущено:**

- `lockDuration` default = **30000 ms** (30 sec). If `runPlanWeek` takes >30 sec → lock expires → BullMQ thinks worker dead → re-runs job concurrently (duplicate execution).
- `stalledInterval` default = 30000 ms — checks for stalled every 30 sec.
- `maxStalledCount` default = 1 — after 1 stall, job marked failed.
- `lockRenewTime` — for long jobs, auto-renew lock every N sec.

**Эффект:**

- Meal-plan generation может занимать 10-60 sec (зависит от DB latency, RLS overhead, planner complexity).
- Если job takes 35 sec → lock expires at 30 → BullMQ re-runs → 2 concurrent runs.
- Concurrent runs могут double-write to DB (если transaction not idempotent) → duplicate plans.

**Смягчающий фактор:** T20-A fix: `runPlanWeek` использует Serializable transaction + retry P2034. Concurrent runs могут конфликтовать но не duplicate-write.

**Рекомендованный фикс:**

```ts
return new Worker<ProcessPayload>(QUEUE_NAME, processJob, {
  connection: createConnection(),
  concurrency: 2,
  lockDuration: 5 * 60_000, // 5 minutes
  stalledInterval: 60_000, // check every 60s
  maxStalledCount: 3, // allow 3 stalls before failing
  lockRenewTime: 30_000, // renew every 30s (for long jobs)
});
```

### T53-B. BullMQ Queue — missing retention/attempts defaults 🟠 P2

**Файл:** `apps/api/src/jobs/queue-publisher.ts:30-33`.

**Сырой код:**

```ts
this.queue ??= new Queue(QUEUE_NAME, {
  connection: new IORedis(this.url, { maxRetriesPerRequest: null }),
});
await this.queue.add(QUEUE_NAME, payload, { jobId: payload.jobId });
```

**Что упущено:**

- `removeOnComplete` default = `true` for last 1000 jobs. На prod через год: 1000+ completed jobs в Redis = OK. Но если больше — Redis memory grows.
- `removeOnFail` default = `true` for last 500 jobs. Failed jobs остаются.
- `defaultJobOptions.attempts` default = 1 (no retry). Если `runPlanWeek` fails с transient error → job failed permanently.
- `defaultJobOptions.backoff` — нет exponential backoff.

**Эффект:**

- Long-running prod → Redis memory leak (slow).
- Failed jobs без retry → user must re-trigger manually.

**Рекомендованный фикс:**

```ts
this.queue ??= new Queue(QUEUE_NAME, {
  connection: new IORedis(this.url, { maxRetriesPerRequest: null }),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 500 },
  },
});
```

### T53-C. Worker freeze detection — no heartbeat 🟡 P3

**Файл:** `apps/worker/src/main.ts`.

**Что упущено:**

- Если worker event loop freezes (sync CPU work, deadlock, infinite loop), BullMQ stalled detection может detect (если stalledInterval < freeze duration).
- Но если freeze < stalledInterval → silent.

**Смягчающий фактор:** T51-A добавляет `/health/live` endpoint → can detect frozen worker.

**Рекомендованный фикс:**

В health endpoint (после T51-A): `worker.lastHeartbeat = Date.now()`. Operations monitoring alerts if `now - lastHeartbeat > 30s`.

### T53-D. No admin endpoint для purge failed jobs 🟡 P3

**Файл:** отсутствует.

**Что упущено:**

- Failed jobs accumulate in Redis (с `removeOnFail: 7 days` — через неделю auto-cleanup).
- Admin не может вручную purge / inspect failed jobs через API.

**Рекомендованный фикс:**

```ts
@Get('jobs/failed')
async listFailedJobs(): Promise<FailedJobDto[]> {
  const failed = await this.queue.getJobs(['failed'], 0, 100);
  return failed.map(j => ({
    id: j.id,
    name: j.name,
    failedReason: j.failedReason,
    attemptsMade: j.attemptsMade,
    timestamp: j.timestamp,
  }));
}

@Post('jobs/clean-failed')
async cleanFailedJobs() {
  await this.queue.clean(0, 'failed');
}
```

---

## 2. Подтверждённые здоровые паттерны

- **`concurrency: 2`** явно задан (не default 1). ✓
- **`SIGTERM/SIGINT` graceful shutdown** в worker. ✓
- **`maxRetriesPerRequest: null`** для BullMQ connection (требуется per docs). ✓
- **`jobId: payload.jobId`** в `queue.add()` — explicit ID (позволяет idempotent retry). ✓
- **Idempotency-Key guard** в API (T15-A) — duplicate POST protection. ✓
- **Worker SIGTERM → worker.close()** before exit. ✓

## 3. Микро-наблюдения

- **T53-α** — `concurrency: 2` для BullMQ Worker — но Postgres pool max=10 (T35-A). 2 concurrent jobs × N seconds × RLS overhead → потенциально > 5 conns. OK на малом dataset.
- **T53-β** — `IORedis url` через `maxRetriesPerRequest: null` — per BullMQ docs required. ✓
- **T53-γ** — Нет `prefix` config — если Redis shared с другими apps → namespacing issue.
- **T53-δ** — Worker logs `worker: planning queue consumer ready` — startup log. Нет `lastHeartbeat` log (T53-C).

## 4. Сводка таблицой (NEW в этом круге)

| #         | Приоритет | Зона            | Находка                                                                                                          | Где                                          |
| --------- | --------- | --------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **T53-A** | 🟠 P2     | Worker / BullMQ | Worker missing `lockDuration`, `stalledInterval`, `maxStalledCount`. Default 30s lock — too short for long jobs. | `apps/worker/src/main.ts:21-25`              |
| **T53-B** | 🟠 P2     | API / BullMQ    | Queue missing `defaultJobOptions.attempts`, `removeOnComplete`, `removeOnFail`. No retry, Redis memory leak.     | `apps/api/src/jobs/queue-publisher.ts:30-33` |
| **T53-C** | 🟡 P3     | Worker / Ops    | No heartbeat tracking. Worker freeze < stalledInterval → silent.                                                 | `apps/worker/src/main.ts`                    |
| **T53-D** | 🟡 P3     | API / Admin     | No endpoint для list/purge failed jobs. Manual `redis-cli` cleanup.                                              | отсутствует                                  |

## 5. Куммулятивный итог (53 кругов)

| Iter   | Round   | Topic                    | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------ | ------------ | ----- | ----- | ----- | ----- |
| 21–52  | #21–#52 | (предыдущие раунды)      | —            | 0     | 0     | 37    | 78    |
| **53** | **#53** | **BullMQ worker config** | **T53-A..D** | **0** | **0** | **2** | **2** |

## 6. Рекомендации (53-й круг)

1. **(P2, 30 мин, T53-A)** Update Worker options: `lockDuration: 5*60_000`, `stalledInterval: 60_000`, `maxStalledCount: 3`.
2. **(P2, 30 мин, T53-B)** Update Queue options: `attempts: 3`, exponential backoff, retention policies.
3. **(P3, 1ч, T53-C)** Worker healthcheck (T51-A): include `lastHeartbeat`.
4. **(P3, 1ч, T53-D)** Admin endpoints: `GET /api/v1/admin/jobs/failed`, `POST /api/v1/admin/jobs/clean`.

## 7. Артефакты (53-й круг)

| Артефакт                    | Где                             |
| --------------------------- | ------------------------------- |
| Этот отчёт                  | `docs/audit/AUDIT-REPORT-53.md` |
| FIX-PLAN (T53-A,B,C,D)      | `docs/audit/FIX-PLAN.md`        |
| Worker default lockDuration | §1 T53-A                        |
| Queue missing defaults      | §1 T53-B                        |
| No worker heartbeat         | §1 T53-C                        |
| No admin jobs endpoints     | §1 T53-D                        |
