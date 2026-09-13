// MC-032 — Appliances filter.
//
// Every appliance the recipe REQUIRES must be present in the user's
// kitchen inventory.

import type { Filter } from './index.js';

export const appliancesFilter: Filter = (recipe, ctx) => {
  // Audit round-4 (manager decision): an EMPTY appliance inventory means
  // the user has not completed onboarding yet — treating that as «no
  // appliances at all» collapses the catalogue for every new user.
  // Until they configure their kitchen we do not filter by appliances.
  if (ctx.preferences.appliances.length === 0) return true;
  const userSet = new Set(ctx.preferences.appliances);
  const missing = recipe.requiredAppliances.find((a) => !userSet.has(a));
  return missing ? { reject: { code: 'APPLIANCE_MISSING', appliance: missing } } : true;
};
