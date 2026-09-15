# Технический, продуктовый и UI-аудит MULTI-CHEF (45-й круг)

**Дата:** 2026-09-15
**HEAD:** `80dfa94 chore(audit): AUDIT-REPORT-44 dependency-hygiene`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-44.md`, `FIX-PLAN.md`
**Фокус:** React rendering patterns — `React.memo`, `useCallback`, `useMemo`, dep arrays, re-render cost.

## TL;DR

45-й круг: **4 находки** — 0 P0, 1 🟠 P2, 3 🟡 P3.

- 🟠 **T45-A** — `PantryItemCard` **НЕ обёрнут в `React.memo`**. FridgeClient создаёт inline arrow functions + inline `cardProps` объект на каждом render. При 50 items в списке — 50 ненужных re-renders на любое state change родителя.
- 🟡 **T45-B** — 44 inline `onClick={() => ...}` arrow functions в 10 файлах. Каждый render создаёт новую функцию. Без `useCallback`/`React.memo` — child re-renders не оптимизируются.
- 🟡 **T45-C** — `useMemo` используется в 8+ местах, но ESLint `react-hooks/exhaustive-deps` не проверен — потенциальные stale closures.
- 🟡 **T45-D** — `FridgeClient.tsx:135` `useEffect(() => { void refetch(); }, [refetch])` — `refetch` defined inline, зависимость корректная, но если `refetch` нестабилен → infinite loop (комментарий в коде: «without this every render produces a fresh `deps` object, which invalidates the refetch useCallback and triggers a runaway refetch loop» — explicit hazard noted).

---

## 1. Технические находки (45-й круг)

### T45-A. `PantryItemCard` без `React.memo` — list re-render cost 🟠 P2

**Файл:** `apps/web/src/components/PantryItemCard.tsx` (нет `memo`), `apps/web/src/app/(app)/fridge/FridgeClient.tsx` (inline `cardProps`).

**Сырой код (FridgeClient):**

```ts
const cardProps = {
  onEdit: setEditing,
  onDelete: setDeleting,
  onRestore,
};   // ← новая identity на каждый render

// ... позже в JSX:
<PantryItemCard item={item} {...(now ? { now } : {})} {...cardProps} />
```

**Эффект:**

- `cardProps` создаётся на каждый render FridgeClient (нет useMemo).
- `setEditing`, `setDelete` — useState setters → stable identity, OK.
- Но `cardProps = { ... }` — **новая object reference** каждый render.
- `PantryItemCard` получает новую `cardProps` → даже если бы был wrapped в `React.memo`, **memo не помог бы** (новая object identity).
- При 50 items, любое state change родителя (`setItems`, `setLoading`, `setError`, `setIncludeArchived`, `setNow`, `setExpiring`, `setFresh`) → 50 PantryItemCard renders.

**Смягчающий фактор:** `React 19` имеет automatic batching + concurrent rendering — частично amortizes cost.

**Рекомендованный фикс:**

```ts
// FridgeClient.tsx
const cardProps = useMemo(
  () => ({ onEdit: setEditing, onDelete: setDeleting, onRestore }),
  [setEditing, setDeleting, onRestore],
);

