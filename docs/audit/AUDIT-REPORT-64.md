# Технический, продуктовый и UI-аудит MULTI-CHEF (64-й круг)

**Дата:** 2026-09-15
**Область:** Error handling / HTTP status code consistency
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

Глобальный `AppHttpExceptionFilter` (60+ использований
`AppHttpException`) аккуратно маппит доменные коды в HTTP-статусы
через `STATUS_BY_CODE` в `common/error-envelope.ts`. Сильная
сторона — закрытый enum `ErrorCode` и явная таблица соответствия.

Слабые стороны:

1. **Generic 403** для «no owned household» вместо специфичного
   `NO_OWNED_HOUSEHOLD` — клиент не может отличить «залогинен, но
   не овнер household'а» от «не залогинен».
2. **Worker errors** летят как 500 / 422 без маппинга на доменные
   коды; фронт не различает «retry» vs «show empty state».
3. **`STATUS_BY_CODE` fallback = 500** при опечатке в коде или при
   добавлении нового кода без обновления таблицы. Нет статической
   проверки типа «`ErrorCode` keys ⊆ `STATUS_BY_CODE` keys».
4. **`isUniqueConstraintOn`** ловит только P2002. P2025 / P2003 /
   P2014 пробрасываются как 500 INTERNAL_ERROR.

---

## Технические находки (64-й круг)

### T64-A · 🟠 P2 — Generic `FORBIDDEN` (403) скрывает причину «нет household»

**Где:** `apps/api/src/pantry/pantry.service.ts:295-308`,
`apps/api/src/shopping-lists/shopping-lists.service.ts:341-347`,
`apps/api/src/meal-plans/meal-plans.service.ts:390-?`.

**Симптом.** В каждом сервисе есть приватный
`requireOwnedHouseholdId`:

```ts
if (!membership) {
  throw new AppHttpException({
    code: 'FORBIDDEN',
    message: 'No owned household for this user',
  });
}
```

Семантически это **не** `FORBIDDEN` (у пользователя есть права —
он аутентифицирован, просто не имеет household). Корректный код
— `NO_OWNED_HOUSEHOLD` (403, но специфичный). Клиент сейчас не
может отличить:

- «Сессия истекла» (`UNAUTHORIZED` / 401)
- «Залогинен, но не имеет household» (должно быть 403 с
  `NO_OWNED_HOUSEHOLD` → UI должен показать "Создайте household")
- «Не owner чужого household» (должно быть 403 с `NOT_HOUSEHOLD_OWNER`)

Все три случая мапятся в один `FORBIDDEN`/`403` с одним message.

**Почему важно.** Фронт делает грубые switch по HTTP-статусу:
«403 → редирект на /login». Это работает только для первого
случая. В остальных пользователь видит generic «доступ запрещён».

**Гипотеза фикса.**

```ts
// error-envelope.ts — добавить в enum:
| 'NO_OWNED_HOUSEHOLD'
| 'NOT_HOUSEHOLD_OWNER'
// + STATUS_BY_CODE: { NO_OWNED_HOUSEHOLD: 403, NOT_HOUSEHOLD_OWNER: 403 }

// в pantry.service.ts:
if (!membership) {
  throw new AppHttpException({
    code: 'NO_OWNED_HOUSEHOLD',
    message: 'User has no owned household',
  });
}
```

UI на фронте получает `code: 'NO_OWNED_HOUSEHOLD'` → рендерит
CTA «Создайте первую семью».

---

### T64-B · 🟠 P2 — Worker errors не мапятся на доменные коды

**Где:** `apps/worker/src/plan-week.ts:243`,
`apps/worker/src/recommendations/pick-top3.ts:129,186`,
`apps/api/src/jobs/jobs.service.ts` (читает `Job.error` без маппинга).

**Симптом.**

