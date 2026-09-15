# Технический, продуктовый и UI-аудит MULTI-CHEF (37-й круг)

**Дата:** 2026-09-15
**HEAD:** `938daf0 chore(audit): AUDIT-REPORT-36 logging-redaction`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-36.md`, `FIX-PLAN.md`
**Фокус:** BFF / NEXT_PUBLIC env-leakage — feature flags, default values, build-time safety.

## TL;DR

37-й круг: **4 находки** — 0 P0, 1 🟠 P2 (dev-flag leak to prod), 3 🟡 P3.

- 🟠 **T37-A** — `NEXT_PUBLIC_USE_RECIPE_FIXTURES` и `NEXT_PUBLIC_USE_MEALPLAN_MOCK` — **dev-mode feature flags**, **НЕ валидируются** в `webEnvSchema`. Если оператор случайно выставит их в `'1'` в проде, **клиент будет использовать fixture/mock данные вместо API**. Тихий failure.
- 🟡 **T37-B** — `NEXT_PUBLIC_APP_BASE_URL` default = `http://localhost:3001`. Если не задан в production build, **client bundle hard-code `localhost:3001`**. Все API calls fail.
- 🟡 **T37-C** — `process.env['NEXT_PUBLIC_APP_BASE_URL']` дублируется в 4 файлах (`robots.ts`, `sitemap.ts`, `layout.tsx`, `lib/env.ts`). Только `lib/env.ts` централизован через `getApiBaseUrl()`.
- 🟡 **T37-D** — Нет build-time assertion в `next.config.mjs` для dev-флагов. Можно собрать production с `NEXT_PUBLIC_USE_RECIPE_FIXTURES=1` без warning.

---

## 1. Технические находки (37-й круг)

### T37-A. Dev-mode feature flags `NEXT_PUBLIC_USE_*` без validation / prod guard 🟠 P2

**Файлы:**

- `apps/web/src/lib/recipe-client.ts:5-7` (`usesRecipeFixtures`).
- `apps/web/src/lib/recommendations-client.ts` (`usesMealPlanMock`).
- `packages/config/src/env.schema.ts` (нет валидации).

**Сырой код:**

```ts
// apps/web/src/lib/recipe-client.ts
export function usesRecipeFixtures(): boolean {
  return process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'] === '1';
}
```

**Тест:**

```ts
// apps/web/src/lib/__tests__/recipe-client.test.ts:24-36
test('usesRecipeFixtures: only the exact string "1" enables fixtures', () => {
  // ... тесты про '1' = true, '0'/'true'/unset = false
});
```

**Эффект:**

1. **No validation in webEnvSchema** — оператор может поставить `NEXT_PUBLIC_USE_RECIPE_FIXTURES=foo` или `=true` — silently treated as `false` (только exact match '1' triggers).
2. **In production build, accidentally set '1'**:
   - `recipe-client.ts` short-circuits → returns fixture data instead of calling API.
   - User sees hardcoded recipes, never sees real user data.
   - **Silent failure** — нет error, нет warning, нет alert.
3. **No CI check** for prod-build env vars.

**Смягчающий фактор:**

- `infrastructure/scripts/deploy.sh` passes these vars explicitly (`NEXT_PUBLIC_USE_MEALPLAN_MOCK="$..."`) — operator's existing config is empty.
- Test correctly enforces '1' = on, others = off.

**Проверка:**

```bash
$ grep -A 5 "export const webEnvSchema" packages/config/src/env.schema.ts | head -10
export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  WEB_PORT: portSchema.default(3000),
  APP_BASE_URL: urlSchema.default('http://localhost:3001'),
  NEXT_PUBLIC_APP_BASE_URL: urlSchema.default('http://localhost:3001'),
  LOG_LEVEL: logLevelSchema.default('info'),
  LOG_FORMAT: logFormatSchema.default('pretty'),
});
# (NEXT_PUBLIC_USE_RECIPE_FIXTURES / NEXT_PUBLIC_USE_MEALPLAN_MOCK — отсутствуют)
```

**Рекомендованный фикс:**

1. Добавить в `webEnvSchema`:
   ```ts
   NEXT_PUBLIC_USE_RECIPE_FIXTURES: z.enum(['0', '1']).default('0'),
   NEXT_PUBLIC_USE_MEALPLAN_MOCK: z.enum(['0', '1']).default('0'),
   ```
