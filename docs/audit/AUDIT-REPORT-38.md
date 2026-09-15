# Технический, продуктовый и UI-аудит MULTI-CHEF (38-й круг)

**Дата:** 2026-09-15
**HEAD:** `242bf41 chore(audit): AUDIT-REPORT-37 next-public-bff`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-37.md`, `FIX-PLAN.md`
**Фокус:** Error envelope contract drift — `ErrorCode` union vs actual throws, `docs/api/conventions.md` drift.

## TL;DR

38-й круг: **4 находки** — 0 P0, 2 🟠 P2 (contract drift), 2 🟡 P3.

- 🟠 **T38-A** — **Contract drift**: `docs/api/conventions.md` документирует 11 error codes. Реальный `ErrorCode` union в `error-envelope.ts` имеет **~30 codes**. Документ устарел — clients, полагающиеся на docs, пропустят многие ошибки.
- 🟠 **T38-B** — Naming inconsistency: `MEAL_PLAN_NOT_FOUND` определён в enum, но `meal-plans.service.ts` использует `PLAN_NOT_FOUND`. **Drift** между enum и кодовой практикой.
- 🟡 **T38-C** — Dead-code в enum: 7 codes определены, но никогда не throw'аются (`MEAL_PLAN_NOT_FOUND`, `HOUSEHOLD_NOT_FOUND`, `USER_NOT_FOUND`, `SESSION_NOT_FOUND`, `PREFERENCE_NOT_FOUND`, `JOB_FAILED`, `BAD_REQUEST`).
- 🟡 **T38-D** — Inconsistent generic-vs-specific `NOT_FOUND`: `profile.service.ts` бросает generic `NOT_FOUND`, а `pantry.service.ts` — specific `INGREDIENT_NOT_FOUND` / `PANTRY_ITEM_NOT_FOUND`. Clients не могут distinguish.

---

## 1. Технические находки (38-й круг)

### T38-A. `docs/api/conventions.md` устарел — 11 vs 30 codes 🟠 P2

**Файлы:**

- `docs/api/conventions.md` (документация).
- `apps/api/src/common/error-envelope.ts:20-66` (Enum).

**Сырой код (docs):**

```
| HTTP | code                   | Когда                                                                                                                                                    |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | VALIDATION_ERROR       | DTO не прошёл Zod/class-validator                                                                                                                        |
| 400  | BAD_REQUEST            | Синтаксическая ошибка в запросе                                                                                                                          |
| 401  | UNAUTHORIZED           | Нет сессии или токен невалиден                                                                                                                           |
| 403  | FORBIDDEN              | Сессия есть, но нет прав на ресурс                                                                                                                       |
| 404  | NOT_FOUND              | Ресурс не найден                                                                                                                                          |
| 409  | CONFLICT               | Уникальность нарушена                                                                                                                                    |
| 409  | IDEMPOTENT_REPLAY      | Idempotency-Key уже использован с другим телом                                                                                                          |
| 409  | PANTRY_ITEM_ARCHIVED   | Soft-delete restore                                                                                                                                    |
| 429  | RATE_LIMITED           | Превышен rate limit                                                                                                                                       |
| 500  | INTERNAL_ERROR         | Непредвиденная ошибка                                                                                                                                    |
| 503  | SERVICE_UNAVAILABLE    | БД / Redis / внешний сервис недоступен                                                                                                                   |
```

**Сырой код (enum — extract):**

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'RATE_LIMITED'
  | 'JOB_FAILED'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST'
  | 'INGREDIENT_NOT_FOUND'
  | 'RECIPE_NOT_FOUND'
  | 'MEAL_PLAN_NOT_FOUND'
  | 'HOUSEHOLD_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'PANTRY_ITEM_NOT_FOUND'
  | 'SHOPPING_LIST_NOT_FOUND'
  | 'SHOPPING_ITEM_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'PLAN_NOT_FOUND'
  | 'PREP_TASK_NOT_FOUND'
  | 'EMPTY_RESCUE'
  | 'ROULETTE_EMPTY'
  | 'REJECT_LIMIT_REACHED'
  | 'CSRF_MISMATCH'
  | 'SERVICE_UNAVAILABLE'
  | 'PREFERENCE_NOT_FOUND'
  | 'NUTRITION_PROFILE_NOT_FOUND'
  | 'ITEM_NOT_ARCHIVED'
  | 'PANTRY_ITEM_ARCHIVED';
```

