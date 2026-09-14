# Технический, продуктовый и UI-аудит MULTI-CHEF (20-й круг)

**Дата:** 2026-09-14
**HEAD:** `dd54d4b chore(audit): AUDIT-REPORT-19 web auth-boundary`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-19.md`, `VERIFICATION.md`
**Фокус:** meal-plans service — race-condition аудит, idempotency middleware details, recurring anti-patterns.

## TL;DR

20-й круг: **3 находки** — 1 🔴 P0 (новый) + 2 🟠 P2.

- 🔴 **T20-A — `generatePrepSession` имеет check-then-act race** (3-й паттерн в codebase). Двойной POST → конкурентная запись → P2002 → 500.
- 🟠 **T20-B — `Idempotency-Key` guard только валидирует**, не дедуплицирует. Re-confirmation of T15-A на других endpoints.
- 🟠 **T20-C — `prepTask.create` использует ID = `${sessionId}-t${index}`** — race-window PK conflict при concurrent runs.

---

## 1. Технические находки (20-й круг)

### T20-A. `meal-plans.service.ts:generatePrepSession` — 3-й check-then-act race в codebase 🔴 P0

**Файл:** `apps/api/src/meal-plans/meal-plans.service.ts:90-150`

**Raw:**

```ts
async generatePrepSession(userId: string, intensity: PrepIntensity) {
  const plan = await this.getActivePlanRowOrThrow(userId);
  const prisma = getPrisma();
  const sessionId = `${plan.id}-prep-${intensity}`;
  const existing = await prisma.prepSession.findFirst({
    where: { id: sessionId },
    include: { tasks: { orderBy: { sequence: 'asc' } } },
  });
  if (existing) return /* existing */;

  const { entries, rules } = await this.loadPrepInputs(plan.id);
  // ... build drafts ...

  const session = await prisma.prepSession.upsert({
    where: { id: sessionId },
    create: { /* new */ },
    update: { targetMinutes: ..., intensity },
  });
  await prisma.prepTask.deleteMany({ where: { prepSessionId: session.id } });
  for (const [index, d] of drafts.entries()) {
    await prisma.prepTask.create({
      data: {
        id: `${session.id}-t${index}`,    // ← T20-C PK race
        prepSessionId: session.id,
        title: d.title,
        ...
      },
    });
  }
}
```

**Race sequence (2 concurrent identical POST `/meal-plans/active/prep`):**

| Step | Connection A                                                | Connection B                                                                                    |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1    | `findFirst` → null                                          | `findFirst` → null (concurrent)                                                                 |
| 2    | enters create-path                                          | enters create-path                                                                              |
| 3    | `prepSession.upsert({create:{...}})` → creates row          | ...                                                                                             |
| 4    | ...                                                         | `prepSession.upsert({update:{...}})` → no-op or minor update                                    |
| 5    | `prepTask.deleteMany({prepSessionId:session.id})` → no rows | ...                                                                                             |
| 6    | ...                                                         | `prepTask.deleteMany({prepSessionId:session.id})` → deletes A's tasks!                          |
| 7    | `prepTask.create({id:"X-t0"})` → OK                         | ...                                                                                             |
| 8    | `prepTask.create({id:"X-t1"})` → OK                         | ...                                                                                             |
| 9    | ...                                                         | `prepTask.create({id:"X-t0"})` → **CONFLICT**, PK already exists (A's t0) → throws Prisma P2002 |

**Result:**

- A and B both reach step 7-9.
- A's `for` loop completes (t0..t4 created).
- B's `for` loop: when index=0 → `create({id:"X-t0"})` → conflict because A's t0 was created.
- B's request: 500 Internal Error (P2002 not caught by AppHttpExceptionFilter — falls through to "INTERNAL_ERROR" generic envelope).

**Паттерн становится system-wide anti-pattern:**

| Endpoint                      | Race                                                  | Found in             |
| ----------------------------- | ----------------------------------------------------- | -------------------- |
| `/auth/register`              | `findUnique` → `user.create`                          | T13-A (round 13)     |
| `/profile/preferences`        | `findFirst` → `preference.create`                     | T14-A (round 14)     |
| **`/meal-plans/active/prep`** | **`findFirst` → `upsert`+`deleteMany`+`create` loop** | **T20-A** (round 20) |

**Hotfix (15 мин):**

```ts
async generatePrepSession(userId, intensity) {
  const plan = await this.getActivePlanRowOrThrow(userId);
  const sessionId = `${plan.id}-prep-${intensity}`;
  // Single transaction (Serializable), inside which DELETE+CREATE loop atomically replaced.
  return getPrisma().$transaction(async (tx) => {
    const session = await tx.prepSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        mealPlanId: plan.id,
        scheduledAt: new Date(),
        targetMinutes: INTENSITY_TARGET_MINUTES[intensity],
        intensity,
      },
      update: {
        targetMinutes: INTENSITY_TARGET_MINUTES[intensity],
        intensity,
      },
    });
    await tx.prepTask.deleteMany({ where: { prepSessionId: session.id } });
    const { entries, rules } = await this.loadPrepInputs(plan.id);
    const prepEntries: PrepEntryInput[] = /* ... */;
    const drafts = buildPrepTasks(prepEntries, intensity);
    for (const [index, d] of drafts.entries()) {
      await tx.prepTask.create({
        data: {
          id: `${session.id}-t${index}`,
          prepSessionId: session.id,
          title: d.title,
          ...
        },
      });
    }
    // Return assembled DTO.
  }, { isolationLevel: 'Serializable' });
}
```

Идея: **всё в одной транзакции** → Postgres Serializable Isolation заставляет retry, если row-lock conflict. Это устраняет и T20-A, и T20-C.

---

### T20-B. `Idempotency-Key` guard только валидирует, не дедуплицирует 🟠 P2

**Файл:** `apps/api/src/common/idempotency.ts:30+`

**Raw:**

```ts
// docs/api/conventions.md §4: every state-mutating verb (POST, PUT,
// PATCH, DELETE) MUST carry an `Idempotency-Key` header. This module
// enforces the *presence* and *format* of the header.
//
// Real cache-backed deduplication (24h TTL, request fingerprint
// match, in-flight serialization) is MC-051 work. For MC-010 we
// only validate the header.
```

**Что есть:**

- Header должен существовать (`requireIdempotencyKey`)
- Длина ≥ 16 chars
- Возвращает 400 VALIDATION_ERROR если нет/короткий

**Чего НЕТ:**

- ❌ Хранилище по `Idempotency-Key → response_body` (Redis cache)
- ❌ Fingerprint сравнение (URL + body hash)
- ❌ In-flight serialization (второй request с тем же ключом ждёт)
- ❌ TTL (24 hours)

**Подтверждено ранее (T15-A, round 15):** `/auth/register` с одинаковым `Idempotency-Key` × 2 → 400, 400 (НЕ 409). Это та же проблема.

**Hotfix:** реализовать per-key storage:

```ts
// New module — apps/api/src/common/idempotency-cache.ts
@Injectable()
export class IdempotencyCache implements CanActivate {
  canActivate(ctx) {
    const key = headers['Idempotency-Key'];
    const fp = sha256(method + url + body);
    const cached = await redis.get(`idemp:${key}`);
    if (cached && cached.fp === fp) return cached.response;
    // Mark in-flight, then proceed; on response, write back.
  }
}
```

Redis deps already present (`apps/api/src/jobs/queue-publisher.ts`). MC-050 work.

---

### T20-C. `prepTask.create({id: ${sessionId}-t${index}})` — PK race on concurrent runs 🟠 P2

**Файл:** `apps/api/src/meal-plans/meal-plans.service.ts:135-145`

**Raw:**

```ts
for (const [index, d] of drafts.entries()) {
  await prisma.prepTask.create({
    data: {
      id: `${session.id}-t${index}`,     // ← same string formula in both runs
      prepSessionId: session.id,
      ...
    },
  });
}
```

**The `(index)` is a 0..N counter** derived from JavaScript for-of loop. With two concurrent runs both creating tasks:

- Both use `session.id = "${plan.id}-prep-${intensity}"`
- Both build `session.id-t0`, `session.id-t1`, ...
- **PK on `prepTask.id`**, so collision → P2002.

**Already covered by T20-A's hotfix** (single Serializable transaction eliminates race).

---

## 2. Подтверждённые здоровые паттерны

### ✅ Worker archive+create использует транзакцию правильно

```ts
// apps/worker/src/plan-week.ts:243-261
const planId = await prisma.$transaction(async (tx) => {
  await tx.mealPlan.updateMany({
    where: { householdId, status: 'ACTIVE' },
    data: { status: 'ARCHIVED' },
  });
  const plan = await tx.mealPlan.create({
    data: { ..., status: 'ACTIVE', ... },
  });
  ...
});
```

✅ atomic. ✅ partial unique `one_active_plan` enforces "one ACTIVE per household" at DB level.

### ✅ Idempotency-Key validation работает корректно

- Missing → 400 VALIDATION_ERROR
- Too short → 400 VALIDATION_ERROR (min 16)
- ✅ Header pollution не проходит через.

### ✅ MealPlans `$transaction` архивирует и создает в одной сессии

Полная гарантия T20-A в worker-flow отсутствует; **race возможен только в API-flow** (где собственно `generatePrepSession` живёт).

### ✅ `getStoragePlan` использует read-only flow

```ts
// meal-plans.service.ts:191
async getStoragePlan(userId) {
  const plan = await this.getActivePlanRowOrThrow(userId);
  // Только SELECT, нет мутаций.
}
```

✅ idempotent без site-effects.

---

## 3. Микро-наблюдения

- **T20-D** — `prepSession.upsert` использует `update: { targetMinutes, intensity }` без `mealPlanId`. Это OK, потому что update не должен перезаписывать foreign keys. Но **важно знать**: `mealPlanId` остаётся от первого create-call. Если household меняет план (новый planId через worker), `mealPlanId` всё равно корректен (==planId), но если бы planId менялся без транзакции — drift. OK because session id formula = `${plan.id}-prep-${intensity}` derived from a SPECIFIC plan, so tied.

- **T20-E** — `dashboard` (`/today`) flows also use `getActivePlanRowOrThrow`. If user has no ACTIVE → 404 → UI shows empty state. With partial unique, no two-ACTIVE possibility, но сам по себе `null` from `getActiveForUser` (T16-A, T20-F) **confusing for client-side**.

- **T20-F** — `getActiveForUser` returns RAW `null` when no plan (T8-B/T12-A/T16-A recurrence) → 6th occurrence.

---

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона            | Находка                                                                                                                   | Где                                                     |
| --------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **T20-A** | 🔴 P0     | API/race        | `generatePrepSession` — 3-й check-then-act race (after T13-A register, T14-A preferences). Concurrent POST → P2002 → 500. | `apps/api/src/meal-plans/meal-plans.service.ts:90-150`  |
| **T20-B** | 🟠 P2     | API/idempotency | `Idempotency-Key` guard только валидирует, не дедуплицирует. Confirms T15-A.                                              | `apps/api/src/common/idempotency.ts:8-12`               |
| **T20-C** | 🟠 P2     | API/race        | `prepTask.create({id: ${sessionId}-t${index}})` — PK race при concurrent runs. Часть T20-A.                               | `apps/api/src/meal-plans/meal-plans.service.ts:135-145` |

---

## 5. Куммулятивный итог (20 кругов)

| Iter    | Findings        | 🔴 P0    | 🔴 P1 | 🟠 P2  | 🟡 P3     | Cumulative            |
| ------- | --------------- | -------- | ----- | ------ | --------- | --------------------- |
| #1–3    | 26              | 9        | 0     | 6      | 11        | —                     |
| #4–10   | 13              | 0        | 0     | 13     | 0         | —                     |
| #11     | T11-A, T11-B    | 0        | 0     | 2      | 0         | —                     |
| #12     | T12-A           | 0        | 0     | 1      | 0         | —                     |
| #13     | T13-A           | 1 P0     | 0     | 0      | 0         | 10 P0                 |
| #14     | T14-A           | 0        | 0     | 1      | 0         | 10 P0                 |
| #15     | T15-A, T15-B    | 1 P0     | 0     | 1      | 0         | **11 P0**             |
| #16     | T16-A, T16-B    | 0        | 0     | 2      | 0         | 11 P0                 |
| #17     | T17-A, T17-B    | 0        | 2 P1  | 0      | 0         | 11 P0, 2 P1           |
| #18     | T18-A–D         | 0        | 0     | 2 P2   | 2 P3      | 11 P0, 2 P1, 2 P2     |
| #19     | T19-A, T19-B    | 0        | 0     | 2 P2   | 0         | 11 P0, 2 P1, 4 P2     |
| **#20** | **T20-A, B, C** | **1 P0** | 0     | 2 P2   | 0         | **12 P0, 2 P1, 6 P2** |
| **Σ**   | **~60**         | **12**   | **2** | **32** | **15 P3** | —                     |

**Тренд 20-ти:** **3 check-then-act races** (T13-A, T14-A, **T20-A** — паттерн становится system-wide). P0 count = 12 (1 new this round).

---

## 6. Рекомендации (20-й круг)

1. **(P0, 30 мин, T20-A)** Refactor `generatePrepSession` to single `prisma.$transaction(...,{isolationLevel:'Serializable'})`. Это решит T20-A + T20-C одним fix.
2. **(P0, повтор) T13-A, T14-A, T15-A** остаются нефикшенными. Открыть Refactor-ticket на «Auditing all concurrent POST flows to find missing transactions». Системно — нужно пройти все эндпойнты:
   ```bash
   grep -l "findFirst\|findUnique" apps/api/src --include="*.ts" -r | xargs grep -l "create\|upsert\|update" apps/api/src --include="*.ts"
   ```
3. **(P2, 1-2 дня, T20-B)** Реализовать IdempotencyCache поверх Redis с TTL=24h, fingerprint=URL+body+key.
4. **(P2, 10 мин, T20-C)** Можно заменить `id: ${session.id}-t${index}` на UUID/ULID через `generateUlid()` — исключить PK collision по построению.
5. **(P2, повтор) T19-A, T19-B** — AuthGuard/middleware mismatch не зафикшены.
6. **(P1, повтор) T17-A — schema-drift** `one_active_plan` миграция не отражена в schema.prisma.

---

## 7. Артефакты (20-й круг)

| Артефакт                                                 | Где                             |
| -------------------------------------------------------- | ------------------------------- |
| Этот отчёт                                               | `docs/audit/AUDIT-REPORT-20.md` |
| `meal-plans.service.ts:90-150` raw race                  | §1 T20-A                        |
| `prepTask.create` PK formula                             | §1 T20-C                        |
| `idempotency.ts:8-12` comment about MC-051               | §1 T20-B                        |
| worker `plan-week.ts:243-261` correct atomic transaction | §2                              |

---

## 8. Финал кругов 11–20

| Метрика                                             | Значение                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Кругов проведено                                    | 10                                                                                                                                               |
| Всего новых находок                                 | ~24 (T11-A, T11-B, T12-A, T13-A, T14-A, T15-A, T15-B, T16-A, T16-B, T17-A, T17-B, T18-A, T18-B, T18-C, T18-D, T19-A, T19-B, T20-A, T20-B, T20-C) |
| Из них 🔴 P0 race-conditions                        | **4** (T13-A, T15-A, T15-B, **T20-A**)                                                                                                           |
| Из них 🔴 P1 schema/config drift                    | 2 (T17-A, T17-B)                                                                                                                                 |
| Из них 🟠 P2 observability / web auth / idempotency | 6 (T18-A/B, T19-A/B, T20-B/C)                                                                                                                    |
| Из них 🟡 P3 hygiene / dead-code                    | 5+ (T11-B, T16-B, T18-C/D, T19-F)                                                                                                                |
| Зафикшено                                           | 0 (все остаются in-flight)                                                                                                                       |
| Конкурентный race-pattern                           | recurring в 3 endpoints → system-wide                                                                                                            |

**Аудит-команда рекомендует:**

- 🔴 Недельный sprint: закрыть T13-A, T15-A, T15-B, T20-A одной темой «concurrent POST safety».
- 🟠 Спринт-2: idempotency-cache в Redis, schema-drift fix, web auth-boundary cleanup.
- 🟡 Background: log verbosity, dead-code, hygiene.
