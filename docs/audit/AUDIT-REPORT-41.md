# Технический, продуктовый и UI-аудит MULTI-CHEF (41-й круг)

**Дата:** 2026-09-15
**HEAD:** `04bc8a4 chore(audit): AUDIT-REPORT-40 web-perf-finale`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-40.md`, `FIX-PLAN.md`
**Фокус:** CORS — `allowedHeaders`, `exposedHeaders`, `origin` matching, defaults.

## TL;DR

41-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T41-A** — `allowedHeaders` в CORS НЕ содержит `X-CSRF-Token`. CSRF guard требует этот header, но cross-origin preflight его не пропустит. Если web client на другом origin → CSRF guard никогда не получает header.
- 🟠 **T41-B** — `exposedHeaders` НЕ содержит `Retry-After-{name}` (используется `@nestjs/throttler`). Клиент не видит Retry-After → не может правильно реализовать back-off.
- 🟡 **T41-C** — `CORS_ORIGINS` default = `http://localhost:3000`. Если в проде не задан → **только localhost разрешён** (silent prod failure).
- 🟡 **T41-D** — `CORS_ORIGINS.includes(origin)` exact string match — нет wildcard support (`https://*.multichef.com`). Hygiene.

---

## 1. Технические находки (41-й круг)

### T41-A. CORS `allowedHeaders` без `X-CSRF-Token` 🟠 P2

**Файл:** `apps/api/src/main.ts:47`.

**Сырой код:**

```ts
await fastifyAdapter.register(fastifyCors as never, {
  origin: (origin, cb) => {
    /* allowlist */
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'Cookie'],
  // ← нет 'X-CSRF-Token'!
  exposedHeaders: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
  maxAge: 86400,
});
```

**CSRF guard (`apps/api/src/common/csrf-guard.ts:26`):**

```ts
const CSRF_HEADER = 'x-csrf-token';    // ← lowercase
// ...
if (!cookieToken && !hasSession) return true;  // soft-mode
if (!cookieToken) {
  throw new AppHttpException({ code: 'CSRF_MISMATCH', ... });
}
const headerToken = req.headers[CSRF_HEADER];   // ← read header
// compare headerToken to cookieToken
```

**Эффект:**

Cross-origin browser делает `POST /api/v1/...`:

1. Браузер посылает preflight `OPTIONS` с `Access-Control-Request-Headers: X-CSRF-Token`.
2. Сервер отвечает **403 / без `Access-Control-Allow-Headers: X-CSRF-Token`** → preflight fails.
3. Браузер блокирует основной request.
4. Клиент получает CORS error, **CSRF guard никогда не вызывается** (запрос не доходит).

**Смягчающие факторы:**

- На текущем проде web (3000) и api (3001) за одним nginx → same-origin, CORS preflight не нужен.
- CSRF guard в soft-mode пропускает запросы без csrf cookie (non-browser clients).
- Если web client на ТОМ ЖЕ origin что api (через nginx proxy_pass), `X-CSRF-Token` передаётся нормально.

**Рекомендованный фикс:**

```ts
allowedHeaders: [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'Cookie',
  'X-CSRF-Token',  // ← добавить
],
```

### T41-B. `exposedHeaders` без `Retry-After-{name}` (throttler) 🟠 P2

**Файл:** `apps/api/src/main.ts:48`.

**Сырой код:**

```ts
exposedHeaders: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
// ← нет 'Retry-After' и 'Retry-After-default'!
```

**Что делает `@nestjs/throttler`** (см. throttler.guard.js):

```js
res.header(`Retry-After${getThrottlerSuffix(throttler.name)}`, timeToBlockExpire);
```

Где `getThrottlerSuffix('default')` → `''` → header `Retry-After`. Для named bucket → `Retry-After-{name}`.

**Эффект:**

- Клиент получает 429 с `Retry-After` header в response.
- CORS spec требует, чтобы non-simple headers были **exposed** через `Access-Control-Expose-Headers`.
- Если `Retry-After` НЕ exposed → JavaScript на cross-origin клиенте не может прочитать `Retry-After` → не делает back-off → продолжает spam'ить.

**Смягчающий фактор:** Same-origin clients (текущий прод) не подвержены CORS restrictions на чтение response headers.

**Рекомендованный фикс:**

```ts
exposedHeaders: [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'Retry-After',
  'Retry-After-default',  // for future named buckets
  'X-Request-Id',          // for error envelope (T38)
],
```

### T41-C. `CORS_ORIGINS` default = localhost (prod footgun) 🟡 P3

**Файл:** `packages/config/src/env.schema.ts`.

**Сырой код:**

```ts
CORS_ORIGINS: z
  .string()
  .min(1)
  .default('http://localhost:3000')
  .transform((value) =>
    value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
  ),
```

**Эффект:**

- Если production build не передаёт `CORS_ORIGINS`, сервер разрешает **только** `http://localhost:3000`.
- Реальные клиенты с `https://app.multichef.com` получают CORS error на каждом запросе.
- Аналогично T37-B (NEXT_PUBLIC_APP_BASE_URL default).

**Смягчающий фактор:** На LAN deploy с одним origin через nginx — same-origin, CORS не активен.

**Рекомендованный фикс:**

```ts
CORS_ORIGINS: process.env.NODE_ENV === 'production'
  ? z.string().min(1).transform(/* split */)   // required
  : z.string().min(1).default('http://localhost:3000').transform(/* split */),
```

И runtime check в `main.ts`: если NODE_ENV=production && CORS_ORIGINS contains 'localhost' → throw.

