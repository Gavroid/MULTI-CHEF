// MC-032 — Max-time filter (wizard `effort` budget).

import type { Filter } from './index.js';

export const maxTimeFilter: Filter = (recipe, ctx) => {
  const total = recipe.prepMinutes + recipe.cookMinutes;
  return total > ctx.maxMinutes
    ? { reject: { code: 'EXCEEDS_TIME', required: total, max: ctx.maxMinutes } }
    : true;
};
