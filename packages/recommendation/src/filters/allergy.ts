// MC-032 — Allergy / explicit-exclude filter (cheapest, runs first).
//
// A recipe is rejected if ANY ingredient id appears in the user's
// allergies or explicit exclude list.

import type { Filter } from './index.js';

export const allergyFilter: Filter = (recipe, ctx) => {
  const blocked = new Set([...ctx.preferences.excludeIngredients, ...ctx.preferences.allergies]);
  const hit = recipe.ingredients.find((i) => blocked.has(i.ingredientId));
  return hit ? { reject: { code: 'ALLERGY', ingredientId: hit.ingredientId } } : true;
};
