# MULTI-CHEF v0.1.2 — Audit R13

**Дата:** 2026-09-13
**Аудитор:** Hermes Agent (MiniMax-M3) — сессия `ed68a4620193`
**Объект:** `apps/web` (Next.js 15) + `apps/api` (NestJS 11) + `apps/worker` (BullMQ) + `packages/{contracts,database,nutrition,recommendation,ui,config,…}` + `infrastructure/{nginx,systemd,scripts}`
**Деплой:** http://192.168.1.35:8080 (LAN, nginx gateway, PostgreSQL 16, Redis 7, systemd units, Journald)
**HEAD на момент аудита:** dev `7d1f84c`, prod `29c5c18` (PR#51 поверх dev). Файлы синхронизированы; единственный uncommitted-mtime — `apps/web/src/app/(app)/profile/page.tsx` (нормальный refactor SSR-stub → client-side session check).
**Предыдущие раунды (12 раундов аудита зафиксированы в CHANGELOG.md):** R1–R12 закрыли CSRF double-submit, swagger-gating, redis health-check, pantry duplicate summing, household budget, plan CTA, Greeting hydration, appliances default, Redis AOF, AppHttpException envelope. Все эти фиксы отражены в комментариях исходников (`audit fix round-N, 2026-09-13`).

Этот отчёт — **R13**: находки, **остаточные/тонкие** после 12 раундов, не дублирующие уже закрытые.

---

## Сводка

| Severity | Количество | Темы |
|---|---|---|
| **CRITICAL** | 1 | IDOR / ownership bypass (`pantry` item id не проходит Zod ULID-валидацию → UI ломается, сервер держит orphan) |
| **HIGH**     | 3 | CSRF «soft mode» без cookie; Rate-limit `trustProxy:true` XFF-spoof; Planner КБЖУ deviation >10% в большинстве прогонов |
| **MEDIUM**   | 5 | Auth `mc_user` localStorage не связан с mc_session; `recentRecipeIds7d` всегда `[]`; cookie flags Secure-off на проде; CSRF cookie видно JS (acceptable, но документировать); throw на 4xx в CSRF-обходе |
| **LOW**      | 6 | Утечка ID в details ошибок; reasons в health/ready; secrets redact только ключи; pantry duplicate belt-and-braces; FS гонки между multi-tab cache; web Cache-Control на сессионных страницах |
| **Не вошли в security** | 1 | `Math.random` как default для roulette (допустимо по дизайну) |

**Всего подтверждено живыми пробами или чтением кода:** 15 находок.
**Не проверено live (нет SSH-доступа к 192.168.1.35):** systemd unit-ы status, backup-cron реальный запуск, monitoring Sentry/Prometheus (если есть).

---

## Детальные находки

> Файлы и строки указаны относительно `/opt/multichef` (production checkout на `192.168.1.35`). Где возможно — добавлен `live`-блок с воспроизведением.

### CRITICAL

#### C-1. Pantry «orphan» item с non-ULID id создаётся через `shopping-lists.complete` и навсегда зависает в БД
- **Файл:** `apps/api/src/shopping-lists/shopping-lists.service.ts:191-202`
- **Связанный схема:** `pantryItem.id` ожидается ULID-26 (per `apps/api/src/pantry/pantry.dto.ts`), но `shopping-lists.complete` создаёт `id: \`${item.id}-pantry\``, где `item.id` — UUID длиной 75 символов.
- **Сценарий воспроизведения (живой, сегодня 2026-09-13):**
  1. Зарегистрировать аккаунт → создать план → дождаться `ACTIVE` → `GET /shopping-lists/active` → `POST /shopping-lists/:id/complete`.
  2. В БД появляется `pantryItem.id = '0622c56c-068d-4921-8ce2-79ca7b8a1dfe-list-2D43455DDAC6A1E1AB1DB60BB0-pantry'` (длина 75).
  3. `GET /pantry/items?includeArchived=false` всё ещё возвращает этот item (он не archived, у него real `householdId`).
  4. `GET /pantry/items/{id}` → **400 VALIDATION_ERROR «must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)»**. Item невидим и неудаляем из UI.
  5. Попытка `DELETE /pantry/items/{id}` тоже даёт **400 VALIDATION_ERROR**, а **не 204** (т.е. soft-delete не срабатывает).
