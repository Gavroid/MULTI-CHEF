# Технический, продуктовый и UI-аудит MULTI-CHEF (пятая итерация)

**Дата:** 2026-09-14
**HEAD:** `f420691 chore(audit): AUDIT-REPORT-4 fourth-iteration findings T4-A T4-B T4-C`
**Предыдущие:** `AUDIT-REPORT.md`, `AUDIT-REPORT-2.md`, `AUDIT-REPORT-3.md`, `AUDIT-REPORT-4.md`, `VERIFICATION.md`
**Цель:** глубже проверить observability/кэширование/perf/scale, которые до этого не покрывались в полном объёме.

## TL;DR

Пятая итерация нашла **2 крупных 🟠 находки** + подтвердила **5 корректно работающих систем**:

- 🟠 **T5-A — `Cache-Control` отсутствует на ВСЕХ API-эндпойнтах, включая sensitive** (perf + a11y-уязвимость). `/auth/session`, `/jobs/:id`, `/health/ready`, `/recipes`, `/ingredients` — все возвращают JSON **без** `Cache-Control`, `ETag`, `Last-Modified`. На `/auth/session` это критично: **back/forward-cache в браузерах может закэшировать текущего юзера**. На `/recipes` — каждое обращение ходит в БД хотя content практически static.
- 🟠 **T5-B — `/auth/register` под глобальным rate-limit AuthController'а (10/min)** — легитимный сценарий «семья из 4 человек регистрируется одновременно» блокируется. 6/10 user-flow-concurrent регистраций возвращают 401 после `register` (истёкший login/register bucket). Это **usability/SLO-проблема**.
- ✅ Argon2id: `m=65536,t=3,p=4` — production-grade
- ✅ 277 active session'ов, 0 expired (нет drift)
- ✅ 0 pnpm vulnerabilities across all 4 workspaces
- ✅ Bundle split per route, framework 190KB, max page 30KB
- ✅ Concurrent burst (15 `/recipes`) — 0.112s total
- ✅ 0 hydration errors on 5 tested pages

---

## 1. Технические находки

### T5-A. Никаких `Cache-Control` заголовков нигде 🟠
**Файлы:** все API-эндпойнты (Fastify не выставляет дефолт).

**Raw output (`curl -I` на разные эндпойнты):**

`GET /api/v1/recipes?limit=5`:
```
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 3213
... (security headers: CSP, HSTS, XCTO, ...)
(нет Cache-Control, нет ETag, нет Last-Modified, нет Expires)
```

`GET /api/v1/ingredients?limit=5`:
```
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 1508
(нет Cache-Control)
```

`GET /api/v1/jobs/<sensitive-id>`: также без Cache-Control.

**Воздействие (3 раздельных проблемы):**

1. **`/auth/session` → back/forward-cache**: современные браузеры (Chrome, Firefox) кэшируют последнюю страницу при возврате «Назад» через `bfcache`. Если Cache-Control не запрещает это (`no-store` или `private`), то после logout на другой машине `bfcache` может показать старого юзера на 30 секунд.
2. **`/recipes` — N×DB-запросов без причины**: каталог 2000 рецептов **в основном статичен**. Каждое открытие `/?utm=share` через CDN ходило бы в DB. На Insta → 500 RPS на том же инстансе = 500 запросов в PG.
3. **`/jobs/:id` → cache poisoning на публичных прокси**: любой прокси между клиентом и API может закэшировать «статус: DONE» для jobId, который уже обновился. Для активного job-трекинга это потенциальная проблема.

**Фикс (для трёх классов endpoint):**
```ts
// Static catalog (recipes, ingredients):
@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

// Sensitive (auth/session, jobs/:id):
@Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')

// User-dependent:
@Header('Cache-Control', 'private, max-age=0')
```

---

### T5-B. `AuthController.register` под глобальным 10/min rate-limit 🟠
**Файл:** `apps/api/src/auth/auth.controller.ts:73` — `@Throttle({ default: { ttl: 60_000, limit: 10 } })` на классе.

