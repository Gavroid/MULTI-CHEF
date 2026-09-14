# Технический, продуктовый и UI-аудит MULTI-CHEF (десятая итерация)

**Дата:** 2026-09-14
**HEAD:** `60b5dbd chore(audit): AUDIT-REPORT-9 ninth-iteration findings T9-A T9-B unvalidated body null-nutrition`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, `-3.md`, `-4.md`, `-5.md`, `-6.md`, `-7.md`, `-8.md`, `-9.md`, `VERIFICATION.md`
**Цель:** проверить worker contract (`resultRef` semantics), IDOR на `/jobs/:id`, price-data leak в публичных ingredients, prefers-reduced-motion / prefers-color-scheme CSS.

## TL;DR

Десятая итерация находит **1 🟠 P2 находку** + подтверждает **7 здоровых паттернов**.

- 🟠 **T10-A — `/api/v1/ingredients` list & detail публично раскрывают коммерческие поля ингредиентов** (`avgPriceKopecks`, `density`, `ediblePartRatio`, `packageSize`). Без авторизации. Если нужно — для UI-UX-расчётов. Если нет — коммерческая утечка цены.
- ✅ `/jobs/<other-user-job>` → **404 JOB_NOT_FOUND** (приватность строгая, не раскрывает существование).
- ✅ `/jobs/<non-ulid-format>` → 404 (UUID-валидация отсутствует, но результат правильный).
- ✅ `resultRef` в `Job` row **корректно равен `MealPlan.id`** (по DB-сверке 5/5 совпадают). Worker create contract: `tx.mealPlan.create({data:{id: data.jobId, ...}})` — план наследует id job. **Design-by-design** — клиент должен `GET /meal-plans/active` для follow-up, не отдельный `GET /meal-plans/<resultRef>`.
- ✅ `prefers-reduced-motion: reduce` глобально (animation-duration 0.001ms, transition 100ms). 
- ✅ `prefers-color-scheme: dark` fallback для пользователей без manual override.
- ✅ `/api/v1/health/ready` returns `{"status":"ready"}` без утечки internal info.
- ✅ CSP report-uri endpoint не существует (404) — известно из аудита #3, остаётся TODO.

---

## 1. Технические находки (десятая итерация)

### T10-A. `/api/v1/ingredients` публично раскрывает `avgPriceKopecks`/`density` 🟠
**Файл:** `apps/api/src/ingredients/ingredients.controller.ts`, `ingredients.service.ts`.

**Raw output:**
```
$ curl http://192.168.1.95:8080/api/v1/ingredients?limit=1
  HTTP=200
  keys: ['id', 'canonicalName', 'defaultUnit', 'packageSize',
         'avgPriceKopecks', 'density', 'ediblePartRatio', 'status', 'category', 'aliases']
  avgPriceKopecks: 18000      # руб/100г
  density: 0.93              # г/мл
  ediblePartRatio: 0.85      # коэф. съедобной части

$ curl http://192.168.1.95:8080/api/v1/ingredients/<id>/nutrition
  HTTP=200
  nutrition keys: ['caloriesPer100g', 'proteinPer100g', 'fatPer100g',
                    'carbsPer100g', 'fiberPer100g', 'source', 'calculationVersion']
```

Без `Authorization`, без `mc_session` cookie.

**Воздействие:**
- **Замысел**: `/api/v1/ingredients` — reference data (по аналогии с `/api/v1/recipes` public catalog). Это нужно для UI pricing-планирования и nutrition-расчёта.
- **Side effect**: конкурент может парсить каталог → построить price-index. **Это by-design** (иначе как UI показывает budget?), НО нужно явно задокументировать.
- **Если бизнес-req**: цены ингредиентов НЕ публичны (потому что они зависят от бизнес-стратегии закупок), тогда **T10-A = P0 leak** — нужно поставить `AuthGuard` на `ingredients.controller`.

**Если `avgPriceKopecks` НЕ предназначен для публичного exposure (как цены в B2B-каталоге, где конкуренты могут использовать это для underpricing), это серьёзная утечка.** Решение: добавить `UseGuards(AuthGuard)` на `ingredients.controller` или вернуть stripped shape (только `id, canonicalName, defaultUnit`) для не-authorized.

