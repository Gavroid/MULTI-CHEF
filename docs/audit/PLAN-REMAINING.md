# PLAN-REMAINING — открытый остаток ROADMAP-21-70

**Дата:** 2026-09-16
**Источник:** `docs/audit/ROADMAP-21-70.md` (Фаза 3). Этот файл — снимок того, что
осталось после закрытия E01–E21, E25, E27 (см. историю git: коммиты с префиксами
`feat/fix/chore` T21–T70, E09–E27).

## Статус эпиков Фазы 3

| Эпик                                    | Статус                   | Коммиты/примечание                                                          |
| --------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| E21 Web perf & rendering hygiene        | ✅ закрыт                | `8af0cbc` (loading.tsx), `2b5fe7d`/`b9d95a4` (bundle budget в CI build-job) |
| E25 Feature flags + kill switches       | ✅ закрыт                | `cdd661e` (flag-реестр + kill-switch джоб + CSRF hard mode)                 |
| E27 Pagination API unification          | ✅ закрыт                | cursor/total унифицированы; ingredients отдают `meta.total` (T42-B)         |
| E22 Mobile/PWA responsive               | ✅ закрыт (2026-09-16)   | T66-A/B/C/D; feat(web) E22, e2e 40/40                                       |
| E23 i18n foundation                     | ✅ закрыт (2026-09-16)   | T46-A/B/C/D; feat(i18n) E23                                                 |
| E24 Image storage abstraction + upload  | ⬜ открыт                | T54-A/C/D                                                                   |
| E26 External integrations + AI scaffold | ⬜ открыт                | T69-A/B/C/D                                                                 |
| E28 RLS финал                           | ⏸ ждёт решения владельца | предусловие — ADR-0023 (auth-bootstrap), наивное включение ломает login     |

## Остатки-хвосты (низкий приоритет)

- `GET /meal-plans/prep-tasks` из T42-D: закрыт функционально через
  `POST /meal-plans/active/prep` (generate-or-return, идемпотентен). Отдельный
  GET не требуется, пока не появится consumer вне web-клиента.
- E28: единственный блокер — продуктовое решение по auth-bootstrap
  (register/login вне RLS-контекста). Без него не начинать.

---

## E22. Mobile/PWA responsive — Фаза 3, XL — ✅ ЗАКРЫТ (2026-09-16)

- **Принято:** e2e `responsive-pwa.spec.ts` — 30 тестов: 0 горизонтальных скроллов
  на 375/768/1280 (публичные + авторизованные экраны); grid 1→2→3 колонки (fridge);
  shell 480→896px (md/lg); manifest PNG+maskable иконки 200; apple-touch-icon;
  viewport maximum-scale=5; SW v2 precache ≥ 7 URL; offline-навигация → /offline.
  Полный прогон e2e — 40/40.
- **Сопутствующие продуктовые фиксы, найденные e2e:**
  - `@Throttle(10/min)` с класса AuthController перенесён на register/login —
    GET /session (проба AuthGuard на каждом монтировании экрана) бился в лимит
    на NAT/мультипользовательских инсталляциях и случайно выкидывал на логин.
  - SW/PWA работает только в secure context (localhost/HTTPS): LAN-деплой по
    plain HTTP на 192.168.1.95 не регистрирует SW — для installable-PWA нужен
    HTTPS на шлюзе (существует :8443, self-signed) — отдельное решение.
  - tests/e2e: mc_csrf сеется из ответа register (Path=/api/v1 — E25 hard mode
    сломал старую добычу из document.cookie); playwright baseURL выровнен с
    запечённым NEXT_PUBLIC_APP_BASE_URL; workers: 4.

- **Закрывает:** T66-A (0 breakpoints), T66-B (SW precache только `/`+`/today`),
  T66-C (manifest без PNG/apple-touch-icon), T66-D (viewport без явного zoom-разрешения).
- **План:**
  1. T66-D: `viewport` → `maximumScale: 5, userScalable: true` (zoom не запрещаем — WCAG 1.4.4).
  2. T66-C: PNG-иконки 192/512 (+apple-touch-icon 180) из `icons/icon.svg`; manifest
     получает PNG-записи; layout — `apple-touch-icon` в `metadata.icons`.
  3. T66-B: `sw.js` — SHELL_URLS + `/plan`, `/shopping`, `/fridge`, `/offline`;
     navigate-режим: network → кэш маршрута → `/offline`; VERSION → v2.
  4. T66-A: `md:`/`lg:` breakpoints на топ-экранах: `/fridge`, `/plan/storage`,
     `/plan`, `/shopping/[listId]`, `/recipe/[id]` (сетки 2–3 колонки, desktop-контейнер).
  5. `/offline` — отдельный route с осмысленным сообщением и retry-кнопкой.
