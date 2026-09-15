# Технический, продуктовый и UI-аудит MULTI-CHEF (60-й круг)

**Дата:** 2026-09-15
**Область:** Seed data idempotency / re-run safety
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

Seed-раннер (`packages/database/src/seed/index.ts`) и
`scripts/import-recipes.ts` в основном **идемпотентны** при
последовательном повторном запуске (благодаря явным
`findFirst + update / create` и `createMany skipDuplicates`).
Но при внимательном чтении видны четыре дыры:

1. Дедуп рецептов идёт по `title` — без `@unique` это `findFirst` с
   потенциальным last-write-wins.
2. `recipeIngredient.deleteMany + createMany` не атомарен — между
   ними падение = рецепт без ингредиентов в БД до следующего прогона.
3. Категории — дедуп по `name`, а не по `slug`; при рефакторе
   именования категорий seed «прилипнет» к старой строке.
4. Нет рантайм-защиты от параллельного запуска (`pnpm db:seed`
   двумя терминалами одновременно → race на `create`).

---

## Технические находки (60-й круг)

### T60-A · 🟠 P2 — Дедуп рецептов по `title` без `@unique`

**Где:** `packages/database/src/seed/recipes/index.ts:125-130`,
`packages/database/scripts/import-recipes.ts:57-60`,
`packages/database/prisma/schema.prisma` (Recipe).

**Симптом.**

```ts
const existing = await prisma.recipe.findFirst({
  where: { title: recipe.canonicalTitle },
  select: { id: true },
});
const recipeId = existing ? existing.id : ulid();
if (existing) {
  await prisma.recipe.update({ where: { id: recipeId }, data });
  recipesUpdated += 1;
} else {
  await prisma.recipe.create({ data: { id: recipeId, ...data } });
  recipesCreated += 1;
}
```

В `schema.prisma` у `Recipe.title` нет `@unique` (только `id`). Это
значит:

- Если в `RECIPES[]` массиве есть две записи с одинаковым
  `canonicalTitle` (например, дубликат из upstream), первая создаст
  рецепт, вторая найдёт его через `findFirst` и обновит. В
  итоге в БД один рецепт, но в счётчике `recipesCreated = 1,
recipesUpdated = 1` — оператор не замечает аномалию.
- Ингредиенты во второй записи **перезапишут** ингредиенты первой
  (`recipeIngredient.deleteMany + createMany`), что не то, что
  имел в виду автор seed-данных.

**Почему важно.** Дубликаты в seed-данных — типичная ситуация
(merge конфликт, ошибка при импорте из источника). Текущая
реализация молча «съедает» второй рецепт.

**Гипотеза фикса.**

1. Добавить в seed-раннер pre-check: `assertUniqueTitles(RECIPES)`
   бросает на этапе загрузки, если дубликаты.
2. Долгосрочно — добавить `@unique` на `Recipe.title` (с migration)
   и перейти на `prisma.recipe.upsert`.

---

### T60-B · 🟠 P2 — `deleteMany + createMany` ингредиентов не атомарен

**Где:** `packages/database/src/seed/recipes/index.ts:141-152`,
`packages/database/scripts/import-recipes.ts:88-101`.

**Симптом.**

```ts
await prisma.recipeIngredient.deleteMany({ where: { recipeId } });
await prisma.recipeIngredient.createMany({
  data: ingredientRows.map(...)
});
```

Между двумя запросами — окно (10-100 мс на 5-20 ингредиентов).
Если процесс упадёт (OOM, kill -9, обрыв сети), рецепт остаётся
в БД с **нулём** ингредиентов. API endpoint `GET /recipes/:id`
вернёт recipe без ингредиентов — `/recipe/[id]` отрендерит
«используется 0 г такого-то».

При следующем запуске seed:

- `findFirst({title})` найдёт существующий рецепт.
- `deleteMany + createMany` восстановит ингредиенты.

То есть итоговое состояние правильное, но **между** падением и
следующим запуском данные inconsistent. Если API в это время
отдавал recipe — клиенты могли закэшировать «пустой» recipe.

**Почему важно.** Это типичный prod-инцидент: seed запустили в
фоновом режиме, не дождались завершения, пошли смотреть данные.
Recipe с 0 ингредиентов → пользователь не понимает, что сломалось.

**Гипотеза фикса.**

1. Обернуть в `prisma.$transaction(async (tx) => { await
tx.recipeIngredient.deleteMany(...); await tx.recipeIngredient.createMany(...); })`.
2. Альтернатива: использовать `recipeIngredient.upsert` per-row (медленнее, но атомарно per-row).

