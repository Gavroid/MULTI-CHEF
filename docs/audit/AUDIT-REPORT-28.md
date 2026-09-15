# Технический, продуктовый и UI-аудит MULTI-CHEF (28-й круг)

**Дата:** 2026-09-15
**HEAD:** `aac3d45 chore(audit): AUDIT-REPORT-27 infra-deploy-pipeline`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-27.md`, `FIX-PLAN.md`
**Фокус:** `.github/workflows/ci.yml` — coverage gaps, missing jobs, secret handling.

## TL;DR

28-й круг: **4 находки** — 0 P0, 1 🟠 P2 (api integration tests missing), 3 🟡 P3.

- 🟠 **T28-A** — CI запускает только `@multichef/database test:integration`. **API integration tests** (`apps/api/src/__tests__/*-integration.test.ts`) — НЕ запускаются. Полный HTTP→controller→service→DB flow не покрыт CI-gate. T13-A, T15-B, T20-A — все эти баги были в этом слое и **могли быть пойманы** api-integration тестами.
- 🟡 **T28-B** — CI не запускает **Playwright e2e tests** (`apps/web/e2e/*.spec.ts`). Main flow (`/today`, `/fridge`, `/plan`, `/shopping`) — без автоматического e2e-гейта.
- 🟡 **T28-C** — CI не считает **coverage** (нет `c8` в deps). Невозможно поставить coverage-gate на новый код (T25-D).
- 🟡 **T28-D** — Test DB password `test_password` в `.github/workflows/ci.yml:88` (YAML plaintext). OK для тестов, но hygiene: вынести в `secrets.TEST_DB_PASSWORD` для consistency с prod-секретами.

---

## 1. Технические находки (28-й круг)

### T28-A. CI не запускает API integration tests 🟠 P2

**Файл:** `.github/workflows/ci.yml:165-167` (job `test`).

**Сырой код:**

```yaml
- name: Unit tests
  run: pnpm turbo run test --concurrency=2

- name: Integration tests (packages/database)
  if: success()
  run: pnpm --filter @multichef/database test:integration
```

**Что упущено:**

CI запускает:

1. Unit tests (per-package `*.test.ts` + `*.spec.ts`).
2. `@multichef/database` integration tests (тесты на `packages/database/src/__tests__/integration.test.ts` + `rls-policies.integration.test.ts` + `seed-integration.test.ts`).

CI **НЕ** запускает:

- `apps/api/src/__tests__/pantry-integration.test.ts`
- `apps/api/src/__tests__/profile-integration.test.ts`
- `apps/api/src/__tests__/ingredients-integration.test.ts`
- `apps/api/src/__tests__/integration.test.ts`
- `apps/api/src/recipes/__tests__/recipes.controller.spec.ts`

**Что покрывают эти тесты (и что они бы поймали):**

| Файл                              | Что тестирует                                 | Какие баги ловит                                                                                      |
| --------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pantry-integration.test.ts`      | POST/GET/PATCH/DELETE pantry items через HTTP | T15-B (PANTRY_ITEM_ARCHIVED), T14-A (UNIQUE Preference), auth guard, ownership check                  |
| `profile-integration.test.ts`     | GET /api/v1/profile, household ownership      | T13-A register flow, profile 404 на foreign user                                                      |
| `ingredients-integration.test.ts` | GET /api/v1/ingredients с пагинацией / search | INGREDIENT_NOT_FOUND envelope (T16-A), pagination edge cases                                          |
| `integration.test.ts`             | Cross-cutting: auth, CSRF, idempotency, RLS   | T15-A (Idempotency-Key), T19-A (auth probe), CSRF guard, T20-A (race conditions), T20-C (PK conflict) |
| `recipes.controller.spec.ts`      | Recipes controller через HTTP                 | T11-A/B recipe flow                                                                                   |

**Эффект:** коммит, который ломает controller-layer (например, опечатка в `@Body()` decorator, новый `UseGuards` блокирует не тот роут, `Idempotency-Key guard` reject'ит легитимный запрос), **пройдёт CI green** → упадёт на проде / на ручном тестировании.

**Доказательство:**

```bash
$ ls apps/api/src/__tests__/*integration*.ts apps/api/src/recipes/__tests__/*.spec.ts 2>/dev/null
apps/api/src/__tests__/ingredients-integration.test.ts
apps/api/src/__tests__/integration.test.ts
apps/api/src/__tests__/pantry-integration.test.ts
apps/api/src/__tests__/profile-integration.test.ts
apps/api/src/recipes/__tests__/recipes.controller.spec.ts

$ grep "pnpm --filter @multichef/api test:integration\|test:integration" .github/workflows/ci.yml
# (только для @multichef/database — api integration tests не упомянуты)
```

**CI YML даёт DB+Redis services, но не вызывает API tests:**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    env:
      POSTGRES_USER: multichef
      POSTGRES_PASSWORD: test_password
      POSTGRES_DB: multichef_test
    ...
  redis:
    image: redis:7-alpine
    ...
env:
  RUN_DB_INTEGRATION: '1'
  DATABASE_URL: postgresql://multichef:test_password@127.0.0.1:5432/multichef_test
  INTEGRATION_DATABASE_URL: postgresql://multichef:test_password@127.0.0.1:5432/multichef_test
  REDIS_URL: redis://127.0.0.1:6379
# ← но нет 'pnpm --filter @multichef/api test:integration' в steps!
```

**Рекомендованный фикс:**

```yaml
- name: API integration tests
  if: success()
  env:
    INTEGRATION_DATABASE_URL: postgresql://multichef:test_password@127.0.0.1:5432/multichef_test
    REDIS_URL: redis://127.0.0.1:6379
  run: pnpm --filter @multichef/api test:integration
```

Также добавить step `pnpm --filter @multichef/api build` перед integration (требуется скомпилированный `dist/` для `--import`).

### T28-B. CI не запускает Playwright e2e tests 🟡 P3

**Файл:** `apps/web/e2e/auth-fridge-smoke.spec.ts`, `apps/web/e2e/recipe-page.spec.ts` (есть), но НЕ упомянуты в CI.

**Сырой код (web/e2e setup — есть playwright.config.ts):**

```bash
$ ls apps/web/e2e/
auth-fridge-smoke.spec.ts
recipe-page.spec.ts
```

```typescript
// apps/web/playwright.config.ts:14-25
const API_PORT = Number(process.env['API_PORT'] ?? '3001');
const WEB_PORT = Number(process.env['WEB_PORT'] ?? '3000');
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,  // ← sequential because shared DB
```

**Что упущено:**

CI не запускает `pnpm --filter @multichef/web e2e` (или `playwright test`). Это значит:

1. **`auth-fridge-smoke.spec.ts`** — реальный браузерный тест login → fridge. Не запускается автоматически.
2. **`recipe-page.spec.ts`** — реальный браузерный тест recipe view. Не запускается.
3. **Main flows (today, plan, shopping, meal-plan-generate)** — нет e2e вообще (T25-γ).

**Эффект:** SSR redirect bugs (типа T19-B, T22-A), missing meta tags, broken WebSocket / SSE — не поймаются на CI level.

**Дополнительная сложность:** e2e tests требуют `pnpm build` для web + api (для `webServer` в playwright config), занимают ~3-5 min. CI timeout — 15 min (build job). Возможно, нужен отдельный `e2e` job с `timeout-minutes: 30`.

**Рекомендованный фикс:**

```yaml
e2e:
  name: e2e (playwright)
  runs-on: ubuntu-latest
  timeout-minutes: 30
  needs: [build]   # нужен built dist для webServer
  services:
    postgres:
      image: pgvector/pgvector:pg16
      env: { POSTGRES_USER: multichef, POSTGRES_PASSWORD: test_password, POSTGRES_DB: multichef_test }
      ...
    redis:
      ...
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with: { version: '9.15.9' }
    - uses: actions/setup-node@v4
      with: { node-version: '24', cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @multichef/database prisma migrate deploy
      env: { DATABASE_URL: postgresql://multichef:test_password@127.0.0.1:5432/multichef_test }
    - run: pnpm exec playwright install --with-deps chromium
    - run: pnpm --filter @multichef/web e2e
      env:
        API_PORT: '3001'
        WEB_PORT: '3000'
        DATABASE_URL: postgresql://multichef:test_password@127.0.0.1:5432/multichef_test
        REDIS_URL: redis://127.0.0.1:6379
```

### T28-C. CI не считает coverage (нет coverage tool) 🟡 P3

**Файл:** `.github/workflows/ci.yml` (нет ни одного `coverage` step), `apps/api/package.json` (нет `c8` в deps).

**Доказательство:**

```bash
$ grep -rn "c8\|nyc\|coverage\|lcov" .github/workflows/ci.yml
# (пусто — coverage не упоминается)

$ grep "c8\|nyc" apps/api/package.json
# (пусто — coverage tool не установлен)
```

T25-D уже отметил отсутствие coverage tool. Здесь фиксируем, что **CI не использует coverage даже если бы он был**.

**Эффект:**

- Coverage diff в PR невозможен (нет baseline, нет regression gates).
- Регрессии (типа «новый код добавлен без теста») не ловятся.

**Рекомендованный фикс:** добавить step в `test` job:

```yaml
- name: Coverage
  if: success()
  run: pnpm --filter @multichef/api test:coverage
```

И параллельно — `coverage-baseline` action для diff в PR. Альтернативно — codecov/coveralls интеграция.

### T28-D. Test DB password `test_password` в YAML plaintext 🟡 P3

**Файл:** `.github/workflows/ci.yml:88` (postgres service env).

**Сырой код:**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    env:
      POSTGRES_USER: multichef
      POSTGRES_PASSWORD: test_password # ← plaintext
      POSTGRES_DB: multichef_test
```

**Проблема (лёгкая):**

`test_password` — это **намеренно слабый** пароль для CI. Это OK для test DB (ничего не утекает, БД эфемерная). Но:

1. **Inconsistency**: prod secrets в `/etc/multichef/multichef.env` (не в git), а test secret — в YAML. Разные паттерны → путаница.
2. **Pull request from fork** — форк может прочитать `secrets.TEST_DB_PASSWORD` если он задан. Но plaintext в YAML доступен всем кто может read .github/workflows (любой contributor).

**Эффект:** минимальный, но hygiene: лучше всё-таки вынести.

**Рекомендованный фикс:**

1. В GitHub repo Settings → Secrets → добавить `TEST_DB_PASSWORD`.
2. Заменить `POSTGRES_PASSWORD: test_password` → `POSTGRES_PASSWORD: ${{ secrets.TEST_DB_PASSWORD }}`.
3. Также вынести `TEST_REDIS_PASSWORD` (если появится).
4. В README / CONTRIBUTING.md описать, как локально поднять DB+Redis для тестов (через docker compose).

---

## 2. Подтверждённые здоровые паттерны

- **CI имеет 5 jobs**: lint, typecheck, test, build, secret-scan — базовый набор.
- **Concurrency cancel-in-progress**: `concurrency: group: ci-${{ github.ref }} cancel-in-progress: true` — повторный push в ту же ветку отменяет предыдущий запуск.
- **Node heap bumped to 8 GiB для typecheck**: `NODE_OPTIONS: '--max-old-space-size=8192'` — реально решил OOM-проблему (видно в комментариях).
- **Postgres + Redis services для test job**: запускаются как Docker services, health-check настроен.
- **Schema-drift gate**: `pnpm check:schema-drift` — T17-A уже автоматизирован.
- **`fetch-depth: 0` для gitleaks**: full git history для secret-scan.
- **Concurrency limit для tests**: `pnpm turbo run test --concurrency=2` — фикс для flaky node:test (видно в комментарии).
- **Permissions минимальные**: `contents: read, pull-requests: read` — нет write access.

## 3. Микро-наблюдения

- **T28-α** — CI не публикует артефакты (coverage report, e2e report, build output). Нет `actions/upload-artifact`. При failure — нет диагностики (только логи).
- **T28-β** — CI не имеет отдельного `pr-merged-to-main` job (например, для автопуша тега / триггера deploy). Deploy делается руками через `deploy.sh`. Это OK (intentional), но hygiene: задокументировать.
- **T28-γ** — CI не валидирует **`prisma migrate deploy`** против **preview/staging DB** перед merge в main. Только schema-drift + integration tests на CI-временной DB. Миграция, которая работает в test env, может сломать prod env. Hygiene: добавить «dry-run migrate deploy against prod snapshot» (тяжело реализовать).
- **T28-δ** — Test runner использует `pgvector/pgvector:pg16` — образ соответствует production (Postgres 16 + pgvector). ✓
- **T28-ε** — CI timeout — `10-15 min` для разных jobs. Если turbo cache cold (новый PR) — typecheck может занять 5-7 min. Граница близкая, но держится.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона          | Находка                                                                                                                                                 | Где                                                 |
| --------- | --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **T28-A** | 🟠 P2     | CI / Tests    | CI запускает только `@multichef/database test:integration`. API integration tests (`pantry-integration`, `profile-integration`, etc.) — НЕ запускаются. | `.github/workflows/ci.yml:165-167`                  |
| **T28-B** | 🟡 P3     | CI / E2E      | CI не запускает Playwright e2e tests (`apps/web/e2e/*.spec.ts`).                                                                                        | `.github/workflows/ci.yml` (нет `e2e` job)          |
| **T28-C** | 🟡 P3     | CI / Coverage | CI не считает coverage (нет `c8` + coverage step). Coverage gates в PR невозможны.                                                                      | `.github/workflows/ci.yml`, `apps/api/package.json` |
| **T28-D** | 🟡 P3     | CI / Secrets  | `POSTGRES_PASSWORD: test_password` в YAML plaintext. Hygiene: вынести в `secrets.TEST_DB_PASSWORD`.                                                     | `.github/workflows/ci.yml:88`                       |

## 5. Куммулятивный итог (28 кругов)

| Iter    | Findings            | 🔴 P0 | 🔴 P1 | 🟠 P2-P3        | 🟡 ℹ️ | Cumulative                    |
| ------- | ------------------- | ----- | ----- | --------------- | ----- | ----------------------------- |
| #1–3    | 26                  | 9     | 0     | 6               | 11    | —                             |
| #4–10   | 13                  | 0     | 0     | 13              | 0     | —                             |
| #11     | T11-A, T11-B        | 0     | 0     | 2               | 0     | —                             |
| #12     | T12-A               | 0     | 0     | 1               | 0     | —                             |
| #13     | T13-A               | 1 P0  | 0     | 0               | 0     | 10 P0                         |
| #14     | T14-A               | 0     | 0     | 1               | 0     | 10 P0                         |
| #15     | T15-A, T15-B        | 1 P0  | 0     | 1               | 0     | 11 P0                         |
| #16     | T16-A, T16-B        | 0     | 0     | 2               | 0     | 11 P0                         |
| #17     | T17-A, T17-B        | 0     | 2 P1  | 0               | 0     | 11 P0, 2 P1                   |
| #18     | T18-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 11 P0, 2 P1, 2 P2             |
| #19     | T19-A, T19-B        | 0     | 0     | 2 P2            | 0     | 11 P0, 2 P1, 4 P2             |
| #20     | T20-A, T20-B, T20-C | 1 P0  | 0     | 2 P2            | 0     | 12 P0, 2 P1, 6 P2             |
| #21     | T21-A–D             | 0     | 0     | 2 P2 + 2 P3     | 0     | 12 P0, 2 P1, 8 P2, 4 P3       |
| #22     | T22-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 9 P2, 6 P3       |
| #23     | T23-A–C             | 0     | 0     | 1 P2 + 2 P3     | 0     | 12 P0, 2 P1, 10 P2, 8 P3      |
| #24     | T24-A–D             | 0     | 0     | 3 P2 + 1 P3     | 0     | 12 P0, 2 P1, 13 P2, 9 P3      |
| #25     | T25-A–D             | 0     | 0     | 1 P2 + 3 P3     | 0     | 12 P0, 2 P1, 14 P2, 12 P3     |
| #26     | T26-A–C             | 0     | 0     | 0               | 3 P3  | 12 P0, 2 P1, 14 P2, 15 P3     |
| #27     | T27-A–D             | 0     | 0     | 1 P2 + 3 P3     | 0     | 12 P0, 2 P1, 15 P2, 18 P3     |
| **#28** | **T28-A–D**         | **0** | **0** | **1 P2 + 3 P3** | **0** | **12 P0, 2 P1, 16 P2, 21 P3** |

**Тренд 28-го:** CI/CD. После deploy-pipeline (27) — следующий уровень: **CI как gate для качества кода**. T28-A самый значимый — пропуск API integration tests в CI = реальные баги могут пройти незамеченными.

## 6. Рекомендации (28-й круг)

1. **(P2, 30 мин, T28-A)** Добавить в `.github/workflows/ci.yml:165` job `test` после integration-tests step: `pnpm --filter @multichef/api test:integration` (с теми же env vars). Самый быстрый win — это поймает регрессии T13/T15/T20.
2. **(P3, 2ч, T28-B)** Добавить отдельный `e2e` job с `timeout-minutes: 30`, `needs: [build]`. Запускать `playwright install chromium` + `pnpm --filter @multichef/web e2e`.
3. **(P3, 1ч, T28-C)** Добавить `c8` в `apps/api/package.json:devDependencies`. В CI step `test:coverage`. Бонус: codecov integration (через `codecov/codecov-action@v4`).
4. **(P3, 15 мин, T28-D)** В GitHub repo Settings → Secrets добавить `TEST_DB_PASSWORD = test_password`. В YAML: `POSTGRES_PASSWORD: ${{ secrets.TEST_DB_PASSWORD }}`.

## 7. Артефакты (28-й круг)

| Артефакт                   | Где                             |
| -------------------------- | ------------------------------- |
| Этот отчёт                 | `docs/audit/AUDIT-REPORT-28.md` |
| FIX-PLAN (T28-A,B,C,D)     | `docs/audit/FIX-PLAN.md`        |
| CI missing API integration | §1 T28-A                        |
| CI missing e2e             | §1 T28-B                        |
| CI no coverage             | §1 T28-C                        |
| CI test password plaintext | §1 T28-D                        |
