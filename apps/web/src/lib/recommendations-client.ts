// recommendations-client — typed fetch wrappers for /today
// recommendations (MC-034).
//
// getRecommendationsToday: real POST /api/v1/recommendations/today
// (backend landed in MC-033) — response validated with the shared Zod
// schema from @multichef/contracts (double validation per MC-035
// red-flag #6: a breaking backend change surfaces as CONTRACT_MISMATCH
// instead of rendering garbage).
//
// acceptRecommendation: POST /api/v1/meal-plans does NOT exist until
// MC-051. Until then NEXT_PUBLIC_USE_MEALPLAN_MOCK=1 returns fake ids
// without touching the network. Production guard: in a production
// build the mock branch is unreachable by contract (flag defaults to
// 0) and logged loudly if someone flips it (red flag #5).

import { z } from 'zod';
import {
  TodayRecommendationDtoSchema,
  type TodayRequestDto,
  type TodayRecommendationDto,
} from '@multichef/contracts';
import { type ApiResponse, type ErrorEnvelope, request } from './auth-client';
import { getApiBaseUrl } from './env';

export interface GetRecommendationsDeps {
  baseUrl?: string;
  /** Test seam: replaces the global fetch inside request(). */
  fetchImpl?: typeof fetch;
}

export type GenerationSettings = NonNullable<TodayRequestDto['generationSettings']>;

/** True when the meal-plan accept flow should return mock ids (MC-051 pending). */
export function usesMealPlanMock(): boolean {
  return process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] === '1';
}

function contractMismatch(): ErrorEnvelope {
  return {
    status: 502,
    error: {
      code: 'CONTRACT_MISMATCH',
      message: 'Сервер обновился, обновите страницу',
    },
  };
}

/**
 * POST /api/v1/recommendations/today — 3 options (FROM_PANTRY /
 * BEST_MATCH / CHAIN) validated against the shared contract.
 *
 * deps.fetchImpl swaps the global fetch for tests (auth-client's
 * request() calls globalThis.fetch, which we re-point for the duration
 * of the call and always restore — even when it throws).
 */
export async function getRecommendationsToday(
  settings: GenerationSettings,
  deps: GetRecommendationsDeps = {},
  options: { signal?: AbortSignal } = {},
): Promise<ApiResponse<TodayRecommendationDto>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  const g = globalThis as unknown as Record<string, unknown>;
  const originalFetch = g['fetch'];
  if (deps.fetchImpl) g['fetch'] = deps.fetchImpl;
  try {
    const result = await request<unknown>(
      `${base}/api/v1/recommendations/today`,
      'POST',
      { generationSettings: settings },
      options.signal ? { signal: options.signal } : {},
    );
    if (result.error) return result;
    const parsed = TodayRecommendationDtoSchema.safeParse(result.data);
    if (!parsed.success) {
      return { error: contractMismatch() };
    }
    return { data: parsed.data };
  } finally {
    if (deps.fetchImpl) g['fetch'] = originalFetch;
  }
}

export interface AcceptRecommendationInput {
  recipeId: string;
  servings: number;
}

export interface AcceptRecommendationResult {
  mealPlanId: string;
  shoppingListId: string;
}

export interface AcceptRecommendationDeps {
  baseUrl?: string;
  /** Test seam: replaces the global fetch inside request(). */
  fetchImpl?: typeof fetch;
}

const AcceptRecommendationResultSchema = z.object({
  mealPlanId: z.string().min(1),
  shoppingListId: z.string().min(1),
});

/** UUID v4 with a fallback for runtimes without crypto.randomUUID. */
function mockUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

/**
 * Accept a recommendation: create a meal plan + shopping list.
 * Mocked until MC-051 lands the real POST /api/v1/meal-plans.
 */
export async function acceptRecommendation(
  input: AcceptRecommendationInput,
  deps: AcceptRecommendationDeps = {},
): Promise<ApiResponse<AcceptRecommendationResult>> {
  if (usesMealPlanMock()) {
    if (process.env['NODE_ENV'] === 'production') {
      // Red flag #5: the mock leaked into a production build. Surface it
      // loudly and keep serving the mock (better than a broken accept).
      console.error('[recommendations-client] NEXT_PUBLIC_USE_MEALPLAN_MOCK=1 in production build');
    }
    void input;
    void deps;
    return {
      data: {
        mealPlanId: `mock-plan-${mockUuid()}`,
        shoppingListId: `mock-list-${mockUuid()}`,
      },
    };
  }
  const base = deps.baseUrl ?? getApiBaseUrl();
  const g = globalThis as unknown as Record<string, unknown>;
  const originalFetch = g['fetch'];
  if (deps.fetchImpl) g['fetch'] = deps.fetchImpl;
  try {
    const result = await request<unknown>(
      `${base}/api/v1/meal-plans`,
      'POST',
      input,
      {},
    );
    if (result.error) return result;
    const parsed = AcceptRecommendationResultSchema.safeParse(result.data);
    if (!parsed.success) {
      return { error: contractMismatch() };
    }
    return { data: parsed.data };
  } finally {
    if (deps.fetchImpl) g['fetch'] = originalFetch;
  }
}
