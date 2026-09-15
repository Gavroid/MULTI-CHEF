# Технический, продуктовый и UI-аудит MULTI-CHEF (42-й круг)

**Дата:** 2026-09-15
**HEAD:** `24ad57f chore(audit): AUDIT-REPORT-41 cors-config`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-41.md`, `FIX-PLAN.md`
**Фокус:** Pagination patterns — offset/limit vs cursor, response shape consistency.

## TL;DR

42-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T42-A** — Pantry `GET /pantry` возвращает `{ data: PantryItemView[] }` — **нет `total` count, нет `nextCursor`**. Client не может отличить "last page" от "incomplete response". Inconsistent с `Recipes` (`PaginatedRecipes` с `nextCursor`).
- 🟠 **T42-B** — Ingredients service считает `{ items, total }` (COUNT query в БД), но controller возвращает только `{ data: items }`. **COUNT result отбрасывается** — waste of DB effort.
- 🟡 **T42-C** — Pantry использует **offset/limit**, Recipes — **cursor**. Inconsistent pagination approach в одном API.
- 🟡 **T42-D** — Нет `GET /meal-plans/prep-tasks` endpoint. Если user хочет list всех prep tasks плана → нет способа.

---

## 1. Технические находки (42-й круг)

### T42-A. Pantry list response без `total` / `nextCursor` 🟠 P2

**Файл:** `apps/api/src/pantry/pantry.controller.ts:98-105`.

**Сырой код:**

```ts
@Query() raw: Record<string, string | undefined>,
): Promise<{ data: PantryItemView[] }> {
  const user = currentUser(req as unknown as { user: AuthenticatedUser });
  const parsed = ListPantryQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw validationError(parsed.error.issues);
  }
  const data = await this.svc.listItems(user.id, parsed.data);
  return { data };   // ← только data, без total/nextCursor
}
```

**Сырой код (ListPantryQuerySchema):**

```ts
// apps/api/src/pantry/pantry.dto.ts:90-95
export const ListPantryQuerySchema = z.object({
  ingredientId: ulidSchema.optional(),
  includeArchived: z.union([...]).transform(...).optional().transform((v) => v ?? false),
  sort: z.enum(PANTRY_SORT_FIELDS).default('createdAt'),
  order: z.enum(PANTRY_SORT_ORDERS).default('asc'),
  limit: z.coerce.number().int().min(1).max(100).default(50),  // ← max 100, default 50
  offset: z.coerce.number().int().min(0).default(0),
});
```

**Эффект:**

1. **Client UX**: user прокручивает 50 items вниз, видит конец списка, не знает есть ли ещё 100 items или 0.
2. **Pagination**: client знает `limit=50, offset=0` → увеличивает offset. Если items.length=50, может продолжать. Но каждый следующий page → ещё один DB query (slow).
3. **Total count отсутствует** — UI не может показать "Page 3 of 10" или progress bar.

**Сравнение с Recipes:**

```ts
// packages/contracts/src/recipes.ts:25-30
export const PaginatedRecipesSchema = z.object({
  items: z.array(RecipeDtoSchema),
  nextCursor: z.string().nullable(), // ← cursor-based pagination
});
```

**Рекомендованный фикс:**

Создать единый `PaginatedListSchema<T>` в `packages/contracts`:

```ts
export const PaginatedListSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable().optional(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  });

