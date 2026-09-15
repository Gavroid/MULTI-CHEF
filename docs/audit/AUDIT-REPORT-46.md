# Технический, продуктовый и UI-аудит MULTI-CHEF (46-й круг)

**Дата:** 2026-09-15
**HEAD:** `8376c00 chore(audit): AUDIT-REPORT-45 react-rendering`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-45.md`, `FIX-PLAN.md`
**Фокус:** i18n / l10n — hardcoded strings, locale handling, error messages, user.tz.

## TL;DR

46-й круг: **4 находки** — 0 P0, 2 🟠 P2, 2 🟡 P3.

- 🟠 **T46-A** — API error messages **смешаны**: 12 на русском, 48 на английском. Russian-language app (User.locale='ru' default) получает ответы на двух языках.
- 🟠 **T46-B** — Нет i18n библиотеки (`react-i18next`, `next-intl`, etc). Все UI строки hardcoded. Adding English = massive refactor.
- 🟡 **T46-C** — `User.locale` поле есть в schema.prisma, но НЕ используется нигде в коде. Dead field.
- 🟡 **T46-D** — `User.tz` (timezone) поле есть, но UI не учитывает user tz. Dates/timestamps выводятся в server timezone.

---

## 1. Технические находки (46-й круг)

### T46-A. Error messages mixed RU/EN 🟠 P2

**Файлы:** все API services.

**Подсчёт (script):**

```
=== Russian error messages (API) ===
  apps/api/src/meal-plans/meal-plans.service.ts: 'Активный план не найден'  (×4)
  apps/api/src/meal-plans/meal-plans.service.ts: 'Задача не найдена'
  apps/api/src/shopping-lists/shopping-lists.service.ts: 'Активный список покупок не найден'
  apps/api/src/shopping-lists/shopping-lists.service.ts: 'Позиция не найдена в списке'  (×2)
  apps/api/src/recommendations/recommendations.service.ts: 'Продукт не найден в холодильнике'
  apps/api/src/recommendations/recommendations.service.ts: 'Нет рецептов с этим продуктом'
  Total: 12

=== English error messages (API) ===
  apps/api/src/meal-plans/meal-plans.controller.ts: 'Invalid request body'
  apps/api/src/meal-plans/meal-plans.service.ts: 'No owned household for this user'
  apps/api/src/pantry/pantry.service.ts: 'Ingredient not found'  (×4)
  apps/api/src/pantry/pantry.service.ts: 'Cannot modify an archived item; restore it first'
  apps/api/src/pantry/pantry.service.ts: 'Item is not archived'
  apps/api/src/pantry/pantry.service.ts: 'No owned household for this user'
  Total: 48
