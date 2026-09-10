// MC-032 — Appliances filter.
//
// Every appliance the recipe REQUIRES must be present in the user's
// kitchen inventory.

import type { Filter } from './index.js';

export const appliancesFilter: Filter = (recipe, ctx) => {
  const userSet = new Set(ctx.preferences.appliances);
  const missing = recipe.requiredAppliances.find((a) => !userSet.has(a));
  return missing ? { reject: { code: 'APPLIANCE_MISSING', appliance: missing } } : true;
};
