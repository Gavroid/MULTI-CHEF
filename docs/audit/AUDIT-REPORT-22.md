# Технический, продуктовый и UI-аудит MULTI-CHEF (22-й круг)

**Дата:** 2026-09-15
**HEAD:** `ec3879f chore(audit): AUDIT-REPORT-21 worker-job-lifecycle`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-21.md`, `FIX-PLAN.md`
**Фокус:** apps/web — модальные диалоги, a11y-паттерны, theme/UI-хуки.

## TL;DR

22-й круг: **3 находки** — 1 🟠 P2 (a11y), 2 🟡 P3 (UX hygiene).

- 🟠 **T22-A** — `PantryDialog` (база всех модалок pantry + будущих) не управляет фокусом: нет initial-focus при open, нет return-focus при close, нет `aria-labelledby`/`aria-modal`. Screen-reader пользователи не получают явного объявления о модалке.
- 🟡 **T22-B** — `FormErrorBanner` переключает live-region атрибут (`aria-live="polite"` → `role="alert"`) при появлении сообщения. Некоторые screen readers не ловят смену режима — сообщение может не анонсироваться.
- 🟡 **T22-C** — `useTheme` читает `prefers-color-scheme` один раз при mount и не подписывается на изменения. Если пользователь меняет OS-тему во время сессии, приложение не реагирует.

---

## 1. Технические находки (22-й круг)

### T22-A. `PantryDialog` не управляет фокусом и не объявляет модальность 🟠 P2

**Файл:** `apps/web/src/components/PantryDialog.tsx:30-85`. Используется в `AddPantryItemDialog`, `EditPantryItemDialog`, `ConfirmDialog` (через `PantryDialog` → footer slot).

**Сырой код (релевантные фрагменты):**

```tsx
return (
  <dialog
    ref={ref}
    data-testid="pantry-dialog"
    className="bg-transparent backdrop:bg-black/40 max-w-screen-sm w-[92vw] p-0 m-auto"
    onClick={(e): void => {
      if (e.target === ref.current) onClose();
    }}
  >
    <div className="bg-card rounded-lg shadow-lg border border-border overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-heading">{title}</h2>     {/* ← нет id, нет aria-labelledby */}
        <button type="button" aria-label="Закрыть" onClick={onClose} ...>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="p-4">{children}</div>
      {footer ? (...) : null}
    </div>
  </dialog>
);
```

Проблемы:

1. **Нет `aria-labelledby` на `<dialog>`** — screen reader при открытии модалки может не озвучить заголовок (`title`). Нужно `<h2 id="mc-dialog-title-{n}">` + `<dialog aria-labelledby="mc-dialog-title-{n}">`.
2. **Нет `aria-modal="true"`** — некоторые AT (особенно старые NVDA, VoiceOver) не определяют modality автоматически для native `<dialog>` без явного атрибута. Без него фокус может «утечь» за пределы диалога (баг наблюдался в JAWS 2022+).
3. **Нет initial-focus при open** — native `<dialog>` НЕ двигает фокус на первый focusable внутри. После `showModal()` фокус остаётся на trigger-кнопке в фоне. Screen-reader пользователь должен Tab-нуть, чтобы попасть внутрь.
4. **Нет return-focus при close** — при `el.close()` фокус НЕ возвращается на trigger-кнопку (которая вызвала `setOpen(true)`). По WCAG 2.4.3 (focus order) и 2.1.2 (no keyboard trap) фокус должен возвращаться.
5. **Нет `inert` на фоне** — содержимое за диалогом остаётся focusable для AT, которые не понимают native modality (Safari+iOS VoiceOver до недавнего).

**Эффект:**

- Слепой пользователь, открывший «Добавить в холодильник», может:
  - Не услышать заголовок модалки.
  - Tab-нуть и оказаться на скрытых полях фона.
  - Закрыть модалку → фокус потерян (где-то на `<body>`), клавиатурная навигация сломана до явного клика.

**Доказательство (grep):**

```bash
$ grep -n "aria-modal\|aria-labelledby\|inert\|autofocus" apps/web/src/components/PantryDialog.tsx
# (пусто — нет ни одного из этих атрибутов)
$ grep -rn "aria-modal" apps/web/src/ 2>/dev/null
# (пусто во всём apps/web)
```

**Проверка ARIA Authoring Practices для dialog:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ — recommended pattern: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus-trap, return-focus.

**Рекомендованный фикс:**

1. Передавать `titleId` в `<h2 id={titleId}>` + `<dialog aria-labelledby={titleId} aria-modal="true">`.
2. На open → `el.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')?.focus()` (либо explicit `autoFocus` на первый input в AddPantryItemDialog).
3. На close → сохранять `document.activeElement` в ref → после `el.close()` восстанавливать `.focus()`.
4. Опционально: рендерить `<div inert aria-hidden="true">` wrapper вокруг `{children}` siblings — но это противоречит native `<dialog>` semantic layer, так что скорее не нужно.

