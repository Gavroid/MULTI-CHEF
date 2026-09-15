# Технический, продуктовый и UI-аудит MULTI-CHEF (32-й круг)

**Дата:** 2026-09-15
**HEAD:** `c27570e chore(audit): AUDIT-REPORT-31 api-zod-validation`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-31.md`, `FIX-PLAN.md`
**Фокус:** Cookie hygiene — Path scope, TTL, prefix, SameSite=None+Secure coupling.

## TL;DR

32-й круг: **4 находки** — 0 P0, 2 🟠 P2 (cookie hygiene), 2 🟡 P3.

- 🟠 **T32-A** — `mc_session` cookie имеет `Path=/` (хардкод). Cookie отправляется на **все запросы** домена: статика, health, Swagger, manifest. Wasted bandwidth + cookie exposure on debug-endpoints.
- 🟠 **T32-B** — `SESSION_TTL_SECONDS` default = **30 дней** (2 592 000 сек). Если cookie stolen (XSS, MITM) — атакующий имеет месяц доступа. Industry standard — 1-7 дней + sliding window.
- 🟡 **T32-C** — `mc_csrf` / `mc_session` cookies не имеют **`__Host-`** prefix. Без prefix'а subdomain может set cookie для parent domain. Defense-in-depth gap для public deploy.
- 🟡 **T32-D** — `COOKIE_SAMESITE='none'` НЕ валидируется вместе с `COOKIE_SECURE=true`. Если оператор выставит `none` без `secure=true` → browser silently reject. Нет app-level guard.

---

## 1. Технические находки (32-й круг)

### T32-A. `mc_session` Path=/ — cookie на все запросы домена 🟠 P2

**Файл:** `apps/api/src/auth/auth.controller.ts:56, 88-105`.

**Сырой код:**

```ts
// auth.controller.ts:56
const COOKIE_PATH = '/';

