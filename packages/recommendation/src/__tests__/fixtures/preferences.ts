// MC-032 — User preference profiles (ADR §6.1).

import type { UserPreferences } from '../../types.js';

/** No allergies, no diet, has all appliances. */
export const NO_RESTRICT: UserPreferences = {
  dietType: 'NONE',
  excludeIngredients: [],
  allergies: [],
  appliances: ['STOVE', 'OVEN', 'MICROWAVE', 'MIXER'],
  preferences: [
    { kind: 'LOVE', ingredientId: 'ing_mushroom' },
    { kind: 'LOVE', ingredientId: 'ing_cheese' },
    { kind: 'DISLIKE', ingredientId: 'ing_chili' },
  ],
};

/** Vegan + allergic to nuts. */
export const VEGAN_ALLERGY_NUT: UserPreferences = {
  dietType: 'VEGAN',
  excludeIngredients: [],
  allergies: ['ing_nuts'],
  appliances: ['STOVE'],
  preferences: [],
};

/** Only a stove at home (no oven, no microwave). */
export const USER_OVEN: UserPreferences = {
  dietType: 'NONE',
  excludeIngredients: [],
  allergies: [],
  appliances: ['STOVE'],
  preferences: [],
};
