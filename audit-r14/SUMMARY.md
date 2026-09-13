# MULTI-CHEF R14 — глобальный аудит: UI-тесты и test-coverage

**Дата:** 2026-09-13
**Команда:** `pnpm test` (15/15), `pnpm build` (9/9), `pnpm typecheck` (15/15), `pnpm lint` (15/15), `pnpm format:check` (1 cosmetic), `pnpm check:env-coverage` (100%), `pnpm check:adr-coverage` (13/13), `gitleaks detect` (0 утечек, 135 коммитов), Playwright E2E против прод `192.168.1.35:8080` (4/4 ✅)
**Workspace:** `/root/workspace` (активный по [Workspace::v1])

---

## Сводка

| Категория проверки | Результат |
|---|---|
| **Unit/integration (apps/web)** | 221/221 ✅, ~2.0s |
| **Unit (apps/api)** | 112/112 ✅, 0.84s |
| **Unit (apps/worker)** | 8/8 ✅, 0.18s |
| **Unit (packages/recommendation)** | 127/127 ✅, 0.56s, line coverage 100%, branch 94.95% |
| **E2E против прод** (playwright + tests/e2e) | 4/4 ✅, 5.4s — happy-today (register → stock → /today → wizard → accept → /shopping) |
| **In-isolation E2E (apps/web/e2e)** | Не запустились — нет Postgres-доступа из этой сессии (аутентификация в `multichef` user) |
| **tsc --noEmit** (turbo typecheck) | 15/15 ✅ |
| **next build** (turbo build) | 9/9 ✅, 21 страница скомпилирована |
| **eslint** (turbo lint) | 15/15 ✅ (1 warning: `MODULE_TYPELESS_PACKAGE_JSON` в `apps/api/eslint.config.js`) |
| **prettier --check** | 1 файл: `apps/web/src/app/(app)/profile/page.tsx` (uncommitted-mtime, refactor) |
| **env coverage** | 100% — все `process.env.*` ссылки имеют `.env.example` описание |
| **ADR coverage** | 13/13 ADRs корректные; conventions.md покрывает 6 обязательных секций |
| **gitleaks (135 коммитов)** | No leaks |

### Live-проверки тестов, прогнанные в этой сессии

| Что | Команда | Вердикт |
|---|---|---|
| Web unit | `pnpm test` (заходит через turbo) | ✅ 221/221 |
| API unit | `pnpm --filter @multichef/api test` | ✅ 112/112 |
| Worker unit | `pnpm --filter @multichef/worker test` | ✅ 8/8 |
| Recommendation | `pnpm --filter @multichef/recommendation test` | ✅ 127/127 + coverage |
| Prod E2E | `cd apps/web && E2E_BASE_URL=http://192.168.1.35:8080 ./node_modules/.bin/playwright test --config=/root/workspace/multichef/tests/e2e/playwright.config.ts` | ✅ 4/4 |
| apps/web e2e (in-isolation) | Требует start-api.sh + start-web.sh с локальным Postgres | ❌ Не запустился (нет доступа к Postgres) |

---

## Новые находки R14 (в дополнение к R13)

### Высокий приоритет — Test coverage gaps

#### TC-1. **Реальный planWeek НИКОГДА не тестируется end-to-end в проде**
- **Файл:** `/etc/multichef/multichef.env` (`NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`)
- **Что:** На проде установлен `USE_MEALPLAN_MOCK=1`. Web-клиент при выборе «принять рекомендацию» вызывает `acceptRecommendation mock mode` (`apps/web/src/lib/plan-client.ts:78-91` в R13 PUSH-логе теста `usesMealPlanMock`). То есть **на продовой среде реальный planner (с настоящим КБЖУ-расчётом) запускается только когда пользователь целенаправленно переключит USE_MEALPLAN_MOCK=0**.
- **Живое доказательство:** `tests/e2e/happy-today.spec.ts:113-117` — после `await page.locator('[data-testid^="accept-"]').first().click()` сразу идёт `await expect(page).toHaveURL(/\/shopping\//, { timeout: 15_000 })`. То есть `mock` accept → сразу shopping. План не генерируется.
- **Реальный planner запускается в `apps/worker`** через BullMQ → `runPlanWeek`. Это **не покрыто e2e**.
- **Связь с R13:** H-3 (КБЖУ deviation >10%) — это баг **в реальном planner**. Если бы прод **не** имел `USE_MEALPLAN_MOCK=1`, `happy-today` бы упал на UI (`/today/result` показывает 1487 kcal/person вместо ~2000). С мок-данными баг скрыт.
- **Severity:** MEDIUM-HIGH (продуктовый). Когда `USE_MEALPLAN_MOCK` снимется — у пользователей разъезд плана.
- **Фикс:**
  1. Добавить E2E-сценарий `e2e/real-plan-deviation.spec.ts`: на fixture / DEV сервере с `USE_MEALPLAN_MOCK=0` сгенерировать план с target=2000 и проверить `avgDailyCalorieDeviation <= 0.10`.
  2. ИЛИ **оставить `USE_MEALPLAN_MOCK=1` на проде, пока planner не исправлен**, и пометить как `LIMITATION` в CHANGELOG.

