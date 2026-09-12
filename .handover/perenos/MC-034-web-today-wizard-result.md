# MC-034 — Web: /today + wizard + result

> План-файл для frontend-bot. Финальный ADR в репо создаётся отдельной задачей после имплементации (конвенция ADR-0021).

## Контекст

- **Backend `POST /api/v1/recommendations/today`** готов (MC-033, merged `d8540d4`). Контракт: `{ options: [FROM_PANTRY, BEST_MATCH, CHAIN], nutritionAccuracy: "ESTIMATED", generatedAt }`. Auth через `mc_session`. p95 < 500 мс.
- **Контракт** живёт в `packages/contracts/src/recommendations.ts`: `TodayRequestDtoSchema` (с `generationSettings: { budgetMode, maxMinutes, antiFilters, rescueIngredientId }`), `TodayOptionDtoSchema` (discriminated union), `TodayRecommendationDtoSchema`. **Никаких изменений в contracts.**
- **`/today` сейчас — MC-013 stub** с одной карточкой «Добро пожаловать» и disabled-кнопкой. Переписываем целиком.
- **`/plan` и `/shopping` — MC-013 stubs** (не трогаем в MC-034, кроме заглушки `/shopping/[listId]` для deep-link).
- **MC-035 (✅ merged)** дал конвенции:
  - `apps/web/src/app/(app)/<page>/page.tsx` — server, тонкая обёртка.
  - `<Page>Client.tsx` — `'use client'`, deps-инъекция через `useMemo` + `Partial<Deps>`.
  - `apps/web/src/lib/<page>-client.ts` — typed fetch wrapper через `request<T>()` из `auth-client`.
  - `apps/web/src/hooks/` — `usePantry` уже есть (создан в MC-035). `usePreferences` **нет** — создаём в MC-034.
  - Mock через `NEXT_PUBLIC_USE_*_FIXTURES=1` env var.
- **`packages/nutrition`** — `scaleNutrition` НЕ нужен в MC-034 (пересчёт на бэке при изменении `servings`; фронт отображает готовое).
- **`usePantry`** — кеш 30 сек, `{ items, loading, error, refetch }`. При loading/error — items пустой, чекбоксы не показывают ✓.

## Scope MC-034

**В скоупе:**
- `apps/web/src/app/(app)/today/page.tsx` — server, auth-guard, fetch pantry + preferences.
- `TodayClient.tsx` — клиентский state-machine `viewState: 'idle' | 'wizard' | 'loading' | 'result'`.
- 7 компонентов: `Greeting`, `UrgentBlock`, `BudgetProgress`, `QuickScenarios`, `HeroButton`, `UpcomingMeals`, `RouletteLink`.
- 3 sub-страницы: `/today/generate`, `/today/loading`, `/today/result`.
- `apps/web/src/lib/recommendations-client.ts` — `getRecommendationsToday`, `acceptRecommendation` (mock-режим через `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`).
- `apps/web/src/hooks/usePreferences.ts` — новый hook (читает `/api/v1/profile`, кеш 60 сек).
- Заглушка `apps/web/src/app/(app)/shopping/[listId]/page.tsx` для deep-link после «Готовлю это».
- 5+ компонентных тестов + 1 e2e.
- URL-driven state-machine через `?ids=` (или sessionStorage).

**Не в скоупе (явно):**
- Страница рецепта `/recipe/[id]` — MC-035. Здесь только ссылка на неё из карточки.
- Игровые режимы — MC-040/041/042 (rescue, leftovers, roulette). `RouletteLink` — только ссылка-заглушка на `/today/roulette` (404 пока, MC-042 создаст).
- Антирецепт-плашки на /today — MC-043. Антирецепты уже входят в `POST /recommendations/today` через `antiFilters` (8 чекбоксов в wizard). UI-плашка «почему нет OVEN-блюд» в результате — **отдельная задача** MC-043.
- Недельный план setup — MC-055. `RouletteLink` → `/today/roulette` (MC-042).
- `packages/nutrition` использование — нет (масштабирование на бэке).
- Реальный `POST /api/v1/meal-plans` — **MC-051**. В MC-034 — mock через `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`.
- Не нужно править `packages/contracts` (схемы уже есть из MC-033).

## Границы с соседями

| Задача | Что у них | Что в MC-034 |
|---|---|---|
| MC-035 | страница рецепта с дисклеймером и stepper | ссылка на `/recipe/[id]` из каждой карточки результата |
| MC-040/041/042 | rescue/leftovers/roulette — свои endpoints | `RouletteLink` (заглушка на `/today/roulette` до MC-042) |
| MC-043 | антирецепт-плашки в UI | антирецепты уже в wizard + body POST |
| MC-051 | `POST /meal-plans` + planner | `acceptRecommendation` — mock через env var |
| MC-053 | `replace-meal` API | не зависим |
| MC-055 | `/plan/setup` wizard | ссылка с `/today` на `/plan/setup` через deep-link (есть с MC-035) |
| MC-056 | `/shopping` UI | заглушка `/shopping/[listId]` для deep-link |

