// recommendations-client — typed fetch wrappers for /today
// recommendations (MC-034).
//
// getRecommendationsToday: real POST /api/v1/recommendations/today
// (backend landed in MC-033) — response validated with the shared Zod
// schema from @multichef/contracts (double validation per MC-035
// red-flag #6: a breaking backend change surfaces as CONTRACT_MISMATCH
// instead of rendering garbage).
//
// acceptRecommendation (R20 F2, вариант b — ADR-0025): accept more
// НЕ мокается. POST /api/v1/meal-plans ставит джобу генерации плана,
// клиент поллит GET /jobs/:id до COMPLETED/FAILED и возвращает id
// активного плана (ADR: принятое блюдо отдельно не пинится — trade-off
// зафиксирован в ADR-0025).

import { z } from 'zod';
import {
  JobDtoSchema,
  TodayRecommendationDtoSchema,
  type MealPlanSetupDto,
  type TodayRequestDto,
  type TodayRecommendationDto,
  type RescueRequestDto,
  type RescueResponseDto,
  type RouletteDrawRequestDto,
  type RouletteDrawResponseDto,
  type RouletteRejectResponseDto,
  RescueResponseDtoSchema,
  RouletteDrawResponseDtoSchema,
  RouletteRejectResponseDtoSchema,
} from '@multichef/contracts';
import type { JobDto } from '@multichef/contracts';
import { type ApiResponse, type ErrorEnvelope, request } from './auth-client';
import { getApiBaseUrl } from './env';

export interface GetRecommendationsDeps {
  baseUrl?: string;
  /** Test seam: replaces the global fetch inside request(). */
  fetchImpl?: typeof fetch;
}

export type GenerationSettings = NonNullable<TodayRequestDto['generationSettings']>;

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

/**
 * POST /api/v1/recommendations/rescue (MC-040) — recipes that use a
 * pantry ingredient, ranked «очевидные → необычные», with pantryUsage.
 */
export async function getRescueRecommendations(
  input: RescueRequestDto,
  deps: GetRecommendationsDeps = {},
  options: { signal?: AbortSignal } = {},
): Promise<ApiResponse<RescueResponseDto>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  const g = globalThis as unknown as Record<string, unknown>;
  const originalFetch = g['fetch'];
  if (deps.fetchImpl) g['fetch'] = deps.fetchImpl;
  try {
    const result = await request<unknown>(
      `${base}/api/v1/recommendations/rescue`,
      'POST',
      input,
      options.signal ? { signal: options.signal } : {},
    );
    if (result.error) return result;
    const parsed = RescueResponseDtoSchema.safeParse(result.data);
    if (!parsed.success) {
      return { error: contractMismatch() };
    }
    return { data: parsed.data };
  } finally {
    if (deps.fetchImpl) g['fetch'] = originalFetch;
  }
}

/** POST /recommendations/roulette/draw (MC-042) — one weighted card. */
export async function drawRoulette(
  input: RouletteDrawRequestDto,
  deps: GetRecommendationsDeps = {},
): Promise<ApiResponse<RouletteDrawResponseDto>> {
  return postAndValidate<RouletteDrawResponseDto>(
    `${deps.baseUrl ?? getApiBaseUrl()}/api/v1/recommendations/roulette/draw`,
    input,
    RouletteDrawResponseDtoSchema,
    deps,
  );
}

/** POST /recommendations/roulette/reject (MC-042) — burn one reject. */
export async function rejectRoulette(
  deps: GetRecommendationsDeps = {},
): Promise<ApiResponse<RouletteRejectResponseDto>> {
  return postAndValidate<RouletteRejectResponseDto>(
    `${deps.baseUrl ?? getApiBaseUrl()}/api/v1/recommendations/roulette/reject`,
    {},
    RouletteRejectResponseDtoSchema,
    deps,
  );
}

