# ROADMAP 21–70: приоритетный план разработки по бэклогу аудитов #21–#70

**Дата:** 2026-09-15 · **Базовый HEAD:** `1b36127` (= origin/main) · **Горизонт:** 2–3 месяца
**Вход:** `FIX-PLAN.md` — 196 находок (50 раундов × 4, все open); после дедупликации повторов
(T55-B≈T37-A, T62-B≈T39-A, T62-C≈T39-C, T68-A≈T35-A и попутных фиксов) — **~180 уникальных**.
Приоритеты: 1×🔴 P1, ~100 🟠 P2, ~85 🟡 P3.

## Верификация ключевых фактов (2026-09-15, живой репо)

| Факт                                          | Статус                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| T38-B «PLAN_NOT_FOUND нет в enum»             | **устарела** — код присутствует (6 вхождений), баг не воспроизводится; в эпик E3 входит только документирование |
| T54-B (P1) «imageKey без валидации источника» | **подтверждена** — `z.string().nullable()` в contracts/recipes.ts:34                                            |
| T25-A «withTenantContext без unit-тестов»     | **подтверждена** — 0 unit-тестов; интеграционный rls-policies.test покрывает только SQL                         |
| T24-A «TLSv1/TLSv1.1 в nginx»                 | **подтверждена** — nginx.conf:33                                                                                |

## Принципы

1. Один эпик = ветка → 2-6 атомарных коммитов → зелёный `pnpm check` → деплой → приёмка на проде (по образцу FIXES-13-20/FIXES-1-12).
2. Инфраструктурные шаги (nginx, роли БД, restart) — только с подтверждением оператора.
3. RLS-контракт не ломать: любые новые чтения тенант-таблиц — через `withTenantContext`.
4. Деплой-порядок при миграциях: context-aware билд → restart → миграция.

---

## Часть 1. Сводная таблица эпиков

| #   | Эпик                                                     | Фаза | Размер    | Закрывает                                                | Главная выгода                                  | Зависит от                     |
| --- | -------------------------------------------------------- | ---- | --------- | -------------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| E01 | CI-гейты: integration + e2e + coverage + `pnpm audit`    | 1    | M (2-3)   | 5 (T28-A/B/C, T44-A, T25-C)                              | Регрессии ловятся до мерджа                     | —                              |
| E02 | imageKey: contract validation (🔴 P1 XSS)                | 1    | S (0.5)   | 1 (T54-B)                                                | Закрыт единственный P1 бэклога                  | —                              |
| E03 | Error-code governance + prisma-errors v2                 | 1    | M (2-3)   | 5 (T38-A/C/D, T64-C/D)                                   | Единый контракт ошибок, compile-time exhaustive | —                              |
| E04 | Rate limiting: per-user, health-skip, наш envelope       | 1    | M (2-3)   | 7 (T39-A/B/C/D, T62-B/C, T24-D)                          | Честные квоты, корректные 429                   | —                              |
| E05 | HTTP-surface security: cookies + CORS + TLS/headers      | 1    | L (3-5)   | 10 (T32-A/B/C/D, T41-A/B/C/D, T24-A/B)                   | Clickjacking/TLS/cookie-гигиена                 | —                              |
| E06 | DB indexes: 8 недостающих индексов                       | 1    | M (2-3)   | 8 (T49-A/B/C/D, T61-A/B/C/D)                             | Main-reads по индексам                          | E14 (CONCURRENTLY-методика)    |
| E07 | Domain utilities: money + date                           | 1    | S/M (1-2) | 7 (T52-A/B/D, T50-A/B/C/D)                               | Копейки и даты без ручного парсинга             | —                              |
| E08 | Multi-tab cache sync                                     | 1    | S (1)     | 3 (T29-A/B/C)                                            | Privacy + консистентность между вкладками       | —                              |
| E09 | Unit-тесты security-critical сервисов                    | 1    | M (2-3)   | 3 (T25-A, T25-B)                                         | Regression safety net для RLS-слоя              | —                              |
| E10 | Env-validation unification                               | 2    | M (2-3)   | 8 (T55-A/B/C/D, T37-A/B/C/D)                             | Fail-fast на неверном env во всех процессах     | —                              |
| E11 | Worker/BullMQ hardening + worker health                  | 2    | L (4-6)   | 11 (T21-A/B, T53-A/B/C/D, T58-D, T51-A/B, T26-B)         | Retry/DLQ/lock, видимость worker для k8s        | E09                            |
| E12 | Worker observability + safe errors + correlation-id      | 2    | M (2-3)   | 6 (T59-A/B/D, T64-B, T26-A, T21-C)                       | Trace-id сквозь очередь, без PII в ошибках      | E11                            |
| E13 | DB pool tuning + metrics                                 | 2    | M (2-3)   | 7 (T35-A/B/D, T68-A/B/C/D)                               | Pool не истощается, exhaustion виден            | —                              |
| E14 | Migration safety (CONCURRENTLY, rollback)                | 2    | M (2-3)   | 4 (T33-A/B/C/D)                                          | Деплой без длительных локов                     | E06                            |
| E15 | OpenAPI completeness                                     | 2    | L (4-5)   | 8 (T34-A/B/C/D, T63-A/B/C/D, T23-C)                      | Актуальная спецификация для QA/SDK              | —                              |
| E16 | A11y wave: dialogs, keyboard, aria, axe в CI             | 2    | L (4-5)   | 13 (T22-A/B, T47-A/B/C/D, T67-A/B/C/D, T30-B/C/D, T30-A) | WCAG 2.1/2.4/3.3 закрыты + регресс-гейт         | —                              |
| E17 | ULID unification                                         | 2    | M (2-3)   | 4 (T56-A/B/C/D)                                          | Единый формат ID, криптостойкие fallback'и      | —                              |
| E18 | Seed idempotency + advisory lock                         | 2    | M (2-3)   | 5 (T60-A/B/C/D, T55-C)                                   | Seed идемпотентен и race-free                   | —                              |
| E19 | Zod path/params unification                              | 2    | S/M (1-2) | 5 (T31-A/B/C/D, T23-A)                                   | 400 вместо fuzzy-404 на всех роутах             | —                              |
| E20 | UX states + PII redaction                                | 2    | M (2-3)   | 7 (T48-A/B/C/D, T36-A/B/D, T26-C, T59-C)                 | Понятные ошибки, PII не утекает                 | E03                            |
| E21 | Web perf: code-split + bundle budget + rendering hygiene | 3    | L (4-5)   | 11 (T40-B/C/D, T65-A/B/C/D, T45-A/B/C/D)                 | TTI/LCP вниз, рендер-гигиена                    | —                              |
| E22 | Mobile/PWA responsive                                    | 3    | XL (8+)   | 4 (T66-A/B/C/D)                                          | Реальный mobile + offline-UX                    | E21                            |
| E23 | i18n foundation                                          | 3    | L (4-7)   | 4 (T46-A/B/C/D)                                          | Единый язык UI, задел на локали                 | —                              |
| E24 | Image storage abstraction + upload                       | 3    | L (4-7)   | 3 (T54-A/C/D)                                            | Сменable storage, upload для пользователей      | E02                            |
| E25 | Feature flags + kill switches + CSRF hard mode           | 3    | M/L (3-5) | 4 (T70-A/B/C/D)                                          | Управление фичами и инцидентами                 | E10                            |
| E26 | External integrations + AI provider scaffold             | 3    | L (4-7)   | 4 (T69-A/B/C/D)                                          | Готовый каркас LLM/webhook/интеграций           | E25                            |
| E27 | Pagination API unification                               | 3    | M (2-3)   | 4 (T42-A/B/C/D)                                          | Единый паттерн пагинации во всех списках        | —                              |
| E28 | RLS финал: auth-bootstrap + остаток таблиц               | 3    | XL (8+)   | 1+ (T27-B)                                               | Полная DB-изоляция тенантов                     | E09, решение по auth-bootstrap |

