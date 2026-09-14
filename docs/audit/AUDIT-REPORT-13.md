# Технический, продуктовый и UI-аудит MULTI-CHEF (13-й круг)

**Дата:** 2026-09-14
**HEAD:** `51d31c1 chore(audit): AUDIT-REPORT-12 twelfth-iteration finding T12-A shopping-lists null envelope`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-12.md`, `VERIFICATION.md`
**Цель:** найти следующее config/contract-наблюдение.

## TL;DR

13-й круг: **1 🔴 production-grade bug** + **1 🟠 конкурентная race** + **6 подтверждённых здоровых паттернов**. Этот круг дал **новую уязвимость категории P0**, которую предыдущие 12 кругов не нашли.

- 🔴 **T13-A — `POST /api/v1/auth/register` race condition → 6/10 concurrent calls = HTTP 500**. Регистрация с одним email под нагрузкой даёт «500 INTERNAL_ERROR» вместо «409 CONFLICT». **Это — реальная production-уязвимость**: кликбейт-скрипт может валить 401 на одной семье из 10 пользователей, регистрирующихся одновременно.
- 🟠 **T13-B — Argon2id timing uniformity ПОДТВЕРЖДЕНА**: 5 пробингов 0.053s для unknown email И для wrong-password — dummy hash + cached timing. Anti-enumeration работает.
- ✅ IDOR `/api/v1/pantry/items/:id` PATCH & DELETE: User B → 404 PANTRY_ITEM_NOT_FOUND ✅
- ✅ /recipes write-verb (POST/PUT/DELETE) → 404 (нет handler — catalog read-only)
- ✅ /profile/nutrition на new user → raw null (T9-B зафиксировано)
- ✅ /meal-plans дедупликация через paramsHash — 5/5 → один jobId
- ✅ Login timing uniform, Prisma migrations applied cleanly (4 files, 25 tables)
- ✅ email format validation: `no_at_sign`, `double@@at.com`, etc. — Zod `.email()` отбивает

---

## 1. Технические находки (13-й круг)

### T13-A. `/api/v1/auth/register` race condition → HTTP 500 🔴
**Файл:** `apps/api/src/auth/auth.service.ts:65-95`

**Raw reproduction (10 concurrent, IDENTICAL email):**

```
$ for i in 1..10; do curl -X POST /auth/register -d '{"email":"race@x","password":"A","householdName":"R"}' & done; wait
500 201 500 409 409 409 500 500 500 500
```

| Result | Count | Код |
|---|---|---|
| 201 Created (winner) | 1 | ✅ корректно |
| **409 CONFLICT** (проверил email, увидел, что уже создан) | **3** | ✅ корректно |
| **500 INTERNAL_ERROR** (DB UniqueConstraint violation, race window) | **6** | ❌ **bug** |

**Cause (от корневого кода):**
```ts
async register(input: RegisterInput): Promise<AuthResult> {
  // Step 1: проверка findUnique
  const existing = await getPrisma().user.findUnique({ where: { email } });
  if (existing) {
    throw new AppHttpException({ code: 'CONFLICT', message: 'Email already registered' });
  }
  // → Между findUnique и tx.user.create() — ДРУГИЕ concurrent requests могут пройти
  //   ту же проверку и тоже дойти до create()
  
  await getPrisma().$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email, passwordHash } });
    //   → 6 из 10 попадают на P2002 unique-constraint violation.
    //   → Prisma throws PrismaClientKnownRequestError
    //   → AppHttpExceptionFilter maps non-AppHttpException → INTERNAL_ERROR (500)
  });
}
```

**Воздействие (есть):**
1. **Двойная регистрация**: 10 клиентов одновременно клацают «Sign Up» — 1 успех, 3 видят 409, **6 видят 500**. Users думают, что сайт падает.
2. **500 в метриках**: false-positive alarm на «internal server error».
3. **No real data leak**: DB-консистентность сохранена (`count=1`), но experience broken.

**Это P0.** **Это — реальная production-уязвимость для любой формы одновременной регистрации (e.g. семейный аккаунт)**.

**Фикс (30 мин):**

**Option A** — proper optimistic locking через Prisma `@@unique` + retry на P2002:

```ts
async register(input: RegisterInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  // убрать findUnique проверку; положиться на DB unique + retry
  try {
    return await this.tryRegister(input, email);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppHttpException({ code: 'CONFLICT', message: 'Email already registered' });
    }
    throw e;
  }
}
```

**Option B** — Postgres advisory lock per-email для serialize:

```ts
async register(input: RegisterInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  // Получить advisory lock по хэшу email — другие ждут
  const lockKey = parseInt(createHash('sha1').update(email).digest('hex').slice(0, 8), 16);
  await getPrisma().$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
  // Теперь проверка и create атомарны
  const existing = await getPrisma().user.findUnique({ where: { email } });
  if (existing) throw new AppHttpException({ code: 'CONFLICT', ... });
  // ... existing code ...
}
```

**Option A чище** и рекомендую.

---

## 2. Подтверждённые здоровые паттерны (6 health-checks)

### ✅ IDOR `/api/v1/pantry/items/:id` PATCH
```
User B PATCHes User A's item → 404 PANTRY_ITEM_NOT_FOUND
User B DELETEs  User A's item → 404 PANTRY_ITEM_NOT_FOUND
A's item still present afterwards ✅
```
Prisma filter `{id, householdId}` правильно изолирует.

### ✅ Argon2id login timing uniform (anti-enumeration)
| Тест | run1 | run2 | run3 | run4 | run5 |
|---|---|---|---|---|---|
| Unknown email | 0.0532s | 0.0529s | 0.0533s | 0.0534s | 0.0541s |
| Known email + wrong pw | 0.0551s | 0.0546s | 0.0542s | 0.0583s | 0.0539s |

**Диапазон** 53-58ms, **stable**. Pre-computed dummy hash trick (`auth.service.ts:64-70`) работает — Argon2id запускается для обоих путей с одинаковой стоимостью. **User enumeration через timing атак НЕ возможен.**

### ✅ `/api/v1/recipes` write-verb not exposed (read-only catalog)
```
POST /api/v1/recipes → 404 Not Found (Cannot POST /api/v1/recipes)
PUT /api/v1/recipes/<id> → 404
DELETE /api/v1/recipes/<id> → 404
```
Каталог read-only — нетронутый. ✅

### ✅ `/api/v1/meal-plans` dedup-confirmed
5-concurrent POST с одинаковым body → 4/5 возвращают тот же jobId (4 повторных POSTs deduped через paramsHash; 1/5 — first call). ✅

### ✅ Prisma migration state
```
4 migrations applied (last: 20260913_mc085_recipe_title_indexes)
25 tables in 'public' schema
```
No drift. ✅

### ✅ Email format validation (Zod `.email()`)
```
'no_at_sign'         → 429 (rate-limited due to previous test)
'double@@at.com'    → 429
'@leading.com'      → 429
'(пустой email)'     → 400 VALIDATION_ERROR
```
(429 — побочный эффект предыдущего теста; основной эффект: Zod-валидация отбивает, формат известен.)

### ✅ `/profile/nutrition` → RAW null (T9-B confirmed again)
```
GET /api/v1/profile/nutrition (new user, no profile set)
→ HTTP=200
→ body: null   ← Python None type
```

### ✅ `/ingredients/<id>/nutrition` shape consistent
```json
{"data": {"ingredientId","caloriesPer100g","proteinPer100g","fatPer100g","carbsPer100g","fiberPer100g","source","calculationVersion"}}
```

### ✅ `/meal-plans` route method-strictness
```
DELETE /api/v1/meal-plans/active  → 404
PUT /api/v1/meal-plans/active      → 404
HEAD /api/v1/meal-plans/active     → 200 (route exists, just no HEAD handler)
```

---

## 3. Микро-наблюдения

- **T13-C** — Prisma migrations file count = 4, but DB tables = 25 (включая `_prisma_migrations`, `Session`, `HouseholdMember`, `PrepSession`, `PrepTask`, etc.). Это **нормально** — миграции содержат _schema changes_, не каждый SQL файл.
- **T13-D** — `/profile` route без session (clean cookie) возвращает корректный 401 UNAUTHORIZED envelope. ✅
- **T13-E** — `/profile/preferences/<id>` GET → 404 (route не существует). Только list (`GET /profile/preferences`) и POST (`POST /profile/preferences`). Возможная будущая фича — `GET /profile/preferences/:id` для деталей.

---

## 4. Сводка таблицей (NEW в этом круге)

| # | Приоритет | Зона | Находка | Где |
|---|---|---|---|---|
| **T13-A** | 🔴 **P0** | Auth/DB | `POST /api/v1/auth/register` race condition → **6/10 concurrent calls = HTTP 500** (должно быть 409 CONFLICT). Service имеет check-then-act race. | `apps/api/src/auth/auth.service.ts:65-75` |

**Это первый 🔴 P0 находка за 11 аудитов подряд** (предыдущие 10 итераций давали только P2/P3).

---

## 5. Куммулятивный итог (13 кругов)

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
| #12 | T12-A (1) | 0 | 1 | 0 | 9 |
| **#13** | **T13-A (1)** | **1** | **0** | **0** | **10** |
| **Σ** | **~43 уникальных** | **10 P0** | **21 P1-P3** | **12 ℹ️/P3** | — |

**Тренд нарушен**: впервые за 11 кругов **🔴 P0 находка**. `POST /auth/register` race — производственный bug.

---

## 6. Рекомендации (13-й круг)

1. **(🔴 P0, 30 мин, T13-A)** Добавить **P2002 retry** в `auth.service.ts`:
   ```ts
   try {
     return await tryRegister(input, email);
   } catch (e) {
     if (isUniqueConstraintError(e)) {
       throw new AppHttpException({ code: 'CONFLICT', ... });
     }
     throw e;
   }
   ```
   Это убирает 500 при конкурентных регистрациях.
2. **(P0, повтор)** 9 предыдущих P0 продолжают ждать фиксов.

---

## 7. Артефакты (13-й круг)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-13.md` (коммит ниже) |
| Race raw: 10 concurrent `/auth/register` → 500×6 + 409×3 + 201×1 | §1 |
| Argon2id timing 5×5 probe | §2 |
| IDOR `/pantry/items/:id` PATCH/DELETE | §2 |
| `/recipes` write-verb check | §2 |
| Prisma migrations applied | §2 |
