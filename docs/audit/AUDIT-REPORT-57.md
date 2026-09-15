# Технический, продуктовый и UI-аудит MULTI-CHEF (57-й круг)

**Дата:** 2026-09-15
**Область:** Recommendation engine / scoring bias
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

`packages/recommendation/src/scoring/` — взвешенная сумма 8 факторов с
Σ = 1.00 (защищено unit-тестом). Каркас сильный, но при детальном
разборе отдельных факторов всплывают два структурных бага, которые
«съедают» часть сигнала:

1. **`varietyScore` имеет вес 0** в обычном профиле (`FACTOR_WEIGHTS`)
   и в `RESCUE_FACTOR_WEIGHTS`. То есть «как часто это блюдо готовили
   за последние 7 дней» — **никак** не учитывается при выборе
   рецепта на сегодня.
2. **`preferenceMatch` инвертирован по количеству совпадений**: чем
   больше LOVE/DISLIKE хитов, тем ниже score (из-за нормировки на
   `total = loveHits + dislikeHits`).

Плюс один продуктовый разрыв: `noveltyScore` ограничен весом 0.05
и при этом почти никогда не достигает 1.0 — вклад ниже шума.

---

## Технические находки (57-й круг)

### T57-A · 🟠 P2 — `varietyScore` обнулён в обоих профилях весов

**Где:** `packages/recommendation/src/scoring/weights.ts:18-30, 39-49`.

**Симптом.**

```ts
export const FACTOR_WEIGHTS = {
  pantryMatch: 0.25,
  expirationBenefit: 0.2,
  budgetMatch: 0.15,
  nutritionMatch: 0.15,
  timeMatch: 0.1,
  preferenceMatch: 0.1,
  varietyScore: 0, // ←
  noveltyScore: 0.05,
};

export const RESCUE_FACTOR_WEIGHTS = {
  pantryMatch: 0.25,
  expirationBenefit: 0.3,
  budgetMatch: 0.1,
  nutritionMatch: 0.1,
  timeMatch: 0.15,
  preferenceMatch: 0.05,
  varietyScore: 0, // ←
  noveltyScore: 0.05,
};
```

В обоих пресетах `varietyScore = 0`. Реализация фактора
(`varietyScore.ts`) при этом считается корректно: 1.0 если рецепт не
готовили за 7 дней, меньше 1.0 если готовили. Но взвешенный вклад
всегда `factorValue * 0 = 0`. **Сигнал «не повторяй вчерашнее»
игнорируется.**

**Почему важно.** Это один из самых сильных сигналов лояльности: если
пользователь 3 дня подряд получал в `/today` пасту, его оценка
удовлетворённости резко падает. Сейчас единственное, что его защищает,
— `noveltyScore` (вес 0.05), и тот учитывает только теги и длину
списка ингредиентов, а не реальную историю готовки.

**Гипотеза фикса.**

```ts
// FACTOR_WEIGHTS
pantryMatch: 0.20,
expirationBenefit: 0.20,
budgetMatch: 0.15,
nutritionMatch: 0.10,
timeMatch: 0.10,
preferenceMatch: 0.10,
varietyScore: 0.10,  // ← was 0
noveltyScore: 0.05,
```

И в `RESCUE_FACTOR_WEIGHTS` оставить `varietyScore: 0` (резерв — не
про разнообразие, а про «спаси то, что гниёт»), но явно прокомментировать.
Это потребует обновления
`packages/recommendation/src/__tests__/fixtures/expectedScores.ts` (по
комментарию в `weights.ts:8-11`, drift guard там уже есть).

---

### T57-B · 🟠 P2 — `preferenceMatch` уменьшается с ростом числа хитов

**Где:** `packages/recommendation/src/scoring/factors/preferenceMatch.ts:30`.

**Симптом.**

```ts
const total = loveHits + dislikeHits;
if (total === 0) return 0.5;
return clamp01((loveHits / total - dislikeHits / total + 1) / 2);
```

Поведение:

