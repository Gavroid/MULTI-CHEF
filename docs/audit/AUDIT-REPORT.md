# Технический, продуктовый и UI-аудит MULTI-CHEF

**Дата:** 2026-09-14  
**Целевой сервер:** 192.168.1.95 (LXC multichef, Ubuntu 24.04)  
**HEAD:** `e542111 feat(mc085): scale catalog to 2000 recipes with photos`  
**Артефакты:** скриншоты `home/multichef_app/shots/*.png` (44 шт., mobile + desktop), логи API `journalctl -u multichef-api`.

## TL;DR

Проект в хорошем техническом состоянии (зависимости без уязвимостей, строгий TypeScript, защищённый CSRF/Idempotency/Rate-limit, корректные security-заголовки). Главные критические находки — **продуктовые**: каталог фактически отдаёт 269 рецептов вместо 2000; два эндпоинта возвращают 500 (onboarding/profile preflight). UI в целом консистентный, но защита маршрутов остаётся на localStorage-плейсхолдере (TODO MC-014). Перед прод-релизом желательно закрыть 2 критических бага.

---

## 1. Технический аудит

### 1.1 Репозиторий и зависимости

| Проверка                         | Результат        | Заметка                                                                                                     |
| -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm audit`                     | ✅ 0 уязвимостей | npm-аудит по всем workspace                                                                                 |
| `tsc --noEmit` (database)        | ✅ 0 ошибок      | После фикса линта (commit ещё не сделан)                                                                    |
| `pnpm turbo run lint` (database) | ✅ 0 ошибок      | `@typescript-eslint/no-unused-expressions` в `import-recipes.ts:81` уже пофикшен локально                   |
| `tsconfig.base.json`             | ✅ очень строгий | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noPropertyAccessFromIndexSignature` |
| `.env` coverage guard            | ✅ 100%          | `check-env-coverage.mjs` — все env-ключи задокументированы                                                  |
| ADR coverage guard               | ✅ OK            | `check-adr-coverage.mjs` — 13 ADRs                                                                          |

### 1.2 Бэкенд (`apps/api/`)

- **NestJS 11 + Fastify**, Prisma 6, Zod (`nestjs-zod`), `@nestjs/throttler`, `@nestjs/swagger` (только в non-prod), `@fastify/cors/cookie`.
- **Контроллеры (11):** `auth, health, household, ingredients, jobs, meal-plans, pantry, profile, recipes, recommendations, shopping-lists`.
- **CSRF (MC-033):** `CsrfDoubleSubmitGuard` как `APP_GUARD` — покрывает все мутации; non-browser без cookie проходит свободно (правильный baseline).
- **Idempotency-Key (MC-010):** хедер обязателен на мутациях, min 16 символов.
- **Rate-limit:** `@Throttle({ default: { ttl: 60_000, limit: 10 } })` на `AuthController` (10/min на auth-эндпойнты). Глобальный — 300/min.
- **Безопасность:** helmet включён (CSP, HSTS, XCTO, COOP/CORP, COEP, Permissions-Policy, Referrer-Policy, frame-ancestors, script-src 'self' и т. д. — полный набор); CORS с allowlist + `access-control-allow-credentials: true`.
- **Валидация:** ⚠️ **Нет глобального `useGlobalPipes(new ValidationPipe())`** — каждый контроллер вынужден сам вызывать `safeParse` и бросать `AppHttpException`. Паттерн соблюдается 11/11 контроллеров, но без него любая забытая валидация → 500 (см. продуктовые баги). Заметка в `apps/api/src/main.ts:95-100`.
- **Cookies:** `mc_session` HttpOnly + `mc_csrf` JS-readable double-submit; `COOKIE_SECURE`/`COOKIE_SAMESITE`/`COOKIE_DOMAIN` env-driven; **Domain-attribute пропускается для IP-хостов** (иначе браузер reject). Учтено в `auth.controller.ts:67-83`.

