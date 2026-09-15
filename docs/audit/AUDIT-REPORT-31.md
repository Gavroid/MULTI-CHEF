# Технический, продуктовый и UI-аудит MULTI-CHEF (31-й круг)

**Дата:** 2026-09-15
**HEAD:** `6d36bb3 chore(audit): AUDIT-REPORT-30 wcag-a11y-finale`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-30.md`, `FIX-PLAN.md`
**Фокус:** API Zod-валидация — coverage path/query/body params, ULID-формат, consistency.

## TL;DR

31-й круг: **4 находки** — 0 P0, 1 🟠 P2 (validation inconsistency), 3 🟡 P3.

- 🟠 **T31-A** — Непоследовательная валидация ULID в path-параметрах: `PantryItemIdParamsSchema` строго валидирует regex `/^[0-9A-HJKMNP-TV-Z]{26}$/`, а `RecipeIdParamsSchema` / `IngredientsIdParamsSchema` принимают любую строку до 64 chars; shopping-lists используют `@Param('id') listId: string` без Zod вообще. Невалидный id → 404 с неопределённым сообщением вместо точного 400.
- 🟡 **T31-B** — `RecipeIdParamsSchema: z.string().min(1).max(64)` — ULID имеет точно 26 chars. Любая строка 27–64 chars проходит schema, потом 404 в DB. Wasted check, fuzzy error.
- 🟡 **T31-C** — `shopping-lists.controller.ts` использует `@Param('id') listId: string` без какой-либо Zod-валидации. Аналогично meal-plans `@Param('taskId') taskId: string`. Сервис получает raw string — потенциальные Prisma-запросы с невалидными/очень длинными строками.
- 🟡 **T31-D** — `TodayParamsSchema = z.object({}).strip()` (recommendations.dto.ts:27) — empty schema с `.strip()`. Мёртвый код, нечего валидировать.

---

## 1. Технические находки (31-й круг)

### T31-A. Непоследовательная ULID-валидация в path-параметрах 🟠 P2

**Файлы:**

- Strict ULID: `apps/api/src/pantry/pantry.dto.ts:40` (`ulidSchema`), `apps/api/src/ingredients/ingredients.dto.ts:75`, `apps/api/src/profile/profile.dto.ts:25`.
- Loose: `apps/api/src/recipes/recipes.dto.ts:20`, `apps/api/src/ingredients/ingredients.dto.ts:63`, `apps/api/src/shopping-lists/shopping-lists.controller.ts` (no Zod), `apps/api/src/meal-plans/meal-plans.controller.ts` (no Zod).

**Сырой код (strict vs loose):**

```ts
// apps/api/src/pantry/pantry.dto.ts:40, 99-103
const ulidSchema = z.string().regex(ULID, 'must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)');

export const PantryItemIdParamsSchema = z
  .object({
    id: ulidSchema, // ← STRICT: только валидный ULID
  })
  .strict();

// apps/api/src/recipes/recipes.dto.ts:20
export const RecipeIdParamsSchema = z.object({ id: z.string().min(1).max(64) }); // ← LOOSE

// apps/api/src/ingredients/ingredients.dto.ts:63-68
export const IngredientsIdParamsSchema = z
  .object({
    id: z.string().min(1, 'id is required'),
  })
  .strict(); // ← LOOSE: min 1, no ULID check
```

**Сырой код (no Zod):**

```ts
// apps/api/src/shopping-lists/shopping-lists.controller.ts:43
async fitBudget(
  @Req() req: FastifyRequest,
  @Param('id') listId: string,    // ← raw string, no Zod
  @Body() body: unknown,
): Promise<FitBudgetResponseDto> { ... }