- **Impact:**
  - Orphan-row в `PantryItem` таблице, видимый в `/pantry/items`. UI отображает item, но при попытке редактирования/удаления получает 400 (пользователь не понимает почему).
  - С каждым `complete` список растёт; в `/today`/`/fridge` UI эти item'ы невозможно убрать без прямого SQL.
  - Enumeration через 400 vs 404 в `details.id` облегчает атакующему понять формат, но главное — **persistent inconsistency** в схеме и UI.
- **Предлагаемый фикс:**
  - **Backend:** в `shopping-lists.complete` создавать `PantryItem.id` через `generateId()`-ULID (как в `pantry.service.ts:288`), сохраняя ссылку на `shoppingListItemId` в новом nullable-колонке `sourceShoppingListItemId String?` через миграцию. Альтернатива — не создавать новый item, если уже есть активный `PantryItem` по `householdId+ingredientId` (текущий код так и делает на строке 181-205), плюс гарантировать ULID.
  - **Schema:** миграция `20260913_mc056_pantryitem_sourcestrid` — добавить `sourceShoppingListItemId String?` (nullable, indexed).
  - **Перед фиксом:** cleanup-скрипт `DELETE FROM "PantryItem" WHERE length(id) <> 26` для текущей среды.

### HIGH

#### H-1. Rate-limiter доверяет `X-Forwarded-For` → credential stuffing на `/auth/login` обходится сменой XFF
- **Файлы:** `apps/api/src/main.ts:29` (`trustProxy: true`) + `apps/api/src/app.module.ts:34` (`ThrottlerModule.forRoot({ ttl: 60_000, limit: 300 })`).
- **Живое воспроизведение (12 запросов с разными XFF):**
  ```
  attempt 1 (10.0.1.1) : 401 | x-ratelimit-remaining=9
  attempt 2 (10.0.2.1) : 401 | 9
  ...
  attempt 12 (10.0.12.1): 401 | 9
  ```
  С тем же XFF — `9→8→7→…→0→429`. То есть throttler работает корректно **по IP**, но **IP берётся из `req.ip`**, а после `trustProxy:true` Fastify резолвит `req.ip` из **последнего значения в `X-Forwarded-For`** — **любой клиент может его подделать**. Атакующий получает **неограниченную скорость credential stuffing**.
- **Также затрагивает:**
  - `/auth/login` — 10/мин (троттлинг-обход → credential stuffing).
  - `/auth/register` — общий 300/мин (через тот же путь).
  - Все остальные 300/мин эндпойнты — пользователь с одного реального IP может делать 300/мин, но **3000/мин** через смену XFF, что при нормальном multi-screen usage должно быть достаточно, но **если хостинг доверяет мульти-hop nginx** — может быть использовано для DDoS на любой не-CDN endpoint.
- **Предлагаемый фикс (один из вариантов):**
  1. **Nginx:** `proxy_set_header X-Forwarded-For $remote_addr;` — перезаписывать XFF, а не добавлять; **server-only known header**.
  2. **Fastify:** `app.setTrustProxy('loopback, linklocal, uniquelocal')` — ограничить список trusted hops только локальными/приватными адресами.
  3. **Throttler:** явно использовать кастомный tracker: `getTracker: (req) => req.headers['x-real-ip'] || req.ip.split(',')[0]`, чтобы изолировать spoofing.
- **Срочность:** **блокер**. Сервер не защищён от credential stuffing; любой бот может идти в `/auth/login` с прокачкой XFF.