```ts
// plan-week.ts:243
if (result.metrics.filled === 0) {
  throw new Error('ROULETTE_EMPTY: planner produced no meals for the given setup');
}
// pick-top3.ts:129
throw new Error('no passed recipes to fill FROM_PANTRY slot');
// pick-top3.ts:186
throw new Error('no passed recipes to fill CHAIN slot');
```

Все три случая попадают в `mirror.setError(jobId, err.message)`
(см. **T59-B**), сохраняются в `Job.error`. Клиент получает
`GET /jobs/:id` → `{ status: 'FAILED', error: '...' }`. Если
`error` начинается с «ROULETTE_EMPTY:» — UI не знает, что это
`ROULETTE_EMPTY` (нужен UI «рецепты не подобраны, попробуйте
расширить фильтры»), иначе — generic 500-стиль ошибка.

**Почему важно.** Пользователь видит «произошла ошибка» вместо
осмысленного сообщения, не понимает, что делать дальше. Для
`ROULETTE_EMPTY` и `EMPTY_RESCUE` есть готовые коды в `ErrorCode`
enum, но они никогда не испускаются воркером.

**Гипотеза фикса.** Завести error taxonomy в воркере:

```ts
// worker/src/errors.ts
export class PlannerError extends Error {
  constructor(public code: 'ROULETTE_EMPTY' | 'EMPTY_RESCUE' | 'PLANNER_CONFLICT', message: string) {
    super(message);
  }
}
// mirror.setError:
catch (err) {
  const code = err instanceof PlannerError ? err.code : 'INTERNAL_ERROR';
  await mirror.setError(jobId, err.message, code);
}
```

И `Job.errorCode String?` колонка + `mirror.setError(jobId, message, code)`.

---

### T64-C · 🟡 P3 — `STATUS_BY_CODE` fallback = 500 без статической проверки

**Где:** `apps/api/src/common/error-envelope.ts:60-110`,
`apps/api/src/common/exception-filter.ts:35`.

**Симптом.**

```ts
// exception-filter.ts:35
const status =
  STATUS_BY_CODE[(input.code ?? 'INTERNAL_ERROR') as keyof typeof STATUS_BY_CODE] ?? 500;
super({ code: input.code ?? 'INTERNAL_ERROR', message: input.message, ... }, status);
```

Если разработчик добавил новый код в `ErrorCode` enum, но
забыл — или опечатался — запись в `STATUS_BY_CODE`, то
`STATUS_BY_CODE[code]` = `undefined` → fallback 500.

**Нет статической проверки**, что `keyof STATUS_BY_CODE` ⊇
`ErrorCode`. CI не ловит рассинхрон.

**Почему важно.** При добавлении нового кода легко получить
«логически 404, но физически 500». Клиент не понимает причины.

**Гипотеза фикса.** TypeScript-level exhaustiveness check через
discriminated union:

```ts
type AssertExhaustive<T extends Record<ErrorCode, number>> = T;
export const STATUS_BY_CODE: AssertExhaustive<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400, ...
};
```

Если кто-то добавит код в `ErrorCode` без записи в `STATUS_BY_CODE`,
TypeScript ругается: «Property 'NEW_CODE' is missing». Это zero-cost
runtime, чисто compile-time.

---

### T64-D · 🟡 P3 — `prisma-errors.ts` ловит только P2002

**Где:** `apps/api/src/common/prisma-errors.ts:11-21`.

**Симптом.**

```ts
export function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' && ...
  );
}
```

В Prisma есть ещё:

- `P2025` — «An operation failed because it depends on one or more
  records that were required but not found» (record not found in
  update/delete). Сейчас пробрасывается как 500.
- `P2003` — «Foreign key constraint failed on the field» (insert
  с несуществующим FK). 500.
- `P2014` — «The change you are trying to make would violate the
  required relation» (cascade conflict). 500.
- `P2016` / `P2017` — query parsing errors (баг в коде). 500.

**Почему важно.** Например, `update` несуществующего `pantryItem` →
`P2025` → 500 → клиент показывает «Internal server error», хотя
фактически это 404. Маппинг этих кодов на 404 / 409 / 422 дал бы
корректные ответы.

