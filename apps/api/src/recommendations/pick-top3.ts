// MC-033 — pick-top3: FROM_PANTRY / BEST_MATCH / CHAIN selection.
//
// Sync (ADR red flag #13): everything needed is already inside `ranked`
// + ctx; no extra Prisma calls. Exactly 3 options are ALWAYS returned —
// empty slots fall back per the ADR (FROM_PANTRY→BEST_MATCH fallback
// keeps its own type; CHAIN fallback keeps type CHAIN with
// chainTag: null + empty chain + explicit explanation).

import type { ScoredRecipe, GenerationContext } from '@multichef/recommendation';
import type { RecipeDto } from '@multichef/contracts';
import type { RecipeRowWithRelations, toDto } from '../recipes/recipes.service.js';

export type PickDeps = {
  toRecipeDto: (row: RecipeRowWithRelations) => ReturnType<typeof toDto>;
  rowById: Map<string, RecipeRowWithRelations>;
};

export type TodayOption =
  | {
      type: 'FROM_PANTRY';
      recipe: RecipeDto;
      score: number;
      toBuyCount: number;
      chainTag: string | null;
      explanation: string;
    }
  | { type: 'BEST_MATCH'; recipe: RecipeDto; score: number; explanation: string }
  | {
      type: 'CHAIN';
      recipe: RecipeDto;
      score: number;
      chainTag: string | null;
      chain: RecipeDto[];
      explanation: string;
    };

/** Ingredients of the recipe NOT covered by the pantry (required only). */
export function countMissingIngredients(
  recipe: ScoredRecipe['recipe'],
  ctx: GenerationContext,
): number {
  const pantry = new Map<string, number>();
  for (const item of ctx.pantry) {
    pantry.set(item.ingredientId, (pantry.get(item.ingredientId) ?? 0) + item.estimatedGrams);
  }
  let missing = 0;
  for (const ing of recipe.ingredients) {
    if (ing.optional) continue;
    if ((pantry.get(ing.ingredientId) ?? 0) < ing.grams) missing += 1;
  }
  return missing;
}

function groupByFirstChainTag(scored: ScoredRecipe[]): Map<string, ScoredRecipe[]> {
  const groups = new Map<string, ScoredRecipe[]>();
  for (const s of scored) {
    const tag = s.recipe.chainTags?.[0];
    if (!tag) continue;
    const arr = groups.get(tag) ?? [];
    arr.push(s);
    groups.set(tag, arr);
  }
  return groups;
}

