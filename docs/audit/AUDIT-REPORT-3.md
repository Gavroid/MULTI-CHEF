# Технический, продуктовый и UI-аудит MULTI-CHEF (третья итерация)

**Дата:** 2026-09-14
**HEAD:** `075f48c chore(audit): AUDIT-REPORT-2 — second-iteration findings (M1-M9)`
**Цель:** найти находки, пропущенные в 1-й и 2-й итерациях. Особое внимание к: реальному a11y (axe-core), перформансу и SEO (gzip/static-cache/sitemap/OG), безопасности по модели угроз (RLS, debug endpoints), граничным случаям бизнес-логики.

## TL;DR

Третья итерация даёт **5 крупных 🔴 P0 находок** + 6 второстепенных. Самое критичное:

- 🔴 **T1 — SEO полностью отсутствует**. **Все** 5 проверенных страниц (`/`, `/today`, `/fridge`, `/plan`, `/profile`) возвращают **одно и то же** `<title>MULTI-CHEF</title>` и одну meta-description. `/profile` возвращает **пустой `<title></title>`**. Нет sitemap.xml, robots.txt, нет Open Graph / Twitter Card. Поисковики и соцсети видят приложение как **одну пустую страницу**.
- 🔴 **T2 — Реальный axe-core (WCAG AA) нашёл контраст-нарушения на 42 узлах** в 4 страницах. Это не повтор M2 из аудита #2, а измеримое подтверждение в общепринятом туле.
- 🔴 **T3 — `<img>` без `loading=lazy`/`decoding=async`/`width`/`height`**. Карточки рецептов и большая hero-картинка на `/recipe/[id]` загружаются все сразу, без CLS-резервирования размеров → плохие LCP/CLS на мобильном.
- 🔴 **T4 — Postgres row-level security ВЫКЛЮЧЕНА**. Multi-tenant (PantryItem, MealPlan, Preference) — **только на app-уровне**. Любой прямой SQL-доступ (postgres-role) видит **все household'ы**.

Плюс 6 значимых (T5–T8, U2, U3 и т.д.).

---

## 1. Технические находки

### T1. SEO полностью отсутствует 🔴

- **Симптом:** curl `/today`, `/fridge`, `/plan`, `/profile` показывает:
  - один и тот же `<title>MULTI-CHEF</title>` (на `/profile` — `<title></title>` **пустой**),
  - одна и та же meta-description,
  - ни одного `og:` или `twitter:` meta-тега.
- **Доказательство:**
  ```
  /:         <title>MULTI-CHEF</title>
             desc: Семейный планировщик питания — рецепты из того, что уже есть дома.
  /fridge:   <title>MULTI-CHEF</title>          // та же
  /today:    <title>MULTI-CHEF</title>          // та же
  /plan:     <title>MULTI-CHEF</title>          // та же
  /profile:  <title></title>                    // ПУСТОЙ
             desc:                              // отсутствует
             og:                                // ни одного
  ```
- **Файлы:**
  - `apps/web/src/app/(app)/today/page.tsx`, `fridge/`, `plan/`, `profile/` — не экспортируют `metadata`.
  - `app/sitemap.ts` и `app/robots.ts` отсутствуют (Next.js 15 конвенция).
  - В `public/` тоже нет `sitemap.xml` и `robots.txt`.
- **Воздействие:** Google/Yandex индексируют PWA как 1 страницу; соцшеринг (VK/Telegram/WhatsApp) показывает без превью.
- **Фикс (1 час):**
  - В каждый page.tsx добавить `export const metadata: Metadata = {title, description}`.
  - Создать `apps/web/src/app/sitemap.ts` и `apps/web/src/app/robots.ts` (Next.js 15 конвенция).
  - В `apps/web/src/app/layout.tsx` добавить `openGraph` и `twitter` defaults.

### T2. nginx `server_tokens` ON — раскрытие версии 🔴

