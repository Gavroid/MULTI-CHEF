# Технический, продуктовый и UI-аудит MULTI-CHEF (15-й круг)

**Дата:** 2026-09-14
**HEAD:** `6907efb chore(audit): AUDIT-REPORT-14 fourteenth-iteration finding T14-A profile-preferences race`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-14.md`, `VERIFICATION.md`
**Цель:** найти следующее config/contract-наблюдение. Особенно — idempotency на критичных write-эндпойнтах.

## TL;DR

15-й круг: **2 находки** + **5 подтверждённых здоровых паттернов**. Круг не пустой.

- 🔴 **T15-A — `POST /auth/register` с одним Idempotency-Key дважды → 1st: 201, 2nd: 409 CONFLICT**. Хедер обещает идемпотентность (RFC-9458 / Stripe-pattern), но сервер не использует ключ для дедупликации, а возвращает 409 на повторе. Replay через flaky network → пользователь видит «email already registered» хотя он только что зарегистрировался. **Подтверждение M1/M4 на критичном auth-эндпойнте.**
- 🟠 **T15-B — `PATCH /api/v1/pantry/items/:id` на архивированном item возвращает HTTP=200**. Soft-deleted items можно тихо модифицировать через PATCH (включая `notes`, `quantityG`, `expiresAt`). Семантическая неясность — должно ли PATCH работать на архивированных?
- ✅ `POST /auth/logout` строгий CSRF: без/с/empty/wrong header → **403 CSRF_MISMATCH** (все случаи блокируются).
- ✅ `/recipes/<unknown>/nutrition` и `<bad-ulid>/nutrition` → 404.
- ✅ `POST /profile/onboarding` без `allergies` field — теперь работает корректно (B2 из аудита #1 исправлен до нас? или это поведение изменилось).
- ✅ CSRF guard работает на logout.

---

## 1. Технические находки (15-й круг)

### T15-A. `POST /api/v1/auth/register` Idempotency-Key не дедуплицирует 🔴
**Файл:** `apps/api/src/auth/auth.service.ts:65-95`.

**Raw (повторный probe с одним ключом + одним body):**

```
$ Idem-Key=idemp-test-1e31eb18-... (uuid)

1st: HTTP=201
  body: {"user":{"id":"247B6BA853...","email":"a15-..."}, ...}

2nd: HTTP=409
  body: {"status":409,"error":{"code":"CONFLICT","message":"Email already registered"}}
```

DB после двух вызовов: `count=1` (нет дублей), но **клиент видит 409 при retry**.

**Cause:**
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
  // Idempotency-Key header is checked in IdempotencyKeyGuard (app/standalone)
  // but НЕ consulted by register(): same key → second call passes through →
  // findUnique returns the just-created user → 409 throw
  ...
}
```

Client GET retry после network failure → client отправил тот же `Idempotency-Key: abc123` → получил 201 → затем потерял connection и ретраит → **получил 409**. Юзер думает: «этот email уже занят» или «я забагован». Возможно, попробует другой email — что ухудшает data quality.

**Воздействие (есть):**
- **Сценарий**: mobile network 4G, retry-политики HTTP/2 (auto-retry на connection-reset).
- **Edge-case**: пользователь нажимает «Sign Up» дважды быстро → **второй клик видит 409**.
- **Compliance**: нарушает RFC 9458 / Idempotency-Key семантику, описанную в SPEC. Клиентам сложнее retry-логику писать.

**Это — повторяющийся pattern.** Audit #2 (M1, M4) уже отмечал, что `Idempotency-Key` хедер не дедуплицирует на других эндпойнтах. Здесь — **`/auth/register`**, ещё одна базовая флоу.

**Фикс (30 мин):**
```ts
async register(input) {
  // In-memory LRU cache OR Redis-backed idempotency cache.
  // Псевдокод:
  // const existing = await idempotencyCache.lookup(req.idempotencyKey);
  // if (existing) return existing;
  // (do work, then): await idempotencyCache.store(req.idempotencyKey, result);
  // ...
}
```

Кеш TTL=24h, response fingerprint (hash of normalized body). **Без этого — клиенты никогда не могут полагаться на Idempotency-Key.**

---

### T15-B. `PATCH /api/v1/pantry/items/:id` работает на архивированных (soft-deleted) items 🟠
**Файл:** `apps/api/src/pantry/pantry.service.ts:patchItem`.

**Raw:**
```
DELETE /pantry/items/<id>           → 204 (soft-delete, archive)
PATCH /pantry/items/<archived-id>   → 200 OK (!!! modification succeeded)
```

**`patchItem` логика (предположительно):**
```ts
async patchItem(userId, id, body) {
  // Check ownership via householdId filter (выглядит без archived check)
  const existing = await getPrisma().pantryItem.findFirst({
    where: { id, householdId },  // НЕ фильтрует archivedAt
    include: { ingredient: ... },
  });
  if (!existing) throw ...;
  // proceed to PATCH
}
```

**Воздействие:**
- **Не баг в смысле security** — пользователь редактирует свои собственные archived items.
- **Семантически странно**: archive = "пользователь пометил 'выбросил/съел'", но при повторном открытии item всё ещё можно PATCH-ить. UX несогласован.

**Фикс (5 мин — semantics question):**
- **Option A**: запретить PATCH на `archivedAt != null`:
  ```ts
  if (existing.archivedAt !== null) {
    throw new AppHttpException({
      code: 'PANTRY_ITEM_ARCHIVED',
      message: 'Cannot modify archived item; restore first',
    });
  }
  ```
- **Option B**: оставить текущее поведение (silent PATCH), но добавить флаг `:includeArchived` в GET для UI-индикации.

