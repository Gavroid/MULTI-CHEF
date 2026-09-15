# Технический, продуктовый и UI-аудит MULTI-CHEF (67-й круг)

**Дата:** 2026-09-15
**Область:** Accessibility (a11y) — keyboard navigation, ARIA
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

ARIA-инфраструктура в проекте неплохая: 136 совпадений `aria-*` /
`role=` / `tabIndex` / `<button` (включая тесты). Видны
`aria-label` на key controls, `aria-current="page"` в
`BottomTabBar`, `role="alert"` в `FormErrorBanner`, `role=
"radiogroup"` в pantry dialogs, `<html lang="ru">`. Используется
нативный `<dialog>` элемент.

Слабые стороны:

1. **Ноль keyboard handlers** (`onKeyDown` / `onKeyUp` /
   `onKeyPress` / `key ===`) во всём `apps/web/src` — кастомные
   интерактивные элементы (cards, list items) работают только
   по клику мыши. Нативный `<dialog>` покрывает Esc, но всё
   остальное — нет.
2. **`<div onClick>` без `role="button"` / `tabIndex={0}`** —
   где-то это допустимо (если внутри есть `<button>`), но
   аудит `OptionCard.tsx` (см. раунд 54) показывает кликабельный
   `<div>` без keyboard support.
3. **Нет skip-link** «Перейти к содержимому» для screen reader /
   keyboard users на длинных страницах.
4. **Нет `aria-describedby` для form errors** — error message
   привязан через `FormErrorBanner` (role="alert"), но не
   связан с `<input aria-invalid>` / `aria-describedby="error-id"`.

---

## Технические находки (67-й круг)

### T67-A · 🟠 P2 — Ноль keyboard handlers в `apps/web/src`

**Где:** весь `apps/web/src/**/*.tsx`
(`grep -rn "onKeyDown\|onKeyUp\|onKeyPress\|Escape"` → 0 совпадений).

**Симптом.** Все интерактивные элементы — только `onClick`. Примеры:

- `OptionCard.tsx` (см. T54) — кликабельная карточка рецепта с
  `<div onClick=…>`. Нет `onKeyDown` для Enter/Space, нет
  `role="button"`, нет `tabIndex={0}`. Screen reader не объявит
  её как «кнопка», keyboard user не сфокусируется.
- `PantryItemCard.tsx:87-98` — кнопки «Восстановить / Редактировать /
  Удалить» через `Button`-компонент (хорошо, есть `aria-label`), но
  если карточка сама кликабельна — на ней нет keyboard support.

**Почему важно.** WCAG 2.1.1 (Keyboard). Покрывает 8% пользователей,
которые полагаются только на клавиатуру (motor disabilities, screen
reader users, power users). Невозможно пройти WCAG AA audit без
keyboard support.

**Гипотеза фикса.** На каждой интерактивной карточке:

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }}
  aria-label={`Открыть ${recipe.title}`}
>
```

Либо кастомный hook `useCardKeydown()` + переиспользуемая
`<InteractiveCard>` обёртка.

---

### T67-B · 🟠 P2 — `<dialog>` без initial focus / focus-trap

**Где:** `apps/web/src/components/PantryDialog.tsx:51-78`,
`AddPantryItemDialog.tsx`, `EditPantryItemDialog.tsx`,
`ConfirmDialog.tsx`.

**Симптом.** Используется нативный `<dialog>` элемент:

```tsx
<dialog ref={ref} onClick={...}>
  <header>...</header>
  <div>{children}</div>
  <footer>...</footer>
</dialog>
```

Нативный `<dialog>` в браузерах (Chromium 110+, Firefox 112+,
Safari 15.4+) автоматически:

- ставит focus на первый focusable child,
- обрабатывает Esc для закрытия,
- ставит `inert` на остальной DOM.

Однако:

- **Focus return**: после закрытия `<dialog>` НЕ возвращает focus на
  trigger-button (это работает в нативной `<dialog modal>` API,
  но не всегда — см. webkit bugs). Нужно вручную.
- **Initial focus**: если первый focusable — это close-button,
  пользователь на Enter закрывает диалог. Лучше явно фокусировать
  primary action (Submit / Save).
- **Focus trap**: нативный `<dialog>` это поддерживает, но при
  вложенных `<dialog>` (а в проекте есть `ConfirmDialog` поверх
  `PantryDialog`) — focus может «утечь» во внешний диалог.

**Гипотеза фикса.** Завести hook `useDialogFocus(dialogRef, open)`:

```ts
export function useDialogFocus(
  ref: RefObject<HTMLDialogElement>,
  open: boolean,
  initialFocusSelector?: string,
) {
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;
    const target = initialFocusSelector
      ? dialog.querySelector<HTMLElement>(initialFocusSelector)
      : dialog.querySelector<HTMLElement>('input, textarea, select, button');
    target?.focus();
    // save last activeElement, restore on close
    return () => {
      lastActiveElement?.focus();
    };
  }, [open]);
}
```

Это сильно лучше, чем надеяться на нативное поведение, тем более
что **T47-A** (раунд 47) уже отмечал отсутствие initial focus.

---

### T67-C · 🟡 P3 — Нет skip-link «Перейти к содержимому»

**Где:** `apps/web/src/app/layout.tsx` (root layout).

**Симптом.** Длинные страницы (`/plan`, `/shopping`, `/today`)
содержат `BottomTabBar` + header + main content + footer. Screen
reader / keyboard user, попадающий на страницу, должен Tab'ом
пройти через все 5-10 ссылок в `BottomTabBar`, прежде чем
добраться до основного контента. Это WCAG 2.4.1 «Bypass Blocks».

**Гипотеза фикса.** Первым focusable элементом в `<body>`:

```tsx
<a
  href="#main"
  className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white"