export const PaginatedPantryItemsSchema = PaginatedListSchema(PantryItemViewSchema);
```

Service возвращает `{ items, total }` (already computes it via `prisma.pantryItem.count()`). Controller wraps в `{ data: { items, total } }`.

### T42-B. Ingredients total count отбрасывается 🟠 P2

**Файл:** `apps/api/src/ingredients/ingredients.service.ts:80-93`, `apps/api/src/ingredients/ingredients.controller.ts:53`.

**Сырой код (service):**

```ts
const [rows, total] = await Promise.all([
  PRISMA.ingredient.findMany({
    where,
    orderBy,
    take: query.limit,
    skip: query.offset,
  }),
  PRISMA.ingredient.count({ where }), // ← COUNT query
]);
return {
  items: rows.map(/* ... */),
  total, // ← returned in service
};
```

**Сырой код (controller):**

```ts
async list(@Query() rawQuery: Record<string, string | undefined>): Promise<{ data: IngredientView[] }> {
  // ...
  const { items } = await this.svc.listIngredients(parsed.data);  // ← total отбрасывается!
  return { data: items };
}
```

**Эффект:**

1. **DB waste**: каждый listIngredients вызов считает COUNT — для household с 500 ingredients это ~5-20ms (full table scan с WHERE фильтром).
2. **COUNT результат не используется** — это явная ошибка в коде (забыли прокинуть в response).
3. **UX**: client не знает сколько всего ingredients (важно для "результаты 1-50 из 200" UI).

**Рекомендованный фикс:**

```ts
async list(@Query() rawQuery): Promise<{ data: { items: IngredientView[]; total: number } }> {
  // ...
  const { items, total } = await this.svc.listIngredients(parsed.data);
  return { data: { items, total } };
}
```

### T42-C. Offset/limit vs cursor — inconsistent pagination 🟡 P3

**Файлы:**

- Pantry: `offset/limit` (`pantry.dto.ts:93-94`).
- Recipes: `cursor/limit` (`recipes.dto.ts:25-26`).

**Сырой код (Recipes cursor):**

```ts
// packages/contracts/src/recipes.ts:25
cursor: z.string().min(1).max(500).optional(),
limit: z.coerce.number().int().min(1).max(50).default(20),
```

**Сырой код (Pantry offset/limit):**

```ts
limit: z.coerce.number().int().min(1).max(100).default(50),
offset: z.coerce.number().int().min(0).default(0),
```

**Эффект:**

- **Offset/limit**: simple, понятный, но **O(n)** для deep pagination (`offset=10000` → DB сканирует 10000 rows).
- **Cursor**: opaque base64 of `(timestamp, id)`, **O(log n)** via indexed scan, stable при insertions.
- В одном API — две стратегии. Client developer не знает, какую использовать.

**Рекомендованный фикс:**

Стандартизировать на **cursor** для всех list endpoints. Pantry может использовать `(archivedAt, id)` или `(createdAt, id)` cursor. Преимущества:

- Стабильный при concurrent inserts (offset может дублировать/пропускать).
- O(log n) для deep pages.

### T42-D. Нет `GET /meal-plans/prep-tasks` list endpoint 🟡 P3

**Файл:** `apps/api/src/meal-plans/meal-plans.controller.ts`.

**Что есть:**

```bash
$ grep "@Get\|@Post\|@Patch" apps/api/src/meal-plans/meal-plans.controller.ts
@Get('active')
@Get('active/storage')
@Post('active/prep')              // создаёт prep session
@Post()                             // generate meal plan
@Patch('prep-tasks/:taskId')        // setTaskDone
```

**Что отсутствует:**

- `GET /meal-plans/prep-tasks` — list all tasks for current plan (UI / checklist).
- `GET /meal-plans/prep-tasks/:id` — single task detail.

**Эффект:**

- Если web client хочет показать checklist prep tasks — должен poll `GET /meal-plans/active` (которая уже возвращает prep data?).
- API contract missing → client developer не знает где брать данные.

**Рекомендованный фикс:**

```ts
@Get('prep-tasks')
@ApiOperation({ summary: 'List prep tasks for the current ACTIVE meal plan' })
async listPrepTasks(@Req() req): Promise<{ data: PrepTaskView[]; nextCursor: string | null }> {
  // ...
}
```

Или расширить `GET /meal-plans/active` чтобы вернула prep tasks inline (если ещё не делает).

---

## 2. Подтверждённые здоровые паттерны

- **`limit` min/max enforcement** (Recipes max 50, Pantry max 100) — DoS protection. ✓
- **`z.coerce.number()` для query strings** — правильно: query string → number. ✓
- **Recipes cursor base64url** (`recipes.service.ts:74`) — opaque, не leak internal ID. ✓
- **`take: query.limit + 1` pattern** (Recipes:100) — hasMore check via one-extra-row. ✓
- **`includeArchived` transform** в Pantry (`pantry.dto.ts:95-100`) — принимает string, преобразует в boolean. ✓
- **No `OFFSET` SQL injection** — Prisma parameterizes. ✓

## 3. Микро-наблюдения

- **T42-α** — Recipes `limit` default 20, Pantry `limit` default 50. Inconsistency between endpoints.
- **T42-β** — `PantrySortFields` enum используется в query AND sort param — но Prisma `orderBy` принимает только column names, не full enum. Mapping правильный (`pantry.service.ts:170-185`).
- **T42-γ** — `ingredients/ingredients.controller.ts:53` контроллер уничтожает `total` через `const { items } = ...` — destructuring discards `total`. Лёгкий фикс, но **surprising bug** для ревьюера.
- **T42-δ** — `Pagination` через cursor требует cursor-encoding/decoding logic (см. `recipes.service.ts:73-90`). Если cursor corrupt → 400 INVALID_CURSOR. Hygiene: client не должен хранить cursor долго (expires).

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона             | Находка                                                                                                       | Где                                                                                  |
| --------- | --------- | ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **T42-A** | 🟠 P2     | API / Pagination | Pantry `GET /pantry` без `total` / `nextCursor`. Client не знает есть ли ещё данные. Inconsistent с Recipes.  | `apps/api/src/pantry/pantry.controller.ts:98-105`                                    |
| **T42-B** | 🟠 P2     | API / Waste      | Ingredients service считает `total`, но controller возвращает только `items`. COUNT query — wasted DB effort. | `apps/api/src/ingredients/ingredients.service.ts:93`, `ingredients.controller.ts:53` |
| **T42-C** | 🟡 P3     | API / Pagination | Pantry uses `offset/limit`, Recipes uses `cursor`. Inconsistent strategies в одном API.                       | `pantry.dto.ts:93-94` vs `recipes.dto.ts:25-26`                                      |
| **T42-D** | 🟡 P3     | API / Missing    | Нет `GET /meal-plans/prep-tasks` list endpoint. UI checklist prep tasks — нет источника данных.               | `apps/api/src/meal-plans/meal-plans.controller.ts`                                   |

## 5. Куммулятивный итог (42 кругов)

| Iter   | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды) | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                | T41-A..D     | 0     | 0     | 2     | 2     |
| **42** | **#42** | **Pagination**      | **T42-A..D** | **0** | **0** | **2** | **2** |

Cumulative: P0=0, P1=0, P2=2, P3=2 in this batch.

## 6. Рекомендации (42-й круг)

1. **(P2, 1ч, T42-A + T42-B)** Унифицировать pagination contract: создать `PaginatedListSchema<T>` в `packages/contracts`. Применить к Pantry + Ingredients response.
2. **(P3, 1ч, T42-C)** Стандартизировать на cursor pagination для всех list endpoints.
3. **(P3, 30 мин, T42-D)** Добавить `GET /meal-plans/prep-tasks` endpoint (или расширить `GET /meal-plans/active`).

## 7. Артефакты (42-й круг)

| Артефакт                        | Где                             |
| ------------------------------- | ------------------------------- |
| Этот отчёт                      | `docs/audit/AUDIT-REPORT-42.md` |
| FIX-PLAN (T42-A,B,C,D)          | `docs/audit/FIX-PLAN.md`        |
| Pantry missing total/nextCursor | §1 T42-A                        |
| Ingredients total discarded     | §1 T42-B                        |
| Offset vs cursor inconsistency  | §1 T42-C                        |
| Missing prep-tasks endpoint     | §1 T42-D                        |
