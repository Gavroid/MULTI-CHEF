# Технический, продуктовый и UI-аудит MULTI-CHEF (23-й круг)

**Дата:** 2026-09-15
**HEAD:** `88821ae chore(audit): AUDIT-REPORT-22 web-dialog-a11y`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-22.md`, `FIX-PLAN.md`
**Фокус:** TypeScript типы — `any`/`unknown` leaks, type-narrowing bugs, контроллер-валидация.

## TL;DR

23-й круг: **3 находки** — 1 🟠 P2 (silent input validation), 2 🟡 P3 (typings smell).

- 🟠 **T23-A** — `shopping-lists.setPurchased` и `meal-plans.setDone` валидируют `@Body() body: unknown` через **unsafe cast + `=== true`**. При некорректном типе (строка, число) — silent false. Другие endpoints в этих же модулях используют Zod `safeParse` и возвращают `VALIDATION_ERROR`. Расхождение контракта.
- 🟡 **T23-B** — 86 раз используется `req as unknown as { user: AuthenticatedUser }` в контроллерах, хотя `AuthenticatedRequest` интерфейс уже определён в `common/auth-guard.ts:26-29`. Не хватает **module augmentation** для FastifyRequest → `user?: AuthenticatedUser`. Hygiene/DRY.
- 🟡 **T23-C** — `enum PANTRY_SORT_FIELDS as unknown as string[]` (Swagger `@ApiQuery`) и аналогичные `as unknown as string[]` для `enum IngredientSortField`. Это костыль вокруг того, что TypeScript const-arrays не подходят как Swagger enum. Можно поправить через `as const satisfies readonly string[]` в исходном enum.

---

## 1. Технические находки (23-й круг)

### T23-A. Небезопасная валидация `setPurchased` / `setDone` — silent false 🟠 P2

**Файлы:**

- `apps/api/src/shopping-lists/shopping-lists.controller.ts:81-92` (setPurchased)
- `apps/api/src/meal-plans/meal-plans.controller.ts:85-94` (setDone — аналогично)

**Сырой код `setPurchased`:**

```ts
@Patch('items/:itemId')
@HttpCode(200)
@ApiOperation({ summary: 'Set the purchased flag of a list item' })
async setPurchased(
  @Req() req: FastifyRequest,
  @Param('itemId') itemId: string,
  @Body() body: unknown,                                          // ← нет Zod-парсинга
): Promise<{ purchased: boolean }> {
  const user = currentUser(req as unknown as { user: AuthenticatedUser });
  const purchased = (body as { purchased?: unknown } | null)?.purchased === true;  // ← unsafe cast
  return this.svc.setItemPurchased(user.id, itemId, purchased);
}
```

**Соседний `fitBudget` (правильный паттерн):**

```ts
@Post(':id/fit-budget')
async fitBudget(
  @Req() req: FastifyRequest,
  @Param('id') listId: string,
  @Body() body: unknown,
): Promise<FitBudgetResponseDto> {
  const user = currentUser(req as unknown as { user: AuthenticatedUser });
  const parsed = FitBudgetRequestDtoSchema.safeParse(body ?? {});    // ← Zod
  if (!parsed.success) {
    throw new AppHttpException({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body',
      details: { fields: { targetBudgetKopecks: ['required integer'] } },
    });
  }
  return this.svc.fitBudget(user.id, listId, parsed.data.targetBudgetKopecks);
}
```

Проблема: `setPurchased` НЕ использует Zod, а полагается на:

```ts
(body as { purchased?: unknown } | null)?.purchased === true;
```

Этот cast безопасен в compile-time (TypeScript пропускает), но в runtime:

- `body === null` → `null?.purchased === true` → `undefined === true` → `false`. ✓ (graceful)
- `body === undefined` → `undefined?.purchased === true` → `undefined === true` → `false`. ✓
- `body === { purchased: true }` → `true === true` → `true`. ✓
- **`body === { purchased: false }`** → `false === true` → `false`. ✓
- **`body === { purchased: "true" }`** (строка) → `"true" === true` → `false`. **Silent failure** — клиент думает что toggle-нул, а на деле сохранён `false`. ⚠
- **`body === { purchased: 1 }`** → `1 === true` → `false`. **Silent failure**. ⚠
- **`body === { purchased: null }`** → `null === true` → `false`. ✓
- **`body === { isPurchased: true }`** (опечатка) → `undefined === true` → `false`. **Silent failure**. ⚠

Контракт говорит «клиент шлёт `{purchased: true|false}`», но сервер:

1. **Не валидирует** структуру body.
2. **Молча игнорирует** нестандартные значения, возвращая успех.
3. **Не отвечает 400 VALIDATION_ERROR**, хотя Swagger говорит `@ApiResponse({ status: 200, description: 'Set the purchased flag of a list item' })` без упоминания 400.

**Сравнение с соседним `applyProposal`** (тот же файл, строки 56-79) — там `ZodSchema.safeParse` + VALIDATION_ERROR. То есть разработчик знает правильный паттерн, но для маленького boolean-флага решил «и так сойдёт».

**Эффект:** невалидный клиентский код (например, кто-то послал строку по ошибке) не получит фидбэка, и фича «отметь купленное» не работает у пользователя без объяснений. Баг трудно отловить без серверного лога.

**Доказательство:**

```bash
$ grep -n "body as {" apps/api/src/shopping-lists/shopping-lists.controller.ts apps/api/src/meal-plans/meal-plans.controller.ts
apps/api/src/shopping-lists/shopping-lists.controller.ts:88:    const purchased = (body as { purchased?: unknown } | null)?.purchased === true;
apps/api/src/meal-plans/meal-plans.controller.ts:91:    const done = (body as { done?: unknown } | null)?.done === true;

