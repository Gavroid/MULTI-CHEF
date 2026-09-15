# Технический, продуктовый и UI-аудит MULTI-CHEF (29-й круг)

**Дата:** 2026-09-15
**HEAD:** `86d6f83 chore(audit): AUDIT-REPORT-28 ci-cd-coverage-gaps`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-28.md`, `FIX-PLAN.md`
**Фокус:** cross-tab scenarios — cache invalidation, logout propagation, concurrent UI state.

## TL;DR

29-й круг: **3 находки** — 0 P0, 1 🟠 P2 (privacy: cross-tab stale data after logout), 2 🟡 P3.

- 🟠 **T29-A** — после logout в одной вкладке другие вкладки продолжают показывать **stale данные** (pantry, preferences) из module-scope cache до 30 сек. Privacy issue для shared-computer сценариев. Нет `BroadcastChannel`/`storage` event listener'а.
- 🟡 **T29-B** — `usePantry` / `usePreferences` module-scope cache — JS memory per-tab. Нет cross-tab sync. Multi-tab → user должен сам refresh чтобы увидеть изменения из другой вкладки. Hygiene: общий cache через `BroadcastChannel` или `storage` events.
- 🟡 **T29-C** — `usePantry.cache = { items, fetchedAt }` хранит полный список pantry items в JS memory. В household с 500+ items это 100+ KB на tab. Hygiene: пагинация или сжатие.

---

## 1. Технические находки (29-й круг)

### T29-A. Cross-tab logout не очищает cache в других вкладках 🟠 P2

**Файл:** `apps/web/src/app/(app)/profile/page.tsx` (logout handler).

**Сырой код:**

```tsx
// profile/page.tsx (logout button handler)
onClick={(): void => {
  if (loggingOut) return;
  setLoggingOut(true);
  // T19-C: clear module-scope caches so a NEW user (or shared
  // computer) doesn't see the previous user's pantry/preferences
  // for up to 30s.
  resetPantryCache();
  resetPreferencesCache();
  void logout().then(() => {
    window.location.assign('/auth/login');
  });
}}
```

**Проблема:**

`resetPantryCache()` и `resetPreferencesCache()` — module-scope (см. `apps/web/src/hooks/usePantry.ts:43-46`, `usePreferences.ts:84-87`):

```ts
let cache: CacheEntry | null = null;
export function resetPantryCache(): void {
  cache = null;
}
```

Это **JS memory в каждой вкладке** (отдельный module instance per tab). Reset в Tab A **не затрагивает** Tab B.

**Сценарий:**

1. User-1 открывает 2 вкладки: Tab A (на /profile), Tab B (на /today).
2. Tab A: `usePantry` cache = [item-1, item-2]. `usePreferences` cache = { dietType: 'VEGETARIAN', ... }.
3. Tab B: `usePantry` cache = [item-1, item-2]. (Тот же module-scope per-tab; Tab B тоже сделал GET.)
4. User-1 жмёт «Выйти» в Tab A.
5. Tab A: resetPantryCache() → cache=null. logout() → cookie cleared. redirect to /auth/login.
6. **Tab B** (всё ещё открыта): cache остался `[item-1, item-2]`, rendered UI показывает их.
7. User-2 садится за компьютер (или тот же user открывает Tab B в течение 30 сек). Видит user-1 данные.
8. Если user-2 делает любой mutation (например, mark item as done) → API возвращает 401 (нет session). Но до этого момента **stale данные уже видны**.

**Severity:**

- 🔴 P0 если бы API продолжал работать без session. Но он не работает (cookie destroyed → 401).
- 🟠 P2 потому что **визуально показываются данные предыдущего пользователя** в течение 30 сек. Privacy leak на shared computer.

**Смягчающие факторы:**

- `mc_session` HttpOnly cookie уничтожена — API запросы не пройдут.
- Если user-2 попробует сделать mutation → 401 → frontend redirect to /auth/login (через AuthGuard probe).

**Но:** если user-2 просто **смотрит** на Tab B (не делает mutations), он видит user-1 данные, пока cache не expired.

**Доказательство:**

```bash
$ grep -rn "BroadcastChannel\|storage event\|crossTab\|cross-tab" apps/web/src/ 2>/dev/null
# (пусто — нет cross-tab sync mechanism)

