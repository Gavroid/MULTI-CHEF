# План разработки, тестирования и приёмки — остаточный бэклог P0 (круги #1–#12)

**Дата:** 2026-09-14
**Базовый HEAD:** `63ec454` (= origin/main). Бэклог аудитов #13–#20 закрыт, задеплоен и верифицирован — см. `docs/audit/FIXES-13-20.md`.
**Область плана:** невыполненные 🔴 P0/P1 из `AUDIT-REPORT.md`, `-2.md`, `-3.md` (+ `VERIFICATION.md`) и `-12.md`, а также инфраструктурные хвосты, накопленные в кругах #13–#20.

---

## 0. Принципы (действуют для всех WP)

1. **Приёмка = инвертированные команды исходного аудита.** Каждый критерий сформулирован как команда + ожидаемый вывод; исходные «улики» взяты из `VERIFICATION.md`.
2. **Один WP = отдельные conventional-коммиты** (заголовок ≤72 симв., типы feat/fix/docs/chore/refactor/test/ci/perf/revert). Pre-commit: prettier, prisma format, gitleaks (примеры ULID/ключей в доках — только фейковые `01HFAKE…`).
3. **Воронка тестирования на каждый WP** (CI повторяет её же):
   1. `pnpm lint && pnpm typecheck`
   2. `pnpm test` (126 API + 221 web + пакеты)
   3. `pnpm --filter @multichef/api build && …/web build && …/worker build`
   4. Если затронута БД: `RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=…multichef_test pnpm --filter @multichef/api test:integration`
   5. Деплой: build → `systemctl restart multichef-api multichef-worker` → `health/ready = 200` → прод-смок (для multi-user правок — конкурентные прогоны; урок P2002-кавычек: см. `FIXES-13-20.md`)
4. **Инфраструктурные действия** (nginx, роли Postgres, restart) — только после явного подтверждения оператора; для каждого шага прописан откат.
5. **Никаких правок уже применённых миграций** — только новые файлы миграций.
6. Закрытие WP фиксируется raw-выводом приёмочных команд в `docs/audit/` (по образцу `VERIFICATION.md` / `FIXES-13-20.md`).

## 0.1 Сводная таблица

| WP   | Тема                                     | Аудит                | Приоритет    | Оценка                  | Зависимости            |
| ---- | ---------------------------------------- | -------------------- | ------------ | ----------------------- | ---------------------- |
| WP-1 | nginx `server_tokens`                    | T2                   | 🔴 P0        | 0.5 ч                   | —                      |
| WP-2 | `<img>`: loading/decoding/dimensions     | T3                   | 🔴 P0        | 1–2 ч                   | —                      |
| WP-3 | SEO: robots/sitemap/metadata             | T1                   | 🔴 P0        | 0.5–1 день              | WP-2 (контент страниц) |
| WP-4 | WCAG color-contrast + link-in-text-block | U1                   | 🔴 P0 (a11y) | 1–2 дня                 | желательно после WP-2  |
| WP-5 | Postgres Row-Level Security              | T4                   | 🔴 P0 (арх.) | 1–2 спринта, фазировано | ADR-first              |
| WP-6 | Гигиена/наблюдаемость (P3-хвосты)        | T18-E/F, #16, MC-051 | P3           | по 0.5–2 ч              | —                      |

Рекомендуемый порядок: WP-1 → WP-2 → WP-3 → WP-4 → (параллельно стартует WP-5 фаза 0). Каждый WP разворачивается и принимается независимо.

---

## WP-1 — nginx `server_tokens` (T2)

**Цель:** убрать раскрытие версии nginx и ОС из заголовка `Server`.

**Изменения (вне репо, `/etc/nginx/nginx.conf`):**

- Строка 21: раскомментировать `server_tokens off;` (или добавить `server_tokens off;` в `http {}`-блок).
- `sudo nginx -t && sudo systemctl reload nginx`.

**Тестирование:**

- `curl -sI http://127.0.0.1:8080/api/v1/health/live | grep -i ^server:` → `Server: nginx` (без версии и Ubuntu).
- Smoke unaffected-роутов: `/` (web), `/api/v1/health/live`, `/auth/login` — 200/307 как до.

**Приёмка (DoD):**

- `curl -sI http://192.168.1.95:8080 | grep -iE "server:.*(1\.|Ubuntu)"` → пусто (инвертированная улика VERIFICATION.md §T2).
- Все health-проверки зелёные, ошибок в journalctl нет.

**Риски/откат:** минимальные; откат — вернуть комментарий и reload. Опциональное расширение (отдельное решение): полное удаление заголовка через `headers-more` — требует установки модуля, в базовый WP не входит.

---

## WP-2 — `<img>`: loading/decoding/dimensions (T3)

**Цель:** оба `<img>` получают атрибуты загрузки и зарезервированную геометрию (CLA/CLS + LCP).

**Изменения:**

