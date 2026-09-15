# Технический, продуктовый и UI-аудит MULTI-CHEF (24-й круг)

**Дата:** 2026-09-15
**HEAD:** `cffe4b4 chore(audit): AUDIT-REPORT-23 ts-validation`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-23.md`, `FIX-PLAN.md`
**Фокус:** nginx + app-level security headers / rate limits / TLS hardening.

## TL;DR

24-й круг: **4 находки** — 0 P0, 3 🟠 P2 (security hygiene), 1 🟡 P3.

- 🟠 **T24-A** — nginx SSL protocols включают `TLSv1` и `TLSv1.1` (оба deprecated с RFC 8996 / 2021). Потенциальные MITM downgrade-атаки.
- 🟠 **T24-B** — нет `X-Frame-Options` / `Content-Security-Policy: frame-ancestors` в nginx + API. Clickjacking остаётся возможным (не критично для P0 потому что `SameSite=Lax`, но стоит закрыть).
- 🟠 **T24-C** — web frontend (Next.js) не отдаёт CSP. `@fastify/helmet` на API ставит CSP только в production, web — без CSP. XSS-surface открыт.
- 🟡 **T24-D** — per-endpoint throttling настроен только на `AuthController` (10/min). Дорогие endpoints (`/meal-plans/generate`, `/recommendations/*`, `/shopping-lists/:id/complete`) под глобальным 300/min — авторизованный пользователь может spam-ить planning jobs (CPU/IO).

---

## 1. Технические находки (24-й круг)

### T24-A. nginx разрешает TLSv1 / TLSv1.1 (deprecated) 🟠 P2

**Файл:** `/etc/nginx/nginx.conf:31-35` (глобально для всех server-blocks, включая multichef 8443).

**Сырой код:**

```nginx
##
# SSL Settings
##
ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3; # Dropping SSLv3, ref: POODLE
ssl_prefer_server_ciphers on;
```

Проблема:

- **TLSv1.0** — формально deprecated с RFC 8996 (март 2021), реально небезопасен (BEAST, POODLE follow-ups).
- **TLSv1.1** — то же.
- Современные клиенты (Chrome 90+, Firefox 86+, Safari 14+) уже не поддерживают TLS<1.2; **их доля трафика ≈ 99%** — реальной совместимости эти протоколы не дают, но расширяют attack surface.

Multichef cert — self-signed на LAN (192.168.1.95), но при переезде на публичный домен (Let's Encrypt) конфиг не меняется → открытый TLS<1.2 на проде.

**Проверка:**

```bash
$ ssh root@192.168.1.95 'grep ssl_protocols /etc/nginx/nginx.conf'
ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;
```

Внешняя проверка (если есть публичный IP — но у нас LAN-only):

```bash
$ nmap --script ssl-enum-ciphers -p 8443 multichef.lan   # покажет ACCEPTED протоколы
```

**Рекомендованный фикс:**

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
```

Опционально добавить `ssl_session_cache shared:SSL:10m; ssl_session_timeout 1d;` для производительности.

### T24-B. nginx не отдаёт X-Frame-Options / frame-ancestors 🟠 P2

**Файл:** `/etc/nginx/sites-enabled/multichef.conf` (http :8080 и TLS :8443 server-blocks).

**Сырой код (http :8080):**

```nginx
server {
    listen 8080;
    ...
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # ← нет X-Frame-Options, нет CSP: frame-ancestors
    location /api/ { ... }
    location /images/ { ... }
    location / { ... }
}
```

**TLS :8443:** аналогично, плюс HSTS.

**Что упущено:**

1. **`X-Frame-Options: DENY`** (или `SAMEORIGIN` если встроенные iframe нужны).
2. **`Content-Security-Policy: frame-ancestors 'none'`** (заменяет X-Frame-Options в современных браузерах).

Без этих заголовков атакующий может embed'ить приложение в `<iframe>` на своём сайте и провести clickjacking (например, скрытый «удалить из плана» или «купить» под кнопкой «смотреть кота»).

**Смягчающий фактор:** `mc_session` cookie — `SameSite=Lax` (см. `apps/api/src/auth/auth.controller.ts:4-9` комментарий). Lax не отправляет cookie в cross-site iframe-initiated request'ах → clickjacked mutation не сработает. Но GET-запросы (например, `/api/v1/profile` через `<img src=>`) утекут. Это **data-exfiltration через side-channel**, не clickjacking.

**Рекомендованный фикс:** добавить в оба server-block'а nginx:

```nginx
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
```

`Content-Security-Policy` для API-ответов имеет смысл минимальный (там нет HTML, но CSP влияет на весь ответ). Альтернативно — задать CSP только в web-app (см. T24-C).

### T24-C. Web frontend (Next.js) без Content-Security-Policy 🟠 P2

**Файл:** `apps/web/src/app/layout.tsx` (нет CSP-meta, нет `headers()` export'а).

**Сырой код (проверка):**

```bash
$ grep -rn "Content-Security-Policy\|X-Frame-Options" apps/web/ 2>/dev/null
# (пусто — нет ни одного CSP/X-Frame-Options в web)
```

```bash
$ grep -rn "export const headers\|next.config.*headers" apps/web/ 2>/dev/null
# (пусто — нет Next.js headers config)
```

**Что это значит:**

- API ставит CSP через `@fastify/helmet` (production only) — `apps/api/src/main.ts:35-40`. Но это CSP **для API-ответов**, не для SSR HTML Next.js.
- Next.js страницы (`/today`, `/fridge`, `/plan` …) — HTML приходит **мимо CSP**: nginx их проксирует (location `/` → 127.0.0.1:3000), но nginx не ставит CSP.
- Если SSR HTML содержит `dangerouslySetInnerHTML` или React уязвим (history показывает несколько CVE в React Server Components), XSS payload выполнится с full privileges.

**Смягчающие факторы:**

- `mc_session` HttpOnly + SameSite=Lax → session-stealing через XSS не сработает.
- React 18+ по умолчанию экранирует все интерполяции (нет `dangerouslySetInnerHTML` в коде по моему grep).

Но **defense-in-depth требует CSP**: даже если завтра кто-то использует `dangerouslySetInnerHTML` (для markdown, для recipe instructions), CSP заблокирует inline script.

**Проверка — реальный SSR response:**

```bash
$ curl -sI http://127.0.0.1:3000/ | grep -i "content-security\|x-frame\|x-content"
# (пусто — подтверждение: нет security headers в Next.js response)
```

**Рекомендованный фикс:**

1. **Next.js config-based:** `apps/web/next.config.ts` добавить:
   ```ts
   async headers() {
     return [{
       source: '/(.*)',
       headers: [
         { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.unsplash.com; connect-src 'self' https://api.multichef.lan; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" },
         { key: 'X-Frame-Options', value: 'DENY' },
         { key: 'X-Content-Type-Options', value: 'nosniff' },
         { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
       ],
     }];
   }
   ```
2. Альтернатива — через nginx `add_header` на `location /`. Но nginx добавляет header всегда, а Next.js может переписать — поэтому config-based надёжнее.

Замечание: `'unsafe-inline'` для script нужен только если используется styled-components или критичный inline script. Если всё через external CSS/JS, можно убрать. Для Next.js App Router + Tailwind — обычно OK без inline-script (за исключением `themeInitScript` в layout.tsx:45-53, который inline!). Чтобы не сломать theme-restore:

- либо nonce-based CSP (сложнее)
- либо вынести themeInitScript в external `/theme-init.js` (правильнее)

### T24-D. Нет per-endpoint throttling для дорогих endpoints 🟡 P3

**Файл:** `apps/api/src/app.module.ts:31-37` (глобальный throttler), `apps/api/src/auth/auth.controller.ts:128` (только AuthController имеет @Throttle).

**Сырой код:**

```ts
// app.module.ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
// ...
{ provide: APP_GUARD, useClass: ThrottlerGuard },

// auth.controller.ts:128
@Throttle({ default: { ttl: 60_000, limit: 10 } })  // только login/register/logout
```

**Проверка — где есть @Throttle:**

```bash
$ grep -rn "@Throttle\|@ThrottlerSkip" apps/api/src/ | grep -v __tests__
apps/api/src/app.module.ts:32:    // it to 10/min via @Throttle on AuthController
apps/api/src/app.module.ts:58:    // can opt out with @ThrottlerSkip().
apps/api/src/auth/auth.controller.ts:128:@Throttle({ default: { ttl: 60_000, limit: 10 } })
```

Глобальный limit — **300/min per IP**. Для авторизованного пользователя 300 запросов в минуту — это:

- `/meal-plans/generate` (запускает planning job, читает recipes+pantry+preferences, runs planner → 1-3s CPU + DB load) × 300/min = **5 jobs/sec sustained load**.
- `/recommendations/today` (sync, < 500ms по контракту, но реально 200-800ms с DB) × 300/min = sustained 5 rps.
- `/shopping-lists/:id/complete` (bulk pantry write в транзакции) × 300/min = sustained 5 bulk writes/sec.

Авторизованный пользователь теоретически может устроить DoS на собственный backend (исчерпать CPU worker'а, насытить Postgres connection pool). Злонамеренный пользователь (compromised account) — может устроить реальный DoS.

**Рекомендованный фикс:** per-endpoint `@Throttle` для:

- `@Throttle({ default: { ttl: 60_000, limit: 5 } })` на `/meal-plans/generate` (1 план в 12 сек — человек так не планирует).
- `@Throttle({ default: { ttl: 60_000, limit: 30 } })` на `/recommendations/*` (sync endpoints, дешевле).
- `@Throttle({ default: { ttl: 60_000, limit: 10 } })` на `/shopping-lists/:id/complete`.

Хорошая практика: `@Throttle` ставится на controller class (для всего контроллера) — DRY.

---

## 2. Подтверждённые здоровые паттерны

- **app-level throttling есть** (`@nestjs/throttler`, 300/min глобально + 10/min auth) — в отличие от многих проектов, здесь есть rate-limit.
- **CSRF double-submit** (`mc_csrf` cookie + `X-CSRF-Token` header) — проверяется `CSRF_GUARD_PROVIDER` глобально. См. `app.module.ts:63`.
- **Idempotency-Key guard** (`IdempotencyKeyGuard`) — глобальный guard на все мутации. Уже реализован.
- **HttpOnly + SameSite=Lax cookie** (`mc_session`) — XSS-устойчивая сессия.
- **`server_tokens off`** в `/etc/nginx/nginx.conf:18` — nginx версия не палится в ответах.
- **Self-signed cert для LAN** — норма для dev, будет заменён на Let's Encrypt при выходе в публичный домен (TODO в комментарии).

## 3. Микро-наблюдения

- **T24-α** — `apps/api/src/main.ts:30` комментарий «X-Forwarded-For is not trusted for rate-limit IP extraction» — **throttler берёт IP из `req.ip` (Fastify default)**, но без `trustProxy: true` в Fastify → если за reverse-proxy, `req.ip` будет `127.0.0.1`. Hygiene: добавить `app.setTrustProxy('loopback')` если трафик всегда идёт через nginx.
- **T24-β** — нет `Strict-Transport-Security` на :8080 — корректно (HTTP), но при переключении домена на HTTPS-only это надо закрыть в nginx.
- **T24-γ** — `add_header X-Content-Type-Options nosniff` и `Referrer-Policy` — есть. **`Permissions-Policy`** — есть, но без `payment=()`, `usb=()`. Hygiene: добавить полный набор (свежие best practices).
- **T24-δ** — nginx `client_max_body_size 10m` — приемлемо для image upload, но `/api/meal-plans/generate` без body не нуждается. Можно отдельный лимит на `location /api/`.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона             | Находка                                                                                                 | Где                                                                 |
| --------- | --------- | ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **T24-A** | 🟠 P2     | nginx / TLS      | `ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3` — TLSv1/1.1 deprecated (RFC 8996).                        | `/etc/nginx/nginx.conf:34`                                          |
| **T24-B** | 🟠 P2     | nginx / Headers  | Нет `X-Frame-Options`, нет `Content-Security-Policy: frame-ancestors`. Clickjacking остаётся возможным. | `/etc/nginx/sites-enabled/multichef.conf` (оба server-блока)        |
| **T24-C** | 🟠 P2     | Web / CSP        | Next.js frontend не отдаёт CSP / X-Frame-Options. XSS-surface открыт.                                   | `apps/web/src/app/layout.tsx`, отсутствует `next.config.ts` headers |
| **T24-D** | 🟡 P3     | API / Throttling | Нет per-endpoint @Throttle на дорогие endpoints (`/meal-plans/generate`, `/recommendations/*`, …).      | `apps/api/src/app.module.ts:31-37` (только auth имеет @Throttle)    |

## 5. Куммулятивный итог (24 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3        | 🟡 ℹ️ | Cumulative                   |
| ------- | ------------------- | ----- | ----- | --------------- | ----- | ---------------------------- |
| #1–3    | 26                  | 9     | 0     | 6               | 11    | —                            |
| #4–10   | 13                  | 0     | 0     | 13              | 0     | —                            |
| #11     | T11-A, T11-B        | 0     | 0     | 2               | 0     | —                            |
| #12     | T12-A               | 0     | 0     | 1               | 0     | —                            |
| #13     | T13-A               | 1 P0  | 0     | 0               | 0     | 10 P0                        |
| #14     | T14-A               | 0     | 0     | 1               | 0     | 10 P0                        |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1               | 0     | 11 P0                        |
| #16     | T16-A, T16-B        | 0     | 0     | 2               | 0     | 11 P0                        |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0               | 0     | 11 P0, 2 P1                  |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 11 P0, 2 P1, 2 P2            |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2            | 0     | 11 P0, 2 P1, 4 P2            |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2            | 0     | 12 P0, 2 P1, 6 P2            |
| #21     | T21-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 12 P0, 2 P1, 8 P2, 4 P3      |
| #22     | T22-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 9 P2, 6 P3      |
| #23     | T23-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 10 P2, 8 P3     |
| **#24** | **T24-A–D**         | **0** | **0** | **3 P2 + 1 P3** | **0** | **12 P0, 2 P1, 13 P2, 9 P3** |

**Тренд 24-го:** infrastructure. После UI/типов (22/23) — nginx + web frontend hardening. Все P2, не критично, но каждая находка — реальный security-hygiene gap, который надо закрыть до публичного домена.

## 6. Рекомендации (24-й круг)

1. **(P2, 5 мин, T24-A)** В `/etc/nginx/nginx.conf:34` заменить `ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3` на `ssl_protocols TLSv1.2 TLSv1.3`. `nginx -t && systemctl reload nginx`.
2. **(P2, 15 мин, T24-B)** В `/etc/nginx/sites-enabled/multichef.conf` добавить `add_header X-Frame-Options "DENY" always;` в оба server-блока. Перезагрузить nginx.
3. **(P2, 1ч, T24-C)** В `apps/web/next.config.ts` (или новый `apps/web/src/middleware.ts`-augmentation) добавить `Content-Security-Policy` header для всех SSR-ответов. Либо вынести `themeInitScript` из layout.tsx в external `/theme-init.js` (правильнее — никакого inline JS).
4. **(P3, 30 мин, T24-D)** Добавить `@Throttle({ default: { ttl: 60_000, limit: 5 } })` на `MealPlansController.generate`, `@Throttle({ default: { ttl: 60_000, limit: 30 } })` на `RecommendationsController`, `@Throttle({ default: { ttl: 60_000, limit: 10 } })` на `ShoppingListsController.complete`.

## 7. Артефакты (24-й круг)

| Артефакт                           | Где                             |
| ---------------------------------- | ------------------------------- |
| Этот отчёт                         | `docs/audit/AUDIT-REPORT-24.md` |
| FIX-PLAN (T24-A,B,C,D)             | `docs/audit/FIX-PLAN.md`        |
| nginx `ssl_protocols`              | §1 T24-A                        |
| nginx headers (отсутствие X-Frame) | §1 T24-B                        |
| Next.js CSP (отсутствие)           | §1 T24-C                        |
| `@Throttle` coverage               | §1 T24-D                        |