## Структура файлов

```
apps/web/src/app/(app)/today/
├── page.tsx              # server: auth-guard, fetch pantry+preferences+activePlan
├── TodayClient.tsx       # 'use client': viewState, transitions, quick-scenarios
├── components/
│   ├── Greeting.tsx      # morning/afternoon/evening по hour
│   ├── UrgentBlock.tsx   # топ-3 pantry с expiresAt ≤ today+3 дня
│   ├── BudgetProgress.tsx # прогресс-бар pantryBudget (если есть)
│   ├── QuickScenarios.tsx # 4 чипа: NOTHING/30_MIN/NO_OVEN/URGENT
│   ├── HeroButton.tsx    # главная CTA «Получить рекомендацию»
│   ├── UpcomingMeals.tsx # ближайшие entries из active MealPlan
│   └── RouletteLink.tsx  # ссылка на /today/roulette (MC-042)
├── generate/
│   ├── page.tsx          # server, thin wrapper → WizardClient
│   ├── WizardClient.tsx  # 'use client': 3 шага + state
│   ├── components/
│   │   ├── BudgetStep.tsx   # шаг 1: 3 radio
│   │   ├── TimeStep.tsx     # шаг 2: slider 15..120
│   │   └── AntiRecipesStep.tsx # шаг 3: 8 чекбоксов
│   └── __tests__/
│       └── WizardClient.test.tsx
├── loading/
│   ├── page.tsx          # server, thin wrapper → LoadingClient
│   └── LoadingClient.tsx # 'use client': стадии (имитация прогресса)
├── result/
│   ├── page.tsx          # server, читает ?ids=, валидирует через Zod, рендерит
│   ├── ResultClient.tsx  # 'use client': 3 карточки + кнопки «Готовлю это»
│   ├── components/
│   │   ├── OptionCard.tsx   # карточка одного option (type-aware)
│   │   ├── ChainTimeline.tsx # мини-таймлайн chain[] (если type=CHAIN)
│   │   └── ExplanationChip.tsx # плашка «почему это блюдо»
│   └── __tests__/
│       └── ResultClient.test.tsx
└── __tests__/
    ├── TodayClient.test.tsx
    ├── Greeting.test.tsx
    ├── UrgentBlock.test.tsx
    └── QuickScenarios.test.tsx

apps/web/src/lib/
└── recommendations-client.ts   # getRecommendationsToday + acceptRecommendation

apps/web/src/hooks/
└── usePreferences.ts           # новый hook

apps/web/src/app/(app)/shopping/
└── [listId]/
    └── page.tsx                # заглушка: «Список покупок #X» (TODO: MC-056)
```

## URL-driven state-machine

**4 viewState, каждый — своя sub-route** (Next.js App Router, естественная навигация):

| URL | viewState | Данные |
|---|---|---|
| `/today` | `idle` | pantry + preferences + activePlan (server-fetched) |
| `/today/generate?prefill=...` | `wizard` | wizard-state в URL: `?budget=&time=&anti=` (для quick-scenarios) |
| `/today/loading` | `loading` | settings в URL: `?budget=&time=&anti=` (для retry) |
| `/today/result?data=...` | `result` | результат в URL через `?data=base64(JSON.stringify(TodayRecommendationDto))` ИЛИ sessionStorage |

**Проблема с `?data=...`**: `TodayRecommendationDto` — это 3 полных рецепта (imageKey, tags, mealTypes, chainRecipes[]). URL может раздуться > 2 KB. **Решение**: **sessionStorage** для результата (TTL 30 мин), URL содержит только `?ref=<short-uuid>`. При загрузке `/today/result?ref=X` — `ResultClient` ищет в sessionStorage по `ref`. Если нет — toast «Сессия истекла, попробуйте снова» + redirect на `/today`.

**Преимущества sessionStorage над URL**:
- Не плодим длинные URL в истории браузера.
- Не ломаем шаринг (глубокая ссылка на «свой» результат — бессмысленна).
- Refresh страницы работает (sessionStorage переживает F5).
- Back/forward работает через Next.js router cache.

**Worflow переходов** (Next.js `router.push`):

