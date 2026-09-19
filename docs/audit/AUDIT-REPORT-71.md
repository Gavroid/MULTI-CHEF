# AUDIT-REPORT-71 — полный аудит: архитектура / продукт / UI

**Дата:** 2026-09-19
**Метод:** живой прод `http://192.168.1.95:8080` (HEAD `23ccce6`), статический
анализ кода, Playwright-прогон (UX-сценарии + axe-core), SQL-выборки.
**Верифицируемость:** каждая находка снабжена командой/пробой; raw-выводы
в тексте. Раунд выполняется после R20-fixes (F1–F17 закрыты, см.
AUDIT-R20-GLOBAL-SUMMARY.md §«R20-fixes: статус»).

---

## Сводка

| #     | Sev   | Плоскость     | Находка                                                                                                                             |
| ----- | ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T71-A | 🟠 P2 | продукт       | Accept-флоу теряет настройки генерации визарда (budget/maxMinutes/antiFilters) — план генерируется с дефолтами                      |
| T71-B | 🟠 P2 | продукт       | `peopleCount` домохозяйства не влияет на генерацию: `setup.peopleCount ?? 2`                                                        |
| T71-C | 🟠 P2 | архитектура   | Смешанное состояние RLS: 11 таблиц ENABLE+FORCE, 14 — выключено (в т.ч. Job с userId/paramsHash и Session) — E28 pending            |
| T71-D | 🟡 P3 | продукт/UX    | locale=en локализует только ошибки API; UI остаётся русским — смешанный язык                                                        |
| T71-E | 🟡 P3 | продукт/UX    | Переключатель языка в профиле меняет язык ошибок, но не UI — ожидание пользователя не совпадает с поведением                        |
| T71-F | 🟡 P3 | web/privacy   | SW DATA_CACHE не очищается при logout — кэш персональных ответов остаётся в Cache Storage общего браузера                           |
| T71-G | 🟡 P3 | infra         | rollback в deploy-safe требует доступа к npm-registry (pnpm install при откате) — недоступность реестра ломает откат                |
| T71-H | 🟡 P3 | web/security  | На страницах Next нет Content-Security-Policy (только helmet-CSP на API); inline theme-скрипт потребует nonce при введении CSP      |
| T71-I | 🟡 P3 | продукт       | E24 upload-инфраструктура не имеет потребителя: POST /uploads/image никто не вызывает, imageKey всех рецептов NULL (решение MC-200) |
| T71-J | 🟡 P3 | observability | Sentry не подключён (нет DSN) — 5xx не агрегируются; health/ready покрывает только живость                                          |

---

## Детали

### T71-A — accept теряет настройки визарда

`ResultClient.handleAccept` вызывает `acceptRecommendation({ recipeId, servings })`;
новая реализация (ADR-0026, вариант b) отправляет в `POST /meal-plans`
`input.setup ?? {}` → сервер применяет дефолты (7 дней / 3 приёма / 2 чел /
без бюджетных ограничений). Настройки, введённые пользователем в
`/today/generate` (budgetMode, maxMinutes, antiFilters) сохранены в
`SessionResult.settings`, но в accept не передаются.

**Воспроизведение:** визард с budgetMode=NOTHING → accept → сгенерированный
план содержит блюда дороже нулевого бюджета.

**Фикс:** в `handleAccept` передавать `setup` из `session.settings`
(`{ budgetMode, maxMinutes, antiFilters }` — MealPlanSetupDto совместим),
либо прокидывать household.defaultPeopleCount + настройки в дефолты джобы.

### T71-B — peopleCount домохозяйства игнорируется

`apps/worker/src/plan-week.ts:235,267`: `setup.peopleCount ?? 2`.
`Household.defaultPeopleCount` (заполняется на онбординге) нигде не
инжектируется в генерацию — семья из 5 человек получает план на 2.

**Фикс:** в `plan-week.ts` при отсутствии setup.peopleCount читать
`Household.defaultPeopleCount` (джоба уже имеет householdId); либо
ResultClient прокидывает peopleCount из household.

### T71-C — смешанный RLS-стейт (E28 pending)