Покрытие: ~163 из ~180 уникальных находок; остаток — попутные P3, закрывающиеся в рамках перечисленных эпиков.

---

## Часть 2. Декомпозиция эпиков

### E01. CI-гейты качества — Фаза 1, M (2-3 pd)

- **Закрывает:** T28-A (integration в CI), T28-B (Playwright e2e в CI), T28-C (coverage), T44-A (`pnpm audit`), T25-C (хардкод списка тестов).
- **Зависит от:** —. **Блокирует:** E09/E11-E16 (все автотесты получают гейт).
- **Риск:** низкий. CI-раннер уже имеет Postgres (pgvector) + Redis сервисы в ci.yml.
- **План:**
  1. `.github/workflows/ci.yml`, тест-job: после «Apply migrations» добавить `INTEGRATION_DATABASE_URL` + шаг `pnpm --filter @multichef/api test:integration` (джоба уже экспортирует RUN_DB_INTEGRATION=1).
  2. Отдельный job `e2e`: Playwright (chromium) против временного `next start`; в nightly-варианте.
  3. Coverage: `c8 --reporter=text --reporter=lcov` в api/web test-скриптах; порог вначале 0% (измерение), рост — отдельными PR.
  4. `pnpm audit --prod --audit-level=high` отдельным job (allowlist через `.npmrc`/audit-ci).
  5. T25-C: перевести api/web test-скрипты на glob (`src/**/*.test.ts`) — новые тесты подхватываются автоматически.
- **Acceptance:** все джобы зелёные на HEAD; искусственно сломанный integration-тест роняет CI.
- **Метрика:** CI-time ≤ 12 мин; 0 silent-регрессий за 2 недели.
- **Регресс-тесты:** сам CI и есть регресс-гейт.

### E02. imageKey: contract validation (🔴 P1) — Фаза 1, S (0.5 pd)