```
/today
  ├─ HeroButton click  → /today/generate
  ├─ QuickScenario click → /today/generate?prefill={budgetMode,maxMinutes,antiFilters[]}
  └─ RouletteLink click → /today/roulette (404 до MC-042)

/today/generate
  ├─ "Далее" (шаг 1→2, 2→3)
  ├─ "Назад" (шаг 2→1, 3→2)
  ├─ "Пропустить" (на шаге 3 — wizard не обязателен)
  └─ "Получить рекомендацию" (шаг 3)
        → router.push('/today/loading?budget=&time=&anti=')
        → LoadingClient: POST /recommendations/today (deps mock)
        → сохранить результат в sessionStorage по `ref=uuid`
        → router.push('/today/result?ref=<uuid>')

/today/loading
  └─ стадии: «Загружаем продукты» (0-200ms) → «Исключаем аллергены» (200-350ms) → «Считаем рекомендации» (350-500ms). На 500ms — push to /today/result.
  └─ если POST упал → toast + retry кнопка.

/today/result?ref=X
  ├─ ResultClient читает sessionStorage[ref]
  ├─ Если нет — redirect /today с toast
  └─ На карточке клик «Готовлю это»:
       → POST /meal-plans (mock через NEXT_PUBLIC_USE_MEALPLAN_MOCK=1)
       → toast «План создан!»
       → router.push('/shopping/<shoppingListId>')
```

**URL-state wizard** (для шаринга и retry):

```ts
// /today/generate?prefill=NOTHING,30,NO_OVEN,ONE_PAN
type WizardPrefill = {
  budgetMode?: 'NOTHING' | 'MINIMAL' | 'NORMAL';
  maxMinutes?: number;
  antiFilters?: AntiFilter[];
};
```

URL-encoded: `?prefill=NOTHING.30.NO_OVEN.ONE_PAN`. Дефолт — пустой (wizard с дефолтами).

## API-клиент `apps/web/src/lib/recommendations-client.ts`

```ts
import {
  type TodayRequestDto,
  type TodayRecommendationDto,
  type RecipeDto,
  TodayRecommendationDtoSchema,
} from '@multichef/contracts';
import { request, type ApiResponse } from './auth-client';
import { getApiBaseUrl } from './env';

export interface GetRecommendationsDeps {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export async function getRecommendationsToday(
  settings: TodayRequestDto['generationSettings'],
  deps?: GetRecommendationsDeps,
  options?: { signal?: AbortSignal },
): Promise<ApiResponse<TodayRecommendationDto>> {
  // Mock-режим до MC-033... но MC-033 готов. Mock не нужен для /recommendations/today.
  // Mock через env var НЕ делаем — бэкенд готов.
  return request<TodayRecommendationDto>(
    `${deps?.baseUrl ?? getApiBaseUrl()}/api/v1/recommendations/today`,
    { method: 'POST', body: JSON.stringify({ generationSettings: settings }), signal: options?.signal },
    TodayRecommendationDtoSchema,
  );
}

export interface AcceptRecommendationInput {
  recipeId: string;
  servings: number;
}

export interface AcceptRecommendationResult {
  mealPlanId: string;
  shoppingListId: string;
}

export interface AcceptRecommendationDeps {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export async function acceptRecommendation(
  input: AcceptRecommendationInput,
  deps?: AcceptRecommendationDeps,
): Promise<ApiResponse<AcceptRecommendationResult>> {
  const base = deps?.baseUrl ?? getApiBaseUrl();
  // Mock-режим до MC-051
  if (process.env.NEXT_PUBLIC_USE_MEALPLAN_MOCK === '1') {
    return {
      data: {
        mealPlanId: `mock-plan-${crypto.randomUUID()}`,
        shoppingListId: `mock-list-${crypto.randomUUID()}`,
      },
      error: null,
    };
  }
  return request<AcceptRecommendationResult>(
    `${base}/api/v1/meal-plans`,
    { method: 'POST', body: JSON.stringify(input) },
    // Zod-схема ответа — нет в contracts (MC-051 ещё не делал). Local schema.
    AcceptRecommendationResultSchema,
  );
}

const AcceptRecommendationResultSchema = z.object({
  mealPlanId: z.string().min(1),
  shoppingListId: z.string().min(1),
});
```

**Mock-режим** активируется `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`. Default — 0 (боевой `POST /meal-plans` после MC-051). UI не должен ломаться, если `meal-plans` endpoint вернёт 404 (ещё не готов) — кнопка «Готовлю это» показывает toast «Пока не работает — скоро».

## State-машина `TodayClient.tsx`

```ts
type TodayViewState = 'idle' | 'wizard' | 'loading' | 'result';

interface TodayClientProps {
  initialPantry: PantryItem[];
  initialPreferences: UserPreferences;
  initialActivePlan: ActivePlanSummary | null;
  deps?: Partial<TodayClientDeps>;
}

interface TodayClientDeps {
  listPantry: typeof listItems;
  fetchRecommendations: typeof getRecommendationsToday;
  acceptRecommendation: typeof acceptRecommendation;
}
```

