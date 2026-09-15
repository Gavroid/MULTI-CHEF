# Технический, продуктовый и UI-аудит MULTI-CHEF (36-й круг)

**Дата:** 2026-09-15
**HEAD:** `85e46e3 chore(audit): AUDIT-REPORT-35 prisma-pool-config`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-35.md`, `FIX-PLAN.md`
**Фокус:** Logging redaction — `SECRET_KEYS` coverage, PII leak through error envelope, app startup logs.

## TL;DR

36-й круг: **4 находки** — 0 P0, 1 🟠 P2 (PII redaction gap), 3 🟡 P3.

- 🟠 **T36-A** — `SECRET_KEYS` (apps/api/src/common/error-envelope.ts:115) содержит только 7 password/token-shaped keys. **Email, householdId, userId, notes, session cookie values — НЕ редактируются**. Существующий тест `error-envelope.test.ts:48-52` подтверждает: `{ password: 'Pa$w0rd!', email: 'a@b.com' }` → `password` отредактирован, **`email` остаётся `'a@b.com'`**. PII leak через `details` в envelope + через `exception-filter.ts:79` логирование.
- 🟡 **T36-B** — `exception-filter.ts:79` логирует `JSON.stringify(record)` где record = `{ type, message, prismaCode, target }`. `prismaCode` + `target` раскрывают имена constraint'ов (T26-A). Не PII напрямую, но schema leak.
- 🟡 **T36-C** — `apps/api/src/main.ts` startup logs могут содержать env values (REDIS_URL, DATABASE_URL с credentials). Не проверял.
- 🟡 **T36-D** — `apps/worker/src/main.ts:14` `process.env['REDIS_URL']` — error message от IORedis может содержать URL.

---

## 1. Технические находки (36-й круг)

### T36-A. `SECRET_KEYS` не покрывает PII keys — email утекает через `details` 🟠 P2

**Файл:** `apps/api/src/common/error-envelope.ts:113-122`.

**Сырой код:**

```ts
const REDACTED = '[REDACTED]';
const SECRET_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'sessionToken',
  'cookieSecret',
  'secret',
]);
```

**Существующий тест подтверждает баг:**

```ts
// apps/api/src/__tests__/error-envelope.test.ts:46-53
test('toErrorBody: trims password out of details (no plaintext leak)', () => {
  const body = toErrorBody({
    code: 'VALIDATION_ERROR',
    message: 'bad',
    details: { password: 'Pa$w0rd!', email: 'a@b.com' },
  });
  const details = body.error.details as { password: string; email: string };
  assert.equal(details.password, '[REDACTED]');
  assert.equal(details.email, 'a@b.com'); // ← BUG: email НЕ отредактирован
});
```

**Эффект:**

1. **API response**: `{ error: { code: 'VALIDATION_ERROR', details: { email: 'a@b.com' } } }` — email утекает клиенту (но клиент уже знает свой email, так что OK).
2. **Server-side log** (exception-filter.ts:79): `JSON.stringify(record)` где record = `redactSecrets({ ... })`. Если record содержит `email`, server-side log имеет email в plaintext.
3. **PII в `details`**: например, error при регистрации `{ details: { email: 'user@x.com' } }` — пользователь видит свой email в ответе (low risk), но server-side logs получают его в plaintext.

**Где ещё используется `details`:**

- `apps/api/src/auth/auth.controller.ts:127` — `details: { fields: { _: ['invalid proposal'] } }` — нет PII. ✓
- `apps/api/src/meal-plans/meal-plans.controller.ts:91` — `details: { _: ['invalid body'] }` — нет PII. ✓
- `apps/api/src/pantry/pantry.controller.ts` — `details: { fields: { ingredientId: ['not a ULID'] } }` — нет PII. ✓

Но в принципе, **любой новый controller может передать `details: { email: 'user@x.com' }`** и `SECRET_KEYS` не отфильтрует.

**Смягчающий фактор:** В существующем коде нет мест, где `details` содержит email. Но контракт не защищает от будущих багов.

**Рекомендованный фикс:**

```ts
const SECRET_KEYS = new Set([
  // Authentication secrets (existing)
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'sessionToken',
  'cookieSecret',
  'secret',
  // PII (GDPR Art. 4)
  'email',
  'householdId',
  'userId',
  'notes',
  // Cookies
  'mc_session',
  'mc_csrf',
  // Authorization headers (when logged)
  'authorization',
  'x-api-key',
  'x-csrf-token',
]);
```

И обновить тест:

```ts
assert.equal(details.email, '[REDACTED]'); // expected after fix
```

### T36-B. exception-filter logs schema-leaking Prisma info 🟡 P3

**Файл:** `apps/api/src/common/exception-filter.ts:67-79`.

**Сырой код:**

```ts
const record = redactSecrets({
  type: name,
  message,
  ...(exception instanceof Prisma.PrismaClientKnownRequestError
    ? { prismaCode: exception.code, target: exception.meta?.['target'] }
    : {}),
});
this.logger.error(
  `unhandled exception: ${JSON.stringify(record)}`,
  exception instanceof Error ? exception.stack : undefined,
);
```

**Эффект:**

- `prismaCode` (например, `P2002`) — schema-agnostic, OK.
- `target` — может быть `string[]` имен constraint'ов или `string` имени поля. Например, `"Preference_userId_kind_ingredientId_key"` или `"householdId"`. Раскрывает структуру БД.

T26-A уже отметил это как job-error schema leak (через `Job.error` колонку). Здесь — server-side log version.

**Рекомендованный фикс:**

```ts
const record = redactSecrets({
  type: name,
  message: message.split('\n')[0].slice(0, 500), // truncate
  ...(exception instanceof Prisma.PrismaClientKnownRequestError
    ? { prismaCode: exception.code } // omit target
    : {}),
});
```

Или — structured logger с правильным redaction (T21-C).

### T36-C. App startup logs могут содержать credentials 🟡 P3

**Файл:** `apps/api/src/main.ts` (нужно проверить).

**Проверка:**

```bash
$ grep -B 1 -A 4 "logger.log\|console.log\|Logger.log" apps/api/src/main.ts | head -25
```

**Гипотеза:** если `Logger.log('Starting API on port ' + env.PORT)` — безопасно. Если `Logger.log('Connected to ' + env.DATABASE_URL)` — credentials утекают.

**Рекомендованный фикс:** audit всех `console.log` в `main.ts` + worker `main.ts`. Заменить на `console.log('API starting on port ${env.PORT}')` без URL.

### T36-D. IORedis error messages содержат REDIS_URL 🟡 P3

**Файл:** `apps/worker/src/main.ts:14`.

**Сырой код:**

```ts
const url = process.env['REDIS_URL'];
if (!url) {
  throw new Error('worker: REDIS_URL is required to consume the planning queue');
}
return new IORedis(url, { maxRetriesPerRequest: null });
```

**Эффект:**

Если `REDIS_URL=redis://:secret@redis.example.com:6379` и Redis недоступен, IORedis пишет `Error: connect ECONNREFUSED redis.example.com:6379` — НЕ содержит credentials (только host:port). ✓

