# Технический, продуктовый и UI-аудит MULTI-CHEF (47-й круг)

**Дата:** 2026-09-15
**HEAD:** `1082b88 chore(audit): AUDIT-REPORT-46 i18n-gaps`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-46.md`, `FIX-PLAN.md`
**Фокус:** Modal accessibility — focus trap, return focus, ARIA roles, Escape handling.

## TL;DR

47-й круг: **4 находки** — 0 P0, 2 🟠 P2 (focus mgmt gaps), 2 🟡 P3.

- 🟠 **T47-A** — `PantryDialog` (`apps/web/src/components/PantryDialog.tsx`) **не реализует focus trap вручную**, полагается на native `<dialog>` (post T22-A). Но **не программирует initial focus** на first interactive element при open. Screen reader / keyboard user попадает на `document.body`, должен Tab'ом найти close button.
- 🟠 **T47-B** — `PantryDialog` не сохраняет **previously-focused element** при open. При close → focus возвращается на `document.body`, не на trigger кнопку. **WCAG 2.4.3 (focus order)**.
- 🟡 **T47-C** — `PantryDialog` использует `el.showModal()` — но **нет `aria-labelledby`** attribute на самом `<dialog>` (хотя есть `<h2>{title}</h2>`). Screen reader не связывает dialog с title.
- 🟡 **T47-D** — `BottomSheet` (`packages/ui/src/components/BottomSheet.tsx`) — `<div role="dialog" aria-modal>` правильно, но **нет `aria-labelledby`** consistently (только если `title` задан).

---

## 1. Технические находки (47-й круг)

### T47-A. `PantryDialog` — нет initial focus на open 🟠 P2

**Файл:** `apps/web/src/components/PantryDialog.tsx:31-40`.

**Сырой код:**

```ts
useEffect(() => {
  const el = ref.current;
  if (!el) return;
  if (open && !el.open) {
    el.showModal(); // ← native dialog API, no focus mgmt
  } else if (!open && el.open) {
    el.close();
  }
}, [open]);
```

**Что делает `<dialog>.showModal()`:**

- Native browser top-layer modal.
- Browser **AUTO-FOCUSES first focusable element** в большинстве случаев (Chrome 102+, Firefox 113+, Safari 15.4+).
- Но: **first focusable может быть `<button>X</button>` (close) или первый input в dialog**. Зависит от browser/DOM order.

**Проблема:**

- Если close button первый → focus → user жмёт Enter → dialog close → focus lost (T47-B).
- Если input первый → OK, но нет programmatic control.

**Смягчающий фактор:** Современные браузеры auto-focus, но порядок не гарантирован.

**Рекомендованный фикс:**

```ts
useEffect(() => {
  const el = ref.current;
  if (!el) return;
  if (open && !el.open) {
    el.showModal();
    // Explicit focus on first interactive element inside dialog
    requestAnimationFrame(() => {
      const firstFocusable = el.querySelector<HTMLElement>(
        'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    });
  } else if (!open && el.open) {
    el.close();
  }
}, [open]);
```

### T47-B. `PantryDialog` — не возвращает focus на trigger 🟠 P2

**Файл:** `apps/web/src/components/PantryDialog.tsx` (нет return-focus logic).

**Сырой код (только close listener):**

```ts
useEffect(() => {
  const el = ref.current;
  if (!el) return;
  const handler = (): void => onClose();
  el.addEventListener('close', handler);
  el.addEventListener('cancel', handler);
  return (): void => {
    el.removeEventListener('close', handler);
    el.removeEventListener('cancel', handler);
  };
}, [onClose]);
```

**Эффект:**

- User opens dialog (focus → first interactive inside).
- User closes dialog (Tab → Escape, or click X).
- Focus возвращается на **`document.body`** (default browser behavior).
- User должен **mouse-click** или **Tab from start** чтобы снова найти trigger button.

**WCAG 2.4.3 (Focus Order, Level A):** when focus moves, it doesn't cause change of context.
**WCAG 3.2.2 (On Input, Level A):** input doesn't cause change of context unless user is informed.

**Смягчающий фактор:** Chrome 109+ имеет native focus restoration для `<dialog>` (когда `[open]` toggled via attribute) — но не universally.

**Рекомендованный фикс:**

```ts
import { useRef } from 'react';

export function PantryDialog({ ... }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;  // save
    } else if (triggerRef.current) {
      triggerRef.current.focus();  // restore
      triggerRef.current = null;
    }
  }, [open]);
  // ...
}
```

Или: использовать `inert` attribute на background siblings.

### T47-C. `PantryDialog` — нет `aria-labelledby` 🟡 P3

**Файл:** `apps/web/src/components/PantryDialog.tsx:55-66`.

**Сырой код:**

```tsx
<dialog ref={ref} data-testid="pantry-dialog" className="...">
  <div>
    <header>
      <h2 className="text-heading">{title}</h2>  {/* ← title есть, но dialog не знает */}
      <button aria-label="Закрыть" ...><X /></button>
    </header>
    ...
  </div>
</dialog>
```

**Эффект:**

- Screen reader (NVDA, VoiceOver) объявляет dialog с **role=dialog**, но **без заголовка** — user не понимает о чём dialog.
- `<h2>{title}</h2>` — текст есть, но не связан с `<dialog>`.

**Рекомендованный фикс:**

```tsx
const titleId = useId();

<dialog ref={ref} aria-labelledby={titleId}>
  <div>
    <header>
      <h2 id={titleId}>{title}</h2>
      <button aria-label="Закрыть" ...><X /></button>
    </header>
    ...
  </div>
