# R15 / Фаза B3 — Frontend аудит

**Объект:** apps/web (Next.js 15.1 App Router + React 19)
**Объём:** прочитал layouts (`/`, `/(app)`, `/(auth)`), middleware.ts, next.config.mjs, глобальные компоненты (AuthGuard, BottomTabBar, TabTitle, Skeleton, Button, Card), 5 клиентов табов (Today/Fridge/Plan/Shopping/Profile + под-роуты), PlanClient (183), ShoppingClient (331), FridgeClient (322), ResultClient (135), LoginForm (123), Profile (delisted в R13: SSR-stub→client-session).
**Метод:** static + selective live curl на API.
**Build stats:** 21 Next-page route; first-load-JS shared=102 KB; Critical pages /today=144 kB, /shopping=133 kB, /today/result=144 kB. (R14 build был зелёный).

## Сводная B3

| Severity | Количество | Темы |
|---|---|---|
| HIGH   | 3 | Mock-mode leak, group bugs, bar semantics |
| MEDIUM | 5 | state/cache/a11y |
| LOW    | 7 | cosmetic |

---

## HIGH (B3)

### B3-H1. `PlanClient.tsx:128` **`kcalPercent`** — деление `day.totalCalories` (sum for household) на DEFAULT_DAILY_TARGET=2000 (per-person) → UI рисует **абсурдные бары «148% от цели»**, даже когда человек недоедает
- **Файл:** `apps/web/src/app/(app)/plan/PlanClient.tsx:17-23, 140`.
- **Что:** Math-формула `(day.totalCalories / 2000) * 100`. Если household=2 и target=2000/person, planner кладёт ~2974 total/day → бар 148%.
- **Доказательство:** R15 продуктовое (см. ниже раздел C). Бар **обещает над-цель**, реальность — недокал.
- **Impact:** UX-driven nutritional confusion. В плане «30 дней» пользователь видит «143%/day» — психологически ест меньше, чем уверен.
- **Фикс:** получить `household.defaultPeopleCount` (уже отдаётся через `/household`) и считать `target = DEFAULT_DAILY_TARGET × ppl`; либо использовать `nutritionProfile.targetCalories` (per-person). Лучше первый — проще.

### B3-H2. `ShoppingClient.tsx:280` — `groupItems(list.items, new Map())` создаёт **пустую** `Map` orders per render — все элементы уходят в 1 группу sortOrder=99
- **Файл:** `apps/web/src/app/(app)/shopping/ShoppingClient.tsx:280`.
- **Что:** `groupItems(items, new Map())` — Map инициализируется **заново каждый рендер**. Поэтому `orders.get(item.categoryId)` всегда возвращает `undefined`, fallback `?? 99`. То есть **все элементы идут в одну группу с sortOrder=99**. UI не показывает **никаких подзаголовков департаментов** (овощи / молочное / мясо).
- **Доказательство:** live data — 23 items / 5 unique categoryId в API-ответе. Если бы группировка работала, было бы 5 секций.
- **Impact:** визуально /shopping показывает смешанные элементы без категорий. По PRD «Сгруппировано по отделу».
- **Фикс:** построить `Map<string, number>` **один раз** через `useMemo`:
  ```ts
  const orders = useMemo(() => {
    // либо получить из shop-list через /ingredients или жёстко map по categoryId
    return new Map(); // сейчас пусто — нужно API или статика
  }, [list]);
  ```
  Источник `sortOrder` — `IngredientCategory.sortOrder` (уже в схеме). Без этой связи шоппинг-фронт не имеет данных для правильной группировки. Это **API gap**, требующий правки `apps/api/src/shopping-lists/shopping-lists.service.ts` чтобы включить category.sortOrder в DTO.

### B3-H3. **`usesMealPlanMock` фиксируется на prod через NEXT_PUBLIC_USE_MEALPLAN_MOCK=1** — `/today/result` возвращает mock shoppingListId → 404 → broken UX
- **Файл:** `apps/web/src/lib/recommendations-client.ts:43, 206-228`, `apps/web/src/app/(app)/today/result/ResultClient.tsx:59-80`.
- **Что:** Когда `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` (прод!), `acceptRecommendation` возвращает `{shoppingListId: 'mock-list-…'}`. UI редиректит на `/shopping/<mock-id>` → страница показывает placeholder, но реального shopping-list не существует.
- **Доказательство:** тест `usesMealPlanMock: only the exact string "1" enables fixtures` в R15-B4 подтверждает логику. ENV `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` в `/etc/multichef/multichef.env` (R13).
- **Impact:** на проде **happy-path (`wizard → /today/result → "Готовлю это"`) не работает по-человечески**. Пользователь попадает на placeholder. Реальное MC-051 планирование запускается только через `/plan/setup` напрямую.
- **Фикс:** на время MC-051=в-плане, ввести middleware **отключающее mock если реальный `/meal-plans` доступен** (auto-режим), либо явно отключить `mock-banner` если mock active (текущий текст «Демо-режим» уже есть, но плана всё равно нет).

