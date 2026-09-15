# Технический, продуктовый и UI-аудит MULTI-CHEF (69-й круг)

**Дата:** 2026-09-15
**Область:** Webhook / external API integration patterns
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

В MULTI-CHEF **нет ни одного HTTP-вызова** к внешним сервисам в
runtime (поиск `axios` / `fetch(` / `undici` / `got` в
`apps/api/src` → 0 совпадений). Все интеграции — локальные:
Prisma (Postgres), IORedis (Redis), BullMQ (Redis).

Объявлены в env, но **не используются**:

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (env.schema.ts:104-105)
- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` (env.schema.ts:100-101)
- `ANALYTICS_WRITE_KEY` (env.schema.ts:103)

`TemplateAiProvider` явно помечен как «placeholder for LLM
enrichment in later phase» — подготовки (retry / timeout /
circuit breaker / observability) нет. Webhook endpoints полностью
отсутствуют — нет ни одного `/webhook/*` контроллера.

---

## Технические находки (69-й круг)

### T69-A · 🟠 P2 — `TemplateAiProvider` без подготовки к реальному LLM

**Где:** `apps/api/src/recommendations/ai/template-provider.ts:18-43`,
`apps/api/src/recommendations/recommendations.service.ts:144,269,388`.

**Симптом.**

```ts
@Injectable()
export class TemplateAiProvider implements AiExplanationProvider {
  explain(scored, extra?): string {
    const base = buildExplanation(scored); // чистая функция, без HTTP
    // ... строковые шаблоны
  }
}
```

ADR: «LLM enrichment is a later phase with a feature flag».
Когда придёт время — нужен будет HTTP-вызов к OpenAI / Anthropic.
Сейчас в проекте:

- Нет HTTP client (axios / undici / native fetch) в `apps/api`
  production коде.
- Нет retry-policy (`@nestjs/axios` или своя обёртка).
- Нет timeout / circuit breaker.
- Нет observability (`AiExplanationProvider` interface не
  возвращает ни latency, ни token-count, ни cost).
- Нет rate-limiting (см. **T62** — даже внутренние endpoints
  под общим bucket).

**Почему важно.** LLM-вызовы могут занимать 2-30 секунд, иметь
rate limits, и быть дорогими. Без подготовки подключение
OpenAI в проде = incident «API висит 30 секунд, всё в 504».

**Гипотеза фикса.** Подготовить инфраструктуру заранее:

```ts
// shared/ai/http-ai-provider.ts (skeleton, не подключать пока)
@Injectable()
export class HttpAiProvider implements AiExplanationProvider {
  constructor(
    private readonly http: HttpService,
    private readonly metrics: MetricsService,
  ) {}

  async explain(scored, extra?): Promise<string> {
    const start = Date.now();
    try {
      const res = await firstValueValue(
        this.http.post(env.OPENAI_URL, payload, {
          timeout: 5_000,
          // retry на 5xx — отдельный модуль
        }),
      );
      this.metrics.recordAiCall('openai', Date.now() - start, 'success');
      return res.data.choices[0].message.content;
    } catch (err) {
      this.metrics.recordAiCall('openai', Date.now() - start, 'error');
      throw err;
    }
  }
}
```

Плюс feature flag `LLM_EXPLANATIONS_ENABLED=true|false` для
постепенного rollout.

---

### T69-B · 🟠 P2 — `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` объявлены, но мёртвые

**Где:** `packages/config/src/env.schema.ts:104-105`.

**Симптом.**

```ts
OPENAI_API_KEY: optionalString,
ANTHROPIC_API_KEY: optionalString,
```

Поиск по `apps/` → 0 использований. Env парсится и валидируется
(`optionalString` означает `undefined OK`), но никто не читает.
Это «scaffolding debt»: env объявлен заранее, но логики нет.

**Почему важно.** Оператор видит в `apps/api/.env` ключ и
думает, что LLM включён. На самом деле — нет. Документация
должна явно отмечать «reserved, not yet wired».

**Гипотеза фикса.** Удалить `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
из `serverEnvSchema` пока они не используются, либо добавить
явный комментарий «// reserved for MC-090 LLM explanations —
not yet wired». Лучше второй вариант — это фиксирует намерение.

---

### T69-C · 🟡 P3 — `SENTRY_DSN` объявлен, но Sentry SDK не подключён

**Где:** `packages/config/src/env.schema.ts:100-101`,
`apps/api/package.json` (нет `@sentry/node`),
`apps/web/package.json` (нет `@sentry/nextjs`).

**Симптом.**

```ts
SENTRY_DSN: optionalString,
SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
```

`SENTRY_DSN` парсится, но ни в `apps/api/src/main.ts`, ни в
`apps/worker/src/main.ts`, ни в `apps/web/src/app/layout.tsx` —
нет `Sentry.init({...})`. DSN устанавливается в проде → ничего
не происходит → метрики ошибок теряются.

**Гипотеза фикса.** Либо подключить `@sentry/node` + `@sentry/
nextjs` в соответствующие пакеты, либо убрать DSN-переменные
из schema. Middle-ground: env валидируется, при наличии — log
warning на старте «SENTRY_DSN set but Sentry SDK not installed».

---

### T69-D · 🟡 P3 — Нет webhook endpoints / signature verification

**Где:** весь `apps/api/src/controllers/*` (поиск `webhook`,
`/hooks`, `/callback`, `verifySignature` → 0 совпадений).

**Симптом.** Нет ни одного контроллера, принимающего callbacks
от внешних систем. Когда потребуется (payment provider, email
delivery webhook, food-data sync) — нет шаблона:

- Где проверять HMAC-подпись (`Stripe-Signature`, `X-Hub-Signature-256`)?
- Где хранить idempotency-key (webhook может прийти дважды)?
- Где маппить `event.type` → action?

**Гипотеза фикса.** Завести `apps/api/src/webhooks/webhooks.module.ts`
с generic handler'ом:

```ts
// webhooks.controller.ts
@Post('hooks/:provider')
async handle(
  @Param('provider') provider: string,
  @Req() req: FastifyRequest,
  @Headers('x-signature') signature: string,
): Promise<{ received: true }> {
  const raw = (req as any).rawBody; // нужен raw body для HMAC
  const valid = verifySignature(provider, raw, signature);
  if (!valid) throw new AppHttpException({ code: 'WEBHOOK_SIGNATURE_INVALID' });
  const event = JSON.parse(raw);
  await this.webhookInbox.ingest(provider, event, signature);
  return { received: true };
}
```

Плюс `WebhookEvent` таблица для idempotency и replay.

---

## Подтверждённые здоровые паттерны

- Все external env-keys объявлены через `optionalString` — нет
  fail-fast на отсутствующих optional зависимостях.
- `REDIS_URL` / `DATABASE_URL` обязательные — fail-fast корректно
  ловит критичные зависимости.
- `TemplateAiProvider` registered через DI token `'AiExplanationProvider'`
  — позволяет swap без изменения consumer-кода (правильная
  inversion of control).
- `buildExplanation(scored)` — pure function, детерминированная,
  тестируемая без mock'ов.
- Все POST-mutations покрыты CSRF-guard'ом (см. T67-смежный
  раунд).

---

## Сводка таблицой (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                                | Файл / место                                          |
| ----- | --- | ---- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| T69-A | 🟠  | P2   | `TemplateAiProvider` без подготовки к реальному LLM. Нет HTTP client, | apps/api/src/recommendations/ai/template-provider.ts, |
|       |     |      | retry/timeout/circuit breaker/observability для AI-вызовов            | recommendations.service.ts:144,269,388                |
| T69-B | 🟠  | P2   | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` объявлены, но 0                | packages/config/src/env.schema.ts:104-105,            |
|       |     |      | использований. Scaffolding debt                                       | apps/ (grep → 0 совпадений)                           |
| T69-C | 🟡  | P3   | `SENTRY_DSN` объявлен, но `@sentry/*` SDK не установлен.              | packages/config/src/env.schema.ts:100-101,            |
|       |     |      | DSN в проде → silent no-op                                            | apps/api/package.json, apps/web/package.json          |
| T69-D | 🟡  | P3   | Нет webhook endpoints. Когда потребуется (payment, email) —           | apps/api/src (поиск webhook/callback → 0),            |
|       |     |      | нет шаблона для signature verification / idempotency                  | нет WebhookEvent таблицы                              |

---

## Куммулятивный итог (69 кругов)

- **Всего найдено проблем:** 276 (T21–T69).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  154 · 🟡 P3: 96.
- **Раунды с нулевыми находками:** 0 из 69.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33), observability /
  healthchecks (28), DB pool/indexes (8), error handling (4),
  external integrations (4 — новый раунд).

---

## Рекомендации (69-й круг)

1. **T69-A — на этой неделе.** Skeleton `HttpAiProvider` с retry /
   timeout / metrics, плюс feature flag `LLM_EXPLANATIONS_ENABLED`.
2. **T69-B — на этой неделе.** Добавить комментарий `// reserved`
   к `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
3. **T69-C, T69-D — на спринт.** Либо подключить Sentry, либо
   убрать из schema. Спроектировать `WebhooksModule` для будущих
   callback'ов.

---

## Артефакты (69-й круг)

- `docs/audit/AUDIT-REPORT-69.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T69-A…T69-D.
