# Технический, продуктовый и UI-аудит MULTI-CHEF (14-й круг)

**Дата:** 2026-09-14
**HEAD:** `d06d46b chore(audit): AUDIT-REPORT-13 thirteenth-iteration P0 finding T13-A auth-register race`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-13.md`, `VERIFICATION.md`
**Цель:** найти следующее config/contract-наблюдение. Особенно — race-conditions и privacy edge cases.

## TL;DR

14-й круг: **1 🟠 P1 находка** + **6 подтверждённых здоровых паттернов**. Круг не пустой.

- 🟠 **T14-A — `POST /api/v1/profile/preferences` имеет structural race window**. Код `findFirst` → `create` не под transaction; `Preference` schema имеет только `(userId, kind)` index, **НЕ** `@@unique([userId, kind, ingredientId])`. Под высокой параллельной нагрузкой возможны дубликаты preference rows.
- ✅ `POST /api/v1/auth/logout-all` IDOR-safe: User B's logout-all не влияет на User A's sessions.
- ✅ Pantry POST type validation strict: ingredientId=null→400, quantityG="100"→400, missing→400.
- ✅ Pantry POST quantityG=1_000_000_000 → 400 (Zod max=1_000_000).
- ✅ Pantry restore cross-user IDOR-safe: B → 404 PANTRY_ITEM_NOT_FOUND.
- ✅ Profile preferences sequential same body dedup: 2×201 → 1 DB row.
- ✅ `/shopping-lists/:id/fit-budget` edge cases: bad listId→404, negative target→400.

---

## 1. Технические находки (14-й круг)

### T14-A. `POST /api/v1/profile/preferences` имеет check-then-act race 🟠
**Файл:** `apps/api/src/profile/profile.service.ts` метод `addPreference`.

**Raw code (auth/service-style dedup):**
```ts
async addPreference(userId: string, body: PreferenceCreateBody) {
  if (body.ingredientId) {
    const ingredient = await getPrisma().ingredient.findUnique({ where: { id: ... } });
    if (!ingredient) throw new AppHttpException({ code: 'NOT_FOUND', ... });
    
    // Idempotency at the application level: don't double-insert
    const existing = await getPrisma().preference.findFirst({
      where: { userId, kind: body.kind, ingredientId: body.ingredientId },
    });
    if (existing) return { id: existing.id, ... };   // ← race window
  }
  const created = await getPrisma().preference.create({
    data: {
      id: generateUlid(),           // ← каждый call — новый ULID
      userId,
      ...(body.ingredientId !== undefined ? { ingredientId: body.ingredientId } : {}),
      kind: body.kind,
      ...(body.note !== undefined ? { note: body.note } : {}),
    },
  });
  return { id: created.id, ... };
}
```

**Schema (DB-level):**
```
indexname                       | indexdef
--------------------------------+-----------------------------------------------------------------
Preference_pkey                  | UNIQUE INDEX btree (id)
Preference_userId_kind_idx       | INDEX btree (userId, kind)   ← no ingredientId!
-- NO @@unique([userId, kind, ingredientId])
```

**Поток race:**
1. 5 concurrent POSTs with same `{kind:LOVE, ingredientId:X}` arrive simultaneously
2. All 5 execute `findFirst({userId, kind, ingredientId})` — under high concurrency, all see 0 rows
3. All 5 proceed to `create()` with **разные** ULID (поскольку `id: generateUlid()` per-call)
4. **DB constraint does not exist** for `(userId, kind, ingredientId)` — все 5 успешно вставляются
5. → 5 дубликатов строк

**Что я наблюдал при тесте:**
- Round 13 (raw output): `5×201, 2 rows in DB` (вероятно race частично завершился)
- Round 14 (clean test): `5×201, 1 row in DB` (findFirst правильно поймал, race не сработал)
- Идемпотентность при последовательных вызовах: `2×201 → 1 row` — корректно.

**Тест состояния схемы:**
```
grep "model Preference" /opt/multichef/packages/database/prisma/schema.prisma
→ нет @@unique (только @@index([userId, kind]))
```

**Воздействие:**
- ✅ **НЕ security**: дубликаты preference не дают атакующему доступа.
- 🟠 **Functional**: реальные пользователи на edge-case (rapid double-tap на UI кнопку «Добавить LOVE этому ингредиенту») могут получить 2-5 одинаковых строк. UI цикл будет показывать duplicates.
- 🟠 **DB-рост**: если злоупотреблять, DB может расти в ~5x раз.

**Фикс (15 мин):**
**Option A** — добавить DB-level unique constraint:
```prisma
// schema.prisma
model Preference {
  ...
  @@unique([userId, kind, ingredientId])
}
```
+ миграция `ADD CONSTRAINT Preference_userId_kind_ingredientId_key UNIQUE (userId, kind, ingredientId)`. Existing duplicates нужно сначала remove.

**Option B** — transactional idempotent addPreference:
```ts
async addPreference(userId, body) {
  return await getPrisma().$transaction(async (tx) => {
    if (body.ingredientId) {
      const existing = await tx.preference.findFirst({...});
      if (existing) return existing;
    }
    return await tx.preference.create({data: {id: generateUlid(), ...}});
  });
}
```

**Рекомендую Option A** (DB-level гарантия сильнее) + Option B как defence in depth.

---

## 2. Подтверждённые здоровые паттерны (6 health-checks)

### ✅ `/auth/logout-all` IDOR-safe (cross-user)
```
User A имеет 2 сессии (A1, A2)
A1 → POST /auth/logout-all → 204
Both sessions → 401 (revoked)
DB state: revoked=2, active=0

