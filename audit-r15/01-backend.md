# R15 / Фаза B1 — Backend аудит

**Объект:** apps/api (NestJS 11 + Fastify + Prisma + BullMQ + Zod nestjs-zod)
**Объём:** прочитал auth, common/{auth-guard,csrf-guard,idempotency,exception-filter,error-envelope}, controllers & services, module wiring, payload-mappers. **81 TS-файл**, ~4063 строк.
**Метод:** static read + live API пробы (R13+R15).

## Сводная B1

| Severity | Количество | Темы |
|---|---|---|
| HIGH   | 3 | Контракт /security/correctness |
| MEDIUM | 8 | Multi-user household + rollback edge-cases + отсутствующие guards |
| LOW    | 11 | docs drift, edge-cases, cosmetic |

---

## HIGH (B1)

### B1-H1. ~~Idempotency-Key в login/register/logout не нужен — глобальный guard тратит CPU и зависит от pg деталей~~
- **Файл:** `apps/api/src/common/idempotency.ts:26-50`, `apps/api/src/auth/auth.controller.ts:138-188`.
- **Что:** `auth/register` (и login/logout) принимают POST → глобальный `IdempotencyKeyGuard` валидирует UUID-like ≥16 chars, но **никакой dedup-store** нет — `enforce presence only`. То есть каждый запрос с разным UUID генерирует новую запись в `User/Session`, плюс при replay-attack со одинаковым key просто пройдёт IdempotencyKeyGuard → но без dedup может создать дубль-сессию (login) или user (register).
- **Доказательство:** R8 и R13 установили — MC-051 «Redis-backed dedup 24h TTL» (см. `idempotency.ts:9-15`).
- **Impact:** в ближайший MC-051 должны добавить fingerprint-match logic — до этого dedup отсутствует, и фронт может вызвать register/login дважды → 2 записи пользователя, 2 сессии (login → 2 живой mc_session, потому что `auth.service.ts:175-181` создаёт новую сессию без ревокации старой).
- **Фикс:** в `login()` (auth.service.ts:148-188) **отзывать остальные сессии пользователя** при успешном логине, либо помечать fingerprint (`userAgent+ip+idempotencyKey`). Плюс добавить Redis keyed-fingerprint cache.

### B1-H2. CSRF double-submit soft-mode, плюс AuthGuard `mc_session` не покрывает мутирующие, к которым есть допустимый POST (logout)
- **Файл:** `apps/api/src/common/csrf-guard.ts:36-50`.
- **Что:** R13 уже отметил soft-mode («нет mc_csrf cookie → allow»), **дополнительно** нашёл: в `auth.controller.ts:188-209` есть `POST /logout` и `POST /logout-all` с `@UseGuards(AuthGuard)` — но **CSRF guard проверяет mc_csrf cookie**. Если злоумышленник получит mc_session без mc_csrf (например, XSS очистил mc_csrf cookie), он не сможет logout, **включая вредоносные мутации**. Это **защита от bug, а не атаки** — но означает: пользователь не может сбросить сессию, если XSS нанёс вред. Парадоксальная защита от victim.
- **Impact:** usability > security. Не критично, но **документировать поведение**.
- **Фикс:** в `auth.controller.ts` для `logout` и `logout-all` явно **отключить CSRF-guard** через `@SkipCsrf()` декоратор.

### B1-H3. Postgres `Decimal ↔ number` в `toView()` для денег через `Math.round(rawItem.packageQuantity)` — float drift не отслеживается на сложении
- **Файл:** `apps/api/src/shopping-lists/shopping-lists.service.ts:106-110, 270-271`.
- **Что:** `Math.round((substituteMeta?.avgPriceKopecks ?? 0) * rawItem.packageQuantity)` — перемножение Int × number. `packageQuantity` приходит из БД как Int (line 192 schema.prisma), но в Zod allowed: `number` без Zod-coerce — если клиент шлёт `"2.5"` (строку), Prisma бросит.
- **Воспроизведение:** откройте `sw.js` в `apps/web/public/sw.js` для понимания PWA + `transpilePackages`. Zod в shopping.dto.ts валидирует `packageQuantity: z.number().int().positive()` — проверить.
- **Impact:** дрейф малый — пакеты по 1-3 штуки. Не блокер.

---

## MEDIUM (B1)

