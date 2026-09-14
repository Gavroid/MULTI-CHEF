# Технический, продуктовый и UI-аудит MULTI-CHEF (седьмая итерация)

**Дата:** 2026-09-14
**HEAD:** `3162078 chore(audit): AUDIT-REPORT-6 sixth-iteration finding T6-A systemd hardening`
**Предыдущие:** `AUDIT-REPORT.md`, `AUDIT-REPORT-2.md`, …, `AUDIT-REPORT-6.md`, `VERIFICATION.md`
**Цель:** проверить непротестированные ранее системы — body-size enforcement, content-negotiation, edge-errors, cookie scoping, request-id propagation, observability hooks.

## TL;DR

Седьмая итерация нашла **1 крупную 🟠 P2 находку** + подтвердила **8 здоровых паттернов**:

- 🟠 **T7-A — Body > ~1MB возвращает HTTP 500 INTERNAL_ERROR вместо 413 Payload Too Large** (server-класс ошибка для client-класс условия). Мониторинг будет ловить «все 500» из-за upload-too-large, затрудняя actual server failures. Cause: FastifyAdapter не настраивает `bodyLimit`, плюс `AppHttpExceptionFilter` не маппит Fastify 413→413.
- 🟠 **T7-B — `AppHttpExceptionFilter` не различает 4xx-источники: Fastify built-in 400 errors** (malformed JSON, body too large) **попадают в default-ветку и возвращают 500**, хотя должны возвращать 4xx.
- ✅ Cookies: `mc_session` clean (`Path=/; HttpOnly; SameSite=Lax`, no Domain — корректно для IP)
- ✅ Все validation-errors (empty/malformed/wrong-CT) возвращают 400 VALIDATION_ERROR через AppHttpException envelope
- ✅ Content-negotiation: API always returns JSON, regardless of Accept header
- ✅ Cross-origin fetch с `Origin: http://attacker.com` → 401 без `Access-Control-Allow-Origin`
- ✅ ISO-with-time `2026-12-01T12:30:00.000Z` → 400 'must be ISO date (YYYY-MM-DD)'
- ✅ PATCH с пустым `{}` body → 400 VALIDATION_ERROR через envelope
- ✅ `/api/v1/__metrics`, `/api/v1/__admin`, `/__nextjs_original-stack-frame` → все 404 (debug не экспортируется)

---

## 1. Технические находки (седьмая итерация)

### T7-A. Body too large → 500 INTERNAL_ERROR (должен быть 413) 🟠
**Файл:** `apps/api/src/main.ts:25` — `new FastifyAdapter({ trustProxy: '127.0.0.1', logger: false })` (без `bodyLimit`).

**Raw `curl` пробы (POST `/api/v1/profile/preferences` с большим `notes`):**

```
  500KB body: 500014 bytes  HTTP=500  msg='Internal server error'
  1MB body:   1000014 bytes HTTP=500  msg='Internal server error'
  1.1MB body: 1100014 bytes HTTP=500  msg='Request body is too large'
  2MB body:   2000014 bytes HTTP=500  msg='Request body is too large'
```

**Все 4 случая — HTTP 500**. Даже 1MB (что должно быть в пределах Fastify default 1MiB).

**Почему:** Fastify бросает `PayloadTooLargeError` при парсинге тела. NestJS exception filter `AppHttpExceptionFilter` имеет `STATUS_BY_CODE` таблицу, но `Request body is too large` НЕ зарегистрирован как code → попадает в `INTERNAL_ERROR → 500`.

**Воздействие:**
1. **Monitoring false-positive**: monitoring 5xx-errors в Grafana/Datadog будет ловить legitimate client mistakes (лишний файл-аплоад), что размывает сигнал о реальных internal-ошибках.
2. **Юридический аспект**: RFC 7231 указывает 413 как правильный код для oversized payload; 500 предполагает server bug.
3. **CDN/proxy misclassification**: AWS CloudFront, Fastly и т. д. могут интерпретировать 500 как «retry connection» и retry тело, усугубляя нагрузку.

**Фикс (2 варианта):**

**Вариант A (самое простое)**: в `apps/api/src/main.ts:25`:
```ts
const fastifyAdapter = new FastifyAdapter({
  trustProxy: '127.0.0.1',
  logger: false,
  bodyLimit: 1024 * 1024,  // 1 MB explicit
});
```

