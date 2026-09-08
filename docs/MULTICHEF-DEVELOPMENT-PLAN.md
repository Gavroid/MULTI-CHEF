# MULTI-CHEF — Мастер-план разработки (Development Plan)

**Версия:** 1.0 | **Дата:** 2026-09-08 | **Статус:** baseline для исполнения
**Связанные документы:**
- `MULTICHEF-ARCHITECTURE-PRD.md` — архитектура, БД, API, UI/UX (источник требований)
- `MULTICHEF-TESTING-STRATEGY.md` — методики тестирования и проверки (обязателен к применению в каждой задаче)
- Репозиторий: `github.com/Gavroid/MULTI-CHEF`
- Прод-хост: LXC `multichef` (192.168.1.95), Ubuntu 24.04, 4 vCPU / 4 GiB

---

## 0. Как устроен этот план

Каждая задача описана по единому шаблону:

| Поле | Значение |
|---|---|
| **Цель** | Что должно появиться в продукте/инфраструктуре |
| **Scope** | Какие пути репозитория затрагиваются (никаких работ вне scope без согласования) |
| **Шаги** | Ключевые действия реализации (не полная спецификация кода — см. PRD) |
| **Проверка** | Воспроизводимые команды верификации с ожидаемым результатом |
| **Тесты** | Обязательный минимум тестов (детали — в TESTING-STRATEGY) |
| **DoD** | Бинарные критерии приёмки: каждый либо выполнен, либо нет |
| **Оценка** | Инженерные часы (чистое время исполнителя, без ревью) |

**Глобальные гейты, действующие на КАЖДУЮ задачу (не дублируются в DoD):**

```
G1. pnpm lint           — 0 errors
G2. pnpm format:check   — чисто
G3. pnpm typecheck      — 0 errors (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
G4. pnpm test           — 100% зелёных, новые доменные расчёты ≥ 90% покрытия ветвей
G5. pnpm build          — успешная production-сборка всех затронутых пакетов
G6. gitleaks / secret-scan — чисто (ни одного секрета в diff)
G7. OpenAPI /api/v1/docs отражает все изменённые эндпоинты
G8. PR содержит: ссылку на задачу, список изменений, скриншоты UI (для web-задач), отчёт о проверках
```

**Правило ветвления:** `feature/MC-XXX-short-name` → PR → CI зелёный → squash-merge в `main`. Conventional Commits. Прямые пуши в `main` запрещены (branch protection).

**Правило эскалации:** если задача не укладывается в оценку ×1.5 — исполнитель останавливается и эскалирует менеджеру проекта с объяснением, а не «дожимает» срезая тесты.

---

## ADR-0006 (обязателен первым коммитом документации): модель деплоя

Исходное ТЗ предполагало Docker Compose в проде. Блок 6 PRD (более новый) фиксирует **bare-metal systemd внутри LXC**: host-пакеты PostgreSQL 16 и Redis 7, Next.js standalone из `/var/lib/multichef/web/`, NestJS и worker — systemd-юниты под пользователем `multichef_app`, Nginx gateway на :80/:443.

**Решение:** прод = systemd bare-metal (Блок 6 приоритетен). Docker остаётся только для: (а) dev-окружения разработчика, (б) Testcontainers в integration-тестах, (в) опционального docker-образа для будущей миграции. ADR-0006 документирует это решение в `docs/decisions/`.

---

## ФАЗА 0. Фундамент (репозиторий, CI, схема БД)

### MC-001. Scaffold monorepo
- **Цель:** работающий каркас pnpm + Turborepo.
- **Scope:** корень репо, `apps/web`, `apps/api`, `apps/worker` (заглушка), `packages/{contracts,database,config,eslint-config,typescript-config,ui}`.
- **Шаги:** pnpm workspace; Turborepo pipeline (lint/typecheck/test/build с кешированием); Next.js 15 (App Router, TS strict) в `apps/web`; NestJS + Fastify в `apps/api` (глобальный префикс `/api/v1`, `trust proxy`); общий `tsconfig.base.json` со strict-флагами из PRD §23; pin Node LTS через `.nvmrc` + `engines`.
- **Проверка:** `pnpm install && pnpm dev` → web отвечает на :3000 (200), api на :3001/api/v1/health/live (200). `curl -s localhost:3001/api/v1/health/live | jq .status` = `"ok"`.
- **Тесты:** smoke unit-тест в каждом пакете (что jest/vitest-runner работает).
- **DoD:** G1–G5; `pnpm build` собирает web+api; README с командами запуска; каталог проекта в workspace переименован в `multi-chef` (ASCII-дефис, устранение U+2011 — PRD §6.1.1).
- **Оценка:** 6–8 ч.

### MC-002. Dev-инфраструктура и переменные окружения
- **Цель:** воспроизводимое dev-окружение.
- **Scope:** `compose.yml` (dev: postgres:16-alpine + redis:7-alpine с healthchecks), `.env.example`, `packages/config`.
- **Шаги:** compose с healthcheck (`pg_isready`, `redis-cli ping`); `.env.example` со ВСЕМИ ключами из PRD §19 (значения — плейсдеры); `packages/config` — Zod-валидация env при старте api/worker (приложение падает с понятной ошибкой при отсутствии переменной).
- **Проверка:** `docker compose up -d && docker compose ps` → оба сервиса `healthy`; запуск api с пустым env → ошибка валидации с именем отсутствующей переменной.
- **Тесты:** unit на config-схему (валидный/невалидный env).
- **DoD:** G1–G5; `.env.example` покрывает 100% переменных, читаемых кодом (проверка скриптом grep `process.env`).
- **Оценка:** 3–4 ч.