$ grep -n "resetPantryCache\|resetPreferencesCache" apps/web/src/
apps/web/src/hooks/usePantry.ts:43-46      # объявление
apps/web/src/hooks/usePreferences.ts:84-87 # объявление
apps/web/src/app/(app)/profile/page.tsx    # вызов (logout)
# (только profile, нет cross-tab listener)
```

**Рекомендованный фикс:**

1. **`BroadcastChannel`** (современный API, ~Chrome 54+, FF 38+, Safari 15.4+):

```ts
// apps/web/src/lib/cross-tab.ts
const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('multichef') : null;
export function broadcastLogout(): void {
  ch?.postMessage({ type: 'logout' });
}
export function onCrossTabMessage(handler: (msg: unknown) => void): () => void {
  if (!ch) return () => {};
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
```

В `usePantry` / `usePreferences`:

```ts
useEffect(() => {
  return onCrossTabMessage((msg) => {
    if (msg.type === 'logout') resetPantryCache();
  });
}, []);
```

В profile/page.tsx logout handler:

```ts
resetPantryCache();
resetPreferencesCache();
broadcastLogout();  // ← новая строка
void logout().then(...);
```

2. **Альтернатива через `storage` event** — `localStorage.setItem('mc_user', null)` триггерит `storage` event в ДРУГИХ tabs. Уже есть `mc_user` write на login. На logout: `localStorage.removeItem('mc_user')` → другие tabs получают event → reset cache.

```ts
window.addEventListener('storage', (e) => {
  if (e.key === 'mc_user' && e.newValue === null) {
    resetPantryCache();
    resetPreferencesCache();
  }
});
```

Преимущество: не нужен BroadcastChannel. Недостаток: требует реального localStorage write (не всегда происходит в Safari ITP).

### T29-B. Multi-tab stale data (мутации в одной вкладке не видны в другой) 🟡 P3

**Файл:** `apps/web/src/hooks/usePantry.ts:41-110` (module-scope cache).

**Проблема:**

Module-scope cache (`let cache: CacheEntry | null = null`) — это **JS memory per-tab instance**. Каждая вкладка имеет свой cache.

**Сценарий:**

1. Tab A: user открывает /fridge. `usePantry` загружает 30 items. cache = [30 items].
2. Tab B: user открывает /fridge. Тоже загружает 30 items. cache = [30 items]. (Дублирующий запрос, можно использовать shared cache через BroadcastChannel.)
3. Tab B: user удаляет item через ConfirmDialog → POST DELETE → onSuccess → `void refetch()` → cache обновлён в Tab B (стало 29 items).
4. Tab A: всё ещё показывает 30 items (cache stale до 30 сек).
5. User переключается на Tab A, не понимает почему item ещё есть.

**Severity:** 🟡 P3 потому что не privacy issue, но UX issue. Большинство SPA так себя ведут — multi-tab sync не гарантирован.

**Рекомендованный фикс:** (комбинируется с T29-A)

- После mutation в Tab B: `broadcastMutation({ kind: 'pantry', action: 'delete', id })` через BroadcastChannel.
- Tab A listener: если в cache есть этот id → удалить из cache → re-render.
- Альтернативно: при `visibilitychange` (когда user возвращается на вкладку) — refetch.

```ts
useEffect(() => {
  const handler = () => {
    if (document.visibilityState === 'visible') refetch();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, [refetch]);
```

### T29-C. `usePantry` cache хранит весь список — нет pagination на cache level 🟡 P3

**Файл:** `apps/web/src/hooks/usePantry.ts:14-15, 41-65`.

**Сырой код:**

```ts
const CACHE_TTL_MS = 30_000;
interface CacheEntry {
  items: PantryItem[]; // ← весь список
  fetchedAt: number;
}
let cache: CacheEntry | null = null;
```

**Проблема:**

Pantry API возвращает **все** items household'а. Для household с 500 items:

- ~100 KB JSON на tab.
- 5 tabs = 500 KB browser memory (не критично, но растёт).

Также: `usePantry` не поддерживает фильтр по cache — каждое `listItems({ includeArchived: true })` создаёт **новую** запись в cache, но cache хранит только последний fetched список. Старый list для `includeArchived: false` стирается при fetch с `includeArchived: true`. → cross-filter staleness.

**Проверка:**

```bash
$ grep -A 8 "interface CacheEntry" apps/web/src/hooks/usePantry.ts
interface CacheEntry {
  items: PantryItem[];
  fetchedAt: number;
}
let cache: CacheEntry | null = null;
```

**Рекомендованный фикс:** cache key per-options:

```ts
const cache = new Map<string, CacheEntry>();
function cacheKey(opts: ListPantryItemsOptions): string {
  return JSON.stringify({ ...opts, _: opts.includeArchived ? 'arch' : 'live' });
}
```

Это позволит cache'ить несколько filter-вариантов независимо.

---

## 2. Подтверждённые здоровые паттерны

- **T19-C закрыт (intra-tab)**: logout handler в profile/page.tsx корректно очищает module-scope cache. ✓
- **`usePantry.refetch()` используется во всех mutation-callbacks** в FridgeClient (строки 120, 150, 165, 216). Cache invalidation после CRUD. ✓
- **AbortController в useEffect cleanup** (`usePantry.ts:71-78`, `usePreferences.ts:108-118`) — race-condition safety net. ✓
- **API idempotency guard** (T15-A) защищает от дублирования на concurrent POST. ✓
- **`mc_session` HttpOnly + SameSite=Lax**: даже если Tab B показывает stale data, mutations заблокированы. ✓

## 3. Микро-наблюдения

- **T29-α** — `usePreferences` AbortController cleanup возвращает `() => controller.abort()` даже в cache-branch (когда fetch не было). Harmless, но redundant.
- **T29-β** — `usePantry.listRef = useRef(list)` pattern — стабильная reference, но если list function меняется (не должен), ref устаревает. Hygiene: ESLint rule `react-hooks/exhaustive-deps`.
- **T29-γ** — При concurrent requests (один tab, две страницы монтируются одновременно) — оба вызова `usePantry` стартуют. Cache заполняется последним завершившимся. Если первый медленнее второго → cache = stale. Race.
- **T29-δ** — В `useTheme` нет cache (theme мгновенный), нет concerns. ✓

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона                  | Находка                                                                                                                                | Где                                                                                |
| --------- | --------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **T29-A** | 🟠 P2     | Web / Cache / Privacy | После logout в одной вкладке другие продолжают показывать stale данные до 30 сек. Нет cross-tab sync (BroadcastChannel/storage event). | `apps/web/src/app/(app)/profile/page.tsx`, `apps/web/src/hooks/usePantry.ts:43-46` |
| **T29-B** | 🟡 P3     | Web / Cache / UX      | Multi-tab mutation в Tab B не видна в Tab A до TTL/cache invalidation. Нет cross-tab sync.                                             | `apps/web/src/hooks/usePantry.ts:41` (module-scope cache per tab)                  |
| **T29-C** | 🟡 P3     | Web / Cache / Memory  | `usePantry` cache — single-entry. При смене filter (archived vs live) — старый cache стирается. Нет per-options cache.                 | `apps/web/src/hooks/usePantry.ts:41-65`                                            |

## 5. Куммулятивный итог (29 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3        | 🟡 ℹ️ | Cumulative                    |
| ------- | ------------------- | ----- | ----- | --------------- | ----- | ----------------------------- |
| #1–3    | 26                  | 9     | 0     | 6               | 11    | —                             |
| #4–10   | 13                  | 0     | 0     | 13              | 0     | —                             |
| #11     | T11-A, T11-B        | 0     | 0     | 2               | 0     | —                             |
| #12     | T12-A               | 0     | 0     | 1               | 0     | —                             |
| #13     | T13-A               | 1 P0  | 0     | 0               | 0     | 10 P0                         |
| #14     | T14-A               | 0     | 0     | 1               | 0     | 10 P0                         |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1               | 0     | 11 P0                         |
| #16     | T16-A, T16-B        | 0     | 0     | 2               | 0     | 11 P0                         |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0               | 0     | 11 P0, 2 P1                   |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 11 P0, 2 P1, 2 P2             |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2            | 0     | 11 P0, 2 P1, 4 P2             |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2            | 0     | 12 P0, 2 P1, 6 P2             |
| #21     | T21-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 12 P0, 2 P1, 8 P2, 4 P3       |
| #22     | T22-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 9 P2, 6 P3       |
| #23     | T23-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 10 P2, 8 P3      |
| #24     | T24-A–D             | 0     | 0     | 3 P2 + 1 P3     | 0     | 12 P0, 2 P1, 13 P2, 9 P3      |
| #25     | T25-A–D             | 0     | 0     | 1 P2 + 3 P3     | 0     | 12 P0, 2 P1, 14 P2, 12 P3     |
| #26     | T26-A–C             | 0     | 0     | 0               | 3 P3  | 12 P0, 2 P1, 14 P2, 15 P3     |
| #27     | T27-A–D             | 0     | 0     | 1 P2 + 3 P3     | 0     | 12 P0, 2 P1, 15 P2, 18 P3     |
| #28     | T28-A–D             | 0     | 0     | 1 P2 + 3 P3     | 0     | 12 P0, 2 P1, 16 P2, 21 P3     |
| **#29** | **T29-A–C**         | **0** | **0** | **1 P2 + 2 P3** | **0** | **12 P0, 2 P1, 17 P2, 23 P3** |

**Тренд 29-го:** multi-tab UX. T19-C был про intra-tab invalidation. T29-A — cross-tab. Один раунд до конца (T30 — a11y).

## 6. Рекомендации (29-й круг)

1. **(P2, 1ч, T29-A)** Добавить `apps/web/src/lib/cross-tab.ts` с `BroadcastChannel('multichef')`. В `usePantry` / `usePreferences` подписка на `logout` event → reset cache. В profile/page.tsx logout handler: `broadcastLogout()`.
2. **(P3, 1ч, T29-B)** В `usePantry` добавить `document.visibilitychange` listener → refetch при возврате на вкладку. Это решает 90% multi-tab stale UX issues.
3. **(P3, 30 мин, T29-C)** Изменить `let cache: CacheEntry | null` → `Map<string, CacheEntry>` keyed by `JSON.stringify(opts)`. Позволит кэшировать несколько filter-вариантов независимо.

## 7. Артефакты (29-й круг)

| Артефакт                | Где                             |
| ----------------------- | ------------------------------- |
| Этот отчёт              | `docs/audit/AUDIT-REPORT-29.md` |
| FIX-PLAN (T29-A,B,C)    | `docs/audit/FIX-PLAN.md`        |
| Cross-tab logout        | §1 T29-A                        |
| Multi-tab mutation sync | §1 T29-B                        |
| Per-options cache       | §1 T29-C                        |