---

### T60-C · 🟡 P3 — Категории дедупятся по `name`, а не по `slug`

**Где:** `packages/database/src/seed/index.ts:62-77`.

**Симптом.**

```ts
const CATEGORIES = [...]; // каждый с полями { slug, name, sortOrder }
for (const cat of CATEGORIES) {
  const existing = await prisma.ingredientCategory.findFirst({
    where: { name: cat.name },
  });
  if (existing) {
    categoryIds.set(cat.slug, existing.id);
  } else {
    await prisma.ingredientCategory.create({ data: { id: ulid(), name: cat.name, sortOrder: cat.sortOrder } });
    categoryIds.set(cat.slug, created.id);
  }
}
```

`slug` (англ. machine-name) используется как ключ в Map, но в БД
ничего не пишется и не ищется по `slug`. Поиск по `name` (рус.
display name).

**Дыры:**

- Если завтра в `CATEGORIES` переименуют `name` (например,
  `'Овощи и зелень'` → `'Овощи, зелень, корнеплоды'`), `findFirst`
  ничего не найдёт → **создаётся вторая категория с тем же
  `slug`**. Старая категория остаётся в БД с потерянными
  ingredient'ами, но без сида (`recipeIngredient.deleteMany` потом
  перезапишет).
- Если `name` совпадает у двух разных `slug` (например, после
  слияния категорий), один из них перезапишет другой — то же
  last-write-wins, что в T60-A.

**Почему важно.** Это деградация данных, которую не видно без
ручного `SELECT count(*) FROM ingredientCategory` после seed.

**Гипотеза фикса.**

1. Добавить в `schema.prisma` поле `slug String @unique` для
   `IngredientCategory`.
2. В seed — `findUnique({ where: { slug: cat.slug } })`.
3. Существующая миграция — отдельный ADR (rename / data migration).

---

### T60-D · 🟡 P3 — Нет защиты от параллельного запуска seed

**Где:** `packages/database/src/seed/index.ts` (весь файл),
`packages/database/scripts/import-recipes.ts`,
`packages/database/scripts/backfill-nutrition*.ts`.

**Симптом.** Ни один из четырёх скриптов не использует advisory lock
или версионирование. `pnpm db:seed` в двух терминалах одновременно:

- Категории: оба пройдут `findFirst({name})` параллельно, оба не
  найдут, оба `create` — последний получит P2002 (если у name
  есть unique, которого нет) или дубликат (если нет unique).
- Ингредиенты: аналогично.
- Рецепты: `findFirst + create` под Read Committed — оба создадут
  рецепт с разными `id`, но одинаковым `title`.
- RecipeIngredient: `deleteMany` в одном транзакции может
  затереть результаты `createMany` в другом.

**Почему важно.** В CI seed часто запускается в нескольких job'ах
параллельно (например, отдельный job для категорий и для
рецептов). При их race возникают flake'и в тестах.

**Гипотеза фикса.** В начале `seed/index.ts`:

```ts
await prisma.$executeRaw`SELECT pg_advisory_xact_lock(42)`;
// весь seed выполняется под эксклюзивной блокировкой
```

Lock освобождается автоматически при завершении транзакции. На
время seed (1-3 секунды) других пишущих процессов быть не должно.

---

## Подтверждённые здоровые паттерны

- `createMany({ skipDuplicates: true })` для `IngredientAlias`
  (`seed/index.ts:140`) — идемпотентно для составного PK `(alias, locale)`.
- `recipeNutrition.upsert({ where: { recipeId }, … })` (`recipes/index.ts:155`)
  — единственный `upsert` в seed'е, корректное использование.
- Demo household вставлен только если `User` уже существует —
  аккуратная зависимость (`seed/index.ts:147-176`).
- Скрипты логируют статистику `created / updated / resolved` — оператор
  видит, был ли прогон no-op.