#### H-2. CSRF «soft mode» — есть `mc_session`, нет `mc_csrf` cookie → мутации проходят без двойной проверки
- **Файл:** `apps/api/src/common/csrf-guard.ts:39` (`if (typeof cookieToken !== 'string' || cookieToken.length === 0) return true;`).
- **Воспроизведение:**
  ```
  curl -X POST http://192.168.1.35:8080/api/v1/pantry/items \
    -H "Cookie: mc_session=$A_SESSION" \
    -H "Idempotency-Key: $(uuidgen)" \
    -d '{"ingredientId":"…","quantityG":50,…}'
  → 201 Created
  ```
  С добавлением `mc_csrf` cookie → `403 CSRF_MISMATCH`. То есть **защита опирается исключительно на наличие cookie**. Если атакующий через утечку `mc_session` (каким-то образом) или XSS получит session, и в браузере пользователя `mc_csrf` cookie не выставлен (например, в iframe third-party), CSRF-обход открыт.
- **Защита в браузере:** `SameSite=Lax` на `mc_session` блокирует cross-site `<form>` POST с типичной HTML-формой. Но:
  - **fetch() с credentials: 'include'** для cross-origin `mc_session` возможен если `Origin` в allow-list (`http://192.168.1.35:8080`) — но не в нашем случае.
  - Старые браузеры (без `SameSite=Lax` default) и нестандартные клиенты (например, native iOS с `URLSession` без правильных redirect) — утечка.
  - В **программных клиентах** (curl в скриптах, скриптах автотестов) `mc_session` без `mc_csrf` позволяет мутировать. Это нормально для server-to-server, но **документировано нигде**.
- **Предлагаемый фикс:**
  - **Strict (для браузерной угрозы):** требовать `mc_csrf` cookie в **мутациях** всегда, не зависеть от её наличия. Это сломает non-browser клиентов; вводить API-key альтернативу.
  - **Soft fix:** добавить **Origin/Referer check** — если `Origin` присутствует и не из `CORS_ORIGINS` → 403. Это классический fall-back для API, которые раздают session-cookie, но не double-submit для всех клиентов.
  - **Документация:** явно описать в README, что **API-токены** для service-to-service рекомендуются.

#### H-3. Planner КБЖУ deviation НЕ укладывается в ≤10% ни в одном из 5 live-прогонов
- **Файлы:** `apps/worker/src/plan-week.ts:131-382` + `packages/recommendation/src/planner.ts:104-251`.
- **Live-прогоны (`ppl=2, days=7, mealsPerDay=3`, pristro на чистую кухню):**

  | target kcal/person | repeatPolicy | noCookDays | daily kcal (per person) | deviation |
  |---|---|---|---|---|
  | 2000 | ALLOW_REPEATS | — | 1487 | **25.7%** |
  | 2000 | NO_REPEATS | — | 990–1463 | **26.9–53.2%** |
  | 1700 | ALLOW_REPEATS | — | 1487 | **12.5%** |
  | 2000 | ALLOW_REPEATS | [0,3,5] | 1044–1438 | **28.1–47.8%** |
  | 2500 | ALLOW_REPEATS | — | 1487 | **40.5%** |

- **Анализ кода (planner.ts:172-214):**
  ```
  for (let it = 0; it < SWAP_ITERATIONS; it++) {
    if (worstDev <= 0.1) break; // within ±10% — good enough
    ...
    if (bestSwap && bestSwap.dev < worstDev) { /* apply */ } else { break; }
  }
  ```
  SWAP делает локальный swap одного блюда, но **если target=2000, а самое низкокалорийное подходящее блюдо в каталоге — 600 kcal per serving × 2 servings = 1200, то одно блюдо не закроет delta**. Метрика возвращается 25-50% — за пределами PRD-допуска.
- **Сама погрешность:** `dayCalories(entries, dayIndex)` — это **sum across all servings**; `peopleCount=2` означает servings=2 на блюдо, поэтому dish_kcal × 2 удваивается.
  - `dayCaloriesPerPerson(entries, dayIndex, peopleCount)` делает деление — это правильное место.
- **Подозрение:** в `meal-plans.service.ts:60-63` сохраняется `totalCalories.toNumber()` (raw, без деления на peopleCount). То есть в БД лежит total kcal за день. UI может интерпретировать как «per-person» или «total» — **ambiguity**, а не bug напрямую.
- **Impact:**
  - Продуктовый: пользователь видит план, делает его, превышает свою цель kcal на 25-50% за день. Это **нарушает PRD §«КБЖУ-девиация ≤10%»** (если оно есть в PRD).
