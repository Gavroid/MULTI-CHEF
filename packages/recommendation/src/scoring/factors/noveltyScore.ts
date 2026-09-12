// MC-040 — noveltyScore: the 8th scoring factor.
//
// "How unusual is this recipe?" — deterministic, tag/structure-based
// (PM-prompt #4: no ML, no LLM). Used by rescue mode to push the
// "очевидные → необычные" spread.
//
// Signal composition (clamped to [0, 1]):
// - novelty TAG present ('необычное', 'экзотика', ...) → +0.5
// - ingredient count > 8 (long ingredient list ≈ more unusual)  → +0.3
// - part of a leftover chain (chainTags non-empty)              → +0.2

import { clamp01 } from '../weights.js';
import type { Recipe, GenerationContext } from '../../types.js';

const NOVELTY_TAGS: ReadonlySet<string> = new Set([
  'необычное',
  'экзотика',
  'фьюжн',
  'молекулярная',
]);

export function noveltyScore(recipe: Recipe, _ctx: GenerationContext): number {
  const tagBonus = recipe.tags.some((t) => NOVELTY_TAGS.has(t.toLowerCase())) ? 0.5 : 0;
  const ingredientBonus = recipe.ingredients.length > 8 ? 0.3 : 0;
  const chainBonus = (recipe.chainTags?.length ?? 0) > 0 ? 0.2 : 0;
  return clamp01(tagBonus + ingredientBonus + chainBonus);
}
