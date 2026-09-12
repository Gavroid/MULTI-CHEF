// MC-042 — pick-roulette: weighted-random card selection.
//
// PRD UC-07: the roulette is chance, not optimisation — but the draw
// is score-weighted so good options come up more often. The RNG is
// injected (pure function; tests seed it, production uses Math.random).

import type { ScoredRecipe } from '@multichef/recommendation';

/**
 * Pick one passed recipe, weighted by score. Returns null when the
 * passed list is empty (caller maps to 422).
 */
export function pickWeightedByScore(
  ranked: ScoredRecipe[],
  rng: () => number = Math.random,
): ScoredRecipe | null {
  const passed = ranked.filter((s) => s.passed);
  if (passed.length === 0) return null;
  const total = passed.reduce((sum, s) => sum + s.score, 0);
  if (total <= 0) {
    return passed[Math.floor(rng() * passed.length)] ?? passed[0] ?? null;
  }
  let roll = rng() * total;
  for (const s of passed) {
    roll -= s.score;
    if (roll <= 0) return s;
  }
  return passed[passed.length - 1] ?? null;
}
