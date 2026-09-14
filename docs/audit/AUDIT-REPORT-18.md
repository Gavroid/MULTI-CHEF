# Технический, продуктовый и UI-аудит MULTI-CHEF (18-й круг)

**Дата:** 2026-09-14
**HEAD:** `e13ec27 chore(audit): AUDIT-REPORT-17 schema-drift + pgvector`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-17.md`, `VERIFICATION.md`
**Фокус:** logger/observability, exception filter, server-side error disclosure, dead-code audit.

## TL;DR

18-й круг: **4 находки** — 2 🟠 P2 (log verbosity + dead-code logger) + 2 🟡 P3 (env-bypass + response-redaction gap).

- 🟠 **T18-A — Двойное логирование каждого unhandled-исключения** (Prisma → фильтр → stdout). Verbose: `modelName`, `target`, `clientVersion`, full stack with internal paths.
- 🟠 **T18-B — 3 dead-code Logger instance** в services (auth/profile/household) — declared but never used.
- 🟡 **T18-C — `health.controller.ts:46` читает `process.env['REDIS_URL']` напрямую**, в обход `@multichef/config` валидации → тихий пропуск Redis-check при unset env.
- 🟡 **T18-D — `redactSecrets()` в outgoing-ответах НЕ применятся к server-side логам**.

---

## 1. Технические находки (18-й круг)

### T18-A. Logger выводит каждое unhandled-исключение 2-3 раза (Prisma + filter + stack) 🟠 P2

**Файл:** `apps/api/src/common/exception-filter.ts:58`
**Также:** `packages/database/src/index.ts` (`log: ['warn', 'error']` на Prisma)

**Raw journalctl (реальный production log):**

```
Sep 14 14:38:37 multichef pnpm[28899]: prisma:error
Sep 14 14:38:37 multichef pnpm[28899]: Invalid `prisma.user.create()` invocation:
Sep 14 14:38:37 multichef pnpm[28899]: Unique constraint failed on the fields: (`email`)
Sep 14 14:38:37 multichef pnpm[28899]: [Nest] ERROR [AppHttpExceptionFilter] unhandled exception:
Sep 14 14:38:37 multichef pnpm[28899]: Invalid `prisma.user.create()` invocation:
Sep 14 14:38:37 multichef pnpm[28899]: Unique constraint failed on the fields: (`email`)
Sep 14 14:38:37 multichef pnpm[28899]: [Nest] ERROR [AppHttpExceptionFilter] PrismaClientKnownRequestError:
Sep 14 14:38:37 multichef pnpm[28899]: Invalid `prisma.user.create()` invocation:
Sep 14 14:38:37 multichef pnpm[28899]: Unique constraint failed on the fields: (`email`)
Sep 14 14:38:37 multichef pnpm[28899]:   at async /opt/multichef/apps/api/dist/auth/auth.service.js:69:13
Sep 14 14:38:37 multichef pnpm[28899]:   at async Proxy._transactionWithCallback (/opt/multichef/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client/runtime/library.js:130:8120)
Sep 14 14:38:37 multichef pnpm[28899]:   at async AuthService.register (/opt/multichef/apps/api/dist/auth/auth.service.js:68:9)
Sep 14 14:38:37 multichef pnpm[28899]:   at async AuthController.register (/opt/multichef/apps/api/dist/auth/auth.controller.js:133:24)
...
Sep 14 14:38:37 multichef pnpm[28899]:   code: 'P2002',
Sep 14 14:38:37 multichef pnpm[28899]:   meta: {
Sep 14 14:38:37 multichef pnpm[28899]:     modelName: 'User',
Sep 14 14:38:37 multichef pnpm[28899]:     target: [ 'email' ]
Sep 14 14:38:37 multichef pnpm[28899]:   },
Sep 14 14:38:37 multichef pnpm[28899]:   clientVersion: '6.19.3'
Sep 14 14:38:37 multichef pnpm[28899]: }
```

**Что происходит:**

1. **Prisma's own client logger** (`log: ['warn', 'error']` в `packages/database/src/index.ts:30`) пишет `prisma:error` line.
2. **NestJS exception filter** (`apps/api/src/common/exception-filter.ts:55-59`):
   ```ts
   const message = exception instanceof Error ? exception.message : String(exception);
   this.logger.error(`unhandled exception: ${message}`, exception);
   ```
   - 1-я строка: `unhandled exception: ${message}` (где message = exception.message = "Invalid `prisma.user.create()...").
   - 2-й аргумент (`exception`) — NestJS Logger интерпретирует как **stack trace** и рендерит отдельными строками после сообщения, **включая JSON.prettyprint объекта exception** (поля `code`, `meta`, `clientVersion`).