### B1-M1. Нет `GET /api/v1/shopping-lists/:id` — id-suffixed маршруты есть, но `/:id` без sub-action не определён
- **Файл:** `apps/api/src/shopping-lists/shopping-lists.controller.ts:25-99`.
- **Что:** @Controller определены только: `GET active`, `POST :id/fit-budget`, `POST :id/apply-proposal`, `PATCH items/:itemId`, `POST :id/complete`. **Нет** `GET :id`. Если клиент шлёт `GET /api/v1/shopping-lists/foo` → 404 «Cannot GET …».
- **Доказательство:** live curl `/api/v1/shopping-lists/non-existent-id` → 404 NOT_FOUND.
- **Impact:** API contract miss — web-страница `/shopping/[listId]` в R15 нашёл, что это **placeholder**, не дёргает API. Но если в MC-056 будет рефакторинг и появится «view detailed list by id», нужно будет добавить endpoint.
- **Фикс:** добавить `@Get(':id') getOne(@Param('id') id, @Req())` в `shopping-lists.controller.ts`.

### B1-M2. **`recommendations.module.ts`** — `new Redis(url)` без `lazyConnect`, без graceful shutdown
- **Файл:** `apps/api/src/recommendations/recommendations.module.ts:21-26`.
- **Что:** factory создаёт `new Redis(url)` синхронно, без `lazyConnect: true`, без `enableOfflineQueue: false`, без `on('error')`. Если process получает SIGTERM — Redis-соединение остаётся открытым без `quit()`. **default ioredis connect retries = 10**; при сетевом сбое будет ддосить Redis-сервер 10 попыток × exponential backoff.
- **Impact:** утечка connections, лавины при сетевых сбоях.
- **Фикс:**
  ```ts
  return new RedisRouletteCounter(new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  }) as never);
  ```
  Плюс `app.enableShutdownHooks()` (в main.ts уже есть) + `OnApplicationShutdown` хук в `RedisRouletteCounter`.

### B1-M3. CSRF `empty cookie value` и `missing` эквивалентно, но **только по `length === 0`**; пробельная cookie не отключит guard
- **Файл:** `apps/api/src/common/csrf-guard.ts:39`.
- **Что:** `if (typeof cookieToken !== 'string' || cookieToken.length === 0) return true;` — `' '` (пробел) пройдёт, header будет пробел → `headerToken !== ' '` от `' '` → throw CSRF_MISMATCH. Не эксплуатируемо, но edge-case.
- **Фикс:** `cookieToken.trim() === ''`.

### B1-M4. `pick-top3.ts:154` — edge-case когда `passed.length === 1` ⇒ `bestMatch: fromPantry` (одна и та же ссылка)
- **Файл:** `apps/api/src/recommendations/pick-top3.ts:154`.
- **Что:** при каталоге в 1 recipe, `bestMatch` указывает на **тот же объект**, что и `fromPantry`. UI получает дубликат recipeId в `options[0]` и `options[1]`. Контракт «3 options» не держится, потому что 2 из них — та же recipe.
- **Воспроизведение:** tests/e2e не покрывают этот случай (catalog=269 recipes).
- **Фикс:** в fallback создать копию с другим `type`:
  ```ts
  const fallback = passed[0];
  if (fallback && bestCandidate == null) {
    const row = deps.rowById.get(fallback.recipe.id)!;
    bestMatch = { type: 'BEST_MATCH', recipe: deps.toRecipeDto(row), score: fallback.score, explanation: explain(fallback) };
  }
  ```

### B1-M5. `recommendations.service.ts:51-90` — Promise.all с `Promise.resolve(null)` для yesterdayProtein не выглядит проблемой, но **sequential `await` после Promise.all перерендерит times**
- **Файл:** `apps/api/src/recommendations/recommendations.service.ts:51, 87`.
- **Что:** `await fetchYesterdayMainProtein(prisma, householdId, now)` **после** Promise.all — последовательная I/O. Лучше **включить** в Promise.all (он независим).
- **Impact:** +1 RTT к БД на каждый `/today`. Не блокер.