| Recipe has               | loveHits | dislikeHits | score |
| ------------------------ | -------- | ----------- | ----- |
| 1 любимый ингредиент     | 1        | 0           | 1.00  |
| 1 любимый + 1 нелюбимый  | 1        | 1           | 0.50  |
| 5 любимых                | 5        | 0           | 1.00  |
| 5 любимых + 1 нелюбимый  | 5        | 1           | 0.83  |
| 10 любимых + 5 нелюбимых | 10       | 5           | 0.58  |

Это **противоречит интуиции пользователя**: рецепт, в котором
10 любимых ингредиентов, должен выигрывать у рецепта с 1 любимым.
Сейчас при 5 любимых и 1 нелюбимом рецепт получает 0.83, но тот же
рецепт с **только 1 любимым ингредиентом** получил бы 1.0 — выше!

Причина: `loveHits/total` и `dislikeHits/total` — это доли, не
абсолютные значения. Формула `(loveHits/n - dislikeHits/n + 1)/2`
эквивалентна `(1 + loveHits - dislikeHits) / (2 * total)`. При
`dislikeHits = 0` это `1/2 + loveHits/(2*total)`. То есть
`loveHits/(2*total)` — **убывающая** функция от `total` при
фиксированном `loveHits` (что нелогично).

**Почему важно.** Это «рекомендации хуже, чем могли бы быть» — пользователь
с развёрнутым списком LOVE получает менее персонализированные топ-3.

**Гипотеза фикса.** Заменить долевую формулу на сигмоид от **разности**:

```ts
const diff = loveHits - dislikeHits; // signed: +5 vs -1 = +4
return clamp01(0.5 + diff / (diff + 2)); // sigmoidal; sat at 1 as diff→∞
```

Или ещё проще: `0.5 + 0.1 * Math.tanh(diff / 2)`. Любая монотонная
функция от `loveHits - dislikeHits` решает проблему.

---

### T57-C · 🟡 P3 — `pantryMatch` не вознаграждает за опциональные совпадения

**Где:** `packages/recommendation/src/scoring/factors/pantryMatch.ts:14-15`.

**Симптом.**

```ts
for (const ing of recipe.ingredients) {
  if (ing.optional) continue; // ADR open question #4 default: optional never counted.
  requiredTotal += ing.grams;
  if ((pantryGrams.get(ing.ingredientId) ?? 0) >= ing.grams) {
    covered += ing.grams;
  }
}
```

Опциональные ингредиенты **никогда** не учитываются. Рецепт, у которого
5 опциональных ингредиентов (соус, гарнир, зелень) все есть в кладовке,
получает тот же `pantryMatch`, что и рецепт, у которого ничего из этого
нет. В контексте «у меня почти всё есть дома — бери это» это потеря
сигнала.

**Почему важно.** Пользователь с заполненной кладовкой ожидает, что
система отметит «всё под рукой». Текущий сигнал говорит только о
required-ингредиентах, что занижает рейтинг сложных рецептов.

**Гипотеза фикса.** Разделить вклад:

```ts
const optionalCovered = recipe.ingredients
  .filter((i) => i.optional)
  .filter((i) => (pantryGrams.get(i.ingredientId) ?? 0) >= i.grams).length;
const optionalTotal = recipe.ingredients.filter((i) => i.optional).length;
const optionalBonus = optionalTotal === 0 ? 0 : optionalCovered / optionalTotal;
return clamp01(0.7 * requiredCoverage + 0.3 * optionalBonus);
```

Это сохраняет доминирование required-составляющей, но добавляет бонус
за опциональные совпадения.

---

### T57-D · 🟡 P3 — `noveltyScore` имеет вес 0.05 и почти никогда не достигает 1.0

**Где:** `packages/recommendation/src/scoring/factors/noveltyScore.ts`,
`weights.ts:18`.

**Симптом.** `noveltyScore` складывается из:

- tag bonus (`'необычное'` / `'экзотика'` / `'фьюжн'` / `'молекулярная'`)
  → +0.5;
- `ingredients.length > 8` → +0.3;
- `chainTags.length > 0` → +0.2.

Для типичного рецепта: тег обычно не выставлен → 0; ingredients.length
7 → 0; chainTags пуст → 0. **score = 0**.

