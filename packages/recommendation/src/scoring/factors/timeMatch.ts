// MC-032 — timeMatch factor (weight 0.10).
//
// Within the user's time budget → 1. Overrun shrinks the score linearly
// to 0 at double the budget (ADR §3).

import { clamp01 } from '../weights.js';
import type { GenerationContext, Recipe } from '../../types.js';

export function timeMatch(recipe: Recipe, ctx: GenerationContext): number {
  const total = recipe.prepMinutes + recipe.cookMinutes;
  const max = ctx.maxMinutes;

  if (max <= 0) return total === 0 ? 1 : 0;
  if (total <= max) return 1;

  const overrun = total - max;
  return clamp01(1 - overrun / max);
}
