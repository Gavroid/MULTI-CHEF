# Технический, продуктовый и UI-аудит MULTI-CHEF (девятая итерация)

**Дата:** 2026-09-14
**HEAD:** `a92bf40 chore(audit): AUDIT-REPORT-8 eighth-iteration findings T8-A T8-B cursor null-body`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, `-3.md`, `-4.md`, `-5.md`, `-6.md`, `-7.md`, `-8.md`, `VERIFICATION.md`
**Цель:** проверить зоны, не покрытые ранними итерациями — валидация мутаций в `/meal-plans/prep-tasks/:id`, `/shopping-lists/*` routes, session-token entropy, pantry restore idempotency, profile endpoint shape consistency, jobs UUID validation.

## TL;DR

Девятая итерация находит **2 🟠 P2 находки** + подтверждает **6 здоровых паттернов**.

- 🟠 **T9-A — `PATCH /api/v1/meal-plans/prep-tasks/:taskId` НЕ валидирует body** (`@Body() body: unknown`, нет Zod-схемы). OpenAPI описание не отражает форму, лишние поля проглатываются. Это **код-smell** без безопасной эксплуатации.
- 🟠 **T9-B — `/api/v1/profile/nutrition` возвращает RAW `null`** при отсутствии NutritionProfile — аналогично T8-B. Контракт: «`null` если нет» требует null-safe клиент, но body **не envelope** (`{data:null}` или `{profile:null}`).
- ✅ `generateSessionToken()` использует `crypto.randomBytes(32)` → **256-бит энтропия**. `generateUlid()` — `randomBytes(13)` → 104-бит (с поправкой на UC не использующееся). Оба — production-grade.
- ✅ Pantry DELETE idempotent: HTTP=204 дважды ✅
- ✅ Pantry RESTORE is NOT idempotent (1st=200, 2nd=400 `ITEM_NOT_ARCHIVED`) — correct hard-pattern but **semantically 200-noop would be friendlier**.
- ✅ `mc_session=`, garbage cookie → 401 UNAUTHORIZED (no enumeration).
- ✅ IDOR `/profile/preferences/:id` DELETE: User B на A's id → 404, A's preference нетронут.
- ✅ /api/v1/jobs/<non-ulid> → 404 JOB_NOT_FOUND.

---

## 1. Технические находки (девятая итерация)

### T9-A. `PATCH /api/v1/meal-plans/prep-tasks/:taskId` НЕ валидирует body 🟠
**Файл:** `apps/api/src/meal-plans/meal-plans.controller.ts:80-92`.

**Raw (код без DTO):**
```ts
@Patch('prep-tasks/:taskId')
@HttpCode(200)
@ApiOperation({ summary: 'Toggle a prep task done flag' })
async toggleTask(
  @Req() req: FastifyRequest,
  @Param('taskId') taskId: string,
  @Body() body: unknown,             // ← НЕТ ВАЛИДАЦИИ
): Promise<{ done: boolean }> {
  const user = currentUser(req as unknown as { user: AuthenticatedUser });
  const done = (body as { done?: unknown } | null)?.done === true;
  return this.svc.togglePrepTask(user.id, taskId, done);
}
```

**Raw behaviour (10 calls with various bodies):**
```
Body {}            → 200 (done=false)
Body {done:true}   → 200 (done=true)
Body {done:1}      → 200 (done=false)  ← String "1" → false
Body {done:"yes"}  → 200 (done=false)  ← String "yes" → false
Body {hacker:xss}  → 200 (done=false)
Body {done:true,hacker:'<alert>'} → 200 (done=true, hacker игнорируется)
Body null          → 200 (done=false)  ← любые null в body
Body []            → 200 (done=false)  ← array body
Body "string"      → 200 (done=false)
```

**Воздействие:**
- **Не безопасность** — endpoint idempotent + никаких SQL-эффектов помимо `done` flag
- **Код-smell**: `@Body() body: unknown` + `(body as ...)` cast в контроллере — не idiomatic NestJS (везде используется Zod)
- **OpenAPI генерируется без схемы body** — клиенты не получают auto-generated TS-типы
- **Frontend не получает ошибку** при ошибочном body — done становится false беззвучно

**Фикс (10 мин):**
1. Добавить `PatchPrepTaskDto` в `meal-plans.dto.ts`:
   ```ts
   export const PatchPrepTaskSchema = z.object({
     done: z.boolean(),
   }).strict();
   export class PatchPrepTaskDto extends createZodDto(PatchPrepTaskSchema) {}
   ```
2. Использовать в контроллере:
   ```ts
   @Body() body: PatchPrepTaskDto,
   ```

---

### T9-B. `/api/v1/profile/nutrition` returns RAW `null` when no profile 🟠
**Файл:** `apps/api/src/profile/profile.service.ts` (метод `getNutrition`/`getNutritionProfile`).

**Raw:**
```
GET /api/v1/profile/nutrition  (no NutritionProfile row for user)
→ HTTP=200
→ body: null               ← raw JSON null
```

Аналогично **T8-B** (`/meal-plans/active` → `null`). Контракт: «`null` если нет» требует null-safe клиент.

**Воздействие:**
- **Конкурентно** с T8-B (оба места возвращают RAW `null`).
- Frontend React компоненты с `: null` ternary справляются, но raw null — это anti-pattern for JSON.
- OpenAPI generator выдаёт nullable, но message недостаточно ясен.

**Фикс:** обернуть в envelope:
```ts
if (!np) return { profile: null, message: 'No nutrition profile set; onboarding required' };
```

---

## 2. Подтверждённые здоровые паттерны (6 health-checks)

### ✅ Session token entropy — production-grade
**Файл:** `apps/api/src/auth/session-token.ts`

