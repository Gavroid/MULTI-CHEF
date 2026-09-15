# Технический, продуктовый и UI-аудит MULTI-CHEF (62-й круг)

**Дата:** 2026-09-15
**Область:** API rate limiting per-endpoint granularity
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

`@nestjs/throttler` подключён через глобальный `ThrottlerGuard` с
**одним** бакетом 300/мин. Per-endpoint `@Throttle(...)` декоратор
стоит **только** на `AuthController` (10/мин). Это означает, что
все остальные эндпоинты делят один общий бакет на IP, и
тяжёлые операции (`POST /meal-plans`, `POST /recommendations/*`)
не ограничены per-user — один пользователь может их вызывать
тысячами в минуту.

Дополнительно: throttler storage — in-memory, при multi-instance
деплое счётчик per-instance (реальный лимит = N × 300/мин), и
`/health/*` подвержен тому же лимиту (K8s liveness/readiness probe
«съедает» часть бюджета).

---

## Технические находки (62-й круг)

### T62-A · 🟠 P2 — Per-endpoint `@Throttle` только на Auth

**Где:** `apps/api/src/app.module.ts:35`,
`apps/api/src/auth/auth.controller.ts:128`.

**Симптом.** Глобальная конфигурация:

```ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])
// ...
{ provide: APP_GUARD, useClass: ThrottlerGuard }
```

Поиск `@Throttle` по всему `apps/api/src`:

```
apps/api/src/auth/auth.controller.ts:128:@Throttle({ default: { ttl: 60_000, limit: 10 } })
```

Только **один** декоратор, на AuthController. Это значит:

- `POST /meal-plans` (тяжёлая операция — генерация недельного
  плана через worker) → лимит 300/мин на IP.
- `POST /recommendations/today` (synchronous, 300 рецептов
  ranking) → лимит 300/мин на IP.
- `POST /recommendations/rescue` → 300/мин.
- `POST /shopping-lists/:id/apply` (мутация pantry) → 300/мин.
- `PATCH /pantry/items/:id` → 300/мин.
- `POST /households` (смена household) → 300/мин.