`TodayClient` рендерит:
- Если URL = `/today` → `viewState='idle'` → `Greeting`, `UrgentBlock` (если pantry не пуст), `BudgetProgress` (если есть budget), `QuickScenarios`, `HeroButton`, `UpcomingMeals` (если activePlan), `RouletteLink`.
- Если URL = `/today/generate` → `<WizardClient />`.
- Если URL = `/today/loading` → `<LoadingClient />`.
- Если URL = `/today/result?ref=X` → `<ResultClient />`.

**Переходы** — через `router.push()` (Next.js). Никакого глобального state-store.

## Wizard 3 шага (`WizardClient.tsx`)

```ts
interface WizardState {
  step: 'budget' | 'time' | 'anti';
  budgetMode: 'NOTHING' | 'MINIMAL' | 'NORMAL';
  maxMinutes: number;        // 15..120, default 60
  antiFilters: AntiFilter[]; // max 8
}

const initialState = (prefill?: WizardPrefill): WizardState => ({
  step: 'budget',
  budgetMode: prefill?.budgetMode ?? 'NORMAL',
  maxMinutes: prefill?.maxMinutes ?? 60,
  antiFilters: prefill?.antiFilters ?? [],
});
```

**Шаг 1: BudgetStep.tsx** — 3 radio карточки (NOTHING / MINIMAL / NORMAL). Каждая с иконкой (NoShoppingCart / ShoppingBag / Wallet) + текстом + коротким описанием. RHF + Zod. Кнопка «Далее» → `setStep('time')`. Quick-scenario «Ничего не покупать» → переход сразу на шаг 2 с `budgetMode='NOTHING'`.

**Шаг 2: TimeStep.tsx** — slider 15..120 (input[type=range] + label). Дефолт 60. Также показываем chip-варианты: «15 мин» / «30 мин» / «60 мин» / «до 2 ч» (для UX). RHF + Zod (`z.coerce.number().int().min(15).max(120)`). Кнопка «Назад» → `setStep('budget')`. Кнопка «Далее» → `setStep('anti')`.

**Шаг 3: AntiRecipesStep.tsx** — 8 чекбоксов с описаниями на русском:
- `NO_OVEN` — «Без духовки»
- `ONE_PAN` — «Одна посуда»
- `NOT_CHICKEN_AGAIN` — «Не курицу снова» (если вчера была курица — disabled с подсказкой)
- `NO_LEFTOVERS` — «Без остатков»
- `NO_FRYING` — «Без жарки»
- `NO_CHOPPING` — «Без нарезки»
- `SHORT_TIME` — «Недолго (≤20 мин)»
- `NO_MULTISTEP` — «Без сложных шагов»

RHF + Zod (`z.array(z.enum([...8...])).max(8)`). Кнопка «Назад» → `setStep('time')`. Кнопка «Получить рекомендацию» → POST + redirect `/today/loading?budget=&time=&anti=`.

**Прогресс-индикатор**: «Шаг N из 3» + 3 точки (filled/current/empty).

**Валидация на каждом шаге**: Zod-схема для одного шага (`BudgetStepSchema`, `TimeStepSchema`, `AntiStepSchema`). RHF `mode: 'onChange'`. Кнопка «Далее» disabled, если шаг невалиден.

**Quick-scenario переходы** (через URL prefill):
- `?prefill=NOTHING` → стартует на шаге `time` (пропускаем `budget`).
- `?prefill=.30.` → стартует на шаге `budget`, но `maxMinutes=30` уже выставлен (визуально после выбора бюджета).
- `?prefill=..NO_OVEN` → стартует на шаге `budget`, `antiFilters=[NO_OVEN]`.
- `?prefill=URGENT` → стартует на шаге `time`, `maxMinutes=20`, `antiFilters=[SHORT_TIME, NO_MULTISTEP]`.

## Quick scenarios (`QuickScenarios.tsx`)

4 чипа в `<Card>` на `/today`. Каждый — `<Link>` с `?prefill=...`:

| Чип | prefill | Целевой шаг |
|---|---|---|
| «Ничего не покупать» | `NOTHING` | шаг 2 (time) |
| «До 30 минут» | `.30.` | шаг 1 (budget), time=30 после выбора |
| «Без духовки» | `..NO_OVEN` | шаг 1 (budget), anti=[NO_OVEN] после прохождения wizard |
| «Срочно» | `URGENT` | шаг 2 (time), time=20, anti=[SHORT_TIME, NO_MULTISTEP] |

**Все 4 ведут на `/today/generate`**, не сразу на loading — пользователь может отредактировать параметры.

## LoadingClient (`/today/loading`)