- **Закрывает:** T54-B.
- **Зависит от:** —. **Блокирует:** E24.
- **Риск:** низкий (нужно проверить, что сид-данные проходят валидацию).
- **План:**
  1. `packages/contracts/src/recipes.ts:34` — `imageKey: z.string().nullable()` → `z.string().regex(/^\/images\/recipes\//).nullable()` (только whitelisted внутренний путь).
  2. `apps/web/src/app/(app)/recipe/[id]/components/Header.tsx` + `OptionCard.tsx`: рендер только при прохождении схемы (fallback на placeholder уже есть).
  3. Проверить сид-данные: `SELECT count(*) FROM "Recipe" WHERE "imageKey" NOT LIKE '/images/recipes/%'` → миграция/скрипт чистки при необходимости.
- **Acceptance:** unit-тест contracts отклоняет `data:text/html`, `https://evil`, `javascript:`; существующие сид-ключи проходят.
- **Метрика:** 0 P1 в бэклоге.
- **Регресс-тесты:** contracts unit + e2e recipe-страница с битым imageKey → placeholder.

### E03. Error-code governance + prisma-errors v2 — Фаза 1, M (2-3 pd)

- **Закрывает:** T38-A (conventions.md отстал), T38-C (7 мёртвых кодов), T38-D (несогласованные коды), T64-C (fallback 500 без exhaustiveness), T64-D (только P2002).
- **Зависит от:** —. **Блокирует:** E20.
- **Риск:** низкий/средний — замена generic-ошибок на специфичные меняет тела ответов; сверить с web-клиентами.
- **План:**
  1. `error-envelope.ts`: ErrorCode → `satisfies Record<ErrorCode, number>` + `assertExhaustive` при маппинге; удалить 7 мёртвых кодов или внедрить.
  2. Синхронизировать `docs/api/conventions.md` с реальным enum (~30 кодов) — генерировать таблицу из кода скриптом.
  3. `prisma-errors.ts`: добавить P2025 → NOT_FOUND, P2003 → CONFLICT/BOUND, P2014; пробросить с корректными кодами.
  4. T38-D: pantry/profile — единый стиль специфичных кодов (PANTRY_ITEM_NOT_FOUND / NUTRITION_PROFILE_NOT_FOUND).
- **Acceptance:** `pnpm typecheck` ловит незнакомый код (negative-тест); таблица в conventions.md генерируется скриптом и совпадает.
- **Метрика:** 0 ответов с кодом, отсутствующим в enum; 0 500-х на известные Prisma-коды.
- **Регресс-тесты:** unit на `STATUS_BY_CODE` exhaustiveness; integration на P2025-сценарий.

### E04. Rate limiting overhaul — Фаза 1, M (2-3 pd)

- **Закрывает:** T39-A (per-IP), T39-B (trustProxy), T39-C (health под троттлером), T39-D (ThrottlerException мимо фильтра), T62-B/C (дубли), T24-D (per-endpoint на тяжёлых).
- **Зависит от:** —. **Блокирует:** Redis-storage (фаза 2 опционально).
- **Риск:** средний — слишком строгий лимит ломает multi-screen UX; начинать с либеральных значений.
- **План:**
  1. `main.ts`: `trustProxy` из env (`TRUST_PROXY` default `127.0.0.1` — текущее поведение сохранено).
  2. Кастомный `ThrottlerGuard`-трекер: `userId` из сессии при наличии, иначе IP.
  3. `@SkipThrottle()` на health-контроллер.
  4. `APP_FILTER`/`@Catch(ThrottlerException)` маппинг → наш `RATE_LIMITED` envelope + `Retry-After`.
  5. `@Throttle` на тяжёлых: `POST /meal-plans` (5/мин), `/recommendations/*` (30/мин), `/shopping-lists/:id/complete` (10/мин).
- **Acceptance:** health 1000 запросов → 0×429; 11-й login с одного IP → 429 с нашим envelope; разные user-agent/IP — независимые bucket'ы.
- **Метрика:** 0 ложных 429 на штатных сценариях (e2e прогон); load-smoke 300 rpi без 429.
- **Регресс-тесты:** unit на guard (user-aware key); e2e «11 логинов → 429 RATE_LIMITED».

### E05. HTTP-surface security: cookies + CORS + TLS/headers — Фаза 1, L (3-5 pd)