2. В `next.config.mjs` добавить build-time assertion:
   ```js
   if (parsed.NODE_ENV === 'production') {
     if (parsed.NEXT_PUBLIC_USE_RECIPE_FIXTURES === '1') {
       throw new Error('NEXT_PUBLIC_USE_RECIPE_FIXTURES=1 in production build!');
     }
     // ...
   }
   ```
3. В `deploy.sh` — assert эти vars unset или '0' перед build.

### T37-B. `NEXT_PUBLIC_APP_BASE_URL` default = localhost 🟡 P3

**Файл:** `packages/config/src/env.schema.ts` (default).

**Сырой код:**

```ts
NEXT_PUBLIC_APP_BASE_URL: urlSchema.default('http://localhost:3001'),
```

**Эффект:**

- Если production build не передаёт `NEXT_PUBLIC_APP_BASE_URL`, client bundle **hard-codes** `http://localhost:3001` как API base.
- Production users' API calls → connection refused / localhost (or attacker-controlled host if `localhost` resolves to local proxy).
- Robots.txt, sitemap.xml тоже используют этот URL.

**Смягчающий фактор:** deploy.sh passes this var. Но если забыли — silent failure (только в браузере, server-side логи показывают «API on :3001»).

**Рекомендованный фикс:**

```ts
NEXT_PUBLIC_APP_BASE_URL: process.env.NODE_ENV === 'production'
  ? urlSchema  // required in production, no default
  : urlSchema.default('http://localhost:3001'),
```

Или explicit assertion в `next.config.mjs`:

```js
if (parsed.NODE_ENV === 'production' && !parsed.NEXT_PUBLIC_APP_BASE_URL.startsWith('https://')) {
  throw new Error('NEXT_PUBLIC_APP_BASE_URL must be HTTPS in production');
}
```

### T37-C. `NEXT_PUBLIC_APP_BASE_URL` direct access в 4 файлах 🟡 P3

**Файлы:**

- `apps/web/src/lib/env.ts` (`getApiBaseUrl()` — centralized).
- `apps/web/src/app/robots.ts:8` (`process.env['NEXT_PUBLIC_APP_BASE_URL'] ?? 'http://localhost:3001'`).
- `apps/web/src/app/sitemap.ts:7` (same pattern).
- `apps/web/src/app/layout.tsx:11` (same pattern).

**Эффект:**

DRY violation — `NEXT_PUBLIC_APP_BASE_URL` default `http://localhost:3001` repeated 4 раза. Если когда-то default изменится (например, на `https://api.multichef.com`) — нужно обновить 4 файла.

**Рекомендованный фикс:** заменить все на `import { getApiBaseUrl } from '@/lib/env'`. Centralized.

### T37-D. Нет build-time assertion для dev-флагов в production 🟡 P3

**Файл:** `apps/web/next.config.mjs`.

**Текущая логика:**

```js
const nextConfig = {
  reactStrictMode: true,
  // ... без assertion
};
```

**Рекомендованный фикс:** добавить top-level `if (parsed.NODE_ENV === 'production') { ... assertion ... }` block.

---

## 2. Подтверждённые здоровые паттерны

- **`getApiBaseUrl()` в `lib/env.ts`** — единственное centralized место для production API URL. ✓
- **`loadWebEnv()` валидация в `next.config.mjs`** — build-time check на required env vars. ✓
- **`NEXT_PUBLIC_*` naming convention** соблюдается. ✓
- **`transpilePackages` для `@multichef/contracts`** — runtime contract types в client bundle. ✓
- **`poweredByHeader: false`** — X-Powered-By header убран. ✓
- **Tests для feature flags** (`recipe-client.test.ts:24-36`, `recommendations-client.test.ts:109`) — поведение '1' vs others задокументировано и тестируется. ✓
- _*`deploy.sh` явно передаёт NEXT_PUBLIC_* в sudo env_* — правильный паттерн для env_reset. ✓

## 3. Микро-наблюдения