### T22-B. `FormErrorBanner` переключает `aria-live` режим 🟡 P3

**Файл:** `apps/web/src/components/FormErrorBanner.tsx:17-32`.

**Сырой код:**

```tsx
export function FormErrorBanner({ message, className }: { message: string | null; className?: string; }) {
  if (!message) return <div aria-live="polite" className="sr-only" />;
  return (
    <div
      role="alert"
      data-testid="mc-form-error"
      className={cn(...)}
    >
      {message}
    </div>
  );
}
```

Проблема: при появлении ошибки (`!message` → `message !== null`) атрибут `aria-live` исчезает (потому что role=alert подразумевает `aria-live=assertive` неявно), а сам элемент меняет DOM-структуру (был `<div class="sr-only">`, стал `<div role="alert" class="...">...</div>`). Некоторые screen readers (NVDA + Firefox, JAWS + Chrome) не ловят изменение live-region режима и не анонсируют содержимое.

**Рекомендованный фикс:** всегда рендерить один и тот же элемент с `role="alert" aria-live="assertive"`, контент тогглить:

```tsx
return (
  <div
    role="alert"
    aria-live="assertive"
    data-testid="mc-form-error"
    className={cn(message ? 'block...' : 'sr-only')}
  >
    {message ?? ''}
  </div>
);
```

Это гарантирует, что AT видит одну и ту же live-region node, и при изменении textContent сработает announce.

### T22-C. `useTheme` не подписывается на изменения OS-темы 🟡 P3

**Файл:** `apps/web/src/hooks/useTheme.ts:62-78`.

**Сырой код:**

```ts
useEffect(() => {
  const stored = readStoredTheme();
  if (stored) {
    setThemeState(stored);
    applyToDocument(stored);
    return;
  }
  // No manual choice — defer to OS preference via matchMedia.
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const initial: Theme = prefersDark ? 'dark' : 'light';
  setThemeState(initial);
  applyToDocument(initial);
}, []);
```

`prefersDark` читается ОДИН раз на mount. Если у пользователя НЕТ manual choice в `localStorage` (`mc-theme` отсутствует) и он переключает OS dark/light preference во время открытой сессии — приложение не реагирует до reload.

Это касается и `themeInitScript` в layout.tsx — он тоже читает `matchMedia` один раз на parse.

**Эффект:** пользователь без manual-choice в полумраке открыл сайт (dark theme по OS). Перешёл в светлое помещение, переключил OS preference на light. Сайт остался dark → трудно читать → пользователь жмёт F5 / закрывает вкладку. Минорный UX-баг.

**Проверка:**

```bash
$ grep -rn "matchMedia\|addEventListener\|prefers-color-scheme" apps/web/src/hooks/useTheme.ts apps/web/src/app/layout.tsx
apps/web/src/hooks/useTheme.ts:65:    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
apps/web/src/app/layout.tsx:46:        t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
# ни одного addEventListener('change', ...) — нет подписки.
```

**Рекомендованный фикс:**

```ts
const mql = window.matchMedia('(prefers-color-scheme: dark)');
const handler = (e: MediaQueryListEvent) => {
  const next: Theme = e.matches ? 'dark' : 'light';
  setThemeState(next);
  applyToDocument(next);
};
mql.addEventListener('change', handler);
return () => mql.removeEventListener('change', handler);
```

Только когда `theme` ещё `null` (manual choice отсутствует). Когда пользователь делает manual toggle — он перехватывает контроль, и OS preference больше не должно следовать.

---

## 2. Подтверждённые здоровые паттерны

- **`PantryDialog` использует native `<dialog>`** — правильный выбор (browser-built-in focus trap, top-layer, `cancel` event). Не нужен react-aria-modal-portal.
- **`useTheme` + `themeInitScript` в layout.tsx** — inline blocking script ПРЕДОТВРАЩАЕТ FOUC: data-theme устанавливается до первой отрисовки. T22-C касается только mid-session OS preference changes, не первичной загрузки.
- **`BottomTabBar` + `TabItem`** — `aria-current="page"`, `aria-label`, focus-visible ring, иконка `aria-hidden`, текстовая метка — все WCAG-паттерны соблюдены.
- **`AuthGuard` (post-T19-A)** — redirects на server session probe (HttpOnly cookie), а не на `localStorage.mc_user`. Устойчив к drift между клиентом и сервером.
- **`usePantry`/`usePreferences` cache-invalidation на logout** — T19-C закрыт (см. `apps/web/src/app/(app)/profile/page.tsx:logout()` → `resetPantryCache()`, `resetPreferencesCache()`).

## 3. Микро-наблюдения