/** Shared draw/reject plumbing: fetch → error passthrough → Zod check. */
async function postAndValidate<T>(
  url: string,
  body: unknown,
  schema: {
    safeParse: (data: unknown) => { success: true; data: T } | { success: false };
  },
  deps: GetRecommendationsDeps,
): Promise<ApiResponse<T>> {
  const g = globalThis as unknown as Record<string, unknown>;
  const originalFetch = g['fetch'];
  if (deps.fetchImpl) g['fetch'] = deps.fetchImpl;
  try {
    const result = await request<unknown>(url, 'POST', body, {});
    if (result.error) return result;
    const parsed = schema.safeParse(result.data);
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
  /**
   * R20 F2 (вариант b): план генерируется джобой из дефолтного сетаапа
   * (7 дней / 3 приёма / 2 чел.). Настройки визарда можно передать сюда —
   * они уйдут в POST /meal-plans как MealPlanSetupDto.
   */
  setup?: Partial<MealPlanSetupDto>;
}

export interface AcceptRecommendationResult {
  mealPlanId: string;
  /**
   * R20 (b): список покупок создаётся воркером вместе с планом; клиент
   * навигирует на /shopping (активный список читается там сам). Пустая
   * строка, когда список ещё не создан (джоба завершилась без списка).
   */
  shoppingListId: string;
}

export interface AcceptRecommendationDeps {
  baseUrl?: string;
  /** Test seam: replaces the global fetch inside request(). */
  fetchImpl?: typeof fetch;
}

const JobPollIntervalMs = 1500;
const JobPollDeadlineMs = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * R20 F2 (вариант b, ADR-0025): accept запускает генерацию плана
 * (POST /meal-plans -> 202 {jobId}), поллит GET /jobs/:id до
 * COMPLETED/FAILED и возвращает id активного плана. Мок удалён —
 * план всегда реальный.
 */
export async function acceptRecommendation(
  input: AcceptRecommendationInput,
  deps: AcceptRecommendationDeps = {},
): Promise<ApiResponse<AcceptRecommendationResult>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  const g = globalThis as unknown as Record<string, unknown>;
  const originalFetch = g['fetch'];
  if (deps.fetchImpl) g['fetch'] = deps.fetchImpl;
  try {
    const created = await request<{ jobId: string; deduplicated: boolean }>(
      `${base}/api/v1/meal-plans`,
      'POST',
      input.setup ?? {},
      {},
    );
    if (created.error) return created;
    const jobId = created.data.jobId;

    const deadline = Date.now() + JobPollDeadlineMs;
    let job: JobDto | null = null;
    while (Date.now() < deadline) {
      await sleep(JobPollIntervalMs);
      const jr = await request<unknown>(
        `${base}/api/v1/jobs/${encodeURIComponent(jobId)}`,
        'GET',
        undefined,
        {},
      );
      if (jr.error) return jr;
      const parsedJob = JobDtoSchema.safeParse(jr.data);
      if (!parsedJob.success) {
        return {
          error: {
            status: 502,
            error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился (job poll)' },
          },
        };
      }
      job = parsedJob.data;
      if (job.status === 'COMPLETED' || job.status === 'FAILED') break;
    }
    if (!job) return { error: contractMismatch() };
    if (job.status !== 'COMPLETED') {
      return {
        error: {
          status: 502,
          error: {
            code: 'JOB_FAILED',
            message: job.error ?? 'Не удалось сгенерировать план',
          },
        },
      };
    }

    const active = await request<unknown>(`${base}/api/v1/meal-plans/active`, 'GET', undefined, {});
    if (active.error) return active;
    const parsedActive = z
      .object({ id: z.string().min(1) })
      .nullable()
      .safeParse(active.data);
    if (!parsedActive.success || !parsedActive.data) {
      return {
        error: {
          status: 502,
          error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился (active plan)' },
        },
      };
    }
    return { data: { mealPlanId: parsedActive.data.id, shoppingListId: '' } };
  } finally {
    if (deps.fetchImpl) g['fetch'] = originalFetch;
  }
}
