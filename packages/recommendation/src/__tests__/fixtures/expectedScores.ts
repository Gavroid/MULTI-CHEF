// MC-032/MC-040 — FIXED expectations (anti-regression). Recompute with
// `pnpm exec tsx scripts/expected-scores.ts` and justify any change in
// the PR (TESTING-STRATEGY §2). MC-040 justification: noveltyScore (8th
// factor, weight 0.05 taken from varietyScore 0.05→0.00) changed all
// totals by ≤ 0.05; top-3 ordering unchanged in all 3 scenarios.

import type { GenerationContext, Recipe } from '../../types.js';
import { CATALOG } from './catalog.js';
import { CTX_A, CTX_B, CTX_C } from './contexts.js';

export interface ExpectedScenario {
  /** Human-readable description (shown in assertion failures). */
  description: string;
  ctx: GenerationContext;
  /** Top-3 recipe ids in ranked order. */
  top3Ids: [string, string, string];
  /** Exact expected score of top3Ids[i] (tolerance 1e-4 in tests). */
  top3Scores: [number, number, number];
}

export const SCENARIO_A: ExpectedScenario = {
  description: 'полный pantry, без ограничений',
  ctx: CTX_A,
  top3Ids: ['r_pasta_grib', 'r_omelet', 'r_beutel_nuts'],
  top3Scores: [0.85, 0.5, 0.45],
};

export const SCENARIO_B: ExpectedScenario = {
  description: 'пустой pantry, бюджет NOTHING, лимит 30 мин',
  ctx: CTX_B,
  top3Ids: ['r_omelet', 'r_micro_oat', 'r_salad_tomato'],
  top3Scores: [0.5, 0.45, 0.45],
};

export const SCENARIO_C: ExpectedScenario = {
  description: 'срочные продукты, история 7 дней, цели по КБЖУ',
  ctx: CTX_C,
  top3Ids: ['r_salad_tomato', 'r_chicken_oven', 'r_beutel_nuts'],
  top3Scores: [0.740476, 0.633214, 0.516429],
};

/** All catalog recipes (re-export for tests). */
export const CATALOG_RECIPES: Recipe[] = CATALOG;