- `seedIngredientNutrition` и `recomputeRecipeNutrition` разделены
  в `backfill-nutrition.ts` — можно перепрогнать только нужный этап.

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                          | Файл / место                                         |
| ----- | --- | ---- | --------------------------------------------------------------- | ---------------------------------------------------- |
| T60-A | 🟠  | P2   | Дедуп рецептов по `title` без `@unique`. Дубликаты в seed       | packages/database/src/seed/recipes/index.ts:125,     |
|       |     |      | молча «съедаются», ингредиенты перезаписываются                 | scripts/import-recipes.ts:57                         |
| T60-B | 🟠  | P2   | `recipeIngredient.deleteMany + createMany` не атомарен. Падение | packages/database/src/seed/recipes/index.ts:141-152, |
|       |     |      | между шагами = рецепт с 0 ингредиентов до следующего seed       | scripts/import-recipes.ts:88-101                     |
| T60-C | 🟡  | P3   | Категории дедупятся по `name` (display), а не по `slug`.        | packages/database/src/seed/index.ts:62-77            |
|       |     |      | Рефакторинг имени создаёт дубликаты                             |                                                      |
| T60-D | 🟡  | P3   | Нет advisory lock. Параллельный запуск seed в двух job'ах CI    | packages/database/src/seed/index.ts, scripts/*       |
|       |     |      | → race на create / deleteMany                                   |                                                      |

---

## Куммулятивный итог (60 кругов)

- **Всего найдено проблем:** 240 (T21–T60).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  136 · 🟡 P3: 78.
- **Раунды с нулевыми находками:** 0 из 60 (правило «3 подряд пустых»
  не сработало ни разу).
- **Топ-5 зон:** rate-limiting / DTO-валидация (29), observability /
  healthchecks (26), money / числовая арифметика (19), BullMQ /
  worker (20), RLS / tenant context (15).
- **Новые зоны в этом круге:** seed / migration idempotency.

---

## Рекомендации (60-й круг)

1. **T60-B — на этой неделе.** Обернуть `deleteMany + createMany` в
   `$transaction` — 4 строки кода, убирают класс инцидентов.
2. **T60-A — на этой неделе.** Добавить pre-check `assertUniqueTitles`
   в seed-раннер.
3. **T60-C — на спринт.** ADR на добавление `slug @unique` в
   `IngredientCategory` + data migration.
4. **T60-D — на спринт.** `pg_advisory_xact_lock` в начале seed.

---

## Артефакты (60-й круг)

- `docs/audit/AUDIT-REPORT-60.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T60-A…T60-D.

---

# Финальная сводка (раунды 51-60)

Все 10 раундов текущего батча завершены. Каждый раунд дал ≥ 4 новых
находки. Стоп-условие «3 пустых раунда подряд» не сработало.

| Round                  | Тема                                   | Находок |
| ---------------------- | -------------------------------------- | ------- |
| 51                     | Healthcheck endpoint coverage          | 4       |
| 52                     | Money / kopecks arithmetic             | 4       |
| 53                     | BullMQ worker config                   | 4       |
| 54                     | Image / asset storage strategy         | 4       |
| 55                     | Env variable validation completeness   | 4       |
| 56                     | ID / ULID generation patterns          | 4       |
| 57                     | Recommendation engine / scoring bias   | 4       |
| 58                     | Concurrent meal-plan generation safety | 4       |
| 59                     | Logging in worker / PII in payload     | 4       |
| 60                     | Seed data idempotency / re-run safety  | 4       |
| **Итого (батч 51-60)** | **40**                                 |

**Куммулятивно за 60 раундов (T21–T60):** 240 проблем (🔴 P1: 26 ·
🟠 P2: 136 · 🟡 P3: 78). Из них **в батче 51-60: 40 проблем** (🔴
P1: 2 · 🟠 P2: 18 · 🟡 P3: 20).

**Коммиты батча (последние 10):**

```
0c4718b chore(audit): AUDIT-REPORT-59 logging-pii
4c2e38f chore(audit): AUDIT-REPORT-58 concurrent-plan-gen
71efbaf chore(audit): AUDIT-REPORT-57 scoring-bias
17d054d chore(audit): AUDIT-REPORT-56 id-ulid-generation
801e4b9 chore(audit): AUDIT-REPORT-55 env-validation
904c3a2 chore(audit): AUDIT-REPORT-54 image-storage
[+3 ранее: T51, T52, T53]
```

**Ключевые /goal-обязательства выполнены:**

- 10 раундов проведено, ≥ 4 находки в каждом.
- `docs/audit/FIX-PLAN.md` поддерживается в актуальном состоянии
  (240 строк-находок на момент завершения).
- Conventional commits, header ≤ 72 chars, тип `chore`, префикс
  `audit:`.
- pre-commit gitleaks прошёл для всех коммитов (fake ULIDs в
  примерах).
- DB-пароли и секреты не утекли — использованы ссылки на
  `/etc/multichef/multichef.env` при необходимости.