- **Закрывает:** T32-A (Path=/), T32-B (TTL 30 дней), T32-C (`__Host-`), T32-D (SAMESITE=none), T41-A (CSRF header в CORS), T41-B (Retry-After exposed), T41-C/D (CORS_ORIGINS default/wildcard), T24-A (TLSv1/1.1), T24-B (X-Frame-Options).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** средний — смена cookie-имени/Path логаутит всех пользователей (приемлемо, разово); `__Host-` требует Secure+без Domain — проверить LAN-деплой без TLS.
- **План:**
  1. Cookie-имя из env (`SESSION_COOKIE_NAME`, default `mc_session`); на HTTPS-деплое — `__Host-mc_session`.
  2. Path=/ → Path=/api/v1/auth (проверить: cookie читают только auth-роуты; web ходит через nginx на /api/v1 — совместимо).
  3. `SESSION_TTL_SECONDS` default 30д → 7д (решение зафиксировать в ADR).
  4. env.schema: refine `SAMESITE=none → COOKIE_SECURE=true`.
  5. main.ts CORS: `allowedHeaders: [...,'X-CSRF-Token']`, `exposedHeaders: [...,'Retry-After']`; origin из env (уже есть) — задокументировать прод-значение.
  6. nginx: `ssl_protocols TLSv1.2 TLSv1.3;` + `add_header X-Frame-Options DENY always;` + CSP для web (next.config/middleware) c nonce/report-only первым шагом.
- **Acceptance:** curl-проверки заголовков; e2e login→today работает; 429 содержит Retry-After; SSL-тест (sslscan/testssl) — только TLS1.2/1.3.
- **Метрика:** securityheaders.com-чеклист локально — A-; 0 CSRF_MISMATCH регрессий в e2e.
- **Регресс-тесты:** auth integration (register/login/logout); e2e happy-path.

### E06. DB indexes — Фаза 1, M (2-3 pd)

- **Закрывает:** T49-A (MealPlan [householdId,status]), T49-B (PrepTask [prepSessionId,sequence]), T49-C (HouseholdMember [userId,role]), T49-D (Job partial QUEUED/PROCESSING), T61-A (Recipe keyset), T61-B (Job dedup), T61-C (ShoppingList [householdId,status]), T61-D (substitutesFor).
- **Зависит от:** E14 (методика CONCURRENTLY). **Блокирует:** —.
- **Риск:** средний — блиц-локи на проде при CREATE INDEX; выполнить CONCURRENTLY вручную/скриптом, миграция — только регистрация.
- **План:**
  1. Замерить `EXPLAIN (ANALYZE, BUFFERS)` каждого проблемного запроса до.
  2. Скрипт `scripts/create-indexes-concurrently.sh` (psql, CREATE INDEX CONCURRENTLY IF NOT EXISTS).
  3. Миграция-регистрация (без DDL) + `prisma.$queryRaw` в тестах проверяют наличие.
  4. Повторный EXPLAIN — index scan.
- **Acceptance:** все 8 запросов используют Index Scan; время /recipes p95 ↓.
- **Метрика:** pg_stat_user_indexes — idx_scan > 0 на новых индексах.
- **Регресс-тесты:** integration suite зелёная; EXPLAIN-снапшот в FIXES-доке.

### E07. Domain utilities: money + date — Фаза 1, S/M (1-2 pd)

- **Закрывает:** T52-A (formatKopecks dup), T52-B (float input), T52-D (int/100), T50-A (mixed formats), T50-B (lexicographic), T50-C (TZ ambiguity), T50-D (manual split).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. `packages/ui/src/money.ts` (или web lib): `formatRub(kopecks)`, `parseRubToKopecks(input): int` (запрет float).
  2. Заменить дубликаты в BudgetProgress/ShoppingClient/SetupClient.
  3. `apps/web/src/lib/expiry.ts`: парсинг через Zod-схему `YYYY-MM-DD` + валидация `purchaseDate <= expiresAt` на уровне дат, не строк.
  4. pantry.dto: `.regex(/^\d{4}-\d{2}-\d{2}$/)` + `z.coerce.date()` в сервисе.
- **Acceptance:** unit-тесты на 1 копейку / високосный год / TZ-края; 221+ web-тест зелёные.
- **Метрика:** 0 дублирующихся реализаций (grep), 0 регрессий UX.
- **Регресс-тесты:** unit money roundtrip; unit date-boundary.

### E08. Multi-tab cache sync — Фаза 1, S (1 pd)

- **Закрывает:** T29-A (logout не чистит кэш в других вкладках — privacy), T29-B (нет sync), T29-C (single-entry cache).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. `usePantry`/`usePreferences`: ключ кэша = `${userId}:${query}` вместо single-entry.
  2. `storage` event / BroadcastChannel `mc-logout` → сброс кэшей во всех вкладках.
  3. Logout-хендлер уже чистит кэш текущей вкладки (сделано ранее) — добавить broadcast.
- **Acceptance:** e2e/ручной: logout в Tab A → Tab B (неактивная) сбрасывает кэш; мутация в Tab B видна в Tab A после refocus.
- **Метрика:** 0 stale-данных при тесте двух вкладок.
- **Регресс-тесты:** unit на cache-key; e2e multi-tab.

### E09. Unit-тесты security-critical сервисов — Фаза 1, M (2-3 pd)

- **Закрывает:** T25-A (withTenantContext без тестов), T25-B (meal-plans/shopping/auth без unit).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. `packages/database/src/__tests__/with-tenant-context.unit.test.ts`: мок-Prisma — проверка set_config(args), проброс результата, rollback при ошибке.
  2. auth.service unit: register (P2002→409), login (timing-safe ветки), logout/logoutAll.
  3. meal-plans unit: generatePrepSession fast-path/build (моки tx), P2034-retry, winner-fallback.
  4. shopping-lists unit: fitBudget-классификация, applyProposal SUBSTITUTE/DROP.