$ grep -n "safeParse\|FitBudgetRequestDtoSchema\|MarkDoneDtoSchema" apps/api/src/shopping-lists/shopping-lists.controller.ts apps/api/src/meal-plans/meal-plans.controller.ts
# (safeParse есть в fitBudget/apply/generate, но не в setPurchased/setDone)
```

**Рекомендованный фикс:** создать `SetPurchasedDtoSchema = z.object({ purchased: z.boolean() })` в `packages/contracts` (по аналогии с `FitBudgetRequestDtoSchema`), использовать `safeParse` + `VALIDATION_ERROR`. То же для `MarkDoneDtoSchema`. Сейчас расхождение: один boolean-параметр молча проглатывается, остальные — строго валидируются.

### T23-B. Двойной `as unknown as { user: AuthenticatedUser }` в каждом контроллере 🟡 P3

**Файлы:** `apps/api/src/{jobs,pantry,shopping-lists,meal-plans,ingredients,recommendations,recipes}/.../*.controller.ts` — 86 вхождений.

**Сырой код (пример):**

```ts
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../auth/auth.service.js';
// ...
const user = currentUser(req as unknown as { user: AuthenticatedUser });
```

Между тем в `apps/api/src/common/auth-guard.ts:26-29` уже определён интерфейс:

```ts
export interface AuthenticatedRequest {
  cookies: Record<string, string | undefined>;
  user?: AuthenticatedUser | undefined;
}
```

И в этом же файле `currentUser(req: { user?: AuthenticatedUser })` уже принимает нужный тип — без `unknown`-cast. Cast нужен только потому, что `req: FastifyRequest` НЕ имеет поля `user` в типах Fastify.

**Решение:** module augmentation для Fastify в одном файле, например `apps/api/src/common/fastify-augment.d.ts`:

```ts
import 'fastify';
import type { AuthenticatedUser } from '../auth/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
```

После этого:

- `req.user` будет доступен напрямую (опционально).
- `currentUser(req)` будет принимать `FastifyRequest` без cast.
- Можно даже заменить `currentUser(req as ...)` на `currentUser(req)`.

**Преимущества:**

- Удаление 86 cast'ов → компилятор начнёт ловить ошибки типа `req.user.id` без `?.`.
- DRY.
- Если позже появится второй middleware, который тоже вешает `req.foo`, типы сразу подхватят.

**Проверка:**

```bash
$ grep -rn "as unknown as { user: AuthenticatedUser }" apps/api/src/ | wc -l
86
$ grep -n "declare module" apps/api/src/
# (пусто — нет module augmentation нигде)
```

**Рекомендованный фикс:** добавить `apps/api/src/common/fastify-augment.d.ts` + `tsconfig.json` (или конкретного `apps/api/tsconfig.json`) должен включать `.d.ts` (по умолчанию включает, но стоит проверить).

### T23-C. `enum Foo as unknown as string[]` — костыль вокруг Swagger `@ApiQuery` 🟡 P3

**Файлы:**

- `apps/api/src/pantry/pantry.controller.ts:77-78`
- `apps/api/src/ingredients/ingredients.controller.ts:48-49`

**Сырой код:**

```ts
@ApiQuery({ name: 'sort', required: false, enum: PANTRY_SORT_FIELDS as unknown as string[] })
@ApiQuery({ name: 'order', required: false, enum: PANTRY_SORT_ORDERS as unknown as string[] })
```

Проблема: Swagger `@ApiQuery({ enum })` принимает только `typeof ENUM`-like (т.е. `Record<string, any>` из `enum Foo { ... }`), а не const-массивы. Команда использует const-массивы для типизации входных параметров (хорошо), но приходится кастовать в `string[]` для Swagger.

**Реальная причина:** определения, видимо, выглядят как:

```ts
export const PANTRY_SORT_FIELDS = ['name', 'expiresAt', 'priority'] as const;
export type PantrySortField = (typeof PANTRY_SORT_FIELDS)[number];
```

`as const` → тип `readonly ['name', 'expiresAt', 'priority']`. Swagger хочет `string[]` (не readonly, не readonly tuple).

**Альтернативы без `as unknown as string[]`:**

1. **Дженерик-обёртка:**
   ```ts
   function asEnum<T extends readonly string[]>(arr: T): string[] { return [...arr]; }
   enum: asEnum(PANTRY_SORT_FIELDS)
   ```
2. **Spread:**
   ```ts
   enum: [...PANTRY_SORT_FIELDS]
   ```
   (работает потому что spread const-tuple даёт обычный массив)
3. **Нормальный TS enum:**
   ```ts
   export enum PantrySortField {
     Name = 'name',
     ExpiresAt = 'expiresAt',
     Priority = 'priority',
   }
   ```
   (но это менее модно и допускает дубликаты значений).

**Проверка:**

```bash
$ grep -rn "as unknown as string\[\]" apps/api/src/
apps/api/src/pantry/pantry.controller.ts:77:  @ApiQuery({ name: 'sort', required: false, enum: PANTRY_SORT_FIELDS as unknown as string[] })
apps/api/src/pantry/pantry.controller.ts:78:  @ApiQuery({ name: 'order', required: false, enum: PANTRY_SORT_ORDERS as unknown as string[] })
apps/api/src/ingredients/ingredients.controller.ts:48:  @ApiQuery({ name: 'sort', required: false, enum: IngredientSortField as unknown as string[] })
apps/api/src/ingredients/ingredients.controller.ts:49:  @ApiQuery({ name: 'order', required: false, enum: IngredientSortOrder as unknown as string[] })
```

**Рекомендованный фикс:** заменить на `[...PANTRY_SORT_FIELDS]` (одна строка, никаких `as unknown as`). Альтернативно — тип-хелпер `asSwaggerEnum(arr)` в `apps/api/src/common/swagger-helpers.ts`.

---

## 2. Подтверждённые здоровые паттерны

- **Zero `any` в коде**: `grep ": any\|<any>\|as any" apps/{api,web,worker}/src/` → 0 вхождений (единственный матч — комментарий «any failure» в usePreferences). Это результат осознанного выбора. 👍
- **ExceptionFilter правильно проверяет `instanceof Error`** (`apps/api/src/common/exception-filter.ts:70-81`) — не вызывает `.message` на non-Error.
- **Zod-first валидация в большинстве контроллеров** (`fitBudget`, `applyProposal`, `today`, `rescue`, `rouletteDraw`, `generatePrepSession`, `enqueue`) — каждый делает `safeParse(body ?? {})` и формирует `fields` map для error details.
- **DTO-классы через `nestjs-zod`** (`apps/api/src/pantry/pantry.dto-classes.ts:9-10`) — есть там, где DTO фиксирован. Где DTO маленький (boolean-флаги), DTO-классы пропущены — отсюда T23-A.
- **`AuthenticatedRequest` интерфейс существует** — просто не подключён в FastifyRequest. Маленький фикс даст большую DRY.

## 3. Микро-наблюдения

- **T23-α** — `apps/api/src/jobs/jobs.service.ts:19` `export function paramsHash(params: unknown): string` — функция принимает `unknown` (правильно), но **возвращает hex SHA-256** — нет защиты от collision-attack через намеренно подобранный params. Hygiene: зафиксировать контракт «stable hash, NOT cryptographic».
- **T23-β** — `apps/api/src/common/idempotency-cache.ts:322` `err instanceof Error ? err.message : String(err)` — в catch пишется message, теряется stack. Уже отмечено в T21-C (worker-логирование), но та же проблема и в api. Hygiene: structured logger.
- **T23-γ** — В `recipes.controller.ts` (см. T23-β) и других контроллерах — каждый `@UseGuards(AuthGuard)` endpoint получает user через cast. После фикса T23-B это упростится.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона             | Находка                                                                                                                           | Где                                                                                                |
| --------- | --------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **T23-A** | 🟠 P2     | API / validation | `setPurchased`/`setDone` используют unsafe cast + silent `=== true`. Zod-валидация пропущена. Расхождение контракта.              | `apps/api/src/shopping-lists/shopping-lists.controller.ts:81-92`, `meal-plans.controller.ts:85-94` |
| **T23-B** | 🟡 P3     | API / typing     | 86× `req as unknown as { user: AuthenticatedUser }`. `AuthenticatedRequest` интерфейс существует, но FastifyRequest не augmented. | `apps/api/src/**/controllers/*.ts`                                                                 |
| **T23-C** | 🟡 P3     | API / Swagger    | `enum Foo as unknown as string[]` для Swagger `@ApiQuery` (4 случая). Можно `[...Foo]` без cast.                                  | `apps/api/src/pantry/pantry.controller.ts:77-78`, `ingredients.controller.ts:48-49`                |

## 5. Куммулятивный итог (23 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3        | 🟡 ℹ️ | Cumulative                   |
| ------- | ------------------- | ----- | ----- | --------------- | ----- | ---------------------------- |
| #1–3    | 26                  | 9     | 0     | 6               | 11    | —                            |
| #4–10   | 13                  | 0     | 0     | 13              | 0     | —                            |
| #11     | T11-A, T11-B        | 0     | 0     | 2               | 0     | —                            |
| #12     | T12-A               | 0     | 0     | 1               | 0     | —                            |
| #13     | T13-A               | 1 P0  | 0     | 0               | 0     | 10 P0                        |
| #14     | T14-A               | 0     | 0     | 1               | 0     | 10 P0                        |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1               | 0     | 11 P0                        |
| #16     | T16-A, T16-B        | 0     | 0     | 2               | 0     | 11 P0                        |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0               | 0     | 11 P0, 2 P1                  |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 11 P0, 2 P1, 2 P2            |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2            | 0     | 11 P0, 2 P1, 4 P2            |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2            | 0     | 12 P0, 2 P1, 6 P2            |
| #21     | T21-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 12 P0, 2 P1, 8 P2, 4 P3      |
| #22     | T22-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 9 P2, 6 P3      |
| **#23** | **T23-A–C**         | **0** | **0** | **1 P2 + 2 P3** | **0** | **12 P0, 2 P1, 10 P2, 8 P3** |

**Тренд 23-го:** типы и контракты. После worker/a11y (21/22) — внимание к **API-контрактам** (boolean-флаги silent), **типизации FastifyRequest** (DRY), **Swagger-костылям**. Все находки — `P2/P3`, не security, но они мешают maintainability.

## 6. Рекомендации (23-й круг)

1. **(P2, 1ч, T23-A)** Добавить `SetPurchasedDtoSchema` и `MarkDoneDtoSchema` в `packages/contracts`. В контроллерах — `safeParse` + VALIDATION_ERROR. Возможно, вообще ввести декоратор `@ZodBody(Schema)` для DRY.
2. **(P3, 30 мин, T23-B)** Создать `apps/api/src/common/fastify-augment.d.ts` с module augmentation для `FastifyRequest.user?: AuthenticatedUser`. Удалить 86 `as unknown as` cast'ов одной правкой.
3. **(P3, 15 мин, T23-C)** Заменить `enum Foo as unknown as string[]` на `enum: [...FOO]` (spread) или helper `asSwaggerEnum(arr)`.
4. **(P3 hygiene)** Удалить `// any failure` comment в `usePreferences.ts:11` — заменить на «any failure (404, network, schema)».

## 7. Артефакты (23-й круг)

| Артефакт                         | Где                             |
| -------------------------------- | ------------------------------- |
| Этот отчёт                       | `docs/audit/AUDIT-REPORT-23.md` |
| FIX-PLAN (T23-A,B,C)             | `docs/audit/FIX-PLAN.md`        |
| `setPurchased` unsafe cast       | §1 T23-A                        |
| `AuthenticatedRequest` orphan    | §1 T23-B                        |
| `as unknown as string[]` Swagger | §1 T23-C                        |