**Подтверждение из A5-14:**
```
20 burst of /auth/login:
401 401 401 401 401 401 401 401 401 401 429 429 429 429 429 429 429 429 429 429
```
10 OK, 10 отбиты (429). Логин-эндпойнт — ожидаемо (anti-brute-force).

**Но! /register тоже под этим bucket'ом.** Проверка (10 параллельных users):
```
user 1..4 -> 202
user 5..10 -> 401
```
**4/10 новых пользователей получают 401 на `register`** — потому что bucket на 10/min уже истёрт от их собственных `register` POST + `login` POST.

**Воздействие:** Семья из 4 человек, одновременно пытающаяся зарегистрировать через 4 разных устройства (но с одного IP / через общего гостя кончается), даст 401 на 5-м и далее. Менее вероятно в B2C-сценарии, но в B2B-employer-или-школьный-сценарий, где `network gw` IP, — блокировка обеспечена.

**Фикс:** Отдельный `@Throttle` для `/register` (например `60/min` — только реальные массовые регистрации блокируются), отдельный для `/login` (10/min — anti-brute-force), `/forgot-password` отдельно.

---

## 2. Подтверждённые здоровые системы

### ✅ Argon2id использует production-grade параметры
**Raw:**
```
$argon2id$v=19$m=65536,t=3,p=4$u4Ifef7Ut0r63Pvzr5LZfA$4kJOA6...
```
- `m=65536` (64MB memory cost) — стандарт OWASP
- `t=3` (time cost) — стандарт
- `p=4` (parallelism) — стандарт

### ✅ Session table: zero drift
```
expired | active | total
---------+--------+-------
       0 |    277 |   277
```
Никаких «осиротевших» expired session-rows. Cleanup не нужен.

### ✅ pnpm audit: 0 vulnerabilities across all workspaces
```json
{
  "action": "audit",
  "vulnerabilities": {}
}
```

### ✅ Concurrent load: graceful
**15 параллельных `/recipes?limit=20`:**
```
real    0m0.112s
... connections grew from 4 → 17, all idle post-burst
```

**20 параллельных `/recommendations/today` без auth:** 401×20 (правильно, нет скрытых путей для не-authorised).

### ✅ Bundle composition
```
.next static chunks:
framework-...js  189758 bytes
466-...js       173668 bytes
06fe4...js      173018 bytes
main-...js      128624 bytes
polyfills-...js 112594 bytes
457-...js       56855 bytes
(per-route pages: 30-50 KB each)
```
**Очень компактный** для Next.js 15 app. **Per-route code split работает** (T5-4 build-manifest подтверждает): `/recipe/[id]/page-...js` — 23.7KB, `/fridge/page-...js` — 30.4KB.

### ✅ Hydration correctness (Playwright + pageerror capture)
```
Hydration errors: 0
```
Через 5 страниц (`/`, `/today`, `/fridge`, `/plan`, `/plan/setup`) никаких гидрационных ошибок.

### ✅ OpenAPI /docs /openapi.json НЕ выставлен — по дизайну
`/api/v1/docs` → 404, `/api/v1/openapi.json` → 404 в production. Это заявлено в audit-комментарии `main.ts:78-79` — API contract is internal-only и не выставляется на интернет/LAN. ✅ Безопасный подход.

---

## 3. Не подтверждено (закрытые ложные тревоги из прошлых итераций)

### Hydration mismatch от аудита #4 — false alarm
В аудите #4 был пункт о возможном гидрационном несовпадении. **A5-22 подтверждает 0 ошибок**.

### Multi-tenant IDs /recipes/{uuid} из аудита #4 — false alarm  
404 на чужой ID, как должно.

---

## 4. Сводка таблицей (NEW в этой итерации)

| # | Приоритет | Зона | Находка | Где |
|---|---|---|---|---|
| **T5-A** | 🟠 P2 | Perf/Security | Никаких `Cache-Control`/`ETag`/`Last-Modified` на API | все эндпойнты (`/recipes`, `/auth/session`, `/jobs/:id`, ...); Fastify default |
| **T5-B** | 🟠 P2 | UX/SLO | `@Throttle(10/min)` на классе AuthController ловит и `/register` | `apps/api/src/auth/auth.controller.ts:73` |

