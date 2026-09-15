# Технический, продуктовый и UI-аудит MULTI-CHEF (63-й круг)

**Дата:** 2026-09-15
**Область:** API documentation / OpenAPI completeness
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

OpenAPI-документация собирается через `SwaggerModule.createDocument`
в `main.ts:60-86`, доступна только при `NODE_ENV !== 'production'`.
Сильная сторона — глобальная регистрация `swaggerSchemas`
(Zod-derived) через `document.components.schemas`.

Слабые стороны:

- DTO-классы используют `nestjs-zod` `createZodDto()` без
  `@ApiProperty()` декораторов. Swagger показывает пустые /
  неполные схемы полей.
- На большинстве контроллеров нет `@ApiResponse()` для не-200
  статусов — OpenAPI описывает только success-ветки, а 401/403/404
  клиент узнаёт только из реального ответа.
- `version: '0.0.0'` — версия никогда не бампалась, нет связи
  между OpenAPI и реальными релизами.
- В проде OpenAPI отключён. QA / интеграторы в production-like
  окружениях не имеют Swagger UI.

---

## Технические находки (63-й круг)

### T63-A · 🟠 P2 — DTO-классы без `@ApiProperty()` — Swagger показывает пустые схемы

**Где:** `apps/api/src/profile/profile.dto-classes.ts:9-19`,
`apps/api/src/auth/auth.dto-classes.ts` (если есть),
`apps/api/src/main.ts:60-86`.

**Симптом.**

```ts
export class ProfilePatchDto extends createZodDto(ProfilePatchSchema) {}
export class NutritionPutDto extends createZodDto(NutritionPutSchema) {}
export class HouseholdPatchDto extends createZodDto(HouseholdPatchSchema) {}
```

`createZodDto()` создаёт класс, обёртывающий Zod-схему. Swagger
интроспектит класс через `reflect-metadata` и ищет `@ApiProperty()`
на полях. **Этих декораторов нет** нигде в `apps/api/src`
(`grep -rn "@ApiProperty"` → 0 совпадений).

В результате Swagger UI показывает для `ProfilePatchDto`:

```yaml
ProfilePatchDto:
  type: object
  # пусто — ни required, ни properties
```

Аналогично для всех response DTO (`JobDto`, `RecipeDto`,
`TodayRecommendationDto` и т.д.). `swaggerSchemas` в
`packages/contracts` подключаются как `components.schemas`, но
**только как именованные schema-refs**, не как поля DTO-классов.

**Почему важно.** Frontend-разработчик, использующий Swagger для
генерации TypeScript-клиента, получает `any` типы. Интеграторы
не видят обязательность полей, диапазоны, enums.

**Гипотеза фикса.** Использовать
`@nestjs/swagger` плагин `nestjs-zod` (`@ApiProperty` можно
получить через `zod-to-openapi` + кастомный transformer):

```ts
// shared/decorators/zod-api-property.decorator.ts
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);
// потом в profile.dto.ts:
export const ProfilePatchSchema = z.object({
  name: z.string().min(1).openapi({ description: 'Household name' }),
  ...
});
```

Либо — добавить `@ApiProperty()` явно на каждый field класса
(boilerplate, но работает).

---

### T63-B · 🟠 P2 — Большинство эндпоинтов без `@ApiResponse` для error-кодов

**Где:** `apps/api/src/household/household.controller.ts:24-44`,
`apps/api/src/auth/auth.controller.ts` (большая часть),
`apps/api/src/meal-plans/meal-plans.controller.ts`.

**Симптом.** Примеры:

```ts
// household.controller.ts:24-27
@Get()
@ApiOperation({ summary: "Get the authenticated user's household" })
async get(@Req() req: FastifyRequest): Promise<unknown> {
  // ... throws AppHttpException({ code: 'UNAUTHORIZED' }) при отсутствии сессии
}

// meal-plans.controller.ts:51-58
@Get('active')
@ApiOperation({ summary: 'The household's ACTIVE weekly plan' })
async active(@Req() req: FastifyRequest): Promise<unknown> { ... }
// нет @ApiResponse({ status: 404, description: 'PLAN_NOT_FOUND' })
```

В Swagger UI эти эндпоинты показывают только 200. Клиент не знает,
что `404` возможен, и пишет обработчик «план не существует» уже
после инцидента в проде.

**Сравнение:** `jobs.controller.ts:23-25` — корректный пример:

```ts
@ApiResponse({ status: 200, description: 'Job row' })
@ApiResponse({ status: 404, description: 'JOB_NOT_FOUND (own or foreign)' })
```

**Почему важно.** Без `@ApiResponse` на error-коды фронтенд
покрывает только happy-path, а edge cases (404, 409, 422)
проявляются как unhandled rejection в браузере.

**Гипотеза фикса.** Либо convention — общий `ApiCommonResponses`
helper:

```ts
export const ApiAuthResponses = () =>
  applyDecorators(
    ApiResponse({ status: 401, description: 'No session' }),
    ApiResponse({ status: 403, description: 'No owned household' }),
  );
```

И на каждом контроллере `@ApiAuthResponses()` плюс
endpoint-specific `@ApiResponse({status: 404, ...})`.

---

### T63-C · 🟡 P3 — OpenAPI version = '0.0.0' hardcoded

**Где:** `apps/api/src/main.ts:64`.

**Симптом.**