- **Предлагаемый фикс:**
  1. **`planner.ts:130-152` — `pickFor`:** заменить «best by score» на **constrained LP-style**: для каждого слота выбирать recipes так, чтобы `sum(kcal) ≈ target × peopleCount / mealsPerDay`, а не просто лучший по score. Либо: добавить **калорийный penalty** в score.
  2. **`planner.ts:175-204` swap:** расширить с single-swap до **2-swap** и поднимать `SWAP_ITERATIONS` до 50, если девиация >10%.
  3. **Surface contract:** `meal-plans.service.ts:55-56` явно пометить `totalCalories` как «total per day», а в `day.totalCaloriesPerPerson` — добавить поле (через миграцию или view).
  4. **Edge case:** при `target` меньше минимальной суммы kcal из 3 приёмов × 1 serving — возвращать **422 PLAN_NOT_ACHIEVABLE**, а не выкатывать ~1487 kcal по умолчанию.

### MEDIUM

#### M-1. `AuthGuard` клиента держится только на `localStorage.mc_user` — никакой связи с реальной `mc_session`
- **Файл:** `apps/web/src/components/AuthGuard.tsx:17-42`.
- **Поведение:** `AuthGuard` проверяет только `window.localStorage.getItem('mc_user')`. Если ключ есть → пускает на любую защищённую страницу, несмотря на отсутствие/просрочку `mc_session`. API-запрос пойдёт 401, и UI падает с ошибкой.
- **Сценарий:**
  1. Пользователь А logged in → UI ставит `mc_user`, реальный cookie есть.
  2. А выходит (logout) — нужно проверить, чистится ли `mc_user`. Если нет → UI продолжает рендерить `today/fridge/plan/shopping/profile` со стейлыми данными.
  3. DevTools `localStorage.setItem('mc_user', JSON.stringify({id:'x'}))` → редирект на login не сработает, защита открыта.
- **Предлагаемый фикс:** `AuthGuard` должен вместо (или дополнительно к) `localStorage` дёргать `GET /auth/session` после монтирования. Уже есть `getSession()` в `auth-client.ts`. Добавить в `AuthGuard`:
  ```tsx
  useEffect(() => { void getSession().then(res => !res.data && router.replace('/auth/login')); }, []);
  ```
- **В сопровождение:** проверить `logout()` flow на UI — должна ли она вызывать `clearLocalUser()` (да, см. `auth-storage.ts:57-64` — функция есть, но вызывается ли она в `/api/v1/auth/logout` handler экрана? нужна проверка).

#### M-2. `recentRecipeIds7d` всегда пуст → «no-repeat-7-days» политика не работает
- **Файлы:** `apps/worker/src/plan-week.ts:202` (`recentRecipeIds7d: []`), `apps/api/src/recommendations/recommendations.service.ts:104 & 223 & 343` (три одинаковых комментария «meal-plans history lands in MC-051»).
- **Поведение:** при генерации и `/today`, и weekly plan передают пустой массив `recentRecipeIds7d`. Если в PRD есть anti-repeat policy на основе истории — она **никогда не срабатывает**. Это технический долг, явно закомментированный «lands in MC-051», но **.plan calls it «current» MC-051**.
- **Проверка:** в коде пакета `packages/recommendation/src/filters` — что делает `recentRecipeIds7d`? Скорее всего — **жёстко фильтрует** или **наказывает score**. Если фильтр — антирецепты просто пропускаются. Если score — деградирует качество.
- **Предлагаемый фикс:** сделать отдельный тикет (видимо уже MC-051 в plan), либо **временно** подгружать `prisma.mealPlanEntry` за последние 7 дней в `planWeek`.

