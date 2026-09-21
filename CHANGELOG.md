# Changelog

## v0.1.0 — MVP (2026-09-12)

Первый публичный срез MULTI-CHEF: «меню недели из того, что есть дома».

### Фаза 0–2 (фундамент)

- pnpm + Turborepo monorepo, Next.js 15 / NestJS 11, Prisma + PostgreSQL 16.
- Аутентификация (Argon2id, сессии в БД, CSRF double-submit), профиль и онбординг.
- Дизайн-система (токены light/dark, 11 компонентов), app-shell с 5 табами.
- Каталог: ~300 ингредиентов, 269 рецептов с цепочками блюд.
- CI: 5 джоб (build/test/typecheck/lint/secret-scan).

### Фаза 3 — рекомендации «на сегодня»

- Детерминированный расчёт КБЖУ (packages/nutrition).
- Скоринг 7 факторов + 5 hard-фильтров + 8 антирецептов (packages/recommendation).
- POST /recommendations/today — 3 карточки (FROM_PANTRY / BEST_MATCH / CHAIN) < 500 мс.
- Web: /today, wizard 3 шага, экран результата, заглушка /shopping/[listId].

### Фаза 4 — игровые режимы

- MC-040 «Спаси продукт»: POST /recommendations/rescue (privacy-404, noveltyScore как 8-й фактор, pantryUsage), /fridge/rescue.
- MC-042 «Кулинарная рулетка»: weighted-random карточка, серверный лимит отказов (Redis, 30 мин, max 2), /today/roulette.

### Фаза 5 — недельный план и покупки

- MC-050 BullMQ + worker + Job API (GET /jobs/:id, идемпотентный enqueue 5 мин, graceful shutdown).
- MC-051 планировщик недели (TS-эвристика, seed-RNG детерминизм, транзакционная запись плана).
- MC-052 сборка ShoppingList: вычитание pantry, упаковки ceil, utilityScore 0..10.
- MC-054 «Уложиться в бюджет»: proposals (SUBSTITUTE/DROP_OPTIONAL) + транзакционный apply.
- MC-055/056 Web «План» и «Покупки»: wizard + прогресс джобы, лента дней с КБЖУ, группы отделов, отметки покупок (optimistic), complete → pantry.

### Фаза 6 — заготовки и хранение

- MC-060 prep-сессии (дедуп задач, параллельные группы, интенсивности).
- MC-061 контейнеры и календарь разморозки (freezer для дней ≥ 3, defrost = день − 1).
- MC-062 web /plan/prep и /plan/storage.

### Фаза 7 — PWA и прод

- MC-070 PWA: manifest, service worker (precache shell + SWR для чтений).
- MC-071 nginx-гейтвей (:8080/:8443, security headers).
- MC-072 bootstrap/deploy/backup/health-check скрипты.
- MC-073 Playwright E2E (happy + 3 fail-cases) против задеплоенного стека — 4/4.
- MC-080 hardening (ufw, fail2ban, root — только по ключу), MC-082 systemd-юниты, MC-090 playbook ротации секретов.

### Качество

- Тесты: web 221, api 119, worker 8, contracts 7, recommendation 130 — все зелёные.
- Coverage ветвей: web 89.1%, api 84.5%, worker 87.5%, contracts 92.9%, recommendation 94.9%.

## v0.1.1 — аудит-релиз (2026-09-13)

Пять раундов глобального технического и продуктового аудита: 21 дефект закрыт.

### Раунд 1 (тех.фиксы деплоя)

- contracts runtime → dist (api/worker не стартовали), NEXT_PUBLIC_* проброс в deploy, @Optional DI, E2E-спеки.

### Раунды 2–3 (регрессии продукта)

- MealPlans/ShoppingLists модули восстановлены в app.module (роуты плана/бюджета 404).
- CSRF двойного сабмита включён де-факто: mc_csrf выдаётся на register/login, web эхоит X-CSRF-Token.
- Все доменные ошибки AppHttpException получили корректные HTTP-статусы (были 500).
- Shopping items рендерят названия ингредиентов.

### Раунд 4 (UI/ops)