```ts
const swaggerConfig = new DocumentBuilder()
  .setTitle('MULTI-CHEF API')
  .setDescription('Backend HTTP API for the MULTI-CHEF monorepo (Phase 1+).')
  .setVersion('0.0.0');
```

Версия OpenAPI спецификации — всегда `'0.0.0'`, потому что
никто не бампает. В CI нет шага синхронизации версии
спецификации с релизом.

**Почему важно.** Интеграторы / клиентские SDK не могут проверять
совместимость версий. Любое breaking change в API остаётся
незаметным.

**Гипотеза фикса.** В `package.json` apps/api добавить `"version"`
(например, `"1.4.0"`), читать в `main.ts`:

```ts
import { version } from './package.json' with { type: 'json' };
.setVersion(version)
```

Либо из env: `OPENAPI_VERSION=${GITHUB_SHA}` в CI pipeline.

---

### T63-D · 🟡 P3 — OpenAPI отключён в production

**Где:** `apps/api/src/main.ts:73-83`.

**Симптом.**

```ts
if (env.NODE_ENV !== 'production') {
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // ... register schemas ...
  SwaggerModule.setup('api/v1/docs', app, document, { ... });
}
```

В production Swagger UI не поднимается. Комментарий объясняет:
«full API contract (models, paths) is an internal artefact — do
not expose it on internet/LAN deployments».

Это разумно с точки зрения security (не светим все эндпоинты
анонимам), но:

1. **QA в staging** — если staging = `NODE_ENV=production` (типичная
   практика), QA не имеет Swagger.
2. **Mobile team** — для разработки мобильного клиента нужна
   актуальная спецификация, в том числе в pre-prod окружениях.
3. **Отладка интеграций** — служба поддержки не может показать
   клиенту «что у нас есть в API» безопасно.

**Гипотеза фикса.** Включить в production, но закрыть
авторизацией:

```ts
if (env.NODE_ENV !== 'production' || env.ENABLE_OPENAPI) {
  SwaggerModule.setup('api/v1/docs', app, document, {
    swaggerOptions: { persistAuthorization: false },
  });
}
// плюс auth-guarded middleware на /api/v1/docs в prod
```

Либо публиковать `openapi.json` (без UI) на отдельный bucket для
CI/CD pipeline, а UI держать только в dev.

---

## Подтверждённые здоровые паттерны

- `swaggerSchemas` регистрируются глобально через
  `document.components.schemas` — общий каталог Zod-derived схем
  для всех модулей.
- `addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat:
'ULID-26' })` — корректное описание session-token аутентификации.
- `addCookieAuth('mc_session', { type: 'apiKey', in: 'cookie' })`
  — параллельно описывает cookie-аутентификацию.
- `persistAuthorization: false` в Swagger UI — не сохраняет
  токены между сессиями (security).
- `setGlobalPrefix('api/v1')` + `SwaggerModule.setup('api/v1/docs')`
  — корректное выравнивание префиксов.
- Все контроллеры используют `@ApiTags()` — OpenAPI сгруппирован по
  доменам.

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                         | Файл / место                                           |
| ----- | --- | ---- | -------------------------------------------------------------- | ------------------------------------------------------ |
| T63-A | 🟠  | P2   | DTO-классы через `nestjs-zod` без `@ApiProperty()`. Swagger    | apps/api/src/profile/profile.dto-classes.ts:9-19,      |
|       |     |      | показывает пустые схемы полей                                  | auth.dto-classes.ts, apps/api/src/main.ts:60-86        |
| T63-B | 🟠  | P2   | Большинство эндпоинтов без `@ApiResponse` для error-кодов.     | apps/api/src/household/household.controller.ts:24-44,  |
|       |     |      | Клиент не знает про 401/403/404 до первого инцидента           | apps/api/src/meal-plans/meal-plans.controller.ts:51-58 |
| T63-C | 🟡  | P3   | OpenAPI version = '0.0.0' hardcoded. Никогда не бампалась.     | apps/api/src/main.ts:64                                |
|       |     |      | SDK не может проверять совместимость                           |                                                        |
| T63-D | 🟡  | P3   | OpenAPI отключён в production. QA / mobile team в pre-prod без | apps/api/src/main.ts:73-83                             |
|       |     |      | актуальной спецификации                                        |                                                        |

---

## Куммулятивный итог (63 круга)

- **Всего найдено проблем:** 252 (T21–T63).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  142 · 🟡 P3: 84.
- **Раунды с нулевыми находками:** 0 из 63.
- **Топ-5 зон:** rate-limiting / DTO-валидация (33), observability /
  healthchecks (26), DB indexes (4), money / числовая арифметика (19),
  BullMQ / worker (20).
- **Новые зоны в этом круге:** OpenAPI / API documentation.

---

## Рекомендации (63-й круг)

1. **T63-A — на этой неделе.** Подключить `zod-to-openapi` +
   `extendZodWithOpenApi(z)`; добавить `.openapi({description, ...})`
   на все Zod-поля, либо добавить `@ApiProperty()` явно.
2. **T63-B — на этой неделе.** Ввести helper `ApiAuthResponses` +
   добавить `@ApiResponse` на каждый не-200 код (401, 403, 404, 409, 422) в каждом контроллере.
3. **T63-C, T63-D — на спринт.** Читать `version` из package.json;
   включать OpenAPI в production по env-флагу.

---

## Артефакты (63-й круг)

- `docs/audit/AUDIT-REPORT-63.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T63-A…T63-D.