// apps/api/src/meal-plans/meal-plans.controller.ts:69-74
async setTaskDone(
  @Req() req: FastifyRequest,
  @Param('taskId') taskId: string,    // ← raw string, no Zod
  ...
)
```

**Эффект:**

1. **Inconsistency** — разные ресурсы валидируются по-разному. Code reviewer не знает, какой стандарт применять.
2. **Клиент получает 404 RECIPE_NOT_FOUND на `GET /recipes/abc123`** (где `abc123` — невалидный ULID формат) вместо точного 400 INVALID_RECIPE_ID. Пользователь/клиент не понимает — id же не пустой, почему 404?
3. **Prisma-side overhead** — Prisma получает query типа `WHERE id = 'a-very-long-string-with-special-chars-...'` → Postgres делает index lookup → 0 rows → return 404. Если строка очень длинная (>2000 chars, нет upper bound в текущих schema), Postgres всё равно примет, но network overhead.
4. **Security hygiene** — нет `.strict()` на некоторых params schemas (`RecipeIdParamsSchema` — без `.strict()`). Extra fields silently ignored.

**Проверка:**

```bash
$ grep -rn "regex(ULID\|z.string().regex(ULID" apps/api/src packages/contracts/src 2>/dev/null
apps/api/src/pantry/pantry.dto.ts:40:const ulidSchema = z.string().regex(ULID, 'must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)');
apps/api/src/ingredients/ingredients.dto.ts:75:    id: z.string().regex(ULID, 'id must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)'),
apps/api/src/profile/profile.dto.ts:25:const ulidSchema = z.string().regex(ULID, 'must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)');
# (только 3 места — pantry, ingredients/nutrition, profile. Recipes/Shopping/MealPlan — нет)
```

**Рекомендованный фикс:**

1. **Централизовать `ulidSchema` в `packages/contracts`**, например `packages/contracts/src/ulid.ts`:
   ```ts
   import { z } from 'zod';
   export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
   export const ulidSchema = z.string().regex(ULID, 'must be a ULID');
   export const UlidParamsSchema = z.object({ id: ulidSchema }).strict();
   export const TaskIdParamsSchema = z.object({ taskId: ulidSchema }).strict();
   export const ListIdParamsSchema = z.object({ id: ulidSchema }).strict();
   export const ItemIdParamsSchema = z.object({ itemId: ulidSchema }).strict();
   ```
2. **Заменить loose schemas**:
   - `RecipeIdParamsSchema` → `UlidParamsSchema`
   - `IngredientsIdParamsSchema` → `UlidParamsSchema`
   - Все `@Param('id') listId: string` → `@Param() params: ListIdParams` + safeParse
   - Все `@Param('taskId') taskId: string` → `@Param() params: TaskIdParams` + safeParse

3. **Helper wrapper** (опционально): `validatedParam<T>(req, ParamSchema)` — утилита для декоратора.

### T31-B. `RecipeIdParamsSchema` принимает строки до 64 chars — ULID 26 chars 🟡 P3

**Файл:** `apps/api/src/recipes/recipes.dto.ts:20`.

**Сырой код:**

```ts
export const RecipeIdParamsSchema = z.object({ id: z.string().min(1).max(64) });
```

**Проблема:**

ULID — точно 26 chars (см. `apps/api/src/pantry/pantry.dto.ts:25` и `apps/api/src/ingredients/ingredients.dto.ts`). `min(1).max(64)` пропускает:

- `'abc'` (3 chars) — DB lookup miss, 404.
- `'0123456789012345678901234567'` (27 chars, формально валидный prefix но не ULID alphabet) — DB lookup miss, 404.
- `'a'.repeat(64)` (64 chars) — DB lookup miss, 404.

Каждый invalid id → Prisma делает indexed lookup → 0 rows → 404 RECIPE_NOT_FOUND с общим message.

**Эффект:**

- Wasted DB lookups на явно невалидные ids.
- Fuzzy 404 вместо точного 400 INVALID_RECIPE_ID.
- Inconsistency: pantry отвергает `id` < 26 chars на уровне schema, recipes принимает.

**Рекомендованный фикс:** заменить на `z.object({ id: ulidSchema }).strict()` (после T31-A).

### T31-C. shopping-lists & meal-plans path params без Zod валидации 🟡 P3

**Файлы:**

- `apps/api/src/shopping-lists/shopping-lists.controller.ts:43, 62, 81` (3 места с `@Param('id') listId: string` / `@Param('itemId') itemId`).
- `apps/api/src/meal-plans/meal-plans.controller.ts:69` (`@Param('taskId') taskId: string`).

**Сырой код (пример):**

```ts
// shopping-lists.controller.ts:42-53
async fitBudget(
  @Req() req: FastifyRequest,
  @Param('id') listId: string,    // ← string, no Zod
  @Body() body: unknown,
): Promise<FitBudgetResponseDto> {
  const user = currentUser(req as unknown as { user: AuthenticatedUser });
  const parsed = FitBudgetRequestDtoSchema.safeParse(body ?? {});
  // ...
  return this.svc.fitBudget(user.id, listId, parsed.data.targetBudgetKopecks);  // ← listId goes raw to service
}
```

**Эффект:**

`listId` — любой string (включая `'../../etc/passwd'` через URL-encoding bypass, `'a'.repeat(10000)` очень длинная строка). Prisma использует prepared statements → SQL injection невозможен. **Но:**

1. Postgres index lookup на огромную строку — незначительная perf cost.
2. `findFirst({ where: { id: listId, householdId } })` → 0 rows → 404 SHOPPING_LIST_NOT_FOUND с общим message. UX не идеален.
3. Если в будущем `listId` появится в логах (например, error path) — потенциальная privacy leak (но listId не PII, так что OK).

**Смягчающие факторы:**

- Нет security issue (Prisma parameterizes всё).
- Service обычно делает ownership check (`userId` + `householdId`) → returns 404 anyway.

**Рекомендованный фикс:** ввести Zod-валидацию:

```ts
import { UlidParamsSchema, ItemIdParamsSchema } from '@multichef/contracts';