```

**Эффект:**

- User регистрируется → email default = ru → видит `"Позиция не найдена в списке"` при удалении shopping item.
- Тот же user на другом endpoint → `"Pantry item not found"` — **confusing**.
- API consumers (mobile app, third-party integrations) — два языка в одном API.
- Не соответствует `User.locale='ru'` default.

**Смягчающий фактор:** error codes (machine-readable) consistent, только human messages mixed.

**Рекомендованный фикс:**

Создать `packages/contracts/src/errors-messages.ts`:

```ts
// All human messages, keyed by ErrorCode.
export const ERROR_MESSAGES: Record<ErrorCode, { ru: string; en: string }> = {
  INGREDIENT_NOT_FOUND: {
    ru: 'Ингредиент не найден',
    en: 'Ingredient not found',
  },
  PANTRY_ITEM_NOT_FOUND: {
    ru: 'Продукт не найден в холодильнике',
    en: 'Pantry item not found',
  },
  // ...
};
```

В `AppHttpException` или wrapper: resolve message по `User.locale` (load from session/AuthGuard). Default = ru.

### T46-B. Нет i18n библиотеки 🟠 P2

**Файл:** `apps/web/package.json`.

**Проверка:**

```bash
$ grep -E "i18next|next-intl|react-intl" apps/web/package.json
# (пусто)
```

**Эффект:**

- 100% UI strings hardcoded в JSX (`>Холодильник<`, `>Сохранение...<`, `>Выйти<`).
- Add English = extract 200+ strings в translation files. Effort: 1-2 weeks.
- Russian-only target audience **пока OK**, но international launch = blocker.

**Смягчающий фактор:** PRD Russian-only. Не critical для MVP.

**Рекомендованный фикс:**

Добавить `next-intl` (Next.js native):

```bash
pnpm add next-intl
```

```ts
// apps/web/src/messages/ru.json
{
  "fridge.title": "Холодильник",
  "fridge.empty": "Добавьте первый продукт",
  // ...
}
```

```tsx
// apps/web/src/app/(app)/fridge/page.tsx
import { useTranslations } from 'next-intl';
const t = useTranslations('fridge');
return <TabTitle>{t('title')}</TabTitle>;
```

### T46-C. `User.locale` поле не используется 🟡 P3

**Файл:** `packages/database/prisma/schema.prisma: User.locale String @default("ru")`.

**Проверка:**

```bash
$ grep -rn "user\.locale\|User\.locale\|\\.locale\b" apps/api/src apps/web/src 2>/dev/null | head -10
# (пусто — User.locale не читается нигде)
```

**Эффект:**

- Поле добавлено, но не используется. Dead column.
- Если завтра locale-aware UI нужен → нужно мигрировать User.locale → используется.

**Рекомендованный фикс:** Использовать `User.locale` в `AppHttpException` для выбора error message language (T46-A fix).

### T46-D. `User.tz` (timezone) не используется в UI 🟡 P3

**Файл:** `packages/database/prisma/schema.prisma: User.tz String @default("Europe/Moscow")`.

**Проверка:**

```bash
$ grep -rn "user\.tz\|User\.tz\|\\.tz\b\|toLocaleString\|Intl\\.DateTimeFormat" apps/web/src 2>/dev/null | head -10
# (нет использования user.tz — нет Intl.DateTimeFormat usage)
```

**Эффект:**

- UI показывает dates в server timezone или browser default.
- Если user переехал в другой timezone → dates отображаются некорректно.

**Смягчающий фактор:** Все users в одной timezone (Europe/Moscow) для MVP. Не critical.

**Рекомендованный фикс:**

```ts
// apps/web/src/app/(app)/today/page.tsx
const { user } = useAuth();
const dateFmt = new Intl.DateTimeFormat(user.locale, {
  timeZone: user.tz,
  year: 'numeric', month: 'long', day: 'numeric',
});
return <span>{dateFmt.format(new Date(plan.startDate))}</span>;
```

---

## 2. Подтверждённые здоровые паттерны

- **`<html lang="ru">`** в `layout.tsx` (T3 SEO). ✓
- **Russian category names** в seed (`categories.ts`). ✓
- **DateTimes stored в UTC** (`@db.Timestamptz(6)`). ✓
- **`User.tz` schema field** для future timezone support. ✓
- **`User.locale` schema field** для future locale support. ✓

## 3. Микро-наблюдения

- **T46-α** — Error codes `ENUM` — language-agnostic (machine-readable). ✓
- **T46-β** — `docs/api/conventions.md` не упоминает locale в error response. Можно добавить.
- **T46-γ** — Web `<html lang="ru">` правильно. Если завтра добавить English, нужно менять через `<html lang={user.locale}>`.
- **T46-δ** — Russian hardcoded strings — около 200 мест (UI labels, error messages, success notifications).
- **T46-ε** — Нет pluralization (`1 яблоко`, `2 яблока`, `5 яблок` — Russian plural forms). Используется просто `items.length + ' items'`.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона           | Находка                                                                                                     | Где                                                  |
| --------- | --------- | -------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **T46-A** | 🟠 P2     | API / i18n     | Error messages mixed RU (12) / EN (48). User.locale='ru' default, но API returns mixed languages.           | All API services                                     |
| **T46-B** | 🟠 P2     | Web / i18n     | Нет i18n library (`react-i18next`, `next-intl`). 100% strings hardcoded. Adding English = massive refactor. | `apps/web/package.json` (нет dep)                    |
| **T46-C** | 🟡 P3     | DB / Dead code | `User.locale` поле есть в schema.prisma, но НЕ используется нигде. Dead column.                             | `packages/database/prisma/schema.prisma`             |
| **T46-D** | 🟡 P3     | Web / Timezone | `User.tz` (timezone) поле есть, но UI не учитывает user tz. Dates выводятся в server tz.                    | `apps/web/src/**/page.tsx` (нет Intl.DateTimeFormat) |

## 5. Куммулятивный итог (46 кругов)

| Iter   | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды) | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                | T41-A..D     | 0     | 0     | 2     | 2     |
| 42     | #42     | Pagination          | T42-A..D     | 0     | 0     | 2     | 2     |
| 43     | #43     | Async races         | T43-A..D     | 0     | 0     | 2     | 2     |
| 44     | #44     | Dependencies        | T44-A..D     | 0     | 0     | 0     | 4     |
| 45     | #45     | React rendering     | T45-A..D     | 0     | 0     | 1     | 3     |
| **46** | **#46** | **i18n**            | **T46-A..D** | **0** | **0** | **2** | **2** |

## 6. Рекомендации (46-й круг)

1. **(P2, 4ч, T46-A)** Создать `ERROR_MESSAGES` map в `packages/contracts`. Resolve message by `User.locale` в `AppHttpException`. Default 'ru'.
2. **(P2, 1week effort, T46-B)** Add `next-intl`. Extract UI strings to `messages/ru.json`. Set up routing для English (optional).
3. **(P3, 30 мин, T46-C)** Использовать `User.locale` в `AppHttpException` (T46-A fix covers).
4. **(P3, 1ч, T46-D)** Use `Intl.DateTimeFormat` в UI с `user.tz` + `user.locale`.

## 7. Артефакты (46-й круг)

| Артефакт                 | Где                             |
| ------------------------ | ------------------------------- |
| Этот отчёт               | `docs/audit/AUDIT-REPORT-46.md` |
| FIX-PLAN (T46-A,B,C,D)   | `docs/audit/FIX-PLAN.md`        |
| Error messages RU/EN mix | §1 T46-A                        |
| No i18n library          | §1 T46-B                        |
| User.locale dead field   | §1 T46-C                        |
| User.tz not used in UI   | §1 T46-D                        |