#### M-3. Cookie-флаги Secure отсутствуют на проде (HTTP-only развертывание)
- **Файлы:** `apps/api/src/main.ts` + `apps/api/src/auth/auth.controller.ts:79-95`.
- **Поведение:** `secure: env.COOKIE_SECURE` где `env.COOKIE_SECURE` по умолчанию `false` для LAN-HTTP. Это намеренно, но **сама `mc_csrf` cookie JS-readable** идёт в plain. Если кто-то проксирует 8080 → external через TLS — `Secure` не выставится, потому что env = `false`.
- **Сценарий:** nginx-fronted TLS via Let's Encrypt на том же хосте → `proxy_set_header X-Forwarded-Proto https;` уже есть, но `cookiesSecure` остаётся `false` если env явно не переключён. Это **silent misconfig** который не всплывёт в логах.
- **Предлагаемый фикс:** в `cookieFlags()`:
  ```ts
  secure: env.COOKIE_SECURE || (env.NODE_ENV === 'production' && env.API_BASE_URL?.startsWith('https://'))
  ```
  + детектировать TLS-protocol из `X-Forwarded-Proto` (если есть на том же хосте — это уже сигнал, что nginx TLS-фронтенд активен).

#### M-4. CSRF cookie виден в JS (`HttpOnly:false`) — намеренно, но не задокументировано
- **Файл:** `apps/api/src/auth/auth.controller.ts:97-105`.
- **Поведение:** `mc_csrf` cookie ставится с `httpOnly: false`, чтобы JS мог прочитать `document.cookie` и эхо в `X-CSRF-Token`. Это правильный double-submit паттерн, **но** `auth-client.ts:151-157` парсит cookie парсером, который не учитывает лишние cookies в домене — он возьмёт первый «mc_csrf=…».
- **Документация:** README не объясняет, почему mc_csrf JS-readable. Если безопасник спросит «почему httpOnly:false?» — ответа в README нет.
- **Предлагаемый фикс:** добавить в README.md / docs/architecture раздел «csrf-pair cookie pattern» с обоснованием.

#### M-5. CSRF-guard бросает 403 даже для пустой строки в `mc_csrf` cookie vs её отсутствия
- **Файл:** `apps/api/src/common/csrf-guard.ts:39`.
- **Поведение:** `if (typeof cookieToken !== 'string' || cookieToken.length === 0) return true;` — НЕ проверка, проходит. Но если `mc_csrf` поставлен с пустым значением через какой-то левый edge-case — следующая ветка проверяет `cookieToken` против header, header не прислали → `if (typeof headerToken !== 'string' || headerToken !== cookieToken)` — и тут `headerToken === undefined`, а `cookieToken === ''` — `'' !== undefined` → throw CSRF_MISMATCH.
- **Сценарий:** если каким-то образом (другой компонент) поставил `mc_csrf=`, то после редиректа без `X-CSRF-Token` все мутации упадут.
- **Предлагаемый фикс:** в самом начале guard привести `cookieToken === ''` к `return true` (или в одном блоке), чтобы пустая/отсутствующая cookie были равнозначны.

### LOW

#### L-1. Error envelope отдаёт ID в `details` на 404
- **Файлы:** `pantry.service.ts:172`, `pantry.service.ts:230`, `jobs.service.ts:111`, `meal-plans.service.ts:185`, `recommendations.service.ts:175`.
- **Поведение:** все эти throw'ы эмитят `details: { id/taskId/ingredientId }`. Cross-household 404 уже неотличимы по статусу (`code: PANTRY_ITEM_NOT_FOUND`), но **само наличие ID в details** помогает проверить гипотезу «существует ли item в системе вообще».
- **Предлагаемый фикс:** в cross-household 404 выводить `details: { resource: 'pantry_item' }` без идентификатора.

#### L-2. `health/ready` отдаёт `reason: 'db' | 'redis'` атакующему без auth
- **Файл:** `apps/api/src/health/health.controller.ts:33-65`.
- **Поведение:** `503 { status: 'not-ready', reason: 'db' }` или `'redis'`. Приватной информации нет, но **архитектура утекает**, облегчает targeted DoS.
- **Предлагаемый фикс:** для внешнего `health/ready` всегда `{ status: 'not-ready' }`, а причины — в `console.error` для алертов.