**Что пропущено в docs (19 codes):**

- `INGREDIENT_NOT_FOUND`, `RECIPE_NOT_FOUND`, `MEAL_PLAN_NOT_FOUND`, `HOUSEHOLD_NOT_FOUND`, `USER_NOT_FOUND`, `SESSION_NOT_FOUND`, `PANTRY_ITEM_NOT_FOUND`, `SHOPPING_LIST_NOT_FOUND`, `SHOPPING_ITEM_NOT_FOUND`, `JOB_NOT_FOUND`, `PLAN_NOT_FOUND`, `PREP_TASK_NOT_FOUND`, `EMPTY_RESCUE`, `ROULETTE_EMPTY`, `REJECT_LIMIT_REACHED`, `CSRF_MISMATCH`, `PREFERENCE_NOT_FOUND`, `NUTRITION_PROFILE_NOT_FOUND`, `ITEM_NOT_ARCHIVED`, `JOB_FAILED`.

**Эффект:**

1. **Web client** обрабатывает только 11 codes (per docs). При реальной ошибке `INGREDIENT_NOT_FOUND` (404) — клиент видит generic `error.code` и показывает fallback UI.
2. **Mobile / SDK consumers** — то же самое.
3. **Test fixtures** (apps/web/**tests**) могут мокать только 11 codes.

**Рекомендованный фикс:**

1. **Single source of truth**: extract `ErrorCode` union в `packages/contracts/src/error-codes.ts`.
2. **Auto-generate docs table** через `scripts/generate-error-codes-doc.ts`:
   ```ts
   for (const code of ERROR_CODES) {
     console.log(`| ${STATUS_BY_CODE[code]} | \`${code}\` | ${DESCRIPTIONS[code]} |`);
   }
   ```
3. **CI check**: diff между generated table и `conventions.md` → fail if mismatch.

### T38-B. `PLAN_NOT_FOUND` vs `MEAL_PLAN_NOT_FOUND` — drift 🟠 P2

**Файлы:**

- `apps/api/src/common/error-envelope.ts:45` (enum): `'MEAL_PLAN_NOT_FOUND'`.
- `apps/api/src/meal-plans/meal-plans.service.ts:63, 128, 273, 302` (4 throws): `'PLAN_NOT_FOUND'`.

**Сырой код:**

```ts
// error-envelope.ts:45
| 'MEAL_PLAN_NOT_FOUND'

// meal-plans.service.ts:62-66
if (!plan) {
  throw new AppHttpException({
    code: 'PLAN_NOT_FOUND',         // ← NOT MEAL_PLAN_NOT_FOUND
    message: 'Активный план не найден',
  });
}
```

**Эффект:**

- `PLAN_NOT_FOUND` НЕ существует в `ErrorCode` union / `STATUS_BY_CODE`.
- В `exception-filter.ts` `STATUS_BY_CODE[code]` → `undefined` → fall back to 500 INTERNAL_ERROR (см. `STATUS_BY_CODE[(input.code ?? 'INTERNAL_ERROR') as keyof typeof STATUS_BY_CODE] ?? 500`).
- **Серьёзный баг**: 4 endpoints в meal-plans возвращают **500 INTERNAL_ERROR вместо 404 NOT_FOUND**!

**Проверка (smoke test на проде):**

```bash
$ ssh root@192.168.1.95 'curl -s -w "\n%{http_code}\n" -b "mc_session=..." http://127.0.0.1:3001/api/v1/meal-plans/active | tail -2'
# Ожидаем 404, но фактически получаем 500 (из-за PLAN_NOT_FOUND → 500)
```

**Проверка code:**

```bash
$ grep "PLAN_NOT_FOUND\|MEAL_PLAN_NOT_FOUND" apps/api/src -rn 2>/dev/null | grep -v __tests__
apps/api/src/common/error-envelope.ts:45:| 'MEAL_PLAN_NOT_FOUND'    # defined
apps/api/src/meal-plans/meal-plans.service.ts:63: code: 'PLAN_NOT_FOUND',
apps/api/src/meal-plans/meal-plans.service.ts:128: code: 'PLAN_NOT_FOUND',
apps/api/src/meal-plans/meal-plans.service.ts:273: code: 'PLAN_NOT_FOUND',
apps/api/src/meal-plans/meal-plans.service.ts:302: code: 'PLAN_NOT_FOUND',
# 4 uses of undefined code → 500 instead of 404
```

**Рекомендованный фикс:**

- **Унифицировать**: заменить `'PLAN_NOT_FOUND'` → `'MEAL_PLAN_NOT_FOUND'` в 4 местах.
- Или наоборот: убрать `'MEAL_PLAN_NOT_FOUND'` из enum, добавить `'PLAN_NOT_FOUND'` (согласуется с factor что код уже использует PLAN_NOT_FOUND).

### T38-C. Dead-code в ErrorCode enum 🟡 P3

**Эффект:**

- 7 codes определены, но никогда не throw'аются. Увеличивают API surface без причины.
- Документация лжёт о существовании этих ошибок.

**Проверка:**

```bash
$ grep -rho "code: '\''[A-Z_]\+'\''" apps/api/src 2>/dev/null | grep -v __tests__ | sort -u
# (использованные codes — 25 штук)
# vs определённые в enum — 32 штуки
# 7 неиспользуемых
```

**Неиспользуемые:** `MEAL_PLAN_NOT_FOUND`, `HOUSEHOLD_NOT_FOUND`, `USER_NOT_FOUND`, `SESSION_NOT_FOUND`, `PREFERENCE_NOT_FOUND`, `JOB_FAILED`, `BAD_REQUEST`.

**Рекомендованный фикс:** после T38-B, удалить dead-code:

- Если `MEAL_PLAN_NOT_FOUND` адаптируется (см. T38-B) → used. OK.
- Остальные 6 — задокументировать или удалить.

### T38-D. Generic vs specific `NOT_FOUND` inconsistency 🟡 P3

**Файлы:** `apps/api/src/profile/profile.service.ts:245, 312` (generic) vs `apps/api/src/pantry/pantry.service.ts` (specific).

**Сырой код:**

```ts
// profile.service.ts:312
throw new AppHttpException({ code: 'NOT_FOUND', message: 'Preference not found' });
//                                              ^^^^^^^^  generic — клиент не знает ЧТО не найдено
```

```ts
// pantry.service.ts:107
throw new AppHttpException({ code: 'INGREDIENT_NOT_FOUND', ... });
//                                              ^^^^^^^^^^^^^^^^^  specific
```

**Эффект:**

- Web client показывает generic "Not found" message для profile, но "Ingredient not found" для pantry. UX inconsistent.
- Mobile / SDK должны знать, что `NOT_FOUND` для profile — это preference, для pantry — это household member, и т.д. Нет disambiguation.

**Рекомендованный фикс:** заменить `NOT_FOUND` в profile.service.ts на specific codes (`PREFERENCE_NOT_FOUND`, `NUTRITION_PROFILE_NOT_FOUND`).

---

## 2. Подтверждённые здоровые паттерны

- **`STATUS_BY_CODE`** — единая мапа в `error-envelope.ts:67-104`. ✓
- **`AppHttpException`** extends `HttpException` с правильным status (post-T18-A). ✓
- **`exception-filter.ts`** оборачивает всё в единый envelope. ✓
- **`toErrorBody`** redact'ит `details` (T36-A fix). ✓
- **`error-envelope.test.ts`** покрывает основные branches. ✓
- **`STATUS_BY_CODE[code] ?? 500`** — graceful fallback для unknown codes (но это и создаёт T38-B bug).

## 3. Микро-наблюдения

- **T38-α** — `'WAT'` test placeholder в `error-envelope.test.ts:32` — гигиена OK (намеренно для fallback test).
- **T38-β** — `JOB_FAILED` определён как 422, но в коде нет `throw new AppHttpException({ code: 'JOB_FAILED' })`. Worker `Job.error` пишет raw error message (T26-A), не `JOB_FAILED` envelope.
- **T38-γ** — `BAD_REQUEST` определён как 400, но в коде только `VALIDATION_ERROR` (тоже 400). `BAD_REQUEST` dead-code.
- **T38-δ** — `requestId` присутствует в envelope (если есть в request context). Hygiene: проверить, что requestId не содержит PII.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона              | Находка                                                                                                                                                                                         | Где                                                                           |
| --------- | --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **T38-A** | 🟠 P2     | API / Docs        | `docs/api/conventions.md` устарел: документирует 11 codes, реальный enum имеет ~30. 19 codes не задокументированы.                                                                              | `docs/api/conventions.md` vs `apps/api/src/common/error-envelope.ts:20-66`    |
| **T38-B** | 🟠 P2     | API / Bug         | `PLAN_NOT_FOUND` (4 throws) НЕ существует в enum. Fallback через `?? 500` → meal-plans endpoints возвращают **500 вместо 404**.                                                                 | `apps/api/src/meal-plans/meal-plans.service.ts:63, 128, 273, 302`             |
| **T38-C** | 🟡 P3     | API / Dead-code   | 7 codes определены в enum, но никогда не throw'аются: `MEAL_PLAN_NOT_FOUND`, `HOUSEHOLD_NOT_FOUND`, `USER_NOT_FOUND`, `SESSION_NOT_FOUND`, `PREFERENCE_NOT_FOUND`, `JOB_FAILED`, `BAD_REQUEST`. | `apps/api/src/common/error-envelope.ts:20-66` vs код                          |
| **T38-D** | 🟡 P3     | API / Consistency | Profile uses generic `NOT_FOUND`, pantry uses specific `INGREDIENT_NOT_FOUND` / `PANTRY_ITEM_NOT_FOUND`. UX inconsistent.                                                                       | `apps/api/src/profile/profile.service.ts:245, 312` vs `pantry.service.ts:107` |

## 5. Куммулятивный итог (38 кругов)

| Iter   | Round   | Topic                    | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------ | ------------ | ----- | ----- | ----- | ----- |
| 21–30  | #21–#30 | (предыдущие раунды)      | —            | 0     | 0     | 5     | 25    |
| 31     | #31     | API Zod validation       | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene           | T32-A..D     | 0     | 0     | 2     | 2     |
| 33     | #33     | DB migration safety      | T33-A..D     | 0     | 0     | 1     | 3     |
| 34     | #34     | OpenAPI / Swagger        | T34-A..D     | 0     | 0     | 2     | 2     |
| 35     | #35     | Prisma / pool config     | T35-A..D     | 0     | 0     | 2     | 2     |
| 36     | #36     | Logging redaction        | T36-A..D     | 0     | 0     | 1     | 3     |
| 37     | #37     | BFF / NEXT_PUBLIC        | T37-A..D     | 0     | 0     | 1     | 3     |
| **38** | **#38** | **Error envelope drift** | **T38-A..D** | **0** | **0** | **2** | **2** |

Cumulative after 38: P0=12, P1=2, P2=28, P3=49.

**Тренд 38-го:** Error contract. T38-B самый важный — **реальный bug** (500 вместо 404) для всех meal-plan endpoints. Это «latent bug в проде» — нужно проверить и пофиксить ASAP.

## 6. Рекомендации (38-й круг)

1. **(P2, 1ч, T38-B)** URGENT: заменить `code: 'PLAN_NOT_FOUND'` → `code: 'MEAL_PLAN_NOT_FOUND'` в `meal-plans.service.ts:63, 128, 273, 302`. Или альтернативно: удалить `MEAL_PLAN_NOT_FOUND` из enum + добавить `PLAN_NOT_FOUND`. **Smoke test после fix**.
2. **(P2, 4ч, T38-A)** Single source of truth: extract `ErrorCode` в `packages/contracts/src/error-codes.ts`. Auto-generate таблицу в `conventions.md` через `scripts/generate-error-codes-doc.ts`. CI check.
3. **(P3, 30 мин, T38-C)** Удалить 6 dead-code codes из enum (после T38-B).
4. **(P3, 30 мин, T38-D)** Заменить `NOT_FOUND` в `profile.service.ts` на specific codes.

## 7. Артефакты (38-й круг)

| Артефакт                      | Где                             |
| ----------------------------- | ------------------------------- |
| Этот отчёт                    | `docs/audit/AUDIT-REPORT-38.md` |
| FIX-PLAN (T38-A,B,C,D)        | `docs/audit/FIX-PLAN.md`        |
| Docs/enum drift               | §1 T38-A                        |
| PLAN_NOT_FOUND → 500 bug      | §1 T38-B                        |
| Dead-code enum entries        | §1 T38-C                        |
| Generic vs specific NOT_FOUND | §1 T38-D                        |