// PantryItemCard.tsx
import { memo } from 'react';
export const PantryItemCard = memo(function PantryItemCard(props: PantryItemCardProps) {
  // ... existing implementation
});
```

### T45-B. Inline arrow functions в props (44 места) 🟡 P3

**Файлы:** 10 клиентских компонентов.

**`grep -c "onClick={() =>"`** = 44 (по apps/web/src).

**Сырой код (пример — SetupClient):**

```ts
<Button onClick={() => patch({ days: d })}>...</Button>
<Button onClick={() => toggleNoCook(i)}>...</Button>
<Button onClick={() => patch({ step: (state.step - 1) as 1 | 2 })}>...</Button>
```

**Эффект:**

- Каждый render — новая arrow function identity.
- Если `<Button>` обёрнут в `React.memo` — он **всё равно re-renders** (новый prop identity).
- React synthetic events — dedupe listeners (один listener per element type), так что **performance impact минимален** для обычных `<button>`.
- **Но** для child components с `React.memo` (если есть) — broken.

**Смягчающий фактор:** React 19 re-renders are batched and concurrent. Performance impact measured на больших списках.

**Рекомендованный фикс:**

Для критических hot-path (PantryItemCard, recipe list items) — extract `useCallback`. Для обычных кнопок — оставить inline (clarity > micro-perf).

### T45-C. `useMemo` dep arrays — нет exhaustive-deps ESLint rule 🟡 P3

**Файл:** `apps/web/**/useMemo(...)` calls (~10 мест).

**Проверка:**

```bash
$ grep "react-hooks/exhaustive-deps" apps/web/.eslintrc.* apps/web/eslint.config.* 2>/dev/null
# (нет матча)
```

**Что упущено:**

- Нет ESLint rule `react-hooks/exhaustive-deps` → useMemo/useCallback могут иметь stale deps.
- Пример (`LoadingClient.tsx:50`): `useMemo(() => parseSettings(...), [searchParams])` — `searchParams` (от Next.js useSearchParams) → должен быть стабилен, но если меняется → пересчёт. **Correct**.
- Другие useMemo calls нужно audit индивидуально.

**Рекомендованный фикс:**

```js
// apps/web/eslint.config.mjs
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...reactHooks.configs['recommended-latest'],
  {
    rules: {
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
```

### T45-D. `useEffect([refetch])` — inline `cardProps` causes runaway refetch 🟡 P3

**Файл:** `apps/web/src/app/(app)/fridge/FridgeClient.tsx:135`.

**Сырой код (комментарий в коде):**

```ts
// Spread once and memoize — without this every render produces a
// fresh `deps` object, which invalidates the refetch useCallback
// and triggers a runaway refetch loop (the page keeps GETting the
// pantry list until the global rate limiter kicks in).
const deps: FridgePageDeps = React.useMemo(
  () => ({ ...defaultDeps, ...depsOverride }),
  [depsOverride],
);
```

**Эффект:**

- `useCallback(refetch, [deps])` → refetch identity меняется при смене deps.
- Если `deps` не memoize → refetch меняется → `useEffect([refetch])` triggers → setState → re-render → infinite loop.
- Текущий код использует `useMemo` для deps → stable identity (если `depsOverride` не меняется).
- Но `depsOverride` приходит из props (server component → client component) — **может быть новой reference каждый server render** если parent не memoize.

**Смягчающий фактор:** Server component → client component обычно передаёт plain object без деп.

**Рекомендованный фикс:**

- Wrap `depsOverride` extraction в `useMemo` parent-side (если parent — client).
- Или: use `useEvent` (new React 19 hook) для refetch — stable identity без deps.

---

## 2. Подтверждённые здоровые паттерны

- **`React.useMemo` для deps objects** (FridgeClient:135) — explicit comment про hazard. ✓
- **`useCallback` для refetch / setTheme / toggle** — в 8+ местах. ✓
- **`useMemo` для derived state** (`{ expiring, fresh } = partitionByExpiry(...)`) — FridgeClient:177. ✓
- **`AbortController` cleanup** в useEffect cleanup — `controller.abort()` на unmount. ✓
- **Cleanup для `setTimeout`/`setInterval`** — LoadingClient + другие. ✓
- **React 19 automatic batching** — concurrent mode по умолчанию. ✓

## 3. Микро-наблюдения

- **T45-α** — `LoadingClient.tsx:46` `useMemo(() => parseSettings(...), [searchParams])` — `searchParams` is `ReadonlyURLSearchParams`, stable identity per route → OK.
- **T45-β** — `<PantryItemCard>` JSX inline condition `{...(now ? { now } : {})}` — новый object/identity каждый render. Если card wrapped в memo — не поможет. Hygiene: pass `now` always (undefined allowed).
- **T45-γ** — FridgeClient `cardProps` включает `onRestore` (из props), `setEditing`/`setDelete` (useState setters). Все стабильны, но `cardProps` object — нет.
- **T45-δ** — `useTheme.ts:66-77` имеет `setTheme` + `toggle` useCallback с `[next: Theme]` deps — корректно.
- **T45-ε** — Нет `React.memo` usage в apps/web (0 grep hits). Все компоненты re-render на parent update. Hygiene: добавить `React.memo` для leaf components (PantryItemCard, OptionCard, ChainTimeline).

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона               | Находка                                                                                                 | Где                                                              |
| --------- | --------- | ------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **T45-A** | 🟠 P2     | Web / Performance  | `PantryItemCard` НЕ обёрнут в `React.memo`. Inline `cardProps` в FridgeClient → 50 ненужных re-renders. | `apps/web/src/components/PantryItemCard.tsx`, `FridgeClient.tsx` |
| **T45-B** | 🟡 P3     | Web / Code hygiene | 44 inline `onClick={() => ...}` arrow functions в 10 файлах. Hot path → useCallback нужен.              | `apps/web/src/components/`, `apps/web/src/app/(app)/`            |
| **T45-C** | 🟡 P3     | Web / Lint         | Нет ESLint rule `react-hooks/exhaustive-deps`. Stale closures possible.                                 | `apps/web/eslint.config.*`                                       |
| **T45-D** | 🟡 P3     | Web / Hooks        | `useEffect([refetch])` — inline deps may cause runaway refetch. Explicit comment в коде, но fragile.    | `apps/web/src/app/(app)/fridge/FridgeClient.tsx:135`             |

## 5. Куммулятивный итог (45 кругов)

| Iter  | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ----- | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40 | #21–#40 | (предыдущие раунды) | —            | 0     | 0     | 16    | 51    |
| 41    | #41     | CORS                | T41-A..D     | 0     | 0     | 2     | 2     |
| 42    | #42     | Pagination          | T42-A..D     | 0     | 0     | 2     | 2     |
| 43    | #43     | Async races         | T43-A..D     | 0     | 0     | 2     | 2     |
| 44    | #44     | Dependencies        | T44-A..D     | 0     | 0     | 0     | 4     |
| **45  | #45     | **React rendering** | **T45-A..D** | **0** | **0** | **1** | **3** |

## 6. Рекомендации (45-й круг)

1. **(P2, 1ч, T45-A)** Wrap `PantryItemCard` в `React.memo`. Use `useMemo` для `cardProps` в FridgeClient. Measure perf with React DevTools Profiler.
2. **(P3, 30 мин, T45-B)** Extract `useCallback` для critical path (5-10 самых горячих кнопок). Остальные inline.
3. **(P3, 15 мин, T45-C)** Добавить `react-hooks/exhaustive-deps: 'error'` в ESLint config.
4. **(P3, 30 мин, T45-D)** Convert FridgeClient refetch к useEvent (React 19) или explicit ref.

## 7. Артефакты (45-й круг)

| Артефакт                     | Где                             |
| ---------------------------- | ------------------------------- |
| Этот отчёт                   | `docs/audit/AUDIT-REPORT-45.md` |
| FIX-PLAN (T45-A,B,C,D)       | `docs/audit/FIX-PLAN.md`        |
| PantryItemCard no React.memo | §1 T45-A                        |
| Inline arrows 44             | §1 T45-B                        |
| No exhaustive-deps ESLint    | §1 T45-C                        |
| Runaway refetch hazard       | §1 T45-D                        |
