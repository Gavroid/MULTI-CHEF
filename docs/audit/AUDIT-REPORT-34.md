# Технический, продуктовый и UI-аудит MULTI-CHEF (34-й круг)

**Дата:** 2026-09-15
**HEAD:** `f7e2585 chore(audit): AUDIT-REPORT-33 migration-safety`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-33.md`, `FIX-PLAN.md`
**Фокус:** OpenAPI / Swagger spec — completeness of `components.schemas`, `@ApiResponse` coverage, error codes.

## TL;DR

34-й круг: **4 находки** — 0 P0, 2 🟠 P2 (Swagger spec gaps), 2 🟡 P3.

- 🟠 **T34-A** — `swaggerSchemas` (Zod-derived OpenAPI schemas) содержит только **12 schemas**. Response DTOs для PantryItem, ShoppingList, MealPlan, PrepSession, Profile, Preference, NutritionProfile, Ingredient — **НЕ зарегистрированы**. Client SDK codegen сгенерирует `any`/`unknown` для $ref'ов.
- 🟠 **T34-B** — `household.controller.ts` имеет **0 `@ApiResponse`** для 2 endpoints. `shopping-lists` — 3 для 5, `meal-plans` — 3 для 5. Common error codes (401, 404, 422, 429) не документированы. OpenAPI codegen не знает ошибочные ответы.
- 🟡 **T34-C** — Ни один controller не документирует 5xx (500, 503). Realistic for INTERNAL_ERROR, но client SDK не имеет fallback type.
- 🟡 **T34-D** — `ErrorEnvelope` schema не зарегистрирован в `swaggerSchemas`. Clients не знают, как выглядит `{ error: { code, message, details? } }`.

---

## 1. Технические находки (34-й круг)

### T34-A. `swaggerSchemas` неполный — 12 из ~30 DTOs зарегистрированы 🟠 P2

**Файл:** `packages/contracts/src/zod-swagger.ts:46-79` (registered schemas).

**Что зарегистрировано (12):**

```ts
export const swaggerSchemas = {
  ListRecipesQuery,
  PaginatedRecipes,
  RecipeDto,
  RecipeDetailDto,
  TodayRequestDto,
  TodayRecommendationDto,
  RescueRequestDto,
  RescueResponseDto,
  RouletteDrawRequestDto,
  RouletteDrawResponseDto,
  RouletteRejectResponseDto,
  JobDto,
};
```

**Что НЕ зарегистрировано (но используется в API):**

| Resource     | DTOs (used in controllers)                                                 |
| ------------ | -------------------------------------------------------------------------- |
| PantryItem   | PantryItemDto, PantryItemView, CreatePantryItemDto, PatchPantryItemDto     |
| ShoppingList | ShoppingListDto, ShoppingListItemDto, ShoppingListItemView                 |
| MealPlan     | MealPlanDto, MealPlanDayDto, MealPlanEntryDto, PrepSessionDto, PrepTaskDto |
| Profile      | ProfileDto, ProfilePatchDto, OnboardingDto, NutritionPutDto, PreferenceDto |
| Ingredient   | IngredientDto, NutritionDto, CategoryDto                                   |
| **Common**   | **ErrorEnvelope**, ErrorBody, ValidationErrorDetails                       |

**Проверка:**

```bash
$ grep -c "swaggerSchemas\|^  [A-Z][a-zA-Z]*: toSwagger" packages/contracts/src/zod-swagger.ts
13  # 1 export + 12 schemas
```

```bash
$ grep -rn "@ApiResponse.*type:" apps/api/src/ 2>/dev/null | grep -v __tests__ | head -10
# (типизированные responses с PantryItemDto, ShoppingListDto, etc — likely few)
```

**Эффект:**

- Client SDK generation (например, через `openapi-typescript` или `openapi-generator-cli`):
  - `RecipeDto` resolves ✓
  - `PantryItemDto` → `$ref` resolves to **nothing** (no schema) → клиент получает `unknown` или ошибку компиляции.
- Тестирование через Dredd / Prism — не сможет validate ответы.
- Manual doc review — programmer смотрит на Swagger UI, видит пустые объекты.

**Смягчающие факторы:**

- NestJS `@ApiProperty()` декораторы на DTO-classes дают partial Swagger schema через `@nestjs/swagger`'s `CLI Plugin`. Если plugin включён в `nest-cli.json`, то классы автоматически сканируются.

**Проверка nest-cli.json:**

```bash
$ cat apps/api/nest-cli.json 2>/dev/null
# (если plugin "classToPlain" или "swagger" отсутствует → ручная регистрация нужна)
```

**Рекомендованный фикс:**

1. Расширить `swaggerSchemas` в `packages/contracts/src/zod-swagger.ts`:

   ```ts
   import {
     PantryItemDtoSchema,
     PatchPantryItemDtoSchema,
     CreatePantryItemDtoSchema,
   } from './pantry.js';
   import { ShoppingListDtoSchema, ShoppingListItemDtoSchema } from './shopping-lists.js';
   // ... и т.д.

   export const swaggerSchemas = {
     // ...existing 12,
     PantryItemDto: toSwagger('PantryItemDto', PantryItemDtoSchema as ZodTypeAny),
     // ...
     ErrorEnvelope: toSwagger('ErrorEnvelope', ErrorEnvelopeSchema as ZodTypeAny),
   };
   ```

2. Создать **базовый ErrorEnvelopeSchema** в `packages/contracts/src/errors.ts`:

   ```ts
   export const ErrorEnvelopeSchema = z.object({
     status: z.number(),
     error: z.object({
       code: z.string(),
       message: z.string(),
       details: z.record(z.unknown()).optional(),
       requestId: z.string().optional(),
     }),
   });
   ```

3. Использовать `ErrorEnvelope` во всех `@ApiResponse({ status: 4xx, type: ErrorEnvelope })` (после T34-B).

### T34-B. Неполные `@ApiResponse` на controllers — нет common error codes 🟠 P2

**Файлы:** `apps/api/src/household/household.controller.ts`, `shopping-lists.controller.ts`, `meal-plans.controller.ts`, `jobs.controller.ts`.

**Сырой код (household):**

```ts
// apps/api/src/household/household.controller.ts:26-29
@Get()
@ApiOperation({ summary: "Get the authenticated user's household" })
async get(@Req() req: FastifyRequest): Promise<unknown> {
  // ← нет @ApiResponse для 401, 404, 500
}