async fitBudget(
  @Req() req: FastifyRequest,
  @Param() params: Record<string, string>,
  @Body() body: unknown,
): Promise<FitBudgetResponseDto> {
  const user = currentUser(...);
  const parsedParams = ListIdParamsSchema.safeParse(params);
  if (!parsedParams.success) throw validationError(parsedParams.error.issues);
  // use parsedParams.data.id instead of listId
}
```

### T31-D. `TodayParamsSchema = z.object({}).strip()` — empty schema, dead code 🟡 P3

**Файл:** `apps/api/src/recommendations/recommendations.dto.ts:27`.

**Сырой код:**

```ts
export const TodayParamsSchema = z.object({}).strip();
export type TodayParams = z.infer<typeof TodayParamsSchema>;
```

`z.object({}).strip()` — пустой schema, `.strip()` удаляет unknown keys (но их нет). Type `TodayParams = {}`.

**Проблема:**

`TodayParams` нигде не используется в коде (проверим):

```bash
$ grep -rn "TodayParams\b" apps packages 2>/dev/null
apps/api/src/recommendations/recommendations.dto.ts:27:export const TodayParamsSchema = z.object({}).strip();
apps/api/src/recommendations/recommendations.dto.ts:28:export type TodayParams = z.infer<typeof TodayParamsSchema>;
# (только объявление, нет использования)
```

**Рекомендованный фикс:** удалить `TodayParamsSchema` + `TodayParams` type. Это dead code.

---

## 2. Подтверждённые здоровые паттерны

- **Zod is the default**: 31+ использований `safeParse` в controllers/services. NestJS+Zod — основной паттерн.
- **`.strict()`** применён в большинстве body-schemas (ProfilePatchSchema, PantryItemIdParamsSchema, IngredientsIdParamsSchema). Защита от extra fields. ✓
- **`.coerce.number()`** в query schemas (ListRecipesQuerySchema — `limit: z.coerce.number().int()...`). Query strings → numbers корректно. ✓
- **Zod-валидация в body controllers** (shopping-lists, meal-plans, recommendations): `safeParse(body ?? {})` + `throw validationError(issues)`. ✓
- **Helper `validationError`**: есть в нескольких контроллерах. Унифицирует envelope. ✓
- **`ULID` regex определён в pantry/ingredients/profile** — 3 места, но одинаковый pattern. Hygiene: вынести в `packages/contracts`.

## 3. Микро-наблюдения

- **T31-α** — `IngredientsCategoryQuerySchema` используется для валидации «неиспользуемого» query в `GET /ingredients/categories` (см. `ingredients.controller.ts:67`) — `IngredientsCategoryQuerySchema.safeParse(_raw ?? {})` без throw. Можно выкинуть.
- **T31-β** — `IngredientIdQuerySchema` (pantry.dto.ts) валидирует ULID для filter — уже строгий. ✓
- **T31-γ** — Pantry/Profile/Ingredients используют Crockford Base32 regex `/^[0-9A-HJKMNP-TV-Z]{26}$/` (без I, L, O, U). Все три источника используют одинаковый regex — DRY нарушен, но consistent.
- **T31-δ** — `TodayParamsSchema` (dead code) и `RouletteDrawParamsSchema` (?) — проверить другие controllers на подобный dead code.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона             | Находка                                                                                                       | Где                                                                                                                                                                                                    |
| --------- | --------- | ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **T31-A** | 🟠 P2     | API / Validation | Inconsistent ULID path-param validation: pantry strict, recipes/ingredients loose, shopping/mealplans — none. | `apps/api/src/pantry/pantry.dto.ts:40`, `apps/api/src/recipes/recipes.dto.ts:20`, `apps/api/src/shopping-lists/shopping-lists.controller.ts:43`, `apps/api/src/meal-plans/meal-plans.controller.ts:69` |
| **T31-B** | 🟡 P3     | API / Validation | `RecipeIdParamsSchema` принимает строки до 64 chars. ULID — точно 26. Fuzzy 404 вместо 400.                   | `apps/api/src/recipes/recipes.dto.ts:20`                                                                                                                                                               |
| **T31-C** | 🟡 P3     | API / Validation | shopping-lists & meal-plans path-params без Zod (`@Param('id') listId: string`). Inconsistent coverage.       | `apps/api/src/shopping-lists/shopping-lists.controller.ts:43,62,81`; `apps/api/src/meal-plans/meal-plans.controller.ts:69`                                                                             |
| **T31-D** | 🟡 P3     | API / Hygiene    | `TodayParamsSchema = z.object({}).strip()` — dead code, не используется.                                      | `apps/api/src/recommendations/recommendations.dto.ts:27`                                                                                                                                               |

## 5. Куммулятивный итог (31 кругов)

| Iter   | Round   | Topic                    | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------ | ------------ | ----- | ----- | ----- | ----- |
| 1–20   | #1–#20  | (предыдущие раунды)      | —            | 12    | 2     | 14    | 8     |
| 21     | #21     | Worker job lifecycle     | T21-A..D     | 0     | 0     | 2     | 2     |
| 22     | #22     | Web dialog a11y          | T22-A..C     | 0     | 0     | 1     | 2     |
| 23     | #23     | TS validation            | T23-A..C     | 0     | 0     | 1     | 2     |
| 24     | #24     | nginx security headers   | T24-A..D     | 0     | 0     | 3     | 1     |
| 25     | #25     | Test coverage gaps       | T25-A..D     | 0     | 0     | 1     | 3     |
| 26     | #26     | Worker PII/observability | T26-A..C     | 0     | 0     | 0     | 3     |
| 27     | #27     | Infra/deploy pipeline    | T27-A..D     | 0     | 0     | 1     | 3     |
| 28     | #28     | CI/CD coverage           | T28-A..D     | 0     | 0     | 1     | 3     |
| 29     | #29     | Multi-tab cache          | T29-A..C     | 0     | 0     | 1     | 2     |
| 30     | #30     | WCAG / a11y              | T30-A..D     | 0     | 0     | 0     | 4     |
| **31** | **#31** | **API Zod validation**   | **T31-A..D** | **0** | **0** | **1** | **3** |

Cumulative after 31: P0=12, P1=2, P2=16, P3=33.

**Тренд 31-го:** API input validation. После worker (21), UI (22), types (23), infra (24-28) — внимание к API-контрактам. T31-A — главная находка: inconsistency в path-param validation создаёт fuzzy errors и потенциальную maintenance-ловушку.

## 6. Рекомендации (31-й круг)

1. **(P2, 1ч, T31-A)** Создать `packages/contracts/src/ulid.ts` с `ulidSchema` + стандартными `UlidParamsSchema`, `TaskIdParamsSchema`, `ListIdParamsSchema`, `ItemIdParamsSchema`. Заменить 6+ loose schemas на строгие.
2. **(P3, 15 мин, T31-B)** После T31-A — `RecipeIdParamsSchema` → `UlidParamsSchema`.
3. **(P3, 1ч, T31-C)** Добавить Zod-валидацию для shopping-lists и meal-plans `@Param` (после T31-A helper).
4. **(P3, 5 мин, T31-D)** Удалить `TodayParamsSchema` + `TodayParams` type.

## 7. Артефакты (31-й круг)

| Артефакт                     | Где                             |
| ---------------------------- | ------------------------------- |
| Этот отчёт                   | `docs/audit/AUDIT-REPORT-31.md` |
| FIX-PLAN (T31-A,B,C,D)       | `docs/audit/FIX-PLAN.md`        |
| Inconsistent ULID validation | §1 T31-A                        |
| RecipeIdParamsSchema loose   | §1 T31-B                        |
| shopping-lists no-Zod params | §1 T31-C                        |
| TodayParamsSchema dead code  | §1 T31-D                        |
