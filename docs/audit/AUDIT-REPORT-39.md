# Технический, продуктовый и UI-аудит MULTI-CHEF (39-й круг)

**Дата:** 2026-09-15
**HEAD:** `f04fc97 chore(audit): AUDIT-REPORT-38 error-envelope-drift`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-38.md`, `FIX-PLAN.md`
**Фокус:** API rate-limiting — per-user vs per-IP, trustProxy, RATE_LIMITED envelope.

## TL;DR

39-й круг: **4 находки** — 0 P0, 2 🟠 P2 (tracker architecture), 2 🟡 P3.

- 🟠 **T39-A** — `@nestjs/throttler` default `getTracker(req)` = **`req.ip`** (per-IP). Один user на 2 устройствах (mobile + desktop) получает **2× квоту**. Один user за NAT (corporate, school) делит 300/min со всеми коллегами. Per-user tracking не реализован.
- 🟠 **T39-B** — `fastifyAdapter({ trustProxy: '127.0.0.1' })` — захардкожен. Если прод deploy за другим прокси (Cloudflare, AWS ALB), `req.ip` = `127.0.0.1` для всех клиентов → **все клиенты шарят одну квоту**. Default production deployment footgun.
- 🟡 **T39-C** — Нет `@ThrottlerSkip()` на health endpoints (`/health/live`, `/health/ready`). Health checks (k8s probes) каждые 5 sec → 720/hour → exhausting quota при ttl=60_000 limit=300 (2000 в час = close).
- 🟡 **T39-D** — `ThrottlerException` бросается напрямую, минуя `AppHttpExceptionFilter`. На 429 клиент получает **default NestJS error response** (text/html или plain JSON), не наш `{ error: { code: 'RATE_LIMITED', ... } }` envelope. T38-A drift в contract.

---

## 1. Технические находки (39-й круг)

### T39-A. Throttler tracker = IP-based, не per-user 🟠 P2

**Файл:** `apps/api/src/app.module.ts:31-37` (throttler setup).

**Сырой код:**

```ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
// ...
{ provide: APP_GUARD, useClass: ThrottlerGuard },
```

**Что делает throttler (по умолчанию, из `@nestjs/throttler/dist/throttler.guard.js`):**

```js
async getTracker(req) {
  return req.ip;  // ← IP-based
}
generateKey(context, suffix, name) {
  const prefix = `${context.getClass().name}-${context.getHandler().name}-${name}`;
  return sha256(`${prefix}-${suffix}`);
}
```

**Tracker = `req.ip`.** Per-endpoint bucket: `${ClassName}-${HandlerName}-${name}-${ip}`.

**Эффект:**

1. **Один user, два устройства**: mobile (LTE IP `1.2.3.4`) + desktop (WiFi IP `5.6.7.8`) → отдельные квоты. User может сделать 300/min на одном и 300/min на другом. **Per-user cap = 600/min effectively.**

2. **NAT scenario** (corporate, school, public WiFi): 100 сотрудников за одним IP → 100 пользователей делят 300/min квоту. **First 5 users** исчерпывают quota, остальные 95 получают 429.

3. **Auth bypass**: атакующий с ротацией IP (Tor, VPN) получает свежую квоту каждый раз.

**Смягчающие факторы:**

- Auth endpoints уже имеют `@Throttle({ default: { ttl: 60_000, limit: 10 } })` — auth самый важный (credential stuffing).
- Пока prod LAN — нет NAT.

**Рекомендованный фикс:**

1. **Per-user tracker** для authenticated routes:

   ```ts
   ThrottlerModule.forRootAsync({
     imports: [AuthModule],
     inject: [AuthService],
     useFactory: () => ({
       throttlers: [{ ttl: 60_000, limit: 300 }],
       getTracker: (req) => {
         // Try authenticated user first, fall back to IP
         const user = req.user;
         return user?.id ? `user:${user.id}` : req.ip;
       },
     }),
   }),
   ```

2. **Или** hybrid: global = per-IP (300/min), auth = per-IP (10/min), meal-plans generate = per-user (5/min). Named buckets:
   ```ts
   ThrottlerModule.forRoot([
     { name: 'global', ttl: 60_000, limit: 300 },       // per-IP
     { name: 'auth', ttl: 60_000, limit: 10 },          // per-IP, narrow
     { name: 'expensive', ttl: 60_000, limit: 5 },      // per-user
   ]),
   ```
   ```ts
   @SkipThrottle({ except: ['expensive'] })
   @Throttle({ expensive: { limit: 5 } })
   async generate(...) { ... }
   ```

### T39-B. `trustProxy: '127.0.0.1'` захардкожен 🟠 P2

**Файл:** `apps/api/src/main.ts:31`.

**Сырой код:**

```ts
const fastifyAdapter = new FastifyAdapter({
  trustProxy: '127.0.0.1', // ← только loopback
  logger: false,
});
```

**Эффект:**

- `req.ip` в Fastify считается через `X-Forwarded-For` header, **только если** connection от trusted proxy.
- Текущий `trustProxy: '127.0.0.1'` работает только с localhost прокси (nginx в текущем deploy).
- Если deploy за другим прокси (Cloudflare, AWS ALB, GCP Load Balancer) → `req.ip` = `127.0.0.1` для всех → **all clients share quota** (T39-A amplifier).

**Смягчающий фактор:** nginx на 192.168.1.95 — `127.0.0.1` корректно.

**Рекомендованный фикс:**

```ts
// packages/config/src/env.schema.ts
TRUST_PROXY: z.enum(['loopback', 'linklocal', 'uniquelocal', 'true', 'false']).default('loopback'),

