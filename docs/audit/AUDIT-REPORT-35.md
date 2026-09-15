# Технический, продуктовый и UI-аудит MULTI-CHEF (35-й круг)

**Дата:** 2026-09-15
**HEAD:** `305887d chore(audit): AUDIT-REPORT-34 openapi-swagger`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-34.md`, `FIX-PLAN.md`
**Фокус:** Prisma client / pg driver — connection pool, SSL, application_name, pgbouncer compat.

## TL;DR

35-й круг: **4 находки** — 0 P0, 2 🟠 P2 (pool + SSL), 2 🟡 P3.

- 🟠 **T35-A** — `DATABASE_POOL_MAX` определён в `env.schema.ts` (default=10), но **НИКОГДА не читается** в `getPrisma()`. Мёртвая конфигурация. Оператор ставит `DATABASE_POOL_MAX=50` — эффекта нет.
- 🟠 **T35-B** — `PrismaPg` инициализируется **только с `connectionString`**. Никаких `max`, `idle_timeout`, `connection_timeout`, `ssl`, `application_name`. На больших нагрузках может быть `pool exhaustion` + connections не мониторятся через `pg_stat_activity`.
- 🟡 **T35-C** — Нет SSL/TLS для Postgres-соединения. В проде с публичным Postgres — данные в plain text.
- 🟡 **T35-D** — Нет `application_name` в connection string / pg options. В `pg_stat_activity` все приложения показываются как `unknown`. Operations не могут отличить API от worker от cron.

---

## 1. Технические находки (35-й круг)

### T35-A. `DATABASE_POOL_MAX` определён, но не используется 🟠 P2

**Файл:** `packages/config/src/env.schema.ts:84` (определение), `packages/database/src/index.ts:29-30` (использование).

**Сырой код (определение):**

```ts
// packages/config/src/env.schema.ts:82-85
DATABASE_URL: postgresUrlSchema,
DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

REDIS_URL: redisUrlSchema,
```

**Сырой код (использование — отсутствует):**

```ts
// packages/database/src/index.ts:28-31
const env = loadServerEnv();
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL }); // ← нет max
cached = new PrismaClient({
  adapter,
  log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});
```

**Проверка:**

```bash
$ grep -rn "DATABASE_POOL_MAX\|DB_POOL_MAX\|poolMax" packages apps/api apps/worker 2>/dev/null | grep -v dist
packages/config/src/env.schema.ts:84:  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
# (только определение; никакого использования)
```

**Эффект:**

1. **Dead config**: оператор может настроить `DATABASE_POOL_MAX=50` через `/etc/multichef/multichef.env`, но эффекта нет. При load testing → все равно pg default `max=10`.
2. **Operator confusion**: «почему пул всё равно 10, я же выставил 50?»
3. **No scaling for prod**: при росте трафика нельзя настроить pool через env.

**Смягчающий фактор:** `pg.Pool` default `max=10` совпадает с default в env. Так что в текущем использовании поведение корректное.

**Рекомендованный фикс:**

```ts
// packages/database/src/index.ts:28-31
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  // pg.Pool options:
  max: env.DATABASE_POOL_MAX,
  // ...другие pool options
});
```

Или через query string в `DATABASE_URL`: `postgresql://...?connection_limit=10` (Prisma native, игнорируется pg).

### T35-B. `PrismaPg` без опций пула / SSL / application_name 🟠 P2

**Файл:** `packages/database/src/index.ts:29` (использование).

**Сырой код:**

```ts
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
```

**Что упущено:**

`PrismaPg` принимает объект `{ connectionString, ...pgOptions }`, где `pgOptions` передаются в `pg.Pool`:

```ts
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  // pg.Pool config:
  max: env.DATABASE_POOL_MAX, // T35-A
  idle_timeout: 30_000, // закрывать idle conn через 30s
  connection_timeout: 5_000, // 5s timeout на connect
  ssl: env.DATABASE_SSL ? 'require' : false, // T35-C
  application_name: `multichef-${process.env.SERVICE_NAME ?? 'api'}`, // T35-D
});
```

**Эффект:**

1. **Pool exhaustion** — при spike нагрузки API+worker могут одновременно запросить 100+ connections (default `max=10`). Connection refused → 500 INTERNAL_ERROR.
2. **Idle connections** — pg держит все 10 connections открытыми даже если API idle. Postgres `max_connections=100` ограничивает суммарно все клиенты (API + worker + psql + monitoring).
3. **No `application_name`** — `SELECT * FROM pg_stat_activity` показывает `application_name = unknown`. Operations не может понять, какие соединения от API vs worker.

**Проверка:**

```bash
$ ssh root@192.168.1.95 'sudo -u postgres psql -c "SELECT count(*), application_name FROM pg_stat_activity GROUP BY application_name;"'
# (приложения не идентифицируются)
```

**Рекомендованный фикс:** добавить pool/SSL/application_name options в `getPrisma()`.

### T35-C. Нет TLS для Postgres connection 🟡 P3

**Файл:** `packages/database/src/index.ts:29` (нет `ssl: 'require'`).

**Эффект:**

- В production с публичным/удалённым Postgres — connection идёт через plain text. SQL queries (включая parameter values) видны любому MITM.
- Postgres credentials (`user:password@host`) видны при перехвате трафика.

**Смягчающий фактор:**

- Текущий prod — LAN deployment (Postgres на том же хосте). Loopback connections не маршрутизируются через сеть.
- Postgres может требовать SSL на server-side (`pg_hba.conf` `hostssl`), но client должен явно запрашивать.