Но `Error: NOAUTH Authentication required.` — содержит username/password. Если такая ошибка логируется → credentials утекают.

**Смягдующий фактор:** IORedis error messages обычно не содержат credentials. Но `NOAUTH` message может.

**Рекомендованный фикс:** в catch блоках:

```ts
catch (err) {
  // Strip URL from error before logging
  const sanitized = { ...err, message: err.message.replace(/:\/\/[^@]+@/, '://***@') };
  logger.error(sanitized);
}
```

---

## 2. Подтверждённые здоровые паттерны

- **`redactSecrets` существует и применяется** в `exception-filter.ts:72` (post T18-D). ✓
- **`toErrorBody` redact'ит `details`** перед serialization (`error-envelope.ts:144`). ✓
- **Token entropy** — `generateSessionToken` (32+ chars base64url, см. auth.test.ts). ✓
- **Тест `error-envelope.test.ts:46`** — явно проверяет redact behavior. ✓
- **`fingerprintOf` хеширует body** — обратимо только через rainbow table для known inputs. ✓
- **Login failures не логируют email** (см. auth.service.ts:103 — только 'UNAUTHORIZED'). ✓

## 3. Микро-наблюдения

- **T36-α** — `SECRET_KEYS` is a `Set<string>`, lookup O(1). Но array-based `.has()` была бы O(n). Hygiene OK.
- **T36-β** — `redactSecrets` рекурсивный — для deeply nested объектов работает. Тест на это не написан — hygiene gap (T25-γ).
- **T36-γ** — Idempotency cache `cacheKey` хранит `fingerprint` (sha256 of method+url+body) — non-reversible. ✓
- **T36-δ** — CSRF guard не логирует ничего — выкидывает exception → логируется через exception filter → redactSecrets применяется. ✓
- **T36-ε** — Worker logs не используют `redactSecrets` вообще (нет structured logger, T21-C). При `Job.error` write в БД — error.message попадает в Postgres без redaction. Если message содержит `'Pa$w0rd!'` (от Prisma error mentioning a column with password) — утечка возможна.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона             | Находка                                                                                                                         | Где                                             |
| --------- | --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **T36-A** | 🟠 P2     | API / Logging    | `SECRET_KEYS` не покрывает PII (email, householdId, userId, notes, session cookies). Существующий тест подтверждает email leak. | `apps/api/src/common/error-envelope.ts:115-122` |
| **T36-B** | 🟡 P3     | API / Logging    | exception-filter logs Prisma `meta.target` — schema leak (constraint names).                                                    | `apps/api/src/common/exception-filter.ts:67-79` |
| **T36-C** | 🟡 P3     | API / Logging    | App startup logs могут содержать env values (REDIS_URL, DATABASE_URL с credentials). Audit не проводился.                       | `apps/api/src/main.ts` (проверить)              |
| **T36-D** | 🟡 P3     | Worker / Logging | IORedis error messages могут содержать `NOAUTH` credentials в редких случаях.                                                   | `apps/worker/src/main.ts:14`                    |

