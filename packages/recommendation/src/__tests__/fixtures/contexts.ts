// MC-032 — Generation contexts for fixture scenarios.

import type { GenerationContext } from '../../types.js';
import { NOW, PANTRY_EMPTY, PANTRY_FULL, PANTRY_URGENT } from './pantry.js';
import { NO_RESTRICT } from './preferences.js';

const BASE = {
  now: NOW,
  preferences: NO_RESTRICT,
  maxMinutes: 60,
  antiFilters: [] as GenerationContext['antiFilters'],
  recentRecipeIds7d: [] as string[],
  mealsPerDay: 3,
};

/** Scenario A: full pantry, no constraints — «what can I cook right now». */
export const CTX_A: GenerationContext = {
  ...BASE,
  pantry: PANTRY_FULL,
};

/** Scenario B: empty pantry, tight budget mode, short time. */
export const CTX_B: GenerationContext = {
  ...BASE,
  pantry: PANTRY_EMPTY,
  maxMinutes: 30,
  budgetMode: 'NOTHING',
};

/** Scenario C: urgent tomatoes/cucumber/chicken, 7-day history with repeats. */
export const CTX_C: GenerationContext = {
  ...BASE,
  pantry: PANTRY_URGENT,
  recentRecipeIds7d: ['r_pasta_grib', 'r_pasta_grib', 'r_omelet', 'r_fried_potato'],
  targetDailyMacros: { calories: 2100, proteinG: 90, fatG: 70, carbsG: 260 },
};
