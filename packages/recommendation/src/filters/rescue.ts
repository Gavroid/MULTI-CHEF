// MC-032 — Rescue filter (MC-040 «спаси продукт»).
//
// Only recipes containing the target ingredient pass. Exported for
// MC-040; applied last in applyHardFilters when ctx.rescue is set.

import type { Filter } from './index.js';

export const rescueFilter: Filter = (recipe, ctx) =>
  recipe.ingredients.some((i) => i.ingredientId === ctx.rescue?.targetIngredientId)
    ? true
    : { reject: { code: 'NOT_RESCUE_TARGET' } };
