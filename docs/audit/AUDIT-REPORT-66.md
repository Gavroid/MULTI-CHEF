# Технический, продуктовый и UI-аудит MULTI-CHEF (66-й круг)

**Дата:** 2026-09-15
**Область:** Mobile responsiveness / PWA capabilities
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

MULTI-CHEF позиционируется как «mobile-first» (см. описание в
`apps/web/package.json:4` — «Next.js 15 web app (App Router, TS
strict, mobile-first)»). PWA-инфраструктура есть: `manifest.
webmanifest`, `sw.js`, `PwaRegister.tsx`. Но:

1. **Нет ни одного Tailwind responsive breakpoint'а** (`sm:`,
   `md:`, `lg:`) — `grep` по `apps/web/src` → 0 совпадений.
   Desktop layout — узкая одноколоночная mobile-версия.
2. **Service worker precache** покрывает только `/today`, `/`,
   `/manifest.webmanifest`, `/icons/icon.svg`. План / Shopping /
   Prep / Recipe offline не работают.
3. **Manifest имеет только SVG icon** (`sizes: "any"`). iOS
   installable UX слабый, нет `apple-touch-icon`, нет PNG 192/512.
4. **Viewport без `maximumScale`** — потенциально мешает zoom для
   пользователей с ослабленным зрением (WCAG 1.4.4 Resize text).

---

## Технические находки (66-й круг)

### T66-A · 🟠 P2 — Нет responsive breakpoints в UI

**Где:** весь `apps/web/src/**/*.tsx` (поиск `sm:|md:|lg:|xl:` →
0 совпадений).

**Симптом.** Tailwind настроен (`tailwindcss: ^3.4.17` в
`apps/web/package.json:48`), responsive-классы доступны, но не
используются нигде. Все layout'ы — одноколоночные. На desktop
1920×1080 содержимое `/plan/storage` рендерится в левой трети
экрана, остальное — пустое.

**Почему важно.** Десктопные пользователи (а это не только
«приложение для кухни», но и планирование на ноутбуке)
получают sub-optimal UX. Страдает конверсия B2B-сценариев
(продуктовые менеджеры, нутрициологи).

**Гипотеза фикса.**

```tsx
// apps/web/src/app/(app)/plan/storage/StorageClient.tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map(...)}
</div>
```

Минимально — добавить `md:` breakpoint в топ-5 layout-критичных
страницах: `/plan/storage`, `/plan`, `/recipe/[id]`,
`/shopping`, `/fridge`.

---

### T66-B · 🟠 P2 — Service worker precache покрывает только `/today`

**Где:** `apps/web/public/sw.js:5`.

**Симптом.**

```js
const SHELL_URLS = ['/', '/today', '/manifest.webmanifest', '/icons/icon.svg'];
const SWR_PREFIXES = [
  '/api/v1/meal-plans/active',
  '/api/v1/shopping-lists/active',
  '/api/v1/recipes',
];
```

App-shell precache содержит только `/` и `/today`. При открытии
PWA на самолёте (без сети) `/plan/storage`, `/shopping`,
`/recipe/01HFAKE…`, `/fridge` показывают «страница недоступна».

`SWR_PREFIXES` для API есть, но это stale-while-revalidate —
**первый** запрос без кэша = network failure.

**Гипотеза фикса.** Расширить `SHELL_URLS`:

```js
const SHELL_URLS = [
  '/',
  '/today',
  '/plan',
  '/shopping',
  '/fridge',
  '/recipe',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/offline', // ← dedicated fallback
];
```

Плюс handler:

```js
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline')));
  }
  // ... остальные стратегии
});
```

Плюс `apps/web/src/app/offline/page.tsx` с осмысленным сообщением.

---

### T66-C · 🟡 P3 — Manifest без `apple-touch-icon` и PNG-иконок

**Где:** `apps/web/public/manifest.webmanifest`,
`apps/web/public/icons/` (только `icon.svg`).

**Симптом.**

```json
"icons": [
  { "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
]
```

iOS Safari **не поддерживает SVG manifest icons** — при
«Add to Home Screen» рендерит пустую/битую иконку. Android Chrome
поддерживает, но для maskable нужны 192×192 и 512×512 PNG.

**Почему важно.** Установка PWA на iPhone (≈30% мобильного
трафика в РФ) даёт broken icon. Пользователь не понимает, что
приложение установлено.