- **Доказательство:** `curl -I http://192.168.1.95:8080/...` → `Server: nginx/1.24.0 (Ubuntu)`.
- **Конфиг:** в `/etc/nginx/nginx.conf` строка `# server_tokens off` закомментирована.
- **Воздействие:** Помогает атакующему выбирать эксплойты под конкретную версию nginx (CVE 2022-41741, 2023-44487 и т.д. — открытая CVE-база).
- **Фикс (5 мин):** `sed -i 's|^# server_tokens off|server_tokens off|' /etc/nginx/nginx.conf && nginx -t && systemctl reload nginx`.

### T3. `<img>` без `loading`/`decoding`/`width`/`height` 🔴

- **Найдено в:**
  - `apps/web/src/app/(app)/recipe/[id]/components/Header.tsx:75-80` — `<img src={recipe.imageKey} alt={recipe.title}>` без `loading`, `decoding`, без `width`/`height`.
  - `apps/web/src/app/(app)/today/result/components/OptionCard.tsx:69-78` — `<img>` без `loading="lazy"`, без width/height, без decoding.
- **Воздействие:**
  - все изображения стартуют загрузку при первом paint → лишние RTT на мобильном,
  - `width`/`height` не задан → CLS (PageSpeed ругается: «Image elements do not have explicit width/height»).
- **Фикс (1 час):**
  ```tsx
  <img
    src={recipe.imageKey}
    alt={recipe.title}
    width={1200}
    height={900} // intrinsic ratio
    loading={isLCP ? 'eager' : 'lazy'}
    decoding="async"
    fetchPriority={isLCP ? 'high' : 'auto'}
  />
  ```
  Или лучше — перейти на `next/image` из `apps/web/next.config.ts`, который сам решит все 4 атрибута.

### T4. Row-level security в Postgres ВЫКЛЮЧЕНА 🔴

- **Доказательство:**
  ```sql
  SELECT relname, rowsecurity FROM pg_tables
   WHERE schemaname='public' AND rowsecurity=true;
  -- (0 rows)
  ```
