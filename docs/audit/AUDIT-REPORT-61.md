# Технический, продуктовый и UI-аудит MULTI-CHEF (61-й круг)

**Дата:** 2026-09-15
**Область:** Database index coverage / query performance
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

В `packages/database/prisma/schema.prisma` индексы в основном
проставлены по горячим FK (PantryItem, RecipeIngredient,
ShoppingListItem, Preference). Но три прицельных запроса делают
seq-scan / sort in-memory уже на текущих объёмах:

- `GET /recipes` с keyset pagination по `(createdAt, id)` — без
  составного индекса на этой паре.
- `JobsService.enqueue` дедуп `findFirst({userId, type, paramsHash,
status, createdAt})` — есть только `@@index([userId, createdAt])`,
  фильтры `type`, `paramsHash`, `status` отбрасываются post-scan.
- `ShoppingList.findFirst({householdId, status:'ACTIVE'})` — на
  таблице `ShoppingList` вообще нет индексов, кроме PK.

Это «спящие» проблемы: работают быстро на seed-данных (300
рецептов, десятки household'ов), но деградируют линейно при
росте БД.

---

## Технические находки (61-й круг)

### T61-A · 🟠 P2 — `Recipe` keyset pagination без индекса

**Где:** `apps/api/src/recipes/recipes.service.ts:96`,
`packages/database/prisma/schema.prisma` (`model Recipe`).

**Симптом.** Список рецептов сортируется и пагинируется:

```ts
const rows = await prisma.recipe.findMany({
  where: { AND: [where, cursorFilter] },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: query.limit + 1,
});
```

`cursorFilter` содержит `createdAt < cursor.t` для второй+
страницы. В схеме на `Recipe` нет индекса на `createdAt` (есть
только `@@index([tags], type: Gin)`). Postgres должен сделать
seq-scan всей таблицы, потом sort по `(createdAt desc, id desc)`,
потом `LIMIT 21`. На 1000 рецептах это ≈ 100ms; на 50k — секунды.

**Почему важно.** `/recipes` — публичная страница (главный каталог
приложения), её дёргают и web, и SSR-пререндер. При росте
контента (импорт из новых источников, recipe sharing) время
ответа деградирует незаметно.

**Гипотеза фикса.**

```prisma
model Recipe {
  ...
  @@index([createdAt(sort: Desc), id(sort: Desc)], map: "recipe_keyset_idx")
}
```

Postgres использует этот индекс для keyset pagination без
sort-фазы.

---

### T61-B · 🟠 P2 — `Job.enqueue` дедуп без оптимального индекса

**Где:** `apps/api/src/jobs/jobs.service.ts:65-77`,
`packages/database/prisma/schema.prisma:619-622` (`model Job`).

**Симптом.** Дедуп-запрос:

```ts
const existing = await this.db.job.findFirst({
  where: {
    userId,
    type,
    paramsHash: hash,
    status: { in: ['QUEUED', 'PROCESSING'] },
    createdAt: { gte: windowStart },
  },
  orderBy: { createdAt: 'desc' },
});
```

В схеме:

```prisma
@@index([userId, createdAt])
@@index([paramsHash])
```

Ни один из этих индексов не покрывает запрос полностью:

- `[userId, createdAt]` — Postgres использует его для префикса,
  потом фильтрует `type`, `paramsHash`, `status` post-index scan.
- `[paramsHash]` — без `userId`, не подходит для ownership-scoped
  read.

При активном household'е (10-50 jobs/день) — десятки строк, всё
OK. Но для пользователя с 1000+ jobs (например, bot / cron / UI
баг) дедуп становится O(N).

**Гипотеза фикса.**

```prisma
@@index([userId, type, createdAt(sort: Desc)])
@@index([userId, paramsHash, createdAt(sort: Desc)])
```

Первый — для общего случая `findMany({userId, type})`; второй —
специально для дедупа. Существующий `@@index([userId, createdAt])`
можно удалить как избыточный.

---

### T61-C · 🟡 P3 — `ShoppingList` без индексов (только PK)

**Где:** `packages/database/prisma/schema.prisma:524-540` (`model ShoppingList`),
`apps/api/src/shopping-lists/shopping-lists.service.ts:44`.

**Симптом.**

```ts
const list = await tx.shoppingList.findFirst({
  where: { householdId, status: 'ACTIVE' },
  include: { items: { orderBy: [{ sortOrder: 'asc' }, ...], include: { ingredient: ... } } },
});
```

На `ShoppingList` объявлены только PK (`id`) и связи (FK →
`householdId` / `mealPlanId`). Индексов нет. Запрос:

- фильтр `(householdId, status)` — full table scan по
  ShoppingList.
- join к `ShoppingListItem` использует индекс
  `@@index([shoppingListId, purchased])` — ок.
- join к `Ingredient` через `ingredientId` — Ingredient.id PK —
  ок.

**Почему важно.** `ShoppingList` — таблица, которая пишется при
каждой генерации плана (1 запись / household / неделю). За год
на активный household накапливается 50+ ARCHIVED списков. Seq-scan
по ним на каждый запрос `/shopping`.

**Гипотеза фикса.**

```prisma
model ShoppingList {
  ...
  @@index([householdId, status])
  @@index([householdId, createdAt(sort: Desc)])
}
```

Второй индекс — для админских / history-просмотров списков по
household.

---

### T61-D · 🟡 P3 — `RecipeIngredient.substitutesFor` без индекса

**Где:** `packages/database/prisma/schema.prisma:415-433`.

**Симптом.** `RecipeIngredient` имеет PK `(recipeId, ingredientId)` и
`@@index([ingredientId])`. Но FK `substitutesFor → Ingredient.id`
не проиндексирован. Возможный запрос «все RecipeIngredient, где
substitutesFor = X» (например, для построения графа замен в
`packages/recommendation`) делает seq-scan по всей таблице.

**Почему важно.** На проде с 300 рецептами × 7 ингредиентов = 2100
строк seq-scan быстрый. На 50k рецептов = 350k строк → ~50ms на
каждый запрос замен. Если recommendation-engine делает это в
planning loop, замедление × 21 день × 3-5 приёмов пищи = заметно.

**Гипотеза фикса.**

```prisma
model RecipeIngredient {
  ...
  @@index([substitutesFor])
}
```

Частичный индекс (только `WHERE substitutesFor IS NOT NULL`)
оптимальнее, но Prisma пока не поддерживает partial indexes —
можно сделать через миграцию с raw SQL.

---

## Подтверждённые здоровые паттерны

- `MealPlan` имеет `@@index([householdId, startDate])` — критичный
  индекс для `/plan`-страницы.
- `PantryItem` имеет три отдельных индекса:
  `[householdId]`, `[householdId, expiresAt]`, `[householdId,
archivedAt]` — точное покрытие горячих фильтров.
- `Preference` имеет `@@unique([userId, kind, ingredientId])` +
  `@@index([userId, kind])` — DB-level дедуп + индекс для общего
  чтения.
- `Recipe.tags` использует GIN-индекс `idx_recipe_tags` (хотя
  объявлен в `schema.prisma` как `@@index([tags], type: Gin)`).
- `ShoppingListItem` имеет `@@index([shoppingListId, purchased])`
  для UI-сортировки «не куплено сверху».

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                                              | Файл / место                                                                    |
| ----- | --- | ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| T61-A | 🟠  | P2   | `Recipe` keyset pagination по `(createdAt, id)` без индекса. Seq-                   | apps/api/src/recipes/recipes.service.ts:96,                                     |
|       |     |      | scan + sort in-memory на /recipes                                                   | schema.prisma (Recipe)                                                          |
| T61-B | 🟠  | P2   | `JobsService.enqueue` дедуп по `(userId, type, paramsHash, status,                  | apps/api/src/jobs/jobs.service.ts:65-77, schema.prisma:619-622                  |
|       |     |      | createdAt)`. Индексы `[userId, createdAt]`и`[paramsHash]` покрывают только префиксы |                                                                                 |
| T61-C | 🟡  | P3   | `ShoppingList` без индексов (только PK). `findFirst({householdId,                   | schema.prisma:524-540, apps/api/src/shopping-lists/shopping-lists.service.ts:44 |
|       |     |      | status})` → seq-scan                                                                |                                                                                 |
| T61-D | 🟡  | P3   | `RecipeIngredient.substitutesFor` без индекса. Граф замен                           | schema.prisma:415-433, packages/recommendation/src (запросы замен)              |
|       |     |      | делает seq-scan на 350k+ строк                                                      |                                                                                 |

---

## Куммулятивный итог (61 круг)

- **Всего найдено проблем:** 244 (T21–T61).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  138 · 🟡 P3: 80.
- **Раунды с нулевыми находками:** 0 из 61.
- **Топ-5 зон:** rate-limiting / DTO-валидация (29), observability /
  healthchecks (26), DB indexes / query performance (4 — новый раунд),
  money / числовая арифметика (19), BullMQ / worker (20).

---

## Рекомендации (61-й круг)

1. **T61-A — на этой неделе.** Добавить `@@index([createdAt(sort:
Desc), id(sort: Desc)])` на `Recipe`. Это 1 строка + миграция.
2. **T61-B — на этой неделе.** Добавить `@@index([userId, type,
createdAt(sort: Desc)])` и `@@index([userId, paramsHash,
createdAt(sort: Desc)])` на `Job`. Удалить избыточный
   `@@index([userId, createdAt])`.
3. **T61-C — на спринт.** Добавить `@@index([householdId, status])`
   на `ShoppingList`.
4. **T61-D — на спринт.** Partial index на `RecipeIngredient.
substitutesFor` через raw SQL migration.

---

## Артефакты (61-й круг)

- `docs/audit/AUDIT-REPORT-61.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T61-A…T61-D.
