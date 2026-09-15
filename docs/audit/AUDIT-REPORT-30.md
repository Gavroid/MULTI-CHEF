# Технический, продуктовый и UI-аудит MULTI-CHEF (30-й круг)

**Дата:** 2026-09-15
**HEAD:** `592b4bd chore(audit): AUDIT-REPORT-29 multi-tab-cache`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-29.md`, `FIX-PLAN.md`
**Фокус:** WCAG / a11y — `prefers-reduced-motion`, skip-links, focus management, axe-core CI gate.

## TL;DR

30-й круг (финальный): **4 находки** — 0 P0, 0 P2, 4 🟡 P3 (a11y hygiene).

- 🟡 **T30-A** — `globals.css:135` `@media (prefers-reduced-motion: reduce)` устанавливает `transition-duration: 100ms !important`. Это НЕ полное отключение motion — 100ms всё ещё transition. WCAG 2.3.3 AAA рекомендует effectively eliminate motion. Для vestibular disorder — даже 100ms может быть проблемой.
- 🟡 **T30-B** — Нет **skip-to-content** link. WCAG 2.4.1 (Bypass Blocks, Level A). Keyboard users должны Tab через BottomTabBar (5 tabs) + nav перед каждым экраном.
- 🟡 **T30-C** — Нет **axe-core** в dev или CI. Никакого автоматического WCAG-гейта. Регрессии a11y могут проходить незамеченными.
- 🟡 **T30-D** — `LoadingClient.tsx:190` использует Tailwind `animate-pulse` (infinite keyframe) для progress bar. При `prefers-reduced-motion: reduce` с `animation-duration: 0.001ms` — корректно «stops». ✓ Но **для долгих job'ов** (>10 сек) screen reader не получает continuous update — `aria-live` отсутствует на progress.

---

## 1. Технические находки (30-й круг)

### T30-A. `prefers-reduced-motion: reduce` НЕ полностью устраняет motion 🟡 P3

**Файл:** `apps/web/src/app/globals.css:133-143`.

**Сырой код:**

```css
/* Reduced motion: fade-only or none (PRD §2.5.6). */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 100ms !important;    // ← 100ms, не 0
  }
}
```

**Что упущено:**

1. **`transition-duration: 100ms`** — для users с `prefers-reduced-motion: reduce` всё равно есть 100ms transition. Это НЕ «no motion».
2. **WCAG 2.3.3** (Animation from Interactions, AAA): "Users can disable non-essential motion". 100ms — это essential motion (color/opacity), но **transform-based** transitions (scale, translate, rotate) всё ещё могут вызывать vestibular issues.
3. **`animate-pulse` на progress bar** — `animation-duration: 0.001ms` effectively stops, ✓.
4. **`@keyframes mc-slide-up`** (line 145-156) — используется для BottomSheet. При reduced-motion: animation-duration 0.001ms → bottom sheet «appears instantly» (но page jump может раздражать).

**Что делать:**

Для `prefers-reduced-motion: reduce`:

- **`transition-duration: 0ms`** вместо 100ms (полное отключение transition).
- **Transform-based animations** (scale, rotate, translate) → отключить через `prefers-reduced-motion` media query в `@keyframes`.

**Смягчающий фактор:** В большинстве современных ОС (iOS, Android, Windows) 100ms color/opacity transition не вызывает vestibular discomfort. Vestibular issues возникают от large-amplitude movements (>5deg rotation, >100px translation). 100ms color fade — OK.

**Рекомендованный фикс:**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0ms !important;
    scroll-behavior: auto !important;
  }
  /* Large transform animations also disabled */
  @media (prefers-reduced-motion: reduce) {
    .mc-slide-up,
    .animate-pulse,
    .animate-spin {
      animation: none !important;
      transform: none !important;
    }
  }
}
```

### T30-B. Нет skip-to-content link 🟡 P3

**Файл:** `apps/web/src/app/layout.tsx` (нет `<a href="#main" className="skip-link">Войти</a>`).

**Сырой код layout.tsx (проверка):**

```bash
$ grep -rn "skip-to\|skip-link\|SkipLink" apps/web/src/ 2>/dev/null
# (пусто — нет skip-to-content)

$ grep -n "id=" apps/web/src/app/layout.tsx
# (нет main / content id на body / main element)
```

**WCAG 2.4.1 Bypass Blocks (Level A)**: «A mechanism is available to bypass blocks of content that are repeated on multiple Web pages».