export function pickTop3(
  ranked: ScoredRecipe[],
  ctx: GenerationContext,
  deps: PickDeps,
  explain: (
    s: ScoredRecipe,
    extra?: { toBuyCount?: number; chainTag?: string | null; noChains?: boolean },
  ) => string,
): TodayOption[] {
  const passed = ranked.filter((s) => s.passed);
  const used = new Set<string>();

  // --- 1. FROM_PANTRY: best pantryMatch among toBuyCount <= 2 --------
  const pantryCandidates = passed
    .map((s) => ({ s, toBuy: countMissingIngredients(s.recipe, ctx) }))
    .filter((c) => c.toBuy <= 2)
    .sort(
      (a, b) =>
        b.s.breakdown.pantryMatch.value - a.s.breakdown.pantryMatch.value ||
        b.s.breakdown.expirationBenefit.value - a.s.breakdown.expirationBenefit.value ||
        a.s.recipe.id.localeCompare(b.s.recipe.id),
    );

  let fromPantry: TodayOption;
  const bestPantry = pantryCandidates[0];
  if (bestPantry) {
    used.add(bestPantry.s.recipe.id);
    fromPantry = {
      type: 'FROM_PANTRY',
      recipe: deps.toRecipeDto(deps.rowById.get(bestPantry.s.recipe.id)!),
      score: bestPantry.s.score,
      toBuyCount: bestPantry.toBuy,
      chainTag: bestPantry.s.recipe.chainTags?.[0] ?? null,
      explanation: explain(bestPantry.s, { toBuyCount: bestPantry.toBuy }),
    };
  } else {
    // Fallback: nothing with ≤2 missing → the least-missing recipe
    // becomes FROM_PANTRY (with its real toBuyCount).
    const leastMissing = passed
      .map((s) => ({ s, toBuy: countMissingIngredients(s.recipe, ctx) }))
      .sort(
        (a, b) =>
          a.toBuy - b.toBuy ||
          b.s.breakdown.pantryMatch.value - a.s.breakdown.pantryMatch.value ||
          a.s.recipe.id.localeCompare(b.s.recipe.id),
      )[0];
    if (leastMissing) {
      used.add(leastMissing.s.recipe.id);
      fromPantry = {
        type: 'FROM_PANTRY',
        recipe: deps.toRecipeDto(deps.rowById.get(leastMissing.s.recipe.id)!),
        score: leastMissing.s.score,
        toBuyCount: leastMissing.toBuy,
        chainTag: leastMissing.s.recipe.chainTags?.[0] ?? null,
        explanation: explain(leastMissing.s, { toBuyCount: leastMissing.toBuy }),
      };
    } else {
      // Catalog empty after filtering — duplicate BEST_MATCH placeholder.
      const fallback = passed[0];
      if (!fallback) {
        throw new Error('no passed recipes to fill FROM_PANTRY slot');
      }
      used.add(fallback.recipe.id);
      fromPantry = {
        type: 'FROM_PANTRY',
        recipe: deps.toRecipeDto(deps.rowById.get(fallback.recipe.id)!),
        score: fallback.score,
        toBuyCount: countMissingIngredients(fallback.recipe, ctx),
        chainTag: fallback.recipe.chainTags?.[0] ?? null,
        explanation: explain(fallback),
      };
    }
  }

  // --- 2. BEST_MATCH: top total score excluding used -------------------
  const bestCandidate = passed
    .filter((s) => !used.has(s.recipe.id))
    .sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id))[0];
  const bestMatch: TodayOption = bestCandidate
    ? {
        type: 'BEST_MATCH',
        recipe: deps.toRecipeDto(deps.rowById.get(bestCandidate.recipe.id)!),
        score: bestCandidate.score,
        explanation: explain(bestCandidate),
      }
    : fromPantry; // degenerate catalog: duplicate FROM_PANTRY option
  if (bestCandidate) used.add(bestCandidate.recipe.id);

  // --- 3. CHAIN: best 2..4 cluster by avg score -------------------------
  const chainGroups = groupByFirstChainTag(passed.filter((s) => !used.has(s.recipe.id)));
  const clusters = [...chainGroups.entries()]
    .filter(([, arr]) => arr.length >= 2 && arr.length <= 4)
    .map(([tag, arr]) => ({
      tag,
      avgScore: arr.reduce((sum, s) => sum + s.score, 0) / arr.length,
      recipes: [...arr].sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id)),
    }))
    .sort((a, b) => b.avgScore - a.avgScore || a.tag.localeCompare(b.tag));

  const bestCluster = clusters[0];
  let chain: TodayOption;
  if (bestCluster) {
    const main = bestCluster.recipes[0]!;
    const rest = bestCluster.recipes
      .slice(1, 4)
      .map((s) => deps.toRecipeDto(deps.rowById.get(s.recipe.id)!));
    chain = {
      type: 'CHAIN',
      recipe: deps.toRecipeDto(deps.rowById.get(main.recipe.id)!),
      score: main.score,
      chainTag: bestCluster.tag,
      chain: rest,
      explanation: explain(main, { chainTag: bestCluster.tag }),
    };
  } else {
    // ADR fallback: CHAIN slot stays type CHAIN, chainTag null, chain [].
    const fallback = passed.find((s) => !used.has(s.recipe.id)) ?? passed[0];
    if (!fallback) throw new Error('no passed recipes to fill CHAIN slot');
    chain = {
      type: 'CHAIN',
      recipe: deps.toRecipeDto(deps.rowById.get(fallback.recipe.id)!),
      score: fallback.score,
      chainTag: null,
      chain: [],
      explanation: explain(fallback, { noChains: true }),
    };
  }

  return [fromPantry, bestMatch, chain];
}