- `apps/web/src/app/(app)/recipe/[id]/components/Header.tsx` (LCP-кандидат): `loading="eager"`, `fetchPriority="high"`, `decoding="async"`, `width`/`height` (или aspect-ratio обёртка) — изображение выше фолда.
- `apps/web/src/app/(app)/today/result/components/OptionCard.tsx`: `loading="lazy"`, `decoding="async"`, width/height.
- Проверить, как отдаются картинки (`@fastify/static`): добавить `Cache-Control: immutable` для `/recipes/images/*` если ещё нет (опционально, отдельным коммитом).

**Тестирование:**

- Существующие web-тесты (221) + новые source-level asserts в стиле app-shell (grep `<img` → обязательные атрибуты).
- Ручной DOM-чек на живом стенде: `curl …/recipe/<id> | grep -oE '<img[^>]+'` содержит `loading=`, `width=`.
- Lighthouse до/после на `/recipe/<id>` и `/today/result`: LCP не деградировал, CLS ≤ 0.1.

**Приёмка (DoD):**

- `grep -rnE '<img\b' apps/web/src --include='*.tsx' | wc -l` = числу файлов с `loading=|fetchPriority=` (инвертированная улика VERIFICATION.md §T3: было 2 `<img>` без атрибутов).
- axe: 0 новых нарушений; визуальная приёмка карточек (нет «прыжков» вёрстки).

**Риски/откат:** низкие; откат — revert коммита.

---

## WP-3 — SEO: robots/sitemap/metadata (T1)

**Цель:** закрыть «SEO полностью отсутствует»: пустые title, нет description/OG, robots.txt 404, sitemap.xml 404.

**Изменения (apps/web):**

- `app/robots.ts` (MetadataRoute.Robots): allow `/`, `/design`, `/auth/*`; disallow `/api/`, `/today`, `/fridge`, `/plan`, `/shopping`, `/profile`, `/recipe`; ссылка на sitemap.
- `app/sitemap.ts`: публичные URL (`/`, `/auth/login`, `/auth/register`, `/design`) от `NEXT_PUBLIC_APP_BASE_URL`.
- `app/layout.tsx`: `export const metadata` — title template `%s — MULTI-CHEF`, default title, description, `openGraph` (og:title/og:description/og:image), lang="ru" уже в html.
- Приватные экраны ((app) layout): `export const metadata = { robots: { index: false, follow: false }, title: '…' }` — заодно чинит пустой `<title></title>` на `/profile`.
- `/design`: title + description (страница остаётся публичной).

**Тестирование:**

- Source-level тесты по образцу app-shell (robots/sitemap файлы существуют, layout содержит metadata, (app) layout содержит noindex).
- Прод-проверки (инвертированные команды VERIFICATION.md §T1):
  - `curl -s http://192.168.1.95:8080/robots.txt` → 200, содержит Disallow приватных путей;
  - `curl -s …/sitemap.xml` → 200, содержит `/`, `/auth/login`, `/auth/register`;
  - для `/`, `/today`, `/fridge`, `/plan`, `/profile`: `<title>` непустой и уникальный, `<meta name="description">` присутствует; OG-теги на публичных страницах.

**Приёмка (DoD):** все команды §T1 VERIFICATION.md дают противоположный результат; `pnpm --filter @multichef/web build` зелёный (metadata компилируется).

**Риски/откат:** низкие; robots/noindex не ломает авторизованных пользователей; откат — revert.

---

## WP-4 — WCAG color-contrast + link-in-text-block (U1)

**Цель:** 0 serious-нарушений axe-core на `/`, `/auth/login`, `/auth/register`, `/design` (исходно: 5 правил / 42 узла).

**Изменения:**

- Инвентаризация пар «текст/фон»: выгрузить axe-JSON (подход `/tmp/axe-real.mjs` из VERIFICATION.md) → таблица нарушений по токенам.
- Правки в `@multichef/ui` tokens + точечные классы: контраст muted-текста, подписей кнопок, ссылок; `link-in-text-block` на `/auth/register` — подчёркивание/иконка ссылки внутри текста.
- Не менять брендовые цвета глобально без визуальной ревизии — минимальные правки токенов.

**Тестирование:**

- Автоматизация: axe-core в Playwright e2e (tests/e2e уже настроен): новый spec `axe-pages.spec.ts` — прогон 4 страниц, assert `violations` (serious/critical) = 0; до фикса тест падает (сначала написать тест, потом чинить).
- Регрессия: полный web-тест suite (221) + скриншот-обзор ключевых экранов.
- Повторный axe-прогон командой из VERIFICATION.md §U1.

**Приёмка (DoD):**

- axe: `Total: 0` serious/critical на 4 страницах (дважды: локально и на проде);
- скриншоты до/после приложены к PR/коммиту; visual-регрессий вне затронутых токенов нет.

**Риски/откат:** средние (токены расползаются по UI) — минимальные дельты, поэтапные коммиты по одному правилу контраста; откат — revert токенов.