- **Acceptance:** покрытие packages/database/src/index.ts и 3 сервисов ≥ 70% statements; `pnpm test` зелёный.
- **Метрика:** c8-отчёт: критичные файлы ≥70%.
- **Регресс-тесты:** сами тесты; добавить в CI-coverage отчёт (E01).

### E10. Env-validation unification — Фаза 2, M (2-3 pd)

- **Закрывает:** T55-A (worker без валидации), T55-B=T37-A (fixture-флаги), T55-C (скрипты мимо loadServerEnv), T55-D=T37-C (4 копии base URL), T37-B (localhost default), T37-D (нет build-time assertion).
- **Зависит от:** —. **Блокирует:** E25.
- **Риск:** низкий/средний — worker начнёт падать при битом env (это и требуется, fail-fast).
- **План:**
  1. `apps/worker/src/main.ts`: `loadWorkerEnv()` (REDIS_URL, DATABASE_URL, concurrency) — fail-fast.
  2. `webEnvSchema` + `NEXT_PUBLIC_USE_RECIPE_FIXTURES/USE_MEALPLAN_MOCK` (boolean, default false) + assertion в next.config: fixture-флаги запрещены при NODE_ENV=production.
  3. `lib/site-url.ts` — единственный источник SITE_URL; robots/sitemap/layout/PwaRegister переходят на него.
  4. Скрипты пакетов database — через `loadServerEnv()`.
- **Acceptance:** `DATABASE_URL=битый pnpm worker` падает с понятной ошибкой; `NEXT_PUBLIC_USE_RECIPE_FIXTURES=true` в prod-сборке → build error.
- **Метрика:** 0 прямых `process.env` чтений вне config (grep-гейт в CI).
- **Регресс-тесты:** unit на site-url; env-coverage тест расширен.

### E11. Worker/BullMQ hardening + worker health — Фаза 2, L (4-6 pd)

- **Закрывает:** T21-A (runWithMirror COMPLETED), T21-B (no attempts/backoff/DLQ), T53-A (lockDuration), T53-B (defaultJobOptions/removeOn), T53-D (failed-jobs endpoint), T58-D (backpressure), T51-A (worker healthcheck), T51-B (queue depth в ready).
- **Зависит от:** E09 (тесты). **Блокирует:** E12.
- **Риск:** средний — изменение retry-политики влияет на семантику джоб; тестировать идемпотентность.
- **План:**
  1. `Worker` opts: `lockDuration: 120_000`, `stalledInterval: 30_000`, `maxStalledCount: 2`; queue `defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 86_400, count: 500 }, removeOnFail: { age: 604_800 } }`.
  2. `runWithMirror`: гарантированный `status=COMPLETED` на void-путях (try/finally).
  3. Failed jobs: `GET /api/v1/admin/jobs/failed` (owner-only) + `POST .../retry`.
  4. Worker health: HTTP :3002 `/health/live` (process) + `/health/ready` (Redis ping, job loop alive); API `/health/ready` — доп. проверка queue depth < N.
  5. Backpressure: лимит одновременных GENERATE_PLAN на household (уже есть дедуп; добавить Redis-счётчик).
- **Acceptance:** убить worker mid-job → джоба вернулась в очередь и выполнилась; failed-джобы видны в endpoint; k8s-проба видна.
- **Метрика:** 0 stalled-джоб в smoke; queue depth в health.
- **Регресс-тесты:** integration на job-runner (COMPLETED-статус, retry, DLQ).

### E12. Worker observability + safe errors + correlation-id — Фаза 2, M (2-3 pd)

- **Закрывает:** T59-A (console.log), T59-B (сырой error клиенту), T59-D (нет correlation-id), T64-B (worker ошибки без доменных кодов), T26-A (Job.error raw meta), T21-C (структурный логгер).
- **Зависит от:** E11. **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. Общий `createLogger(scope)` (pino или минимальный JSON-логгер) для api+worker; в джобу пробросить `jobId` + `correlationId` (из HTTP x-request-id).
  2. `mirror.setError`: сохранять только `{ code, message: sanitized }` — без стека; PII-скраб.
  3. Доменные коды ошибок worker → JobDto.error (EMPTY_RESCUE и т.п.).
- **Acceptance:** лог worker — однострочный JSON с jobId/correlationId; `Job.error` не содержит стека/SQL; e2e plan-generation проходит.
- **Метрика:** grep журнала — 0 сырых стектрейсов; correlation-id связывает HTTP и job-лог.
- **Регресс-тесты:** unit на error-sanitizer; интеграционный — failing job → аккуратный JobDto.error.

### E13. DB pool tuning + metrics — Фаза 2, M (2-3 pd)