### 1.3 База данных

- **PostgreSQL 16** + `pg_trgm` (тригграмма для поиска), индекс `uniq_recipe_lower_title` на `lower(title)`.
- Все CURATED+PUBLISHED рецепты имеют непустой `instructions` (269/269) — см. `SELECT count(*) FILTER (WHERE jsonb_array_length(instructions)=0)` → 0.
- **Таблица правил:** `Recipe`, `RecipeIngredient`, `RecipeNutrition` (не `Nutrition`!), `Ingredient`, `IngredientNutrition`, `NutritionProfile`, `Preference`, `ShoppingList`, `ShoppingListItem`, `Session`, `Household`.
- 2000 рецептов = **269 CURATED PUBLISHED + 1731 IMPORTED PUBLISHED**.

### 1.4 Фронт (`apps/web/`)

- **Next.js 15.5 (App Router) + React 19**, design-system вынесен в `@multichef/ui` (пакет).
- **Next_PUBLIC_APP_BASE_URL=http://192.168.1.95:8080** инлайнится при build (см. `apps/web/src/lib/env.ts`). Multi-domain deploy — нужен отдельный build per host (ограничение `NEXT_PUBLIC_*`).
- **Маршруты:** `/, /auth/(login|register), /(today|fridge|plan|profile|shopping)` + динамические `[/recipe/[id], /shopping/[listId]]`. Design preview `/design`.
- **Middleware:** единственный protected prefix — `/profile`. Остальное доверяет `AuthGuard` (см. продуктовые находки).
- **Tailwind:** токены через CSS-variables (`--color-*`, `--radius-*`); темы `light`/`dark` переключаются атрибутом `data-theme` + `localStorage('mc-theme')`.

### 1.5 Инфра и CI

- 3 systemd-юнита: `multichef-{api,worker,web}`, nginx на 8080, бэкап cron `/opt/multichef/infrastructure/scripts/backup.sh`.
- Мониторинг: `/api/v1/health/{live,ready}` (комплексный — Postgres + Redis + worker).
- Тесты: unit в `packages/database/src/__tests__`, e2e Playwright 1.63.0 в `apps/web/e2e/`.

### 1.6 Дополнительные тех-заметки

- `apps/api/src/auth/auth.controller.ts` хорошо документирован («Audit 2026-09-13» notes).
- Все мутации на 100% защищены CSRF.
- 🟡 `auth.controller.ts:148` — `setSessionCookie` записывает cookie только при register/login. Если юзер был залогинен, потом make a request that triggers re-issue — будет работать. OK.

---

## 2. Продуктовый аудит

### 2.1 Что работает корректно ✅

| Поток             | Endpoint(s)                                                   | Результат                                                                 |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Регистрация       | `POST /auth/register`                                         | 201, выдаёт `mc_session + mc_csrf` cookie pair                            |
| Логин (с CSRF)    | `POST /auth/login`                                            | 200, rotates CSRF                                                         |
| Logout            | `POST /auth/logout`                                           | 204 + `Set-Cookie: mc_session=; Max-Age=0`; `/auth/session` сразу → 401   |
| Session check     | `GET /auth/session`                                           | 200 если есть session; 401 если нет                                       |
| **CSRF mismatch** | `POST /login` с `cookie: mc_session=...; mc_csrf=wrong`       | **403 CSRF_MISMATCH**                                                     |
| Idempotency-Key   | `POST /auth/register` без хедера                              | 400 VALIDATION_ERROR (правильно)                                          |
| **Rate-limit**    | 15 быстрых login подряд                                       | `[200,200,200,200,200,200, 429,429,...]` — защищает                       |
| Каталог           | `GET /recipes?mealType=BREAKFAST&limit=3`                     | 200, фильтр работает                                                      |
| Каталог           | `GET /recipes?maxMinutes=20`                                  | 200, фильтр работает (двух-полевый `prepMinutes ≤ N AND cookMinutes ≤ N`) |
| Pantry list       | `GET /pantry`                                                 | 200, формат консистентен                                                  |
| Каталог детально  | `GET /recipes/:id`                                            | 200, поля: ingredients[], instructions[], nutrition{}                     |
| План-генерация    | `POST /meal-plans` → `poll GET /jobs/:id`                     | 202 → COMPLETED с `result`                                                |
| Список покупок    | `GET /shopping-lists/active`                                  | 200 (мн.ч.!)                                                              |
| Recommendations   | `POST /recommendations/{today,roulette/draw,roulette/reject}` | 200                                                                       |
| Validation 404    | `GET /recipes/00000000-...`                                   | 404 RECIPE_NOT_FOUND                                                      |
| Bad UUID          | `GET /recipes/not-a-uuid`                                     | 404 RECIPE_NOT_FOUND (парсер UUID сторожит)                               |