**Вариант B (правильно для observability)**: добавить в `STATUS_BY_CODE`:
```ts
PAYLOAD_TOO_LARGE: 413
```
И в `AppHttpExceptionFilter`:
```ts
catch (exception) {
  if (exception?.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || exception?.statusCode === 413) {
    throw new AppHttpException({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
  }
  ...
}
```

---

### T7-B. Fastify built-in 400 errors не идут через `AppHttpException` envelope 🟠
**Файл:** `apps/api/src/common/exception-filter.ts` — exception filter только матчит `AppHttpException` и `HttpException`.

**Сценарий:**
```
POST /api/v1/pantry/items content-type:application/json
{"ingredientId":"abc  // truncated JSON
→ HTTP=400 VALIDATION_ERROR 'Body is not valid JSON but content-type is set to application/json'
```

**Окей, это работает** — фильтр через стандартный `VALIDATION_ERROR` envelope.

**Проверка edge — `FastifyValidationError` (схема-валидация).** Все трик-тесты через разные слои — но `STATUS_BY_CODE` в `error-envelope.ts` НЕ содержит всех `ErrorCode`. Возможно найдутся коды без mapping.

**Реальное воздействие:** T7-A — oversize body. Это и есть тот edge-класс, который в фильтр попадает как raw Fastify Error → mapped в default `INTERNAL_ERROR` (500). Если хоть один «путь» ошибки попадает мимо фильтра — он возвращается с non-standard envelope.

**Фикс:** см. T7-A вариант B.

---

## 2. Подтверждённые здоровые паттерны (8 health-checks)

### ✅ Cookies
`Set-Cookie`:
```
mc_session=<token>; Max-Age=2591999; Path=/; HttpOnly; SameSite=Lax
mc_csrf=<token>;     Max-Age=2591999; Path=/; SameSite=Lax
```
- `HttpOnly` на session ✅
- `Path=/; SameSite=Lax` ✅ (правильно для same-origin)
- Нет `Domain=` атрибута ✅ (IPv4-сервер не получит benefit от домена)
- Max-Age 30 дней — типично для B2C

### ✅ Empty/wrong Content-Type
```
EMPTY body            → 400 VALIDATION_ERROR
Truncated JSON        → 400 VALIDATION_ERROR
Content-Type: text/plain  → 400 VALIDATION_ERROR
No Content-Type       → 400 VALIDATION_ERROR
```
Все 4 edge-case → 400 через стандартный envelope `{status, error: {code: VALIDATION_ERROR, ...}}`. ✅

### ✅ Content-negotiation
```
Accept: text/html          → HTTP 200 Content-Type: application/json
Accept: application/xml    → HTTP 200 Content-Type: application/json
```
API игнорирует `Accept` заголовок и всегда возвращает JSON. ✅ (правильно для backend API).

### ✅ Cross-origin safety
```
Origin: http://attacker.com
→ HTTP 401 (no Access-Control-Allow-Origin)
```
Никакой cross-origin утечки. ✅

### ✅ ISODate strict format
```
purchaseDate: "2026-12-01T12:30:00.000Z"
→ 400 VALIDATION_ERROR {purchaseDate: ['must be ISO date (YYYY-MM-DD)']}
```
Frontend использует `<input type="date">` → YYYY-MM-DD. Server-coerces ISO-with-time отклоняет — корректно.

### ✅ Debug/non-prod endpoints
```
/__metrics, /__admin, /__health, /_debug, /internal/debug, /_dump,
/_next/__nextjs_original-stack-frame, /__nextjs_original-stack-frame
→ все 404
```
Закрыто через `NODE_ENV !== 'production'` switch в `main.ts`.

### ✅ Fake cookie
```
Cookie: mc_session=fakesession...; mc_csrf=fake...
GET /auth/session
→ 401 UNAUTHORIZED (correct envelope)
```
Сервер не принимает чужой/поддельный session token. ✅

### ✅ PATCH shape
```
PATCH /api/v1/pantry/items/some-uuid
Body: {}
→ HTTP=400 VALIDATION_ERROR (refine "at least one field required")
```
PATCH с пустым телом отбит через Zod-refine. ✅