User B → POST /auth/logout-all (own) → 204
User A sessions после → 2 (unchanged)
```
Service logoutAll использует `userId from session`, не из body, **isolation строгая**.

### ✅ Pantry POST type validation strict
```
{ingredientId: null}        → 400 VALIDATION_ERROR ("expected string, received null")
{quantityG: "100"}          → 400 (string → number coercion fails)
{ingredientId: <OK>, ... }  → ??? (quantityG missing) → 400 {"fields": {"quantityG": ["Required"]}}
```
Type-checking корректный на каждом типе.

### ✅ Pantry POST quantityG boundaries
```
quantityG=1_000_000_000  → 400 VALIDATION_ERROR (exceeds max=1_000_000)
quantityG=999_999        → 201 (just under max — accepted)
quantityG=0              → 400 (positive() required)
```
Zod `.positive().max(1_000_000)` работает во всех граничных случаях.

### ✅ Pantry restore cross-user
```
A: DELETE own item → 204 (soft-delete)
B: POST /pantry/items/<A's id>/restore → 404 PANTRY_ITEM_NOT_FOUND
A: POST /pantry/items/<A's id>/restore → 200
```
IDOR-safe; B даже не видит, что item существует у A.

### ✅ Profile preferences sequential dedup
```
seq POST 1 (kind=LOVE, ingredientId=X) → 201
seq POST 2 (same body)                  → 201 (returns same id as #1)
DB rows: 1
```
App-level dedup работает для **последовательных** POSTs (тот же user без race).

### ✅ `/shopping-lists/:id/fit-budget` edge cases
```
listId=not-ulid                       → 404 SHOPPING_LIST_NOT_FOUND
listId=01HFAKEFAKEFAKEFAKEFAKEFAKE   → 404 SHOPPING_LIST_NOT_FOUND
listId=00000000-...                   → 404 SHOPPING_LIST_NOT_FOUND
{targetBudgetKopecks: -1}             → 400 VALIDATION_ERROR ("required integer" — должен быть ≥0)
{}                                    → 400 VALIDATION_ERROR
```

---

## 3. Микро-наблюдения

- **T14-B** — `/profile/preferences/:id` GET → 404 (route не существует, только list + POST). Возможная будущая фича.
- **T14-C** — `/shopping-lists/<id>/apply-proposal` поле `itemId` валидируется через Zod `.ulidSchema`; `00NOTANULID` → 400.
- **T14-D** — Schema `prisma/schema.prisma`: `model Preference` имеет `@relation` но НЕ `@@unique`. Index `@@index([userId, kind])` ПРЕДПОЛАГАЕТСЯ уникальным, но schema не enforce'ит. **Real design flaw.**
- **T14-E** — `addPreference` actor: `note`-only preference (no ingredientId) → branch skipped (нет dedup). 5 POSTs с разными `note` → 5 разных rows. By-design (note — free-form); но потенциальная UX-ловушка.

---

## 4. Сводка таблицей (NEW в этом круге)

| # | Приоритет | Зона | Находка | Где |
|---|---|---|---|---|
| **T14-A** | 🟠 P1 | API/DB | `addPreference` — check-then-act race window; schema lacks `@@unique([userId, kind, ingredientId])`. Concurrent POSTs могут создать дубликаты. | `apps/api/src/profile/profile.service.ts:addPreference`, `packages/database/prisma/schema.prisma` (Preference model) |

---

## 5. Куммулятивный итог (14 кругов)

| Iter | Findings | 🔴 P0 | 🟠 P1–P3 | 🟡 P3 / ℹ️ | Cumulative 🔴 |
|---|---|---|---|---|---|
| #1 | B1–B6 (6) | 2 | 1 | 3 | 2 |
| #2 | M1–M9 (9) | 3 | 2 | 4 | 5 |
| #3 | T1–T6, U1–U4 (11) | 4 | 3 | 4 | 9 |
| #4–10 | ... | 0 | 9 | 1 | 9 |
| #11 | T11-A, T11-B (2) | 0 | 2 | 0 | 9 |
| #12 | T12-A (1) | 0 | 1 | 0 | 9 |
| #13 | T13-A (1) | 1 | 0 | 0 | **10** |
| **#14** | **T14-A (1)** | **0** | **1** | **0** | 10 |
| **Σ** | **~44 уникальных** | **10 P0** | **22 P1-P3** | **12 ℹ️/P3** | — |

**Тренд 14-ти итераций:**
- 11 кругов без P0, потом T13-A P0, потом T14-A P1.
- Pattern: **race-conditions** — T13-A (register), T14-A (preferences) — оба check-then-act.

---

## 6. Рекомендации (14-й круг)

1. **(P1, 15 мин, T14-A)** Добавить `@@unique([userId, kind, ingredientId])` в `Preference` model + миграция `ALTER TABLE "Preference" ADD CONSTRAINT ... UNIQUE (...).` **Перед** миграцией — почистить существующие дубликаты (DELETE WHERE id IN (SELECT MIN(id) ... GROUP BY HAVING COUNT(*) > 1)).
2. **(P0, повтор)** T13-A не пофикшен. **Эта находка остаётся критичной.**

---

## 7. Артефакты (14-й круг)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-14.md` (коммит ниже) |
| Preference schema dump | §1 |
| 5-concurrent test raw | §1 |
| logout-all IDOR test | §2 |
| Pantry quantityG boundaries | §2 |
| Fit-budget edge tests | §2 |
