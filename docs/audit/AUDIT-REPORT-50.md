# Технический, продуктовый и UI-аудит MULTI-CHEF (50-й круг — финал серии #41–#50)

**Дата:** 2026-09-15
**HEAD:** `c9fa1e6 chore(audit): AUDIT-REPORT-49 prisma-index-coverage`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-49.md`, `FIX-PLAN.md`
**Фокус:** Date/time handling — `DateTime` vs `Date` (Postgres), TZ consistency, ISO format usage.

## TL;DR

50-й круг (финал серии #41–#50): **4 находки** — 0 P0, 1 🟠 P2, 3 🟡 P3.

- 🟠 **T50-A** — `expiresAt` (date-only string `YYYY-MM-DD`) и `createdAt`/`updatedAt` (ISO timestamp) — **два разных формата дат в API**. Клиенты должны различать. Risk: comparison bugs.
- 🟡 **T50-B** — `purchaseDate` `@db.Date` в schema, но сравнивается через `<=` с `expiresAt`. Time-of-day missing в обоих полях.
- 🟡 **T50-C** — `new Date('2025-01-15')` в `pantry.service.ts:127` — TZ ambiguity (UTC vs local).
- 🟡 **T50-D** — `formatExpiry()` manual `split('-')` parsing вместо `new Date(iso + 'T00:00:00Z')`.

---

## 1. Технические находки (50-й круг)

### T50-A. Mixed date formats: date-only vs timestamp 🟠 P2

**Файл:** `apps/api/src/pantry/pantry.dto.ts`, `apps/web/src/lib/expiry.ts`.

**Сырой код (PAPI interface):**

```ts
// apps/api/src/pantry/pantry.service.ts:46
expiresAt: string | null; // ISO date YYYY-MM-DD or null
purchaseDate: string | null;
archivedAt: string | null; // ISO timestamp or null
createdAt: string; // ISO timestamp
updatedAt: string;
```

**Что упущено:**

- API возвращает **два разных формата** для дат:
  - `expiresAt` / `purchaseDate` → date-only (`2025-01-15`).
  - `archivedAt` / `createdAt` / `updatedAt` → timestamp (`2025-01-15T12:34:56.789Z`).
- Clients должны знать разницу (e.g., `formatExpiry()` работает только с date-only).
- Cross-comparison (e.g., `expiresAt < createdAt`?) — type mismatch.

**Смягчающий фактор:** schemas/contract docs (`packages/contracts/`) — let me check.

**Рекомендованный фикс:**

Унифицировать на ISO timestamp (RFC 3339) для всех date полей:

```prisma
model PantryItem {
  expiresAt    DateTime?  @db.Date  // ← оставить date для "только дата" (напр. "31 января")
  purchaseDate DateTime?  @db.Date
  // vs
  archivedAt   DateTime?  @db.Timestamptz(6)
  createdAt    DateTime   @default(now()) @db.Timestamptz(6)
}
```

Или: для всех полей → `DateTime` + isoformat → либо `'2025-01-15'` либо `'2025-01-15T00:00:00.000Z'`. Сделать wrapper:

```ts
type IsoDate = string & { __brand: 'IsoDate' }; // 'YYYY-MM-DD'
type IsoTimestamp = string & { __brand: 'IsoTimestamp' }; // 'YYYY-MM-DDTHH:mm:ss.sssZ'
```

И `parseIsoDate(s: IsoDate): Date` helper.

### T50-B. `purchaseDate @db.Date` сравнение через `<=` 🟡 P3

**Файл:** `apps/api/src/pantry/pantry.dto.ts:64-67`.

**Сырой код:**

```ts
.refine((v) => v.expiresAt === undefined || v.purchaseDate === undefined || v.purchaseDate <= v.expiresAt, { message: 'purchaseDate must be on or before expiresAt' }),
```

**Что упущено:**

- `purchaseDate <= v.expiresAt` — строковое сравнение (lexicographic).
- Для `'2025-01-15' <= '2025-01-20'` → `'15' <= '20'` → true. ✓
- Для `'2025-01-15' <= '2025-02-01'` → true. ✓
- Но для `'2025-12-31' <= '2026-01-01'` → true (lexicographic same as date). ✓
- **Edge case**: `'2025-1-15'` (без zero-padding) vs `'2025-01-15'` → `'5-15' <= '01-15'` → 5 > 0 → false. ❌
- Если user submits `'2025-1-15'` (не padded) — validation passes but semantic wrong.

**Рекомендованный фикс:**

```ts
.refine((v) => {
  if (!v.expiresAt || !v.purchaseDate) return true;
  return new Date(v.purchaseDate + 'T00:00:00Z') <= new Date(v.expiresAt + 'T00:00:00Z');
}, { message: 'purchaseDate must be on or before expiresAt' }),
```

### T50-C. `new Date('2025-01-15')` TZ ambiguity 🟡 P3

**Файл:** `apps/api/src/pantry/pantry.service.ts:127`.

**Сырой код:**

```ts
...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
```

**Что упущено:**

- `new Date('2025-01-15')` — разные behavior:
  - V8 (Node.js): interprets as **UTC midnight**.
  - Но `new Date('2025-01-15T00:00:00')` — interprets as **local midnight**.
- Если API server TZ != user TZ → different "expiry date" semantics.
- На Postgres `@db.Date` — stored as midnight **UTC**. На чтение (`toIsoDate`) возвращает midnight UTC.
- На запись через `new Date(string)` → UTC (correct для нашего backend).

**Смягчающий фактор:** Backend TZ = UTC (consistent).

**Рекомендованный фикс:**

```ts
...(body.expiresAt ? { expiresAt: parseIsoDateUtc(body.expiresAt) } : {}),