**Итого: один необработанный Prisma error = 3 дублирующихся блока логов:**

| Pass | Источник                                                                     | Что логируется                           |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| 1    | `prisma:error`                                                               | только message                           |
| 2    | filter `unhandled exception: ${msg}`                                         | message + stack trace                    |
| 3    | filter `PrismaClientKnownRequestError:` (через serialization 2-го аргумента) | message + stack + **Prisma meta fields** |

**Что утекает в логи:**

- `meta.modelName`, `meta.target[]` → структура DB-таблиц и их UNIQUE-индексы (это attack-info для SQLi-researcher).
- `clientVersion: '6.19.3'` → точная версия Prisma (CVE-lookup for known versions).
- Stack trace с **абсолютными путями `/opt/multichef/apps/api/dist/...`** → инфа о release/debug build.

**Что НЕ утекает клиенту** (verified):

- HTTP-ответ = `{"status":500,"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}` — **не** содержит stack/meta. ✅ Sanitized.
- Если клиент ловит INTERNAL_ERROR → получает общий message «Internal server error», без следов. ✅

**Hotfix (5 мин):**

```ts
// exception-filter.ts:55-59
} else {
  this.logger.error(
    `unhandled exception: ${exception instanceof Error ? exception.name : 'unknown'}`,
    exception instanceof Error ? exception.stack : undefined,
  );
  // Add structured capture for known DB errors:
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    this.logger.error(`Prisma error code=${exception.code} meta=${JSON.stringify(exception.meta)}`);
  }
  input = { code: 'INTERNAL_ERROR', message: 'Internal server error' };
}
```

И уменьшить Prisma log: `log: env.LOG_LEVEL === 'debug' ? ['warn','error'] : ['error']` — убрать 'warn' повторяющийся (`'warn'` фиксируется отдельно).

---

### T18-B. 3 dead-code Logger instances в services 🟠 P3

**Raw (`grep -rn "logger"`):**

```
apps/api/src/auth/auth.service.ts:73:      private readonly logger = new Logger(AuthService.name);
apps/api/src/profile/profile.service.ts:71:    private readonly logger = new Logger(ProfileService.name);
apps/api/src/household/household.service.ts:22:  private readonly logger = new Logger(HouseholdService.name);
```

**Использование (`grep -n "logger\."`):**

```
apps/api/src/common/exception-filter.ts:58:      this.logger.error(...)
```

**Только 1 реальный logger-call** во всём `apps/api/src`. Остальные 3 — declared, never used.

**Доказательство:** declared на строке 73, 71, 22 соответственно, но **нигде не вызываются**. ESLint правило `no-unused-vars-class-members` в NestJS обычно не срабатывает для `private readonly` полей, потому что они могут использоваться DI/middleware.

Это **dead-code** + лишний memory footprint (`Logger` создаётся 3 раза за service-lifetime, в среднем ~50-100 bytes на service × 3).

**Hotfix (5 мин каждый файл):**

```ts
// auth.service.ts
- private readonly logger = new Logger(AuthService.name);
+ // No logger needed — service-level logging handled by exception filter.
```

---

### T18-C. `health.controller.ts:46` читает `REDIS_URL` через `process.env`, минуя env-validation 🟡 P3

**Файл:** `apps/api/src/health/health.controller.ts:46`

**Raw:**

```ts
const redisUrl = process.env['REDIS_URL'];  // ← bypass!
if (redisUrl) {
  try {
    const { default: IORedis } = await import('ioredis');
    const redis = new IORedis(redisUrl, { lazyConnect: true, ... });
    ...
  } catch (err) { ... }
}
```

**Что не так:**

- **Все остальные** env-vars читаются через `loadServerEnv()` (`@multichef/config`) — schema-validated.
- Здесь — **bypass** напрямую: если `REDIS_URL` undefined, **тихий skip**.
- В остальном коде `env.REDIS_URL` (validated) — и **используется**, например `apps/api/src/jobs/queue-publisher.ts`.