```
ENABLE+FORCE (11): MealPlan, MealPlanDay, MealPlanEntry, NutritionProfile,
                   PantryItem, Preference, PrepSession, PrepTask,
                   PreparedPortion, ShoppingList, ShoppingListItem
OFF (14): Household, HouseholdMember, Ingredient*, Job, Recipe*,
          Session, StorageRule, User, _prisma_migrations
```

Проверка: `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class …`
Состояние соответствует ADR-0023 phase 1. Остаточный риск: `Job` хранит
userId+paramsHash без RLS; `Session` — токен-хеши. Закрытие = E28 (ждёт
решения владельца по auth-bootstrap).

### T71-D/E — язык: API ≠ UI

`PATCH /auth/locale` переключает язык ошибок API (проверено: en →
«Pantry item not found», ru → «Продукт не найден в холодильнике»), но
next-intl словарь — только ru. Пользователь с locale=en видит русский UI
и английские ошибки. Зафиксировано как осознанный trade-off в ADR-0026;
до появления en-словаря стоит либо скрыть переключатель, либо подписать
«влияет на язык ошибок API».

### T71-F — SW-кэш персональных данных переживает logout

`sw.js` SWR-кэширует авторизованные GET (`/api/v1/meal-plans/active`,
`/api/v1/shopping-lists/active`, `/api/v1/recipes`) в `mc-data-<v>`.
`logout()` чистит in-memory кэши и localStorage, но не `caches` → данные
пользователя A остаются в Cache Storage общего браузера до истечения
версии. **Фикс:** в logout-обработчике постить `{type:'purge'}` в
serviceWorker и в `message`-обработчике sw.js чистить DATA_CACHE
(`caches.delete(DATA_CACHE)`), плюс версионирование кэша по logout.

### T71-G — rollback зависит от npm-registry

`rollback_to()` выполняет `pnpm install --frozen-lockfile` — при
недоступности registry откат ломается. Митигация: offline-mirror
(`pnpm config set store-dir` + `--offline`) или vendored node_modules
в бэкапе. P3.

### T71-H — нет CSP на страницах Next

`curl -sI /` — заголовков CSP нет (есть nosniff/Referrer-Policy/
Permissions-Policy/X-Frame-Options DENY от nginx). Инъекция через
`<img src>` закрыта валидацией imageKey (T54-B), но глубина обороны
ниже возможной. При введении CSP учесть inline theme-скрипт
(нужен nonce) и `next/inline-styles`.

### T71-I — upload-инфраструктура без потребителя

`POST /uploads/image` работает (проверено e2e images.spec), но ни один
экран не вызывает его; `Recipe.imageKey` NULL у всех 2000 рецептов
(решение MC-200). 8.1 МБ storage/ + эндпоинты простаивают. Варианты:
подключить к UI (фото приготовленных блюд) или пометить deprecated.

### T71-J — Sentry не подключён

`initSentry` готов и вызывается, но `SENTRY_DSN` отсутствует в env —
5xx не агрегируются (только journalctl). Завести DSN → событие появится
автоматически (код E26).

---

## Что чисто (подтверждено прогонами)

- **axe-core**: 0 serious/critical на /today, /fridge, /profile (авторизованные, 1280px).
- **Mobile 375**: 0 px горизонтального переполнения на /fridge.
- **Полный E2E**: 46/46 (вкл. happy-today с реальным accept-поллингом,
  theme-persist, SW-спеки через loopback, images, webhooks, i18n, axe).
- **Юниты**: api 166/166 (вкл. JOB_RETRY_OPTS, error-messages), web 229/229,
  contracts 10/10; CI 7/7 джоб зелёные.
- **Cookie**: Path=/, HttpOnly (mc_session), SameSite=Lax; CSRF double-submit
  работает (проверено негативными спеками).
- **deploy-safe**: rehearsal --force exit 0, все стадии исполняются реально
  (лог /tmp/deploy-mk3.log), rollback-ветки покрыты кодом.

## Рекомендации (приоритет)

1. **T71-A/B** — прокинуть настройки визарда + household peopleCount в
   генерацию плана (закрывает главный продуктовый разрыв accept-флоу).
2. **T71-F** — purge SW-кэшей на logout (пост `{type:'purge'}` в SW).
3. **T71-J** — завести Sentry DSN (staging) — код готов.
4. **T71-H** — CSP c nonce для inline-скриптов (после E28).
5. **T71-I** — продуктовое решение: подключить upload к UI или задепрекейтить.