- **Закрывает:** T35-A (POOL_MAX unused), T35-B (нет max/ssl), T35-D (application_name), T68-A (дубль), T68-B (таймауты), T68-C (singleton не тестируется), T68-D (нет метрик).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** средний — таймауты могут рвать длинные миграции; выставить консервативно и задокументировать.
- **План:**
  1. `getPrisma()`: PrismaPg с `max: DATABASE_POOL_MAX`, `connectionTimeoutMillis: 5_000`, `statement_timeout: 15_000`, `idle_in_transaction_session_timeout: 10_000`, `application_name: 'multichef-api'|'multichef-worker'`.
  2. Опционально SSL по env (`DATABASE_SSL=true` для будущего облака).
  3. `/health/ready`: добавить pool stats (totalCount/idle/waiting) в JSON.
  4. Экспорт singleton для тестов (T68-C) — фабрика `createPrismaClient(env)` + кэш.
- **Acceptance:** `pg_stat_activity.application_name` различает api/worker; нагрузочный смоук 50 rps — без pool-ошибок.
- **Метрика:** pool waitingCount = 0 при 50 rps; latency p95 без деградации.
- **Регресс-тесты:** unit на фабрику (env → конфиг pool); integration зелёная.

### E14. Migration safety — Фаза 2, M (2-3 pd)

- **Закрывает:** T33-A (без CONCURRENTLY), T33-B (без BEGIN/COMMIT), T33-C (mc086 locks), T33-D (без rollback).
- **Зависит от:** E06 (методика применяется сначала там). **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. Конвенция в CONTRIBUTING: DDL-индексы — только через CONCURRENTLY-скрипт + миграция-регистрация; каждый миграционный каталог получает `rollback.sql`.
  2. Дописать rollback.sql для mc086–mc089.
  3. Проверочный прогон rollback на multichef_test + повторный deploy.
- **Acceptance:** deploy-скрипт на копии прод-схемы не берёт AccessExclusiveLock дольше 1с; rollback.sql каждого миграционного каталога исполняется без ошибок.
- **Метрика:** время миграций на проде < 5с.
- **Регресс-тесты:** ручной чек-лист + проверка в CI (grep-конвенция).

### E15. OpenAPI completeness — Фаза 2, L (4-5 pd)

- **Закрывает:** T34-A (12 схем), T34-B (0 @ApiResponse в household), T34-C (5xx не документирован), T34-D (ErrorEnvelope), T63-A (DTO без @ApiProperty), T63-B (error-коды), T63-C (version 0.0.0), T63-D (отключён в prod), T23-C (enum-касты).
- **Зависит от:** E03 (коды ошибок). **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. Зарегистрировать недостающие Zod-схемы в `zod-swagger.ts` (PantryItem, ShoppingList, MealPlan, Profile, Preference, NutritionProfile, Ingredient, ErrorEnvelope).
  2. DTO-классы: добавить `@ApiProperty` через nestjs-zod интеграцию; household/meal-plans/shopping — common error `@ApiResponse` (401/403/404/422/429 + 5xx).
  3. `openapi.version` из package.json; включить `/api/v1/docs` в pre-prod (за флагом).
  4. Убрать 4 enum-каста через корректную типизацию @ApiQuery.
- **Acceptance:** swagger-JSON содержит схемы всех 45 эндпойнтов; spectral-lint без errors.
- **Метрика:** 100% роутов с @ApiResponse; version ≠ 0.0.0.
- **Регресс-тесты:** CI-шаг валидации swagger-артефакта.

### E16. A11y wave — Фаза 2, L (4-5 pd)

- **Закрывает:** T22-A/B (PantryDialog/aria-live), T47-A/B/C/D (focus management), T67-A (keyboard), T67-B (dialog hook), T67-C (skip-link), T67-D (aria-describedby), T30-A (reduced-motion), T30-B (skip-link dup), T30-C (axe в CI), T30-D (LoadingClient aria).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** средний (фокус-менеджмент затрагивает UX) — фиксировать скриншотами.
- **План:**
  1. `useDialogA11y` hook: initial focus, focus-return, Escape, aria-labelledby (PantryDialog/AddPantryItem/Edit/Confirm/BottomSheet).
  2. Skip-link в root layout; `aria-describedby`/`aria-invalid` на полях форм.
  3. LoadingClient: role="progressbar" + aria-valuenow + aria-live.
  4. globals.css: reduced-motion → `transition: none`.
  5. axe-pages.spec уже есть — расширить на (app)-страницы с авторизацией; CI-nightly шаг.
- **Acceptance:** axe 0 violations на 8+ страницах (включая авторизованные); клавиатурный проход всех диалогов.
- **Метрика:** axe violations = 0; Lighthouse a11y ≥ 95.
- **Регресс-тесты:** e2e axe-спеки; unit на useDialogA11y.

### E17. ULID unification — Фаза 2, M (2-3 pd)