**Фикс:**
```ts
// Один из вариантов:
@UseGuards(AuthGuard)
@Controller({ path: 'ingredients' })
export class IngredientsController { ... }
```

Если публичность by-design — добавить в OpenAPI комментарий `// PUBLIC reference data, pricing exposed`.

---

## 2. Подтверждённые здоровые паттерны (7 health-checks)

### ✅ IDOR `/jobs/<other-user-job>` → 404 JOB_NOT_FOUND
```bash
$ curl -b "$fresh_session_jar" $BASE/api/v1/jobs/c207a0c2-...-f809525e5334
  HTTP=404
  body: JOB_NOT_FOUND
```
Другого пользователя jobId (нашёл через прямой SQL) — **404, не 403**. Private-non-existence.

### ✅ `/jobs/<non-ulid-format>` → 404
```
$ curl -b jar $BASE/api/v1/jobs/not-a-ulid-format-just-string
  HTTP=404 JOB_NOT_FOUND
```
UUID-валидация отсутствует, но outcome correct.

### ✅ `resultRef` = `MealPlan.id` (5/5 совпадают)

**DB-сверка (sample 5 rows):**
```sql
SELECT j.id, j."resultRef", mp.id AS mealplan_id,
       (j."resultRef" = mp.id) AS ref_matches_plan
FROM "Job" j
LEFT JOIN "MealPlan" mp ON mp.id = j."resultRef"
WHERE j.status = 'COMPLETED' AND j."resultRef" IS NOT NULL LIMIT 5;
```

| job_id | resultRef | mealplan_id | ref_matches_plan |
|---|---|---|---|
| 7b0c1fad-... | 7b0c1fad-... | 7b0c1fad-... | ✅ t |
| 203caed8-... | 203caed8-... | 203caed8-... | ✅ t |
| 98364a0a-... | 98364a0a-... | 98364a0a-... | ✅ t |
| ... | ... | ... | ... |

**Worker contract подтверждён:**
```ts
const plan = await tx.mealPlan.create({
  data: { id: data.jobId, householdId: data.householdId, ... }
});
```
**Plan наследует `data.jobId` как primary key** → `resultRef = job.id = plan.id`. By design.

**Discovered клиентский паттерн:** после `jobId.COMPLETED` фронтенд должен делать **либо** `GET /api/v1/meal-plans/active` (самый fresh план), **либо** использовать `resultRef` напрямую для запроса `meal-plan/:resultRef` (если endpoint существует; см. ниже).

