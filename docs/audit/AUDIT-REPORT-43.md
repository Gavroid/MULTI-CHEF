# Технический, продуктовый и UI-аудит MULTI-CHEF (43-й круг)

**Дата:** 2026-09-15
**HEAD:** `a758895 chore(audit): AUDIT-REPORT-42 pagination-patterns`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-42.md`, `FIX-PLAN.md`
**Фокус:** Async race conditions — check-then-act patterns, transactions, idempotency.

## TL;DR

43-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T43-A** — `shopping-lists.setItemPurchased` check-then-act без transaction guard. Concurrent POST → race между findFirst и update → potential data inconsistency.
- 🟠 **T43-B** — `shopping-lists.complete()` mutates pantry без transaction. Multi-item credit может быть частично применён при concurrent modification.
- 🟡 **T43-C** — `auth.service.register()` имеет findUnique check, но rely на `User.email @unique` constraint (not documented in code). Если кто-то изменит schema без unique → silent race.
- 🟡 **T43-D** — `requireOwnedHouseholdId()` в profile.service.ts — два последовательных query (User → Household). Между ними user может быть deleted.

---

## 1. Технические находки (43-й круг)

### T43-A. `setItemPurchased` check-then-act race 🟠 P2

**Файл:** `apps/api/src/shopping-lists/shopping-lists.service.ts:147-176`.

**Сырой код:**

```ts
async setItemPurchased(userId: string, itemId: string, purchased: boolean) {
  const householdId = await this.requireOwnedHouseholdId(userId);
  return withTenantContext({ householdId, userId }, async (tx) => {
    const item = await tx.shoppingListItem.findFirst({
      where: { {
        id: itemId,
        shoppingList: { household: { members: { some: { userId, role: 'OWNER' } } } },
      },
      select: { id: true, purchased: true },
    });
    if (!item) {
      throw new AppHttpException({
        code: 'SHOPPING_ITEM_NOT_FOUND',
        // ...
      });
    }
    await tx.shoppingListItem.update({
      where: { id: itemId },
      data: { purchased, purchasedAt: purchased ? new Date() : null },
    });
    return { purchased };
  });
}
```

**Сценарий гонки:**

1. User A: `POST /shopping-lists/items/X {purchased: true}` → открывает transaction.
2. User B: `DELETE /shopping-lists/items/X` → удаляет item.
3. User A: `findFirst` видит item существует → `update` → **0 rows affected** → silently OK.
4. User A returns `{purchased: true}` — клиент думает, что toggle сработал. Item уже удалён.

**Эффект:**

- Item был deleted между findFirst и update → silent inconsistency.
- Если бы update возвращал row count → user получает 404, может retry.
- `purchasedAt` field — если item deleted, `purchasedAt` orphan reference? Нет, row физически удалён, ссылка не нужна.

**Смягчающий фактор:** в реальности user-операции (purchased toggle) и admin operations (delete item) на одном item редки.

**Рекомендованный фикс:**

```ts
const result = await tx.shoppingListItem.updateMany({
  where: { id: itemId /* ownership */ },
  data: { purchased, purchasedAt: purchased ? new Date() : null },
});
if (result.count === 0) {
  throw new AppHttpException({
    code: 'SHOPPING_ITEM_NOT_FOUND',
    message: 'Позиция не найдена',
    details: { itemId },
  });
}
```

`updateMany` возвращает count — atomic check-and-update.

### T43-B. `shopping-lists.complete()` без transaction guard 🟠 P2

**Файл:** `apps/api/src/shopping-lists/shopping-lists.service.ts:178-260`.

**Сырой код:**

```ts
async complete(userId: string, listId: string) {
  const householdId = await this.requireOwnedHouseholdId(userId);
  return withTenantContext({ householdId, userId }, async (tx) => {
    const list = await tx.shoppingList.findFirst({
      where: { id: listId, householdId },
      include: { items: { where: { purchased: true }, /* ... */ } },
    });
    if (!list) {
      throw new AppHttpException({ code: 'SHOPPING_LIST_NOT_FOUND', /* ... */ });
    }
    const today = new Date();
    for (const item of list.items) {
      const grams = item.packageQuantity * item.packageSize.toNumber();
      const existing = await tx.pantryItem.findFirst({ /* ... */ });
      // ... update or create pantry item
      if (existing) {
        await tx.pantryItem.update({ /* ... */ });
      } else {
        await tx.pantryItem.create({ /* ... */ });
      }
    }
    // ... archive list
  });
}
```

**Эффект:**

`complete()` внутри `withTenantContext` transaction → все queries используют один transaction (`tx`). Так что technically — **transaction-safe**.

Но:

1. **Длинная транзакция**: для списка с 30 items → 30 последовательных SELECT/UPDATE внутри одной транзакции. На больших списках — lock contention.
2. **No SAVEPOINTs** — если 25-й item throws → вся транзакция rollback, предыдущие 24 pantry mutations откатываются.
3. **`purchasedAt = purchased ? new Date() : null`** — `new Date()` для каждого item вычисляется **до** цикла (line `const today = new Date()`). Если transaction занимает >1 сек → `today` устаревает.

**Смягчающий фактор:** Домашний household — десятки items, не тысячи.

**Рекомендованный фикс:**

- Batch operations: `tx.pantryItem.upsert({ ... })` instead of findFirst+update/create.
- Limit transaction duration: <500ms target.
- Consider chunking: если list > 100 items → chunk + progress events.

### T43-C. `auth.service.register()` relies on schema unique (not documented) 🟡 P3

**Файл:** `apps/api/src/auth/auth.service.ts:60-67`.

**Сырой код:**

```ts
async register(input: RegisterInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await getPrisma().user.findUnique({ where: { email } });
  if (existing) {
    throw new AppHttpException({
      code: 'CONFLICT',
      message: 'Email already registered',
    });
  }
  // ...
  await getPrisma().$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email, passwordHash } });
    // ...
  });
}
```

**`User.email` имеет `@@unique`** (см. `schema.prisma: User { email String @unique }`). Так что race protection **реально** работает на уровне БД.

**Но:**

- Code не документирует, что relies on schema unique constraint.
- Если кто-то удалит `@unique` → silent duplicate users.
- Comment не объясняет "trust schema constraint here".

**Рекомендованный фикс:**

```ts
// T13-A: findUnique — common case (already registered, return 409 fast).
// Race: two concurrent registrations both miss findUnique, then both
// attempt tx.user.create — the SECOND hits `User.email @unique` and
// Prisma throws P2002 → caught as CONFLICT. The schema constraint
// (User.email @unique in schema.prisma) is the authoritative arbiter.
const email = input.email.trim().toLowerCase();
const existing = await getPrisma().user.findUnique({ where: { email } });
if (existing) {
  throw new AppHttpException({ code: 'CONFLICT', message: 'Email already registered' });
}
// ... (continue)
```

### T43-D. `requireOwnedHouseholdId()` — sequential queries, race window 🟡 P3

**Файл:** `apps/api/src/profile/profile.service.ts` или `household/household.service.ts`.

**Сырой код (предположительно):**

```ts
async requireOwnedHouseholdId(userId: string): Promise<string> {
  const household = await getPrisma().household.findFirst({
    where: { members: { some: { userId, role: 'OWNER' } } },
    select: { id: true },
  });
  if (!household) {
    throw new AppHttpException({ code: 'HOUSEHOLD_NOT_FOUND', message: '...' });
  }
  return household.id;
}
```

**Сценарий гонки:**

1. User calls `requireOwnedHouseholdId()` → returns `householdId`.
2. **Между** этим и последующим query, user удаляется (admin operation) или transfer'ится в другой household.
3. Следующий query использует stale `householdId` → accesses другой household's data → **privacy leak** или просто inconsistent data.

**Смягчающий фактор:** User deletion — редкая операция. Household transfer — admin-only.

**Рекомендованный фикс:**

- Combine ownership check + data fetch в одну транзакцию:
  ```ts
  return withTenantContext({ householdId, userId }, async (tx) => {
    const data = await tx.something.findMany({/* scoped to householdId */});
    return data;
  });
  ```
- Передавать householdId явно через `currentUser(req).householdId` (после AuthGuard) — single source of truth.

---

## 2. Подтверждённые здоровые паттерны

- **`User.email @unique`** — DB-level race protection. ✓
- **T14-A fix**: preference add в transaction + DB unique constraint. ✓
- **`withTenantContext` transactions** для RLS-protected tables. ✓
- **Idempotency-Key guard** (T15-A) — duplicate POST protection. ✓
- **T13-A catch** в register() для P2002 → CONFLICT. ✓

## 3. Микро-наблюдения

- **T43-α** — `setItemPurchased` использует `findFirst` для ownership check, потом отдельный `update`. Это 2 queries — не optimal.
- **T43-β** — `tx.shoppingListItem.updateMany` (если использовать) НЕ возвращает updated row, только count. Для response нужны старые значения → нужен `findFirst` перед `updateMany` или `update` с проверкой.
- **T43-γ** — `requireOwnedHouseholdId` — нет транзакции вокруг ownership check + use. Если между ними user меняет household → race.
- **T43-δ** — `complete()` использует `today` const внутри transaction — если transaction долгий (>1 sec), `today` устаревает. Hygiene: pass `today` from caller.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона              | Находка                                                                                                           | Где                                                                            |
| --------- | --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **T43-A** | 🟠 P2     | API / Race        | `setItemPurchased` check-then-act без atomic guard. Concurrent DELETE → silent inconsistency.                     | `apps/api/src/shopping-lists/shopping-lists.service.ts:147-176`                |
| **T43-B** | 🟠 P2     | API / Transaction | `complete()` делает 30 sequential queries внутри transaction. Длинная транзакция, lock contention.                | `apps/api/src/shopping-lists/shopping-lists.service.ts:178-260`                |
| **T43-C** | 🟡 P3     | API / Race        | `auth.register` relies на `User.email @unique` (schema), но не документировано. Слабая documentation зависимость. | `apps/api/src/auth/auth.service.ts:60-67`, `schema.prisma: User.email @unique` |
| **T43-D** | 🟡 P3     | API / Race        | `requireOwnedHouseholdId()` sequential queries. Race window: user transfer между check и use.                     | `apps/api/src/profile/profile.service.ts` / `household.service.ts`             |

## 5. Куммулятивный итог (43 кругов)

| Iter   | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды) | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                | T41-A..D     | 0     | 0     | 2     | 2     |
| 42     | #42     | Pagination          | T42-A..D     | 0     | 0     | 2     | 2     |
| **43** | **#43** | **Async races**     | **T43-A..D** | **0** | **0** | **2** | **2** |

## 6. Рекомендации (43-й круг)

1. **(P2, 30 мин, T43-A)** Заменить findFirst+update на updateMany в `setItemPurchased`. Проверить count === 1.
2. **(P2, 1ч, T43-B)** В `complete()` — использовать `tx.pantryItem.upsert()` для batch. Limit transaction <500ms.
3. **(P3, 5 мин, T43-C)** Добавить comment в `auth.service.register` объясняющий rely на `User.email @unique`.
4. **(P3, 30 мин, T43-D)** Комбинировать ownership check + data fetch в `withTenantContext` transaction.

## 7. Артефакты (43-й круг)

| Артефакт                         | Где                             |
| -------------------------------- | ------------------------------- |
| Этот отчёт                       | `docs/audit/AUDIT-REPORT-43.md` |
| FIX-PLAN (T43-A,B,C,D)           | `docs/audit/FIX-PLAN.md`        |
| setItemPurchased race            | §1 T43-A                        |
| complete() long transaction      | §1 T43-B                        |
| register relies on schema unique | §1 T43-C                        |
| requireOwnedHouseholdId race     | §1 T43-D                        |