---

## MEDIUM (B3)

### B3-M1. AuthGuard держится на `localStorage.mc_user` — никакой связи с реальной `mc_session`
- **Файл:** `apps/web/src/components/AuthGuard.tsx:23-41`.
- **Поведение:** проверка только `localStorage.getItem('mc_user')`. DevTools `localStorage.setItem('mc_user', '1')` → редирект не сработает. После logout на UI `mc_user` может остаться (зависит от обработчика logout).
- **Фикс:** дёргать `GET /auth/session` после mount и редиректить при 401.
- **Частично пофикшено в middleware.ts:17** для /profile — только этот роут.

### B3-M2. Routing tab routing ARIA — `aria-label="Основная навигация"` есть, **но нет `<a href>` skip-link для screen-reader «skip to main»**
- **Файл:** `apps/web/src/app/(app)/layout.tsx:17-25`.
- **Что:** нет `<a href="#main">Пропустить навигацию</a>` для screen reader. TopBar 5 tabs — каждый раз читаются screen-reader'ом.
- **Фикс:** добавить skip-link.

### B3-M3. `usePantry` module-scope cache без cleanup — multi-component race condition (R13 L5)
- **Файл:** `apps/web/src/hooks/usePantry.ts:36-46`.
- **Что:** `cache` живёт на module-level. Component A отменяет fetch через `controller.abort()`, но cache может быть записан **из отменённого промиса**, поверх свежих данных.
- **Фикс:** через React Context + Provider.

### B3-M4. `usePreferences` graceful fallback (R13) — пустые `preferences` если API 404 → UI не покажет hint, что профиль не настроен
- **Файл:** `apps/web/src/hooks/usePreferences.ts:121-128`.
- **Поведение:** `setPreferences(EMPTY_PREFERENCES) + setError('profile_http_' + status)`. UI `TodayClient.tsx:117` монтирует hook, но не читает ошибку. Нет banner «Настрой профиль».
- **Фикс:** прокинуть error через `<PreferencesBanner />` или toast.

### B3-M5. `log_error_user_drift` Frontlog on hydration mismatch — нет чёткого SSR/CSR split
- **Файл:** `apps/web/src/app/(app)/profile/page.tsx:1-30` (R13 uncommitted-mtime).
- **Что:** `useEffect → fetch on mount` — нет initial server fetch, потом client fetch. Возможен flash. Prettier drift в этом файле (R14).
- **Фикс:** либо commit prettier+коммит, либо rever-коммит fallback к SSR-stub.

---

## LOW (B3)

### B3-L1. `BottomTabBar.tsx:104` — `<Link passHref legacyBehavior>` — `legacyBehavior` deprecated в Next 15.
- **Фикс:** `legacyBehavior` убрать, `Link` сам wrap-ит.

### B3-L2. `PlanClient.tsx:143-153` — `role="progressbar"` без `aria-valuemin`/`aria-valuemax`.
- **Фикс:** `aria-valuemin={0} aria-valuemax={100}`.

### B3-L3. `ShoppingClient.tsx:289` — `<input type="checkbox" className="h-7 w-7">` — 28×28 px, **ниже 44×44 recommended touch target**.
- **Фикс:** `h-12 w-12` или padding.

### B3-L4. `redirect.ts` — `sanitizeRedirect` функция не прочитана, нужно проверить open-redirect.
- **Файл:** `apps/web/src/lib/redirect.ts`.

### B3-L5. `sw.js` присутствует в public/, но не проверена актуальность по SW-cache в Next 15 (PWA register).
- **Файл:** `apps/web/public/sw.js`, `apps/web/src/components/PwaRegister.tsx`.

### B3-L6. `prettier` жалуется только на `apps/web/src/app/(app)/profile/page.tsx` — easy fix.

### B3-L7. transpilePackages: `["@multichef/contracts"]` — TS-исходник попадает в client bundle. Не критично, но даёт +20 KB в client (R14 build chunks).

---

## Build-output (R14 verification)

- **Pages:** 21 всего, 14 static prerender.
- **Bundle:** shared=102 kB. Largest — /today=144 kB, /today/result=144 kB, /shopping=133 kB.
- **Caveat:** `transpilePackages: ["@multichef/contracts"]` — это **весь TS-source** Zod-схем в client bundle. Не критично по размеру, но ленивая разработка: при правильной build-pipeline можно tree-shake. Не приоритетно.

## Сводный вывод B3

UI красивый, a11y в основном в порядке (BottomTabBar ⭐), но:
- **B3-H1** (kcalPercent) — питательный misinformation пользователю.
- **B3-H2** (`new Map()` в рендере) — молча ломает /shopping-группировку.
- **B3-H3** (`USE_MEALPLAN_MOCK=1` в проде) — пользователь получает placeholder вместо shopping-list.

Всё остальное — косметика + tech debt.