**Гипотеза фикса.** Расширить `prisma-errors.ts`:

```ts
export function mapPrismaError(err: unknown): AppHttpException | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (err.code) {
    case 'P2002':
      return new AppHttpException({ code: 'CONFLICT', message: 'Unique constraint' });
    case 'P2025':
      return new AppHttpException({ code: 'NOT_FOUND', message: 'Record not found' });
    case 'P2003':
      return new AppHttpException({ code: 'CONFLICT', message: 'Foreign key violation' });
    case 'P2014':
      return new AppHttpException({ code: 'CONFLICT', message: 'Relation violation' });
    default:
      return null;
  }
}
```

И в каждом сервисе — обёртка `try/catch { throw mapPrismaError(e) ?? e; }`.

---

## Подтверждённые здоровые паттерны

- `STATUS_BY_CODE` — **закрытый** `Record<ErrorCode, number>`, не
  string→number map, не допускает опечаток в _ключах_.
- `redactSecrets` (упомянут в exception-filter.ts:60-66) — secret-
  shaped ключи в error payloads scrub'ятся перед журналированием.
- `metric_5xx path=… code=…` (exception-filter.ts:96-99) — greppable
  marker для будущего Prometheus-экспортёра.
- 60+ использований `AppHttpException` в API — единая точка
  выбрасывания доменных ошибок, никаких ad-hoc `throw new
HttpException(...)`.
- `JOB_FAILED: 422` в `STATUS_BY_CODE` — корректный статус для
  business-logic ошибок воркера.

---

## Сводка таблицой (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                            | Файл / место                                     |
| ----- | --- | ---- | ----------------------------------------------------------------- | ------------------------------------------------ |
| T64-A | 🟠  | P2   | Generic `FORBIDDEN` (403) для «нет household». Клиент не отличает | apps/api/src/pantry/pantry.service.ts:295-308,   |
|       |     |      | «залогинен» vs «нет household» vs «не owner»                      | shopping-lists/shopping-lists.service.ts:341-347 |
| T64-B | 🟠  | P2   | Worker errors (`ROULETTE_EMPTY`, `EMPTY_RESCUE`) не мапятся на    | apps/worker/src/plan-week.ts:243,                |
|       |     |      | доменные коды. UI видит generic 500-стиль ошибку                  | recommendations/pick-top3.ts:129,186             |
| T64-C | 🟡  | P3   | `STATUS_BY_CODE` fallback = 500 при опечатке в коде. Нет          | apps/api/src/common/error-envelope.ts:60-110,    |
|       |     |      | compile-time exhaustiveness check                                 | exception-filter.ts:35                           |
| T64-D | 🟡  | P3   | `prisma-errors.ts` ловит только P2002. P2025/P2003/P2014          | apps/api/src/common/prisma-errors.ts:11-21       |
|       |     |      | пробрасываются как 500                                            |                                                  |

---

## Куммулятивный итог (64 круга)

- **Всего найдено проблем:** 256 (T21–T64).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  144 · 🟡 P3: 86.
- **Раунды с нулевыми находками:** 0 из 64.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33), observability /
  healthchecks (26), DB indexes (4), error handling (4 — новый
  раунд), money (19).

---

## Рекомендации (64-й круг)

1. **T64-A — на этой неделе.** Добавить `NO_OWNED_HOUSEHOLD` /
   `NOT_HOUSEHOLD_OWNER` в enum, заменить generic `FORBIDDEN`.
2. **T64-B — на этой неделе.** Воркер: error taxonomy + колонка
   `Job.errorCode String?` + маппинг на UI.
3. **T64-C — на спринт.** `AssertExhaustive<Record<ErrorCode,
number>>` для compile-time проверки.
4. **T64-D — на спринт.** `mapPrismaError` с обработкой P2002 /
   P2025 / P2003 / P2014.

---

## Артефакты (64-й круг)

- `docs/audit/AUDIT-REPORT-64.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T64-A…T64-D.