- **T22-α** — `PantryDialog` не имеет `id` prop — если на странице открывается две модалки (например, Add + Edit в одном view), заголовки могут «слипаться». Hygiene: добавить `id` или генерировать уникальный через `useId()`.
- **T22-β** — `ConfirmDialog` использует `<p className="text-body">{message}</p>` без `aria-describedby`-привязки к dialog. Message будет прочитан, но неявно. Лучше: `<p id="...">` + `<dialog aria-describedby="...">` для длинных confirm.
- **T22-γ** — `usePreferences` AbortController создаётся в cache-branch и abort'ится в cleanup — безвредно, но лишний объект. Микро-перформанс.
- **T22-δ** — `BottomTabBar` использует `legacyBehavior` на `<Link>` (deprecated в Next 14+, рекомендуется `<Link>` без legacy). Tracking issue.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона        | Находка                                                                                                   | Где                                                 |
| --------- | --------- | ----------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **T22-A** | 🟠 P2     | Web / a11y  | `PantryDialog` без focus management, без `aria-modal`/`aria-labelledby`. Нарушает WCAG 2.4.3.             | `apps/web/src/components/PantryDialog.tsx:30-85`    |
| **T22-B** | 🟡 P3     | Web / a11y  | `FormErrorBanner` переключает `aria-live` режим при появлении сообщения. NVDA/JAWS могут не анонсировать. | `apps/web/src/components/FormErrorBanner.tsx:17-32` |
| **T22-C** | 🟡 P3     | Web / Theme | `useTheme` не подписывается на OS-preference change, mid-session OS theme switch игнорируется.            | `apps/web/src/hooks/useTheme.ts:62-78`              |

## 5. Куммулятивный итог (22 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3        | 🟡 ℹ️ | Cumulative                  |
| ------- | ------------------- | ----- | ----- | --------------- | ----- | --------------------------- |
| #1–3    | 26                  | 9     | 0     | 6               | 11    | —                           |
| #4–10   | 13                  | 0     | 0     | 13              | 0     | —                           |
| #11     | T11-A, T11-B        | 0     | 0     | 2               | 0     | —                           |
| #12     | T12-A               | 0     | 0     | 1               | 0     | —                           |
| #13     | T13-A               | 1 P0  | 0     | 0               | 0     | 10 P0                       |
| #14     | T14-A               | 0     | 0     | 1               | 0     | 10 P0                       |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1               | 0     | 11 P0                       |
| #16     | T16-A, T16-B        | 0     | 0     | 2               | 0     | 11 P0                       |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0               | 0     | 11 P0, 2 P1                 |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 11 P0, 2 P1, 2 P2           |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2            | 0     | 11 P0, 2 P1, 4 P2           |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2            | 0     | 12 P0, 2 P1, 6 P2           |
| #21     | T21-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 12 P0, 2 P1, 8 P2, 4 P3     |
| **#22** | **T22-A–C**         | **0** | **0** | **1 P2 + 2 P3** | **0** | **12 P0, 2 P1, 9 P2, 6 P3** |

**Тренд 22-го:** Web-сторона. После T19/T20/T21 (worker/contract) фокус смещается на UI/a11y hygiene. T22-A — наиболее дорогая находка: регрессия a11y может зацепить всех пользователей модалок (pantry CRUD — основной flow).

## 6. Рекомендации (22-й круг)

1. **(P2, 2ч, T22-A)** Реализовать в `PantryDialog`: `useId()` → `id="mc-dialog-title"`, `<h2 id>` + `<dialog aria-labelledby aria-modal>`. На open: фокус на первом `[role=dialog] input|button` (или на close-button если footer пустой). На close: восстановить focus на ранее сохранённый trigger. Покрыть Playwright-тестом `screen-reader announcement on dialog open`.
2. **(P3, 30 мин, T22-B)** Заменить `if (!message) return <div aria-live="polite" />` на один `<div role="alert" aria-live="assertive">` с тогглом класса и содержимого.
3. **(P3, 30 мин, T22-C)** В `useTheme` подписаться на `matchMedia.addEventListener('change', ...)` только если `theme === null` (нет manual choice). Cleanup в useEffect.
4. **(P3 hygiene, T22-δ)** Убрать `legacyBehavior` с `<Link>` в BottomTabBar, использовать современный API Next 13+.

## 7. Артефакты (22-й круг)

| Артефакт                      | Где                             |
| ----------------------------- | ------------------------------- |
| Этот отчёт                    | `docs/audit/AUDIT-REPORT-22.md` |
| FIX-PLAN (T22-A,B,C)          | `docs/audit/FIX-PLAN.md`        |
| `PantryDialog` a11y           | §1 T22-A                        |
| `FormErrorBanner` live-region | §1 T22-B                        |
| `useTheme` matchMedia         | §1 T22-C                        |
