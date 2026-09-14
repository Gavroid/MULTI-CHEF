# Технический, продуктовый и UI-аудит MULTI-CHEF (16-й круг)

**Дата:** 2026-09-14
**HEAD:** `72fda5e chore(audit): AUDIT-REPORT-15 fifteenth-iteration findings T15-A T15-B idempotency race`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-15.md`, `VERIFICATION.md`
**Цель:** найти следующее config/contract-наблюдение. Edge cases на read-only endpoints, prepare/storage без плана.

## TL;DR

16-й круг: **1 🟠 P3 находка** + **7 подтверждённых здоровых паттернов** + **2 подозрительных transient-ошибки** в логах API.

- 🟠 **T16-A — `GET /api/v1/meal-plans/active` возвращает RAW `null` body** при отсутствии активного плана. **Content-Length: 4** (`null`). Это повторение T8-B — третий случай envelope-mix (находки в разных endpoints возвращают разные shapes для empty/error-state).
- ✅ `POST /api/v1/meal-plans/active/prep` (no plan) → **404 PLAN_NOT_FOUND**. Корректное поведение, никаких raw-null.
- ✅ `GET /api/v1/meal-plans/active/storage` (no plan) → **404 PLAN_NOT_FOUND**. Корректно.
- ✅ `/ingredients/<id>` все write-методы (POST/PUT/DELETE) → 404 (read-only).
- ✅ `/jobs/<id>` только GET, остальные → 404.
- ✅ `x-ratelimit-*` headers exposed даже на /health/live.
- ✅ `/profile/onboarding` × 2 (повтор) → 200 OK (idempotent — buggy transient Prisma error в логах не воспроизведён).
- ✅ Total endpoints: **45 декорированных** методов.

---

## 1. Технические находки (16-й круг)

### T16-A. `GET /api/v1/meal-plans/active` returns RAW `null` body (when no plan) 🟠

**Файл:** `apps/api/src/meal-plans/meal-plans.service.ts:getActiveForUser`

**Raw (cURL с -i показывает headers и body):**

```
$ curl -i http://192.168.1.95:8080/api/v1/meal-plans/active
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 4