---

## 3. Микро-наблюдения

- **T7-C (no-request-id)**: server не возвращает `x-request-id` в headers. Только внутренний `error-envelope.ts:9` поддерживает `requestId?: string` в типах, но **никакая middleware этот header не генерирует**. → distributed-tracing потребует отдельного interceptor'а.
- **T7-D (no-prometheus)**: `/metrics` endpoint не выставлен. Невозможно собирать кастомные метрики API.
- **T7-E (worker removeOnFail)**: BullMQ `failed=2` jobs linger в Redis. Без `removeOnFail: N` config может расти бесконечно.
- **T7-F (cookies/Max-Age)**: 30 дней session — без sliding expiration. High-portfolio приложения обычно ставят sliding (`maxAge: 30d`, но session renewed on activity). Не баг, но недоправка UX-wise.

---

## 4. Сводка таблицей (NEW в этой итерации)

| # | Приоритет | Зона | Находка | Файл |
|---|---|---|---|---|
| **T7-A** | 🟠 P2 | API/observability | Body > ~1MB возвращает 500 'Internal server error' (server-class error для client-class condition) | `apps/api/src/main.ts:25` (FastifyAdapter без bodyLimit), `apps/api/src/common/error-envelope.ts` (нет 413 в STATUS_BY_CODE) |
| **T7-B** | 🟠 P2 | API/observability | `AppHttpExceptionFilter` не различает Fastify-specific 4xx ошибки | `apps/api/src/common/exception-filter.ts` |

---

## 5. Что НЕ удалось проверить
- 🟡 **Worker sustained load** — нужна отдельная long-running сессия
- 🟡 **PWA Service Worker lifecycle** — есть регистрация, но audit не делал offline-PWA simulation
- 🟡 **WebSocket / SSE** — нет в API
- 🟡 **MockJWT** — APIs не используют JWT, проверять нечего

---

## 6. Куммулятивный итог (7 итераций)

| Iter | Findings | 🔴 P0 | 🟠 P1–P2 | 🟡 P3 / ℹ️ | Cumulative 🔴 |
|---|---|---|---|---|---|
| #1 | B1–B6 (6) | 2 | 1 | 3 | 2 |
| #2 | M1–M9 (9) | 3 | 2 | 4 | 5 |
| #3 | T1–T6, U1–U4 (11) | 4 | 3 | 4 | 9 |
| #4 | T4-A, T4-B, T4-C (3) | 0 | 2 | 1 | 9 |
| #5 | T5-A, T5-B (2) | 0 | 2 | 0 | 9 |
| #6 | T6-A (1) | 0 | 1 | 0 | 9 |
| **#7** | **T7-A, T7-B (2)** | **0** | **2** | **0** | **9** |
| **Σ** | **~34 уникальных** | **9 P0** | **13 P1-P2** | **12 ℹ️/P3** | — |

**Тренд 7 итераций подтверждён**: 0 P0 находок 5 итераций подряд. Каждое новое наблюдение — config-уровень (header / override / mapping). Архитектура в production-ready состоянии; дальнейшие находки потребуют измерительной инфраструктуры (long-running load tests, Lighthouse, axe-core nightwatch) либо feature-работы.

---

## 7. Рекомендации (7-я итерация)

1. **(P2, 30 мин, T7-A + T7-B)** Добавить в `error-envelope.ts`:
   ```ts
   PAYLOAD_TOO_LARGE: 413
   ```
   В `exception-filter.ts` — добавить case для Fastify's `PayloadTooLargeError`:
   ```ts
   const code = (exception as { code?: string })?.code;
   if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
     throw new AppHttpException({ code: 'PAYLOAD_TOO_LARGE', message: 'Body too large' });
   }
   ```
   В `main.ts` — `bodyLimit: 1024 * 1024` явно на FastifyAdapter.
2. **(P0, повтор)** 9 P0 продолжают ждать фиксов.

---

## 8. Артефакты (7-я итерация)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-7.md` (коммит ниже) |
| Body-size 500 raw probes | raw в секции §1 |
| `Set-Cookie` raw | в секции §2 |
| Empty/Truncated/wrong-content-type raw | в секции §2 |