### T41-D. CORS origin — exact match, no wildcards 🟡 P3

**Файл:** `apps/api/src/main.ts:38`.

**Сырой код:**

```ts
if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
```

**Эффект:**

- Operator не может задать `https://*.multichef.com` — exact match fails на `https://app.multichef.com`.
- Каждый subdomain нужно явно перечислить: `https://app.multichef.com,https://admin.multichef.com,https://api.multichef.com`.

**Смягчающий фактор:** Текущий прод — single-origin (`192.168.1.95`).

**Рекомендованный фикс:** реализовать simple wildcard matching:

```ts
function matchesOrigin(origin: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.includes('*')) {
      const regex = new RegExp(
        '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
      );
      return regex.test(origin);
    }
    return p === origin;
  });
}

if (matchesOrigin(origin, env.CORS_ORIGINS)) return cb(null, true);
```

---

## 2. Подтверждённые здоровые паттерны

- **`credentials: true` + per-origin allowlist callback** — правильный CORS pattern (no `*` wildcard). ✓
- **`maxAge: 86400` (24h)** preflight cache — разумно. ✓
- **All CRUD methods** в methods list. ✓
- **Idempotency-Key, Authorization в allowedHeaders**. ✓
- _*x-ratelimit-* headers exposed_* (для клиентов с rate-limit UI). ✓

## 3. Микро-наблюдения

- **T41-α** — `origin` callback вызывается per-request. Если 1000 req/s → 1000 callback calls. Hygiene: можно cache allowlist lookup.
- **T41-β** — `Access-Control-Allow-Credentials: true` (от `credentials: true`) — корректно для cookie auth.
- **T41-γ** — Нет `Vary: Origin` header в ответе. Если nginx кэширует ответы, разные origins получат один и тот же cached response с `Access-Control-Allow-Origin: app.multichef.com` → leak. Hygiene.
- **T41-δ** — `transform` в env.schema.ts работает только если `CORS_ORIGINS` — string. Если кто-то передаст array в env (через dotenv строковый массив?) → zod `.transform` вызовет `.split(',')` на array → error. Hygiene.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона       | Находка                                                                                                           | Где                                 |
| --------- | --------- | ---------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **T41-A** | 🟠 P2     | API / CORS | `allowedHeaders` НЕ содержит `X-CSRF-Token`. Cross-origin preflight fails. CSRF guard никогда не получает header. | `apps/api/src/main.ts:47`           |
| **T41-B** | 🟠 P2     | API / CORS | `exposedHeaders` НЕ содержит `Retry-After`. Cross-origin клиент не видит Retry-After → не делает back-off.        | `apps/api/src/main.ts:48`           |
| **T41-C** | 🟡 P3     | API / CORS | `CORS_ORIGINS` default = `http://localhost:3000`. Prod footgun: только localhost разрешён.                        | `packages/config/src/env.schema.ts` |
| **T41-D** | 🟡 P3     | API / CORS | Origin matching — exact string. Нет wildcard support.                                                             | `apps/api/src/main.ts:38`           |

## 5. Куммулятивный итог (41 кругов)

| Iter   | Round   | Topic                | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | -------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–30  | #21–#30 | (предыдущие раунды)  | —            | 0     | 0     | 5     | 25    |
| 31     | #31     | API Zod              | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene       | T32-A..D     | 0     | 0     | 2     | 2     |
| 33     | #33     | DB migration safety  | T33-A..D     | 0     | 0     | 1     | 3     |
| 34     | #34     | OpenAPI / Swagger    | T34-A..D     | 0     | 0     | 2     | 2     |
| 35     | #35     | Prisma / pool config | T35-A..D     | 0     | 0     | 2     | 2     |
| 36     | #36     | Logging redaction    | T36-A..D     | 0     | 0     | 1     | 3     |
| 37     | #37     | BFF / NEXT_PUBLIC    | T37-A..D     | 0     | 0     | 1     | 3     |
| 38     | #38     | Error envelope drift | T38-A..D     | 0     | 0     | 2     | 2     |
| 39     | #39     | API rate-limiting    | T39-A..D     | 0     | 0     | 2     | 2     |
| 40     | #40     | Web performance      | T40-A..D     | 0     | 0     | 1     | 3     |
| **41** | **#41** | **CORS**             | **T41-A..D** | **0** | **0** | **2** | **2** |

Cumulative after 41 (this session #41–#50 series so far): P0=0, P1=0, P2=2, P3=2.

## 6. Рекомендации (41-й круг)

1. **(P2, 5 мин, T41-A)** Добавить `'X-CSRF-Token'` в `allowedHeaders` в `apps/api/src/main.ts:47`.
2. **(P2, 5 мин, T41-B)** Добавить `'Retry-After'` (и `Retry-After-default`) в `exposedHeaders`.
3. **(P3, 30 мин, T41-C)** В production — required `CORS_ORIGINS`. Runtime assertion если default в проде.
4. **(P3, 30 мин, T41-D)** Реализовать wildcard matcher.

## 7. Артефакты (41-й круг)

| Артефакт                        | Где                             |
| ------------------------------- | ------------------------------- |
| Этот отчёт                      | `docs/audit/AUDIT-REPORT-41.md` |
| FIX-PLAN (T41-A,B,C,D)          | `docs/audit/FIX-PLAN.md`        |
| CORS missing X-CSRF-Token       | §1 T41-A                        |
| CORS missing Retry-After expose | §1 T41-B                        |
| CORS_ORIGINS default localhost  | §1 T41-C                        |
| No wildcard origin match        | §1 T41-D                        |
