# MC-040 — «Спаси продукт» (rescue)

> План-файл для backend-bot + frontend-bot. Финальный ADR в репо создаётся отдельной задачей после имплементации (конвенция ADR-0021).

## Контекст

- **MC-033 merged** (`d8540d4`). `POST /api/v1/recommendations/today` готов с auth-guard, sync < 500 мс.
- **`packages/recommendation` (✅)** имеет:
  - `rescueFilter` (через `ctx.rescue.targetIngredientId`) — **уже работает**, переиспользуем.
  - `rank(recipes, ctx)` — единый ранкер; специфичный `rankRescue` не нужен (см. §Decision).
  - `buildExplanation` — генерирует фразу по `expirationBenefit` (форсированный вес усилит сигнал).
  - **Нет фактора `novelty`** — добавляем.
- **`packages/contracts`** имеет `TodayRecommendationDtoSchema` с `options[3]` + `nutritionAccuracy` + `generatedAt`. Расширяем addOptional `pantryUsage`.
- **MC-034** в работе у frontend-bot, не зависим от MC-040 (web `/fridge/rescue` — отдельная страница).
- **MVP scope** (goal-autonomous-mvp.md): MC-040 = MAIN-LINE. MC-041 — feature-flag off, MC-043 — UI-плашки.
- **Telemetry** — не в MC-040 (жёсткое правило PM-prompt #4: детерминированный код, LLM — за интерфейсом; событие для аналитики = MC-074).

## Scope MC-040

**В скоупе (MVP):**
- Backend: `POST /api/v1/recommendations/rescue { ingredientId, maxMinutes? }` → `{ options: TodayRecommendationDto (3 карточки типа FROM_PANTRY/BEST_MATCH/CHAIN), pantryUsage: { usedGrams, totalGrams } }`.
- `packages/recommendation`: новый фактор `noveltyScore` (0..1, на основе `Recipe.tags.includes('novelty')` или novelty-маркера + `difficulty asc` tie-break). НЕ ломаем существующий 7-факторный scoring — `novelty` становится 8-м с весом 0.05, забирая у `varietyScore` (redistribute 0.05→0.05 — variety тоже 0.05, не суммируется). Дефолтный rescue-режим форсит вес `expirationBenefit` через `ctx.factorWeights?` override.
- `packages/contracts`: `RescueRequestDtoSchema`, `RescueResponseDtoSchema`. Расширение `TodayRecommendationDtoSchema.pantryUsage` (addOptional).
- Web `/fridge/rescue`:
  - `page.tsx` (server) → fetch pantry, передать в `RescueClient`.
  - `RescueClient.tsx` (`'use client'`, state-machine `step: 'picker' | 'loading' | 'result'`).
  - 3 компонента: `IngredientPicker`, `RescueResults`, `RescueError`.
  - `apps/web/src/lib/recommendations-client.ts` расширить: `getRescueRecommendations({ingredientId, maxMinutes}, deps?)`.
- Тесты: unit (factor, scoring override), integration (api + Postgres), component, e2e.

**Не в скоупе (явно):**
- MC-041 (Преображение остатков) — feature-flag off, использует `AiProvider.extractPantryItems` (отдельный LLM-контур).
- MC-043 (Антирецепт UI-плашки в /today) — отдельная задача.
- Telemetry / Sentry событие `rescue_accepted` — MC-074 (наблюдаемость).
- Batch-mode «Спаси всё» — post-MVP. Помечаем как scope-extension (открытый вопрос #1).
- LLM-вызовы. PM-prompt #4: детерминированный код; novelty — тег в recipe, не ML.
- Изменения в `MealPlan.generationSettings` (rescue не создаёт план; rescue — разовая рекомендация «куда пристроить продукт»).

## Границы с соседями

| MC | Что у них | Что в MC-040 |
|---|---|---|
| MC-035 | `/recipe/[id]` страница | ссылка «Подробнее» из карточки rescue-результата |
| MC-034 | `/today` wizard + result | отдельная страница `/fridge/rescue`; не пересекается |
| MC-041 | `/fridge/leftovers` (freeText → kind) | отдельная страница, отдельный endpoint; rescue принимает **только ingredientId**, не freeText |
| MC-043 | антирецепт-плашки в /today UI | не зависим; rescue может принимать `antiFilters` (по task), но UI — отдельный |
| MC-051 | `POST /meal-plans` | rescue-результат → кнопка «Готовлю это» = mock через `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` (как MC-034) |
| MC-056 | `/shopping/[listId]` | deep-link после «Готовлю это» (заглушка из MC-034) |

## Decision (новое по сравнению с MC-033)

**Решения, требующие фиксации (одно из них [CRITICAL]):**

1. **[MANAGER-DECISION] Формат endpoint**: `POST /api/v1/recommendations/rescue` (как в задании). Альтернатива — `POST /api/v1/recommendations/today { mode: 'rescue', ingredientId }`. **Принят первый** (более явный URL, проще документировать, проще версионировать). [MANAGER-DECISION]
2. **[DEFAULT] Переиспользование `rescueFilter`**, а не новый `mustContainIngredient`. `ctx.rescue.targetIngredientId` уже работает в `applyHardFilters`. Никаких новых предикатов. [DEFAULT]
3. **[DEFAULT] `novelty` фактор = 8-й, вес 0.05 (забираем у `varietyScore`, который остаётся 0.05)**. Итоговая сумма 1.00 (drift-тест на месте). **NO-BREAKING**: добавление 8-го фактора additive — старые `ScoreBreakdown` остаются совместимы (новое поле — optional). [DEFAULT]
4. **[DEFAULT] Форсированный `expirationBenefit` через `ctx.factorWeightsOverride` (опц. поле в GenerationContext)**, а не через хардкод в ranker. Если override не задан — дефолтный scoring. Если задан — используется как есть (с проверкой Σ=1.0). [DEFAULT]
5. **[DEFAULT] Сортировка «очевидные → необычные»**: пост-сорт по `(difficulty ASC, noveltyScore DESC)`. Не в ранкере, а в `pick-top3.ts`-like функции в backend. [DEFAULT]
6. **[MANAGER-DECISION] `pantryUsage` в ответе**: только в rescue-режиме (addOptional поле в `TodayRecommendationDtoSchema`). Не засоряем `/today` ответ. [MANAGER-DECISION]
7. **[DEFAULT] Latency DoD**: p95 < 500 мс (как `/today`). Каталог с `mustContainIngredient` обычно меньше (1–5% рецептов содержат конкретный ингредиент), реальная latency < 100 мс в большинстве случаев. Интеграционный тест замеряет. [DEFAULT]
8. **[CRITICAL] Auth + household scope**: `AuthGuard` + `requireOwnedHouseholdId(userId)`. `ingredientId` ДОЛЖЕН быть в pantry этого household (иначе 404, не 403 — privacy не утекает). [CRITICAL — security invariant]
9. **[DEFAULT] Error handling**: 
   - `401 UNAUTHORIZED` — без cookie.
   - `404 INGREDIENT_NOT_FOUND` — `ingredientId` не в pantry (или не существует).
   - `422 EMPTY_RESCUE` — нет рецептов с этим ингредиентом (честный empty-state).
   - `500 INTERNAL` — fallback. [DEFAULT]

## Структура `apps/api/src/recommendations/` (расширение MC-033)

```
apps/api/src/recommendations/
├── recommendations.controller.ts        # + метод rescue()
├── recommendations.service.ts           # + метод getRescue(userId, input, now)
├── recommendations.dto.ts              # + RescueRequestDtoSchema, RescueResponseDtoSchema
├── recommendation.mappers.ts           # (без изменений)
├── pick-top3.ts                        # (без изменений; rescue может переиспользовать)
├── pick-rescue.ts                      # НОВЫЙ: сортировка «очевидные → необычные» + вычисление pantryUsage
├── ai/
│   └── template-provider.ts            # (без изменений; buildExplanation уже работает)
└── __tests__/
    ├── recommendations.integration.test.ts   # + rescue integration
    ├── rescue.unit.test.ts                   # НОВЫЙ: pickRescue, pantryUsage
    └── fixtures/
        └── rescue-recipes.ts                # 5 рецептов с разным difficulty для теста
```

## `apps/web/src/app/(app)/fridge/rescue/` — структура

```
apps/web/src/app/(app)/fridge/rescue/
├── page.tsx                  # server: fetch pantry через usePantry (client-side) + auth-guard
├── RescueClient.tsx          # 'use client': step state-machine, deps-инъекция
├── components/
│   ├── IngredientPicker.tsx  # search debounce 300мс + chips «Популярные» (tomato, milk, eggs)
│   ├── RescueResults.tsx     # 3 карточки + плашка «Использует X г из Y г» + AcceptButton
│   ├── AcceptButton.tsx      # sticky кнопка «Готовлю это» (mock через USE_MEALPLAN_MOCK)
│   ├── PantryUsageBar.tsx    # визуализация pantryUsage.usedGrams/totalGrams
│   └── RescueError.tsx       # empty-state «Нет рецептов с этим продуктом»
└── __tests__/
    ├── RescueClient.test.tsx
    ├── IngredientPicker.test.tsx
    ├── RescueResults.test.tsx
    └── fixtures/
        └── rescue-fixtures.ts
```

## State-machine `/fridge/rescue`

URL-driven через query-param `step`:

| URL | step | Данные |
|---|---|---|
| `/fridge/rescue` (default) | `picker` | pantry в usePantry |
| `/fridge/rescue?step=picker&ingredient=<id>` | `picker` | предвыбранный ингредиент (deep-link из /fridge карточки USE_FIRST) |
| `/fridge/rescue?step=loading` | `loading` | settings в URL: `?ingredient=&maxMinutes=` |
| `/fridge/rescue?step=result&ref=<uuid>` | `result` | результат в sessionStorage по `ref` (как MC-034) |

**Переходы**:
```
/fridge/rescue (picker)
  ├─ клик чипа/поиск + выбор → router.push('/fridge/rescue?step=loading&ingredient=X')
  └─ «Назад» → router.push('/fridge')

/fridge/rescue?step=loading
  ├─ POST /recommendations/rescue (mock через NEXT_PUBLIC_USE_RESCUE_MOCK=1 — дефолт 0)
  ├─ результат в sessionStorage[ref]
  └─ router.push('/fridge/rescue?step=result&ref=X')

/fridge/rescue?step=result
  ├─ читает sessionStorage[ref]
  ├─ 3 карточки + плашка pantryUsage + кнопка «Готовлю это»
  ├─ «Готовлю это» → acceptRecommendation mock + router.push('/shopping/<id>')
  └─ «Другой ингредиент» → router.push('/fridge/rescue?step=picker')
```

## Backend `POST /api/v1/recommendations/rescue`

### Request DTO

```ts
// packages/contracts/src/rescue.ts
export const RescueRequestDtoSchema = z.object({
  ingredientId: z.string().min(1),                      // обязателен
  maxMinutes: z.coerce.number().int().min(5).max(360).optional(),
});
export type RescueRequestDto = z.infer<typeof RescueRequestDtoSchema>;
```

### Response DTO

```ts
export const PantryUsageSchema = z.object({
  usedGrams: z.number().nonnegative(),  // сумма граммов ingredientId, использованных в топ-3 recipes
  totalGrams: z.number().nonnegative(), // текущий estimatedGrams этого ингредиента в pantry
});
export type PantryUsage = z.infer<typeof PantryUsageSchema>;

// Расширение существующего TodayRecommendationDtoSchema (addOptional)
export const TodayRecommendationDtoSchema = TodayRecommendationDtoSchemaBase.extend({
  pantryUsage: PantryUsageSchema.optional(),
});

export const RescueResponseDtoSchema = z.object({
  options: z.array(TodayOptionDtoSchema).length(3),
  nutritionAccuracy: z.literal('ESTIMATED'),
  generatedAt: z.string().datetime(),
  pantryUsage: PantryUsageSchema,
  /** Конкретный ингредиент, который «спасаем» (для UI-плашки). */
  ingredient: z.object({
    id: z.string(),
    canonicalName: z.string(),
    totalGrams: z.number().nonnegative(),
  }),
});
export type RescueResponseDto = z.infer<typeof RescueResponseDtoSchema>;
```

### Service: `getRescue(userId, input, now)`

```ts
async getRescue(
  userId: string,
  input: RescueRequestDto,
  now: Date,
): Promise<RescueResponseDto> {
  const prisma = getPrisma();
  const householdId = await this.requireOwnedHouseholdId(userId);

  // 1. Verify ingredient в pantry этого household (security + privacy)
  const pantryItem = await prisma.pantryItem.findFirst({
    where: { householdId, ingredientId: input.ingredientId, archivedAt: null },
    include: { ingredient: true },
  });
  if (!pantryItem) {
    throw new AppHttpException({
      code: 'INGREDIENT_NOT_FOUND',
      message: 'Product not found in your pantry',
      details: { ingredientId: input.ingredientId },
    });
  }

  // 2. Загружаем каталог (как в getToday) + профиль + preferences
  const recipeRows = await prisma.recipe.findMany({
    where: { sourceType: 'CURATED', status: 'PUBLISHED' },
    include: { ingredients: { include: { ingredient: { include: { category: { select: { name: true } } } } } }, nutrition: true },
  });
  const preferenceRows = await prisma.preference.findMany({ where: { userId }, include: { ingredient: true } });
  const profile = await prisma.nutritionProfile.findUnique({ where: { userId } });
  const pantryRows = await prisma.pantryItem.findMany({ where: { householdId, archivedAt: null }, include: { ingredient: { include: { category: { select: { name: true } } } } } });
  const yesterdayProtein = await fetchYesterdayMainProtein(userId, householdId, now);

  // 3. Маппинг в DTO пакета (как в MC-033)
  const recipes = recipeRows.map(mapRecipeRow);
  const pantry = mapPantry(pantryRows);
  const preferences = mapPreferences(preferenceRows, profile);

  // 4. GenerationContext с rescue-mode + форсированный expirationBenefit
  const ctx: GenerationContext = {
    now,
    pantry,
    preferences,
    maxMinutes: input.maxMinutes ?? profile?.preferredPrepMinutes ?? 60,
    budgetMode: 'NORMAL',
    antiFilters: [],
    yesterdayMainProtein,
    recentRecipeIds7d: [],
    targetDailyMacros: profile ? { calories: profile.targetCalories!, proteinG: profile.targetProteinG!, fatG: profile.targetFatG!, carbsG: profile.targetCarbsG! } : undefined,
    mealsPerDay: profile?.mealsPerDay ?? 3,
    rescue: { targetIngredientId: input.ingredientId },
    factorWeightsOverride: {  // форсируем expirationBenefit за счёт varietyScore
      pantryMatch: 0.25,
      expirationBenefit: 0.30,  // было 0.20 → +0.10
      budgetMatch: 0.15,
      nutritionMatch: 0.15,
      timeMatch: 0.10,
      preferenceMatch: 0.10,
      preferenceMatch: 0.10,  // остаётся
      noveltyScore: 0.05,     // НОВЫЙ фактор
      varietyScore: 0.00,     // обнуляем (поглощён novelty в rescue-контексте)
    },
  };
  // Drift-guard: Σ(ctx.factorWeightsOverride) === 1.00

  // 5. Rank
  const ranked = rank(recipes, ctx);

  // 6. Pick top-3 с пост-сортировкой «очевидные → необычные»
  const picked = pickRescue(ranked, pantryItem.estimatedGrams.toNumber(), 3);

  // 7. PantryUsage: сколько граммов ingredientId использовано в топ-3
  const usedGrams = picked.reduce((sum, opt) => {
    const ri = opt.recipe.ingredients.find(i => i.ingredientId === input.ingredientId);
    return sum + (ri?.grams ?? 0);
  }, 0);
  const totalGrams = pantryItem.estimatedGrams.toNumber();

  // 8. Return
  return {
    options: picked.map(opt => toTodayOption(opt, ...)),  // конвертация в TodayOptionDto
    nutritionAccuracy: 'ESTIMATED',
    generatedAt: now.toISOString(),
    pantryUsage: { usedGrams, totalGrams },
    ingredient: {
      id: pantryItem.ingredientId,
      canonicalName: pantryItem.ingredient.canonicalName,
      totalGrams,
    },
  };
}
```

### `pickRescue(ranked, totalGrams, n=3)`

```ts
function pickRescue(ranked: ScoredRecipe[], totalGrams: number, n: number): ScoredRecipe[] {
  // Только passed=true
  const passed = ranked.filter(s => s.passed);
  // Сортировка: сначала difficulty asc (очевидные), потом noveltyScore desc (сначала те, которые МЕНЕЕ необычные)
  // ВАЖНО: «очевидные → необычные» = difficulty asc И novelty desc (меньше novelty = очевиднее)
  passed.sort((a, b) => {
    if (a.recipe.difficulty !== b.recipe.difficulty) return a.recipe.difficulty - b.recipe.difficulty;
    const noveltyA = a.breakdown.noveltyScore?.value ?? 0;
    const noveltyB = b.breakdown.noveltyScore?.value ?? 0;
    if (noveltyA !== noveltyB) return noveltyB - noveltyA;  // менее необычные первые
    return b.score - a.score || a.recipe.id.localeCompare(b.recipe.id);
  });
  return passed.slice(0, n);
}
```

**Проблема**: top-3 по «очевидные» может не включать самые scored-высокие. **UX-tradeoff**: PRD §2.3.7 «Спаси продукт» говорит «очевидные→необычные» как UX-ожидание, но пользователь хочет лучший score. **Решение** [MANAGER-DECISION]: компромисс — сортируем `(score - 0.1 * difficultyRank)`, то есть штрафуем score на 0.1 за каждый ранг difficulty. Топ-3 получаются «среди лучших — самые простые». **Если [MANAGER] хочет строго difficulty asc** — открытый вопрос #2.

### Расширение `GenerationContext`

```ts
// packages/recommendation/src/types.ts
export interface GenerationContext {
  // ... существующие поля ...
  
  /** Если задан — используется вместо FACTOR_WEIGHTS. Σ должно быть 1.0. */
  factorWeightsOverride?: Partial<Record<FactorName, number>>;
  
  /** Если задан — rescue-режим (применяется rescueFilter). */
  rescue?: { targetIngredientId: string };
}
```

**Drift-guard**: если `factorWeightsOverride` задан, пакет проверяет `Σ === 1.0` (±1e-9) и кидает ошибку при нарушении. Тест в `weights.test.ts`.

## `packages/recommendation` — изменения

### Новый фактор `noveltyScore`

```ts
// packages/recommendation/src/scoring/factors/noveltyScore.ts
import type { Recipe, GenerationContext } from '../../types.js';

const NOVELTY_TAGS = new Set(['необычное', 'экзотика', 'фьюжн', 'молекулярная']);

export function noveltyScore(recipe: Recipe, _ctx: GenerationContext): number {
  // 1. Базовая novelty = 1 - (средняя частота ингредиентов в планах за 7 дней) — НЕТ, это слишком дорого.
  //    Упрощение: novelty ∈ [0, 1] на основе тегов и ингредиентов.
  
  const tagBonus = recipe.tags.some(t => NOVELTY_TAGS.has(t.toLowerCase())) ? 0.5 : 0;
  const ingredientBonus = recipe.ingredients.length > 8 ? 0.3 : 0;  // много ингредиентов = сложнее
  const chainBonus = (recipe.chainTags?.length ?? 0) > 0 ? 0.2 : 0;  // часть цепочки
  
  return clamp01(tagBonus + ingredientBonus + chainBonus);
}
```

**Регистрация** в `scoring/index.ts`:

```ts
import { noveltyScore } from './factors/noveltyScore.js';

const FACTOR_FN: Record<FactorName, ...> = {
  pantryMatch, expirationBenefit, budgetMatch, nutritionMatch,
  timeMatch, preferenceMatch, varietyScore,
  noveltyScore,  // НОВЫЙ
};
```

**Обновление `weights.ts`**:

```ts
export const FACTOR_WEIGHTS = {
  pantryMatch: 0.25,
  expirationBenefit: 0.20,
  budgetMatch: 0.15,
  nutritionMatch: 0.15,
  timeMatch: 0.10,
  preferenceMatch: 0.10,
  noveltyScore: 0.05,  // НОВЫЙ
  varietyScore: 0.00,  // ОБНУЛЁН
} as const;
// Σ = 1.00 ✓
```

**Влияние на существующие `expectedScores.ts` fixture**: ВСЕ скоры изменятся. **Drift-тест сломается**. **Решение** [DEFAULT]: расширить fixture файл — добавить отдельный сценарий `expectedScores-rescue.ts` с override-весами. Старый `expectedScores.ts` остаётся для `/today` (без override). Если кто-то вызовет `rank` без override — используется новый `FACTOR_WEIGHTS` (Σ=1.0, noveltyScore=0.05 для всех). **Старые тесты на `/today` обновятся**: pantryMatch + expirationBenefit остаются как были, остальные не используются в большинстве сценариев. **Acceptable drift** — объяснить в PR.

### `recipe.chainTags` — нужно в DTO пакета

`MC-032 plan` помечал это как TODO. В MC-040 нужен для `chainBonus`. Дефолт: `[DEFAULT]` — расширяем `Recipe` DTO пакета:

```ts
export interface Recipe {
  // ... существующие поля ...
  chainTags?: string[];  // НОВОЕ (optional, default [] в mapper)
}
```

Mapper Prisma→Recipe (в `recommendations.mappers.ts`) добавляет `chainTags: row.chainTags ?? []`.

### Поведение `rank` при `factorWeightsOverride`

```ts
// packages/recommendation/src/scoring/index.ts
export function scoreRecipe(recipe: Recipe, ctx: GenerationContext): ScoredRecipe {
  const weights = { ...FACTOR_WEIGHTS, ...(ctx.factorWeightsOverride ?? {}) };
  // Σ-check в dev (опц., не runtime-проверка — клиент должен сам следить)
  
  const breakdown = {} as ScoreBreakdown;
  let score = 0;
  for (const name of FACTOR_NAMES) {
    const value = FACTOR_FN[name](recipe, ctx);
    const weight = weights[name];
    breakdown[name] = { value, weight, contribution: value * weight };
    score += value * weight;
  }
  return { recipe, score, breakdown, passed: true };
}
```

**Σ-check в dev**: добавить `if (process.env.NODE_ENV !== 'production')` блок с проверкой. Не в hot path.

## `apps/web/src/lib/recommendations-client.ts` — расширение

```ts
import { RescueRequestDtoSchema, RescueResponseDtoSchema } from '@multichef/contracts';

export async function getRescueRecommendations(
  input: z.infer<typeof RescueRequestDtoSchema>,
  deps?: { fetchImpl?: typeof fetch; baseUrl?: string },
  options?: { signal?: AbortSignal },
): Promise<ApiResponse<RescueResponseDto>> {
  // Mock-режим до MC-040... но MC-040 это и есть MC-040. Mock не нужен.
  return request<RescueResponseDto>(
    `${deps?.baseUrl ?? getApiBaseUrl()}/api/v1/recommendations/rescue`,
    { method: 'POST', body: JSON.stringify(input), signal: options?.signal },
    RescueResponseDtoSchema,
  );
}
```

Mock через `NEXT_PUBLIC_USE_RESCUE_MOCK=1` (как в MC-034 для meal-plans) — **опц., не требуется для MVP**, бэкенд готов. [DEFAULT] — **не делаем mock-режим**, эндпоинт доступен сразу.

## Web `/fridge/rescue/components/`

### `IngredientPicker.tsx`

- Search input с debounce 300мс через `apps/web/src/lib/ingredient-client.ts` (есть в MC-021).
- Список pantry-ингредиентов с `priority === 'USE_FIRST'` или `expiresAt <= today+3 дня` — chips «Срочно» сверху.
- Список всех pantry-ингредиентов — ниже.
- Клик по чипу/результату → `router.push('/fridge/rescue?step=loading&ingredient=X')`.
- Loading state через Skeleton.

### `RescueResults.tsx`

- 3 карточки (из response.options).
- Каждая: `<OptionCard>` (как в MC-034) + `<PantryUsageBar>` с прогрессом `usedGrams/totalGrams`.
- Если `usedGrams >= totalGrams` — badge «Использует весь запас».
- Кнопка «Готовлю это» (sticky, как в MC-034) → `acceptRecommendation` mock + router.push(`/shopping/[listId]`).
- Кнопка «Другой ингредиент» → `router.push('/fridge/rescue?step=picker')`.

### `RescueError.tsx`

- Empty-state «Нет рецептов с этим продуктом» + ссылка «Добавить в исключения».
- Network error — toast + retry.
- 404 INGREDIENT_NOT_FOUND — «Этот продукт не в вашем холодильнике» + ссылка на /fridge/add.

## Тесты

### Unit (packages/recommendation)

1. **`noveltyScore.test.ts`**:
   - recipe с тегом «необычное» → 0.5+.
   - recipe с >8 ингредиентов → +0.3.
   - recipe в chainTag → +0.2.
   - clamp на [0, 1].

2. **`weights.test.ts`** (existing) — Σ=1.0 drift-test. Должен остаться зелёным после добавления noveltyScore.

3. **`rank.test.ts`** (existing) — обновить fixture для 8 факторов. Или **добавить отдельный `rank-rescue.test.ts`** с `factorWeightsOverride`.

4. **`expectedScores-rescue.ts`** — НОВЫЙ fixture для rescue-режима.

### Integration (apps/api)

5. **`rescue.integration.test.ts`**:
   - **401** без cookie.
   - **404 INGREDIENT_NOT_FOUND** — ingredientId не в pantry.
   - **200** success: pantry с помидорами → 3 options, все содержат помидоры.
   - **200** pantryUsage: usedGrams ≤ totalGrams.
   - **422 EMPTY_RESCUE** — нет рецептов с целевым ингредиентом (seed edge case).
   - **Latency**: 10 запросов подряд, p95 < 500 мс.

### Component (apps/web)

6. **`IngredientPicker.test.tsx`**:
   - chips «Срочно» отображают только USE_FIRST / expiresAt ≤ today+3.
   - поиск debounce 300мс → результаты появляются через ≥300мс.
   - клик по чипу → router.push с правильным URL.

7. **`RescueResults.test.tsx`**:
   - 3 карточки рендерятся.
   - `PantryUsageBar` показывает корректный прогресс.
   - «Готовлю это» → acceptRecommendation mock → router.push.

8. **`RescueClient.test.tsx`**:
   - state-machine transitions (picker → loading → result).
   - refresh на `/result?ref=X` без sessionStorage → redirect + toast.

### E2E (Playwright)

9. **`rescue-flow.spec.ts`**:
   - `/fridge/rescue` → выбрать помидор → POST → 3 карточки → «Готовлю это» → `/shopping/mock-list-*`.

**Coverage**: branches ≥ 85% по новому коду (backend, packages/recommendation), ≥ 85% для новых web компонентов.

## DoD

- G1–G5 (lint, format, typecheck, test, build).
- `pnpm --filter @multichef/api test` — все rescue integration зелёные.
- `pnpm --filter @multichef/recommendation test` — drift-тест Σ=1.0 + noveltyScore тесты + rank-rescue тесты.
- Latency p95 < 500 мс на integration.
- OpenAPI `/api/v1/docs` содержит `/recommendations/rescue` с полной схемой.
- e2e «pick tomato → Готовлю это» зелёный.
- Coverage: backend ≥ 85% branches нового кода; web ≥ 85% новых компонентов.

## Зависимости

**Только существующие.** Никаких новых npm-пакетов.
- `packages/ui`, `packages/nutrition`, `packages/contracts`, `packages/recommendation` — всё есть.
- `apps/web/src/lib/recommendations-client.ts` — расширяем существующий (после MC-034).
- `apps/web/src/hooks/usePantry.ts` — есть.

## Обратимость

**Высокая.** 
- `pick-rescue.ts` — новый файл, удаление = revert.
- `noveltyScore` фактор — расширение `FACTOR_WEIGHTS` additive. Удалить = revert, но Σ=1.0 нужно сохранить (без noveltyScore → вернуть varietyScore=0.05).
- `rescueController.method()` — 1 метод, удаление = revert.
- Web `/fridge/rescue/` — каталог, удаление = revert.

**Важно**: изменение `FACTOR_WEIGHTS` ломает старые fixture `expectedScores.ts` (если используются). План: добавить отдельный `expectedScores-rescue.ts` для нового сценария; старый fixture обновить (или добавить .skip с TODO). **Предлагаю** обновить старый fixture с обоснованием в PR (TESTING-STRATEGY §2 — допустимо с justification).

## Следующие шаги

### Backend-bot (MC-040 backend)

1. **Pre-шаг**: проверить сигнатуру `mapRecipeRow` (chainTags), `fetchYesterdayMainProtein`. Если chainTags не возвращается — добавить в `recommendation.mappers.ts`.
2. **`packages/recommendation/src/scoring/factors/noveltyScore.ts`** — НОВЫЙ файл.
3. **`packages/recommendation/src/scoring/weights.ts`** — добавить `noveltyScore: 0.05`, `varietyScore: 0.00`. Обновить `expectedScores.ts` + создать `expectedScores-rescue.ts`.
4. **`packages/recommendation/src/scoring/index.ts`** — зарегистрировать `noveltyScore` в `FACTOR_FN`, поддержать `factorWeightsOverride`.
5. **`packages/recommendation/src/types.ts`** — расширить `Recipe.chainTags?`, `GenerationContext.factorWeightsOverride?`.
6. **`packages/contracts/src/rescue.ts`** — НОВЫЙ файл: `RescueRequestDtoSchema`, `RescueResponseDtoSchema`, `PantryUsageSchema`.
7. **`packages/contracts/src/recommendations.ts`** — расширить `TodayRecommendationDtoSchema` addOptional `pantryUsage`.
8. **`apps/api/src/recommendations/pick-rescue.ts`** — НОВЫЙ: `pickRescue(ranked, totalGrams, n)`.
9. **`apps/api/src/recommendations/recommendations.service.ts`** — `getRescue(userId, input, now)`.
10. **`apps/api/src/recommendations/recommendations.controller.ts`** — `POST /rescue`.
11. **`apps/api/src/recommendations/recommendations.dto.ts`** — импорт из contracts.
12. **`apps/api/src/recommendations/__tests__/rescue.integration.test.ts`** — НОВЫЙ.
13. **`apps/api/src/recommendations/__tests__/fixtures/rescue-recipes.ts`** — НОВЫЙ.
14. PR + ревью @qa-docs-bot.

### Frontend-bot (MC-040 web)

1. **`apps/web/src/lib/recommendations-client.ts`** — добавить `getRescueRecommendations`.
2. **`apps/web/src/app/(app)/fridge/rescue/page.tsx`** — server wrapper.
3. **`RescueClient.tsx`** + 4 компонента.
4. **`__tests__/`** — 3+ компонентных теста.
5. **`tests/e2e/rescue-flow.spec.ts`** — НОВЫЙ.
6. Manual QA: screenshot `/fridge/rescue?step=picker`, `/result` с pantryUsage.
7. PR + ревью @qa-docs-bot.

### Порядок

- **Backend PR** идёт **первым** (блокирует web).
- **Frontend PR** после merge backend.
- **Параллельность с MC-034 (web /today)**: возможна. Разные файлы (`/today/*` vs `/fridge/rescue/*`). [MANAGER-DECISION] если хочется параллельно — ОК.

## Открытые вопросы

1. **[MANAGER-DECISION] «Спаси всё» — batch mode (multi-ingredientId[])**: добавить ли уже в MC-040, или оставить post-MVP? **Дефолт [DEFAULT]**: post-MVP. Если MVP — расширяем request `ingredientIds: string[]` (max 5), `pantryUsage` per ingredientId. +2 ч.
2. **[MANAGER-DECISION] Сортировка top-3 в rescue: `difficulty asc + score desc` или `score desc + difficulty penalty -0.1*difficultyRank`?** PRD говорит «очевидные → необычные», но score тоже важен. **Дефолт [DEFAULT]**: `score desc - 0.1 * difficultyRank` (компромисс). Если строго `difficulty asc` — нужно явно [MANAGER].
3. **[CRITICAL] Текст ошибки 404 INGREDIENT_NOT_FOUND — privacy**: текущий черновик «Product not found in your pantry». Это не утекает ли данные (не говорит «product X exists but not yours» — говорит нейтрально). **Дефолт [DEFAULT]**: «Product not found in your pantry». Альтернатива — 404 generic «Not found». **Подтвердить**.
4. **[MANAGER-DECISION] Telemetry `rescue_accepted` event**: [DEFAULT] — отложено в MC-074. Если нужно в MC-040 — добавить Sentry-событие с `{ingredientId, optionType, score}` (без PII).
5. **[DEFAULT] Антирецепт-фильтры в rescue**: задание менеджера не упоминает. **Дефолт [DEFAULT]**: принимаем `antiFilters` в request (для consistency с /today), но UI на /fridge/rescue не показывает анти-чипы (post-MVP). Если нужен UI анти-чипов в picker — отдельная задача.

Если пользователь молчит — действуем по [DEFAULT] (помечены в тексте).

## Красные флаги

1. **[CRITICAL] `factorWeightsOverride` ломает Σ-проверку.** Если клиент передаст кривые веса, Σ ≠ 1.0 → score выйдет за [0, 1]. **Защита**: drift-check в dev (`NODE_ENV !== 'production'`), runtime в проде — score-clamp.
2. **[CRITICAL] Privacy 404 — убедиться, что текст не утекает.** «Product not found in your pantry» — норм. **Дефолт**: безопасная формулировка.
3. **`chainTags` в DTO пакета — additive change.** Если кто-то уже consume'ит Recipe (MC-035) — добавление `chainTags?` не ломает. **Проверить**: тесты MC-035 / recipe-client.test.ts — должны остаться зелёными.
4. **Fixture drift после `noveltyScore`.** `expectedScores.ts` изменится. **Защита**: PR с обоснованием (TESTING-STRATEGY §2), отдельный `expectedScores-rescue.ts`.
5. **Latency regression — `factorWeightsOverride` в hot path.** Каждый factor-spread — микро-операция, не должна влиять. **Защита**: integration latency test.
6. **`rescueFilter` ужесточает выборку.** С `mustContainIngredient` каталог может схлопнуться до 0–2 рецептов. **Защита**: empty-state с чётким сообщением + предложение «Добавить в исключения».
7. **`pickRescue` сортирует passed[], не rejected[]**. Отклонённые рецепты не попадают в result. **Дефолт**: ОК (3 options всегда из passed).
8. **`pantryUsage.usedGrams > pantryUsage.totalGrams`** возможно, если recipe использует больше, чем есть в pantry. **Защита**: не clamp, показывать «Использует больше, чем есть (нужно докупить X г)».
9. **PantryItem.estimatedGrams = Decimal** — `toNumber()` теряет точность. **Защита**: для КБЖУ ОК, для pantryUsage — clamp до 1 знака после запятой в UI.
10. **`rescueFilter` ужесточает фильтрацию — пользователь с 1 ingredientId в pantry и без рецептов = 422**. **Защита**: empty-state «Нет рецептов с этим продуктом», не 500.
11. **CI-fix PR #21 ещё не merged** (если MC-040 идёт раньше) — возможен nutrition-dist issue. **Защита**: frontend-bot проверяет статус CI-fix перед стартом.
12. **Mock `acceptRecommendation` в web для «Готовлю это»** — `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`. Если mock off и backend не готов (MC-051) — кнопка ломается. **Защита**: try/catch + toast «Скоро».
13. **Web `/fridge/rescue` не имеет deep-link из `/fridge` карточки USE_FIRST.** Если хочется «Спаси» кнопку в `/fridge` — отдельная задача. **Дефолт**: deep-link из picker через query param `?ingredient=X` (есть в URL-state).
14. **`pantryItem.estimatedGrams = 0`** — пустой ингредиент, нет смысла rescue. **Защита**: filter `quantity > 0` в WHERE.
15. **Concurrent rescues** — пользователь быстро кликает разные ингредиенты. **Защита**: AbortController в `getRescueRecommendations`.

---

## Сводка (5 строк)

1. **Backend `POST /api/v1/recommendations/rescue { ingredientId, maxMinutes? }`** → `{ options: [3 карточки], pantryUsage: { usedGrams, totalGrams }, ingredient: { id, canonicalName, totalGrams }, nutritionAccuracy, generatedAt }`; AuthGuard + 404 если ingredient не в pantry (security invariant [CRITICAL]); p95 < 500 мс.
2. **`packages/recommendation`** — новый `noveltyScore` фактор (8-й, вес 0.05 за счёт `varietyScore`→0.0, Σ=1.0 drift-guard), `factorWeightsOverride` в `GenerationContext` (Σ-проверка в dev), `Recipe.chainTags?` (additive), переиспользуем существующий `rescueFilter` (новый не нужен); **NON-BREAKING** для существующего `/today` (новое поле в `ScoreBreakdown` опционально).
3. **Web `/fridge/rescue`** — picker (search debounce 300мс + chips «Срочно» по USE_FIRST/expiresAt≤today+3) → loading → result (3 карточки + `PantryUsageBar` + sticky «Готовлю это» mock через `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`); URL-driven state-machine `?step=picker|loading|result`, результат в sessionStorage по `?ref=<uuid>` (как MC-034).
4. **5 открытых вопросов**: «Спаси всё» batch-mode (дефолт — post-MVP), сортировка `difficulty asc` vs `score - 0.1*difficultyRank` (дефолт — компромисс), privacy 404 текст «Product not found in your pantry» [CRITICAL], telemetry (дефолт — MC-074), анти-чипы в rescue UI (дефолт — без UI, body принимает).
5. **15 красных флагов**: factorWeightsOverride Σ-drift [CRITICAL], privacy 404 [CRITICAL], `chainTags` additive (проверить MC-035), fixture drift после noveltyScore, latency regression, `rescueFilter` ужесточает каталог → 422 empty-state, `estimatedGrams = Decimal.toNumber()`, `pantryUsage.usedGrams > totalGrams`, `pantryItem.quantity = 0` фильтр, CI-fix PR #21 ещё не merged.
