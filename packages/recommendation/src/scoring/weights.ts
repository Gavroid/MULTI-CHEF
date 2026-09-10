// MC-032 — Factor weights (single source of truth, PRD §3.5).
//
// DRIFT GUARD: the sum MUST stay exactly 1.0 — verified by
// __tests__/weights.test.ts. Any change here requires updating
// __tests__/fixtures/expectedScores.ts in the same PR with justification.

export const FACTOR_WEIGHTS = {
  pantryMatch: 0.25,
  expirationBenefit: 0.2,
  budgetMatch: 0.15,
  nutritionMatch: 0.15,
  timeMatch: 0.1,
  preferenceMatch: 0.1,
  varietyScore: 0.05,
} as const;

export type FactorName = keyof typeof FACTOR_WEIGHTS;

export const FACTOR_NAMES: readonly FactorName[] = [
  'pantryMatch',
  'expirationBenefit',
  'budgetMatch',
  'nutritionMatch',
  'timeMatch',
  'preferenceMatch',
  'varietyScore',
] as const;

/** Clamp to [0, 1] — every factor value passes through this before weighting. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