- **Acceptance:** e2e viewport-проверки 375/768/1280 (0 горизонтальных скроллов);
  manifest + иконки + sw отдаются 200; offline-смоук: navigate без сети → /offline
  либо закэшированный shell; существующие unit/e2e зелёные.
- **Метрика:** 0 `scrollWidth > innerWidth` на 375px; SW precache ≥ 7 URL.

## E23. i18n foundation — Фаза 3, L — ✅ ЗАКРЫТ (2026-09-16)

- **T46-A/C:** словарь `ERROR_MESSAGES` (31 код, ru+en) в contracts; exception
  filter резолвит message по User.locale (req.user → mc_session cookie fallback
  для публичных роутов → 'ru'); PATCH /auth/locale переключает User.locale.
  e2e: одна и та же 404 отвечает 'Рецепт не найден' / 'Recipe not found'.
- **T46-B:** next-intl 4 подключён (плагин + request.ts + provider в root
  layout); словарь `apps/web/src/i18n/ru.ts` (nav._, profile._); мигрированы
  BottomTabBar и профиль; coverage-гейт `pnpm check:i18n` (100% в обе
  стороны) + шаг в CI.
- **T46-D:** `lib/datetime.ts` (DEFAULT_TZ, todayInTz, formatDateInTz);
  formatExpiry считает «сегодня» в зоне пользователя (tz из User.tz через
  mc_user); профиль показывает User.tz + переключатель языка.

- **Закрывает:** T46-A (RU/EN mix в API), T46-B (нет i18n lib), T46-C (locale unused), T46-D (tz unused).
- **План:** словари ru в `apps/web/src/i18n/ru.ts`; next-intl на web; API: сообщения
  ошибок из словаря по `User.locale`; отобразить tz в UI (expiration по локальному времени).
- **Acceptance:** 0 EN-строк в UI при locale=ru; API-ошибки на ru; переключение locale
  меняет формат дат. **Метрика:** i18n-coverage скрипт = 100% ключей.

## E24. Image storage abstraction + upload — Фаза 3, L (4-7 pd)

- **Закрывает:** T54-A (404 ассетов), T54-C (нет абстракции), T54-D (нет upload).
- **План:** интерфейс `ImageStorage` (local → S3-совместимый драйвер); endpoint
  `POST /recipes/:id/image` (owner, валидация mime/size); миграция ключей; отдача
  через nginx X-Accel.
- **Acceptance:** upload → resize → отдача; смена драйвера конфигом; 0 404 на
  существующих. **Метрика:** 100% imageKey проходят валидацию драйвера.

## E26. External integrations + AI scaffold — Фаза 3, L (4-7 pd)

- **Закрывает:** T69-A (TemplateAiProvider без HTTP-клиента), T69-B (ключи мертвы),
  T69-C (Sentry без SDK), T69-D (нет webhook-каркаса).
- **План:** `AiProvider` интерфейс + HTTP-клиент (timeout/retry/circuit-breaker) за
  feature-флагом E25; Sentry SDK по DSN; webhook-каркас (signature + idempotency).
- **Acceptance:** мок-LLM в тестах; Sentry события в staging; webhook-спека задокументирована.

## E28. RLS финал — Фаза 3, XL — по решению владельца

- **Закрывает:** T27-B + полное закрытие T4 (Postgres RLS).
- **План:** ADR-изменение по auth-bootstrap (register/login вне RLS-контекста:
  отдельная роль/политики auth-mode) → перевод auth/household/jobs сервисов →
  ENABLE/FORCE на Session/User/Household/HouseholdMember/Job → приёмочные SQL-пробы.
- **Acceptance:** SQL-проба cross-tenant = 0 на всех 15 таблицах; auth-флоу e2e зелёный.
- **Предусловие:** явное продуктовое решение (наивное включение ломает login) — ADR-0023.

## Порядок исполнения

1. ~~E22~~ ✅ → 2. ~~E23~~ ✅ → 3. **E24** (следующий) → 4. **E26** → 5. **E28** (после решения владельца).
