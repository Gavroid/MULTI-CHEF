# R15 / Фаза C — Продуктовый / UX аудит

**Объект:** 5 главных табов (Сегодня / Холодильник / План / Покупки / Профиль) + под-роуты + auth flow + landing/design.
**Метод:** static read + 5 live прогонов planWeek (R13) + 4 e2e (R15). Без браузерной сессии (нет возможности управлять Web с этой Hermes-сессии).

## Сводная C

| Severity | Кол-во | Темы |
|---|---|---|
| **БЛОКЕРЫ** (ломают основной флоу) | 4 | Mock-mode leak, broken grouping, kcal bar, auth drift |
| HIGH (UX) | 5 | Empty/onboarding/error states |
| MEDIUM | 7 | a11y copy, mobile-first edge, recovery |
| LOW | 6 | cosmetic |

---

## 🚨 БЛОКЕРЫ (C-Block)

### C-Block-1. **`USE_MEALPLAN_MOCK=1` в проде — happy-path "wizard → /today/result → 'Готовлю это'" → /shopping/<placeholder>, не реальный план**
- **Подтверждение:**
  - `apps/web/src/lib/recommendations-client.ts:206-228` — если env=1, возвращает mock.
  - `/etc/multichef/multichef.env` — `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` (R13).
  - `tests/e2e/happy-today.spec.ts:14` — e2e тестирует этот поток через mock. То есть e2e никогда не проверит реальный план.
- **Что это значит:** Пользователь видит «3 варианта», кликает «Готовлю это», попадает на placeholder `/shopping/<mock-id>`. Реального shopping list не существует. Это **misleading UX**.
- **Фикс:** либо снять mock (если MC-051 готов), либо провести user через прямой `/plan/setup` flow (это уже работает).
- **Severity:** 🚨 БЛОКЕР (R13/R15)

### C-Block-2. **`ShoppingClient.tsx:280` `groupItems(items, new Map())` ломает группировку «по департаментам» — все элементы в одной группе**
- См. **B3-H2**. Live: 23 items / 5 categories на UI одна группа.
- **Что значит:** Шоппинг-экран нарушает PRD §2.3.14 «items grouped by department».
- **Severity:** 🚨 БЛОКЕР (B3)

### C-Block-3. **`PlanClient.tsx:128` `kcalPercent(totalCalories / 2000)` — UI показывает «148% от цели» когда реально недоедание на 25%**
- См. **B3-H1**. Реальный план записывает **per-day-total** (для всей семьи), а target в UI **per-person** (2000).
- **Что значит:** Пользователь видит план «всё ок» / «перевыполняешь норму», реально недоедает. Это **питательная misinformation**.
- **Severity:** 🚨 БЛОКЕР (B3)

### C-Block-4. **`AuthGuard` client-side, держится на localStorage `mc_user` — после logout, при нарушенной синхронизации, UI может показывать «залогинен»** (R13 M1)
- **Что значит:** в race-периоде AuthGuard могу redirect slow; UI отобразит «/today» с React-state, но API-вызовы 401.
- **Severity:** 🚨 БЛОКЕР

---

## HIGH (UX)

### C-H1. **Wizard `parsePrefill` принимает `URGENT` в query string** — но UI /today не показывает никакого banner-сигнала о prefill
- **Файл:** `apps/web/src/app/(app)/today/generate/WizardClient.tsx`.
- **Что:** при использовании /today/QuickScenarios → wizard pre-fill, пользователь уже выбрал, но в wizard есть «свежие» defaults.
- **Фикс:** show subtle "преднастройки применены" badge.

### C-H2. **Empty-state в shopping после onboarding не говорит, что план нужно сделать через `/plan/setup`**
- `/shopping/page.tsx:210` есть, но это generic.
- **Фикс:** direct-link «Создать план» вместо «Заглянуть в холодильник».

### C-H3. **`/recipe/[id]` URL `?servings=N` — пользователь кликает «Увеличить порции», URL меняется. Если user жмёт «Назад» в браузере — порции откатываются, но новые не сохраняются в `mc_user` dietary**
- **Файл:** `apps/web/src/app/(app)/recipe/[id]/RecipeClient.tsx:78-79`.

### C-H4. **Profile показывает email/household/logout, но нет UI для редактирования onboard (household.budgetWeekKopecks)**
- **Файл:** `apps/web/src/app/(app)/profile/page.tsx:107-127`.
- **Что:** пользователь может менять household в API через PATCH `/household`, но UI это не предлагает.
- **Фикс:** `/profile` имеет «Edit household» button, открывает sheet.