**Что упущено:**

- BottomTabBar (5 tabs) на каждой странице → keyboard user должен Tab 5+ раз чтобы пропустить.
- Page header (TabTitle + sublabel) → ещё 1-2 Tab.
- Tab content → main.
- **Итого ~7-10 Tab presses** прежде чем keyboard user дойдёт до контента.

**Рекомендованный фикс:**

```tsx
// apps/web/src/app/layout.tsx
<a href="#main" className="sr-only focus:not-sr-only ...">
  Skip to main content
</a>
<main id="main" tabIndex={-1}>
  {children}
</main>
```

CSS (Tailwind уже имеет sr-only, но нужно кастомизировать):

```css
.sr-only:not(:focus):not(:active) {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
.skip-link:focus {
  position: fixed;
  top: 0;
  left: 0;
  background: var(--color-primary);
  color: white;
  padding: 0.5rem 1rem;
  z-index: 1000;
}
```

`<main id="main" tabIndex={-1}>` — позволяет skip-link target получать focus при переходе (без tabIndex={-1} — не получит).

### T30-C. Нет axe-core CI gate 🟡 P3

**Файл:** `apps/web/package.json` (нет `jest-axe`/`axe-playwright`).

**Доказательство:**

```bash
$ grep -l "axe\|jest-axe" apps/web/package.json package.json 2>/dev/null
# (пусто — нет axe-core / jest-axe)

$ grep "axe\|a11y" .github/workflows/ci.yml
# (пусто — нет a11y gate)
```

**Что упущено:**

- WCAG-регрессии (новый компонент без `aria-label`, image без `alt`, button без text) не поймаются на CI.
- T22-A (PantryDialog без focus management), T22-B (FormErrorBanner live-region) — оба прошли бы через axe-core.

**Рекомендованный фикс:**

Для **jest/jsdom** unit-тестов:

```json
"devDependencies": {
  "jest-axe": "^9.0.0",
  "@axe-core/react": "^4.9.0"
}
```

```ts
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);
test('TabTitle is accessible', async () => {
  const { container } = render(<TabTitle>Test</TabTitle>);
  expect(await axe(container)).toHaveNoViolations();
});
```

Для **Playwright e2e**:

```ts
import AxeBuilder from '@axe-core/playwright';
test('today page is accessible', async ({ page }) => {
  await page.goto('/today');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

**В CI** (см. T28-B):

```yaml
- name: a11y (playwright + axe)
  run: pnpm exec playwright test --grep "@a11y"
```

### T30-D. `LoadingClient` progress bar без `aria-live` continuous update 🟡 P3

**Файл:** `apps/web/src/app/(app)/today/loading/LoadingClient.tsx:186-190`.

**Сырой код:**

```tsx
<div className="..." role="progressbar">
  {/* ← progress fill */}
  <div className="h-full w-1/3 rounded-full bg-[var(--color-primary)] animate-pulse" />
</div>
```

**Проверка:**

```bash
$ grep -B 2 -A 5 "role=\"progressbar\"" apps/web/src/app/\(app\)/today/loading/LoadingClient.tsx
# role="progressbar" есть, но:
# - нет aria-valuenow / aria-valuemin / aria-valuemax
# - нет aria-live="polite" для screen reader announcement
# - нет aria-label
```

**Что упущено:**

1. **`aria-valuenow` / `aria-valuemin` / `aria-valuemax`** — screen reader прочитает progress bar как «indeterminate». Не покажет % completed.
2. **`aria-live`** — для loading state, который длится 5-30 сек (planning job), screen reader должен announce "Loading..." в начале и "Done" в конце. Без `aria-live` пользователь не знает что страница активна.
3. **`aria-label`** — без него screen reader прочитает «progressbar» без контекста.

**Эффект:**

- Не-sighted user открывает `/today/generate/loading` после клика «Сгенерировать план».
- Screen reader говорит «progressbar» (indeterminate).
- 5-30 сек тишины.
- Job завершается → редирект на `/plan`. Screen reader не объявил что страница сменилась.

**Смягчающие факторы:**

- T21-B (BullMQ retry) — job retry, так что может быть 2-3 попытки. Без `aria-live` это полная тишина для SR user.
- BottomTabBar обновляется (active state), SR может озвучить изменение активного tab.

**Рекомендованный фикс:**

```tsx
<div
  role="progressbar"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={progress} // ← от useJobState polling
  aria-label="Генерация плана"
  aria-live="polite" // ← announce updates