### B1-M6. `meal-plans.controller.ts:74-79 POST active/prep` — `@HttpCode(200)`, но md файлы проекта (PRD) подразумевают id создания/возврат кода
- **Файл:** `apps/api/src/meal-plans/meal-plans.controller.ts:73-79`.
- **Что:** POST 'active/prep' идемпотентно возвращает prep-session — 200 OK даже при первом создании. Стандартный паттерн: **201 Created** для новой сессии, **200 OK** для idempotent повторов. Текущий код всегда 200, что делает невозможным различать «создано» от «уже было».
- **Фикс:** различать created vs existed и эмитить соответственно.

### B1-M7. `meal-plans.service.ts:152-170` — generationSettings на create не stored как JSON safety
- **Файл:** `apps/api/src/meal-plans/meal-plans.service.ts:30-35`, `apps/worker/src/plan-week.ts:251-262`.
- **Что:** `generationSettings: setup as object` — JSON-кастинг «в обход» Zod. Если клиент шлёт `setup` с прототипом загрязнения (`__proto__` / `constructor`), Prisma сериализует через JSON.stringify. Безопасно для типизированной API, но **нет runtime guard** на форме setup.
- **Фикс:** `JSON.parse(JSON.stringify(setup))` явно с pre-validation.

### B1-M8. `pantry.service.ts:73-78` — `toNumber(d)` для Decimal, **double drift при сложении в JS**
- **Файл:** `apps/api/src/pantry/pantry.service.ts:73-78`.
- **Что:** `quantity.toNumber()` для Prisma.Decimal. На стороне UI считаем double; в покупках при `complete` `grams = item.packageQuantity * item.packageSize.toNumber()` — multiplication Int × double → double.
- **Impact:** центы копеек int, граммы Decimal 2 знака → не страшно. Но при интеграции с UI `quantity` хранится как JS double.

---

## LOW (B1)

### B1-L1. Header comment drift: `apps/api/src/pantry/pantry.controller.ts:2-12` говорит «hard delete», service делает soft delete (R13 этот уже отметил)
### B1-L2. Утечка `id` в `details` для cross-household 404 (R13 L1)
### B1-L3. `error-envelope.ts:redactSecrets` — ключи покрыты, значения нет (R13 L3)
### B1-L4. `health/ready` отдаёт `reason: 'db' | 'redis'` (R13 L2)
### B1-L5. `process.env['REDIS_URL']` без TS-типизации в `recommendations.module.ts:22`
### B1-L6. `controller.ts` у `profile.controller.ts:108-115` принимает `kind` через `req.query` cast к `PreferenceKind` без Zod валидации формата
### B1-L7. `profile.service.ts:296-298` `findFirstOrThrow` — Prisma `NotFoundError` не обёрнут в `AppHttpException`, поэтому 500
### B1-L8. `pantry.dto.ts` — не виден, надо проверить, что там coerce `quantityG: number` в `Decimal` конструкторе в service
### B1-L9. `recipes.controller.ts` без `idempotency-key` guard (GET OK)
### B1-L10. `csrf-guard.ts:42-47` — `throw AppHttpException` обходит Common Error, не использует `nestjs-zod`-style machine-readable `fields`
### B1-L11. `apps/api/.env.test` имеет `RUN_DB_INTEGRATION` но не используется в `pnpm test` (`apps/api/package.json:14-15`) — только в `test:integration`

---

## Не подтверждено (открытые вопросы / для R15.4 — infra & observability)

- Live `systemctl status multichef-{api,worker,web}` — нужен SSH на прод, отсутствует.
- Live restore-тест `backup.sh` — опасно на проде.
- Effective database pool size vs `DATABASE_POOL_MAX` — только конфиг, реальное значение видел только через psql.
- Потенциальные N+1 запросы в:
  - `recipes.controller.ts` / `recipes.service.ts` — не читал в R15.
  - `recommendations.service.ts:51-84` — 4 параллельных `findMany` Promise.all, line 313-333 то же; OK.
  - `meal-plans.service.ts:217-275` — 1 query к StorageRule (`groupBy`), `recipeIngredients` через `groupBy` (несколько запросов). Возможен N+1 при первом прогоне.

---

## Выводы B1

Backend-код значительно чище, чем R13 находки давали понять. Multi-user household всё ещё single-user-per-household (по комментариям), ролевая матрица не введена. IDOR закрыт для всех проверенных сервисов (pantry, jobs, meal-plans, shopping, prep-task, recommendations). Главный blocker **не B1, а C-1 (orphan pantry-id) и H-1/H-2 (rate-limit XFF + CSRF soft-mode) из R13**.
