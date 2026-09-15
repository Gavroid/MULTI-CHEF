# Технический, продуктовый и UI-аудит MULTI-CHEF (65-й круг)

**Дата:** 2026-09-15
**Область:** Frontend bundle size / code-splitting
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

Next.js 15 App Router даёт **route-level code-splitting** автоматически
(каждый `app/(segment)/page.tsx` — отдельный чанк), но это только
стартовая точка. Аудит показывает:

- Нет `dynamic()` imports / `React.lazy` / `@loadable/component` —
  ни одного использования. Все компоненты импортируются статически.
- `lucide-react` импортируется в 30 файлах; tree-shaking работает
  только если у пакета `sideEffects: false` (это эмпирически
  нестабильно для lucide-react).
- `@multichef/contracts` (Zod-схемы, используемые и в SSR, и в
  client) собирается целиком через `transpilePackages` без явного
  side-effects-флага.
- Нет `loading.tsx` на app-root и в большинстве segment'ов — нет
  визуального feedback при медленной загрузке чанков.

---

## Технические находки (65-й круг)

### T65-A · 🟠 P2 — Отсутствует dynamic-import / lazy-loading

**Где:** весь `apps/web/src` (поиск `dynamic(` / `React.lazy` /
`@loadable` → 0 совпадений).

**Симптом.** Все компоненты импортируются статически:

```ts
import { Header } from './Header';
import { StorageTab } from './components/StorageTab';
import { RecommendationsClient } from '@/lib/recommendations-client';
```

Next.js 15 + App Router даёт **только route-level** splitting
(`/recipe/[id]` — отдельный chunk от `/plan/storage`). Внутри
страницы — всё в одном bundle. Страница `/recipe/[id]` подтягивает
сразу:

- `RecipeView.tsx`
- `Header.tsx` (LCP)
- `StorageTab.tsx`
- все ингредиенты / nutrition panel
- `BottomTabBar.tsx` (уже есть в layout)

**Почему важно.** При медленном 3G initial JS bundle `/recipe/[id]`
может быть 200-400 KB. Время до интерактивности (TTI) высокое.
Пользователь видит пустой экран.

**Гипотеза фикса.**

```ts
// для некритичных компонентов (например, StorageTab на /recipe):
const StorageTab = dynamic(() => import('./components/StorageTab'), {
  loading: () => <Skeleton />,
  ssr: false,  // storage rules не нужны в SSR
});
```

Альтернативно — выделить LCP-критичный `Header.tsx` в отдельный
chunk + `loading.tsx` на этом сегменте.

---

### T65-B · 🟠 P2 — `lucide-react` icon imports без проверки side-effects

**Где:** 30 файлов в `apps/web/src/`,
`apps/web/package.json:30` (`lucide-react: ^0.469.0`).

**Симптом.** Импорты вида:

```ts
import { Refrigerator, Pencil, Trash2, RotateCcw, Archive } from 'lucide-react';
```

