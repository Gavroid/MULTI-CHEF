# Технический, продуктовый и UI-аудит MULTI-CHEF (55-й круг)

**Дата:** 2026-09-15
**Область:** Environment variable validation completeness
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

Валидация env-переменных через `packages/config` (Zod-схема
`serverEnvSchema` / `webEnvSchema` + `loadServerEnv()` /
`loadWebEnv()`) — сильное место проекта: API стартует с fail-fast при
битой конфигурации. Но валидация **распространена неравномерно**:

- `apps/worker` (BullMQ consumer) не использует `loadServerEnv()` —
  читает `process.env['REDIS_URL']` напрямую с минимальной проверкой.
- Web-приложение читает минимум 4 `NEXT_PUBLIC_*`-переменные, но в
  `webEnvSchema` зафиксирована только `NEXT_PUBLIC_APP_BASE_URL`; флаги
  `NEXT_PUBLIC_USE_RECIPE_FIXTURES`, `NEXT_PUBLIC_USE_MEALPLAN_MOCK`
  существуют «в коде», но не в схеме.
- Скрипты миграций / импорта (`packages/database/scripts/*`) берут
  `process.env['DATABASE_URL']` напрямую без Zod-парсинга — runtime
  ошибка откладывается до первого запроса к БД.

---

## Технические находки (55-й круг)

### T55-A · 🟠 P2 — Worker не валидирует env на старте

**Где:** `apps/worker/src/main.ts:14-17`.

**Симптом.** Worker начинается так:

```ts
const url = process.env['REDIS_URL'];
if (!url) {
  throw new Error('worker: REDIS_URL is required to consume the planning queue');
}
return new IORedis(url, { maxRetriesPerRequest: null });
```

Это **единственная** валидация. `SESSION_SECRET`, `COOKIE_SECRET`,
`LOG_LEVEL`, `DATABASE_URL`, `RATE_LIMIT_*` — всё, что присутствует в
`serverEnvSchema` — в worker просто не читается. Если деплой
положит `apps/worker/.env` с битым Redis URL или пропущенным
`REDIS_PASSWORD`, worker стартует с тихим дефолтом, а падает только
при первом job'е.

**Почему важно.** Worker — отдельный процесс; его запуск идёт мимо
`apps/api/src/main.ts`, где `loadServerEnv()` стоит **до**
`NestFactory.create()`. Fail-fast контракт не выдерживается.

**Гипотеза фикса.** В `apps/worker/src/main.ts`:

```ts
import { loadServerEnv, EnvValidationError } from '@multichef/config';
let env: ReturnType<typeof loadServerEnv>;
try {
  env = loadServerEnv();
} catch (e) {
  if (e instanceof EnvValidationError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
```

После этого все `process.env[...]` в worker заменить на `env.*`.

---

### T55-B · 🟠 P2 — `NEXT_PUBLIC_USE_*` флаги не в схеме

**Где:** `apps/web/src/lib/recipe-client.ts:89`,
`apps/web/src/lib/recommendations-client.ts:43`,
`packages/config/src/env.schema.ts:webEnvSchema`.

**Симптом.** В коде читаются:

- `NEXT_PUBLIC_USE_RECIPE_FIXTURES` — включает локальный fixture-каталог
  вместо API.
- `NEXT_PUBLIC_USE_MEALPLAN_MOCK` — включает мок для meal plan.
- `NEXT_PUBLIC_APP_BASE_URL` — есть в схеме.

Оба тестовых флага **отсутствуют** в `webEnvSchema` — соответственно,
`loadWebEnv()` их не знает и не валидирует (например, опечатка
`NEXT_PUBLIC_USE_RECIPE_FIXTURE` без «S» молча пройдёт, и фикстуры не
включатся, что заставит e2e-тесты краснеть без понятной диагностики).

**Почему важно.**

1. **DX**: при опечатке нет fail-fast, ошибка всплывает только в
   runtime-логике фикстур.
2. **Документация**: `.env.example` (если он есть) не покрывает
   тестовые флаги, новые разработчики не знают, что они существуют.
3. **Безопасность**: флаги вшиваются в client-bundle, их можно
   случайно включить в production-build через `NEXT_PUBLIC_USE_*=1`.

**Гипотеза фикса.** Расширить `webEnvSchema`:

```ts
NEXT_PUBLIC_USE_RECIPE_FIXTURES: z
  .union([z.boolean(), z.string()])
  .transform(booleanFromString)
  .default(false),
NEXT_PUBLIC_USE_MEALPLAN_MOCK: z
  .union([z.boolean(), z.string()])
  .transform(booleanFromString)
  .default(false),
```

Плюс рефакторинг чтения: завести `apps/web/src/lib/env.ts` хелперы
`useRecipeFixtures()` / `useMealplanMock()`, использующие
`loadWebEnv()`. Это симметрично тому, как `getApiBaseUrl()` уже мог бы
быть реализован через общий модуль.

---

### T55-C · 🟡 P3 — Скрипты миграций обходят валидацию

**Где:** `packages/database/scripts/retrofit-existing.ts`,
`packages/database/scripts/import-recipes.ts`,
`packages/database/scripts/backfill-nutrition.ts`,
`packages/database/scripts/backfill-nutrition-rest.ts`.