### C-H5. **`/today/result` redirect на `/shopping/<mock-id>` ломается** (см. C-Block-1). Дополнительно: `/today/result` после отказа (NOT_FOUND) -> статично показывает «Пока не работает — скоро» (ResultClient.tsx:71) — пользователь не знает почему.
- **Фикс:** лучше "не получилось сгенерировать план — попробуйте /plan/setup или обновите настройки".

---

## MED (UX)

### C-M1. **`AuthGuard` не имеет loading-state**: при первой загрузке после навигации, в коротком промежутке redirect-pending, страница отображает default-children. Чувствуется «прыжок».
- **Файл:** `apps/web/src/components/AuthGuard.tsx:38-41`.

### C-M2. **`BottomTabBar` показывает ALL табов даже для неавторизованных**, потому что они в `(app)` router group. AuthGuard уже на уровне children. До редиректа пользователь видит /today → auth.
- **Файл:** `apps/web/src/app/(app)/layout.tsx:17-25`.

### C-M3. **`usePantry` cache (30s) — если пользователь быстро добавляет item через dialog и сразу переходит на /today, там кэшированный список не включает новый item**
- Это race на cross-screen navigation, не критично для UX-flow, но в edge может mispresent.

### C-M4. **`shopping-list/[listId]` placeholder — недоступно для пользователя мышей. Показывает `Список <listId> создан` с непонятным ID**.
- **Файл:** `apps/web/src/app/(app)/shopping/[listId]/page.tsx:21-22`.
- **Что:** `<span className="font-mono">{listId}</span>` — пользователю без разницы, что это UUID; они видят mock-данные.

### C-M5. **`usePreferences` error не виден пользователю** (R15 B3-M4).
### C-M6. **`Wizard `submit → loading → result` — если POST возвращает 422 EMPTY_RESCUE**, нет понятного сообщения.
- Зависит: error handler в LoadingClient.tsx (надо смотреть дальше).
### C-M7. **Wizard «назад» может терять `addBeforeServing`/` appliances`** — все 3-step формы в local state, не persisted.

---

## LOW (UX)

### C-L1. Theme-toggle persist в localStorage нотификаций не выводит.
### C-L2. `Card` component заголовки используют `text-heading mb-1` — нет `data-testid` для тестов.
### C-L3. `BottomTabBar` link `<Link passHref legacyBehavior>` — `legacyBehavior` deprecated (R15 B3-L1).
### C-L4. Нет `loading.tsx` для (app)/(auth) group → page-level fallback.
### C-L5. `Chip` active-state не имеет ARIA `aria-pressed`.
### C-L6. `/design` упоминает «Phase 0 done», «MC-013 app-shell» — это dev-badges не должны быть в проде.

---

## Mobile-first / a11y

- **Touch-targets**: см. **B3-L3** (checkbox 28×28 px < 44×44).
- **Skip link**: см. **B3-M2** — нет `<a href="#main">` skip-link для screen-reader.
- **Color contrast**: везде CSS-переменные, проверка не проводилась статически.
- **Reduced motion**: `BottomTabBar` fade-in transitions не учитывают `prefers-reduced-motion`. Не вижу media-query.

---

## PRD vs реализация

| PRD | Реализация | Соответствие |
|---|---|---|
| §2.3.14 /shopping «grouped by department» | `new Map()` ломает | ❌ |
| §2.3.4 `/today/result` “Я готовлю это → принимает → plan created” | mock-leak в проде | ❌ |
| §2.5.8 BottomTabBar mobile 64px + safe-area | OK | ✅ |
| §2.5.7 КБЖУ disclaimer | есть в `/recipe/[id]` | ✅ |
| §2.3.10 /plan «адекватное отображение kcal/day vs target» | бар показывает неверно | ❌ |
| §2.5.6 Brand colors (light/dark) | есть | ✅ |
| §2.3.2 /today empty-state для гостей | есть | ✅ |

---

## Выводы по C

- **4 БЛОКЕРА**: C-Block-1..4 все ломают основные happy-path.
- **5 HIGH UX** — небольшие доработки.
- **PRD-соответствие**: 4/6 проверенных пунктов НЕ выполнены в UI. Это **значимое отклонение**.
- План частично-готов, но **mock-mode в проде = катастрофа для пользователя**.