**Дрейф-опасность:**

- Теоретически возможно, что в одном flow REDIS_URL unset → health/ready возвращает `READY` без Redis-проверки. **Но Nest сам не падает**, потому что ioredis lazy connect.
- Приложение может оказаться в состоянии «health=READY, BullMQ не работает». Это **monitoring gap**.
- При невалидной REDIS_URL-strom (в `process.env['REDIS_URL']` строка вида «redis:wrongpass@...») exception бросится → ловится catch → конвертится в 503. OK.

**Hotfix (10 мин):**

```ts
import { loadServerEnv } from '@multichef/config';
...
const env = loadServerEnv();
const redisUrl = env.REDIS_URL;     // schema-validated, throws if missing
```

---

### T18-D. redactSecrets() redacted outgoing-response, но НЕ log-output 🟡 P3

**Файл:** `apps/api/src/common/error-envelope.ts:96-122`

**Что делает:**

```ts
const SECRET_KEYS = new Set([
  'password', 'currentPassword', 'newPassword',
  'token', 'sessionToken', 'cookieSecret', 'secret',
]);
function redactSecrets(input: unknown): unknown { ... }
```

✅ Применяется к `input.details` перед `envelopeFromRequest(...)` → outgoing response sanitized (см. `__tests__/error-envelope.test.ts:51`).

❌ **НЕ применяется к `exception.filter`'s logger**:

```ts
this.logger.error(`unhandled exception: ${message}`, exception);
```

- Если exception содержит `{ meta: { ..., userId, householdId, email } }` — это утекает в journalctl.

Сейчас Prisma meta **только schema-info** (имя таблицы + ключи), не значения. Но **если в будущем** добавят middleware типа Prisma `$on('query')` → все request inputs попадут в query-stmt → вытекают в logs.

**Hotfix (родитель-на-ребёнок):**

```ts
// exception-filter.ts
import { redactSecrets } from './error-envelope.js';
this.logger.error(
  redactSecrets({
    path: request?.url,
    method: request?.method,
    message,
    prismaCode: exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : null,
    meta:
      exception instanceof Prisma.PrismaClientKnownRequestError
        ? redactSecrets(exception.meta)
        : null,
  }),
);
```

---

## 2. Подтверждённые здоровые паттерны

### ✅ Outgoing HTTP error envelope всегда sanitized

```
$ curl /test-unhappy  →  {"status":500,"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}
```

Клиент **не получает** stack/meta ни в каком виде. ✅ Verified для всех 1-17 раундов.

### ✅ Prisma log уровни разумные

```ts
log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'];
```

Production: `['warn','error']` (без query с параметрами). ✅

### ✅ Auth-failure messages не раскрывают, существует ли email