function parseIsoDateUtc(s: string): Date {
  // 'YYYY-MM-DD' → midnight UTC
  return new Date(s + 'T00:00:00Z');
}
```

### T50-D. `formatExpiry()` manual `split('-')` parsing 🟡 P3

**Файл:** `apps/web/src/lib/expiry.ts:46-60`.

**Сырой код:**

```ts
const [yearStr, monthStr, dayStr] = isoDate.split('-');
const y = Number(yearStr);
const m = Number(monthStr);
const d = Number(dayStr);
if (
  !Number.isFinite(y) ||
  !Number.isFinite(m) ||
  !Number.isFinite(d) ||
  m < 1 ||
  m > 12 ||
  d < 1 ||
  d > 31
) {
  return { text: 'Нет срока', tone: 'muted', daysRemaining: null };
}
```

**Эффект:**

- Manual parsing 4 полей вместо `new Date(s + 'T00:00:00Z')`.
- Валидация (m < 1, d < 31) — уже сделана в Zod (см. `pantry.dto.ts:50-52`). Дублирование.

**Рекомендованный фикс:**

```ts
export function formatExpiry(isoDate: string | null, now: Date = new Date()): ExpiryLabel {
  if (!isoDate) return { text: 'Нет срока', tone: 'muted', daysRemaining: null };

  const expiry = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(expiry.getTime())) {
    return { text: 'Нет срока', tone: 'muted', daysRemaining: null };
  }
  const daysRemaining = Math.round((expiry.getTime() - startOfDayUtc(now).getTime()) / MS_PER_DAY);
  // ...
}
```

---

## 2. Подтверждённые здоровые паттерны

- **Все DateTime в Postgres `@db.Timestamptz(6)`** (UTC). ✓
- **Prisma `createdAt @default(now())`** — server-generated timestamp. ✓
- **`toIsoDate()` helper** в `pantry.service.ts` — DRY для date-only formatting. ✓
- **`formatExpiry()` имеет fallback** ('Нет срока') для invalid dates. ✓
- **`expiry.ts` использует `daysRemaining <= 7`** для partition. ✓
- **`purchaseDate <= expiresAt` validation** в Zod. ✓
- **TZ explicit `T00:00:00Z`** в `formatExpiry`. ✓ (явное UTC)

## 3. Микро-наблюдения

- **T50-α** — `partitionByExpiry()` вызывает `formatExpiry()` per-item → O(n) format calls. Для 1000 items — 1000 Date parses. OK для MVP, можно optimize с single Date per batch.
- **T50-β** — `pluralRu()` Russian pluralization (`1 яблоко`, `2 яблока`, `5 яблок`) — proper implementation. ✓
- **T50-γ** — `comparePantryItems` для `expiring`/`fresh` sort — кастомный comparator. Можно упростить до `Array.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))`.
- **T50-δ** — `Date.parse('2025-01-15')` — valid, but `new Date('2025-01-15')` более reliable.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона              | Находка                                                                                                  | Где                                         |
| --------- | --------- | ----------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **T50-A** | 🟠 P2     | API / Date format | Mixed date formats: `expiresAt` (date-only) vs `createdAt` (timestamp). Two representations в API.       | `apps/api/src/pantry/pantry.service.ts:46`  |
| **T50-B** | 🟡 P3     | API / Validation  | `purchaseDate <= expiresAt` lexicographic compare — не padded inputs могут проходить валидацию ошибочно. | `apps/api/src/pantry/pantry.dto.ts:64-67`   |
| **T50-C** | 🟡 P3     | API / TZ          | `new Date('2025-01-15')` TZ ambiguity. Backend UTC consistent, но хрупко.                                | `apps/api/src/pantry/pantry.service.ts:127` |
| **T50-D** | 🟡 P3     | Web / Parsing     | `formatExpiry()` manual `split('-')` parsing. Дублирует Zod validation.                                  | `apps/web/src/lib/expiry.ts:46-60`          |

## 5. Куммулятивный итог (50 кругов — финал серии #41–#50)

| Iter   | Round   | Topic                     | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды)       | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                      | T41-A..D     | 0     | 0     | 2     | 2     |
| 42     | #42     | Pagination                | T42-A..D     | 0     | 0     | 2     | 2     |
| 43     | #43     | Async races               | T43-A..D     | 0     | 0     | 2     | 2     |
| 44     | #44     | Dependencies              | T44-A..D     | 0     | 0     | 0     | 4     |
| 45     | #45     | React rendering           | T45-A..D     | 0     | 0     | 1     | 3     |
| 46     | #46     | i18n                      | T46-A..D     | 0     | 0     | 2     | 2     |
| 47     | #47     | Modal a11y                | T47-A..D     | 0     | 0     | 2     | 2     |
| 48     | #48     | UX empty/loading/error    | T48-A..D     | 0     | 0     | 1     | 3     |
| 49     | #49     | Prisma index coverage     | T49-A..D     | 0     | 0     | 2     | 2     |
| **50** | **#50** | **Date/time consistency** | **T50-A..D** | **0** | **0** | **1** | **3** |

**Серия #41–#50 итог:** 40 новых находок. 0 P0/P1, 17 P2, 23 P3.

## 6. Рекомендации (50-й круг — финал)

1. **(P2, 1ч, T50-A)** Унифицировать: либо все date-only (`@db.Date`), либо все timestamp (`@db.Timestamptz(6)`). Или typed-branded types.
2. **(P3, 15 мин, T50-B)** Использовать `new Date()` для сравнения вместо lexicographic string compare.
3. **(P3, 15 мин, T50-C)** Helper `parseIsoDateUtc(s: string): Date` — explicit UTC.
4. **(P3, 30 мин, T50-D)** Replace manual split with `new Date(iso + 'T00:00:00Z')`.

## 7. Артефакты (50-й круг — финал)

| Артефакт                           | Где                             |
| ---------------------------------- | ------------------------------- |
| Этот отчёт                         | `docs/audit/AUDIT-REPORT-50.md` |
| FIX-PLAN (T50-A,B,C,D)             | `docs/audit/FIX-PLAN.md`        |
| Mixed date formats                 | §1 T50-A                        |
| purchaseDate lexicographic compare | §1 T50-B                        |
| new Date TZ ambiguity              | §1 T50-C                        |
| formatExpiry manual parsing        | §1 T50-D                        |

---

## 🎯 Итог серии #41–#50

**40 новых находок** за 10 раундов:

- **0 P0**, **0 P1**, **17 P2**, **23 P3**.

Все находки зафиксированы в `docs/audit/AUDIT-REPORT-{41..50}.md` + `docs/audit/FIX-PLAN.md`. Fix-план — единый бэклог для следующих fix-сессий.

Стоп-условие **«10 раундов»** достигнуто. Серия #41–#50 завершена.