### MC-003. Prisma schema — полная модель данных
- **Цель:** вся схема Блока 3 PRD в коде.
- **Scope:** `packages/database/prisma/schema.prisma`, первая миграция, `prisma/seed/` каркас.
- **Шаги:** 21 модель по PRD §3.2 (User, Session, Household, HouseholdMember, NutritionProfile, Preference, IngredientCategory, Ingredient, IngredientAlias, IngredientNutrition, PantryItem, Recipe, RecipeIngredient, RecipeNutrition, StorageRule, MealPlan, MealPlanDay, MealPlanEntry, ShoppingList, ShoppingListItem, PrepSession, PrepTask, PreparedPortion, Job); первая миграция; кастомная SQL-миграция с индексами PRD §3.3 (включая GIN trigram и частичный уникальный «один ACTIVE план»); расширения `pg_trgm`, `unaccent`, `vector`.
- **Проверка:** `pnpm prisma migrate reset --force` на чистой БД → успех; `pnpm prisma validate`; `psql -c '\di'` показывает все 9 индексов из §3.3; `psql -c "SELECT extname FROM pg_extension"` содержит pg_trgm/unaccent/vector.
- **Тесты:** integration (Testcontainers): вставка/каскадное удаление MealPlan→Day→Entry; нарушение частичного уникального индекса (второй ACTIVE план) → ошибка БД.
- **DoD:** G1–G5; денежные поля — `Int` (копейки), питательные — `Decimal`; ни одного `Float` для денег.
- **Оценка:** 8–10 ч.

### MC-004. Документация и регламенты
- **Цель:** AGENTS.md + ADR + README по PRD §21.
- **Scope:** `AGENTS.md`, `README.md`, `docs/decisions/0001..0006`, `docs/api/conventions.md`.
- **Проверка:** документы существуют, ADR-0006 описывает systemd-деплой; conventions.md фиксирует формат ошибок, пагинацию, идемпотентность из PRD §4.1.
- **DoD:** AGENTS.md содержит обязательные проверки и запреты (включая §6.6 правила секретов).
- **Оценка:** 3 ч.

### MC-005. CI pipeline + secret scanning
- **Цель:** автоматические гейты на каждый PR.
- **Scope:** `.github/workflows/ci.yml`, Husky, lint-staged, commitlint.
- **Шаги:** jobs: install → lint → typecheck → unit → integration (services: postgres/redis в GHA) → build → gitleaks → (опц.) dependency-scan; кеш pnpm; матрица не нужна (один Node LTS); branch protection на `main`: require PR + status checks.
- **Проверка:** тестовый PR с осознанной ошибкой линта → CI красный; PR с строкой `PASSWORD=supersecret123` в diff → gitleaks блокирует; нормальный PR → зелёный.
- **DoD:** G1–G6 воспроизводятся в CI; badge в README; commitlint отклоняет `git commit -m "fix stuff"`.
- **Оценка:** 4–6 ч.

---

## ФАЗА 1. Auth, профиль, дизайн-система

### MC-010. Backend: аутентификация
- **Scope:** `apps/api/src/modules/auth`, `users`.
- **Шаги:** register/login/logout; Argon2id (params: m=64MiB, t=3, p=4); Session в Postgres (храним SHA-256 от токена, не токен); cookie `mc_session` (HttpOnly, Secure, SameSite=Lax, 30 дней, rotation при каждом продлении); CSRF double-submit (`mc_csrf` + заголовок `X-CSRF-Token` на всех мутациях); rate limit 10/мин/IP на auth; временная блокировка после 5 неудачных (15 мин, Redis); `GET/DELETE /auth/sessions`.
- **Проверка:** `curl -c jar -X POST .../auth/login` → Set-Cookie с флагами; запрос мутации без CSRF-заголовка → 403; 6-й неудачный логин → 429.
- **Тесты:** integration: полный flow register→login→logout; чужая сессия не даёт доступ; rotation инвалидирует старый токен; rate limit срабатывает; пароль нигде не логируется (spy на logger).
- **DoD:** G1–G7; Argon2id-хеш начинается с `$argon2id$`; время логина константно для существующего/несуществующего email (timing-safe).
- **Оценка:** 10–12 ч.

### MC-011. Backend: профиль, предпочтения, онбординг
- **Scope:** `apps/api/src/modules/{profiles,users}`.
- **Шаги:** `GET /profile`, `PATCH /profile/nutrition`, `PUT /profile/preferences` (полная замена, транзакция), `POST /profile/onboarding`, `GET /profile/export` (GDPR JSON), `DELETE /profile` (soft-delete + purge-задача через 30 дней).
- **Проверка:** после onboarding `GET /profile` возвращает созданные NutritionProfile и Preference[]; PUT preferences с kind=ALLERGY отражается в выдаче.
- **Тесты:** unit на DTO-валидацию; integration на транзакционность PUT (при ошибке — откат всех Preference).
- **DoD:** G1–G7; export включает все персональные данные пользователя; удаление недоступно без подтверждения паролем.
- **Оценка:** 6–8 ч.