### ✅ Global `prefers-reduced-motion: reduce` handler
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 100ms !important;
  }
}
```
Глобальный selector, отключает все анимации и transitions ≤ 100ms для accessibility. **Это is real a11y compliance** — даже если `transition-duration` 120ms в Bootstrap-кнопках не отключены per-component, глобальный reset их перебивает. ✅

### ✅ `prefers-color-scheme: dark` fallback
```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --color-bg: #1a1713;
    --color-surface: #242019;
    ...все токены переопределены;
  }
}
```
Если у пользователя `localStorage('mc-theme')` не задан, OS-уровневый dark preference активируется автоматически. ✅

### ✅ CSP report-uri endpoint всё ещё **404**
(Остаётся TODO из #3 T6.)

### ✅ `/api/v1/health/ready` info-leak: отсутствует
```
Server: nginx/1.24.0 (Ubuntu)   ← Это nginx, не API
body: {"status":"ready"}        ← Чистый JSON, нет версии/stacktrace
```
Только название сервера (nginx) — не зависит от runtime (Fastify/Nest version не утекает).

---

## 3. Микро-наблюдения

- **T10-B**: Полная инвентаризация `console.*` (не-NestJS логгер) **всего** репо:
  ```
  apps/api/src:        6 calls (main.ts boot, health.ready fallback)
  apps/web/src:        1 call  (recommendations-client.ts: только в mock-mode)
  apps/worker/src:     5 calls (boot, graceful shutdown)
  ```
  **Все** — startup и graceful-shutdown сообщения. Бизнес-логика использует NestJS Logger (`@Injectable()`). **Приемлемо для production** — это не security/monitoring угроза.

- **T10-C**: `/api/v1/profile/preferences` без auth → 401 UNAUTHORIZED (`AuthGuard` работает). С 4 случайными ингредиентами — `count=0` (не другая user'ы preferences утекают). ✅

- **T10-D**: 50-burst на `/recipes?limit=20` → ~75 ms total (1.5 ms/req avg). Connection pool grows gracefully to 17 idle. Не исчерпывает лимиты.

- **T10-E**: 100-burst `/jobs/:id` (warm session, throttle=300/min) → 1 ms/req avg. Идеально для polling.

---

## 4. Сводка таблицей (NEW в этой итерации)

| # | Приоритет | Зона | Находка | Где |
|---|---|---|---|---|
| **T10-A** | 🟠 P2 | API | `/api/v1/ingredients` list/detail публично раскрывают `avgPriceKopecks`, `density`, `ediblePartRatio` (без auth). Потенциальная коммерческая утечка pricing. | `apps/api/src/ingredients/ingredients.controller.ts` (нет `@UseGuards(AuthGuard)`) |

---

## 5. Что НЕ удалось проверить
- 🟡 **Sustained worker load** — нужна long-running session
- 🟡 **`/`  и `/.well-known`** — only 404s, not specific check
- 🟡 **Frontend cache middleware** — не проверял Etag/Last-Modified на JS chunks (audit #3 уже подтвердил `max-age=31536000, immutable`)

---

## 6. Куммулятивный итог (10 итераций)

| Iter | Findings | 🔴 P0 | 🟠 P1–P2 | 🟡 P3 / ℹ️ | Cumulative 🔴 |
|---|---|---|---|---|---|
| #1 | B1–B6 (6) | 2 | 1 | 3 | 2 |
| #2 | M1–M9 (9) | 3 | 2 | 4 | 5 |
| #3 | T1–T6, U1–U4 (11) | 4 | 3 | 4 | 9 |
| #4 | T4-A, T4-B, T4-C (3) | 0 | 2 | 1 | 9 |
| #5 | T5-A, T5-B (2) | 0 | 2 | 0 | 9 |
| #6 | T6-A (1) | 0 | 1 | 0 | 9 |
| #7 | T7-A, T7-B (2) | 0 | 2 | 0 | 9 |
| #8 | T8-A, T8-B (2) | 0 | 2 | 0 | 9 |
| #9 | T9-A, T9-B (2) | 0 | 2 | 0 | 9 |
| **#10** | **T10-A (1)** | **0** | **1** | **0** | **9** |
| **Σ** | **~39 уникальных** | **9 P0** | **18 P1-P2** | **12 ℹ️/P3** | — |

**Тренд 10 итераций подтверждён:** P0 не появляется **8 итераций подряд**. Каждое новое наблюдение — single config / contract finding.

---

## 7. Рекомендации (10-я итерация)

1. **(P0 OR design-doc, 5 мин, T10-A)** Решить бизнес-вопрос: `avgPriceKopecks` — публичные или нет?
   - Если публичные → добавить комментарий `@ApiOperation({})` // PUBLIC reference data, pricing intentionally exposed
   - Если закрытые → `@UseGuards(AuthGuard)` на `ingredients.controller.ts` (1 строка) + 2 shape-changes на /ingredients?list и /ingredients/:id
2. **(P0, повтор)** 9 P0 из предыдущих итераций (см. AUDIT-REPORT.md).

---

## 8. Артефакты (10-я итерация)

| Артефакт | Где |
|---|---|
| Этот отчёт | `docs/audit/AUDIT-REPORT-10.md` (коммит ниже) |
| `/api/v1/ingredients?limit=1` raw | §1 |
| `resultRef = MealPlan.id` DB-сверка | §2 |
| `prefers-reduced-motion` CSS | §2 |
| `prefers-color-scheme: dark` CSS | §2 |
| console.* sweep across 3 apps | §3 |
