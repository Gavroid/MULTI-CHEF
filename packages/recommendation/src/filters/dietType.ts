// MC-032 — Diet-type filter.
//
// Maps the user's diet to banned ingredient groups:
//   VEGETARIAN → MEAT, FISH;  VEGAN → MEAT, FISH, DAIRY, EGG;
//   PESCATARIAN → MEAT;       NONE → no restriction.

import type { Filter } from './index.js';
import type { DietType, IngredientCategoryGroup } from '../types.js';

const BANNED_GROUPS: Record<DietType, ReadonlySet<IngredientCategoryGroup>> = {
  NONE: new Set([]),
  VEGETARIAN: new Set<IngredientCategoryGroup>(['MEAT', 'FISH']),
  VEGAN: new Set<IngredientCategoryGroup>(['MEAT', 'FISH', 'DAIRY', 'EGG']),
  PESCATARIAN: new Set<IngredientCategoryGroup>(['MEAT']),
};

export const dietTypeFilter: Filter = (recipe, ctx) => {
  const banned = BANNED_GROUPS[ctx.preferences.dietType];
  const hit = recipe.ingredients.find((i) => banned.has(i.categoryGroup));
  return hit ? { reject: { code: 'DIET_CONFLICT', ingredientId: hit.ingredientId } } : true;
};