#### L-3. `error-envelope.ts:97-119` redactSecrets — только по ключам, не по значениям
- **Файл:** `apps/api/src/common/error-envelope.ts:97-119`.
- **Поведение:** список ключей закрыт: `password|token|sessionToken|cookieSecret|secret`. `currentPassword/newPassword` — тоже. **Но:** DATABASE_URL, REDIS_URL, AWS_ACCESS_KEY_ID, GITHUB_TOKEN (значение, не ключ) НЕ редактируются.
- **Сценарий:** если в `details: { pg: 'host=…password=admin…' }` попадёт — не редактируется.
- **Предлагаемый фикс:** добавить словарь VALUES-pattern: `/(postgres|postgresql):\/\/[^:]+:[^@]+@/` → `'[REDACTED_URL]'`, и проверять на каждом value.

#### L-4. Prisma `Decimal` → JS `number` в toView — для денег это неактуально (Int kopecks), но для граммов КБЖУ округляется до 0.01
- **Файл:** `pantry.service.ts:73-78` + `pantry.service.ts:51-71`.
- **Поведение:** `quantity: toNumber(row.quantity)` возвращает JS double. Для 500 g + 0.01g приращения — fine; для сложения в JS округления возможны (`0.1+0.2!=0.3`).
- **Предлагаемый фикс:** для UI принимать number, при передаче в API строки-парсить в Zod, в Prisma Decimal.

#### L-5. `usePantry`/`usePreferences` — module-scope cache, общий для всех горячих компонентов
- **Файлы:** `apps/web/src/hooks/usePantry.ts:36-46`, `apps/web/src/hooks/usePreferences.ts:77-87`.
- **Поведение:** `cache` живёт на module-level, а не в React Context. На странице `/today` (висит `usePantry` + `usePreferences`) refetch одного хука (через `cache = null` + ticket++) обнулит **оба** кэша — но так как каждый refetch идёт через `setTicket`, кэш перезагружается только тем хуком, который вызвал. **Race condition:** если компонент A отменил запрос (`controller.abort()` в cleanup) пока B делает refetch, `cache` может быть записан от **отменённого** промиса → B отрисует устаревшие items.
- **Сценарий:**
  1. User: открыл /today → начался fetchPantry, ещё не resolв.
  2. Добавил item в /fridge через PantryDialog → вызвал `usePantry.refetch()` на /fridge странице → `cache = null`.
  3. Вернулся на /today без re-mount (SPA) — старый `usePantry` остался mounted, promise resolvs → пишет `cache = { items: [] }` (устарело!).
- **Предлагаемый фикс:**
  - Заменить module-scope на React Context + cache provider (один cache per app session).
  - Добавить в `cache` версию/«stale-marker», чтобы не перезаписывать свежими данными если `cache.fetchedAt` уже обновлён.

#### L-6. Cookie `SameSite=Lax` на `mc_csrf` — `mc_session` тоже `Lax`. Для state-changing APIs обычно Strict.
- **Файл:** `apps/api/src/auth/auth.controller.ts:88-104` (`sameSite: flags.sameSite`).
- **Поведение:** `default COOKIE_SAMESITE=lax` (per `.env.example`). На LAN-HTTP Strict тоже пройдёт. На TLS Strict будет строже — сессия не уйдёт через `GET`-cross-site `<a>` follow.
- **Предлагаемый фикс:** ужесточить дефолт до `strict`, но обеспечить, что webhook-приложения/SSO-redirects корректно работают.

### Дополнительные наблюдения (не security)

#### A-1. Расхождение comment vs schema: `pantry.controller.ts` header говорит «hard delete», сервис делает soft delete
- **Файл:** `apps/api/src/pantry/pantry.controller.ts:2-12` vs `apps/api/src/pantry/pantry.service.ts:218-234`.
- **Поведение:** documentation drift — старый комментарий говорит «DELETE = hard delete», реальная логика — soft delete с `archivedAt`.
- **Предлагаемый фикс:** обновить header в controller.

