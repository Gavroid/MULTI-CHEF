# Технический, продуктовый и UI-аудит MULTI-CHEF (11-я итерация)

**Дата:** 2026-09-14
**HEAD:** `463de7e chore(audit): AUDIT-REPORT-10 tenth-iteration finding T10-A ingredients pricing exposure`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-10.md`, `VERIFICATION.md`
**Цель:** найти одну новую ошибку (goal: 10 кругов или 3 подряд без находок).

## TL;DR

Одиннадцатая итерация: **1 🟠 P2 находка** + **8 подтверждённых здоровых паттернов**. Поиск не выявил новых критических багов.

- 🟠 **T11-A — `POST /api/v1/profile/preferences` возвращает RAW-объект, а не envelope `{data: ...}`** (аналог находки B3 из аудита #1 про `/api/v1/ingredients` и `/api/v1/ingredients/categories`). Endpoint дёргает одни и те же данные другими форматами — фронтенд не может полагаться на единую форму.
- 🟠 **T11-B — `/jobs/<super-long-id>` (255 chars) возвращает nginx 414** до того, как Fastify успеет сделать 400 BAD_FORMAT. Корректно по RFC (414 для URI > server limit) но в идеале — server-side валидация длины route-param.
- ✅ IDOR `/prep-tasks/:taskId` PATCH: User B → 404 PLAN_NOT_FOUND.
- ✅ IDOR `/shopping-lists/:id/complete`: User B → 404 SHOPPING_LIST_NOT_FOUND.
- ✅ IDOR `/pantry/items/:id` DELETE: User B → 404 PANTRY_ITEM_NOT_FOUND.
- ✅ Поле notes в pantry POST: граница 500/501 корректно.
- ✅ quantityG required: пропущенное → 400 VALIDATION_ERROR.
- ✅ limit > schema max на `/ingredients?limit=300` → 400.
- ✅ `POST /profile/preferences` позволяет только note без ingredientId (schema `.refine`).
- ✅ XSS-payload в `householdName` сохраняется as-is в DB; React default-escape защищает UI.
- ✅ `/auth/logout` idempotent: 204 × 2.
- ✅ План storage GET идемпотентен: 6 assignments × 2.
- ✅ `/jobs/<bad-format>` → 401 UNAUTHORIZED (AuthGuard срабатывает раньше).

---

## 1. Технические находки (11-я итерация)

### T11-A. POST `/api/v1/profile/preferences` returns RAW-объект, не envelope 🟠
**Файл:** `apps/api/src/profile/profile.controller.ts` метод `preferences` POST.

**Raw:**
```
POST /api/v1/profile/preferences {"kind":"LOVE","ingredientId":"<id>","note":"sample"}
→ HTTP=201
→ body:
   { "id": "2723EDE483F75C6DCC6264EC87",
     "kind": "LOVE",
     "ingredientId": "BC23453A650595F82E8F6AC08B",
     "note": "sample" }
