# MULTI-CHEF Audit R19 — close MC-107 + branch cleanup

**Date:** 2026-09-17
**Author:** Hermes Agent (MiniMax-M3) — R19 round
**Object:** `apps/api` controllers pipe migration completion, branch cleanup, contract schemas
**Deploy:** http://192.168.1.95:8080 (LAN, nginx gateway, systemd)
**HEAD at audit start:** `6f8c69b` (docs(audit): AUDIT-R18-SUMMARY)
**HEAD at audit end:** `9aaf78f` on `main`

---

## Сводка

| Категория                                    | Результат                                                        |
| -------------------------------------------- | ---------------------------------------------------------------- |
| **MC-107 migration: 8 оставшихся endpoints** | ✅ meal-plans (×2), recommendations (×3), shopping-lists (×3)    |
| **Branch cleanup: 28 stale feature веток**   | ✅ Удалены через GitHub REST API (204 все)                       |
| **AUDIT-R18-SUMMARY.md**                     | ✅ Зафиксирован R18 в git (commit 6f8c69b)                       |
| **New contract schemas**                     | ✅ TogglePrepTaskRequestDtoSchema, MarkPurchasedRequestDtoSchema |
| **Manual safeParse удалён**                  | ✅ ~30 строк boilerplate deleted                                 |
| **CI 7/7 green**                             | ⏳ run 35242109046 in progress at 9aaf78f                        |

### Branch state: only 3 branches remaining

```
main                              (production)
docs/v0.1.0-release               (active release notes)
test/deploy-safe-rehearsal        (test branch from R13)
```

Deleted in R19: 28 `feature/MC-XXX-*` веток (Phases 0-3, последние коммиты 8-12 сентября, все merged in main).

---

## Что было сделано

### 1. MC-107 migration — оставшиеся 8 endpoints

Каждый из этих endpoints ранее имел `@Body() body: unknown` + manual `safeParse` внутри controller. R19 переместил валидацию в pipe layer.

| Файл                                            | Endpoint                    | Schema                                 |
| ----------------------------------------------- | --------------------------- | -------------------------------------- |
| `meal-plans/meal-plans.controller.ts`           | POST `/`                    | `MealPlanSetupDtoSchema`               |
| `meal-plans/meal-plans.controller.ts`           | PATCH `/prep-tasks/:taskId` | `TogglePrepTaskRequestDtoSchema` (new) |
| `recommendations/recommendations.controller.ts` | POST `/today`               | `TodayRequestDtoSchema`                |
| `recommendations/recommendations.controller.ts` | POST `/rescue`              | `RescueRequestDtoSchema`               |
| `recommendations/recommendations.controller.ts` | POST `/roulette/draw`       | `RouletteDrawRequestDtoSchema`         |
| `shopping-lists/shopping-lists.controller.ts`   | POST `/:id/fit-budget`      | `FitBudgetRequestDtoSchema`            |
| `shopping-lists/shopping-lists.controller.ts`   | POST `/:id/apply-proposal`  | `ApplyBudgetProposalDtoSchema`         |
| `shopping-lists/shopping-lists.controller.ts`   | PATCH `/items/:itemId`      | `MarkPurchasedRequestDtoSchema` (new)  |

### 2. New contract schemas

В `packages/contracts/src/params.ts` добавлены:

```ts
export const TogglePrepTaskRequestDtoSchema = z.object({ done: z.boolean() }).strict();
export type TogglePrepTaskRequestDto = z.infer<typeof TogglePrepTaskRequestDtoSchema>;

export const MarkPurchasedRequestDtoSchema = z.object({ purchased: z.boolean() }).strict();
export type MarkPurchasedRequestDto = z.infer<typeof MarkPurchasedRequestDtoSchema>;
```

Re-exported через локальные `.dto.ts` файлы контроллеров (как и все остальные schemas).

### 3. Branch cleanup

Удалено **28 веток** через GitHub REST API (DELETE → 204 No Content все):

```
feature/MC-001-monorepo-scaffold      feature/MC-031-backend-recipe-seed
feature/MC-002-dev-infra              feature/MC-032-recommendation-package
feature/MC-003-prisma-schema          feature/MC-033-chain-tags-dto
feature/MC-004-docs-regulations       feature/MC-033-recommendations-endpoints
feature/MC-005-ci-secret-scan         feature/MC-034-today-wizard-result
feature/MC-010-backend-auth           feature/MC-035-recipe-page
feature/MC-012-frontend-design-system feature/MC-040-rescue-backend
feature/MC-013-frontend-app-shell     feature/MC-042-roulette
feature/MC-014-frontend-auth-screens  feature/MC-050-jobs-queue
feature/MC-020-backend-seed           feature/MC-051-weekly-planner
feature/MC-021-backend-ingredient-search feature/MC-052-shopping-list
feature/MC-022-backend-pantry-crud    feature/MC-054-fit-budget
feature/MC-023-frontend-fridge        feature/MC-055-plan-web
feature/MC-030-backend-nutrition-package feature/MC-056-shopping-web
```

Дата последних коммитов во всех 28 — 8-12 сентября 2026 (9-10 дней до R19). Все были merged в main.

---

## Live-state checks (output captured below)

