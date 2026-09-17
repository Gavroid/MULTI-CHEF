# MULTI-CHEF Audit R18 — MC-107 migrate controllers + promote-to-error + ULID fix

**Date:** 2026-09-17
**Author:** Hermes Agent (MiniMax-M3) — R18 round
**Object:** `apps/api` controllers pipe migration, ESLint rule promotion, integration test fix
**Deploy:** http://192.168.1.95:8080 (LAN, nginx gateway, systemd)
**HEAD at audit start:** `2aa3b55` (docs(audit): MC-103+MC-105 AUDIT-R16-SUMMARY)
**HEAD at audit end:** `d7af3d2` on `main` (CI 7/7 green, run 35230339954)

---

## Сводка

| Категория                                  | Результат                                                             |
| ------------------------------------------ | --------------------------------------------------------------------- |
| **MC-107 migration: 7 controllers → pipe** | ✅ pantry (×2), profile (×4), household (×1)                          |
| **MC-107 suppressions с обоснованием**     | ✅ 8 endpoints (meal-plans ×2, recommendations ×3, shopping-lists ×3) |
| **MC-107 promote-to-error**                | ✅ Rule теперь блокирует CI для любого `@Body()` без pipe             |
| **MC-011 ULID-safe prefixes (тест-bug)**   | ✅ `01INGRED`→`01NGREDX`, `01CATEGOR`→`01CATEGR`                      |
| **CI 7/7 green**                           | ✅ run 35230339954 на `d7af3d2`                                       |
| **Smoke на проде**                         | ✅ register 201, onboarding 200 (тест-регрессия исправлена)           |
| **Live-state checks**                      | Без изменений с R17 (то же состояние)                                 |
| **Backup перед мутациями**                 | ✅ `multichef-20260917T110711Z.sql.gz` (R17 backup ещё в окне)        |

### Acceptance criteria итоги

| AC       | Что проверяет                                  | Где верифицировано                                   | Статус |
| -------- | ---------------------------------------------- | ---------------------------------------------------- | ------ |
| MC-107.1 | Rule регистрируется                            | `pnpm lint` находит 0 violations                     | ✅     |
| MC-107.2 | False-positive-free на R16-compliant           | `auth.controller.ts` — 0 violations                  | ✅     |
| MC-107.3 | Self-gated на *.controller.ts                  | Rule скипает не-контроллер файлы                     | ✅     |
| MC-107.4 | 7 endpoints мигрированы на explicit Zod schema | `pnpm typecheck` + smoke pantry                      | ✅     |
| MC-107.5 | 8 disable-комментов с обоснованием             | `grep eslint-disable-next-line`                      | ✅     |
| MC-107.6 | Promote warning → error                        | `nest.js`: `'error'`                                 | ✅     |
| MC-107.7 | Все существующие тесты проходят                | unit 170/170 + integration 60/60                     | ✅     |
| MC-107.8 | Smoke на проде                                 | `/pantry/items` POST bad body → 400 VALIDATION_ERROR | ✅     |
| MC-107.9 | CI 7/7 green                                   | run 35230339954                                      | ✅     |
| MC-011   | ULID-safe test setup                           | `01NGREDX`/`01CATEGR` (Crockford alphabet)           | ✅     |

---

## Что было сделано

### MC-107 — migrate 7 controllers to @Body(ZodValidationPipe(Schema))

**Почему:** R17 ввёл rule `require-zod-body-schema`, и обнаружилось 15 violations в 6 контроллерах (auth был уже compliant после R16). R18 закрыл их: 7 миграций + 8 явных suppressions.

**Migrated (7 endpoints):**

| Файл                                | Endpoints                                                  | Schemas                                                                                  |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pantry/pantry.controller.ts`       | POST + PATCH                                               | `CreatePantryItemSchema`, `PatchPantryItemSchema`                                        |
| `profile/profile.controller.ts`     | PATCH, PUT /nutrition, POST /preferences, POST /onboarding | `ProfilePatchSchema`, `NutritionPutSchema`, `PreferenceCreateSchema`, `OnboardingSchema` |
| `household/household.controller.ts` | PATCH                                                      | `HouseholdPatchSchema`                                                                   |

**Suppressed (8 endpoints, body intentionally `unknown`):**

| Файл              | Кол-во | Обоснование                                          |
| ----------------- | ------ | ---------------------------------------------------- |
| `meal-plans`      | 2      | ad-hoc body; service validates via internal contract |
| `recommendations` | 3      | ad-hoc body; service validates via internal contract |
| `shopping-lists`  | 3      | ad-hoc body; service validates via internal contract |

Все suppressions: `// eslint-disable-next-line multichef/require-zod-body-schema -- body is intentionally \`unknown\`; service uses ad-hoc validation via internal contract`

### MC-107 — promote to error

`packages/eslint-config/nest.js`:

```diff
- 'multichef/require-zod-body-schema': 'warn',
+ 'multichef/require-zod-body-schema': 'error',
```

Любой будущий PR, который добавляет `@Body()` без `ZodValidationPipe(Schema)`, упадёт на lint stage CI.

### MC-011 — ULID-safe prefixes (тест-фикс, найден через diagnostic)

**Root cause:** integration test `POST /profile/onboarding creates NutritionProfile + Preferences` падал с 400 после MC-107 миграции. Диагностика через временный `[MC107-DIAG]` log в pipe показала:

```
[MC107-DIAG] body={"allergies":["01INGREDB208825EAAAAAAAAAA"],...}
[MC107-DIAG] FAILED: [{"validation":"regex","code":"invalid_string",
  "message":"must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)",
  "path":["allergies",0]}]
```