**Гипотеза фикса.** Сгенерировать PNG из SVG (через `sharp` /
`@resvg/resvg-js` в CI):

```bash
# build-icons.sh
sharp -i public/icons/icon.svg -o public/icons/icon-192.png resize 192 192
sharp -i public/icons/icon.svg -o public/icons/icon-512.png resize 512 512
```

И обновить manifest:

```json
"icons": [
  { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
]
```

Плюс `<link rel="apple-touch-icon" href="/icons/icon-180.png" />`
в `layout.tsx`.

---

### T66-D · 🟡 P3 — `viewport` без `maximumScale` мешает zoom пользователям

**Где:** `apps/web/src/app/layout.tsx:28-?`.

**Симптом.**

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // нет maximumScale, нет userScalable
};
```

Стандартный «mobile-friendly» viewport, но отсутствие
`userScalable: true` (или эквивалента — не задавать
`maximumScale=1`) — это best-practice для a11y. Некоторые
старые сайты задавали `maximum-scale=1` чтобы блокировать
zoom, что нарушает WCAG 1.4.4.

Здесь `maximumScale` не задан → поведение по умолчанию
различается между iOS Safari и Android Chrome. На iOS по
умолчанию может быть `maximum-scale=1`, что плохо для
слабовидящих.

**Гипотеза фикса.**

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Explicitly allow user scaling up to 5×; assistive tech and
  // low-vision users rely on browser-level zoom (WCAG 1.4.4).
  maximumScale: 5,
  userScalable: true,
};
```

---

## Подтверждённые здоровые паттерны

- `theme_color: '#ff6b35'` и `background_color: '#ffffff'` в
  manifest — задаёт chrome status bar.
- `display: 'standalone'` — PWA без browser UI, full-screen
  опыт.
- `start_url: '/today'` — landing прямо в продуктивный экран.
- `PwaRegister` использует `useEffect` — корректная
  client-side-only инициализация SW.
- SW `version = 'v1'` с `caches.delete` старых — корректный
  upgrade-flow при деплое.
- `apple-mobile-web-app-capable` через Next viewport API —
  базовая iOS-интеграция работает.

---

## Сводка таблицой (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                          | Файл / место                                       |
| ----- | --- | ---- | --------------------------------------------------------------- | -------------------------------------------------- |
| T66-A | 🟠  | P2   | Нет ни одного responsive Tailwind breakpoint'а (`sm:` / `md:` / | apps/web/src/**.tsx (grep → 0 совпадений)          |
|       |     |      | `lg:`). Desktop layout = mobile-layout                          |                                                    |
| T66-B | 🟠  | P2   | SW precache покрывает только `/today` и `/`. Offline: plan /    | apps/web/public/sw.js:5                            |
|       |     |      | shopping / recipe = «страница недоступна»                       |                                                    |
| T66-C | 🟡  | P3   | Manifest только SVG icon. iOS installable UX битый.             | apps/web/public/manifest.webmanifest, public/icons |
|       |     |      | Нет apple-touch-icon, нет 192/512 PNG                           |                                                    |
| T66-D | 🟡  | P3   | `viewport` без `maximumScale: 5` / `userScalable: true`. WCAG   | apps/web/src/app/layout.tsx:28-?                   |
|       |     |      | 1.4.4 «Resize text» потенциально нарушен                        |                                                    |

---

## Куммулятивный итог (66 кругов)

- **Всего найдено проблем:** 264 (T21–T66).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  148 · 🟡 P3: 90.
- **Раунды с нулевыми находками:** 0 из 66.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33), observability /
  healthchecks (26), DB indexes (4), error handling (4), frontend
  bundle (4), PWA / mobile (4 — новый).

---

## Рекомендации (66-й круг)

1. **T66-A — на этой неделе.** Добавить `md:` и `lg:` breakpoints
   в 5 ключевых layout'ах (storage, plan, recipe, shopping,
   fridge). Это десяток классов, низкий риск.
2. **T66-B — на этой неделе.** Расширить SW `SHELL_URLS`,
   добавить `/offline` fallback page.
3. **T66-C, T66-D — на спринт.** Сгенерировать PNG-иконки 192/512,
   добавить apple-touch-icon. Зафиксировать `maximumScale: 5` в
   viewport.

---

## Артефакты (66-й круг)

- `docs/audit/AUDIT-REPORT-66.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T66-A…T66-D.