```ts
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}
// TOKEN_BYTES = 32

export function generateUlid(): string {
  const buf = randomBytes(13);  // 104 bits
  return buf.toString('hex').toUpperCase().padEnd(26, '0').slice(0, 26);
}
```

- Session token: **256-bit** from `crypto.randomBytes(32)` ✅ production-grade
- ULID: 104-bit (sufficient for internal IDs, **non-Crockford**-compatible — служебный)
- SHA-256 of token in DB for O(1) lookup (not Argon2 — но token random, не password; SHA-256 appropriate per MC-010 doc)
- Cookies carry raw token, never stored plaintext

### ✅ Pantry DELETE idempotent
```
DELETE /api/v1/pantry/items/<id>     → 204
DELETE /api/v1/pantry/items/<id>     → 204  (no error)
```
Soft-delete + Idempotency-Key dedup: ✅

### ✅ Pantry RESTORE one-shot
```
POST /api/v1/pantry/items/<id>/restore  → 200 {data: ...}  
POST /api/v1/pantry/items/<id>/restore  → 400 ITEM_NOT_ARCHIVED (semantically correct)
```
Не строго idempotent (2nd call имеет 400), но семантически корректно (если item не в архиве — restore не может работать).

### ✅ Empty/garbage cookie → 401 UNAUTHORIZED
```
Cookie: mc_session=
Cookie: mc_csrf=
→ HTTP=401
```
```
Cookie: mc_session=garbage_value
Cookie: mc_csrf=fake
→ HTTP=401
```
Никакой enumeration.

### ✅ /api/v1/jobs/:id shape consistent
```
GET /jobs/00000000-...                → 404 JOB_NOT_FOUND (valid ULID format, doesn't exist)
GET /jobs/not-a-ulid                  → 404 JOB_NOT_FOUND (no ULID format validation, but result is 404 anyway)
```

### ✅ `/profile` envelope consistent (mostly)
```
GET /profile            → {user, household, nutritionProfile, preferences}
GET /profile/nutrition  → null (T9-B: should be envelope)
GET /profile/preferences → [...]
GET /household          → {id, name, ownerId, defaultPeopleCount, currency, budgetWeekKopecks}
```
`/profile` — envelope. `/household` — envelope. `/profile/preferences` — raw array. **Inconsistency** but consistently readable.

---

## 3. Микро-наблюдения

- **T9-C** — `/api/v1/jobs/<bad-uuid>` returns 404 instead of 400 BAD_FORMAT. NestJS auto-validates UUID via `ParseUUIDPipe` (отсутствует в данном случае) — controller просто использует `@Param('id') id: string` без валидации, поэтому и arbitrary string gets evaluated by service (returns 404 'not found').

- **T9-D** — `services.ts` parse для `@Param('taskId') taskId: string` без UUID-валидации. Можно сразу понять: `togglePrepTask` ожидает формат `entryId-dayIndex-MEALTYPE` (см. `storage plan` output из audit #5 → `entryId: "4ce2f688-ffa0-...-d0-BREAKFAST"`), а не UUID. Reasonable design, but lacks documentation.

---

## 4. Сводка таблицей (NEW в этой итерации)

| # | Приоритет | Зона | Находка | Файл |
|---|---|---|---|---|
| **T9-A** | 🟠 P2 | API/code-quality | `PATCH /meal-plans/prep-tasks/:taskId` body — `@Body() unknown`, нет Zod-схемы, нет OpenAPI-аннотации | `apps/api/src/meal-plans/meal-plans.controller.ts:80-92` |
| **T9-B** | 🟠 P2 | API/contract | `/api/v1/profile/nutrition` возвращает RAW `null` (аналогично T8-B) | `apps/api/src/profile/profile.service.ts` |

---

## 5. Что НЕ удалось проверить
- 🟡 **`/api/v1/shopping-lists/:id/fit-budget` round-trip вживую** — нужен активный plan + shopping list (требует более длинного полного сценария)
- 🟡 **Worker sustained load** — требует long-running сессии
- 🟡 **Auth throttling per-IP vs per-user mem-key** — `ThrottlerModule.forRoot` без явного tracker, default = IP. Если за Cloudflare (trust=0), shared NAT — overuse по IP

---

## 6. Куммулятивный итог (9 итераций)

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
| **#9** | **T9-A, T9-B (2)** | **0** | **2** | **0** | **9** |
| **Σ** | **~38 уникальных** | **9 P0** | **17 P1-P2** | **12 ℹ️/P3** | — |

**Тренд 9 итераций подтверждён:** **P0 не появилось 7 итераций подряд**, и **каждое новое наблюдение — config / contract-уровень** (validation / envelope / body shape).

---

## 7. Рекомендации (9-я итерация)

1. **(P2, 10 мин, T9-A)** Добавить `PatchPrepTaskDto` через `nestjs-zod`; заменить `@Body() body: unknown` на `@Body() body: PatchPrepTaskDto`. Открывать OpenAPI-генерацию на этот endpoint.
2. **(P2, 5 мин, T9-B)** Обернуть в envelope: `return { profile: null }` (или явный 404 с кодом `NO_NUTRITION_PROFILE` если предпочтительнее).
3. **(P0, повтор)** 9 P0 продолжают ждать фиксов.

---

## 8. Артефакты (9-я итерация)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-9.md` (коммит ниже) |
| `generateSessionToken` source | `apps/api/src/auth/session-token.ts` |
| `prep-tasks/:taskId` controller | `apps/api/src/meal-plans/meal-plans.controller.ts:80-92` |
| Pantry restore idempotency test | §2 raw output |
| Profile endpoint shapes | §2 raw output |