**Root cause:** тест setup создавал fake ingredient ULID с prefix `01INGRED` (содержит `I` — невалидный ULID) и `01CATEGOR` (содержит `O`). ULID spec (`/^[0-9A-HJKMNP-TV-Z]{26}$/`) исключает I, L, O, U.

**Почему раньше проходило:** на profile.controller.ts не было pipe, body доходил до service без Zod-валидации. После миграции ZodValidationPipe корректно отвергает невалидные ULID.

**Фикс:**

- `01INGRED` → `01NGREDX`
- `01CATEGOR` → `01CATEGR`

Оба новых prefix содержат только `[0-9A-HJKMNP-TV-Z]`.

---

## Live-state checks (output captured below)

| #   | Что                               | Команда                             | Вердикт                 |
| --- | --------------------------------- | ----------------------------------- | ----------------------- |
| 1   | API health                        | `curl -sf /api/v1/health/live`      | 200 ✅                  |
| 2   | API ready                         | `curl -sf /api/v1/health/ready`     | 200 ✅                  |
| 3   | Bind: 127.0.0.1 (R17 WP-1)        | `ss -tlnp \| grep :3000\\           | :3001`                  | 127.0.0.1 ✅ |
| 4   | Smoke /auth/register              | 5 cases                             | 5/5 ✅                  |
| 5   | Smoke /profile/onboarding         | с валидным ULID                     | 200 ✅                  |
| 6   | Smoke /pantry/items POST bad body | missing quantity                    | 400 VALIDATION_ERROR ✅ |
| 7   | Lint                              | `pnpm --filter @multichef/api lint` | 0 errors, 0 warnings ✅ |
| 8   | Typecheck                         | `pnpm run typecheck`                | 15/15 ✅                |
| 9   | Unit tests                        | `pnpm --filter @multichef/api test` | 170/170 ✅              |
| 10  | Integration tests (local)         | `--test-concurrency=1`              | 60/60 ✅                |
| 11  | CI 7/7 green                      | run 35230339954                     | success ✅              |

---

## Test command outputs

### Smoke /profile/onboarding на проде (после ULID fix + миграции)

```
POST /api/v1/profile/onboarding
  Body: { householdSize: 3, budgetPerWeekKopecks: 1250000,
          allergies: ["<real-prod-ingredient-ulid>"],
          likedIngredients: [], dislikedIngredients: [],
          appliances: ["STOVE","OVEN"], skillLevel: "CONFIDENT",
          typicalCookTimeMin: 30 }
  Response: 200 OK
  Body: { nutritionProfile: {...}, preferencesCreated: 1 }
```

### Smoke /pantry/items POST bad body

```
POST /api/v1/pantry/items
  Body: { "ingredientId":"ING","unit":"G" }   # missing quantity, bad ingredientId
  Response: 400 VALIDATION_ERROR
  Body: {
    "code": "VALIDATION_ERROR",
    "message": "Ошибка валидации запроса",
    "details": {
      "fields": {
        "ingredientId": ["must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)"],
        "quantityG": ["Required"]
      }
    }
  }
```

### CI run 35230339954 (на `d7af3d2`)

```
build          completed  success
secret-scan    completed  success
lint           completed  success
audit (T44-A)  completed  success
typecheck      completed  success
e2e (T28-B)    completed  success
test           completed  success
conclusion: success
```

---

## Файлы изменены

- `apps/api/src/pantry/pantry.controller.ts` — 2 миграции + ZodValidationPipe import
- `apps/api/src/profile/profile.controller.ts` — 4 миграции + 5 schema imports
- `apps/api/src/household/household.controller.ts` — 1 миграция + schema import
- `apps/api/src/meal-plans/meal-plans.controller.ts` — 2 disable-коммента
- `apps/api/src/recommendations/recommendations.controller.ts` — 3 disable-коммента
- `apps/api/src/shopping-lists/shopping-lists.controller.ts` — 3 disable-коммента
- `apps/api/src/__tests__/integration/profile-integration.test.ts` — ULID fix
- `packages/eslint-config/nest.js` — rule `warn` → `error`

---

## Коммиты на main

```
d7af3d2  Reapply "Reapply "chore(lint): MC-107 promote require-zod-body-schema to error"
2d2bcb1  Reapply "feat(api): MC-107 migrate 7 controllers to @Body(ZodValidationPipe(Schema))"
1e3492a  fix(test): MC-011 use ULID-safe prefixes in profile integration fixture
2b5ed88  Revert "Reapply ..."
6ac6090  Revert "feat(api)..."
6689394  Reapply "chore(lint)..."
c989ae0  Revert "chore(lint)..."
9a3beb0  chore(lint): MC-107 promote require-zod-body-schema to error
80018e2  feat(api): MC-107 migrate 7 controllers to @Body(ZodValidationPipe(Schema))
2aa3b55  docs(audit): MC-103+MC-105 AUDIT-R16-SUMMARY
```

История коммитов кривая (revert/reapply цикл во время отладки CI), но финальное состояние корректное.

---

## Known follow-ups for R19

1. **Оставшиеся `@Body() body: unknown` endpoints** (8 шт) — мигрировать на реальные Zod-схемы или удалить suppressions когда бэкенд будет готов. Каждое сейчас оправдано комментарием, но это тех-долг.
2. **19 stale `feature/MC-XXX-*` веток** (Phases 0-3) — операторское решение: archive или удалить.
3. **MC-200 (2000 recipes)** — отложен, нужен API-ключ.

---

## Round budget

- **MC-107 migration**: ~1 ч
- **CI red → ULID root cause → fix**: ~1.5 ч (включая revert/reapply цикл)
- **Verification + smoke + commit + push**: ~30 мин
- **Total**: ~3 ч (бюджет 6-8 ч, использован на ~40%)

R18 — done.
