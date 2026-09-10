// MC-032 — preferenceMatch factor (weight 0.10).
//
// LOVE hits raise the score, DISLIKE hits lower it:
//   value = (LOVE/n − DISLIKE/n + 1) / 2, clamped to [0, 1].
// A recipe with no preference-tagged ingredients lands at neutral 0.5.
// ALLERGY/EXCLUDE are already handled by the hard filter.

import { clamp01 } from '../weights.js';
import type { GenerationContext, Recipe } from '../../types.js';

export function preferenceMatch(recipe: Recipe, ctx: GenerationContext): number {
  const love = new Set(
    ctx.preferences.preferences.filter((p) => p.kind === 'LOVE').map((p) => p.ingredientId),
  );
  const dislike = new Set(
    ctx.preferences.preferences.filter((p) => p.kind === 'DISLIKE').map((p) => p.ingredientId),
  );

  if (love.size === 0 && dislike.size === 0) return 0.5;

  let loveHits = 0;
  let dislikeHits = 0;
  for (const ing of recipe.ingredients) {
    if (love.has(ing.ingredientId)) loveHits += 1;
    if (dislike.has(ing.ingredientId)) dislikeHits += 1;
  }

  const total = loveHits + dislikeHits;
  if (total === 0) return 0.5;

  return clamp01((loveHits / total - dislikeHits / total + 1) / 2);
}