</dialog>
```

### T47-D. `BottomSheet` — inconsistent `aria-labelledby` 🟡 P3

**Файл:** `packages/ui/src/components/BottomSheet.tsx:62-83`.

**Сырой код:**

```tsx
const labelledBy = title ? 'mc-bottom-sheet-title' : undefined;

<div
  role="dialog"
  aria-modal="true"
  aria-labelledby={labelledBy}              // ← undefined если нет title
  aria-label={labelledBy ? undefined : (ariaLabel ?? 'Диалог')}  // ← fallback hardcoded "Диалог"
  data-testid="mc-bottom-sheet"
>
  ...
  {title ? <h2 id="mc-bottom-sheet-title">{title}</h2> : null}  // ← id только если title есть
```

**Эффект:**

- Если BottomSheet вызван без `title` и без `ariaLabel` → `aria-label="Диалог"` (hardcoded RU).
- ID `mc-bottom-sheet-title` не существует, если title нет → broken ARIA reference.

**Смягчающий фактор:** Fallback в виде `ariaLabel` props.

**Рекомендованный фикс:**

```tsx
const titleId = useId();
const labelledBy = title ? titleId : undefined;
const computedAriaLabel = ariaLabel ?? 'Диалог';   // или undefined если нет ни title, ни ariaLabel

<div
  role="dialog"
  aria-modal="true"
  aria-labelledby={labelledBy}
  aria-label={labelledBy ? undefined : computedAriaLabel}
>
  {title ? <h2 id={titleId}>{title}</h2> : null}
```

Или сделать `ariaLabel` required (если нет title, требуй ariaLabel).

---

## 2. Подтверждённые здоровые паттерны

- **Native `<dialog>` + `showModal()`** — правильный choice для a11y (vs custom modal div). ✓
- **`role="dialog" aria-modal="true"`** в BottomSheet. ✓
- **Escape closes** dialog (`cancel` event listener в PantryDialog, keydown в BottomSheet). ✓
- **`aria-label="Закрыть"`** на close button. ✓
- **`prefers-reduced-motion`** respected (globals.css). ✓
- **Focus-visible ring** на интерактивных элементах. ✓

## 3. Микро-наблюдения

- **T47-α** — `<X size={18} aria-hidden="true" />` для close icon — правильно (иконка decorative). ✓
- **T47-β** — PantryDialog имеет backdrop click close — `e.target === ref.current`. Корректный паттерн.
- **T47-γ** — ConfirmDialog (через PantryDialog) наследует те же issues.
- **T47-δ** — BottomSheet `document.body.style.overflow = 'hidden'` для scroll lock. ✓ Но body остаётся scrollable из-за `<dialog>` modal layer? Hygiene: тестировать на mobile.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона       | Находка                                                                                                   | Где                                                                 |
| --------- | --------- | ---------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **T47-A** | 🟠 P2     | Web / a11y | `PantryDialog` нет initial focus на open. Screen reader / keyboard user попадает на неопределённый focus. | `apps/web/src/components/PantryDialog.tsx:31-40`                    |
| **T47-B** | 🟠 P2     | Web / a11y | `PantryDialog` не возвращает focus на trigger после close. WCAG 2.4.3 violation.                          | `apps/web/src/components/PantryDialog.tsx` (нет return-focus logic) |
| **T47-C** | 🟡 P3     | Web / a11y | `PantryDialog` нет `aria-labelledby`. `<h2>{title}</h2>` не связан с `<dialog>`.                          | `apps/web/src/components/PantryDialog.tsx:55-66`                    |
| **T47-D** | 🟡 P3     | UI / a11y  | `BottomSheet` `aria-labelledby` inconsistent: undefined если нет title; fallback hardcoded "Диалог".      | `packages/ui/src/components/BottomSheet.tsx:62-83`                  |

## 5. Куммулятивный итог (47 кругов)

| Iter   | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды) | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                | T41-A..D     | 0     | 0     | 2     | 2     |
| 42     | #42     | Pagination          | T42-A..D     | 0     | 0     | 2     | 2     |
| 43     | #43     | Async races         | T43-A..D     | 0     | 0     | 2     | 2     |
| 44     | #44     | Dependencies        | T44-A..D     | 0     | 0     | 0     | 4     |
| 45     | #45     | React rendering     | T45-A..D     | 0     | 0     | 1     | 3     |
| 46     | #46     | i18n                | T46-A..D     | 0     | 0     | 2     | 2     |
| **47** | **#47** | **Modal a11y**      | **T47-A..D** | **0** | **0** | **2** | **2** |

## 6. Рекомендации (47-й круг)

1. **(P2, 1ч, T47-A + T47-B)** Добавить focus management в `PantryDialog`: initial focus + return focus через `useRef` triggers. Тестировать keyboard-only navigation.
2. **(P3, 15 мин, T47-C)** Добавить `useId()` для title-id + `aria-labelledby` на dialog.
3. **(P3, 30 мин, T47-D)** BottomSheet: use `useId()` для titleId, fallback ariaLabel required.

## 7. Артефакты (47-й круг)

| Артефакт                        | Где                             |
| ------------------------------- | ------------------------------- |
| Этот отчёт                      | `docs/audit/AUDIT-REPORT-47.md` |
| FIX-PLAN (T47-A,B,C,D)          | `docs/audit/FIX-PLAN.md`        |
| No initial focus on open        | §1 T47-A                        |
| No return focus on close        | §1 T47-B                        |
| Missing aria-labelledby         | §1 T47-C                        |
| BottomSheet aria-labelledby gap | §1 T47-D                        |