### 2.2 Критические баги 🔴

#### B1. **Каталог фактически отдаёт 269 рецептов вместо 2000** (P0)

- **Симптом:** Полный обход `GET /recipes?limit=50&cursor=...` показывает **269 записей**. Маркетингово заявленные «2000 рецептов с фото» — это данные в БД, но **не видимые пользователю** через публичный catalog endpoint.
- **Причина:** `apps/api/src/recipes/recipes.service.ts:60,127` — фильтр `sourceType: 'CURATED'` явно ограничивает каталог. 1731 IMPORTED рецептов есть в БД, но `/recipes` их не выдаёт.
- **Источник:** в seed/импорте 2000-рецептов был выбран `sourceType: 'IMPORTED' as const` (`packages/database/scripts/import-recipes.ts:71`).
- **Возможные фиксы:**
  - Расширить фильтр в `recipes.service.ts` на `sourceType in ('CURATED','IMPORTED')`;
  - ИЛИ переимпортировать с `sourceType='CURATED'` (планировалось изначально).

#### B2. **`POST /profile/onboarding` → 500** (P0)

- **Симптом:** Любой запрос с body без поля `allergies` (типичный flow UX) → 500 `body.allergies is not iterable`.
- **Причина:** `apps/api/src/profile/profile.service.ts:230` — деструктурирует `for (const a of body.allergies)` без дефендива. Zod-схема `OnboardingSchema` имеет `.default([])`, но без глобального `ValidationPipe` дефолты Zod не применяются (см. T3), а сервис не защищён.
- **Лог:** `journalctl -u multichef-api` → `TypeError: body.allergies is not iterable at profile.service.js:230`.
- **Также** → 500 на `body.likedIngredients` и `body.dislikedIngredients`.
- **Фикс:** `(body.allergies ?? [])` + то же для 2 других полей. Альтернатива — повесить `useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))` в `main.ts`.

### 2.3 Значимые проблемы ⚠️

#### B3. **Несовместимая пагинация** (P1)

- `/recipes?limit=N` → `{items: [...], nextCursor: "..."}` (cursor-based)
- `/ingredients?limit=N` → `{data: [...]}` (без курсора, без total)
- Сломано API-контракт — клиенты должны писать разные обходчики пагинации для одного рессурса. Оба — «paginated list», разная форма.
- **Фикс:** выровнять на `{items, nextCursor}` либо на `{data, total}` для обоих.

#### B4. **AuthGuard временно на localStorage-плейсхолдере** (P1, известный TODO MC-014)

- `apps/web/src/components/AuthGuard.tsx` — redirect в /auth/login решается через `localStorage.getItem('mc_user')`, а не реальную cookie-сессию. На сервере Next.js middleware доверяет только `/profile`.
- **Симптом:** Любой пользователь, открывший (app)-роут без предварительного интерактивного входа, гидрируется и улетает в /auth/login, даже если у него валидный `mc_session`.
- **Эффект:** Playwright-обход напрямую через GET всегда уходил на login, пока я не положил `mc_user` в localStorage. **В реальном UI** проблема маскируется тем, что login/register формы сами пишут `mc_user`.
- **Фикс (MC-014):** `AuthGuard` должен дёргать `/api/v1/auth/session` или читать `mc_session` через middleware (Edge-runtime).