- **T37-α** — `webEnvSchema` имеет только `NEXT_PUBLIC_APP_BASE_URL` как публичную переменную. Нет `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_ANALYTICS_ID`, etc. (потому что их нет в проекте). Hygiene: явно перечислить «public keys» vs «server-only».
- **T37-β** — `reactStrictMode: true` — double-rendering в dev для catching bugs. ✓
- **T37-γ** — `devIndicators: false` — Next.js dev overlay скрыт в production build. ✓
- **T37-δ** — `outputFileTracingRoot: process.cwd()` — для tracing, OK. Hygiene.
- **T37-ε** — `process.env['NEXT_PUBLIC_APP_BASE_URL'] ?? 'http://localhost:3001'` — nullish coalescing, не falsy. Если `''` (empty string), возвращает `''` → ошибка в `new URL(...)`. Hygiene: `||` для fallback.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона               | Находка                                                                                                                                             | Где                                                                                                     |
| --------- | --------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **T37-A** | 🟠 P2     | Web / Build config | Dev-mode `NEXT_PUBLIC_USE_RECIPE_FIXTURES` / `NEXT_PUBLIC_USE_MEALPLAN_MOCK` — НЕ валидируются в `webEnvSchema`. Prod-footgun: silent fixture data. | `apps/web/src/lib/recipe-client.ts:5`, `recommendations-client.ts`, `packages/config/src/env.schema.ts` |
| **T37-B** | 🟡 P3     | Web / Build config | `NEXT_PUBLIC_APP_BASE_URL` default = `http://localhost:3001`. Если не задан в prod — client bundle hard-code localhost.                             | `packages/config/src/env.schema.ts`                                                                     |
| **T37-C** | 🟡 P3     | Web / DRY          | `NEXT_PUBLIC_APP_BASE_URL` direct access в 4 файлах (robots, sitemap, layout, lib/env). DRY violation.                                              | `apps/web/src/app/robots.ts:8`, `sitemap.ts:7`, `layout.tsx:11`                                         |
| **T37-D** | 🟡 P3     | Web / Build config | Нет build-time assertion в `next.config.mjs` для dev-флагов в production.                                                                           | `apps/web/next.config.mjs`                                                                              |

## 5. Куммулятивный итог (37 кругов)

| Iter   | Round   | Topic                 | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | --------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–30  | #21–#30 | (предыдущие раунды)   | —            | 0     | 0     | 5     | 25    |
| 31     | #31     | API Zod validation    | T31-A..D     | 0     | 0     | 1     | 3     |
| 32     | #32     | Cookie hygiene        | T32-A..D     | 0     | 0     | 2     | 2     |
| 33     | #33     | DB migration safety   | T33-A..D     | 0     | 0     | 1     | 3     |
| 34     | #34     | OpenAPI / Swagger     | T34-A..D     | 0     | 0     | 2     | 2     |
| 35     | #35     | Prisma / pool config  | T35-A..D     | 0     | 0     | 2     | 2     |
| 36     | #36     | Logging redaction     | T36-A..D     | 0     | 0     | 1     | 3     |
| **37** | **#37** | **BFF / NEXT_PUBLIC** | **T37-A..D** | **0** | **0** | **1** | **3** |

Cumulative after 37: P0=12, P1=2, P2=26, P3=47.

**Тренд 37-го:** Web build config. После API (31-34), DB (33, 35), logging (36) — focus на web build pipeline. T37-A — самый важный: silent failure если fixture flag попадёт в prod.

## 6. Рекомендации (37-й круг)

1. **(P2, 30 мин, T37-A)** Добавить `NEXT_PUBLIC_USE_RECIPE_FIXTURES` / `NEXT_PUBLIC_USE_MEALPLAN_MOCK` в `webEnvSchema` (z.enum ['0','1']). В `next.config.mjs`: `if (parsed.NODE_ENV === 'production' && flag === '1') throw new Error(...)`.
2. **(P3, 30 мин, T37-B)** В production — require `NEXT_PUBLIC_APP_BASE_URL` (no default). Add HTTPS check в `next.config.mjs`.
3. **(P3, 30 мин, T37-C)** Заменить `process.env[...]` direct reads в `robots.ts`, `sitemap.ts`, `layout.tsx` на `getApiBaseUrl()` import.
4. **(P3, 30 мин, T37-D)** Добавить build-time assertion block в `next.config.mjs` (после T37-A, T37-B).

## 7. Артефакты (37-й круг)

| Артефакт                       | Где                             |
| ------------------------------ | ------------------------------- |
| Этот отчёт                     | `docs/audit/AUDIT-REPORT-37.md` |
| FIX-PLAN (T37-A,B,C,D)         | `docs/audit/FIX-PLAN.md`        |
| Dev flags without validation   | §1 T37-A                        |
| APP_BASE_URL default localhost | §1 T37-B                        |
| APP_BASE_URL DRY violation     | §1 T37-C                        |
| No build-time assertion        | §1 T37-D                        |