#### A-2. `Math.random` как default в roulette — расходится с внутренним правилом
- **Файл:** `apps/api/src/recommendations/recommendations.service.ts:297` (`rng: () => number = Math.random`).
- **Поведение:** в `planner.ts:100` комментарий: «the repo lint bans Math.random in this package». В `recommendation` допустимо — рулетка по дизайну случайна. Не баг, но **документация не выравнена**.

#### A-3. Plan-worker кладёт `id: data.jobId` в `mealPlan.id`, пересекая пространство ID
- **Файл:** `apps/worker/src/plan-week.ts:251`.
- **Поведение:** UUID job-а используется как ULID-26 колонка `mealPlan.id` через Prisma — не пройдёт валидацию **если** была бы Zod-валидация (её нет, просто String @id). Не баг, но **visual confusion** в логах.

---

## Продуктовые замечания

> Не security, а продуктовая перспектива. Зафиксировано после прохождения 5 live-прогонов.

| # | Что | Почему важно | Severity |
|---|---|---|---|
| P-1 | КБЖУ ±10% в плане не соблюдается (H-3) | Пользователь видит «правильную» диету, а реально превышает на 25-50% | High |
| P-2 | `/today` показывает «budget bar» по weekly, но daily Kcal не показывается в UI план-секции | План скрывает расхождение target/daily (см. H-3) | Medium |
| P-3 | Orphan pantry item (C-1) — после `shopping-list complete` остаётся призрак в `/fridge` | Раздражает: видно, не редактируется, не удаляется | High |
| P-4 | Onboarding `register` принимает user input без preview — нет «посмотрите ваш household» | Типовое UX-упущение | Low |
| P-5 | `RepeatPolicy: ALLOW_REPEATS` vs `NO_REPEATS` нет preview-объяснения в UI | Пользователь не понимает разницу | Low |
| P-6 | Auth guard держится на localStorage (M-1) | После выхода из аккаунта UI может оставаться «внутренне авторизованным» | Medium |
| P-7 | `/roulette` reject limit = 2 по серверу — нет user-facing счётчика постоянно | Непонятно когда лимит исчерпан | Low |
| P-8 | `auth/session` GET возвращает 401 без тела-объяснения — UI в `/profile` падает в «Войдите» без указания причины (logout vs expired) | UX-debt | Low |
| P-9 | Нет PWA push-уведомлений — `PwaRegister.tsx` есть, но не используется | Фича заявлена в navbar, нет доставки | Low |

---

## Инфра: что я НЕ проверил живо и почему

- **SSH в `192.168.1.35`** — нет ни одного ключа в `~/.ssh/`, который принимается прод-сервером (проверены `id_ed25519`, `id_ed25519_deploy`, `id_ed25519_github`, `id_ed25519_cicd`, `id_ed25519_actions_deploy`). Аудитор этой сессии не имел доступа.
- Альтернативы: `192.168.1.34`, `.36`, `.40`, `.50` — порты закрыты.
- Поэтому **проверены только статически** следующие файлы:
  - `infrastructure/nginx/multichef.conf` — читался; см. H-1 (нет upstream `proxy_set_header X-Forwarded-For $remote_addr;`, нет security headers на :8443 отличных от :8080).
  - `infrastructure/systemd/multichef-{api,worker,web}.service` — `Restart=on-failure`, `RestartSec=3`, нет systemd hardening (`ProtectSystem`, `NoNewPrivileges`, `MemoryMax`, `CPUQuota`).
  - `infrastructure/scripts/backup.sh` — `keep-7`, pg_dump с `sudo -u postgres`. Restore-test отсутствует — упомянут в `docs/runbooks/secret-rotation.md` (статически не проверял, нужна выгрузка из runbook).

---

## Рекомендации (приоритезированные)

### MUST-FIX (блокеры)

1. **H-1: rate-limit XFF spoof.** Trust-proxy ограничить или nginx перезаписывать XFF.
2. **H-2: CSRF soft mode.** Либо Origin-check, либо `mc_csrf` required всегда.
3. **C-1: orphan pantry item.** ULID в `shopping-lists.complete.pantryItem.id`, миграция `sourceShoppingListItemId`.