#### TC-2. **In-isolation E2E (`apps/web/e2e/`) не запускаются в CI без прав на локальный Postgres**
- **Что:** `apps/web/playwright.config.ts:43-50` указывает `start-api.sh` → `pnpm --filter @multichef/api build`, который потом стартует `node apps/api/dist/main.js`. API берёт `DATABASE_URL` из локального Postgres. Не имея доступа — e2e не запустится.
- **Сценарий:**
  - В этой Hermes-сессии Postgres на 127.0.0.1:5432 жив, но `PGPASSWORD=<real>` не подходит (мне неизвестен из /etc/multichef/multichef.env видно только `***` маркер).
  - На проде у SSH-доступа нет, поэтому права `multichef` Postgres-пользователя восстановить не получится.
  - Docker недоступен (`/var/run/docker.sock` отсутствует).
- **Severity:** MEDIUM (dev/CI usability).
- **Фикс:** перейти с локального Postgres на testcontainers в CI (`RUN_DB_INTEGRATION=1 ... testcontainers`). Этот путь уже заложен в `apps/api/src/__tests__/integration.test.ts`, но e2e его не используют.
- **Подтверждение:** в `apps/api/.env.test` есть `RUN_DB_INTEGRATION` и `INTEGRATION_DATABASE_URL` — но это для unit-тестов API, не для web-e2e.

#### TC-3. **В web-e2e `auth-fridge-smoke` есть нестрогая проверка «autocomplete result has any text»**
- **Файл:** `apps/web/e2e/auth-fridge-smoke.spec.ts`
- **Что:** `expect(resultText.length, …).toBeGreaterThan(0)` — проверяет только что autocomplete вернул хоть что-то, без матчинга с «помидор». Это не позволит ловить регрессии в индексировании.
- **Severity:** LOW.
- **Фикс:** `expect(resultText.toLowerCase()).toMatch(/томат|помидор/)`.

### Предупреждения / наблюдения (не security)

#### W-1. `act(...) not configured` warning в ~30 React-тестах
- **Что:** React 19 + happy-dom + node:test не регистрируют `act()` wrapper автоматически. Предупреждения в выводе test runner.
- **Severity:** LOW (debt). Тесты зелёные, но **state-update warnings могут маскировать реальные баги** при последующем апгрейде React.
- **Фикс:** `import { configure } from 'happy-dom'; configure({ reactAct: true })` или явно использовать `await act(async () => {…})` в каждом тесте с state-update.

#### W-2. `apps/api/eslint.config.js` без `"type": "module"` в package.json
- **Severity:** LOW (perf warning).
- **Фикс:** добавить `"type": "module"` в `apps/api/package.json`. Или переименовать файл в `.mjs`.

#### W-3. `apps/web/src/app/(app)/profile/page.tsx` не prettier-форматирован
- **Severity:** LOW (cosmetic).
- **Фикс:** `pnpm format` или `npx prettier --write …`.

---

## Что я НЕ покрыл (и почему)

| Что | Почему |
|---|---|
| `pnpm test:integration` (`apps/api/src/__tests__/integration.test.ts` и др.) | Требует Postgres + Redis доступ, как и TC-2 |
| `RUN_DB_INTEGRATION=1` интеграционные | То же |
| `apps/web/e2e/*` | То же |
| `pg_dump --stats` / `redis-cli INFO` | Нет SSH-доступа к 192.168.1.35 |
| Воспроизведение orphan pantry-item (C-1) в БД | Требует мутацию реальной БД |
| 100-прогоновая нагрузка на planner | За рамками этой сессии |

---

## Заключение по UI-тестам и общему аудиту

**Все UI-e2e против прод-гейтвея прошли** (4/4 за 5.4s, включая happy-path). Web unit/integration — 221/221, API unit — 112/112, recommendation — 127/127 (94.95% branches). `pnpm build/typecheck/lint` — все ✅.

**Главный «остаточный» риск в тестах — TC-1**: реальный `runPlanWeek` не покрыт end-to-end при `USE_MEALPLAN_MOCK=1`. Это объясняет, почему R13 находка H-3 (КБЖУ deviation >10%) до сих пор в коде — её никто не ловит, потому что happy-path использует фикстуры. **При снятии мока на проде нужен либо фикс planner, либо новый e2e-тест на реальном API.**

**В остальном — безопасный R13 + глобальный аудит R14 дают чистую картину.** Никаких TS-ошибок, leak'ов в git-истории, lint-проблем. Это значит, что R13-находки — действительно «остаточные» тонкие баги, а не следствие гнилого фундамента.

---

*Конец отчёта R14.*
