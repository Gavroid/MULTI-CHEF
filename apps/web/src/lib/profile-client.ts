// profile-client — typed fetch wrappers for /api/v1/profile and
// /api/v1/household (R17-WP3).
//
// Pattern follows recommendations-client: shared `@multichef/contracts`
// schemas do response validation; DTO bodies are built from the same
// schemas. test seam: `fetchImpl` swaps globalThis.fetch for the
// duration of one call and restores even on throw.

import {
  HouseholdDtoSchema,
  HouseholdPatchSchema,
  NutritionProfileDtoSchema,
  NutritionPutSchema,
  type HouseholdDto,
  type HouseholdPatchDto,
  type NutritionProfileDto,
  type NutritionPutDto,
  PreferenceDtoSchema,
  type PreferenceDto,
} from '@multichef/contracts';
import { z } from 'zod';
import { type ApiResponse, type ErrorEnvelope, request } from './auth-client';
import { getApiBaseUrl } from './env';

export interface ProfileClientDeps {
  baseUrl?: string;
  /** Test seam: replaces globalThis.fetch inside request(). */
  fetchImpl?: typeof fetch;
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

function withFetchSwap<T>(deps: ProfileClientDeps, fn: () => Promise<T>): Promise<T> {
  if (!deps.fetchImpl) return fn();
  const g = globalThis as unknown as Record<string, unknown>;
  const original = g['fetch'];
  g['fetch'] = deps.fetchImpl;
  try {
    return fn();
  } finally {
    g['fetch'] = original;
  }
}

// ─────────────────────────────────────────────────────────────────
// /api/v1/profile/nutrition
// ─────────────────────────────────────────────────────────────────

/** GET /api/v1/profile/nutrition — current user's NutritionProfile (or null). */
export async function getNutrition(
  deps: ProfileClientDeps = {},
  options: { signal?: AbortSignal } = {},
): Promise<ApiResponse<NutritionProfileDto | null>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  return withFetchSwap(deps, async () => {
    const res = await request<unknown | null>(
      `${base}/api/v1/profile/nutrition`,
      'GET',
      undefined,
      options.signal ? { signal: options.signal } : {},
    );
    if (res.error) return res;
    if (res.data === null) return { data: null };
    const parsed = NutritionProfileDtoSchema.safeParse(res.data);
    if (!parsed.success) return { error: contractMismatch() };
    return { data: parsed.data };
  });
}

/** PUT /api/v1/profile/nutrition — full-replace semantics. */
export async function putNutrition(
  body: NutritionPutDto,
  deps: ProfileClientDeps = {},
): Promise<ApiResponse<NutritionProfileDto>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  const validated = NutritionPutSchema.safeParse(body);
  if (!validated.success) {
    return {
      error: { status: 400, error: { code: 'VALIDATION_ERROR', message: 'Некорректные данные' } },
    };
  }
  return withFetchSwap(deps, async () => {
    const res = await request<unknown>(
      `${base}/api/v1/profile/nutrition`,
      'PUT',
      validated.data,
      {},
    );
    if (res.error) return res;
    const parsed = NutritionProfileDtoSchema.safeParse(res.data);
    if (!parsed.success) return { error: contractMismatch() };
    return { data: parsed.data };
  });
}

// ─────────────────────────────────────────────────────────────────
// /api/v1/profile/preferences
// ─────────────────────────────────────────────────────────────────

const PreferenceListSchema = z.array(PreferenceDtoSchema);

/** GET /api/v1/profile/preferences — list all preferences for the user. */
export async function listPreferences(
  deps: ProfileClientDeps = {},
  options: { signal?: AbortSignal } = {},
): Promise<ApiResponse<PreferenceDto[]>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  return withFetchSwap(deps, async () => {
    const res = await request<unknown>(
      `${base}/api/v1/profile/preferences`,
      'GET',
      undefined,
      options.signal ? { signal: options.signal } : {},
    );
    if (res.error) return res;
    const parsed = PreferenceListSchema.safeParse(res.data);
    if (!parsed.success) return { error: contractMismatch() };
    return { data: parsed.data };
  });
}

/** POST /api/v1/profile/preferences — create one preference (LOVE/DISLIKE/ALLERGY/EXCLUDE). */
export async function createPreference(
  body: { ingredientId?: string; kind: PreferenceDto['kind']; note?: string },
  deps: ProfileClientDeps = {},
): Promise<ApiResponse<PreferenceDto>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  return withFetchSwap(deps, async () => {
    const res = await request<unknown>(`${base}/api/v1/profile/preferences`, 'POST', body, {});
    if (res.error) return res;
    const parsed = PreferenceDtoSchema.safeParse(res.data);
    if (!parsed.success) return { error: contractMismatch() };
    return { data: parsed.data };
  });
}

/** DELETE /api/v1/profile/preferences/:id — remove one preference. */
export async function deletePreference(
  id: string,
  deps: ProfileClientDeps = {},
): Promise<ApiResponse<void>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  return withFetchSwap(deps, async () => {
    const res = await request<void>(
      `${base}/api/v1/profile/preferences/${encodeURIComponent(id)}`,
      'DELETE',
      undefined,
      {},
    );
    return res;
  });
}

// ─────────────────────────────────────────────────────────────────
// /api/v1/household
// ─────────────────────────────────────────────────────────────────

/** GET /api/v1/household — current user's owned household. */
export async function getHousehold(
  deps: ProfileClientDeps = {},
  options: { signal?: AbortSignal } = {},
): Promise<ApiResponse<HouseholdDto>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  return withFetchSwap(deps, async () => {
    const res = await request<unknown>(
      `${base}/api/v1/household`,
      'GET',
      undefined,
      options.signal ? { signal: options.signal } : {},
    );
    if (res.error) return res;
    const parsed = HouseholdDtoSchema.safeParse(res.data);
    if (!parsed.success) return { error: contractMismatch() };
    return { data: parsed.data };
  });
}

/** PATCH /api/v1/household — update household fields (owner-only). */
export async function patchHousehold(
  body: HouseholdPatchDto,
  deps: ProfileClientDeps = {},
): Promise<ApiResponse<HouseholdDto>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  const validated = HouseholdPatchSchema.safeParse(body);
  if (!validated.success) {
    return {
      error: { status: 400, error: { code: 'VALIDATION_ERROR', message: 'Некорректные данные' } },
    };
  }
  return withFetchSwap(deps, async () => {
    const res = await request<unknown>(`${base}/api/v1/household`, 'PATCH', validated.data, {});
    if (res.error) return res;
    const parsed = HouseholdDtoSchema.safeParse(res.data);
    if (!parsed.success) return { error: contractMismatch() };
    return { data: parsed.data };
  });
}