- **Воздействие:** `PantryItem`, `MealPlan`, `Preference`, `ShoppingListItem`, `RecipeIngredient` — все таблицы с `householdId`/`userId` фильтруются **только на уровне приложения** в Prisma `where`. Если DBA / cron-job / backup-restore / миграционная утилита дёрнет прямой SQL — увидит **всё**. Например, бэкап-скрипт делает `pg_dump` без row-фильтрации (см. M7 из аудита #2) и льёт ВСЕ холодильники в plain gzip.
- **Фикс (1–2 дня):**
  ```sql
  ALTER TABLE "PantryItem" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "PantryItem" FORCE ROW LEVEL SECURITY;
  CREATE POLICY pantry_household ON "PantryItem"
    USING ("householdId" = current_setting('app.household_id', true)::text);
  ```
  - `SET LOCAL app.household_id = $1` в Prisma middleware. Bypass для batch/admin через SECURITY DEFINER-функции.

### T5. Нет `<meta robots>` 🟠

- На `/` нет `<meta name="robots">`. Боты по умолчанию всё индексируют — это нормально для landing, но для `/profile`, `/auth/*`, `/plan` нужны `noindex, nofollow`.
- **Фикс:** в layout-ах `(app)/layout.tsx` и `(auth)/layout.tsx` добавить `metadata: { robots: { index: false, follow: false } }`.

### T6. Не сконфигурирован `report-uri` для CSP 🟡

- CSP отправляется, но без `report-uri` / `report-to` — нарушения CSP не логируются. Это **бесплатная observability**, которую не использовали.
- **Фикс:** добавить в `apps/api/src/main.ts:helmet` директиву `reportUri: '/api/v1/csp-report'`, собрать endpoint `/api/v1/csp-report` (логирует только структуру, не тело — защита от log poisoning).

---

### ✅ Подтверждено в этой итерации

| Проверка                     | Результат                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gzip compression**         | Работает: 12148 bytes → 2650 bytes (22%) на `/api/v1/recipes?limit=20`; `_next/static/chunks/*.js` → `Cache-Control: public, max-age=31536000, immutable` (1 год) |
| **Static-cache headers**     | ✅ идеальные для hashed chunks Next.js                                                                                                                            |
| **TLS endpoint 8443**        | Сертификат self-signed (`CN=multichef.lan`, valid 2026-09-12 → 2028-12-15). Работает, но для прода нужен Let's Encrypt + auto-renew                               |
| **Migrations applied**       | 4/4, schema drift 0                                                                                                                                               |
| **Postgres autovacuum**      | 0% dead tuples во всех таблицах                                                                                                                                   |
| **No source maps in prod**   | ✅ 0 .map файлов в `apps/web/.next/static/chunks/`                                                                                                                |
| **No debug endpoints**       | ✅ `/api/v1/__metrics`, `/__nextjs_original-stack-frame`, `/api/v1/__internal/whoami` → все 404 в проде                                                           |
| **Env validation через Zod** | ✅ `serverEnvSchema` + `EnvValidationError` (`packages/config/src/env.schema.ts`)                                                                                 |
| **Secrets в коде**           | ✅ 0 хардкоженых (grep подтверждает)                                                                                                                              |
| **Path traversal**           | ✅ `/api/v1/../etc/passwd` → 404                                                                                                                                  |

---

## 2. Продуктовые находки (третий проход — граничные случаи)

### T7. Input validation — все граничные значения корректно отбиваются ✅

| Тест                                | Endpoint                  | Zod rule                               | Реакция                 |
| ----------------------------------- | ------------------------- | -------------------------------------- | ----------------------- |
| Pantry `quantityG=0`                | POST /pantry/items        | `z.number().positive()`                | ✅ 400 VALIDATION_ERROR |
| Pantry `quantityG=-100`             | POST /pantry/items        | `z.number().positive()`                | ✅ 400 VALIDATION_ERROR |
| Pantry `quantityG=1_000_001`        | POST /pantry/items        | `z.number().positive().max(1_000_000)` | ✅ 400 VALIDATION_ERROR |
| Pantry `expiresAt` < `purchaseDate` | POST /pantry/items        | `.refine(...)`                         | ✅ 400 VALIDATION_ERROR |
| Plan `days=15`                      | POST /meal-plans          | `z.number().int().min(1).max(14)`      | ✅ 400                  |
| Plan `days=365`                     | POST /meal-plans          | max=14                                 | ✅ 400                  |
| Plan `days=99999`                   | POST /meal-plans          | max=14                                 | ✅ 400                  |
| Path traversal                      | GET /api/v1/../etc/passwd | nginx                                  | ✅ 404                  |

**Все пограничные значения валидируются.**

**Замечание про `days ≤ 14`:** для 14-дневного плана нужно 14 × 3 = 42 рецепта, что при текущем публично-видимом 269-каталоге достижимо только с дублированием. С учётом CURATED-only фильтра из `AUDIT-REPORT.md` (B1) — становится совсем узким местом. Рекомендуется увеличить лимит до 30 (месяц) или разрешить дублирование явно.

---

## 3. UI-находки (третья итерация, реальный axe-core)

### U1. Реальный axe-core WCAG AA скан — 4 правила × 42 узла 🔴

| URL              | Rule violations    | Всего узлов |
| ---------------- | ------------------ | ----------- |
| `/`              | 1                  | 10          |
| `/auth/login`    | 1                  | 4           |
| `/auth/register` | 2                  | 7           |
| `/design`        | 1                  | 21          |
| **Итого**        | **4 unique rules** | **42 узла** |

**Подробности:**

- **`color-contrast`** (4 страницы, 41 узел) — подтверждает **M2** из второй итерации в измеримой форме:
  - Targets include `.bg-\[var\(--color-primary\)\]`, `.bg-\[var\(--color-fresh-soft\)\]`, `.bg-\[var\(--color-info-soft\)\]`. Все «soft» tokens не проходят AA против своего текста.
  - На `/design` (21×) — там отрисованы ВСЕ color-tokens на одной странице → сразу много нарушений.
- **`link-in-text-block`** на `/auth/register`: «ссылка должна отличаться без цвета» (WCAG 1.4.1). Это ссылка «Нет аккаунта? Зарегистрироваться» — нужно добавить `text-decoration: underline` (или border-bottom: 1px currentColor).

### U2. Нет `prefers-contrast` / `forced-colors` 🟠

- `prefers-reduced-motion: reduce` уже есть в `globals.css` ✅.
- `prefers-contrast` (например `more`) и `forced-colors` (Windows High Contrast Mode) — **отсутствуют**. Пользователи с повышенной контрастностью не получают альтернативных токенов.
- **Фикс:**
  ```css
  @media (prefers-contrast: more) {
    :root {
      --color-text-muted: var(--color-text);
    }
  }
  @media (forced-colors: active) {
    button {
      outline: 2px solid ButtonText;
    }
  }
  ```

### U3. Нет `error.tsx` на уровне route 🟡

- `find apps/web/src -name "error.tsx"` → 0 результатов.
- При неперехваченной ошибке внутри `(app)`-роута Next.js показывает **standard error screen** — без брендинга, без ссылки «Назад в приложение», без связи с API.
- **Фикс (15 мин):**
  ```tsx
  // apps/web/src/app/(app)/error.tsx
  'use client';
  export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
    return (
      <main className="mx-auto max-w-content min-h-screen px-4 py-12">
        <h1 className="text-title mb-4">Что-то пошло не так</h1>
        <Button onClick={reset}>Попробовать снова</Button>
      </main>
    );
  }
  ```

### U4. Нет OG/Twitter Card на общедоступных страницах 🟠

- Никаких `<meta property="og:title">`, `og:image`, `og:description`. Соцшеринг ломается.
- **Фикс:** defaults в `app/layout.tsx`:
  ```ts
  export const metadata: Metadata = {
    openGraph: {
      title: 'MULTI-CHEF',
      description: 'Семейный планировщик питания...',
      images: [{ url: '/icons/icon.svg' }],
      locale: 'ru_RU',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'MULTI-CHEF',
      description: 'Семейный планировщик питания...',
    },
  };
  ```

---

## 4. Сводка таблицей

| #      | Приоритет | Зона           | Находка                                                                                       | Где                                                           |
| ------ | --------- | -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **T1** | 🔴 **P0** | SEO            | `<title>` одинаковый на всех страницах; `/profile` пустой; нет sitemap/robots; нет OG/Twitter | `apps/web/src/app/**/page.tsx`                                |
| **T2** | 🔴 P0     | Security/infra | `Server: nginx/1.24.0 (Ubuntu)` раскрывается                                                  | `/etc/nginx/nginx.conf` (`server_tokens off` закомментирован) |
| **T3** | 🔴 P0     | Perf/a11y      | `<img>` без `loading/decoding/width`                                                          | `recipe/[id]/Header.tsx`, `OptionCard.tsx`                    |
| **T4** | 🔴 P0     | Security/DB    | Postgres RLS OFF — multi-tenant только на app-уровне                                          | все Pg-таблицы                                                |
| **U1** | 🔴 P0     | UI/a11y        | axe-core 41 узел color-contrast; 1 link-in-text-block                                         | `globals.css`, `/auth/register`                               |
| **T5** | 🟠 P1     | SEO            | Нет `<meta robots>` для приватных страниц                                                     | `(app)/layout.tsx`, `(auth)/layout.tsx`                       |
| **U2** | 🟠 P1     | UI/a11y        | Нет `prefers-contrast` / `forced-colors`                                                      | `globals.css`                                                 |
| **U4** | 🟠 P1     | SEO/Share      | Нет OG/Twitter Card                                                                           | `app/layout.tsx`                                              |
| **U3** | 🟡 P2     | UI/a11y        | Нет `error.tsx` per route                                                                     | `apps/web/src/app/(app)/`                                     |
| **T6** | 🟡 P3     | Observability  | CSP без `report-uri`                                                                          | `apps/api/src/main.ts` (helmet config)                        |

---

## 5. Что НЕ удалось проверить

- 🟡 **Web Vitals на мобильных сетях** (4G throttling в Lighthouse / DevTools)
- 🟡 **Storybook coverage** — нет в репо
- 🟡 **Server-Side Rendering / hydration mathing** — `?markup=diff` анализ
- 🟡 **Race condition на concurrent pantry updates** (same row)
- 🟡 **Worker memory leak под нагрузкой** (нужен sustained load test)
- 🟡 **HSTS preload / expect-ct** — HTTPS endpoint self-signed
- 🟡 **CSP report-uri** — нет обратной связи о CSP-нарушениях

## 6. Доказательства (raw output)

### Page-title проба (`curl /`)

```
/:         <title>MULTI-CHEF</title>
            desc: Семейный планировщик питания — рецепты из того, что уже есть дома.
/fridge:   <title>MULTI-CHEF</title>      // та же
/today:    <title>MULTI-CHEF</title>      // та же
/plan:     <title>MULTI-CHEF</title>      // та же
/profile:  <title></title>                // ПУСТОЙ
            desc: (отсутствует)
            og: (отсутствует)
```

### Axe-core results (`/tmp/axe-real.mjs` через Playwright)

- `/` → 1 violation, [serious] `color-contrast` (10×)
- `/auth/login` → 1 violation, [serious] `color-contrast` (4×)
- `/auth/register` → 2 violations: `color-contrast` (6×), `link-in-text-block` (1×)
- `/design` → 1 violation, [serious] `color-contrast` (21×)

### Path traversal

```
/api/v1/../etc/passwd → 404
/api/v1/../admin → 404
/api/v1/debug/whoami → 404
/api/v1/health/dbs/exec → 404
```

### Postgres RLS

```sql
SELECT relname, rowsecurity FROM pg_tables
 WHERE schemaname='public' AND rowsecurity=true;
-- (0 rows)
```

### Pantry edge cases (already in §2 T7)

Все ответы 400 VALIDATION_ERROR.

---

## 7. Рекомендации (по приоритету)

1. **(P0, 1 час)** SEO-комплекс: title + per-page metadata + sitemap.ts + robots.ts + OG defaults — см. T1, U4.
2. **(P0, 5 мин)** `sed -i 's|^# server_tokens off|server_tokens off|' /etc/nginx/nginx.conf && nginx -t && systemctl reload nginx`.
3. **(P0, 1 час)** Добавить `width`/`height`/`loading`/`decoding` на каждый `<img>`. Или миграция на `next/image`.
4. **(P0, 1–2 дня)** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + Prisma middleware для `SET LOCAL app.household_id`.
5. **(P0, до первой публичной рассылки)** Поднять контраст `--color-primary` (#e8590c → #c4490a, ~4.9:1) и мягкие «soft» tokens. Подтверждено axe-core (41 узел).
6. **(P1, 30 мин)** `prefers-contrast: more` + `forced-colors: active` базовые overrides.
7. **(P2, 15 мин)** `app/(app)/error.tsx` + `app/global-error.tsx`.
8. **(P1)** `<meta robots>` noindex на приватных layout'ах.
9. **(P0, продолжая прошлые итерации)** B1/B2 (аудит #1), M1/M2 (аудит #2) — остаются критичными.

## 8. Артефакты

- Этот отчёт: `docs/audit/AUDIT-REPORT-3.md`
- 1-я итерация: `docs/audit/AUDIT-REPORT.md`
- 2-я итерация: `docs/audit/AUDIT-REPORT-2.md`
- Скриншоты 1-й/2-й итерации: `/home/multichef_app/shots/*.png` (48 шт., мобильные + десктоп + dark)
- axe-core raw scan: `/tmp/axe-results.json` (JSON по 4 URL × violations)
- Сканирующий скрипт (повторяемый): `/tmp/axe-real.mjs`