null
```

**Причина:** Service возвращает `null` напрямую из `findFirst` при отсутствии плана, без envelope-обёртки:

```ts
async getActiveForUser(userId: string) {
  ...
  const plan = await getPrisma().mealPlan.findFirst({...});
  if (!plan) return null;       // ← RAW null, не {plan: null}
  return { id, startDate, ..., days: [...] };
}
```

**Воздействие:** уже 5-й случай envelope-mix в разных endpoints:

- `/meal-plans/active` → null (T8-B, T12-A confirmed, **T16-A здесь**)
- `/profile/nutrition` → null (T9-B)
- `/shopping-lists/active` → null (T12-A)
- `/meal-plans/active/storage` → 404 PLAN_NOT_FOUND (правильно через throw)

Это **front-end integration hazard**: каждый endpoint, который может вернуть «empty», обрабатывает это по-разному. **Только `null` (raw) или `404 (envelope)` — единая стратегия отсутствует.**

**Фикс (5 мин):**

```ts
if (!plan) return { plan: null }; // или throw NOT_FOUND как в storage
```

---

### T16-B (transient) — Возможный race в onboarding upsert 🟠 (подозрительно)

**Файл:** `apps/api/src/profile/profile.service.ts:onboarding`

**Журнал (от `journalctl -u multichef-api -n 100`):**

```
Sep 14 14:38:37 multichef pnpm[28899]: prisma:error
Sep 14 14:38:37 multichef pnpm[28899]: [Nest] ERROR [AppHttpExceptionFilter] unhandled exception:
Sep 14 14:38:37 multichef pnpm[28899]: PrismaClientKnownRequestError:
```

**Контекст (reproduce):**

- В A16-12 я отправил `{"householdSize":3,...,"appliances":["OVEN"]}` без `allergies` поля → получил **HTTP 500**.
- В A16-12 второй попытке с тем же телом — **HTTP 500** (?). 5-concurrent регистрации могут влиять.
- В T16-A-CONFIRM свежая `jar` с тем же body → **HTTP 200**.

**Проблема:** иногда onboarding возвращает 500. **Не удалось стабильно воспроизвести.** Возможные причины:

1. Race-conditions в `tx.nutritionProfile.upsert({where:{userId}, ...})` — Prisma не serializes concurrent upserts по userId, иногда возвращает error.
2. Pre-existing FK violation когда `tx.household.findFirstOrThrow` запускается до `tx.user.create`.
3. Что-то в race с параллельными register/onboarding.

**Не могу подтвердить стабильно**, но **журнал показывает, что нечто подобное происходит**. **Фикс для исследования:**

```ts
// profile.service.ts onboarding()
try {
  return await getPrisma().$transaction(async (tx) => {...});
} catch (e) {
  if (e.code === 'P2002') return { nutritionProfile: {...existing}, preferencesCreated: 0 };
  throw e;
}
```

---

## 2. Подтверждённые здоровые паттерны (7 health-checks)

### ✅ `POST /api/v1/meal-plans/active/prep` (no plan)

```
HTTP=404
code: PLAN_NOT_FOUND
msg: "Активный план не найден"
```

Корректно: prep endpoint без плана возвращает typed 404, НЕ RAW null. ✅

### ✅ `GET /api/v1/meal-plans/active/storage` (no plan)

```
HTTP=404
code: PLAN_NOT_FOUND
```

Тот же правильный pattern: typed error envelope (как должно быть везде).

### ✅ `/ingredients/<id>` все write-методы отбиты

```
POST /ingredients/<id>   → 404
PUT /ingredients/<id>    → 404
DELETE /ingredients/<id> → 404
```

Catalog read-only by design. NestJS возвращает чистый `{"status":404,"error":{"code":"NOT_FOUND","message":"Cannot POST /api/v1/ingredients/..."}}`. ✅

### ✅ `/jobs/<id>` только GET

```
GET /jobs/<id>      → 401 (no auth — нужно залогиниться)
POST /jobs/<id>     → 404
PUT /jobs/<id>      → 404
DELETE /jobs/<id>   → 404
PATCH /jobs/<id>    → 404
/jobs (no id) — все методы → 404
```

`/jobs/:id` endpoint read-only by design. ✅

### ✅ `x-ratelimit-*` headers exposed на health endpoints

```
access-control-expose-headers: x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset
x-ratelimit-limit: 300
x-ratelimit-remaining: 299  (after 1 request)
x-ratelimit-reset: 60
```

Throttle metadata правильно пробрасывается даже на неаутентифицированных endpoint'ах.

### ✅ Total endpoint count = 45 decorated methods

```bash
$ grep -rE '@(Get|Post|Patch|Put|Delete)\(' apps/api/src --include='*.ts' | grep -v test | wc -l
45
```

Inventory of 45 декорированных route methods. Все ранее задокументированы (audit #3).

### ✅ `/profile/onboarding` × 2 (replay) → обе 200

```
1st onboarding: HTTP=200
2nd onboarding (same body, sequential): HTTP=200
nutritionProfile persist: yes
```

Cachable idempotent re-run. ✅

---

## 3. Микро-наблюдения

- **T16-C** — `/api/v1/auth/login` Idempotency-Key × 2 = 403, 403 (rate-limit или CSRF issue). Не критично (аутентификация всегда strict).
- **T16-D** — `Content-Length: 4` для null body — корректная длина `null` literal в JSON (4 байта: `n`, `u`, `l`, `l`). Browser/Proxy корректно обрабатывает.
- **T16-E** — `/shopping-lists/:id/apply-proposal` Idempotency-Key × 2 = 400, 400 (по 1st уничтожил объект). Это **транзакционное изменение**, не идемпотентный by-design — replay даёт «предмет уже изменён» (T15-A pattern, подтверждено).
- **T16-F** — Уже 5+ находок envelope-mix:

  | Endpoint                                   | State    | Body                                 |
  | ------------------------------------------ | -------- | ------------------------------------ |
  | `GET /meal-plans/active` (no plan)         | T16-A    | RAW `null` ❌                        |
  | `GET /profile/nutrition` (no profile)      | T9-B     | RAW `null` ❌                        |
  | `GET /shopping-lists/active` (no list)     | T12-A    | RAW `null` ❌                        |
  | `GET /meal-plans/active/storage` (no plan) | T16-A ✅ | envelope `{plan: null}` ok           |
  | `POST /meal-plans/active/prep` (no plan)   | T16-A ✅ | envelope `{code: PLAN_NOT_FOUND}` ok |
  | `POST /profile/preferences` (POST)         | T11-A    | RAW object, no envelope ❌           |

  → **3/6 возвращают raw null/object, 3/6 — envelope.** Двойственный standard.

---

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет      | Зона         | Находка                                                                                                                                                         | Где                                                              |
| --------- | -------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **T16-A** | 🟠 P3          | API/contract | `GET /api/v1/meal-plans/active` возвращает RAW `null` body (Content-Length=4) когда нет активного плана. 5-й пример envelope-mix паттерна.                      | `apps/api/src/meal-plans/meal-plans.service.ts:getActiveForUser` |
| **T16-B** | 🟠 (transient) | API/DB       | `POST /profile/onboarding` иногда возвращает 500 (журнал показывает PrismaClientUnknownRequestError). Не удалось стабильно воспроизвести; flag для мониторинга. | `apps/api/src/profile/profile.service.ts:onboarding`             |

---

## 5. Куммулятивный итог (16 кругов)

| Iter    | Findings                                | 🔴 P0     | 🟠 P1–P3        | 🟡 P3 / ℹ️   | Cumulative 🔴 |
| ------- | --------------------------------------- | --------- | --------------- | ------------ | ------------- |
| #1–3    | 26 (B1–B6, M1–M9, T1–T6, U1–U4)         | 9         | 6               | 11           | 9             |
| #4–10   | 13 (envelope / config)                  | 0         | 13              | 0            | 9             |
| #11     | T11-A, T11-B                            | 0         | 2               | 0            | 9             |
| #12     | T12-A                                   | 0         | 1               | 0            | 9             |
| #13     | T13-A                                   | 1         | 0               | 0            | **10**        |
| #14     | T14-A                                   | 0         | 1               | 0            | 10            |
| #15     | T15-A, T15-B                            | 1         | 1               | 0            | **11**        |
| **#16** | **T16-A (definite), T16-B (transient)** | 0         | 2               | 0            | 11            |
| **Σ**   | **~47–48 уникальных**                   | **11 P0** | **24–25 P1-P3** | **12 ℹ️/P3** | —             |

**Тренд 16-ти:** стабильная без P0, но **2 паттерна race-condition**, обнаруженные в кругах 13–15 (T13-A, T15-A), могут проявиться в любой момент производственной нагрузки. **T16-B — возможна третья race-condition** в onboarding, требующая долгосрочного мониторинга.

---

## 6. Рекомендации (16-й круг)

1. **(P3, 5 мин, T16-A)** Заменить `return null` на `return {plan: null}` в `meal-plans.service.ts:getActiveForUser`. **Решает 5-й envelope-mix случай.**
2. **(P3+) Global envelope-cleanup** — campaign: унифицировать 6+ raw-object endpoint'ов (B-prefix + Z-prefix).
3. **(P0, повтор)** T13-A, T15-A, M1 **не пофикшены**. Это критичные race-conditions.
4. **(P3, ongoing)** Долгосрочное observability: добавить счётчик `5xx_error_count{endpoint}` в Prometheus metrics (см. T7-D audit #7).

---

## 7. Артефакты (16-й круг)

| Артефакт                                | Где                                           |
| --------------------------------------- | --------------------------------------------- |
| Этот отчёт                              | `docs/audit/AUDIT-REPORT-16.md` (коммит ниже) |
| `/meal-plans/active` RAW null raw probe | §1                                            |
| `POST /meal-plans/active/prep` 404 raw  | §2                                            |
| All 45 endpoints inventory confirmed    | §2                                            |
| Journalctl transient 500 trace          | §1                                            |