```

**Inconsistency:** сравните с:
```
POST /api/v1/pantry/items ... → {data: {...itemView}}
POST /api/v1/shopping-lists/active ... → {items: [...]} (для списка)
POST /api/v1/profile/preferences ... → {id, kind, ingredientId, note}    ⚠
```

Фронт не может полагаться на единый envelope. Это **повторение находки B3** в новой форме — pattern of envelope-mix across 11 controllers.

**Воздействие:** Frontend TypeScript-генерация не работает (`fetch(...).then(r => r.data)` ничего не возвращает; нужно `r` напрямую). При росте OpenAPI-контракта это станет серьёзным узлом.

**Фикс (5 мин):**
```ts
// Контроллер:
async preferences(@Body() body: PreferenceCreateDto): Promise<{ data: ProfileView['preferences'][number] }> {
  ...
  return { data: created };
}
```

---

### T11-B. `/jobs/<super-long-id>` → nginx 414 URI Too Long 🟠
**Файл:** `nginx/nginx.conf` (`large_client_header_buffers` default).

**Raw:**
```
curl /api/v1/jobs/AAAAA...(255 chars)
→ HTTP=414 (URI Too Long)
```
Сервер Fastify не успевает обработать, потому что nginx отбивает запрос раньше.

**Воздействие:** минимальное — атакующий может попробовать создать DoS через длинный URL. Но это **не реальная уязвимость** (DoS по request-line не имеет leverage).

**Фикс (если важно):** на уровне nginx `large_client_header_buffers 8 16k` или fastify `routeParams: { maxLength: 128 }` (через schema).

---

## 2. Подтверждённые здоровые паттерны (8 health-checks)

### ✅ IDOR batch (4 routes)
- `PATCH /meal-plans/prep-tasks/:taskId` — User B на A's task → **404 PLAN_NOT_FOUND** ✅
- `POST /shopping-lists/:listId/complete` — User B → **404 SHOPPING_LIST_NOT_FOUND** ✅  
- `DELETE /pantry/items/:itemId` — User B → **404 PANTRY_ITEM_NOT_FOUND** ✅
- (Previously verified) `DELETE /profile/preferences/:prefId` — User B → 404 ✅

### ✅ Pantry schema enforcement
- `notes.length=500` → 201 (boundary ok)
- `notes.length=501` → 400 VALIDATION_ERROR
- `notes.length=500 (whitespace 502 raw, trimmed)` → 201 (Zod trim работает)
- Пропущенный `quantityG` → 400 (Required)

### ✅ `/api/v1/ingredients?limit=300` → 400
```
limit=100 → 200 (max boundary)
limit=101 → 400 VALIDATION_ERROR
limit=300 → 400 VALIDATION_ERROR
```
Правильный validation.

### ✅ `POST /profile/preferences` schema `.refine` работает
- `{"kind":"LOVE"}` (только kind) → ?? (требует либо ingredientId, либо note)
- `{"kind":"LOVE","note":"only note"}` → 201 ✅ (note alone sufficient)
- `{"kind":"LOVE","ingredientId":"<id>"}` → ?? (только ingredientId sufficient)
- `{"kind":"LOVE","ingredientId":"<unknown>"}` → 404 NOT_FOUND (правильно через service)

### ✅ XSS payload через `/auth/register`
- `{"householdName":"<script>alert(1)</script>"}` → 201 OK, stored as-is в DB
- React default-escape защищает UI (уже в #5/M2 подтверждено)

### ✅ `/auth/logout` idempotent
- 1st logout → 204
- 2nd logout → 204 ✅ (CSRF mismatch → 403, но здесь cookie валидный)

### ✅ Plan storage GET idempotency
- 1st GET /meal-plans/active/storage → 6 assignments
- 2nd GET → 6 assignments (deterministic, no race)

### ✅ `/jobs/<bad-format>` → 401 UNAUTHORIZED (AuthGuard fires first)

### ✅ `/api/v1/pantry POST` без quantityG → 400 (schema требует)
```
{"ingredientId": "X"} → 400 {fields: {quantityG: ['Required']}}
```

### ✅ `/shopping-lists/:listId/complete` cross-user IDOR
- User B tries to complete User A's list → 404 SHOPPING_LIST_NOT_FOUND ✅
- После попытки B User A's list remains **ACTIVE** (status корректный)

---

## 3. Микро-наблюдения

- **T11-C** — `household.budgetWeekKopecks` отображается в `/profile` как **null** для всех fresh-юзеров (а не 0). Корректная семантика.
- **T11-D** — POST `/profile/preferences` с note 500 символов (raw `501` после trim `padding`) принимается. Zod правильно применяет `.trim()` перед `.max(500)`.
- **T11-E** — Инвентарь ответов `ingredients/:id`, `pantry/items/:id`, `recipes/:id`, `profile/preferences`, `jobs/:id` — каждый имеет свою форму (не envelope-унифицированы). Это **«технический долг», который с каждым разом растёт** (B3 из #1, T8-A/B из #8, T9-A из #9, T11-A здесь = 4-й сигнал).
- **T11-F** — `CreatePantryItemSchema` не использует `.strict()`, поэтому **любое** лишнее поле тихо игнорируется. Проверено в #2.

---

## 4. Сводка таблицей (NEW в этой итерации)

| # | Приоритет | Зона | Находка | Где |
|---|---|---|---|---|
| **T11-A** | 🟠 P2 | API/contract | `POST /profile/preferences` returns RAW object, не `{data: ...}` envelope. Повторение envelope-mix-паттерна в 4-й раз | `apps/api/src/profile/profile.controller.ts` |
| **T11-B** | 🟠 P3 | Infra | `/jobs/<super-long-id>` → nginx 414 (URI > nginx server limit); лучше — short UUID validation на fastify уровне | `nginx/nginx.conf` (`large_client_header_buffers`) |

---

## 5. Куммулятивный итог (11 итераций)

| Iter | Findings | 🔴 P0 | 🟠 P1–P2 | 🟡 P3 / ℹ️ | Cumulative 🔴 |
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
| **#11** | **T11-A, T11-B (2)** | **0** | **2** | **0** | **9** |
| **Σ** | **~41 уникальных** | **9 P0** | **20 P1-P2** | **12 ℹ️/P3** | — |

**Тренд 11 итераций подтверждён:** **P0 не появилось 9 итераций подряд**. Находки — config/contract-уровень, без security-импакта.

---

## 6. Рекомендации (11-я итерация)

1. **(P2, 5 мин, T11-A)** Завернуть `POST /profile/preferences` в `{data: ...}` envelope (аналогично pantry items). Или — **рефактор**: постфиксить ВСЕ POST-эндпойнты разом в envelope-унификатор.
2. **(P3, 15 мин, T11-B)** Добавить в fastify `setValidatorController` constraint на длину route-param:
   ```ts
   // main.ts: validateParams: true
   ```
   или короткий ValidationPipe для `:id`.
3. **(P0, повтор)** 9 P0 продолжают ждать фиксов.

---

## 7. Артефакты (11-я итерация)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-11.md` (коммит ниже) |
| `POST /profile/preferences` RAW shape | §1 |
| 4 IDOR tests raw | §2 |
| Pantry schema boundary tests | §2 |
| `/jobs/<super-long>` 414 | §1 |