Для «необычного» рецепта с тегом и длинным списком: 0.5 + 0.3 = 0.8;
× 0.05 (вес) = 0.04 вклада в общий score. Это **ниже шума** —
`pantryMatch` отличия в 0.04 на типичных рецептах дают размах 0.3+.

**Почему важно.** Фича, которая должна была «пушить необычные рецепты
в rescue-режиме», фактически мертва. В проде «необычное» встречается
один раз на 50 рецептов, и рецепт получит +0.04 к score — неотличимо
от шума `clamp01`-погрешностей.

**Гипотеза фикса.** Либо (а) повысить вес до 0.10–0.15, либо (б)
изменить формулу на буст-фактор, а не аддитивный вес
(`finalScore *= 1 + noveltyScore * BOOST`).

---

## Подтверждённые здоровые паттерны

- `Σ = 1.00` для обоих пресетов весов — drift guard через
  `__tests__/weights.test.ts` (комментарий `weights.ts:8-11`).
- `clamp01` нормализует все factor-значения в `[0, 1]` до взвешивания.
- Каждый фактор — чистая функция `(recipe, ctx) → number`, что
  упрощает unit-тестирование и A/B-эксперименты.
- `RESCUE_FACTOR_WEIGHTS` отдельно от `FACTOR_WEIGHTS` — отдельная
  продуктовая стратегия для rescue без копипасты.
- `pantryMatch` обрабатывает «нет required-ингредиентов» (`return 1`),
  а не `0/0 = NaN`.

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                           | Файл / место                                                               |
| ----- | --- | ---- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| T57-A | 🟠  | P2   | `varietyScore` вес = 0 в обоих пресетах. Недельная               | packages/recommendation/src/scoring/weights.ts:18-30, 39-49,               |
|       |     |      | история готовки не влияет на выбор                               | factors/varietyScore.ts                                                    |
| T57-B | 🟠  | P2   | `preferenceMatch` убывает с ростом числа LOVE/DISLIKE хитов      | packages/recommendation/src/scoring/factors/preferenceMatch.ts:30          |
|       |     |      | (долевая нормировка). 5 LOVE + 1 DISLIKE = 0.83 < 1 LOVE = 1.0   |                                                                            |
| T57-C | 🟡  | P3   | `pantryMatch` не учитывает опциональные ингредиенты. Заполненная | packages/recommendation/src/scoring/factors/pantryMatch.ts:14-15           |
|       |     |      | кладовка с 5 опциональными не даёт бонуса                        |                                                                            |
| T57-D | 🟡  | P3   | `noveltyScore` вес 0.05 + почти нулевой типичный score           | packages/recommendation/src/scoring/factors/noveltyScore.ts, weights.ts:18 |
|       |     |      | → вклад ниже шума. Фича фактически мертва                        |                                                                            |

---

## Куммулятивный итог (57 кругов)

- **Всего найдено проблем:** 228 (T21–T57).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  130 · 🟡 P3: 72.
- **Раунды с нулевыми находками:** 0 из 57.
- **Топ-5 зон:** rate-limiting / DTO-валидация (29), observability /
  healthchecks (24), money / числовая арифметика (19), BullMQ / worker
  (17), RLS / tenant context (15).
- **Новые зоны в этом круге:** scoring / ranking.

---

## Рекомендации (57-й круг)

1. **T57-A — на этой неделе.** Поднять `varietyScore` до 0.10 в
   `FACTOR_WEIGHTS`, обновить `expectedScores.ts`. Это одно изменение с
   одним тестом, но самый сильный продуктовый сигнал.
2. **T57-B — на этой неделе.** Заменить долевую формулу в
   `preferenceMatch` на сигмоид от `loveHits - dislikeHits`.
3. **T57-C, T57-D — на спринт.** Добавить опциональный бонус в
   `pantryMatch`, повысить вес `noveltyScore` или сменить на
   мультипликативный boost.

---

## Артефакты (57-й круг)

- `docs/audit/AUDIT-REPORT-57.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T57-A…T57-D.
