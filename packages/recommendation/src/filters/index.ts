// MC-032 — Hard filters. Applied BEFORE scoring, cheapest first:
// allergy → dietType → appliances → maxTime → antiRecipes → rescue.

import type { FilterVerdict, FilterResult, GenerationContext, Recipe } from '../types.js';
import { allergyFilter } from './allergy.js';
import { dietTypeFilter } from './dietType.js';
import { appliancesFilter } from './appliances.js';
import { maxTimeFilter } from './maxTime.js';
import { ANTI_RECIPE_PREDICATES } from './antiRecipes.js';
import { rescueFilter } from './rescue.js';

export type Filter = (recipe: Recipe, ctx: GenerationContext) => FilterVerdict;

/** All anti-recipe tokens checked in one pass; first rejection wins. */
const antiRecipesFilter: Filter = (recipe, ctx) => {
  for (const token of ctx.antiFilters) {
    const verdict = ANTI_RECIPE_PREDICATES[token](recipe, ctx);
    if (verdict !== true) return verdict;
  }
  return true;
};

const HARD_FILTERS: readonly Filter[] = [
  allergyFilter,
  dietTypeFilter,
  appliancesFilter,
  maxTimeFilter,
  antiRecipesFilter,
];

export {
  allergyFilter,
  dietTypeFilter,
  appliancesFilter,
  maxTimeFilter,
  antiRecipesFilter,
  rescueFilter,
};
export { ANTI_RECIPE_PREDICATES } from './antiRecipes.js';

/**
 * Run every recipe through the hard-filter chain. Returns two disjoint
 * sets: passed recipes (input to scoring) and rejections with reasons.
 */
export function applyHardFilters(recipes: Recipe[], ctx: GenerationContext): FilterResult {
  const passed: Recipe[] = [];
  const rejected: FilterResult['rejected'] = [];

  for (const recipe of recipes) {
    let verdict: FilterVerdict = true;
    for (const filter of HARD_FILTERS) {
      verdict = filter(recipe, ctx);
      if (verdict !== true) break;
    }
    if (verdict === true && ctx.rescue) {
      verdict = rescueFilter(recipe, ctx);
    }
    if (verdict === true) {
      passed.push(recipe);
    } else {
      rejected.push({ recipe, reason: verdict.reject });
    }
  }

  return { passed, rejected };
}