**Симптом.** Все четыре скрипта читают `process.env['DATABASE_URL']`
напрямую. Если переменная не выставлена — Prisma выбросит generic
ошибку подключения с менее информативным сообщением, чем
`EnvValidationError` от `@multichef/config`.

**Почему важно.** Миграционные скрипты — операции повышенной
опасности (трогают prod-БД, потенциально минуют RLS если идут от
superuser). Чёткое сообщение «`DATABASE_URL must use postgresql://`»
вместо `Error: P1001 Can't reach database server` критично при
разборе инцидентов.

**Гипотеза фикса.** В каждом скрипте первой строкой:

```ts
import { parseServerEnv } from '@multichef/config';
const env = parseServerEnv();
if (!env.ok) {
  console.error(env.error.message);
  process.exit(2);
}
const { DATABASE_URL } = env.value;
```

Альтернативно — `npx prisma db execute` через `dotenv -e .env` (уже
есть в репо по подобию Prisma CLI).

---

### T55-D · 🟡 P3 — Прямое чтение `process.env` в web-src, минуя хелпер

**Где:** `apps/web/src/app/robots.ts:8`, `apps/web/src/app/sitemap.ts:7`,
`apps/web/src/app/layout.tsx:11`,
`apps/web/src/components/PwaRegister.tsx:9`.

**Симптом.** Четыре файла дублируют `process.env['NEXT_PUBLIC_APP_BASE_URL']
?? 'http://localhost:3001'`, вместо того чтобы вызвать
`getApiBaseUrl()` из `apps/web/src/lib/env.ts`. Это нарушает DRY и
«расползание» дефолта: если завтра дефолт поменяется на
`https://api.multichef.ru`, придётся менять в 4 местах, причём один из
них — RSC (`layout.tsx`), другой — статическая генерация (`robots.ts`,
`sitemap.ts`).

**Почему важно.** Тривиальная регрессия: разные значения дефолта в
разных местах → `robots.txt` ссылается на один origin, `sitemap.xml`
— на другой, `metadataBase` мета-тегов — на третий. SEO-инструменты
видят рассинхрон.

**Гипотеза фикса.** В `apps/web/src/lib/env.ts` экспортировать
константу `APP_BASE_URL` (после `loadWebEnv()` при сборке), и импортировать
её из всех четырёх файлов.

---

## Подтверждённые здоровые паттерны

- `apps/api/src/main.ts` использует `loadServerEnv()` **до**
  `NestFactory.create()` — fail-fast контракт выполнен.
- `postgresUrlSchema`, `redisUrlSchema`, `urlSchema` — разные схемы для
  разных протоколов, не один общий `z.string().url()`.
- `trimEnvString` отрезает `\r\n\t\v\f\0` — корректная защита от
  trailing-newline из CI-секретов.
- `EnvValidationError` с типизированными `issues[]` — операторы
  получают список битых полей сразу, а не stack-trace от Zod.
- `booleanFromString` принимает "yes/no/1/0/true/false" — стандарт
  индустрии.

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                | Файл / место                            |
| ----- | --- | ---- | ----------------------------------------------------- | --------------------------------------- |
| T55-A | 🟠  | P2   | Worker не валидирует env на старте — fail-fast не     | `apps/worker/src/main.ts:14-17`         |
|       |     |      | выдержан для не-API процессов                         |                                         |
| T55-B | 🟠  | P2   | `NEXT_PUBLIC_USE_*` флаги не в `webEnvSchema` —       | `apps/web/src/lib/recipe-client.ts:89`, |
|       |     |      | опечатки молча проходят, нет документации             | `recommendations-client.ts:43`          |
| T55-C | 🟡  | P3   | Скрипты миграций обходят валидацию env                | `packages/database/scripts/*.ts`        |
| T55-D | 🟡  | P3   | 4 файла дублируют `process.env['NEXT_PUBLIC_*'] ?? …` | `apps/web/src/app/{robots,sitemap}.ts`, |
|       |     |      | вместо общего `getApiBaseUrl()`                       | `layout.tsx`, `PwaRegister.tsx`         |

---

## Куммулятивный итог (55 кругов)

- **Всего найдено проблем:** 220 (T21–T55).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  126 · 🟡 P3: 68.
- **Раунды с нулевыми находками:** 0 из 55.
- **Топ-5 самых частых зон:** rate-limiting / DTO-валидация (29),
  observability / healthchecks (24), money / числовая арифметика (19),
  BullMQ / worker (17), RLS / tenant context (15).
- **Новые зоны в этом круге:** env-validation.

---

## Рекомендации (55-й круг)

1. **T55-A — на этой неделе.** Подключить `loadServerEnv()` к worker'у,
   переписать `createConnection()` на `env.REDIS_URL`. Это даст
   симметричный fail-fast на всех 3 процессах (api, worker, scripts).
2. **T55-B — на этой неделе.** Расширить `webEnvSchema` всеми
   `NEXT_PUBLIC_USE_*` флагами, обновить `.env.example`, добавить
   unit-тест на опечатки.
3. **T55-C — на спринт.** Прогнать `parseServerEnv()` в каждом
   скрипте перед первым обращением к БД.
4. **T55-D — на спринт.** Завести `APP_BASE_URL` константу в
   `apps/web/src/lib/env.ts`, заменить 4 inline-чтения на импорт.

---

## Артефакты (55-й круг)

- `docs/audit/AUDIT-REPORT-55.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T55-A…T55-D.
