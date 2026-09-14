# Технический, продуктовый и UI-аудит MULTI-CHEF (12-й круг)

**Дата:** 2026-09-14
**HEAD:** `d679d47 chore(audit): AUDIT-REPORT-11 eleventh-iteration findings T11-A T11-B envelope nginx-414`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-11.md`, `VERIFICATION.md`
**Цель:** найти следующее config/contract-наблюдение.

## TL;DR

12-й круг: **1 🟠 P3 находка** + **5 подтверждённых здоровых паттернов**. Круг не пустой (target `>= 1 observation`).

- 🟠 **T12-A — `GET /api/v1/shopping-lists/active` возвращает RAW `null` body**, когда у пользователя нет активного списка. Один из примеров повторяющегося pattern (T8-B для `/meal-plans/active`, T11-A для envelope в preferences).
- ✅ IDOR `/household` PATCH: User B не может изменить household A. Service-level `requireOwnedHousehold(userId)` корректно изолирует.
- ✅ Pantry `unit` enum: только `G | ML | PIECE`; HOUR / lowercase 'g' → 400 VALIDATION_ERROR. Schema строгий.
- ✅ Pantry `amountStatus=PINCH` → 400 (строгий enum).
- ✅ `POST /meal-plans/active/prep` × 2 → обе 200 (idempotent).
- ✅ `DELETE /api/v1/meal-plans/active` → 404 (route only accepts POST/GET/PATCH).
- ✅ `POST /profile/onboarding` × 2 → обе 200 (idempotent upsert).
- ✅ HEAD `/api/v1/recipes`, `/ingredients`, `/health/live` → 200.
- ✅ Invalid unit `HOUR`, `g` (lowercase), `amountStatus=PINCH`, `ingredientId=12345` → 400.
- ✅ `/apply-proposal` with malformed itemId → 400 VALIDATION_ERROR.

---

## 1. Технические находки (12-й круг)

### T12-A. `GET /api/v1/shopping-lists/active` returns RAW `null` body 🟠
**Файл:** `apps/api/src/shopping-lists/shopping-lists.service.ts:getActiveForUser`

**Raw:**
```
GET /api/v1/shopping-lists/active (user without shopping list)
→ HTTP=200
→ body: null         ← raw JSON null
```

**Pattern повторяющийся** (audit #8 T8-B тоже нашёл `/meal-plans/active` и `/profile/nutrition`): envelope inconsistency across endpoints.

**Воздействие:**
1. Frontend обрабатывает body разными путями — где-то `data.items ?? []`, где-то `body.items ?? []`, где-то `body && body.items`.
2. Дополнительный код-error risk: фронт может упасть с `Cannot read property 'items' of null` если забудет null-check.

**Фикс (5 мин):**
```ts
// shopping-lists.service.ts
async getActiveForUser(userId: string) {
  // ...
  if (!list) return { list: null };  // ← envelope
  // ...
}
```

---

### T12-B (minor). `/api/v1/ingredients?categoryId=` (empty) → 400
**Не баг — клёвый**. Schema strict-mode отклоняет пустую строку как невалидное значение. **ℹ️ правильное поведение**.

---

## 2. Подтверждённые здоровые паттерны (5 health-checks)

### ✅ Household PATCH IDOR-safe
Service `household.service.ts` использует `requireOwnedHousehold(userId)` — PATCH всегда трогает **свой** household, не чужой.  
**User B с валидной session не может изменить household User A.**

```
User A:  PATCH /household {name: "A-updated"} → 200, A's household = "A-updated"
User B:  PATCH /household {name: "B-trying-A"} → 200 (но B's household обновляется, A неизменно)
```

### ✅ Pantry enum strictness
```
unit: "G"      → 201   ✓
unit: "ML"     → 201   ✓ (also valid)
unit: "PIECE"  → 201   ✓ (also valid)
unit: "HOUR"   → 400 VALIDATION_ERROR   ✓
unit: "g"     → 400 VALIDATION_ERROR   ✓ (lowercase rejected)
amountStatus: "PINCH" → 400 VALIDATION_ERROR (only AMOUNT_STATUS_VALUES allowed)
ingredientId: 12345 (not ULID) → 400 VALIDATION_ERROR ✓
```
Enum consistent across `Create` и `Patch` schema.

### ✅ `POST /api/v1/meal-plans/active/prep` × 2 → idempotent (200 × 200)
Двойной вызов не вызывает ошибок. План prep-session можно идемпотентно генерить.

### ✅ `POST /api/v1/profile/onboarding` × 2 → idempotent (200 × 200)
В отличие от моего **ложного срабатывания** (видимо, test artifact на bash-уровне), реальная повторная отправка через HTTP работает как надо. **Onboarding** использует `tx.nutritionProfile.upsert({where: {userId}, ...})` — duplicate insert → update.

### ✅ HTTP method strictness
- `DELETE /api/v1/meal-plans/active` → 404 (no DELETE handler on this route)
- `PUT /api/v1/meal-plans/active` → 404
- `HEAD /api/v1/recipes` → 200
- `HEAD /api/v1/auth/session` → 401 (auth still required)
- `HEAD /api/v1/health/live` → 200
- `/api/v1/_healthz` → 404 (no alternate route)

### ✅ `/api/v1/shopping-lists/<id>/apply-proposal` validation
```
POST /api/v1/shopping-lists/<id>/apply-proposal {itemId: "00NOTANULID", decision: "DROP"}
→ HTTP=400 VALIDATION_ERROR
```

---

## 3. Микро-наблюдения

- **T12-C** — `POST /meal-plans` для пользователя БЕЗ pantry items возвращает **полноценный plan** (из IMPORTED рецептов, не just-empty). Это может быть design-choice (план на основе всех 2000 рецептов), но реально странно: если у вас пустой холодильник, вы получите план с рецептами, которые вы не можете приготовить.
- **T12-D** — Inventory response envelopes:
  | Endpoint | Method | Shape |
  |---|---|---|
  | `/auth/register` | POST | `{user, household, sessionToken}` |
  | `/auth/login` | POST | `{user, household, sessionToken}` |
  | `/pantry/items` | POST | `{data: {...item}}` |
  | `/pantry/items/:id` | PATCH | `{data: {...item}}` |
  | `/meal-plans` | POST | `{jobId, deduplicated}` |
  | `/profile/preferences` | POST | `{id, kind, ingredientId, note}` ⚠ raw |
  | `/shopping-lists/<id>/complete` | POST | `{completed, pantryItemsTouched}` |
  | `/meal-plans/active/prep` | POST | `{PrepSessionDto}` (no envelope) |

  → **6 разных shape-стратегий на 8 endpoint-ов**. Это — **growing technical debt** (повторение envelope-mix — 6-я находка).

---

## 4. Сводка таблицей (NEW в этом круге)

| # | Приоритет | Зона | Находка | Где |
|---|---|---|---|---|
| **T12-A** | 🟠 P3 | API/contract | `GET /api/v1/shopping-lists/active` returns RAW `null` body when no active list (5-th occurrence of envelope-mix pattern) | `apps/api/src/shopping-lists/shopping-lists.service.ts:getActiveForUser` |

---

## 5. Куммулятивный итог (12 кругов)

| Iter | Findings | 🔴 P0 | 🟠 P1–P3 | 🟡 P3 / ℹ️ | Cumulative 🔴 |
|---|---|---|---|---|---|
| #1 | B1–B6 (6) | 2 | 1 | 3 | 2 |
| #2 | M1–M9 (9) | 3 | 2 | 4 | 5 |
| #3 | T1–T6, U1–U4 (11) | 4 | 3 | 4 | 9 |
| #4 | T4-A, T4-B, T4-C (3) | 0 | 2 | 1 | 9 |
| #5 | T5-A, T5-B (2) | 0 | 2 | 0 | 9 |
| #6 | T6-A (1) | 0 | 1 | 0 | 9 |
| #7 | T7-A, T7-B (2) | 0 | 2 | 0 | 9 |
| #8 | T8-A, T8-B (2) | 0 | 2 | 0 | 9 |
| #9 | T9-A, T9-B (2) | 0 | 2 | 0 | 9 |
| #10 | T10-A (1) | 0 | 1 | 0 | 9 |
| #11 | T11-A, T11-B (2) | 0 | 2 | 0 | 9 |
| **#12** | **T12-A (1)** | **0** | **1** | **0** | **9** |
| **Σ** | **~42 уникальных** | **9 P0** | **21 P1-P3** | **12 ℹ️/P3** | — |

**Тренд 12 кругов подтверждён:** P0 не появилось **10 итераций подряд**. Каждое новое наблюдение — config/contract-уровень. Кучка envelope-находок: T8-B → T9-B → T11-A → T12-A — повторение одного паттерна в новых endpoint'ах.

---

## 6. Рекомендации (12-й круг)

1. **(P3, 5 мин, T12-A)** Обернуть `getActiveForUser()` shopping-lists в envelope `{list: null}`. Это решит 5-й случай envelope-mix в одном diff.
2. **(P3+) Global: envelope-cleanup скоуп** — отрефакторить все `getActive*`-методы разом:
   - `/meal-plans/active` ✓ (T8-B)
   - `/profile/nutrition` ✓ (T9-B)
   - `/shopping-lists/active` ← this one
3. **(P0, повтор)** 9 P0 продолжают ждать фиксов.

---

## 7. Артефакты (12-й круг)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-12.md` (коммит ниже) |
| `GET /shopping-lists/active` RAW null | §1 |
| Pantry enum tests raw | §2 |
| Idempotency onboarding tests | §2 |
| HTTP method matrix | §2 |
| Response envelope inventory | §3 |