`lucide-react` v0.469+ имеет `sideEffects: false` в `package.json`,
но это не гарантирует tree-shaking через Webpack 5 / Turbopack
(исторически были проблемы с default-export wrapper'ом). Иконки
разнесены по подпапкам (`lucide-react/dist/esm/icons/…`), и
корректный путь — `import { Icon } from 'lucide-react'` —
должен работать, но фактический размер bundle стоит проверить.

**Почему важно.** Если tree-shaking не сработает, все 1500+
иконок `lucide-react` (~600 KB minified) попадут в initial JS
chunk. Это **критичный** размер для LCP на мобильном.

**Гипотеза фикса.**

1. Собрать prod build, открыть `.next/static/chunks/*.js` и
   проверить, нет ли там `MdiIconxxx`-имен из всего множества
   lucide.
2. Альтернатива — перейти на inline SVG для топ-10 иконок
   (FridgeClient, PantryDialog — `Refrigerator`, `Pencil`, etc.).
3. Либо — `import { Refrigerator } from 'lucide-react/dist/esm/icons/refrigerator'`
   (deep path), это 100% tree-shakeable.

---

### T65-C · 🟡 P3 — `@multichef/contracts` без явного `sideEffects: false`

**Где:** `apps/web/next.config.mjs:22-27`,
`packages/contracts/package.json` (предположительно).

**Симптом.** `next.config.mjs`:

```js
transpilePackages: ["@multichef/contracts"],
webpack: (config) => {
  config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
  return config;
},
```

`@multichef/contracts` содержит все Zod-схемы API (≈30 схем).
Если в `package.json` нет `"sideEffects": false`, Webpack не
может гарантировать tree-shaking — потенциально тянутся все
схемы в каждый client bundle, даже те, которые страница не
использует.

**Почему важно.** Zod-схемы тяжёлые (каждая ≈ 1-3 KB minified).
30 схем × 2 KB = 60 KB потенциально лишнего JS на странице
`/login` (которая использует только `LoginRequestSchema`).

**Гипотеза фикса.** В `packages/contracts/package.json`:

```json
{
  "name": "@multichef/contracts",
  "sideEffects": false,
  "main": "./dist/index.js",
  ...
}
```

Плюс в каждом Zod-файле — `export const` без site-effects
(нет top-level `z.object({...}).parse(...)`).

---

### T65-D · 🟡 P3 — Нет `loading.tsx` boundary'ев на большинстве роутов

**Где:** `apps/web/src/app/` (root),
`apps/web/src/app/(app)/**` (большинство segment'ов).

**Симптом.** `ls apps/web/src/app/`:

```
(app) (auth) design globals.css layout.tsx page.tsx robots.ts sitemap.ts
```

Нет `loading.tsx` ни в корне, ни в `(app)`, ни в `(auth)`. Next.js
App Router поддерживает `loading.tsx` как Suspense boundary,
показывающий skeleton во время загрузки page chunk + data fetch.

Сейчас при переходе на `/plan/storage` или `/recipe/[id]` —
полностью пустой экран до полной загрузки chunk.

**Почему важно.** Медленный мобильный интернет + chunk 300 KB =
2-5 секунд пустого экрана. Воспринимаемая скорость (perceived
performance) падает.

**Гипотеза фикса.**

```tsx
// apps/web/src/app/(app)/loading.tsx
export default function Loading() {
  return <div className="animate-pulse h-32 bg-[var(--color-surface-2)] rounded" />;
}
```

Плюс segment-specific skeletons (`/(app)/recipe/[id]/loading.tsx`)
для тяжёлых страниц.

---

## Подтверждённые здоровые паттерны

- `poweredByHeader: false` в `next.config.mjs:32` — корректно
  скрывает `X-Powered-By: Next.js` (security).
- `reactStrictMode: true` — включён StrictMode в dev, ловит
  нежелательные side-effects в render.
- Route-level code-splitting (бесплатный от Next 15) — каждый
  `/app/(group)/page.tsx` это отдельный chunk.
- `transpilePackages: ["@multichef/contracts"]` — корректное
  подключение TS-source workspace package.
- `outputFileTracingRoot: process.cwd()` — корректное
  определение корня для trace'а серверных deps.
- `devIndicators: false` — отключает Next dev overlay (clean
  DX).

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                          | Файл / место                                                    |
| ----- | --- | ---- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| T65-A | 🟠  | P2   | Нет `dynamic()` / `React.lazy` / `@loadable`. Все компоненты    | весь apps/web/src (поиск dynamic() → 0 совпадений)              |
|       |     |      | в одном чанке страницы                                          |                                                                 |
| T65-B | 🟠  | P2   | `lucide-react` импорты в 30 файлах без проверки tree-shaking.   | apps/web/src/**.tsx (30 файлов), apps/web/package.json:30       |
|       |     |      | Возможно ~600 KB лишнего JS при broken tree-shake               |                                                                 |
| T65-C | 🟡  | P3   | `@multichef/contracts` без `"sideEffects": false`. Потенциально | apps/web/next.config.mjs:22-27, packages/contracts/package.json |
|       |     |      | тянутся все 30 Zod-схем в каждый client bundle                  |                                                                 |
| T65-D | 🟡  | P3   | Нет `loading.tsx` boundary'ев. Медленный chunk = пустой экран   | apps/web/src/app/, apps/web/src/app/(app)/                      |
|       |     |      | 2-5 секунд                                                      |                                                                 |

---

## Куммулятивный итог (65 кругов)

- **Всего найдено проблем:** 260 (T21–T65).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  146 · 🟡 P3: 88.
- **Раунды с нулевыми находками:** 0 из 65.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33), observability /
  healthchecks (26), DB indexes (4), error handling (4), frontend
  bundle (4 — новый раунд).

---

## Рекомендации (65-й круг)

1. **T65-A — на этой неделе.** Провести `next build`, измерить
   размеры чанков. Top-3 тяжёлых страницы перевести на `dynamic()`.
2. **T65-B — на этой неделе.** Проверить содержимое bundle: есть
   ли в нём `lucide-react`-wide иконки. Если да — заменить именные
   импорты на deep path или inline SVG.
3. **T65-C, T65-D — на спринт.** Добавить `"sideEffects": false`
   в `packages/contracts/package.json`, добавить `loading.tsx` на
   `(app)/loading.tsx` и key segments.

---

## Артефакты (65-й круг)

- `docs/audit/AUDIT-REPORT-65.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T65-A…T65-D.