---

## WP-5 — Postgres Row-Level Security (T4) — фазировано

**Цель:** изоляция тенантов на уровне БД, а не только app-фильтрами Prisma (`relrowsecurity=f` на всех 25 таблицах — VERIFICATION.md §T4).

**Фаза 0 — ADR (обязательное решение до кода):**

- Вариант модели: `current_setting('app.household_id'/'app.user_id', true)` + политики `USING`/`WITH CHECK`.
- Роль: рантайм-роль без BYPASSRLS (`ALTER TABLE … FORCE ROW LEVEL SECURITY`) против владельца-схемы; миграции выполняются владельцем/суперпользователем (урок T17-B: приложение не может делать супервизорные операции).
- Интеграция с Prisma: `$extends`-обёртка, открывающая транзакцию и выполняющая `set_config('app.household_id', $1, true)`; каталог читается через политики «SELECT для всех».
- Rollback-план: `ALTER TABLE … NO ROW LEVEL SECURITY` (мгновенно, не разрушает данные).
- Выход фазы: утверждённый ADR-0023 + чек-лист таблиц.

**Фаза 1 — пилот на `PantryItem`:**

- Миграция (владелец/суперпользователь): `ALTER TABLE ENABLE/FORCE ROW LEVEL SECURITY` + `CREATE POLICY pantry_tenant …`.
- `getPrisma()`-слой: household/user контекст в каждую транзакцию; non-tenant пути (миграции, сид) — под владельцем.
- Тесты: (а) вся существующая интеграционная suite зелёная; (б) новые SQL-пробы: два юзера, `SET app.household_id='B'` → SELECT строк A = 0; INSERT/UPDATE с чужим householdId → WITH CHECK violation; (в) 10 конкурентных запросов — нет деградации (SET LOCAL в транзакции, пул безопасен).

**Фаза 2 — раскатка:** MealPlan, MealPlanDay, MealPlanEntry, PrepSession, PrepTask, PreparedPortion, ShoppingList, ShoppingListItem, Preference, NutritionProfile, Session (по `app.user_id`), Job (по `app.user_id`), Household (owner/member-политика), HouseholdMember.

**Фаза 3 — приёмка:**

- `pg_class`: relrowsecurity+relforcerowsecurity = true для полного целевого списка.
- Cross-tenant SQL-проба = 0 строк для всех тенант-таблиц.
- Полный `pnpm check` + интеграционная suite + прод-смок (параллельные сессии двух юзеров).
- Нагрузочный смоук (10 конкурентных чтений pantry/plans) — латентность ±10% от базовой.

**Риски:** высокие — owner-bypass (лечится FORCE + отдельной ролью), пул соединений и SET LOCAL, производительность политик на больших таблицах. Каждый шаг — с откатом NO RLS; фазы независимо откатываемы.

---

## WP-6 — Гигиена и наблюдаемость (P3, без дедлайна)

| Пункт                           | Аудит    | Суть / приёмка                                                                                                                                                                               |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 Drift-check в CI            | #17 §6.4 | `check:schema-drift` в ci.yml против Postgres-сервиса (сервис уже объявлен); приёмка: CI красный при искусственном дрейфе                                                                    |
| 6.2 5xx-метрика по эндпойнтам   | #16      | счётчик в exception filter (stderr JSON уже структурирован) + дашборд; приёмка: счётчик растёт на тестовом 500                                                                               |
| 6.3 Idempotency in-flight       | MC-051   | SET NX + ожидание ответа первого запроса (сейчас последовательный replay закрыт, параллельный — гонка на уровне кэша); приёмка: 10 одновременных register с одним ключом → 10×201 одинаковых |
| 6.4 Startup-баннер через Logger | T18-F    | единый формат логов; приёмка: `journalctl` показывает один формат                                                                                                                            |
| 6.5 localStorage PII            | T19-E    | clearLocalUser уже на logout; добавить wipe при `beforeunload`? — решение: оставить как есть (cookie HttpOnly), зафиксировать в README                                                       |

---

## Финальный приёмочный гейт

1. Все WP закрыты, приёмочные raw-выводы собраны в `docs/audit/FIXES-1-12.md` (по образцу FIXES-13-20.md).
2. **AUDIT-REPORT-21**: повторный полный прогон методики кругов #1–#3 (curl-улики T1–T4, axe, RLS-проба, server header) → 0 подтверждённых P0.
3. Обновить cumulative-таблицы: 12+ старых P0 → closed.
4. `pnpm check` (lint+format+typecheck+test+build) — зелёный; прод-смоук 5 сценариев — зелёный.

## Вне плана (осознанно)

- Push/CI-настройка секретов — по команде оператора.
- `@t.ru`-юзеры удалены 2026-09-14; новые аудит-прогоны — использовать `multichef_test` или суффикс `@test.local` с последующей чисткой.
- MC-051 in-flight serialization — WP-6.3, если приоритезируем.