// apps/api/src/main.ts
const fastifyAdapter = new FastifyAdapter({
  trustProxy: env.TRUST_PROXY,
  logger: false,
});
```

Или полный env-driven `TRUST_PROXY_IPS` (comma-separated CIDR).

### T39-C. Health endpoints не skip throttling 🟡 P3

**Файлы:** `apps/api/src/health/health.controller.ts` (no `@SkipThrottle()`).

**Сырой код:**

```ts
@Get('live')
liveness(): { status: 'ok' } { ... }

@Get('ready')
async readiness(...) { ... }
```

**Эффект:**

- k8s `livenessProbe.periodSeconds: 5` (default) → 720 GET /health/live/hour.
- `readinessProbe.periodSeconds: 10` → 360/hour.
- Каждый probe = +1 hit на IP.
- С учётом 2 probes (live + ready) → ~1080 probes/hour → 1 probe/sec.
- Global limit 300/min — при sustained load от probe = ~18/min (300/60*60=300). При burst на slow upstream = 429 на health probe → k8s маркирует pod unhealthy → restart loop.

**Рекомендованный фикс:**

```ts
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
@SkipThrottle()
export class HealthController { ... }
```

### T39-D. `ThrottlerException` минует error envelope 🟡 P3

**Файл:** `apps/api/src/app.module.ts:58` (`{ provide: APP_GUARD, useClass: ThrottlerGuard }`).

**Сырой код (throttler.guard.js):**

```js
async throwThrottlingException(context, throttlerLimitDetail) {
  throw new ThrottlerException(await this.getErrorMessage(context, throttlerLimitDetail));
}
```

**Эффект:**

- Throttler бросает `ThrottlerException` (NestJS builtin, NOT `AppHttpException`).
- Наш `AppHttpExceptionFilter` в `apps/api/src/common/exception-filter.ts:55` matches на `instanceof AppHttpException`. ThrottlerException extends `HttpException`, не `AppHttpException` → filter НЕ применяется.
- Клиент получает **default NestJS error response** (raw text message), не наш envelope `{ error: { code: 'RATE_LIMITED', message, details } }`.
- T38-A drift в contract — документация говорит `RATE_LIMITED`, но реальный response — другой формат.

**Рекомендованный фикс:**

Вариант 1 — перехватить в `exception-filter.ts`:

```ts
if (exception instanceof ThrottlerException) {
  throw new AppHttpException({ code: 'RATE_LIMITED', message: 'Too many requests' });
}
```

Вариант 2 — расширить `AppHttpExceptionFilter`:

```ts
if (exception instanceof HttpException && exception.getStatus() === 429) {
  // Map to RATE_LIMITED envelope
  sendErrorResponse(response, envelopeFromRequest(request, { code: 'RATE_LIMITED', ... }));
}
```

---

## 2. Подтверждённые здоровые паттерны

- **`@nestjs/throttler` используется** — baseline protection. ✓
- **Auth throttling: 10/min** — credential stuffing protection. ✓ (post-audit-13 fix)
- **`fastifyAdapter({ trustProxy: '127.0.0.1' })`** — есть, но hardcoded (T39-B).
- **`X-RateLimit-*` headers** — throttler автоматически выставляет. ✓
- **`Retry-After` header** — throttler выставляет. ✓
- **Tests для `IdempotencyReplayInterceptor`** — есть (T15-A). ✓

## 3. Микро-наблюдения

- **T39-α** — `@Throttle({ default: { ... } })` не имеет ключа `name` → bucket называется `'default'`. Если будут custom buckets, нужны уникальные names.
- **T39-β** — `ThrottlerModule.forRoot([...])` принимает массив — позволяет несколько buckets с разными TTL. Текущая реализация использует single bucket.
- **T39-γ** — `idempotency-cache.ts` использует `tracker = 'unavailable'` для fail-open. Это НЕ throttler-метрика, а cache fallback. Hygiene.
- **T39-δ** — `throttler-storage-interface` (default in-memory) не persistent. Если process restart → counters reset. Auth-attacker получает fresh quota. Hygiene: `ThrottlerStorageRedisService` (есть в `@nest-lab/throttler-storage-redis`).

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона                 | Находка                                                                                                                     | Где                                                                                                       |
| --------- | --------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **T39-A** | 🟠 P2     | API / Throttling     | Throttler tracker = `req.ip` (per-IP), не per-user. Multi-device user ×2 quota; NAT-shared quota.                           | `apps/api/src/app.module.ts:31-37`, `@nestjs/throttler/dist/throttler.guard.js: getTracker(req) = req.ip` |
| **T39-B** | 🟠 P2     | API / Trust proxy    | `trustProxy: '127.0.0.1'` hardcoded. Cloudflare/AWS ALB → all clients appear as 127.0.0.1 → shared quota.                   | `apps/api/src/main.ts:31`                                                                                 |
| **T39-C** | 🟡 P3     | API / Health         | Health endpoints (`/health/live`, `/health/ready`) NOT `@SkipThrottle()`. k8s probes → 429 → pod restart loop.              | `apps/api/src/health/health.controller.ts`                                                                |
| **T39-D** | 🟡 P3     | API / Error envelope | `ThrottlerException` минует `AppHttpExceptionFilter`. Клиент получает default NestJS error, не наш `RATE_LIMITED` envelope. | `apps/api/src/app.module.ts:58`, throttler.guard.js (`throwThrottlingException`)                          |

## 5. Куммулятивный итог (39 кругов)

| Iter   | Round   | Topic                 | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | --------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–30  | #21–#30 | (предыдущие раунды)   | —            | 0     | 0     | 5     | 25    |
| 31     | #31     | API Zod validation    | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene        | T32-A..D     | 0     | 0     | 2     | 2     |
| 33     | #33     | DB migration safety   | T33-A..D     | 0     | 0     | 1     | 3     |
| 34     | #34     | OpenAPI / Swagger     | T34-A..D     | 0     | 0     | 2     | 2     |
| 35     | #35     | Prisma / pool config  | T35-A..D     | 0     | 0     | 2     | 2     |
| 36     | #36     | Logging redaction     | T36-A..D     | 0     | 0     | 1     | 3     |
| 37     | #37     | BFF / NEXT_PUBLIC     | T37-A..D     | 0     | 0     | 1     | 3     |
| 38     | #38     | Error envelope drift  | T38-A..D     | 0     | 0     | 2     | 2     |
| **39** | **#39** | **API rate-limiting** | **T39-A..D** | **0** | **0** | **2** | **2** |

Cumulative after 39: P0=12, P1=2, P2=30, P3=51.

**Тренд 39-го:** Throttling architecture. После error contract (38) — focus на rate-limit design. T39-A и B — реальные production deployment concerns (multi-device, multi-proxy).

## 6. Рекомендации (39-й круг)

1. **(P2, 2ч, T39-A)** Заменить `getTracker` на per-user для authenticated routes, fallback на IP. Использовать `forRootAsync` с custom `getTracker`. Ввести named buckets `global` (per-IP) / `expensive` (per-user).
2. **(P2, 1ч, T39-B)** Env-driven `TRUST_PROXY`. Добавить в `webEnvSchema` / `serverEnvSchema`. Документировать production-deployment matrix.
3. **(P3, 15 мин, T39-C)** `@SkipThrottle()` на `HealthController`.
4. **(P3, 1ч, T39-D)** В `exception-filter.ts` добавить case для `ThrottlerException` / `HttpException` со status 429 → throw `AppHttpException({ code: 'RATE_LIMITED' })`.

## 7. Артефакты (39-й круг)

| Артефакт                           | Где                             |
| ---------------------------------- | ------------------------------- |
| Этот отчёт                         | `docs/audit/AUDIT-REPORT-39.md` |
| FIX-PLAN (T39-A,B,C,D)             | `docs/audit/FIX-PLAN.md`        |
| Throttler per-IP                   | §1 T39-A                        |
| trustProxy hardcoded               | §1 T39-B                        |
| Health not skipping throttler      | §1 T39-C                        |
| ThrottlerException bypasses filter | §1 T39-D                        |