- **Закрывает:** T56-A (3 копии fake-ulid), T56-B (API без ulid), T56-C (web UUID vs backend ULID), T56-D (Math.random).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** средний — смена генератора ID; новые сущности получают ULID, старые данные не трогаем.
- **План:**
  1. `packages/contracts/src/ulid.ts` (или shared lib): monotonic ULID (Crockford base32), crypto.randomUUID fallback.
  2. Заменить 3 копии в seed/scripts; API: генерация id через общий хелпер (или `@default(ulid())` в Prisma где возможно).
  3. web rescue-session: crypto.getRandomValues ULID.
- **Acceptance:** unit: 26 символов Crockford, монотонность, уникальность 10k; e2e не ломается.
- **Метрика:** 0 копий самописного ulid (grep); 0 коллизий в smoke 10k.
- **Регресс-тесты:** unit ulid-хелпера.

### E18. Seed idempotency + advisory lock — Фаза 2, M (2-3 pd)

- **Закрывает:** T60-A (dedup по title), T60-B (неатомарно), T60-C (категории по name), T60-D (advisory lock), T55-C (скрипты без env).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** средний — перезапись сид-данных на проде; тестировать на multichef_test.
- **План:**
  1. `pg_advisory_xact_lock(hashtext('multichef-seed'))` в начале seed.
  2. Рецепты: upsert по `slug` (добавить колонку+unique), ингредиенты в одной транзакции с рецептом.
  3. Категории: slug-дедуп.
  4. T55-C: скрипты через `loadServerEnv()`.
- **Acceptance:** двойной запуск seed подряд → 0 дублей, 0 ошибок; параллельный запуск → второй ждёт лок.
- **Метрика:** idempotency-прогон ×2 → идентичный checksum данных.
- **Регресс-тесты:** integration seed-тест на идемпотентность.

### E19. Zod path/params unification — Фаза 2, S/M (1-2 pd)

- **Закрывает:** T31-A/B/C/D (ULID/path валидация), T23-A (unsafe cast setPurchased/setDone).
- **Зависит от:** —. **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. Общий `UlidParamsSchema` в contracts; контроллеры pantry/recipes/shopping/meal-plans/recommendations — единый ZodValidate-pipe на params.
  2. `setPurchased`/`setDone`: DTO-классы вместо unsafe cast.
  3. Удалить dead-code `TodayParamsSchema` (T31-D) или внедрить.
- **Acceptance:** `GET /shopping-lists/not-ulid` → 400 VALIDATION_ERROR (было fuzzy-404); 400-контракт одинаков на всех роутах.
- **Метрика:** 0 `as unknown as` в контроллерах (grep-гейт).
- **Регресс-тесты:** unit DTO; integration negative-кейсы.

### E20. UX states + PII redaction — Фаза 2, M (2-3 pd)

- **Закрывает:** T48-A (PlanClient raw error), T48-B (toast-only), T48-C (not-found.tsx), T48-D (skeleton), T36-A (SECRET_KEYS PII), T36-B (частично закрыто), T36-D (NOAUTH), T26-C (BullMQ plaintext), T59-C (params scrub).
- **Зависит от:** E03, E12. **Блокирует:** —.
- **Риск:** низкий.
- **План:**
  1. `app/not-found.tsx` (ru) + error-компонент с retry для PlanClient/ShoppingClient; skeleton для TodayClient.
  2. `SECRET_KEYS` + PII-набор (email, userId, householdId, notes); применить к Job.error/BullMQ payload (скраб при enqueue).
- **Acceptance:** 404 на произвольном URL — русская страница; ошибки PlanClient — структурированная карточка с retry; Job.error/BullMQ payload без PII (grep-тест).
- **Метрика:** 0 raw error.message в UI; 0 PII-ключей в Redis-пейлоаде (тест).
- **Регресс-тесты:** unit redact-функций; e2e 404-страница.

### E21. Web perf & rendering hygiene — Фаза 3, L (4-5 pd)

- **Закрывает:** T40-B (bundle-analyzer), T40-C (Inter font), T40-D (no dynamic), T65-A (no code-split), T65-B (lucide tree-shake), T65-C (contracts sideEffects), T65-D (loading.tsx), T45-A (memo), T45-B (inline arrows), T45-C (exhaustive-deps), T45-D (refetch runaway).
- **Зависит от:** —. **Блокирует:** E22.
- **Риск:** средний.
- **План:**
  1. `@next/bundle-analyzer` + baseline-отчёт; budget в CI (size-limit).
  2. `next/font/google` Inter; `next/dynamic` для roulette/generate/prep; `loading.tsx` на (app)-сегментах.
  3. `contracts`: `"sideEffects": false`; ESLint `react-hooks/exhaustive-deps` + исправления.
  4. `React.memo(PantryItemCard)` + устранение inline-props; useCallback на горячих путях.
- **Acceptance:** size-limit пороги зелёные; Lighthouse TTI/LCP улучшение ≥ 20%; 0 stale-closure багов.
- **Метрика:** JS-chunk /recipe/[id] -30%; INP < 200мс.
- **Регресс-тесты:** size-limit в CI; существующие web-тесты.