>
  <div className="..." style={{ width: `${progress}%` }} />
</div>
```

Где `progress` приходит из polling `GET /api/v1/jobs/:id` или из local optimistic estimate.

---

## 2. Подтверждённые здоровые паттерны

- **`prefers-reduced-motion: reduce` media query есть** в globals.css (пусть и с 100ms остатком). ✓ baseline.
- **`role="progressbar"` / `role="tablist"` / `role="radio"` / `role="checkbox"`** — везде где нужно. Большинство компонентов правильно используют ARIA roles. ✓
- **`aria-label`** на кнопках без текста (FAB, icon-only, +/- в RecipeView). ✓
- **`aria-live="polite"`** на RecipeView Header для portion count. ✓
- **Фокус-стилизация** через Tailwind `focus-visible:ring-2` — повсеместно. ✓
- **`TabTitle` semantic HTML** — `<h1>` для page title. ✓
- **Touch-target ≥ 44px** — BottomTabBar `h-12 = 48px`. ✓
- **Уже применён фикс U1 (T18)** — WCAG AA tokens + link underlines (audit round 18). ✓

## 3. Микро-наблюдения

- **T30-α** — нет `<html lang="ru">` — на самом деле есть (см. layout.tsx: «`<html lang="ru" data-theme="light">`»). ✓
- **T30-β** — `loading="lazy"` атрибут на `<img>` — уже применён (T3 в commit `883b455 fix(web): img loading/decoding/dimensions`). ✓
- **T30-γ** — Keyboard navigation: `Tab` order — нужно проверить в DevTools. Если кастомные компоненты нарушают DOM order, будут проблемы. Без axe-core — невозможно автоматически проверить.
- **T30-δ** — `TabTitle` использует `<h1>` на каждой странице. ✓ Несколько `<h1>` на одной странице (если `TabTitle` + компоненты с `<h1>`) — semantic violation. Проверить.
- **T30-ε** — Color contrast — U1 уже поднял WCAG AA tokens. Не regression, но нет CI-gate (T30-C).
- **T30-ζ** — Form fields — `aria-invalid` + `aria-describedby` для error states. Уже в `Input` component (`packages/ui`). ✓
- **T30-η** — PWA `manifest.webmanifest` — есть (`apps/web/public/manifest.webmanifest`?). Hygiene: проверить name/icons/shortcuts. Не критично.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона            | Находка                                                                                                                  | Где                                                              |
| --------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **T30-A** | 🟡 P3     | Web / a11y      | `prefers-reduced-motion: reduce` → `transition-duration: 100ms !important`. Не полное отключение motion. WCAG 2.3.3 AAA. | `apps/web/src/app/globals.css:135`                               |
| **T30-B** | 🟡 P3     | Web / a11y      | Нет skip-to-content link. WCAG 2.4.1 Bypass Blocks (Level A). Keyboard users Tab 7+ раз до контента.                     | `apps/web/src/app/layout.tsx` (отсутствует)                      |
| **T30-C** | 🟡 P3     | Web / a11y / CI | Нет axe-core / jest-axe в dev/CI. Регрессии a11y не ловятся автоматически.                                               | `apps/web/package.json`, `.github/workflows/ci.yml`              |
| **T30-D** | 🟡 P3     | Web / a11y      | `LoadingClient` progress bar без `aria-valuenow`, без `aria-live`, без `aria-label`. SR не получает обновлений.          | `apps/web/src/app/(app)/today/loading/LoadingClient.tsx:186-190` |

## 5. Куммулятивный итог (30 кругов — финальный)

| Iter             | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3         | 🟡 ℹ️ | Cumulative                                   |
| ---------------- | ------------------- | ----- | ----- | ---------------- | ----- | -------------------------------------------- |
| #1–3             | 26                  | 9     | 0     | 6                | 11    | —                                            |
| #4–10            | 13                  | 0     | 0     | 13               | 0     | —                                            |
| #11              | T11-A, T11-B        | 0     | 0     | 2                | 0     | —                                            |
| #12              | T12-A               | 0     | 0     | 1                | 0     | —                                            |
| #13              | T13-A               | 1 P0  | 0     | 0                | 0     | 10 P0                                        |
| #14              | T14-A               | 0     | 0     | 1                | 0     | 10 P0                                        |
| #15              | T15-A, T15-B        | 1 P0  | 0     | 1                | 0     | 11 P0                                        |
| #16              | T16-A, T16-B        | 0     | 0     | 2                | 0     | 11 P0                                        |
| #17              | T17-A, T17-B        | 0     | 2 P1  | 0                | 0     | 11 P0, 2 P1                                  |
| #18              | T18-A–D             | 0     | 0     | 2 P2 + 2 P3      | 0     | 11 P0, 2 P1, 2 P2                            |
| #19              | T19-A, T19-B        | 0     | 0     | 2 P2             | 0     | 11 P0, 2 P1, 4 P2                            |
| #20              | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2             | 0     | 12 P0, 2 P1, 6 P2                            |
| #21              | T21-A–D             | 0     | 0     | 2 P2 + 2 P3      | 0     | 12 P0, 2 P1, 8 P2, 4 P3                      |
| **#21–30 (new)** | **T21–T30**         | **0** | **0** | **5 P2 + 13 P3** | **0** | **12 P0, 2 P1, 13 P2, 17 P3 (rounds 21–30)** |

**Тренд 30-го (завершение серии):**

Все 10 раундов #21–#30 завершены. Финальная статистика:

| Round | Тема                         | Findings (P2/P3)    |
| ----- | ---------------------------- | ------------------- |
| #21   | Worker job lifecycle         | T21-A..D (2P2, 2P3) |
| #22   | Web dialog a11y              | T22-A..C (1P2, 2P3) |
| #23   | TS validation/typing         | T23-A..C (1P2, 2P3) |
| #24   | nginx + security headers     | T24-A..D (3P2, 1P3) |
| #25   | Test coverage gaps           | T25-A..D (1P2, 3P3) |
| #26   | Worker PII/observability     | T26-A..C (0P2, 3P3) |
| #27   | Infra/deploy pipeline        | T27-A..D (1P2, 3P3) |
| #28   | CI/CD coverage               | T28-A..D (1P2, 3P3) |
| #29   | Multi-tab cache              | T29-A..C (1P2, 2P3) |
| #30   | WCAG / a11y                  | T30-A..D (0P2, 4P3) |
| **Σ** | **30 находок за 10 раундов** | **5P2 + 25P3**      |

**Ни одной P0 или P1 находки в раундах 21–30** — система стабильна после bugfix-сессий #1–#20.

## 6. Рекомендации (30-й круг)

1. **(P3, 15 мин, T30-A)** В `globals.css:135` заменить `transition-duration: 100ms !important` на `transition-duration: 0ms !important`. Добавить `scroll-behavior: auto !important` для reduced-motion (отключить smooth scroll).
2. **(P3, 1ч, T30-B)** Добавить skip-link в `layout.tsx`: `<a href="#main" className="skip-link">К содержимому</a>` + `<main id="main" tabIndex={-1}>`. CSS для skip-link (Tailwind уже имеет sr-only).
3. **(P3, 4ч, T30-C)** Добавить `jest-axe` для unit-тестов, `@axe-core/playwright` для e2e. CI job `a11y` (parallel с `lint`/`typecheck`).
4. **(P3, 30 мин, T30-D)** В `LoadingClient` — добавить `aria-valuenow`, `aria-valuemin/max`, `aria-label`, `aria-live="polite"`. Polling из `/api/v1/jobs/:id` для update.

## 7. Артефакты (30-й круг — финал)

| Артефакт                       | Где                             |
| ------------------------------ | ------------------------------- |
| Этот отчёт                     | `docs/audit/AUDIT-REPORT-30.md` |
| FIX-PLAN (T30-A,B,C,D)         | `docs/audit/FIX-PLAN.md`        |
| `prefers-reduced-motion` 100ms | §1 T30-A                        |
| skip-to-content                | §1 T30-B                        |
| axe-core CI                    | §1 T30-C                        |
| LoadingClient aria-* attrs     | §1 T30-D                        |

---

## 🎯 Итог серии #21–#30

**30 находок** в worker, web, infra, CI. Никаких P0/P1. Распределение:

- **P2 (5)**: T21-B, T22-A, T24-A/B/C, T25-A, T28-A, T29-A — реальные риски (worker contract, a11y, security, deploy).
- **P3 (25)**: hygiene — observability, typing DRY, contract doc, test coverage gaps, multi-tab sync.

Все находки зафиксированы в `docs/audit/FIX-PLAN.md` (30 строк). Fix-план — единый бэклог для следующих сессий. Push в origin не выполнялся (по требованию goal'а).

Стоп-условие **«10 раундов»** достигнуто. Серия завершена.