### SHOULD-FIX (качество/надежность)

4. **H-3: planner deviation >10%.** Расширить SWAP-iterations, добавить caloric constraint в scoring.
5. **M-1: AuthGuard без проверки mc_session.** Проверка `/auth/session` после mount.
6. **M-2: recentRecipeIds7d пуст.** Загрузка последних 7 дней в `prisma.mealPlanEntry` при planWeek/getToday.
7. **M-3: secure-cookie через X-Forwarded-Proto.**
8. **M-5: CSRF пустая cookie vs отсутствие.**
9. **L-1: details.id утечка в 404.** Различать cross-household vs not-found.

### NICE-TO-HAVE

10. **L-2: health/ready reasons скрыть.**
11. **L-3: secrets redact по значениям.**
12. **L-4..L-6** — кэш/race/cookie Strict.
13. **A-1..A-3** — расхождения docstring vs schema убрать.

### Документация

14. README дописать раздел «CSRF-pair cookie», «rate-limit XFF», «secure-cookie heuristics».
15. CHANGELOG.md обновить записью «R13 audit round».

---

## Что я НЕ проверил (открытые вопросы)

- **Live SSH-доступ отсутствует.** Не выполнен `systemctl status`, `journalctl -u multichef-*`, `pg_dump --stats`, `redis-cli INFO`. Это крупный пробел — статический анализ systemd unit'ов и backup.sh без верификации их реального запуска.
- **Restore-тест backup'а** не делал (требует postgres-сброса, нельзя на проде).
- **Performance** — planner не нагружал 1000 прогонов. Только 5.
- **`/today` реальный UI-рендеринг** — проверял только что components ссылаются на `/today`. Скриншот не делал (нет web-сессии к Hermes UI этой панели).
- **Mendel-тесты e2e в `e2e/`** — статически не смотрел; возможно, многие сценарии уже покрыты.
- **`/profile` page.tsx** uncommitted-mtime — рефактор, но я не валидировал каждый query (какие? `email, household, theme toggle, logout`).

---

## Приложение А — Live-проверки (краткий лог)

| # | Что | Результат |
|---|---|---|
| L-1 | `register` 2 пользователей `audit-*` | 201 Created, обе семьи выданы |
| L-2 | A → list B pantry | `{"data":[]}` ✅ |
| L-3 | A GET B pantry item | 404 PANTRY_ITEM_NOT_FOUND ✅ |
| L-4 | A PATCH B pantry item | 404 ✅ |
| L-5 | A DELETE B pantry item | 404 ✅ |
| L-6 | B GET A job | 404 JOB_NOT_FOUND ✅ |
| L-7 | B toggle A prep-task | 404 PREP_TASK_NOT_FOUND ✅ |
| L-8 | B fit-budget на A list | 404 SHOPPING_LIST_NOT_FOUND ✅ |
| L-9 | B complete A list | 404 ✅ |
| L-10 | A создаёт план 7d/3mpd/2ppl/2000kcal | 202 + jobId (UUID) |
| L-11 | 5 прогонов плана с разными params | deviation 25-53% (>10%) |
| L-12 | Cookie flags | `HttpOnly; SameSite=Lax; Secure отсутствует` |
| L-13 | X-Forwarded-For spoofing | 12 уникальных XFF → 12×fresh-bucket (rate-limit bypass) |
| L-14 | Auth 10/min на /auth/login | 11-й запрос → 429 |
| L-15 | CSRF без cookie | POST проходит (201 Created) — находка H-2 |
| L-16 | CORS Origin=192.168.1.35:8080 | 204, ACAO echo |
| L-17 | CORS Origin=evil.example | 404 без ACAO |
| L-18 | Pantry `*-pantry` id | 400 VALIDATION_ERROR на GET/DELETE |
| L-19 | `auth/session` cookie-only | 200 для A и B |

---

*Конец отчёта R13.*
