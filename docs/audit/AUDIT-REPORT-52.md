# Технический, продуктовый и UI-аудит MULTI-CHEF (52-й круг)

**Дата:** 2026-09-15
**HEAD:** `439d57d chore(audit): AUDIT-REPORT-51 healthchecks`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-51.md`, `FIX-PLAN.md`
**Фокус:** Decimal arithmetic / money handling (kopecks), currency consistency, formatKopecks duplication.

## TL;DR

52-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T52-A** — `formatKopecks` duplicated в `BudgetProgress.tsx` и `ShoppingClient.tsx`. DRY violation.
- 🟠 **T52-B** — `SetupClient` UI input / API storage: user вводит "1500" → `*100 = 150000 kopecks`. Edge cases: float input loses precision.
- 🟡 **T52-C** — Currency stored separately per Household AND ShoppingList. Если user меняет household currency — old lists stay RUB. Нет conversion.
- 🟡 **T52-D** — `Math.round(kopecks / 100)` — int/100 in JS is float division. Loss of precision for kopecks < 100.

---

## 1. Технические находки (52-й круг)

### T52-A. `formatKopecks` duplicated в 2+ файлах 🟠 P2

**Файл:** `apps/web/src/app/(app)/today/components/BudgetProgress.tsx:19`, `apps/web/src/app/(app)/shopping/ShoppingClient.tsx:52`.

**Сырой код:**

```ts
// BudgetProgress.tsx:19
export function formatKopecks(kopecks: number): string {
  const rubles = Math.round(kopecks / 100);
  // ...
}

// ShoppingClient.tsx:52
export function formatKopecks(kopecks: number): string {
  return `₽${Math.round(kopecks / 100)}`;
}
```

**Эффект:**

- DRY violation — два copies.
- Если format изменится (e.g., `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })`) — нужно обновить 2+ файла.
- Risk: subtle inconsistency (e.g., `BudgetProgress` может использовать другую логику rounding).

**Рекомендованный фикс:**

Создать `apps/web/src/lib/money.ts`:

```ts
const RU_LOCALE = 'ru-RU';

export function formatKopecks(kopecks: number, currency = 'RUB'): string {
  const rubles = kopecks / 100;
  return new Intl.NumberFormat(RU_LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rubles);
}

export function kopecksToRubles(kopecks: number): number {
  return kopecks / 100;
}

export function rublesToKopecks(rubles: number): number {
  return Math.round(rubles * 100);
}
```

### T52-B. UI money input precision loss 🟠 P2

**Файл:** `apps/web/src/app/(app)/plan/setup/SetupClient.tsx:244`.

**Сырой код:**

```tsx
value={state.targetBudgetKopecks ? state.targetBudgetKopecks / 100 : ''}
```

**Что упущено:**

- UI shows budget in RUB (`/ 100`).
- User enters "1500" → state stays at `150000` (in kopecks) — but display rounds to "1500 ₽".
- User enters "1500.50" → input is a string. If parsed as number: `1500.5` → state? Не сохраняет копейки правильно.
- Если user edits in display units but stored in kopecks — conversion at save time can lose precision.

**Рекомендованный фикс:**

```tsx
const onBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const rubles = parseFloat(e.target.value);
  if (Number.isFinite(rubles)) {
    patch({ targetBudgetKopecks: rublesToKopecks(rubles) });
  }
};

<input
  type="number"
  step="1" // или "0.01" для дробной части
  value={state.targetBudgetKopecks ? kopecksToRubles(state.targetBudgetKopecks) : ''}
  onChange={onBudgetChange}
