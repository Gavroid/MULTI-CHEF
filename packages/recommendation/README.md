# @multichef/recommendation

Детерминированный движок рекомендаций MULTI-CHEF: скоринг 7 факторов, hard-фильтры, 8 антирецептов и текстовые объяснения «почему это блюдо».

**Чистые функции. Без I/O:** никаких `fetch`, `@prisma/client`, `Date.now()`, `process.env` (защищено ESLint-правилами пакета). Время инжектируется через `GenerationContext.now`.

## Установка / использование

Пакет часть pnpm-workspace, зависит только от dev-инструментов. Импорт:

```ts
import {
  rank, // (recipes, ctx) => ScoredRecipe[] — фильтрация + скоринг + сортировка
  scoreRecipe, // (recipe, ctx) => ScoredRecipe — скоринг одного рецепта
  applyHardFilters, // (recipes, ctx) => { passed, rejected }
  buildExplanation, // (scored, maxReasons?) => string — плашка «почему это блюдо»
  ANTI_RECIPE_PREDICATES,
  FACTOR_WEIGHTS,
  type Recipe,
  type PantryItem,
  type UserPreferences,
  type GenerationContext,
} from '@multichef/recommendation';
```

## Минимальный пример

```ts
const ctx: GenerationContext = {
  now: new Date(), // инжектируется вызывающим
  pantry: [{ ingredientId: 'ing_pasta', estimatedGrams: 500, priority: 'NORMAL' }],
  preferences: {
    dietType: 'NONE',
    excludeIngredients: [],
    allergies: ['ing_nuts'],
    appliances: ['STOVE'],
    preferences: [{ kind: 'LOVE', ingredientId: 'ing_mushroom' }],
  },
  maxMinutes: 45,
  antiFilters: ['NO_OVEN', 'NO_FRYING'],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
};

const ranked = rank(catalog, ctx); // отсортировано по score desc
const top = ranked.filter((s) => s.passed).slice(0, 3);
const labels = top.map((s) => buildExplanation(s)); // «есть почти все продукты дома · быстро готовить»
```

## Формула (PRD §3.5)

`score = Σ weightᵢ × valueᵢ`, каждый фактор ∈ [0,1], `Σ weights = 1.0` (drift-тест):

| Фактор            | Вес  |
| ----------------- | ---- |
| pantryMatch       | 0.25 |
| expirationBenefit | 0.20 |
| budgetMatch       | 0.15 |
| nutritionMatch    | 0.15 |
| timeMatch         | 0.10 |
| preferenceMatch   | 0.10 |
| varietyScore      | 0.05 |

Смена весов/формул = правка `src/scoring/weights.ts` + обновление `src/__tests__/fixtures/expectedScores.ts` в одном PR (fixture-тест упадёт иначе).

## Антирецепты (8)

`NO_OVEN`, `ONE_PAN`, `NOT_CHICKEN_AGAIN`, `NO_LEFTOVERS`, `NO_FRYING`, `NO_CHOPPING`, `SHORT_TIME`, `NO_MULTISTEP` — см. `src/filters/antiRecipes.ts`. Токены хранятся в БД (`generationSettings`) — переименование ломает API, только через ADR.

## Тесты

```bash
pnpm --filter @multichef/recommendation test
```

83 теста: drift-тест весов, граничные значения всех факторов, параметризованные фильтры, 8 антирецептов, fixture-тесты топ-3 по трём сценариям (tolerance 1e-4), детерминизм. Coverage: ~99% lines / 98% branches.

## Границы пакета

- Маппинг Prisma → DTO — на вызывающей стороне (MC-033, `mappers.ts`).
- Деньги — только целые копейки (`estimatedExtraCostKopecks: number`).
- Никаких зависимостей от `apps/*`, `@multichef/database`, `@multichef/nutrition`.
