# R15 / Фаза B2 — Worker / Planner аудит

**Объект:** `apps/worker` (BullMQ Worker, 5 файлов + plan-week=387 строк), `packages/recommendation` (planner + ranking + filters + scoring).
**Объём:** прочитал main.ts, loop.ts, processor.ts, job-runner.ts, plan-week.ts (по R13), stages.ts. planner.ts не дублирую — закрыт R13 + детальными тестами.

## Сводная B2

| Severity | Количество | Темы |
|---|---|---|
| HIGH | 2 | BullMQ lifecycle + Router job-type mismatch |
| MEDIUM | 4 | retries/metrics/observability |
| LOW | 3 | cosmetic |

---

## HIGH (B2)

### B2-H1. `processJob()` молча COMPLETED-ит все job-types кроме `GENERATE_PLAN`
- **Файл:** `apps/worker/src/processor.ts:18-29`.
- **Что:** R13 + PlanSchema показывают, что API enqueue-ит jobs с типами: `GENERATE_TODAY`, `GENERATE_PLAN`, `RESCUE`, `LEFTOVERS`, `ROULETTE`, `REGENERATE`, `BUILD_SHOPPING_LIST` (см. `prisma/schema.prisma:154-162` enum). Но `processor.ts:21-27` обрабатывает **только** `GENERATE_PLAN`, остальные — default → mirror COMPLETED, **job в Postgres помечается completed без реальной работы**.
- **Доказательство:** job `resultRef === null`, stage='done', status='COMPLETED' для всего, что не GENERATE_PLAN. **Клиент polling** `/jobs/:id` увидит success без эффекта.
- **Impact:**
  - Если ROULETTE/GENERATE_TODAY реально работают через другой механизм (sync endpoints), но клиент ожидает async job — **UI будет показывать «готов»** без результата.
  - Это **HIGH** потому что async/sync-job контракт может разойтись с типом enqueue и обмануть клиента.
- **Фикс:** в `processor.ts` добавить switch-cases для всех типов с честным `throw new Error('TYPE NOT YET SUPPORTED')` (это даст FAILED-статус), либо пробросить в API sync handlers.

### B2-H2. Worker SIGTERM ждёт активный job без верхней границы
- **Файл:** `apps/worker/src/main.ts:30-37`.
- **Что:** `await worker.close()` → дренаж, но **нет таймаута**. Если один job «висит» (например, `runPlanWeek` ждёт на I/O), worker не выйдет по SIGTERM.
- **Impact:** systemd может убить process через `TimeoutStopSec`, и job потеряется без COMPLETED. Документировано в ADR-0004 («BullMQ requeues stalled»), но в worker этого нет. Если Postgres unreachable → job-handler ждёт — worker вечный.
- **Фикс:** `Promise.race([worker.close(), new Promise(r => setTimeout(r, 30_000))])`.

---

## MEDIUM (B2)

### B2-M1. `maxRetriesPerRequest: null` в worker.Redis connection (BullMQ рекомендует именно null)
- **Файл:** `apps/worker/src/main.ts:18`.
- **Что:** Это **спецификация BullMQ** — connection для BullMQ worker должен иметь `maxRetriesPerRequest: null`, потому что BullMQ сам управляет retries (default 0). Логика правильная, но **нет обоснования в комментарии**, и любая правка может сломать протокол.
- **Фикс:** добавить комментарий, сослаться на BullMQ docs.

### B2-M2. Worker не публикует метрик (no OpenTelemetry / Datadog / Prometheus)
- **Файл:** `apps/worker/src/job-runner.ts:47-68`.
- **Что:** `runWithMirror` обновляет Postgres Job row, но **не отдаёт** в OTEL/Prometheus. Невозможно увидеть SLO queue latency / error rate без grepping job table.
- **Impact:** R&D — нет рантайм алертинга.
- **Фикс:** добавить `process.hrtime` / `Histogram` в обработчике, emit в StatsD/Prometheus.

### B2-M3. `report()` callback в `plan-week.ts` синхронно-update БД на каждом stage — нет batch
- **Файл:** `apps/worker/src/plan-week.ts:144, 216, 236, 243`, `job-runner.ts:55-57`.
- **Что:** каждый `await report('filtering')` → `mirror.setStage()` → `prisma.job.update`. 4 update'а на 1 plan. На нагрузке 1000 jobs/час это 4000 UPDATE запросов на Job table.
- **Impact:** не критично. Но baseline.
- **Фикс:** collect-then-flush (in-memory): debounce update каждые ~50ms.

### B2-M4. Planner транзакция: `mealPlan.updateMany(status: ARCHIVED)` + новый create в одной `$transaction` — OK
- **Файл:** `apps/worker/src/plan-week.ts:244-262`.
- **Что:** `$transaction(async tx => { updateMany + create + create days + create entries + create shoppingList + create items })` — это **single atomic operation** ✅. Можно критиковать длину (одна транзакция ~150 строк), но атомарность правильная.
- **Тест:** R14 + R13 проверки через live `POST /meal-plans` → 202 → polling → 200 + dailies — все 5 прогонов в R13 показали полную транзакцию (если бы упала — `mealPlan/active` был бы null, но он возвращал заполненный план).

---

## LOW (B2)

### B2-L1. `loop.ts:IdleLoop` — no-op loop, scaffold-only, оставлен для «next milestone» — нет фактической работы.
### B2-L2. `planner.ts` лезет в `Math.imul(...)` — зависит от ECMAScript typed arrays с int32; на older node стабильно, но не на IE.
### B2-L3. `runPlanWeek` принимает `now: Date = new Date()` — параметр принимает Date, но **в Worker** (processor.ts:23) **не передаёт now** — берёт `new Date()`. Не race-condition (Node однопоточный), но diff между job-started и prisma-written-time имеется.

---

## Подтверждение детерминизма и КБЖУ-девиации

R13 уже сделал 5 live-прогонов. R15 не дублирует. Реальный R13-вывод:

| target kcal/pP | ppl | repeat | noCook | daily avg | deviation (max) |
|---|---|---|---|---|---|
| 2000 | 2 | ALLOW | — | 1487 | 25.7% |
| 2000 | 2 | NO_REPEATS | — | 990–1463 | 53.2% |
| 1700 | 2 | ALLOW | — | 1487 | 12.5% |
| 2000 | 2 | ALLOW | [0,3,5] | 1044–1438 | 47.8% |
| 2500 | 2 | ALLOW | — | 1487 | 40.5% |

**Планер не достигает ≤10% ни в одном прогоне.** Это **уже было в R13**. R15 подтверждает (см. R15 продуктовый раздел), что UI неправильно показывает это: `kcalPercent` использует **per-day-total** (для семьи) и **target=2000** (per-person по умолчанию) — деление семантически неверно. В R15-D (UI-аудит) это детально.

---

## Сводный вывод B2

Worker-слой **технически работает**, но:
1. **B2-H1** — все типы job кроме GENERATE_PLAN молча COMPLETED → клиент может получить success без работы.
2. **B2-H2** — graceful shutdown не имеет таймаута → real prod инцидент.
3. Алгоритм planner детерминирован (mulberry32, seedFromJobId), но **выходит за ±10% КБЖУ** в большинстве прогонов (R13-H3, не исправлено).

B2 не блокирующий, если MC-051/053 ещё в roadmap: B2-H1 — обман клиента, B2-H2 — prod incident recovery, B2-M2 — observability debt.