**Рекомендованный фикс:**

```ts
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' ? 'require' : false,
});
```

Или env-driven `DATABASE_SSL` flag.

### T35-D. Нет `application_name` для Postgres connection 🟡 P3

**Файл:** `packages/database/src/index.ts:29`.

**Эффект:**

- В `pg_stat_activity.application_name` — `unknown` для всех connections от multichef.
- Operations не может отличить API от worker.

**Рекомендованный фикс:**

```ts
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  application_name: `multichef-${process.env.MULTICHEF_SERVICE ?? 'api'}`, // api / worker
});
```

Или через `DATABASE_URL` параметр: `postgresql://...?application_name=multichef-api`. ✓

---

## 2. Подтверждённые здоровые паттерны

- **Lazy initialization** `getPrisma()` — PrismaClient создаётся при первом вызове, не при импорте. ✓
- **Sentry-style singleton** — `let cached: PrismaClient | undefined` — process-wide reuse. ✓
- **`closePrisma()` helper** (`packages/database/src/index.ts:75`) — clean shutdown. ✓
- **`log` level controlled by env** (`LOG_LEVEL=debug` → query logs). ✓
- **`loadServerEnv()` из `@multichef/config`** — env всегда проходит через zod validation. ✓
- **No direct `process.env` access** в Prisma setup. ✓

## 3. Микро-наблюдения

- **T35-α** — pg driver `keepAlive: true` рекомендуется для long-lived connections в serverless. Hygiene.
- **T35-β** — `closePrisma()` не вызывается в graceful shutdown API (`apps/api/src/main.ts`). Health check `process.exit(0)` — connections не закрываются gracefully → Postgres может видеть `connection reset by peer`.
- **T35-γ** — Тесты (`packages/database/src/__tests__/*.integration.test.ts`) — каждый создаёт свой `PrismaClient` через `new PrismaPg({ connectionString })` без pool options. Это OK для test (short-lived), но DRY нарушен.
- **T35-δ** — `withTenantContext` (RLS) открывает `$transaction` на каждое использование. Это **exclusive connection** на время транзакции. На больших batch'ах — pool быстро исчерпывается. Hygiene: мониторинг active transactions.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона             | Находка                                                                                                                                 | Где                                                                            |
| --------- | --------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **T35-A** | 🟠 P2     | DB / Pool config | `DATABASE_POOL_MAX` определён в env, но **НИКОГДА не используется** в коде. Dead config.                                                | `packages/config/src/env.schema.ts:84`, `packages/database/src/index.ts:29-30` |
| **T35-B** | 🟠 P2     | DB / PrismaPg    | `PrismaPg` без `max`, `idle_timeout`, `connection_timeout`. Pool exhaustion risk. Application не идентифицируется в `pg_stat_activity`. | `packages/database/src/index.ts:29`                                            |
| **T35-C** | 🟡 P3     | DB / Security    | Нет SSL для Postgres connection. Production traffic plain text.                                                                         | `packages/database/src/index.ts:29` (нет `ssl: 'require'`)                     |
| **T35-D** | 🟡 P3     | DB / Operations  | Нет `application_name`. Operations не отличает API от worker в `pg_stat_activity`.                                                      | `packages/database/src/index.ts:29`                                            |

## 5. Куммулятивный итог (35 кругов)

| Iter   | Round   | Topic                    | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------ | ------------ | ----- | ----- | ----- | ----- |
| 21–30  | #21–#30 | (предыдущие раунды)      | —            | 0     | 0     | 5     | 25    |
| 31     | #31     | API Zod validation       | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene           | T32-A..D     | 0     | 0     | 2     | 2     |
| 33     | #33     | DB migration safety      | T33-A..D     | 0     | 0     | 1     | 3     |
| 34     | #34     | OpenAPI / Swagger        | T34-A..D     | 0     | 0     | 2     | 2     |
| **35** | **#35** | **Prisma / pool config** | **T35-A..D** | **0** | **0** | **2** | **2** |

Cumulative after 35: P0=12, P1=2, P2=24, P3=41.

**Тренд 35-го:** Database infrastructure. После API (31-34) — фокус на DB client. T35-A и B латентные — дефолты работают, но при росте нагрузки pool exhaustion станет проблемой.

## 6. Рекомендации (35-й круг)

1. **(P2, 1ч, T35-A + T35-B)** Расширить `getPrisma()` для использования `DATABASE_POOL_MAX` + добавить `idle_timeout`, `connection_timeout`, `application_name`. Также добавить `DATABASE_SSL` flag.
2. **(P3, 30 мин, T35-C)** Включить `ssl: 'require'` в production. Добавить env-driven `DATABASE_SSL`.
3. **(P3, 15 мин, T35-D)** Добавить `application_name` параметр через env: `MULTICHEF_SERVICE=api` / `worker` / `seed`. Operations dashboard может group by application_name.
4. **(P3, 30 мин)** Добавить `closePrisma()` в API `main.ts` SIGTERM handler — graceful shutdown.

## 7. Артефакты (35-й круг)

| Артефакт                 | Где                             |
| ------------------------ | ------------------------------- |
| Этот отчёт               | `docs/audit/AUDIT-REPORT-35.md` |
| FIX-PLAN (T35-A,B,C,D)   | `docs/audit/FIX-PLAN.md`        |
| DATABASE_POOL_MAX unused | §1 T35-A                        |
| PrismaPg without options | §1 T35-B                        |
| No SSL on Postgres       | §1 T35-C                        |
| No application_name      | §1 T35-D                        |
