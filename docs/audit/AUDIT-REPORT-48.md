# Технический, продуктовый и UI-аудит MULTI-CHEF (48-й круг)

**Дата:** 2026-09-15
**HEAD:** `a4fb0c3 chore(audit): AUDIT-REPORT-47 modal-a11y`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-47.md`, `FIX-PLAN.md`
**Фокус:** Empty / skeleton / error states UX — coverage, fallback UI, retry patterns.

## TL;DR

48-й круг: **4 находки** — 0 P0, 1 🟠 P2 (error UX), 3 🟡 P3.

- 🟠 **T48-A** — `PlanClient` error state показывает **raw `error.message`** без retry button / structured UI. User видит broken text при 5xx/timeout.
- 🟡 **T48-B** — `ShoppingClient` использует `toast.show` для всех errors — silent failure для users с disabled toast / timeout fallback.
- 🟡 **T48-C** — Нет `apps/web/src/app/not-found.tsx`. API 404 (e.g., `GET /jobs/:id` for unknown) → Next.js default page (English, generic).
- 🟡 **T48-D** — `TodayClient` нет loading state — silent empty-then-fill. User не видит "Loading..." feedback.

---

## 1. Технические находки (48-й круг)

### T48-A. `PlanClient` raw error.message UX 🟠 P2

**Файл:** `apps/web/src/app/(app)/plan/PlanClient.tsx`.

**Сырой код:**

```tsx
if (error) {
  return (
    <>
      <TabTitle sublabel="Недельное меню">План</TabTitle>
      <Card className="mb-4" data-testid="plan-error">
        <p className="text-body">{error}</p> {/* ← raw error text */}
        <Link href="/plan/setup" className="text-sm text-[var(--color-primary)] underline">
          Сгенерировать план
        </Link>
      </Card>
    </>
  );
}
```

**Эффект:**

- `error` — это `string` (set где-то ранее через `useState`). Если это `"Plan not found"` → OK (informative, link makes sense).
- Если `"Network error"` или `"INTERNAL_ERROR (500)"` → показывается без actionable recovery.
- Нет retry button → user застрял.
- Нет иконки error → user не понимает severity.

**Смягчающий фактор:** Обычно `error` приходит из API с human-readable message (Russian). OK для большинства случаев.

**Рекомендованный фикс:**

```tsx
if (error) {
  return (
    <>
      <TabTitle sublabel="Недельное меню">План</TabTitle>
      <Card className="mb-4" data-testid="plan-error">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-[var(--color-danger)] shrink-0" aria-hidden />
          <div>
            <h2 className="text-heading mb-1">Не удалось загрузить план</h2>
            <p className="text-body text-text-muted mb-3">{error}</p>
            <div className="flex gap-2">
              <Button onClick={refetch}>Повторить</Button>
              <Link href="/plan/setup">Создать новый план</Link>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
```

### T48-B. ShoppingClient — silent failure via toast 🟡 P3

**Файл:** `apps/web/src/app/(app)/shopping/ShoppingClient.tsx:93`.

**Сырой код:**

```ts
.then((res) => {
  if (cancelled) return;
  if (res.error) toast.show({ message: res.error.error.message, tone: 'warning' });
  else setList(res.data);
  setLoading(false);
})
```

**Эффект:**

- Ошибка → toast на 3 секунды → исчезает.
- Если user не смотрит на toast (смотрит в другую часть экрана, на телефоне в другой таб) → **miss**.
- Нет persistent error state → user не понимает что произошло.
- Toast время может быть слишком коротким для чтения длинного error message.

**Смягчающий фактор:** toast UI accessible.

**Рекомендованный фикс:**

```ts
if (res.error) {
  setError(res.error.error.message); // persistent state
  toast.show({ message: res.error.error.message, tone: 'warning' });
}
```

Рендер persistent error UI аналогично T48-A.

### T48-C. Нет `app/not-found.tsx` для web 🟡 P3

**Файл:** `apps/web/src/app/not-found.tsx` (отсутствует).

**Проверка:**

```bash
$ find apps/web/src -name "not-found*" 2>/dev/null
# (пусто)
```

**Эффект:**

- Next.js routing 404 → default page (English: "404 — This page could not be found").
- При неавторизованном доступе к `/jobs/123` (например) → SSR редирект на login (если middleware работает) или default 404.
- UX: пользователь видит "Page not found" по-английски, хотя приложение на русском.

**Рекомендованный фикс:**

```tsx
// apps/web/src/app/not-found.tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-display mb-2">Страница не найдена</h1>
        <p className="text-body text-text-muted mb-4">
          Возможно, ссылка устарела или страница была удалена.
        </p>
        <Link href="/" className="text-[var(--color-primary)] underline">
          На главную
        </Link>
      </div>
    </main>
  );
}
```

### T48-D. `TodayClient` нет loading state / silent empty 🟡 P3

**Файл:** `apps/web/src/app/(app)/today/TodayClient.tsx:120-128`.

**Сырой код:**

```tsx
return (
  <>
    <TabTitle sublabel="Главный экран">Сегодня</TabTitle>
    <Greeting {...(now ? { now } : {})} />
    <UrgentBlock items={toUrgentItems(pantry.items)} {...(now ? { now } : {})} />
    <BudgetProgress budgetWeekKopecks={budgetWeekKopecks} />
    <HeroButton pantrySize={pantry.items.length} />
    <QuickScenarios />
    <UpcomingMeals activePlan={toUpcomingMeals(activePlan)} />
    <RouletteLink />
  </>
);
```

**Эффект:**

- Mounts immediately, renders with empty data → fetches async → re-renders with data.
- During ~100-500ms loading window: Greeting "Доброе утро" (correct), UrgentBlock empty, BudgetProgress 0, HeroButton with `pantrySize=0`.
- Нет "Loading..." indicator.
- User может видеть brief "0 items" → update → правильный number. Subtle, не broken.

**Смягчающий фактор:** React 19 concurrent rendering делает updates smooth. UX OK.

**Рекомендованный фикс:** Optional — add `<Skeleton />` overlays:

```tsx
{pantry.loading ? <Skeleton className="h-12 mb-3" /> : <BudgetProgress ... />}
```

---

## 2. Подтверждённые здоровые паттерны

- **FridgeClient** empty state — с CTA button ("Добавить продукт"), conditional message. ✓
- **IngredientPicker** empty state — с CTA ("Перейти в холодильник"). ✓
- **PlanClient** empty state — с link на /plan/setup. ✓
- **StorageClient** empty state — "Активного плана нет" с link. ✓
- **ChainTimeline** chain-empty state — fallback message. ✓
- **Skeleton** используется в 5+ местах. ✓
- **Error retry button** в FridgeClient ("Повторить"). ✓
- **LoadingClient** имеет fallback progress bar. ✓
- **toast** library для notifications. ✓
- **`role="status"` / `aria-live`** на dynamic content. ✓

## 3. Микро-наблюдения

- **T48-α** — `toUrgentItems` в TodayClient использует `item.notes ?? item.ingredientId` — fallback на ULID. Не human-friendly.
- **T48-β** — `Recipe StorageTab` имеет fallback `data-testid="storage-tab-empty"` (✓).
- **T48-γ** — `RescueResults` имеет 3 states: `not-found`, `empty`, `network` (RescueError.tsx). ✓
- **T48-δ** — Нет "all empty" state для fridge если `expiring=0 && fresh=0` — handled.
- **T48-ε** — PWA offline state — `sw.js` кэширует shell, но `/today` page при offline → пользователь видит cached version. Good.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона          | Находка                                                                                   | Где                                                     |
| --------- | --------- | ------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **T48-A** | 🟠 P2     | Web / UX      | `PlanClient` error state показывает raw `error.message` без retry button / structured UI. | `apps/web/src/app/(app)/plan/PlanClient.tsx`            |
| **T48-B** | 🟡 P3     | Web / UX      | `ShoppingClient` errors только в toast. Silent failure если user пропустил toast.         | `apps/web/src/app/(app)/shopping/ShoppingClient.tsx:93` |
| **T48-C** | 🟡 P3     | Web / 404     | Нет `app/not-found.tsx`. Next.js default English page.                                    | `apps/web/src/app/not-found.tsx` (отсутствует)          |
| **T48-D** | 🟡 P3     | Web / Loading | `TodayClient` нет loading skeleton. Silent empty-then-fill (OK UX, but no feedback).      | `apps/web/src/app/(app)/today/TodayClient.tsx:120-128`  |

## 5. Куммулятивный итог (48 кругов)

| Iter   | Round   | Topic                      | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | -------------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды)        | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                       | T41-A..D     | 0     | 0     | 2     | 2     |
| 42     | #42     | Pagination                 | T42-A..D     | 0     | 0     | 2     | 2     |
| 43     | #43     | Async races                | T43-A..D     | 0     | 0     | 2     | 2     |
| 44     | #44     | Dependencies               | T44-A..D     | 0     | 0     | 0     | 4     |
| 45     | #45     | React rendering            | T45-A..D     | 0     | 0     | 1     | 3     |
| 46     | #46     | i18n                       | T46-A..D     | 0     | 0     | 2     | 2     |
| 47     | #47     | Modal a11y                 | T47-A..D     | 0     | 0     | 2     | 2     |
| **48** | **#48** | **UX empty/loading/error** | **T48-A..D** | **0** | **0** | **1** | **3** |

## 6. Рекомендации (48-й круг)

1. **(P2, 1ч, T48-A)** Restructure PlanClient error state: icon + heading + retry button + link.
2. **(P3, 30 мин, T48-B)** Persistent error state в ShoppingClient (set + render).
3. **(P3, 15 мин, T48-C)** Добавить `apps/web/src/app/not-found.tsx` с RU copy + link.
4. **(P3, 30 мин, T48-D)** Optional: loading skeletons в TodayClient.

## 7. Артефакты (48-й круг)

| Артефакт                    | Где                             |
| --------------------------- | ------------------------------- |
| Этот отчёт                  | `docs/audit/AUDIT-REPORT-48.md` |
| FIX-PLAN (T48-A,B,C,D)      | `docs/audit/FIX-PLAN.md`        |
| PlanClient raw error UX     | §1 T48-A                        |
| ShoppingClient silent toast | §1 T48-B                        |
| No not-found page           | §1 T48-C                        |
| TodayClient no loading      | §1 T48-D                        |