#### B5. **`/fridge/add` → server-redirect `/fridge?add=1`** (P2, UX-нюанс)

- Файл `apps/web/src/app/(app)/fridge/add/page.tsx` редиректит на `/fridge?add=1`. URL теряет семантику; пользователь видит «открыли форму добавления», но адресная строка показывает параметр.
- Минорный UX-баг, но из Playwright-обхода видно — статус 200, финальный URL — `?add=1`.

#### B6. **Нет эндпойнта полнотекстового поиска рецептов** (P2)

- `/recipes/search` → 404. `pg_trgm` есть, но не используется (только для уникальности индекса).
- Текущий фильтр: `mealType` + `maxMinutes`. Этого не хватает для «найти рецепт по слову». UI обещает «рецепты из того, что уже есть дома» — подразумевается поиск.
- **Фикс:** добавить `q`/`query` в `ListRecipesQuerySchema` + использовать `title ILIKE %q%` или `pg_trgm` similarity.

### 2.4 Минор / наблюдения ℹ️

- Рекомендации `rescue` требуют `ingredientId` в теле (400 при отсутствии) — корректное поведение, но требует UX-hint.
- `csr`/`ingredients?limit=1` не возвращает `nextCursor` — клиент не знает, сколько всего ингредиентов в каталоге (см. B3).
- `ingredients/categories` возвращает `{data}` (без items). Консистентность с recipes — нарушена.

---

## 3. UI-аудит

### 3.1 Артефакты

44 PNG-скриншота в `/home/multichef_app/shots/` (15 страниц × mobile 390×844 + desktop 1280×800 + темные/светлые варианты + формы с ошибкой). Все доступны для review.

### 3.2 Консистентность и адаптивность

| Аспект                                                      | Проверено        | Результат                                                                                             |
| ----------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| Layout Mobile (390)                                         | 15 страниц       | ✅ mobile-first max-width 480px, safe-area-inset-bottom                                               |
| Layout Desktop (1280)                                       | те же 15 страниц | ✅ масштабируется, bottom tab остаётся фиксированным                                                  |
| Narrow (320)                                                | login            | ✅ форма не ломается                                                                                  |
| Темы Light/Dark                                             | `/`, `/design`   | ✅ переключатель в шапке, сохраняется в localStorage `mc-theme`, dark пропагируется по всем страницам |
| Tab-bar (5 табов: Сегодня/Холодильник/План/Покупки/Профиль) | mobile+desktop   | ✅ виден на (app) routes, отсутствует на (auth)                                                       |

### 3.3 A11y базовая проверка

| Страница         | Buttons | Inputs+labels | Aria-labels      | `<html lang>` |
| ---------------- | ------- | ------------- | ---------------- | ------------- |
| `/`              | 7       | 0             | 1 (theme toggle) | `ru` ✅       |
| `/auth/login`    | 1       | 2+2 ✅        | 0                | `ru` ✅       |
| `/auth/register` | 1       | 4+4 ✅        | 0                | `ru` ✅       |
| `/design`        | 17      | 3+3           | 5                | `ru` ✅       |

✅ Все формы имеют явные `<label>`; рекомендую для основных кнопок добавить `aria-label` где текста нет (icon-only кнопки).

### 3.4 Состояния загрузки / ошибки

