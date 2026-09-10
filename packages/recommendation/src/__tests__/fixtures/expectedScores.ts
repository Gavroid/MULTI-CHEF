// MC-032 — FIXED expectations (anti-regression). Recompute with
// `pnpm exec tsx scripts/expected-scores.ts` and justify any change in
// the PR (TESTING-STRATEGY §2). Values were computed with the initial
// FACTOR_WEIGHTS of MC-032.

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
  top3Scores: [0.9, 0.55, 0.5],
};

export const SCENARIO_B: ExpectedScenario = {
  description: 'пустой pantry, бюджет NOTHING, лимит 30 мин',
  ctx: CTX_B,
  top3Ids: ['r_omelet', 'r_micro_oat', 'r_salad_tomato'],
  top3Scores: [0.55, 0.5, 0.5],
};

export const SCENARIO_C: ExpectedScenario = {
  description: 'срочные продукты, история 7 дней, цели по КБЖУ',
  ctx: CTX_C,
  top3Ids: ['r_salad_tomato', 'r_chicken_oven', 'r_beutel_nuts'],
  top3Scores: [0.790476, 0.683214, 0.566429],
};

/** All catalog recipes (re-export for tests). */
export const CATALOG_RECIPES: Recipe[] = CATALOG;