// auth.controller.ts:88-94 (setSessionCookie)
(res as CookieReply).setCookie(SESSION_COOKIE, result.sessionToken, {
  httpOnly: true,
  secure: flags.secure,
  sameSite: flags.sameSite,
  path: COOKIE_PATH,    // ← '/'
  maxAge: maxAgeSec,
  ...
});
```

**Проблема:**

Cookie отправляется browser'ом на **каждый запрос** к домену `multichef.lan`, включая:

- `/api/v1/...` — нужен, ✓
- `/health/*` — НЕ нужен (no auth required, health check от monitoring)
- `/icons/icon.svg` — НЕ нужен (static asset)
- `/manifest.webmanifest` — НЕ нужен
- `/sw.js` (service worker) — НЕ нужен
- `/_next/static/*` — НЕ нужен
- Swagger UI `/api/v1/docs` — НЕ нужен (debug page)

**Эффект:**

1. **Wasted bandwidth** — каждый static asset request тащит cookie header (~200 bytes per request). На странице с 50 assets → +10 KB.
2. **Cookie exposure on debug endpoints** — если Swagger UI утечёт через Sentry/logs, в логах видна session cookie value.
3. **CSRF surface** — больше endpoints получают cookie, больше потенциальных target'ов для CSRF (хотя CSRF_COOKIE + double-submit guard защищает, но defense-in-depth).

**Проверка:**

```bash
$ grep "COOKIE_PATH" apps/api/src/auth/auth.controller.ts
const COOKIE_PATH = '/';
```

**Рекомендованный фикс:**

```ts
const COOKIE_PATH = '/api/v1'; // ← ограничить scope
```

Или сделать env-driven:

```ts
const COOKIE_PATH = loadServerEnv().COOKIE_PATH ?? '/api/v1';
```

И обязательно **проверить**, что все контроллеры, которым нужен cookie, живут под `/api/v1`. Все они да, по convention.

**Edge case:** в `middleware.ts` (Next.js) проверяется cookie для SSR routing — `req.cookies.get(SESSION_COOKIE)`. Если cookie Path=/api/v1, browser не отправит cookie на `/` или `/auth/login` → SSR redirect на login не сработает. Решение: SSR запросы на `/` тоже получают cookie (если Path=/), или middleware читает cookie из другого места.

### T32-B. `SESSION_TTL_SECONDS` default = 30 дней 🟠 P2

**Файл:** `packages/config/src/env.schema.ts` (default value), `apps/api/src/auth/auth.service.ts` (TTL enforcement).

**Сырой код:**

```ts
// packages/config/src/env.schema.ts
SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),  // 30 дней
```

**Проблема:**

30 дней = 2 592 000 секунд — это **очень длинный срок жизни сессии**.

**Если cookie stolen** (XSS-баг, MITM, утечка логов):

- 30 дней доступа ко всем данным household'а (pantry, plans, shopping lists, profile).
- Время для обнаружения кражи обычно > 1 день, что съедает значительную часть окна.

**Industry standard:**

- Banking: 5-15 минут idle, max 24 часа absolute.
- Consumer SaaS (Notion, Slack): 30-90 дней для convenience.
- Health/financial-data apps (PRD §GDPR, sensitive): 1-7 дней.

**MULTI-CHEF содержит:**

- Pantry items (household inventory).
- Meal plans (week ahead).
- Shopping lists (recent purchases).
- Profile (email, tz, locale).
- Preferences (love/dislike/allergies).

Не «банковский» уровень sensitivity, но больше, чем «заметки». 7 дней — разумный default.

**Эффект:**

- Удобство: пользователь не логинится каждый месяц. ✓
- Risk: украденная cookie живёт 30 дней.

**Рекомендованный фикс:**

1. **Reduce default** в `env.schema.ts`: `default(7 * 24 * 3600)` = 7 дней.
2. **Sliding window** — обновлять TTL при каждом authenticated request. Если пользователь активен, сессия продлевается. Если 30 дней бездействия — expire.
3. **Refresh token pattern** — короткий access token (15 мин) + long-lived refresh token (7 дней), сохраняемый более безопасно (Secure, httpOnly, __Host- prefix).
4. **Абсолютный max** — даже с sliding window, force re-login через 30 дней (compliance).

**Минимум:** change default + sliding window в `auth.service.ts` — на каждом `getSession` обновлять `expiresAt = now + SESSION_TTL_SECONDS`.

### T32-C. Cookies без `__Host-` prefix 🟡 P3

**Файл:** `apps/api/src/auth/auth.controller.ts:50, 55`.

**Сырой код:**

```ts
export const SESSION_COOKIE = 'mc_session'; // ← no __Host- prefix
export const CSRF_COOKIE = 'mc_csrf';
```

**Проблема:**

`__Host-` prefix (стандарт RFC 6265bis) — browser enforcement:

- Cookie с `__Host-` prefix **ОБЯЗАНА** быть:
  - `Secure` (HTTPS only).
  - Без `Domain` attribute.
  - `Path=/`.
- Browser REJECTS cookie, если любой из этих условий нарушен.

Это **defense-in-depth**: даже если атакующий compromise'нет subdomain (например, blog.multichef.com) и попробует `Set-Cookie: mc_session=evil; Domain=.multichef.com`, browser не пустит — `mc_session` конфликтует с `__Host-mc_session` атрибутами.

**Текущий код:**

`mc_session` не имеет prefix. Subdomain attack'и (cookie injection через XSS на `*.multichef.com`) могут set `mc_session=evil` с `Domain=.multichef.com` → перезапишет оригинальный session cookie.

**Смягчающие факторы:**

- Текущий prod — LAN-only на `192.168.1.95`, нет subdomain.
- `useDomain` skips Domain attribute для IP hosts.

**Рекомендованный фикс:**

1. Переименовать cookie в `__Host-mc_session` и `__Host-mc_csrf` (или `__Secure-mc_csrf` если хочется httpOnly=false + Secure=true).
2. **Но**: при переименовании нужна миграция (старые cookies не будут работать). Plan: deprecate `mc_session` → ввести `__Host-mc_session` одновременно с logout-all.

### T32-D. `COOKIE_SAMESITE='none'` без enforced `COOKIE_SECURE=true` 🟡 P3

**Файл:** `packages/config/src/env.schema.ts` (cookie options), `apps/api/src/auth/auth.controller.ts` (cookie application).

**Сырой код:**

```ts
// env.schema.ts
COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
COOKIE_SECURE: booleanFromString.default(false),
```

**Проблема:**

`SameSite=None` разрешает cross-site cookie (third-party). По спецификации (RFC и Chrome enforcement):

- Если `SameSite=None` → cookie MUST be `Secure=true`.
- Browser silently REJECTS cookie, если условие нарушено.

Текущий код:

- `COOKIE_SAMESITE='none'` + `COOKIE_SECURE=false` (default в dev/test) → browser молча отбрасывает cookie → **тихий failure** — приложение перестаёт работать без объяснений.

**Рекомендованный фикс:**

```ts
// env.schema.ts — добавить refinement
const COOKIE_SAMESITE = z.enum(['lax', 'strict', 'none']).default('lax');
const COOKIE_SECURE = booleanFromString.default(false);

// Cross-field validation
const cookieSchema = z
  .object({
    COOKIE_SAMESITE,
    COOKIE_SECURE,
  })
  .refine((v) => !(v.COOKIE_SAMESITE === 'none' && !v.COOKIE_SECURE), {
    message: 'COOKIE_SAMESITE=none requires COOKIE_SECURE=true',
  });
```

Или runtime check в `cookieFlags()`:

```ts
if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
  throw new Error('cookieFlags: SameSite=None requires Secure=true');
}
```

---

## 2. Подтверждённые здоровые паттерны

- **HttpOnly на `mc_session`** ✓ (не readable from JS).
- **`SameSite` configurable via env** (`COOKIE_SAMESITE`) ✓.
- **`Secure` configurable via env** (`COOKIE_SECURE`) ✓ (post T15 fix).
- **Domain auto-skip для IP hosts** (`useDomain` logic в `cookieFlags()`) ✓.
- **Logout очищает оба cookies** (`mc_session` + `mc_csrf`) ✓.
- **CSRF double-submit pattern** (`mc_csrf` cookie + `X-CSRF-Token` header) ✓.
- **Token entropy**: `generateSessionToken` produces 32+ chars base64url (verified T21-α).

## 3. Микро-наблюдения

- **T32-α** — `cookieFlags()` hardcoded `'Lax' | 'Strict' | 'None'` cast — TypeScript typecheck проходит, но runtime может дать неожиданное значение, если env содержит `'LAX'` или `'lax '` (whitespace). Hygiene: `.toLowerCase().trim()` перед switch.
- **T32-β** — `COOKIE_DOMAIN: z.string().min(1).default('localhost')` — default для прода `'localhost'` неправильный. Должно быть `default(undefined)` или `default('')` — пусть cookie без Domain (default path / host-only).
- **T32-γ** — `maxAge: maxAgeSec` где `Math.max(60, ...)` — min 60 секунд. Защита от отрицательных/нулевых TTL. ✓
- **T32-δ** — Нет **rolling expiration** — TTL фиксируется на момент login. Если пользователь активен, expiresAt не сдвигается. Hygiene: на каждом `getSession` обновлять expiresAt (как в T32-B).
- **T32-ε** — `BOOLEAN` parsing для COOKIE_SECURE — может принять 'false' (string) → false, или '0' → false. Если env содержит 'TRUE' (uppercase) — reject? Зависит от реализации `booleanFromString`.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона           | Находка                                                                                                            | Где                                                                   |
| --------- | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **T32-A** | 🟠 P2     | API / Cookies  | `mc_session` Path=/ — cookie на все запросы домена (статика, health, Swagger). Wasted bandwidth + cookie exposure. | `apps/api/src/auth/auth.controller.ts:56, 88-105`                     |
| **T32-B** | 🟠 P2     | API / Security | `SESSION_TTL_SECONDS` default = 30 дней (2 592 000 сек). Stolen-cookie window = месяц.                             | `packages/config/src/env.schema.ts` (SESSION_TTL_SECONDS default)     |
| **T32-C** | 🟡 P3     | API / Cookies  | `mc_session` / `mc_csrf` без `__Host-` prefix. Subdomain attack возможен (cookie injection).                       | `apps/api/src/auth/auth.controller.ts:50, 55`                         |
| **T32-D** | 🟡 P3     | API / Config   | `COOKIE_SAMESITE='none'` без enforced `COOKIE_SECURE=true` → browser silent rejection, no app-level guard.         | `packages/config/src/env.schema.ts` (COOKIE_SAMESITE + COOKIE_SECURE) |

## 5. Куммулятивный итог (32 кругов)

| Iter   | Round   | Topic                    | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------ | ------------ | ----- | ----- | ----- | ----- |
| 21     | #21     | Worker job lifecycle     | T21-A..D     | 0     | 0     | 2     | 2     |
| 22     | #22     | Web dialog a11y          | T22-A..C     | 0     | 0     | 1     | 2     |
| 23     | #23     | TS validation            | T23-A..C     | 0     | 0     | 1     | 2     |
| 24     | #24     | nginx security headers   | T24-A..D     | 0     | 0     | 3     | 1     |
| 25     | #25     | Test coverage gaps       | T25-A..D     | 0     | 0     | 1     | 3     |
| 26     | #26     | Worker PII/observability | T26-A..C     | 0     | 0     | 0     | 3     |
| 27     | #27     | Infra/deploy pipeline    | T27-A..D     | 0     | 0     | 1     | 3     |
| 28     | #28     | CI/CD coverage           | T28-A..D     | 0     | 0     | 1     | 3     |
| 29     | #29     | Multi-tab cache          | T29-A..C     | 0     | 0     | 1     | 2     |
| 30     | #30     | WCAG / a11y              | T30-A..D     | 0     | 0     | 0     | 4     |
| 31     | #31     | API Zod validation       | T31-A..D     | 0     | 0     | 1     | 3     |
| **32** | **#32** | **Cookie hygiene**       | **T32-A..D** | **0** | **0** | **2** | **2** |

Cumulative after 32: P0=12, P1=2, P2=18, P3=35.

**Тренд 32-го:** cookie hygiene. После API validation (31) — фокус на auth-cookie attributes. T32-A и T32-B самые значимые — Path scope и TTL.

## 6. Рекомендации (32-й круг)

1. **(P2, 30 мин, T32-A)** Сменить `COOKIE_PATH` на `'/api/v1'` (или env-driven). Проверить, что `middleware.ts` (Next.js) всё ещё получает cookie для SSR auth-probe. Если нет — добавить `Domain` attribute или shared `/` path для SSR auth.
2. **(P2, 1ч, T32-B)** Reduce `SESSION_TTL_SECONDS` default до 7 дней. Опционально — sliding window: на каждом `getSession` обновлять `expiresAt`.
3. **(P3, 1ч, T32-C)** Переименовать cookies в `__Host-mc_session` / `__Host-mc_csrf`. Coord с logout-all для миграции.
4. **(P3, 15 мин, T32-D)** Добавить Zod refinement или runtime check: `SameSite=None` → require `Secure=true`.

## 7. Артефакты (32-й круг)

| Артефакт                        | Где                             |
| ------------------------------- | ------------------------------- |
| Этот отчёт                      | `docs/audit/AUDIT-REPORT-32.md` |
| FIX-PLAN (T32-A,B,C,D)          | `docs/audit/FIX-PLAN.md`        |
| Path=/ on session cookie        | §1 T32-A                        |
| 30-day default TTL              | §1 T32-B                        |
| Missing __Host- prefix          | §1 T32-C                        |
| SameSite=None + Secure coupling | §1 T32-D                        |