Прочёл `apps/api/src/auth/auth.service.ts:222+` — login failure возвращает generic «Invalid credentials». Не различает «user not found» vs «wrong password». ✅ (audit #3 B1).

### ✅ Структура логов имеет prefix `[AppHttpExceptionFilter]` / `prisma:error`

NestJS Logger контекстно-маркирует. ✅ Grep `+8 distinct context names`.

---

## 3. Микро-наблюдения

- **T18-E** — `apps/api/src/jobs/queue-publisher.ts:40`:

  ```ts
  console.warn(`[jobs] REDIS_URL not configured — job ${payload.jobId} recorded but NOT queued`);
  ```

  Логирует `jobId` (= planId обычно). ULID (26 chars, 80 bit randomness) — not sensitive, but log-stuffer increases log volume на каждый generated-but-not-queued job. Hygiene: trim planId to ULID hash.

- **T18-F** — `apps/api/src/main.ts:96-98` использует `console.log` для startup banner. После `app.useLogger(new Logger(...))` логи идут в оба места: и через NestJS Logger, и через console.log. Несоответствие формата логов.

- **T18-G** — В `mc003_initial/migration.sql:584-588` упоминается "PRD §3 / §3.3" в комментарии — но **`docs/prd/` или `docs/PRD/` папки НЕТ** (`find /opt/multichef/docs -name 'PRD*'`). Ссылка на nonexistent doc.

---

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона            | Находка                                                                                                                                                         | Где                                                                                   |
| --------- | --------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **T18-A** | 🟠 P2     | Logging         | `unhandled exception` логируется 2-3 раза за одно событие (Prisma + filter). Verbose: Prisma `meta`, stack trace с internal paths, client version, schema info. | `apps/api/src/common/exception-filter.ts:55-59` + `packages/database/src/index.ts:30` |
| **T18-B** | 🟠 P3     | Dead-code       | 3 unused `private readonly logger = new Logger(...)` в auth/profile/household services.                                                                         | `auth.service.ts:73, profile.service.ts:71, household.service.ts:22`                  |
| **T18-C** | 🟡 P3     | Env-loading     | `health.controller.ts:46` читает `process.env['REDIS_URL']` напрямую, минуя `@multichef/config` валидацию → тихий skip.                                         | `apps/api/src/health/health.controller.ts:46`                                         |
| **T18-D** | 🟡 P3     | Logging/Privacy | `redactSecrets` применяется только к outgoing-ответам, **не к server-side exception логам**. Server logs могут утекать schema+PII через Prisma meta.            | `apps/api/src/common/error-envelope.ts:96-122` ↔ `exception-filter.ts:58`             |

---

## 5. Куммулятивный итог (18 кругов)

| Iter    | Findings           | 🔴 P0  | 🔴 P1 | 🟠 P2-P3 | 🟡 ℹ️        | Cumulative            |
| ------- | ------------------ | ------ | ----- | -------- | ------------ | --------------------- |
| #1–3    | 26                 | 9      | 0     | 6        | 11           | —                     |
| #4–10   | 13                 | 0      | 0     | 13       | 0            | —                     |
| #11     | T11-A, T11-B       | 0      | 0     | 2        | 0            | —                     |
| #12     | T12-A              | 0      | 0     | 1        | 0            | —                     |
| #13     | T13-A              | 1 P0   | 0     | 0        | 0            | 10 P0                 |
| #14     | T14-A              | 0      | 0     | 1        | 0            | 10 P0                 |
| #15     | T15-A, T15-B       | 1 P0   | 0     | 1        | 0            | 11 P0                 |
| #16     | T16-A, T16-B       | 0      | 0     | 2        | 0            | 11 P0                 |
| #17     | T17-A, T17-B       | 0      | 2 P1  | 0        | 0            | 11 P0, 2 P1           |
| **#18** | **T18-A, B, C, D** | 0      | 0     | **2**    | **2**        | 11 P0, 2 P1, **2 P2** |
| **Σ**   | **~54**            | **11** | **2** | **28**   | **13 ℹ️/P3** | —                     |

**Тренд 18-ти:** разнообразие зон audit. Round 17 = schema, Round 18 = observability/logging. Никаких P0 — bug-free секции, но hygiene & privacy concerns.

---

## 6. Рекомендации (18-й круг)

1. **(P2, 15 мин, T18-A)** Refactor exception filter:
   ```ts
   this.logger.error(
     `unhandled exception (${exception instanceof Error ? exception.name : 'unknown'})`,
     exception instanceof Error ? exception.stack : undefined,
   );
   ```
   Избегать полного printout Prisma meta в обычный Logger — переместить в dedicated monitoring channel (sentry/loki).
2. **(P3, 5 мин, T18-B)** Удалить 3 dead-code Logger instances (auth, profile, household).
3. **(P3, 10 мин, T18-C)** Заменить `process.env['REDIS_URL']` в health.controller на `env.REDIS_URL` через `loadServerEnv()`.
4. **(P3, ongoing)** Подумать о structured-logging (pino/winston) + log sampling — избежать verbose multi-line в production.
5. **(P0, повтор)** T13-A, T15-A (race-conditions) **не пофикшены**, +17 раундов.

---

## 7. Артефакты (18-й круг)

| Артефакт                             | Где                             |
| ------------------------------------ | ------------------------------- |
| Этот отчёт                           | `docs/audit/AUDIT-REPORT-18.md` |
| Raw journalctl (14:38:37 trace)      | §1 T18-A                        |
| PrismaClient init log-level config   | §1 T18-A                        |
| 3 dead-code logger instances         | §1 T18-B                        |
| `process.env['REDIS_URL']` in health | §1 T18-C                        |
| `redactSecrets` forward vs log       | §1 T18-D                        |