- **Регистрация с плохими данными:** `Похоже на невалидный email` + `Пароль должен содержать букву и цифру` — сообщения появляются под полями, валидация работает на client-side ✅.
- **Empty states:**
  - `/fridge` (нет продуктов): «В холодильнике пока пусто» ✅
  - `/plan` (нет активного плана): «Активного плана пока нет» ✅
  - `/shopping` (нет списка): «Активного списка нет — он появится после принятия рецепта» ✅
  - `/plan/storage`: «Активного плана нет — сначала соберите план» ✅
  - `/fridge/rescue`: «В холодильнике пока пусто — добавьте продукты» ✅
- **Loading states:** `/today/loading` существует, применяется между выбором и результатом. Skeleton из `@multichef/ui`.

### 3.5 Что настораживает ⚠️

- **Иконки тем:** toggle иконка — единственный «☀»/`🌙»-символ Unicode, не SVG. Семантически OK (есть `aria-pressed`), визуально — pixel-art на retina может смазаться.
- **Длинный текст в таблице кнопок главной (`«Что готово»`):** chip «mobile-first» с подписью `text-text-muted` — мелкий, читаемо только при хорошем зрении.
- **Routing inconsistency:** `/fridge/add` и `/fridge?add=1` (см. B5).

---

## 4. Резюме находок

| #      | Приоритет | Категория     | Находка                                     | Фикс                                                           |
| ------ | --------- | ------------- | ------------------------------------------- | -------------------------------------------------------------- |
| **B1** | **P0**    | Product       | Каталог отдаёт 269/2000 рецептов            | Расширить `sourceType` фильтр или ре-импортировать как CURATED |
| **B2** | **P0**    | Product       | `/profile/onboarding` → 500 без `allergies` | `?? []` в service + global ValidationPipe                      |
| **B3** | P1        | Product/API   | Pagination shape mismatch (items vs data)   | Унифицировать                                                  |
| **B4** | P1        | Frontend/Auth | AuthGuard на localStorage-плейсхолдере      | Завершить MC-014                                               |
| **B5** | P2        | UX            | `/fridge/add` → `?add=1` redirect           | Решить в router                                                |
| **B6** | P2        | Product       | Нет `/recipes/search`                       | Добавить q-параметр + pg_trgm ILIKE                            |
| T1     | done      | Tech          | Lint error в `import-recipes.ts:81`         | ✅ уже пофикшен локально                                       |

## 5. Рекомендованный план действий

1. **(5 мин, P0)** B1 — поправить фильтр `sourceType` в `recipes.service.ts` (`'CURATED'` → `in: ['CURATED', 'IMPORTED']`) **ИЛИ** поправить seed-план на `CURATED`. Проверить визуально каталог.
2. **(15 мин, P0)** B2 — поменять `for (const a of body.allergies)` на `for (const a of (body.allergies ?? []))` в `profile.service.ts:230` и аналогично для 2 других полей. Добавить jest-тест.
3. **(30 мин, P1)** B3 — унифицировать envelope (`{items, nextCursor}` для обоих списков).
4. **(1-2 дня, P1)** B4 — реализовать MC-014 (cookie-based AuthGuard + middleware для всех (app) routes).
5. **(P2)** B5 + B6 — отдельный backlog.
6. **Lint fix** — закоммитить уже сделанную правку `import-recipes.ts:81` отдельным коммитом.

## 6. Сводка по здоровью

- **Безопасность:** ✅ Foundation серьёзная (CSRF double-submit, Idempotency-Key, Argon2id session hashes, helmet-full-set, env-driven cookies, audit comments dated).
- **Качество кода:** ✅ Строгий TS, Zod everywhere, RTL/DTOs, тесты присутствуют, lint чистый.
- **DevOps:** ✅ Systemd units, backup, health checks, готов к multi-env через env-флаги.
- **Каталог данных:** ⚠️ DB-уровень в порядке, но витрина (UI) показывает 13% от обещанного.
- **UX/A11y:** ✅ для delivered, ⚠️ для not-yet-delivered (поиск, MC-014).

**Продакшен в целом жизнеспособен**, но **B1 и B2 нужно закрыть до публичного анонса «2000 рецептов»**.