**Не реальный прогресс** (POST < 500 мс, нечего показывать). Имитация:
- 0–200ms: «Загружаем продукты...»
- 200–350ms: «Исключаем аллергены...»
- 350–500ms: «Считаем рекомендации...»

Реализация: `setTimeout` с прогресс-баром 0%→100% за 500ms. На завершении — push `/today/result?ref=X`. Если POST упал раньше — toast «Не удалось получить рекомендации» + кнопка «Повторить».

**Если POST < 500 мс** (норма) — пользователь увидит быструю анимацию. Если > 500 мс (деградация бэка) — анимация закончится раньше реального ответа, юзер залипнет. **Защита**: реальный POST запускаем параллельно с анимацией; какой первый — тот побеждает. POST результат → сохранить в sessionStorage + redirect (анимация прерывается).

## ResultClient (`/today/result`)

3 карточки в порядке FROM_PANTRY / BEST_MATCH / CHAIN. Каждая:
- `<OptionCard type={option.type} recipe={option.recipe} score={option.score} explanation={option.explanation} />`.
- Если `type='CHAIN'` — `<ChainTimeline chain={option.chain} />` под карточкой (1 «главный» рецепт + 2–3 «вспомогательных» с долей общего ингредиента).
- Если `type='FROM_PANTRY'` — badge «Докупить: N» (из `option.toBuyCount`).
- `<ExplanationChip>{option.explanation}</ExplanationChip>` — плашка с объяснением.
- Кнопка «Готовлю это» → `acceptRecommendation(option.recipe.id, defaultServings)` → router.push.
- Кнопка «Подробнее» (Link) → `/recipe/[id]?servings=2`.

**Empty-state**: если `pantry.length === 0` И `activePlan === null` — `/today` показывает hero CTA «Добавьте продукты в холодильник» (вместо «Получить рекомендацию»). Ссылка на `/fridge/add`.

## usePreferences (новый hook)

```ts
// apps/web/src/hooks/usePreferences.ts
import { useEffect, useState } from 'react';

export interface UserPreferences {
  dietType: 'NONE' | 'VEGETARIAN' | 'VEGAN' | 'PESCATARIAN';
  appliances: string[];
  allergies: string[];   // ingredientId[]
  loves: string[];
  dislikes: string[];
}

interface UsePreferencesResult {
  preferences: UserPreferences | null;
  loading: boolean;
  error: string | null;
}

const CACHE_TTL_MS = 60_000;

export function usePreferences(deps?: { fetchImpl?: typeof fetch; baseUrl?: string }): UsePreferencesResult {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchFn = deps?.fetchImpl ?? fetch;
    const base = deps?.baseUrl ?? getApiBaseUrl();
    fetchFn(`${base}/api/v1/profile`, { credentials: 'include', signal: controller.signal })
      .then(r => r.json())
      .then((json: { data?: { preferences?: UserPreferences }; error?: unknown }) => {
        if (cancelled) return;
        if (json.data?.preferences) {
          setPrefs(json.data.preferences);
          setLoading(false);
        } else {
          setError('preferences_unavailable');
          setLoading(false);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { preferences: prefs, loading, error };
}
```

**Источник**: `GET /api/v1/profile` — нужно проверить, что он возвращает `preferences`. **TODO при имплементации**: согласовать сигнатуру с backend (MC-011 уже делал профиль). Если endpoint другой — скорректировать.

**Кеш**: in-memory module-scope, 60 сек (preferences меняются реже pantry).

**Если endpoint не готов** (зависит от MC-011 — уже merged? **проверить**): mock через `NEXT_PUBLIC_USE_PROFILE_MOCK=1`. Default — боевой.

## Тесты

### Компонентные (`node --test --import tsx --test-reporter=spec` + happy-dom)

1. **`Greeting.test.tsx`**:
   - hour < 12 → «Доброе утро»
   - 12 ≤ hour < 18 → «Добрый день»
   - hour ≥ 18 → «Добрый вечер»

2. **`UrgentBlock.test.tsx`**:
   - pantry с 5 продуктами, у 2 `expiresAt <= today+3` → блок показывает 2, остальные скрыты.
   - пустой pantry → блок не рендерится.
   - сортировка: ближайший срок первый.

3. **`QuickScenarios.test.tsx`**:
   - 4 `<Link>` с правильными `href` (`?prefill=...`).
   - клик на «Ничего не покупать» → URL `/today/generate?prefill=NOTHING`.

4. **`WizardClient.test.tsx`**:
   - старт на шаге 1, кнопка «Назад» disabled.
   - шаг 1 → 2 → 3, прогресс «1/3» → «2/3» → «3/3».
   - «Назад» на шаге 3 → 2 → 1.
   - prefill через URL: `?prefill=NOTHING` → стартует на шаге 2.
   - Zod-валидация: пустой `antiFilters` — ОК (default).
   - клик «Получить рекомендацию» на шаге 3 → POST mock (deps) + redirect на `/today/loading?budget=&time=&anti=`.

