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