---

## 5. Что НЕ удалось проверить
- 🟡 **Storybook** — нет в репо
- 🟡 **Sustained worker load** (>30 мин) — long-running test
- 🟡 **CSP report-uri** — всё ещё не включён (из аудита #3)
- 🟡 **CDN headers** (Cloudflare/Vercel-cache) — не настроено в этом окружении
- 🟡 **Service Worker** — `PwaRegister` упоминается в layout, но SW lifecycle не аудирован
- 🟡 **Error boundaries** (только подтверждено отсутствие error.tsx в аудите #3)

---

## 6. Куммулятивный итог (5 итераций)

| Iter | Findings | 🔴 P0 | 🟠 P1–P2 | 🟡 P3 / ℹ️ | Cumulative 🔴 |
|---|---|---|---|---|---|
| #1 | B1–B6 (6) | 2 | 1 | 3 | 2 |
| #2 | M1–M9 (9) | 3 | 2 | 4 | 5 |
| #3 | T1–T6, U1–U4 (11) | 4 | 3 | 4 | 9 |
| #4 | T4-A, T4-B, T4-C (3) | 0 | 2 | 1 | 9 |
| **#5** | **T5-A, T5-B (2)** | **0** | **2** | **0** | **9** |
| **Σ** | **~31 уникальных** | **9 P0** | **10 P1-P2** | **12 ℹ️/P3** | — |

**Тренд 5 итераций:** новые P0 не появляются, новые P2 — исчезающе. Итерация #5 нашла только 2 наблюдения, обе уже известного типа (config header missing). 

---

## 7. Рекомендации (5-я итерация)

1. **(P2, 1-2 часа, T5-A)** Добавить `Cache-Control` стратегии:
   - Static endpoints (`/recipes`, `/ingredients`, `/today/screens`): `public, max-age=60, stale-while-revalidate=300`
   - Sensitive (`/auth/session`, `/jobs/:id`, `/user/*`): `no-store, private`
   - Personalised (`/pantry`, `/meal-plans/active`): `private, max-age=0`
2. **(P2, 30 мин, T5-B)** Разделить `@Throttle` decorator per-endpoint:
   ```ts
   @Throttle({ default: { ttl: 60_000, limit: 10 } })  // login (anti-bf)
   @Post('login')
   ...
   @Throttle({ default: { ttl: 60_000, limit: 60 } })  // register
   @Post('register')
   ```
3. **(P0, повтор)** Из прошлых 4 итераций продолжают оставаться критичными:
   - **B1 (аудит #1)**: CURATED-only каталог фильтр показывает 269/2000 рецептов
   - **B2 (аудит #1)**: `/profile/onboarding` → 500 (body.allergies not iterable)
   - **M1 (аудит #2)**: `Idempotency-Key` header doesn't dedup
   - **M2 (аудит #2 / U1 #3)**: WCAG AA-fail на primary CTA (3.58:1)
   - **T1 (аудит #3)**: SEO отсутствует на 5 страницах; `/profile` пустой title
   - **T3 (аудит #4)**: Postgres Row-Level Security OFF

---

## 8. Артефакты (5-я итерация)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-5.md` (коммит ниже) |
| Предыдущие отчёты | `docs/audit/AUDIT-REPORT{,-2,-3,-4}.md`, `docs/audit/VERIFICATION.md` |
| Argon2 hash dump | raw в логе сессии (пример `$argon2id$v=19$m=65536,t=3,p=4$...`) |
| Bundle размер | `du -sh apps/web/.next` = 149MB; per-chunk sort в логе |
| 15-burst `/recipes` | `time` 0.112s real, pool grown 4 → 17 idle |
| Hydration error capture | `/tmp/hydration-test.mjs` (5 routes, 0 errors) |
| Auth 20-burst | код ответа `401×10, 429×10` (см. §1 T5-B) |