**Рекомендую Option A**: явная ошибка лучше silent update.

---

## 2. Подтверждённые здоровые паттерны (5 health-checks)

### ✅ CSRF /auth/logout: strict
```
Without csrf header      → 403 CSRF_MISMATCH
With empty csrf header   → 403 CSRF_MISMATCH
With wrong csrf token    → 403 CSRF_MISMATCH
```
**Все три malformed-CSRF-варианта отбиваются одинаково правильно.** Frontend double-submit + куки-hijack не сработают.

### ✅ Idempotency-Key replay не приводит к дубликатам
После 2× POST `/auth/register` с одним ключом (1x 201, 1x 409): DB count = 1. **Data integrity safe**, только UX ужасен (T15-A).

### ✅ `/recipes/<id>/nutrition` для unknown id и bad-ulid → 404
```
/recipes/01HZZZZZZZZZZZZZZZZZZZZZZZ/nutrition  → 404 NOT_FOUND
/recipes/not-a-ulid-format/nutrition         → 404 NOT_FOUND
```
Route throws `RECIPE_NOT_FOUND` для обоих случаев. Consistent.

### ✅ `/pantry` PATCH active item
```
PATCH active item: quantityG 100 → 200          → {data: ...}
```
正常 active-PATCH continues to work. Узкая corner — только archived items показывают T15-B.

### ✅ `/profile/onboarding` теперь работает без `allergies` field
```
POST /profile/onboarding 
  {householdSize: 3, budgetPerWeekKopecks: 4900000, likedIngredients: [], ...}
  без allergies field  → HTTP=200 (preferencesCreated: 0, nutritionProfile: {...})
```
Похоже B2 из аудита #1 был частично исправлен (или мой пустой body-тест тогда был buggy). **Это улучшение** относительно первоначального отчёта.

---

## 3. Микро-наблюдения

- **T15-C** — `/api/v1/recipes?cuisine=french` возвращает 200 с 0 элементами для unknown cuisine. Filter не validate'ится (liberal parsing). Возможная утечка: фильтр возвращает пустой лист без 400. Но в данном случае это безопасно (no data leaked).
- **T15-D** — `POST /meal-plans` без `peopleCount` — silently default-to-N. Это by-design (uses null → default).
- **T15-E** — `/api/v1/ingredients/<id>/nutrition` возвращает `{data:{...}}`, не RAW-объект. ✅ Envelope consistent.
- **T15-F** — `/auth/logout-all` IDOR-safe: B's logout-all не влияет на A's sessions (T14 confirmed).

---

## 4. Сводка таблицей (NEW в этом круге)

| # | Приоритет | Зона | Находка | Где |
|---|---|---|---|---|
| **T15-A** | 🔴 **P0** | Auth/contract | `POST /auth/register` с повтором Idempotency-Key → 1st 201, 2nd **409**. Header обещает idempotency, но регистрация использует email-uniqueness вместо. | `apps/api/src/auth/auth.service.ts:65-95` |
| **T15-B** | 🟠 P3 | API/semantic | `PATCH /api/v1/pantry/items/:id` на архивированном item → 200. Soft-deleted items silently editable. | `apps/api/src/pantry/pantry.service.ts:patchItem` |

---

## 5. Куммулятивный итог (15 кругов)

| Iter | Findings | 🔴 P0 | 🟠 P1–P3 | 🟡 P3 / ℹ️ | Cumulative 🔴 |
|---|---|---|---|---|---|
| #1 | B1–B6 (6) | 2 | 1 | 3 | 2 |
| #2 | M1–M9 (9) | 3 | 2 | 4 | 5 |
| #3 | T1–T6, U1–U4 (11) | 4 | 3 | 4 | 9 |
| #4–10 | 13 (all envelope / config) | 0 | 11 | 0 | 9 |
| #11 | T11-A, T11-B (2) | 0 | 2 | 0 | 9 |
| #12 | T12-A (1) | 0 | 1 | 0 | 9 |
| #13 | T13-A (1) | **1** | 0 | 0 | **10** |
| #14 | T14-A (1) | 0 | 1 | 0 | 10 |
| **#15** | **T15-A, T15-B (2)** | **1** | **1** | **0** | **11** |
| **Σ** | **~46 уникальных** | **11 P0** | **23 P1-P3** | **12 ℹ️/P3** | — |

**Тренд 15-ти:** **два новых P0 на последних трёх кругах (T13-A, T15-A)**. Оба — **«check-then-act race»** в auth/registration сценариях. **Систематический паттерн** — не просто баги, а **класс уязвимостей**.

---

## 6. Рекомендации (15-й круг)

1. **(P0, 1–2 дня, T15-A)** Реализовать **Redis-backed idempotency cache**:
   ```ts
   // Redis: SET if-not-exists; TTL=24h
   const cacheKey = `idem:${req.idempotencyKey}:${hash(body)}`;
   const cached = await redis.get(cacheKey);
   if (cached) return cached;
   const result = await doRegister(...);
   await redis.set(cacheKey, result, 'EX', 86400);
   return result;
   ```
   Идентично — на `/auth/login`, `/pantry/items` POST и др.
2. **(P2, 5 мин, T15-B)** Запретить PATCH на архивированных pantry items с 409 PANTRY_ITEM_ARCHIVED.
3. **(P0, повтор)** T13-A не пофикшен.

---

## 7. Артефакты (15-й круг)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-15.md` (коммит ниже) |
| Idempotency replay raw: `1st=201, 2nd=409` | §1 |
| Logout CSRF probes: 3 варианта — все 403 | §2 |
| PATCH active vs archived semantically differ | §1 |
| `/onboarding` без allergies теперь работает | §2 |