| #   | Что                                       | Команда                              | Вердикт                              |
| --- | ----------------------------------------- | ------------------------------------ | ------------------------------------ |
| 1   | API health                                | `curl -sf /api/v1/health/live`       | 200 ✅                               |
| 2   | API ready                                 | `curl -sf /api/v1/health/ready`      | 200 ✅                               |
| 3   | Bind 127.0.0.1 (R17 WP-1)                 | `ss -tlnp \| grep :3000\\            | :3001`                               | 127.0.0.1 ✅ |
| 4   | Smoke /recommendations/today {}           | curl                                 | 200 ✅                               |
| 5   | Smoke PATCH /meal-plans/prep-tasks/abc {} | curl                                 | 400 VALIDATION_ERROR ✅              |
| 6   | Lint                                      | `pnpm --filter @multichef/api lint`  | 0 errors, 0 warnings ✅              |
| 7   | Typecheck                                 | `pnpm run typecheck`                 | 15/15 ✅                             |
| 8   | Unit tests                                | `pnpm --filter @multichef/api test`  | 170/170 ✅                           |
| 9   | Integration tests (local)                 | `--test-concurrency=1`               | 69/69 ✅                             |
| 10  | Build                                     | `pnpm --filter @multichef/api build` | clean ✅                             |
| 11  | Branch count                              | `GET /branches?per_page=100`         | 3 (было 31) ✅                       |
| 12  | CI 7/7                                    | run 35242109046                      | in progress (5/7 success at writing) |

---

## Test command outputs

### Smoke на проде (после миграции)

```
POST /api/v1/recommendations/today
  Body: {}
  Response: 200 OK
  Body: { "options": [{ "type": "FROM_PANTRY", "recipe": { "id": "...", "title": "Булгур отварной", ... } }] }

PATCH /api/v1/meal-plans/prep-tasks/abc
  Body: {}
  Response: 400 BAD_REQUEST
  Body: {
    "code": "VALIDATION_ERROR",
    "message": "Ошибка валидации запроса",
    "details": { "fields": { "done": ["Required"] } }
  }
```

### Локальные integration tests (после миграции)

```
ℹ tests 69
ℹ suites 0
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 81283.936398
```

---

## Файлы изменены

- `packages/contracts/src/params.ts` — добавлены `TogglePrepTaskRequestDtoSchema`, `MarkPurchasedRequestDtoSchema`
- `apps/api/src/meal-plans/meal-plans.dto.ts` — re-export `TogglePrepTaskRequestDtoSchema`
- `apps/api/src/meal-plans/meal-plans.controller.ts` — 2 pipes, manual safeParse удалён, `AppHttpException` import убран (unused)
- `apps/api/src/recommendations/recommendations.controller.ts` — 3 pipes, manual safeParse удалён, `AppHttpException` import убран (unused)
- `apps/api/src/shopping-lists/shopping-lists.dto.ts` — re-export `MarkPurchasedRequestDtoSchema`
- `apps/api/src/shopping-lists/shopping-lists.controller.ts` — 3 pipes, manual safeParse удалён

Diff: 66 insertions(+), 97 deletions(-) — net -31 строк boilerplate.

---

## Коммиты на main (R19)

```
9aaf78f  feat(api): MC-107 migrate remaining 8 endpoints to ZodValidationPipe(Schema)
6f8c69b  docs(audit): AUDIT-R18-SUMMARY
d7af3d2  Reapply "Reapply "chore(lint): MC-107 promote require-zod-body-schema to error"
2d2bcb1  Reapply "feat(api): MC-107 migrate 7 controllers to @Body(ZodValidationPipe(Schema))"
1e3492a  fix(test): MC-011 use ULID-safe prefixes in profile integration fixture
```

---

## MC-107 final state

После R16+R17+R18+R19 **ВСЕ** `@Body()` в NestJS controllers используют explicit Zod schema:

| Статус                                          | Количество                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Migrated (explicit `ZodValidationPipe(Schema)`) | **15** (4 auth + 2 pantry + 4 profile + 1 household + 2 meal-plans + 3 recommendations + 3 shopping-lists) |
| Disable suppressions                            | **0** (все заменены на explicit schemas)                                                                   |
| Total                                           | 15                                                                                                         |

ADR-0024 zod-validation-strategy **полностью реализован**: ни одного `@Body()` без pipe не осталось.

---

## Known follow-ups for R20+

1. **MC-200 (2000 recipes)** — отложен, нужен API-ключ.
2. **Lint-rule для других DTOs** — могут быть DTO вне `*.controller.ts` (DTOs, validators, services), которые тоже стоит валидировать. R20 audit candidate.
3. **Pre-existing CI strictness gap** — dev tsconfig мог бы включать `noUncheckedIndexedAccess` (в R17 выяснилось что уже включён в base, но это можно задокументировать явно).

---

## Round budget

- **MC-107 migration remaining 8 endpoints**: ~1 ч
- **Branch cleanup (28 веток)**: ~10 мин
- **AUDIT-R18-SUMMARY**: ~5 мин (commited в начале сессии)
- **Verification + smoke + commit + push + CI waiting**: ~30 мин
- **Total**: ~1.5 ч (бюджет 6-8 ч, использован на ~20%)

R19 — done.