### E22. Mobile/PWA responsive — Фаза 3, XL (8+ pd)

- **Закрывает:** T66-A (0 breakpoints), T66-B (SW precache), T66-C (manifest icons), T66-D (viewport scale).
- **Зависит от:** E21. **Блокирует:** —.
- **Риск:** высокий (глобальная вёрстка) — поэтапно по табам, скриншот-регрессии.
- **План:** breakpoints sm/md/lg на ключевых экранах → SW: precache оболочки + runtime-cache для plan/shopping/recipe → manifest: 192/512 PNG + apple-touch-icon → viewport userScalable. Приёмка: Playwright viewport-снапшоты 375/768/1280; Lighthouse PWA-аудит; offline-смоук.
- **Метрика:** Lighthouse PWA installable; 0 горизонтальных скроллов на 375px.

### E23. i18n foundation — Фаза 3, L (4-7 pd)

- **Закрывает:** T46-A (RU/EN mix в API), T46-B (нет i18n lib), T46-C (locale unused), T46-D (tz unused).
- **Зависит от:** E03 (единый словарь кодов). **Блокирует:** —.
- **Риск:** средний (объём строк).
- **План:** словари ru в `apps/web/src/i18n/ru.ts`; next-intl на web; API: сообщения ошибок из словаря по User.locale; отобразить tz в UI (expiration по локальному времени).
- **Acceptance:** 0 EN-строк в UI при locale=ru; API-ошибки на ru; переключение locale меняет формат дат.
- **Метрика:** i18n-coverage скрипт = 100% ключей.

### E24. Image storage abstraction + upload — Фаза 3, L (4-7 pd)

- **Закрывает:** T54-A (404 ассетов), T54-C (нет абстракции), T54-D (нет upload).
- **Зависит от:** E02. **Блокирует:** —.
- **Риск:** средний (миграция ключей).
- **План:** интерфейс `ImageStorage` (local → S3-совместимо); endpoint `POST /recipes/:id/image` (owner, валидация mime/size); миграция ключей; отдача через nginx X-Accel.
- **Acceptance:** upload → resize → отдача; смена драйвера конфигом; 0 404 на существующих.
- **Метрика:** 100% imageKey проходят валидацию драйвера.

### E25. Feature flags + kill switches + CSRF hard mode — Фаза 3, M/L (3-5 pd)

- **Закрывает:** T70-A (flags), T70-B (runtime switch), T70-C (CSRF toggle), T70-D (kill-switch генерации).
- **Зависит от:** E10. **Блокирует:** —.
- **План:** env-based flag-реестр (Zod) + админ-endpoint (owner-only) для kill-switch генерации джоб; CSRF_HARD_MODE c миграцией клиентов; приёмка — включение/выключение флагов без деплоя.

### E26. External integrations + AI scaffold — Фаза 3, L (4-7 pd)

- **Закрывает:** T69-A (AI provider), T69-B (ключи unused), T69-C (Sentry без SDK), T69-D (webhook-шаблон).
- **План:** AiProvider интерфейс + HTTP-клиент (timeout/retry/circuit-breaker) за feature-флагом E25; Sentry SDK по DSN; webhook-каркас (signature + idempotency по конвенциям §3).
- **Acceptance:** мок-LLM в тестах; Sentry события в staging; webhook-спека задокументирована.

### E27. Pagination API unification — Фаза 3, M (2-3 pd)

- **Закрывает:** T42-A/B/C/D.
- **План:** единый контракт `{ items, total?, nextCursor? }` (conventions.md §2), pantry → cursor, ingredients отдают total, добавляется `GET /meal-plans/prep-tasks`; web-клиенты обновляются синхронно.
- **Acceptance:** контракты-тесты на всех списках; web-флоу пагинации работает.

### E28. RLS финал — Фаза 3, XL — по решению владельца

- **Закрывает:** T27-B + полное закрытие T4.
- **План:** ADR-изменение по auth-bootstrap (register/login вне RLS-контекста: отдельная роль/политики auth-mode) → перевод auth/household/jobs сервисов → ENABLE/FORCE на Session/User/Household/HouseholdMember/Job → приёмочные пробы (как в wave-2).
- **Acceptance:** SQL-проба cross-tenant = 0 на всех 15 таблицах; auth-флоу e2e зелёный.
- **Предусловие:** явное продуктовое решение (наивное включение ломает login) — см. ADR-0023.

---

## Сводка покрытия

| Фаза                 | Эпиков | Закрывает находок | Кумулятивно            |
| -------------------- | ------ | ----------------- | ---------------------- |
| Фаза 1 (недели 1-4)  | 10     | ~49               | 49                     |
| Фаза 2 (недели 5-10) | 11     | ~74               | 123                    |
| Фаза 3 (месяцы 2-3)  | 7      | ~42               | ~165                   |
| Дубли/попутные P3    | —      | ~15-20            | ~180 (полное покрытие) |