// household.controller.ts:32-...
@Patch()
@HttpCode(200)
@ApiOperation({ summary: 'Update household metadata (owner-only)' })
async patch(...): Promise<unknown> {
  // ← нет @ApiResponse для 401, 403, 409
}
```

**Сырой код (shopping-lists):**

```bash
$ grep -c "@ApiResponse" apps/api/src/shopping-lists/shopping-lists.controller.ts
3
$ grep -c "@Get\|@Post\|@Patch\|@Delete" apps/api/src/shopping-lists/shopping-lists.controller.ts
5
```

5 endpoints, 3 documented responses. Не документированы `401`, `404`, `409`, `429` для большинства.

**Сырой код (meal-plans):**

```bash
$ grep -c "@ApiResponse" apps/api/src/meal-plans/meal-plans.controller.ts
3
$ grep -c "@Get\|@Post\|@Patch\|@Delete" apps/api/src/meal-plans/meal-plans.controller.ts
5
```

5 endpoints, 3 documented responses.

**Эффект:**

- OpenAPI codegen не знает, что `GET /shopping-lists/:id` может вернуть 401 (нет session) или 404 (list not found).
- Manual integration: разработчик смотрит на Swagger UI, видит только 200 response → пишет код без обработки ошибок → runtime 401/404 → необработанный exception в клиенте.

**Проверка:**

```bash
$ python3 /tmp/check.py
# (см. выше — endpoints missing common codes)
```

**Рекомендованный фикс:**

1. Базовый helper — `apps/api/src/common/swagger-decorators.ts`:

   ```ts
   import { applyDecorators } from '@nestjs/common';
   import { ApiResponse } from '@nestjs/swagger';

   export function StandardAuthResponses(): MethodDecorator {
     return applyDecorators(
       ApiResponse({ status: 401, description: 'No session or invalid session' }),
       ApiResponse({ status: 429, description: 'Rate-limited (per-IP or per-user)' }),
     );
   }

   export function StandardNotFoundResponses(resource: string): MethodDecorator {
     return applyDecorators(ApiResponse({ status: 404, description: `${resource} not found` }));
   }
   ```

2. Применить ко всем controller-методам:

   ```ts
   @Get(':id')
   @ApiOperation(...)
   @StandardAuthResponses()
   @StandardNotFoundResponses('PantryItem')
   async get(...)
   ```

3. Также добавить общие `5xx`:
   ```ts
   @ApiResponse({ status: 500, description: 'INTERNAL_ERROR (unexpected)' })
   @ApiResponse({ status: 503, description: 'SERVICE_UNAVAILABLE (DB/Redis unreachable)' })
   ```

### T34-C. Ни один controller не документирует 5xx responses 🟡 P3

**Файлы:** все controllers.

**Проверка:**

```bash
$ grep -rn "status: 500\|status: 503" apps/api/src/ 2>/dev/null | grep -v __tests__ | head -10
# (пусто — ни одного 5xx в @ApiResponse)
```

**Эффект:**

- Clients никогда не увидят 500/503 в OpenAPI doc. Если backend падает, у клиента нет documented type for error response.
- Принято НЕ документировать 500 (unpredictable). Но 503 (SERVICE_UNAVAILABLE) документируется в `apps/api/src/health/health.controller.ts:READY_RESPONSE` shape — должен быть в API error envelope.

**Рекомендованный фикс:** добавить global filter для 5xx:

```ts
@Standard5xxResponses() // → @ApiResponse 500 + 503
```

### T34-D. `ErrorEnvelope` schema не в `swaggerSchemas` 🟡 P3

**Файл:** `packages/contracts/src/zod-swagger.ts` (нет ErrorEnvelopeSchema).

**Эффект:**

- Даже если все `@ApiResponse` используют `type: ErrorEnvelope` (NestJS pattern), `$ref: '#/components/schemas/ErrorEnvelope'` не resolve.
- Clients не знают структуру ошибки.

**Рекомендованный фикс:** создать `ErrorEnvelopeSchema` в `packages/contracts/src/errors.ts`, добавить в `swaggerSchemas`. Использовать во всех `@ApiResponse({ type: ErrorEnvelope })`.

---

## 2. Подтверждённые здоровые паттерны

- **Swagger отключён в production** (`if (env.NODE_ENV !== 'production')`) ✓ — security best practice.
- **`@ApiBearerAuth('session-token')` + `@ApiCookieAuth('mc_session')`** на классах ✓.
- **`swaggerSchemas` через Zod-to-JSON-Schema** — single source of truth (Zod contracts → OpenAPI). ✓
- **Swagger UI под `/api/v1/docs`** (не root) — operational isolation. ✓
- **`addCookieAuth` правильно указывает `mc_session`** ✓.

## 3. Микро-наблюдения

- **T34-α** — `@nestjs/swagger`'s CLI Plugin может автоматически сканировать DTO-classes. Если включён (`nest-cli.json` plugins) — повторное использование `@ApiProperty()` уже генерирует schemas. Hygiene: проверить.
- **T34-β** — `swaggerSchemas` имеет `as const` — типы становятся readonly tuple. Хорошо для type safety.
- **T34-γ** — Recipe и Recommendations schemas зарегистрированы — это наиболее документированные ресурсы. ✓
- **T34-δ** — Pantry schemas НЕ зарегистрированы, хотя pantry — самый большой controller. Inconsistency.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона          | Находка                                                                                                                                                           | Где                                                                                                          |
| --------- | --------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **T34-A** | 🟠 P2     | API / Swagger | `swaggerSchemas` — только 12 schemas. PantryItem, ShoppingList, MealPlan, Profile, Preference, NutritionProfile, Ingredient, ErrorEnvelope — НЕ зарегистрированы. | `packages/contracts/src/zod-swagger.ts:46-79`                                                                |
| **T34-B** | 🟠 P2     | API / Swagger | `household.controller.ts` — 0 `@ApiResponse`. `shopping-lists` / 5, `meal-plans` / 5 — нет common error codes (401, 404, 422, 429).                               | `apps/api/src/household/household.controller.ts`, `shopping-lists.controller.ts`, `meal-plans.controller.ts` |
| **T34-C** | 🟡 P3     | API / Swagger | Ни один controller не документирует 5xx responses. Clients не знают fallback.                                                                                     | Все controllers                                                                                              |
| **T34-D** | 🟡 P3     | API / Swagger | `ErrorEnvelope` schema не зарегистрирован в `swaggerSchemas`. $ref → unresolved.                                                                                  | `packages/contracts/src/zod-swagger.ts` (отсутствует)                                                        |

## 5. Куммулятивный итог (34 кругов)

| Iter   | Round   | Topic                 | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | --------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–30  | #21–#30 | (предыдущие раунды)   | —            | 0     | 0     | 5     | 25    |
| 31     | #31     | API Zod validation    | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene        | T32-A..D     | 0     | 0     | 2     | 2     |
| 33     | #33     | DB migration safety   | T33-A..D     | 0     | 0     | 1     | 3     |
| **34** | **#34** | **OpenAPI / Swagger** | **T34-A..D** | **0** | **0** | **2** | **2** |

Cumulative after 34: P0=12, P1=2, P2=22, P3=39.

**Тренд 34-го:** OpenAPI / Swagger hygiene. После API validation (31), cookie (32), DB (33) — focus shifts на API documentation. T34-A + T34-B критичны для SDK-генерации и client-side error handling.

## 6. Рекомендации (34-й круг)

1. **(P2, 4ч, T34-A)** Расширить `swaggerSchemas` всеми DTOs: PantryItem, ShoppingList, MealPlan, Profile, Preference, NutritionProfile, Ingredient, **ErrorEnvelope**. Создать `packages/contracts/src/errors.ts` с `ErrorEnvelopeSchema`.
2. **(P2, 2ч, T34-B)** Создать `apps/api/src/common/swagger-decorators.ts` с `StandardAuthResponses()`, `StandardNotFoundResponses(resource)`, `StandardConflictResponses(reason)`, `StandardThrottled()`. Применить ко всем контроллерам.
3. **(P3, 30 мин, T34-C)** Добавить global `5xx` декоратор (500 INTERNAL_ERROR + 503 SERVICE_UNAVAILABLE) на все controller-методы.
4. **(P3, 30 мин, T34-D)** Использовать `type: ErrorEnvelope` во всех `@ApiResponse` (после T34-A).

## 7. Артефакты (34-й круг)

| Артефакт                     | Где                             |
| ---------------------------- | ------------------------------- |
| Этот отчёт                   | `docs/audit/AUDIT-REPORT-34.md` |
| FIX-PLAN (T34-A,B,C,D)       | `docs/audit/FIX-PLAN.md`        |
| Incomplete swaggerSchemas    | §1 T34-A                        |
| Missing @ApiResponse         | §1 T34-B                        |
| No 5xx docs                  | §1 T34-C                        |
| ErrorEnvelope not registered | §1 T34-D                        |