Никакой защиты от runaway-клиента (баг в UI с бесконечным циклом
submit'ов) или скрапера.

**Почему важно.** Один пользователь с зацикленным клиентом может
поставить в очередь сотни job'ов генерации плана за минуту. Worker
(`concurrency: 2`, см. **T58-D**) захлёбывается. БД получает сотни
insert'ов в `Job` таблицу.

**Гипотеза фикса.**

```ts
@Throttle({ default: { ttl: 60_000, limit: 5 } })
@Post('meal-plans')

@Throttle({ default: { ttl: 60_000, limit: 30 } })
@Post('recommendations/today')
@Post('recommendations/rescue')
@Post('recommendations/roulette/draw')

@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Patch('pantry/items/:id')
@Post('pantry/items')
```

Либо вынести в `throttle.config.ts` с константами
`THROTTLE_HEAVY = 5`, `THROTTLE_NORMAL = 60`, etc.

---

### T62-B · 🟠 P2 — Throttler tracker по IP, не по userId

**Где:** `apps/api/src/app.module.ts` (дефолт Throttler),
`apps/api/src/main.ts:21` (`trustProxy: '127.0.0.1'`).

**Симптом.** `@nestjs/throttler` по умолчанию использует
`ThrottlerGuard.getTracker(req)` → `req.ip`. После
`trustProxy: '127.0.0.1'` это IP клиента из
`X-Forwarded-For`. **Один корпоративный NAT** (например, офис на
100 человек за одним IP) → 100 пользователей делят 300 req/мин.

Авторизованные пользователи могут дёргать 300 req/мин, но один
пользователь с активной сессией дёргает одни и те же
эндпоинты — bucket считается по IP, не по userId.

**Почему важно.** Это проявляется на B2B-сценариях (мобильное
приложение + web одновременно, или интеграции с фудтех-партнёрами).
И, что важнее, нечестный пользователь за прокси «прикрыт»
соседями по офису.

**Гипотеза фикса.** Кастомный tracker:

```ts
@Injectable()
export class UserOrIpTracker extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ?? req.ip;
  }
}
```

В `app.module.ts`:

```ts
{ provide: APP_GUARD, useClass: UserOrIpTracker }
```

Это требует, чтобы `AuthGuard` отработал раньше throttler'а.
Сейчас `AuthGuard` per-controller через `@UseGuards`, не
глобально — нужна перестановка или `APP_GUARD` для AuthGuard.

---

### T62-C · 🟡 P3 — `/health/live` и `/health/ready` под global throttler

**Где:** `apps/api/src/health/health.controller.ts`,
`apps/api/src/app.module.ts:35,59`.

**Симптом.** Health-эндпоинты попадают под глобальный
`ThrottlerGuard`. K8s liveness probe настраивается обычно на
каждые 5-10 секунд. Это 6-12 req/мин **на под**. В мульти-под
деплое (типично 3-10 подов) probe идёт в каждый под: 18-120
req/мин «съедаются» K8s'ом из общего бюджета 300/мин на IP.

Если K8s node IP и ingress IP совпадают (типично для bare-metal),
budget фактически урезается вдвое для реального трафика.

**Почему важно.** При DoS-атаке K8s продолжает долбить healthchecks
и выедает весь bucket, вызывая 429 для реальных пользователей.

**Гипотеза фикса.** `@SkipThrottle()` на health controller:

```ts
@SkipThrottle()
@Controller('health')
export class HealthController { ... }
```

Либо отдельный bucket с `ttl: 1000, limit: 10000` через
`ThrottlerModule.forRoot([...heavyBucket..., ...healthBucket...])`.

---

### T62-D · 🟡 P3 — In-memory throttler storage при multi-instance

**Где:** `apps/api/src/app.module.ts:35`.

**Симптом.**

```ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]);
```

Без указания `storage` параметра используется дефолтный
`ThrottlerStorageService` (in-memory `Map<string, ThrottlerStorageRecord>`).
В мульти-инстанс деплое (production = 3 пода за nginx) у каждого
пода свой bucket: реальный лимит = **3 × 300 = 900 req/мин на IP**.

**Почему важно.** Заявленный лимит 300/мин не соответствует
реальному поведению. В attack-сценарии злоумышленник
round-robin'ит между инстансами и обходит throttling.

**Гипотеза фикса.**

```ts
ThrottlerModule.forRoot({
  throttlers: [{ ttl: 60_000, limit: 300 }],
  storage: new ThrottlerStorageRedisService(redisClient),
});
```

Где `ThrottlerStorageRedisService` — кастомная реализация с
инкрементом по ключу `throttle:{tracker}:{bucket}` и TTL = ttl.
Использует уже сконфигурированный Redis из
`loadServerEnv().REDIS_URL`.

---

## Подтверждённые здоровые паттерны

- `exposedHeaders: ['x-ratelimit-limit', 'x-ratelimit-remaining',
'x-ratelimit-reset']` (`main.ts:48`) — клиент видит состояние
  bucket'а.
- `ThrottlerGuard` подключён через `APP_GUARD` — глобально,
  невозможно случайно забыть на новом контроллере.
- `auth/auth.controller.ts:128` использует `@Throttle` с явными
  `ttl` и `limit` для login-эндпоинта — корректный anti-bruteforce.
- `loadServerEnv().REDIS_URL` валидируется до throttler-инициализации
  (fail-fast контракт).
- `trustProxy: '127.0.0.1'` — только локальный gateway, не весь
  интернет (это правильно, но в сочетании с **T62-B** создаёт
  специфическую дыру).

---

## Сводка таблицой (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                         | Файл / место                              |
| ----- | --- | ---- | -------------------------------------------------------------- | ----------------------------------------- |
| T62-A | 🟠  | P2   | Per-endpoint `@Throttle` только на Auth. Heavy-endpoints       | apps/api/src/app.module.ts:35,            |
|       |     |      | (`/meal-plans`, `/recommendations/*`) под общим 300/мин        | apps/api/src/auth/auth.controller.ts:128  |
| T62-B | 🟠  | P2   | Throttler tracker по IP, не по userId. Корпоративный NAT делит | apps/api/src/app.module.ts, main.ts:21    |
|       |     |      | bucket между пользователями                                    |                                           |
| T62-C | 🟡  | P3   | `/health/*` под global throttler. K8s probes «съедают» часть   | apps/api/src/health/health.controller.ts, |
|       |     |      | бюджета                                                        | apps/api/src/app.module.ts:35,59          |
| T62-D | 🟡  | P3   | In-memory throttler storage. Multi-instance = N × 300 req/мин. | apps/api/src/app.module.ts:35             |
|       |     |      | Злоумышленник round-robin'ит между подами                      |                                           |

---

## Куммулятивный итог (62 круга)

- **Всего найдено проблем:** 248 (T21–T62).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  140 · 🟡 P3: 82.
- **Раунды с нулевыми находками:** 0 из 62.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33 — включая этот
  раунд), observability / healthchecks (26), DB indexes (4),
  money / числовая арифметика (19), BullMQ / worker (20).

---

## Рекомендации (62-й круг)

1. **T62-A — на этой неделе.** Расставить `@Throttle` на heavy
   endpoints: 5/мин на `POST /meal-plans`, 30/мин на
   `POST /recommendations/*`, 60/мин на pantry-мутации.
2. **T62-B — на этой неделе.** Кастомный `UserOrIpTracker` через
   `req.user?.id ?? req.ip`.
3. **T62-C, T62-D — на спринт.** `@SkipThrottle()` на health +
   Redis-backed throttler storage.

---

## Артефакты (62-й круг)

- `docs/audit/AUDIT-REPORT-62.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T62-A…T62-D.