>
  Перейти к содержимому
</a>
<main id="main" tabIndex={-1}>...</main>
```

`tabIndex={-1}` на `<main>` позволяет программно фокусироваться
(skip-link target).

---

### T67-D · 🟡 P3 — Form errors не привязаны к полям через `aria-describedby`

**Где:** `apps/web/src/components/AddPantryItemDialog.tsx`,
`EditPantryItemDialog.tsx`, `apps/web/src/components/FormErrorBanner.tsx`.

**Симптом.** `FormErrorBanner`:

```tsx
if (!message) return <div aria-live="polite" className="sr-only" />;
return <div role="alert">{message}</div>;
```

Banner объявляет ошибку через `role="alert"` (хорошо — screen reader
озвучит), но **не привязан** к конкретному полю. WCAG 1.3.1
(Info and Relationships) и 3.3.1 (Error Identification) требуют
связи error → field.

**Гипотеза фикса.**

```tsx
<label htmlFor="ingredient">Ингредиент</label>
<input
  id="ingredient"
  aria-invalid={hasError}
  aria-describedby={hasError ? 'ingredient-error' : undefined}
/>
{hasError && (
  <p id="ingredient-error" role="alert">
    {error}
  </p>
)}
```

Это даёт screen reader'у прямую связь «поле Ингредиент — ошибка:
не указано количество».

---

## Подтверждённые здоровые паттерны

- `<html lang="ru">` в `layout.tsx:57` — корректная языковая
  декларация (WCAG 3.1.1).
- `aria-current="page"` в `BottomTabBar.tsx:56` — корректный
  indicator активной страницы (WCAG 4.1.2 / ARIA 1.1).
- `aria-live="polite"` + `role="alert"` в `FormErrorBanner` —
  корректная error-семантика.
- `aria-hidden="true"` на декоративных иконках (например, `<X
size={18} aria-hidden />`) — корректное скрытие от screen reader.
- Нативный `<dialog>` элемент вместо самописного modal — базовая
  a11y (focus management, Esc) идёт из браузера.
- `data-testid` атрибуты отделены от ARIA — тесты не ломают
  accessibility tree.

---

## Сводка таблицой (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                            | Файл / место                                       |
| ----- | --- | ---- | ----------------------------------------------------------------- | -------------------------------------------------- |
| T67-A | 🟠  | P2   | Ноль keyboard handlers (`onKeyDown` / `Escape`) в `apps/web/src`. | apps/web/src (поиск onKeyDown → 0). Карточки вроде |
|       |     |      | Card-элементы работают только по клику                            | OptionCard / PantryItemCard — нет keyboard support |
| T67-B | 🟠  | P2   | Нативный `<dialog>` без initial focus / focus-return hook.        | apps/web/src/components/PantryDialog.tsx:51-78,    |
|       |     |      | Кросс-браузерные нюансы + вложенные диалоги                       | AddPantryItemDialog.tsx, ConfirmDialog.tsx         |
| T67-C | 🟡  | P3   | Нет skip-link «Перейти к содержимому». WCAG 2.4.1                 | apps/web/src/app/layout.tsx (root layout)          |
|       |     |      | «Bypass Blocks»                                                   |                                                    |
| T67-D | 🟡  | P3   | Form errors не привязаны к полям через `aria-describedby` /       | apps/web/src/components/AddPantryItemDialog.tsx,   |
|       |     |      | `aria-invalid`. WCAG 1.3.1 / 3.3.1                                | EditPantryItemDialog.tsx, FormErrorBanner.tsx      |

---

## Куммулятивный итог (67 кругов)

- **Всего найдено проблем:** 268 (T21–T67).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  150 · 🟡 P3: 92.
- **Раунды с нулевыми находками:** 0 из 67.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33), observability /
  healthchecks (26), accessibility (8 — новый раунд), DB indexes
  (4), error handling (4), bundle (4).

---

## Рекомендации (67-й круг)

1. **T67-A — на этой неделе.** Audit всех `<div onClick>` в
   `apps/web/src` → добавить `role="button"` + `tabIndex={0}` +
   `onKeyDown`. Минимум для `OptionCard.tsx` и `PantryItemCard.tsx`.
2. **T67-B — на этой неделе.** Хук `useDialogFocus` + интеграция в
   `PantryDialog`, `AddPantryItemDialog`, `ConfirmDialog`.
3. **T67-C, T67-D — на спринт.** Skip-link в root layout,
   `aria-describedby` для form errors.

---

## Артефакты (67-й круг)

- `docs/audit/AUDIT-REPORT-67.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T67-A…T67-D.