### MC-012. Web: дизайн-система и токены
- **Scope:** `packages/ui`, `apps/web/src/styles`.
- **Шаги:** CSS-переменные из PRD §2.5.1–2.5.3 (light/dark через `data-theme`); Tailwind-конфиг маппит токены; компоненты: Button, Chip, Input, Card, Badge, Toast, BottomSheet, Skeleton, ProgressBar, Stepper, SegmentedControl; Storybook (или отдельная `/dev/ui` страница) со всеми состояниями.
- **Проверка:** скриншоты всех состояний в PR; контраст пар текст/фон ≥ 4.5:1 (проверка любым contrast-checker, отчёт в PR); переключение темы без FOUC.
- **Тесты:** snapshot-тесты компонентов (Testing Library + Vitest).
- **DoD:** G1–G5; touch-target интерактивных элементов ≥ 44px (проверка в devtools); `prefers-reduced-motion` отключает анимации.
- **Оценка:** 10–12 ч.

### MC-013. Web: app-shell и навигация
- **Scope:** `apps/web/src/app/(app)`, `components/navigation`.
- **Шаги:** layout `max-width: 480px; margin: 0 auto`; BottomTabBar (5 табов, иконки 24px, бейджи на «Покупки»/«Холодильник», safe-area inset); страницы-заглушки 5 табов; theme toggle в профиле-заглушке.
- **Проверка:** на iPhone-эмуляции таб-бар не перекрыт home-indicator; на desktop 1440px контент центрирован 480px-колонкой; бейдж показывает число из мок-стейта.
- **Тесты:** компонентный тест активного таба; e2e-заглушка навигации по 5 табам.
- **DoD:** G1–G5; навигация работает с клавиатуры (Tab/Enter, видимый focus-ring).
- **Оценка:** 6 ч.

### MC-014. Web: auth-экраны и wizard онбординга
- **Scope:** `apps/web/src/app/(auth)`, `app/(public)`, `features/onboarding`.
- **Шаги:** `/auth/login`, `/auth/register` (React Hook Form + Zod, inline-ошибки по §2.5.4); wizard 7 шагов по PRD §2.3.1 (прогресс-бар, «Пропустить», дефолты, свайп-анимация slide-left 200ms); guest-режим: анкета → localStorage; при регистрации `guestProfile` передаётся в `POST /auth/register` и мигрирует на сервер.
- **Проверка:** ручной прогон: гость проходит анкету → регистрируется → `GET /profile` содержит данные анкеты; валидация email/пароля (min 8, 1 буква+1 цифра) inline.
- **Тесты:** компонентные на wizard-шаги; e2e «guest → register → данные сохранены».
- **DoD:** G1–G5; ни один шаг не теряет введённые данные при «Назад».
- **Оценка:** 8–10 ч.

---

## ФАЗА 2. Справочники и холодильник

### MC-020. Seed-справочники: ингредиенты и категории
- **Scope:** `packages/database/prisma/seed/ingredients*.ts`, `infrastructure/scripts/seed-database.sh`.
- **Шаги:** 8 категорий (порядок = sortOrder отделов магазина); ~300 ингредиентов с canonicalName, aliases (обязательно пары помидор/томат, кабачок/цуккини, сметана/сливки…), packageSize/Unit, avgPriceKopecks, defaultShelfDays{Fridge,Pantry,Freezer}, ediblePartRatio; IngredientNutrition из открытых источников (source зафиксирован).
- **Проверка:** `seed-database.sh` дважды → второй прогон идемпотентен (upsert, 0 дублей: `SELECT canonicalName, COUNT(*) ... HAVING COUNT(*)>1` пусто); spot-check 10 ингредиентов на реалистичность цен/упаковок.
- **Тесты:** fixture-тест: каждый ингредиент имеет nutrition-запись; нет ингредиентов без категории.
- **DoD:** G1–G5; seed воспроизводим на чистой БД за < 60 сек.
- **Оценка:** 8–12 ч (контентная работа).

### MC-021. Backend: поиск ингредиентов
- **Scope:** `apps/api/src/modules/ingredients`.
- **Шаги:** `GET /ingredients?search=&limit=` — pg_trgm similarity + unaccent + поиск по alias, ранжирование (exact > prefix > trigram); кеш Redis 1ч для популярных запросов.
- **Проверка:** `?search=помидор` и `?search=томаты` → один и тот же ingredient.id; `?search=памидор` (опечатка) → тот же результат; ответ < 100 мс на seed-данных.
- **Тесты:** integration: регистр, опечатки, alias, пустая выдача; unit на ранжирование.
- **DoD:** G1–G7; limit ≤ 50 принудительно.
- **Оценка:** 4–5 ч.

### MC-022. Backend: Pantry CRUD
- **Scope:** `apps/api/src/modules/pantry`.
- **Шаги:** CRUD по PRD §4.3; автоподстановка expiresAt из defaultShelfDays по storageLocation; estimatedGrams пересчёт через density для ML/PIECE; householdId всегда из сессии.
- **Проверка:** POST без expiresAt с storageLocation=FRIDGE для молока → expiresAt = today + shelfDaysFridge; попытка PATCH чужого item (другой household) → 404.
- **Тесты:** integration: изоляция household (два пользователя не видят продукты друг друга); unit на пересчёт единиц.
- **DoD:** G1–G7; массовое добавление (до 20 позиций) — одним батч-эндпоинтом `POST /pantry-items/batch`.
- **Оценка:** 6 ч.

