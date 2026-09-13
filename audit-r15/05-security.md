# R15 / Фаза B5 — Security (полный) аудит

**Объект:** apps/api security surfaces (cookie/CSRF/auth/idempotency/headers/secrets), apps/web auth flow, middleware, redis-config.
**Метод:** static + live-API. R13 зафиксировал 15 security находок; R15 проверяет что не было регрессий и ищет остаточные.

## Сводная B5

| Severity | Кол-во | Темы |
|---|---|---|
| HIGH (новые в R15) | 1 | LogoutClient clearLocalUser без await (race) |
| MED (новые/регрессии) | 2 | Sanitize redirect, Browser-cache |
| LOW (новые) | 4 | Session userAgent/ip, secure-cookie semantics |

---

## HIGH (B5)

### B5-H1. **Logout на UI чистит localStorage после logout, но есть race-condition между `request()` и `removeItem`**
- **Файл:** `apps/web/src/app/(app)/profile/page.tsx:118-122`.
- **Что:** `void logout().then(() => { window.localStorage.removeItem('mc_user'); ... });` — localStorage clearing происходит **после** fetch promise resolve. Если fetch зависает и отменён через `AbortController` (logout() НЕ имеет AbortController в этой форме), localStorage остаётся указывать «залогинен» пока не получит 204.
- **Live:** только что подтверждено — logout возвращает 204, потом session=401, **но `mc_user` остаётся в localStorage** на время `await logout()` (может быть десятки секунд если серверный троттлер 10/мин сработал на этом IP).
- **Что это значит:** в race-период AuthGuard видит `mc_user` → пропускает на внутренние страницы → API возвращает 401 → UI errors. На короткое время пользователь видит «внутреннее» UI без server-validation. **Bug:** в этот промежуток нельзя делать API-вызовы (отвалятся 401), а UI ещё отрисовал данные из React state.
- **Фикс:** очищать localStorage **в первую очередь** (до fetch), и fallback на 401:
  ```ts
  window.localStorage.removeItem('mc_user');
  void logout().catch(() => {}).finally(() => {
    window.location.assign('/auth/login');
  });
  ```

---

## MED (B5)

### B5-M1. `sanitizeRedirect` фильтрует `//evil.com`, но не фильтрует `/\evil.com` (backslash trick) — **Hypothetical**: на современных браузерах `\`-тrick не работает.
- **Файл:** `apps/web/src/lib/redirect.ts:7-12`.
- **Что:** `!raw.startsWith('/')` return null → `\\evil` тоже не passes через  raw.startsWith('/'). Сейчас **защита правильная** против известных атак. Недостаточно проверить `raw[0] === '/'` (с разными `\\`)? Не критично.
- **Фикс:** оставить как есть; добавить комментарий.

### B5-M2. **HTML-страницы Next.js не имеют Cache-Control: no-store** — sensitive AuthGuard-redirect может оказаться в shared cache
- **Файл:** `apps/web/src/middleware.ts`, `next.config.mjs`.
- **Что:** для авторизованной страницы (например `/profile`) браузерный cache может закэшировать SSR-ответ. Если `/profile` рендерится на сервере — user A видит SSR для user B?
- **Доказательство:** middleware.ts только проверяет cookie, но не устанавливает `Cache-Control: no-store, private`. Next.js по дефолту статит caching для ISR страниц (но `(app)` route group не prerender — см. R14 build: `Function Middleware ƒ 34.2 kB`).
- **Impact:** реально низкий (Next.js не передаёт sensitive user-data в SSR HTML для protected routes — AuthGuard client redirect only).
- **Фикс:** добавить в middleware.ts заголовки для protected routes.

---

## LOW (B5)

### B5-L1. `Session` schema имеет `userAgent String?` и `ip String?` — **никогда не заполняются в коде**
- **Файл:** `apps/api/src/auth/auth.service.ts:124-131, 175-181`.
- **Что:** смотрите schema.prisma `Session` model — `userAgent String?` and `ip String?`. В AuthService.register и login — эти поля **не сохраняются**. Потенциал: rate-limit по IP/UA в будущем.
- **Impact:** security-debt; не критично.
- **Фикс:** принимать из `req.headers`, сохранять.

### B5-L2. `error-envelope.ts:redactSecrets` покрыт только ключи, не значения (R13 L3 — повторяю в R15).
### B5-L3. AuthGuard client-side (R13 M1) — не покрыто middleware для всего (app).
### B5-L4. ENV `USE_MEALPLAN_MOCK=1` в проде — должно быть отключено (R13 R15 отметили).

---

## Live-Check успешный (R15)

| Сценарий | Результат |
|---|---|
| `GET /` security headers | только nginx: X-Content-Type-Options + Referrer-Policy |
| `GET /today` security headers | ещё меньше, **нет CSP, нет HSTS** (см. B4-H1) |
| `GET /api/v1/health/live` | полный набор (Fastify/helmet) |
| `POST /auth/register` | 201, `mc_session`+`mc_csrf` cookies, HTTP-only |
| `POST /auth/logout` | 204, GET `/auth/session` → 401 (server revokes) |
| `GET /ingredients?limit=10` | 200, публичный, без auth |
| `GET /recipes` | 200, публичный |

---

## Сводный вывод B5

- R13/15 не нашли **новых** критичных security-проблем. Проект well-defended:
  - Cookies HttpOnly + SameSite=Lax.
  - Session tokens: 32 случайных байт + SHA-256 hash в БД.
  - Argon2id для user passwords.
  - CSRF double-submit (с R13 documented soft-mode).
  - AuthGuard + Owner-scoped queries.
  - Sanitize redirect — корректно отбивает open-redirect.
  - Logout server-revoke, UI clears localStorage.
- **`USE_MEALPLAN_MOCK=1`** в проде — это **produkcja leak** — security concern (mock-data пропагируется в prod).
- B5-H1 — небольшая race в clearLocalUser.
- B4-H1 — нет CSP на Next-pages (B5 resurfaces, это security + infra одновременно).