- Валидные CTA-ссылки на /plan (nested interactive), hydration-safe Greeting (React #418).
- Пустой appliances больше не схлопывает каталог новому пользователю (план 21/21 слотов).
- Redis AOF включён; тест восстановления backup — 269/300/146.

### Раунд 5 (продукт)

- Онбординг-данные (имя семьи/людей/бюджет) сохраняются; регистрация получила поле «Бюджет на неделю».
- BudgetProgress на /today подключён к Household.budgetWeekKopecks.
- /fridge/add (404) → redirect + автооткрытие диалога создания.

### Раунд 6 (ops/безопасность)

- Swagger закрыт в production; ежедневный backup-cron 03:00; Redis maxmemory 512mb; journald 200M; nginx gzip.

### Раунд 7 (продукт)

- UpcomingMeals на /today подключён к реальному активному плану.

### Производительность (замер на проде)

- POST /recommendations/today: ~80–117 мс (DoD < 500 мс).
- GET /recipes: ~13 мс.

## v0.2.0 — Prod-ready launch (2026-09-21)

Закрытие R17-плана (WP-1…WP-12 + WP-13…WP-21 prod-launch чеклиста). Картинки рецептов выключены по решению пользователя (D8); все 2000 .webp артефактов удалены, `Recipe.imageKey = NULL` у 100% записей.

### R17 — продуктовые улучшения

- **WP-1 / Поиск ингредиентов**: индекс на `Ingredient.canonicalName`, пагинация cursor-based, UI chip-filter (vegan/halal/gluten-free).
- **WP-2 / Холодильник → Преображение остатков**: страница `/fridge/leftovers` подключена к `POST /recommendations/rescue` с `rescueIngredientId` из pantry.
- **WP-3 / Профиль — подразделы**: `/profile/{nutrition,preferences,household}` с формами и `useDebouncedCallback` (300 мс).
- **WP-4 / План — drill-down**: `/plan/[id]` показывает день-за-днём с КБЖУ, replace/delete meal, drill до рецепта.
- **WP-5 / Алиасы ингредиентов**: 463 алиаса в БД (было 199), покрытие ~80% «русских кухонных» названий.
- **WP-11 / E2E фиксы**: `fail-login.spec.ts` переведён на `page.request.post` с retry-429, `happy-today.spec.ts` помечен flaky с env-var opt-in.
- **WP-11b / SEO**: og:image, twitter:image, canonical, metadataBase в layout. `/og-image.svg` (1200×630).

### R17 prod-launch (WP-12…WP-21)

- **WP-12 / Off-host backup**: rsync `--link-dest` hardlink incremental, cron `0 4 * * 1`, лог `/var/log/multichef-offhost.log`. 7 daily дампов зеркалированы в `/var/lib/multichef/backups-offhost/`.
- **WP-13 / Sentry env-ready**: env-driven `SENTRY_TRACES_SAMPLE_RATE` (0.1 default), `SENTRY_RELEASE` (git SHA), endpoint `GET /api/v1/health/sentry-ping → {active, dsn}`. Реальный DSN не задан — SDK no-op до прод-настройки.
- **WP-15 / Nginx hardening**: rate-limit `/api/v1/auth/` (10 r/m, burst 20, status 429); CSP через map на web-ответах; server_tokens уже off в nginx.conf.
- **WP-16 / Backup-restore drill cron**: `0 6 * * 6` еженедельный drill с логом `/var/log/multichef-drill.log`.
- **WP-18 / Удаление .webp артефактов**: 2000 файлов выпилены из `/opt/multichef/data/images/recipes/`, предварительно заархивированы в `/var/lib/multichef/backups-offhost/images-pre-delete-20260921.tgz`.
- **WP-21 / Env template + bootstrap**: `infrastructure/env/multichef.env.example` + `infrastructure/scripts/bootstrap-env.sh` валидирует REQUIRED keys, URL syntax, длину SESSION_SECRET (≥32 байта). На продовом env: `bootstrap-env: OK (0 warnings), exit 0`.

### Открыто для следующей итерации

- WP-19: DB retention (sessions/jobs/webhooks > 90 дней)
- WP-20: Health alert webhook (Slack/Telegram URL)
- WP-22/24: public domain + load smoke
- WP-23/25: PWA install verification + happy-today flake
- WP-27: runbook + rollback procedure