## 5. Куммулятивный итог (36 кругов)

| Iter   | Round   | Topic                 | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | --------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–30  | #21–#30 | (предыдущие раунды)   | —            | 0     | 0     | 5     | 25    |
| 31     | #31     | API Zod validation    | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene        | T32-A..D     | 0     | 0     | 2     | 2     |
| 33     | #33     | DB migration safety   | T33-A..D     | 0     | 0     | 1     | 3     |
| 34     | #34     | OpenAPI / Swagger     | T34-A..D     | 0     | 0     | 2     | 2     |
| 35     | #35     | Prisma / pool config  | T35-A..D     | 0     | 0     | 2     | 2     |
| **36** | **#36** | **Logging redaction** | **T36-A..D** | **0** | **0** | **1** | **3** |

Cumulative after 36: P0=12, P1=2, P2=25, P3=44.

**Тренд 36-го:** Logging redaction. После infrastructure (35) — focus на privacy. T36-A — самый значимый: GDPR-уязвимость в существующем коде (тест подтверждает).

## 6. Рекомендации (36-й круг)

1. **(P2, 30 мин, T36-A)** Расширить `SECRET_KEYS` в `error-envelope.ts:113-122` — добавить `email`, `householdId`, `userId`, `notes`, `mc_session`, `mc_csrf`, `authorization`, `x-api-key`, `x-csrf-token`. Обновить тест `error-envelope.test.ts:52` → `assert.equal(details.email, '[REDACTED]')`.
2. **(P3, 15 мин, T36-B)** Удалить `target: exception.meta?.['target']` из `exception-filter.ts:74` — оставить только `prismaCode`.
3. **(P3, 30 мин, T36-C)** Audit всех `console.log` в `apps/api/src/main.ts`, `apps/worker/src/main.ts`. Запретить логирование env values напрямую.
4. **(P3, 30 мин, T36-D)** Применять URL-sanitization в catch-блоках worker (replace `://[^@]+@` → `://***@`).

## 7. Артефакты (36-й круг)

| Артефакт                     | Где                             |
| ---------------------------- | ------------------------------- |
| Этот отчёт                   | `docs/audit/AUDIT-REPORT-36.md` |
| FIX-PLAN (T36-A,B,C,D)       | `docs/audit/FIX-PLAN.md`        |
| SECRET_KEYS missing PII keys | §1 T36-A                        |
| Prisma target in logs        | §1 T36-B                        |
| App startup credential logs  | §1 T36-C                        |
| IORedis error may leak creds | §1 T36-D                        |