### MC-023. Web: «Холодильник»
- **Scope:** `apps/web/src/app/(app)/fridge`, `features/fridge`.
- **Шаги:** экран `/fridge` (сегменты хранения, бейджи сроков по цветовой шкале §2.3.6, свайп-действия, секция «Всегда дома» свёрнута); `/fridge/add` (поиск debounce 300ms, чипы популярного, bottom-sheet формы, multi-add с undo-toast); optimistic add/delete с rollback при ошибке.
- **Проверка:** ручной прогон: добавить «молоко» чипом → появилось с бейджем срока; свайп → «использовать срочно» → priority=USE_FIRST; offline-симуляция → toast об ошибке + rollback.
- **Тесты:** компонентные (бейдж срока: >5д зелёный, 3–5 жёлтый, ≤2 красный — граничные значения); e2e «добавить продукт».
- **DoD:** G1–G5; скелетоны при загрузке; empty-state с CTA.
- **Оценка:** 10–12 ч.

---

## ФАЗА 3. Рецепты, КБЖУ, рекомендации «на сегодня»

### MC-030. Пакет nutrition: детерминированный расчёт КБЖУ
- **Scope:** `packages/nutrition`.
- **Шаги:** формулы PRD §3.4 (ingredient→recipe→serving→entry→day); учёт ediblePartRatio; масло жарки как ингредиент; `calculationVersion`; округление только на границе отображения.
- **Проверка / Тесты:** fixture-тесты с зафиксированными ожиданиями (100 г куриного филе / 200 г риса / 10 г масла → точные ккал/Б/Ж/У); property-тест: nutrition(recipe) == Σ nutrition(ingredients) при любом наборе; тест смены порций (servings ×2 → ровно ×2).
- **DoD:** G1–G5; покрытие ветвей ≥ 90%; пакет не импортирует ничего из apps/*.
- **Оценка:** 5–6 ч.

### MC-031. Seed: 200+ рецептов с цепочками
- **Scope:** `packages/database/prisma/seed/recipes*.ts`.
- **Шаги:** 200–300 рецептов: title, servings, prep/cookMinutes, difficulty, instructions (массив шагов), mealTypes, tags, requiredAppliances, chainTags (≥ 20 цепочек по 2–4 блюда: «лаваш-неделя», «курица-3-дня»…), leftoverSourceOf (пюре/рис/котлеты/курица/овощи/каша), RecipeIngredient с grams и optional, автопересчёт RecipeNutrition через `packages/nutrition`; StorageRule для категорий; изображения-плейсхолдеры `/images/recipes/*.webp` (допускается generative placeholder единого стиля).
- **Проверка:** скрипт метрики связности: «≥ 30% ингредиентов встречаются в ≥ 3 рецептах» — вывод в консоль, порог в CI; каждый chainTag покрывает ≥ 2 рецепта.
- **Тесты:** fixture: у каждого рецепта ≥ 3 ингредиентов, все ingredientId существуют, nutrition пересчитана (calculationVersion актуален).
- **DoD:** G1–G5; seed идемпотентен; распределение по mealTypes: ≥ 40 ужинов, ≥ 30 завтраков, ≥ 30 обедов, ≥ 15 перекусов.
- **Оценка:** 16–24 ч (контентная работа, распараллеливается).

### MC-032. Пакет recommendation: scoring и фильтры
- **Scope:** `packages/recommendation`.
- **Шаги:** scoring PRD §3.5 (7 факторов с весами); hard filters (аллергия/EXCLUDE, техника, dietType, maxTime, антирецепт-маппинг: NO_OVEN→исключить requiredAppliances=[OVEN], ONE_PAN→tag «одна сковорода», NOT_CHICKEN_AGAIN→исключить вчерашний главный белок, NO_LEFTOVERS→исключить блюда с обязательными остатками); объяснимость — score разложен по факторам (для плашки «почему это блюдо»).
- **Тесты:** unit на каждый фактор (граничные значения 0/1); unit на каждый hard filter; fixture: известный pantry + каталог → известный топ-3 с зафиксированными score.
- **DoD:** G1–G5; чистые функции без I/O (вход: данные, выход: ранжированный список с разложенным score).
- **Оценка:** 8–10 ч.

### MC-033. Backend: рецепты и рекомендации «на сегодня»
- **Scope:** `apps/api/src/modules/{recipes,recommendations}`.
- **Шаги:** `GET /recipes` (фильтры mealType/maxMinutes, cursor-пагинация), `GET /recipes/:id` (+ nutrition + storageRules); `POST /recommendations/today` — синхронно < 500 мс: 3 карточки (FROM_PANTRY = max pantryMatch при toBuy ≤ 2 позиции; BEST_MATCH = max score; CHAIN = лучший chainTag-кластер 2–4 блюда); TemplateAiProvider собирает explanation из разложенного score (сроки, остатки, общие ингредиенты).
- **Проверка:** `time curl -X POST .../recommendations/today` < 500 мс на seed-данных; в ответе ровно 3 options в заданном порядке типов; explanation содержит конкретный факт (имя продукта со сроком или общий ингредиент цепочки).
- **Тесты:** integration на все три типа; контрактные тесты на схему ответа (Zod parse ответа); пустой pantry → FROM_PANTRY деградирует корректно (не падает).
- **DoD:** G1–G7; ответ включает `nutritionAccuracy: "ESTIMATED"`.
- **Оценка:** 8–10 ч.

### MC-034. Web: «Сегодня» + wizard генерации + результат
- **Scope:** `apps/web/src/app/(app)/today`, `features/recommendations`.
- **Шаги:** `/today` по PRD §2.3.2 (приветствие, «использовать срочно», hero-кнопка, бюджет-прогресс, 4 быстрых сценария, ближайшие блюда, ссылка на рулетку); wizard `/today/generate` 3 шага; экран загрузки со стадиями; `/today/result` — 3 карточки §2.3.4 (бейджи типов, плашка объяснения, мини-таймлайн цепочки); «Готовлю это» → создаёт MealPlan + ShoppingList → deep-link на список.
- **Проверка:** ручной прогон полного пути; скриншоты 3 карточек; skeleton при загрузке; быстрый сценарий «Ничего не покупать» предзаполняет wizard (budgetMode=NOTHING) и скипает его.
- **Тесты:** компонентные карточек; e2e «получить рекомендацию и принять».
- **DoD:** G1–G5; плашка объяснения присутствует на каждой карточке; empty-state при отсутствии продуктов.
- **Оценка:** 12–14 ч.

### MC-035. Web: страница рецепта
- **Scope:** `apps/web/src/app/(app)/recipe/[id]`.
- **Шаги:** фото-хедер, степпер порций с живым пересчётом граммовок и КБЖУ (клиентский расчёт из RecipeNutrition), табы Ингредиенты/Шаги/КБЖУ/Хранение, чекбоксы «есть дома» (сверка с pantry), дисклеймер-плашка §2.5.7, липкая кнопка «Добавить в план».
- **Проверка:** порции 2→4 удваивают граммы и КБЖУ; ингредиент из pantry отмечен галочкой.
- **Тесты:** компонентные пересчёта порций.
- **DoD:** G1–G5; дисклеймер КБЖУ виден без скролла на табе КБЖУ.
- **Оценка:** 6–8 ч.

---

## ФАЗА 4. Игровые режимы (после MC-033, параллелятся)

### MC-040. «Спаси продукт»
- **Scope:** api `recommendations` + web `/fridge/rescue`.
- **Шаги:** `POST /recommendations/rescue {ingredientId}` — hard filter «рецепт содержит продукт», форсированный expirationBenefit, сортировка очевидные→необычные (difficulty asc → novelty tag); плашка «Использует X г из Y г».
- **Проверка:** rescue(творог) → все результаты содержат творог; продукт с expiresAt=завтра всплывает в блоке «использовать срочно» на /today и ведёт сюда с предвыбором.
- **Тесты:** integration фильтра; компонентный плашки граммовок.
- **DoD:** G1–G7; пустой результат → честный empty-state «подходящих рецептов нет» + предложение добавить продукт в исключения.
- **Оценка:** 5–6 ч.

### MC-041. «Преображение остатков»
- **Scope:** api `recommendations` + web `/fridge/leftovers`.
- **Шаги:** `POST /recommendations/leftovers {leftoverKinds[], freeText?}` — подбор по Recipe.leftoverSourceOf; freeText → `AiProvider.extractPantryItems` (MVP: словарный матчер, LLM за feature flag); карточки формата «Было → Станет».
- **Проверка:** leftovers([BOILED_RICE]) → в выдаче жареный рис/запеканка; свободный текст «две котлеты» → маппинг в CUTLET.
- **Тесты:** unit маппера freeText→kind (10 фиксированных фраз); integration подбора.
- **DoD:** G1–G7; неизвестный текст не роняет запрос (fallback: популярные трансформации).
- **Оценка:** 5–6 ч.

### MC-042. «Кулинарная рулетка»
- **Scope:** api `recommendations` + web `/today/roulette`.
- **Шаги:** endpoint с серверным счётчиком отказов (Redis, TTL сессии 30 мин, max 2); web: закрытая карточка, flip-анимация 500ms, кнопка «Другое» с оставшимися попытками, при 0 — disabled «Судьба выбрана»; принятие → автосоздание ShoppingList.
- **Проверка:** третья попытка отказа → 409/отказ с пояснением; после «Беру!» активный список покупок существует.
- **Тесты:** integration счётчика (включая попытку обойти с клиента); компонентный flip/disabled-состояний.
- **DoD:** G1–G7; обход лимита невозможен с клиента (сервер — источник истины).
- **Оценка:** 5–6 ч.

### MC-043. Антирецепт-фильтры
- **Scope:** `packages/recommendation` + web wizard.
- **Шаги:** полный маппинг 8 антирецептов из PRD §2.3.3 на hard filters; фильтры живут только в `generationSettings` запроса, не сохраняются в профиль.
- **Тесты:** параметризованный unit-тест: каждый антирецепт → ожидаемый эффект на фикстурном каталоге.
- **DoD:** G1–G5; фильтры видны в теле запроса (DevTools) и не попадают в `Preference`.
- **Оценка:** 3–4 ч.

---

## ФАЗА 5. Недельный план + список покупок (ядро)

### MC-050. BullMQ, worker, Job API
- **Scope:** `apps/worker`, `apps/api/src/modules/jobs`, Redis-очередь `planning`.
- **Шаги:** worker-приложение из тех же модулей; Job-модель в Postgres как зеркало статусов; `GET /jobs/:id` (404 чужим); идемпотентность (дедупликация по `householdId+type+paramsHash` в течение 5 мин); graceful shutdown.
- **Проверка:** повторный POST с теми же параметрами → тот же jobId; `GET /jobs/:id` чужим пользователем → 404; kill -TERM worker во время задачи → job не теряется (requeue).
- **Тесты:** integration идемпотентности и graceful shutdown (Testcontainers redis).
- **DoD:** G1–G7; прогресс обновляется стадиями (queued→filtering→scoring→optimizing→building-list→done).
- **Оценка:** 8 ч.

### MC-051. Планировщик недельного меню (TS-эвристика)
- **Scope:** `packages/recommendation/planner`, worker processor.
- **Шаги:** пайплайн PRD §3.5: hard filter → scoring → жадная раскладка по (день × mealType) → 5–10 итераций локальных замен (минимизация дневного отклонения КБЖУ и бюджета) → приоритет цепочкам (кандидат с ≥ 2 общими ингредиентами получает бонус) → noCookDays заполняются «сборными» блюдами (prep=0, только разогрев) → запись MealPlan+Days+Entries транзакцией → статус ACTIVE (старый ACTIVE → ARCHIVED в той же транзакции).
- **Проверка:** генерация 7×3 плана < 60 сек на seed-каталоге; `SELECT` показывает 21 entry; дневное отклонение калорий от цели ≤ 10% (метрика в job-логе); repeatPolicy=NO_REPEAT → ни одного повторного recipeId.
- **Тесты:** fixture-план: известный каталог+параметры → детерминированный план (seed RNG); тесты noCookDays, repeatPolicy, отклонения КБЖУ; property-тест: сумма порций дня ≥ mealsPerDay × peopleCount… (по entries).
- **DoD:** G1–G5; генерация воспроизводима при фиксированном seed; метрики качества плана пишутся в Job.resultRef-отчёт.
- **Оценка:** 14–18 ч.

### MC-052. Сборка ShoppingList
- **Scope:** `packages/recommendation/shopping`, worker.
- **Шаги:** Σ grams всех entries − pantry.estimatedGrams (STAPLE вычитаются полностью) → округление до packageSize (ceil) → utilityScore = f(число блюд с ингредиентом, доля расхода упаковки, LOVE-бонус) → estimatedTotal → группировка по categoryId с sortOrder.
- **Проверка / Тесты:** fixture-тест: известный план + известный pantry → известный список с точными упаковками (например, потребность 700 г филе при упаковке 500 г → 2 уп.); тест «продукт есть дома → не попадает в список»; тест «STAPLE (соль, масло) не покупается».
- **DoD:** G1–G5; каждый item имеет utilityScore 0–10 и packageQuantity ≥ 1.
- **Оценка:** 8–10 ч.

### MC-053. Замена блюда в плане
- **Scope:** api `meal-plans`.
- **Шаги:** `replace-meal` (3 альтернативы: ±10% калорий, та же mealType, hard filters) → `apply-replacement` транзакция: замена entry → пересчёт day totals → пересчёт ShoppingList (diff: новые/удалённые/изменённые позиции).
- **Проверка:** после замены day totals изменились ровно на дельту КБЖУ; ShoppingList diff корректен (ингредиент старого блюда без других потребителей удалён).
- **Тесты:** integration транзакции (ошибка на mid-шаге → откат всего); unit подбора альтернатив.
- **DoD:** G1–G7; source заменённого entry = REPLACED.
- **Оценка:** 8 ч.

### MC-054. «Уложиться в бюджет»
- **Scope:** api `shopping-lists`, `packages/recommendation`.
- **Шаги:** `fit-budget` генерирует proposals в порядке: SUBSTITUTE (RecipeIngredient.substitutesFor или дешевле ≥ 30% той же категории) → DROP_OPTIONAL (optional=true) → MERGE_MEALS (замена двух блюд одним); `apply-proposal` применяет транзакционно с пересборкой списка.
- **Проверка:** fixture: корзина 6500 ₽ при лимите 5800 ₽ → после применения proposals итог ≤ 5800 ₽; каждый proposal показывает savingKopecks.
- **Тесты:** unit генерации proposals (порядок, приоритеты); integration apply.
- **DoD:** G1–G7; невозможность уложиться → честный ответ с минимально достижимой суммой.
- **Оценка:** 8 ч.

### MC-055. Web: «План»
- **Scope:** `apps/web/src/app/(app)/plan`, `features/meal-plan`.
- **Шаги:** `/plan/setup` wizard 4 шага §2.3.11 (автопредложение Б/Ж/У 30/30/40 от калорий); экран прогресса job (polling 1.5s, стадии, уход со страницы не отменяет job); `/plan` — календарь-лента, карточки приёмов, дневные КБЖУ-прогресс-бары с отклонением %, свайп «Заменить» → bottom-sheet 3 альтернатив; вкладки Меню/Заготовка/Хранение.
- **Проверка:** ручной прогон setup→progress→plan; прогресс-бары соответствуют API-данным; замена блюда обновляет бар и список покупок.
- **Тесты:** компонентные прогресс-баров (границы 0%/100%/>100%); e2e «создать недельный план».
- **DoD:** G1–G5; дисклеймер КБЖУ на экране дня; skeleton при генерации.
- **Оценка:** 14–16 ч.

### MC-056. Web: «Покупки»
- **Scope:** `apps/web/src/app/(app)/shopping`, `features/shopping-list`.
- **Шаги:** аккордеон-группы по отделам со счётчиками; строка товара §2.3.14 (чекбокс 28px, упаковки, цена, utilityScore с tooltip); свайп «Заменить дешевле»/«Убрать»; бюджетный прогресс + плашка превышения + wizard fit-budget; optimistic purchased (PATCH фоном, rollback при ошибке); «Куплено всё» → сводка + зачисление в pantry (`POST /shopping-lists/:id/complete`).
- **Проверка:** отметка при выключенной сети → rollback + toast; complete → продукты появились в /fridge с purchaseDate=today.
- **Тесты:** компонентные optimistic-логики; e2e «отметить покупки и завершить».
- **DoD:** G1–G5; свайп-действия с подтверждением для «Убрать».
- **Оценка:** 12 ч.

---

## ФАЗА 6. Заготовки и хранение (после MC-051)

### MC-060. PrepSession-генератор
- **Scope:** worker, `packages/recommendation/prep`.
- **Шаги:** `POST /prep-sessions` → job: из активного плана + StorageRule собрать PrepTask[]: дедупликация операций («нарезать овощи для 3 блюд» — одна задача), parallelGroup (пассивное время: варка/духовка → параллельные активные задачи), sequence по зависимостям; intensity отсекает задачи сверх targetMinutes (MINIMAL_15: только нарезка/раскладка; FULL_WEEK: всё + подписи контейнеров).
- **Проверка:** fixture-план → задачи: суммарное активное время ≤ targetMinutes; задача «варить крупу» в одной parallelGroup с «нарезать овощи»; sequence топологически корректен (нет задачи «разложить» раньше «остудить»).
- **Тесты:** unit планировщика задач на фикстурах всех 4 интенсивностей.
- **DoD:** G1–G5; каждая задача имеет durationMinutes и понятный title.
- **Оценка:** 10 ч.

### MC-061. PreparedPortion и календарь разморозки
- **Scope:** api `meal-plans`, worker.
- **Шаги:** распределение entries по контейнерам (containerNumber, portion); useBefore по StorageRule.maxHoursFridge/maxDaysFreezer; storageMethod (FREEZE_OK→FREEZER для дней > 3, иначе FRIDGE); defrostAt = день использования − 1 (разморозка в холодильнике); addBeforeServing из правил; `GET /meal-plans/:id/storage`.
- **Проверка:** блюдо пятницы с FREEZE_OK → storageMethod=FREEZER, defrostAt=четверг; салат (NO_PREP) не получает контейнер, попадает в «добавить перед подачей».
- **Тесты:** fixture-тесты распределения и дат.
- **DoD:** G1–G7; никакое блюдо не хранится в холодильнике дольше maxHoursFridge.
- **Оценка:** 8 ч.

### MC-062. Web: «Заготовка» и «Хранение»
- **Scope:** `apps/web/src/app/(app)/plan/[id]/{prep,storage}`.
- **Шаги:** `/prep` — таймлайн задач с чекбоксами, бейдж «одновременно» для parallelGroup, прогресс хедера, экран «Всё готово!»; `/storage` — табы Морозилка/Холодильник/Добавить перед подачей, карточки контейнеров §2.3.13, календарь разморозки с точками-событиями.
- **Проверка:** отметка всех задач → экран завершения; контейнер показывает «достать из морозилки: четверг вечер».
- **Тесты:** компонентные таймлайна и карточек контейнера.
- **DoD:** G1–G5; прогресс prep-сессии переживает перезагрузку (server-side done).
- **Оценка:** 10 ч.

---

## ФАЗА 7. PWA, прод-инфраструктура, релиз

### MC-070. PWA
- **Scope:** `apps/web` (Serwist, manifest, sw).
- **Шаги:** precache app-shell + изображений активного плана; runtime stale-while-revalidate для `GET /meal-plans/active`, `/shopping-lists/active`, `/recipes/*` (TTL 24ч); IndexedDB-очередь отметок purchased (last-write-wins sync); offline-плашка; manifest + иконки 192/512 maskable + iOS splash; install-баннер после 2-го визита.
- **Проверка:** DevTools → Application: SW активен, manifest валиден; авиарежим → список покупок и меню открываются; отметка offline → после сети синхронизирована (200 на PATCH).
- **Тесты:** e2e offline-сценарий (Playwright context offline).
- **DoD:** G1–G5; Lighthouse PWA-аудит: installable, offline-ready.
- **Оценка:** 10 ч.

### MC-071. Nginx gateway на прод-хосте
- **Scope:** `infrastructure/nginx/`.
- **Шаги:** конфиг по PRD §16 (proxy_pass БЕЗ завершающего слэша, сохранение пути `/api/v1`); security headers (CSP, nosniff, Referrer-Policy, Permissions-Policy); `client_max_body_size 10m`; web:3000 и api:3001 только на 127.0.0.1.
- **Проверка:** `curl -I localhost/` → 200 + все security headers; `curl localhost/api/v1/health/live` → 200; `ss -tlnp` на хосте: 3000/3001/5432/6379 слушают только 127.0.0.1.
- **Тесты:** конфиг-тест `nginx -t` в CI (контейнер).
- **DoD:** G1–G5; trust proxy включён только для 127.0.0.1.
- **Оценка:** 4 ч.

### MC-072. Инфраструктурные скрипты (по PRD §6.7)
- **Scope:** `infrastructure/scripts/`.
- **Шаги/DoD:** точно по таблице MC-072.1–072.5 PRD (bootstrap идемпотентен — двойной прогон, `diff` пуст; deploy.sh: preflight→backup→pull→build→migrate→restart→smoke→health→rollback; backup с ротацией 7/4/6 + **обязательный тест восстановления** из дампа на чистой БД; health-check.sh; rotate-ssh-keys.sh атомарный). В deploy.sh — маскирующий фильтр секретов и проверка актуальности INVENTORY.md.
- **Проверка:** полный прогон deploy.sh на multichef; затем намеренно сломанная миграция → автоматический rollback → health зелёный на предыдущей версии.
- **Оценка:** 12–16 ч.

### MC-073. E2E Playwright
- **Scope:** `tests/e2e/`.
- **Шаги:** 9 сценариев PRD §24: регистрация; онбординг; добавление продуктов; рекомендация «на сегодня»; генерация недельного плана; замена блюда; список покупок; отметки покупок; план заготовки. Запуск против staging-контура (docker compose с seed-данными).
- **Проверка:** `pnpm test:e2e` зелёный локально и в CI (nightly, не блокирует PR — отдельный workflow).
- **DoD:** каждый сценарий с screenshot-артефактами при падении; flaky-rate < 5% за 10 прогонов.
- **Оценка:** 12 ч.

### MC-074. Наблюдаемость
- **Scope:** Sentry/GlitchTip SDK (web+api+worker), Umami-события (9 событий PRD §32), Uptime Kuma монитор `/api/v1/health/ready`, алертинг auditd-логов (PRD §6.6 п.5).
- **Проверка:** тестовая ошибка → событие в Sentry с requestId, без PII/секретов в payload; Umami получает `weekly_plan_completed` после e2e-генерации.
- **DoD:** G1–G5; scrubbing-конфиг Sentry вырезает cookies/Authorization/email.
- **Оценка:** 6 ч.

### MC-075. Релизный чек-лист 0.1.0
- Восстановление из pg_dump на чистой БД — успешно (протокол в PR).
- `prisma migrate deploy` на staging-копии — успешно.
- gitleaks по всей истории репо — чисто.
- Ручной QA на iOS Safari и Android Chrome: 12 юзкейсов UC-01…UC-12 — пройдены, чек-лист подписан скриншотами.
- Lighthouse: Performance ≥ 80, Accessibility ≥ 95 на /today.
- Нагрузочный smoke: 20 RPS на `GET /recipes` 60 сек → p95 < 300 мс, 0 ошибок 5xx (k6 или autocannon).
- **Оценка:** 8 ч.

### MC-080. Hardening хоста (по PRD §6.1–6.2)
- **Шаги:** ufw (allow 22 с manager-IP, 80, 443; default deny incoming); sshd финализация (PasswordAuthentication no, PermitRootLogin prohibit-password — верифицировать); смена/блокировка пароля root; TLS (ADR: Let's Encrypt через NPM или локальный); fail2ban активен; auditd-правила.
- **Проверка:** `nmap -p- 192.168.1.95` с LAN → открыты только 22/80/443; вход root по паролю → отказ; `curl https://<домен>` → валидный TLS.
- **DoD:** чек-лист CIS-подобных проверок приложен к PR; INVENTORY.md обновлён (§5 лог изменений).
- **Оценка:** 6 ч.

### MC-082. Systemd-юниты приложения
- **Scope:** `infrastructure/systemd/`.
- **Шаги:** юниты `multichef-web.service` (Next.js standalone из /var/lib/multichef/web/), `multichef-api.service`, `multichef-worker.service` — все под `multichef_app`, `EnvironmentFile=/etc/multichef/*.env`, `Restart=on-failure`, `ProtectSystem=strict` с явными ReadWritePaths, зависимости `After=postgresql.service redis.service`.
- **Проверка:** `systemctl status` всех трёх → active; `systemctl restart multichef-api` → health зелёный < 10 сек; reboot контейнера → все сервисы поднялись сами.
- **DoD:** логи юнитов в journald + ротация; ни один юнит не запускается от root.
- **Оценка:** 5 ч.

### MC-090. Playbook ротации секретов
- **Scope:** `infrastructure/scripts/rotate-secrets.sh`, документ `docs/runbooks/secret-rotation.md`.
- **Шаги:** ротация SESSION_SECRET/CSRF_SECRET/PASSWORD_PEPPER (с инвалидацией всех сессий — осознанно), DATABASE_URL (blue-green: новый юзер БД → переключение → отзыв старого), SSH-ключи (rotate-ssh-keys.sh), GitHub PAT; каждый шаг — с проверкой и откатом.
- **Проверка:** тестовая ротация SESSION_SECRET на staging → старые cookie невалидны, логин работает.
- **DoD:** runbook исполним человеком без контекста проекта за < 30 мин.
- **Оценка:** 6 ч.

---

## Сводная таблица и граф

| Фаза | Задачи | Суммарная оценка | Критический путь |
|---|---|---|---|
| 0 | MC-001…005 | 24–31 ч | последовательная |
| 1 | MC-010…014 | 40–48 ч | MC-010→MC-011 ∥ MC-012→MC-013→MC-014 |
| 2 | MC-020…023 | 28–33 ч | MC-020 (контент) — самая длинная |
| 3 | MC-030…035 | 53–62 ч | MC-031 (контент) критична для MC-033 |
| 4 | MC-040…043 | 18–22 ч | параллельно после MC-033 |
| 5 | MC-050…056 | 64–72 ч | MC-050→051→052→053/054→055/056 |
| 6 | MC-060…062 | 28 ч | после MC-051 |
| 7 | MC-070…090 | 63–73 ч | MC-071→072→075; 080/082/090 — с MC-071 |
| **Итого** | 34 задачи | **~318–369 ч** | ≈ 8–10 недель одного FT-исполнителя; ~4–5 недель при 2 параллельных треках (api+web) |

**Параллелизация:** после Фазы 0 возможны два трека: backend (010→011→020→021→022→030→032→033→050→051→052→053→054→060→061) и frontend (012→013→014→023→034→035→040-043 UI→055→056→062→070). Контентные задачи MC-020/MC-031 — третий трек, стартуют сразу после MC-003.

**Релизные точки:** `v0.1.0-internal` = Фазы 0–3 (рекомендации «на сегодня» работают); `v0.2.0` = + Фаза 5 (недельный план и покупки — полное ядро); `v0.3.0` = + Фаза 6 (заготовки); `v1.0.0` = + Фаза 7 (прод-hardening, PWA, релизный чек-лист).