/>;
```

### T52-C. Currency stored separately per Household + ShoppingList 🟡 P3

**Файл:** `packages/database/prisma/schema.prisma` (Household + ShoppingList).

**Сырой код:**

```prisma
model Household {
  // ...
  currency String @default("RUB") @db.VarChar(3)
}
model ShoppingList {
  // ...
  currency String @default("RUB") @db.VarChar(3)
}
```

**Что упущено:**

- Household.currency = "RUB" → ShoppingList.currency = "RUB" (default).
- Если admin changes household currency to "USD":
  - Новые ShoppingList будут "RUB" (default, не inherited).
  - Старые ShoppingList — "RUB" (stored value).
  - **Нет currency conversion** — `ShoppingList.estimatedTotalKopecks` в RUB, отображается как USD.
- Если multi-currency поддерживается — фича не complete.

**Смягчающий фактор:** Только RUB используется для MVP. Currency field — future-proofing.

**Рекомендованный фикс:**

```prisma
// Drop ShoppingList.currency — inherit from Household via query
model ShoppingList {
  // remove currency field
}
```

Или explicit currency conversion при display.

### T52-D. `Math.round(kopecks / 100)` — int/100 float division 🟡 P3

**Файл:** multiple `formatKopecks` implementations.

**Сырой код:**

```ts
const rubles = Math.round(kopecks / 100);
```

**Что упущено:**

- `kopecks` is Int. `kopecks / 100` в JS = float division.
- `199 kopecks / 100 = 1.99` → `Math.round = 2`. ✓
- `100 kopecks / 100 = 1` → `Math.round = 1`. ✓
- `99 kopecks / 100 = 0.99` → `Math.round = 1`. **WRONG** (99 kopecks = 0.99 ₽, should display "1" или "0.99"?).
- `1 kopeck / 100 = 0.01` → `Math.round = 0`. **WRONG** (loses 1 kopeck).

**Рекомендованный фикс:**

```ts
export function formatKopecks(kopecks: number): string {
  // Use Intl.NumberFormat для правильного rounding и formatting.
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: kopecks % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(kopecks / 100);
}
```

---

## 2. Подтверждённые здоровые паттерны

- **`@db.Int` для money** (kopecks). Никогда не `Float`. ✓
- **`budgetWeekKopecks: z.number().int().nonnegative().max(10_000_000_000)`** — upper bound 100M RUB. ✓
- **Single source of truth**: kopecks в DB, display в RUB через `/ 100`. ✓
- **`Currency` is VARCHAR(3)** для ISO 4217 codes. ✓
- **Money не передаётся через float** — везде `Int` или `number` (TS number = float64, но для kopecks values < 2^53 safe). ✓

## 3. Микро-наблюдения

- **T52-α** — `recipes.mappers.ts:153` `Math.round(price * (ri.grams.toNumber() / 100))` — multiplication precision. OK for normal ranges.
- **T52-β** — `profile/page.tsx:101` `Math.round(budgetWeekKopecks / 100) ₽/нед` — inline conversion. Should use shared helper.
- **T52-γ** — `ShoppingClient.tsx:267` — `−₽${Math.round(p.savingKopecks / 100)}` — uses `−` Unicode minus (en-dash). OK.
- **T52-δ** — `recommendations.ts` использует `kopecks` consistently. ✓

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона               | Находка                                                                                     | Где                                                                                               |
| --------- | --------- | ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **T52-A** | 🟠 P2     | Web / DRY          | `formatKopecks` duplicated в `BudgetProgress.tsx` и `ShoppingClient.tsx`. DRY violation.    | `apps/web/src/app/(app)/today/components/BudgetProgress.tsx:19`, `shopping/ShoppingClient.tsx:52` |
| **T52-B** | 🟠 P2     | Web / UX           | `SetupClient` UI money input / API storage precision. Edge case: float input loses копейки. | `apps/web/src/app/(app)/plan/setup/SetupClient.tsx:244`                                           |
| **T52-C** | 🟡 P3     | DB / Currency      | Currency stored per Household AND ShoppingList. Нет conversion. Future multi-currency gap.  | `packages/database/prisma/schema.prisma` (Household + ShoppingList)                               |
| **T52-D** | 🟡 P3     | Web / Money format | `Math.round(kopecks / 100)` — int/100 float division. Loss precision for < 100 kopecks.     | `apps/web/src/app/(app)/today/components/BudgetProgress.tsx:20`, `shopping/ShoppingClient.tsx:53` |

## 5. Куммулятивный итог (52 кругов)

| Iter   | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–51  | #21–#51 | (предыдущие раунды) | —            | 0     | 0     | 35    | 76    |
| **52** | **#52** | **Money / kopecks** | **T52-A..D** | **0** | **0** | **2** | **2** |

## 6. Рекомендации (52-й круг)

1. **(P2, 1ч, T52-A)** Создать `apps/web/src/lib/money.ts` с `formatKopecks`, `kopecksToRubles`, `rublesToKopecks`. Удалить дубликаты.
2. **(P2, 1ч, T52-B)** SetupClient: use `rublesToKopecks` для сохранения. Validate input precision (0.01 step для дробной части).
3. **(P3, 30 мин, T52-C)** Plan: drop `ShoppingList.currency`, inherit from Household. Или doc-comment о future.
4. **(P3, 30 мин, T52-D)** Replace `Math.round(kopecks / 100)` с `Intl.NumberFormat`.

## 7. Артефакты (52-й круг)

| Артефакт                 | Где                             |
| ------------------------ | ------------------------------- |
| Этот отчёт               | `docs/audit/AUDIT-REPORT-52.md` |
| FIX-PLAN (T52-A,B,C,D)   | `docs/audit/FIX-PLAN.md`        |
| formatKopecks duplicated | §1 T52-A                        |
| UI money input precision | §1 T52-B                        |
| Currency per-list        | §1 T52-C                        |
| kopecks/100 precision    | §1 T52-D                        |