5. **`ResultClient.test.tsx`**:
   - 3 карточки в порядке FROM_PANTRY / BEST_MATCH / CHAIN.
   - `ChainTimeline` рендерится только для type='CHAIN'.
   - «Готовлю это» → `acceptRecommendation` mock → router.push на `/shopping/<id>`.
   - sessionStorage без `ref` → redirect на `/today` с toast.

6. **`recommendations-client.test.ts`**:
   - deps-инъекция `fetchImpl` mock.
   - mock-режим `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` → возвращает `{mealPlanId, shoppingListId}` без fetch.
   - валидация Zod `TodayRecommendationDtoSchema` на ответе.

**Coverage**: ≥ 85% branches (фронт не требует 90%).

### E2E (Playwright)

`tests/e2e/today-recommendation.spec.ts`:
```ts
test('получить рекомендацию и принять', async ({ page }) => {
  await page.goto('/today');
  await page.getByTestId('hero-cta').click();           // → /today/generate
  await page.getByTestId('wizard-step-next').click();   // budget → time
  await page.getByTestId('wizard-step-next').click();   // time → anti
  await page.getByTestId('wizard-submit').click();      // → /today/loading
  await page.waitForURL(/\/today\/result/);             // sessionStorage ref=X
  await expect(page.getByTestId('option-FROM_PANTRY')).toBeVisible();
  await page.getByTestId('accept-FROM_PANTRY').click();
  await page.waitForURL(/\/shopping\/mock-list-/);
  await expect(page.getByText('План создан!')).toBeVisible();
});
```

**Mock-режимы** для e2e:
- `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` — accept всегда возвращает mock-id.
- Profile/preferences — через реальный seed (если есть) или `NEXT_PUBLIC_USE_PROFILE_MOCK=1`.

## DoD

- G1–G5 (lint, format, typecheck, test, build).
- `pnpm --filter @multichef/web typecheck` — 0 ошибок.
- 4+ компонентных теста зелёные.
- e2e «получить рекомендацию и принять» зелёный.
- Дисклеймер КБЖУ — НЕ на карточке результата (карточка краткая). Ссылка «Подробнее» ведёт на `/recipe/[id]`, где дисклеймер уже есть (MC-035). **Подтвердить** с менеджером (открытый вопрос #1).
- Empty-state при пустом pantry.
- Скриншоты в PR: /today idle, /today/generate 3 шага, /today/loading, /today/result, /shopping/[listId] заглушка.
- `pnpm test` в CI зелёный (с учётом фикса PR #21 → `turbo run build --filter=@multichef/web`).

## Зависимости

**Только frontend.** Никаких изменений в backend, `packages/database`, `packages/contracts`.

- `packages/ui` — Button, Card, Chip, Badge, Skeleton, BottomSheet, Toast — всё уже есть.
- `packages/nutrition` — НЕ используется (пересчёт на бэке).
- `apps/web/src/hooks/usePantry.ts` — уже есть (MC-035).
- `apps/web/src/hooks/usePreferences.ts` — **создаётся в MC-034**.
- `apps/web/src/lib/recommendations-client.ts` — **создаётся в MC-034**.
- `apps/web/src/lib/pantry-client.ts` — есть.
- `apps/web/src/lib/recipe-client.ts` — есть (MC-035), ссылка на `/recipe/[id]`.
- `lucide-react` — `ChefHat`, `Sun`, `Sunset`, `Moon`, `AlertTriangle`, `Zap`, `Clock`, `Ban`, `Wheat`, `Carrot`, `Snowflake`, `Timer`, `Lock`, `ArrowLeft`, `ArrowRight`.

**Новые deps не нужны.**

## Обратимость

**Высокая.** Все артефакты — в `apps/web/src/app/(app)/today/`, 2 новых хука/клиента, 1 заглушка `/shopping/[listId]`.

- Удалить `/today/{generate,loading,result}` + revert `page.tsx` к MC-013 stub = revert.
- `usePreferences.ts` может переиспользоваться в MC-040/MC-041/MC-043 (показ dietary, аллергенов) — оставляем.
- `recommendations-client.ts` используется только в `/today/result` — удалить = revert.
- `/shopping/[listId]` заглушка переживёт MC-056 (расширится в полноценный экран).
- Никаких миграций, никаких изменений в БД.

## Следующие шаги для frontend-bot

1. **Pre-шаг**: проверить `GET /api/v1/profile` — что возвращает `preferences` (из MC-011). Если нет — добавить поле в backend (отдельный тикет) или замокать.
2. Создать `apps/web/src/hooks/usePreferences.ts`.
3. Создать `apps/web/src/lib/recommendations-client.ts` (с mock-режимом `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`).
4. Реализовать `apps/web/src/app/(app)/today/page.tsx` (server, fetch pantry + preferences + activePlan).
5. Реализовать `TodayClient.tsx` + 7 компонентов.
6. Реализовать `/today/generate` (wizard 3 шага).
7. Реализовать `/today/loading` (имитация прогресса).
8. Реализовать `/today/result` (3 карточки + кнопки).
9. Заглушка `/shopping/[listId]/page.tsx`.
10. 5+ компонентных тестов + 1 e2e.
11. Manual QA: скриншоты на iPhone SE (375×667) и desktop (1440×900).
12. PR + ревью @qa-docs-bot.

**Параллелизация с MC-033 уже невозможна** (MC-033 merged). **MC-034 → MC-035** были параллельны, теперь последовательно.

## Открытые вопросы

1. **Дисклеймер КБЖУ на карточке результата.** PRD §2.3.4 говорит «3 карточки с плашкой объяснения». Дисклеймер §2.5.7 привязан к экрану рецепта (MC-035). Нужно ли дублировать на каждой карточке результата? **Дефолт: НЕ дублируем**, ссылка «Подробнее» ведёт на `/recipe/[id]`, где дисклеймер уже есть. **Подтвердить** — если да, то мелким текстом под explanation-chip.
2. **`GET /api/v1/profile` — формат preferences.** Не проверял сигнатуру MC-011. Если возвращает `{ nutritionProfile, preferences: [...] }` — маппер нужен. **Дефолт: маппер `mapPreferencesResponse`** в `usePreferences.ts`, graceful fallback на пустой prefs если endpoint вернёт 404.
3. **Quick-scenario «Срочно»** — что значит «срочно»? Бюджет = MINIMAL, maxMinutes = 20, anti = [SHORT_TIME, NO_MULTISTEP]? Или только фокус на pantry с expiresAt ≤ 1 день? **Дефолт**: комбинация MINIMAL/20/[SHORT_TIME, NO_MULTISTEP] (настройки + анти). Если нужно ещё передать `focusMode='urgent'` в backend — **отдельный запрос**.
4. **`/today/loading` имитация 500 мс — может ощущаться «тормозом».** Реальный POST < 500 мс (MC-033 DoD). Зачем показывать лоадер? **Варианты**: (a) показать скелетон 200мс (минимум для UX-ощущения «что-то происходит»), (b) пустить скелетон только если POST > 200 мс, иначе сразу редирект. **Дефолт: (b)** — оптический комфорт без навязанной задержки.
5. **`/shopping/[listId]` заглушка — это scope creep.** Менеджер явно просил её как scope-расширение. **Подтвердить**: да, делаем; или пропускаем (тогда «Готовлю это» ведёт на 404 с toast «Список покупок появится позже»).

Если пользователь молчит — действуем по дефолтам в скобках.

## Красные флаги

1. **sessionStorage quota 5–10 MB.** `TodayRecommendationDto` с 3 рецептами + chain[] — обычно 2–5 KB. **Дефолт**: ОК. Защита: если quota exceeded (например, длинный chain) → fallback на `?data=base64(...)` в URL.
2. **Refresh `/today/result?ref=X` с заполненным sessionStorage** — ОК. Без sessionStorage (новый tab) → redirect /today + toast. UX-раздражитель, но правильный.
3. **Back/forward на `/today/loading`** — POST уже сделан, второй POST не нужен. Защита: при mount `/today/loading` — проверить, нет ли уже `resultRef` в sessionStorage; если есть — сразу redirect на `/today/result`.
4. **Race `router.push` + setTimeout в loading**. Если пользователь быстро кликнет back во время loading — два push'а подряд. Защита: `useTransition()` или disabled-кнопка во время loading.
5. **`NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` утекает в прод.** `NEXT_PUBLIC_*` доступен клиенту. **Дефолт: 0 в проде**, проверка `NODE_ENV === 'production'` в коде → если production && mock === '1' → ошибка в console + fallback на реальный endpoint.
6. **Zod-схема `TodayRecommendationDtoSchema` валидирует ответ на клиенте.** Бэкенд MC-033 уже валидирует (Zod parse в controller), но двойная валидация — защита от breaking changes. Защита: вернуть `{ data: null, error: { code: 'CONTRACT_MISMATCH' } }` при невалидном ответе + toast «Сервер обновился, обновите страницу».
7. **Wizard URL deep-link с невалидным prefill.** `?prefill=NOTHING,30,NO_OVEN,FOO` (неизвестный фильтр) — Zod упадёт. **Дефолт**: тихо игнорировать невалидные токены, использовать дефолты для нераспознанного.
8. **`usePreferences` не блокирует wizard.** Если preferences ещё loading — пользователь может выбрать антирецепты, потом prefs придут и пере-рендерят UI. Защита: `loading=true` → показывать skeleton на `/today`, не блокировать wizard.
9. **`UpcomingMeals` показывает данные из `activePlan`.** Если endpoint `/api/v1/meal-plans/active` не готов (MC-051 ещё не делал) — нужно либо mock, либо скрыть блок. **Дефолт**: если `activePlan === null` → блок не рендерится. Если есть 404 — логируем в console, не падаем.
10. **`Greeting` час** — `new Date().getHours()` использует локальную таймзону браузера. SSR vs CSR могут дать разный `hour` (если запрос идёт ночью UTC, но утром по локальному времени). **Защита**: `useState(() => new Date().getHours())` на клиенте, либо `'use client'` для компонента. **Дефолт**: `'use client'` для Greeting (маленький компонент, не критично для SSR).
11. **`HeroButton` disabled при loading pantry.** Если `usePantry().loading === true` → CTA показывает skeleton, не disabled (юзер не должен ждать pantry для перехода в wizard). **Дефолт**: CTA всегда enabled, pantry загружается на фоне.
12. **`OptionCard` ссылка `/recipe/[id]?servings=2`** — дефолтный `servings=2`. Если в recipeDto нет `servings` — fallback на 2. **Дефолт**: hard-coded 2 (recipeDto всегда имеет `servings` по `RecipeDtoSchema`).
13. **`ChainTimeline` 2–4 рецепта в `chain[]`** — на мобильном (375px) мини-таймлайн с 4 элементами может быть тесным. **Защита**: horizontal scroll для таймлайна, snap-to-start.
14. **`/today/result` с type=CHAIN и `chainTag=null`** (fallback per MC-033) — `ChainTimeline` не рендерится (нет chain). Карточка выглядит как BEST_MATCH. **Дефолт**: показываем «Нет подходящих цепочек» в explanation.
15. **`/shopping/[listId]` deep-link после «Готовлю это»** — если заглушка не готова (scope creep отклонён) → 404. **Защита**: middleware redirect на /today с toast «Список скоро появится».
16. **Mock UUID в `acceptRecommendation` (`crypto.randomUUID()`)** — на старых браузерах нет `crypto.randomUUID()`. **Дефолт**: fallback `Math.random().toString(36).slice(2)` если `crypto.randomUUID` undefined.
17. **CI-fix (PR #21)**: добавился explicit `pnpm turbo run build --filter=@multichef/web...` в job `test`. Если PR #21 ещё не merged — MC-034 может первым наткнуться на nutrition-dist issue. **Защита**: проверить, что CI-fix merged до MC-034. Если нет — frontend-bot сообщает менеджеру.

---

## Сводка (5 строк)

1. **4 sub-route**: `/today` (idle: Greeting, UrgentBlock, BudgetProgress, QuickScenarios, HeroButton, UpcomingMeals, RouletteLink), `/today/generate` (wizard 3 шага: budget/time/anti), `/today/loading` (имитация 200–500ms или сразу redirect если POST быстрый), `/today/result?ref=X` (3 карточки + кнопки «Готовлю это»/«Подробнее»).
2. **State-машина URL-driven** через Next.js `router.push`, результат в **sessionStorage по `?ref=<uuid>`** (не в URL — слишком длинный); refresh ОК, share бессмысленен.
3. **Quick scenarios** через `?prefill=` (4 чипа: NOTHING→пропуск шага 1, 30, NO_OVEN, URGENT=20+[SHORT_TIME,NO_MULTISTEP]); wizard 3 шага с Zod-валидацией; **mock `acceptRecommendation`** через `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` до MC-051.
4. **5 открытых вопросов**: дисклеймер КБЖУ на карточке (дефолт — не дублируем, ссылка на /recipe/[id]), формат `GET /profile` (дефолт — graceful fallback), «Срочно» = MINIMAL/20/[SHORT_TIME,NO_MULTISTEP], loading 500 мс (дефолт — оптический скелетон только если POST > 200 мс), `/shopping/[listId]` заглушка (дефолт — делаем как scope-расширение).
5. **17 красных флагов**: sessionStorage quota, refresh без sessionStorage, race router.push, mock утекает в прод, двойная Zod-валидация ответа, невалидный prefill, usePreferences не блокирует wizard, UpcomingMeals 404, Greeting SSR/CSR час, HeroButton + loading pantry, ChainTimeline 4 элемента на 375px, CHAIN chainTag=null fallback, `/shopping/[listId]` 404, `crypto.randomUUID` старые браузеры, CI-fix PR #21 ещё не merged.
