// household-client — typed fetch wrapper for the household (audit
// round-5): /today reads the weekly budget from Household.budgetWeekKopecks
// (filled by onboarding registration or PATCH /household).

import { z } from 'zod';
import { type ApiResponse, request } from './auth-client';
import { getApiBaseUrl } from './env';

const HouseholdSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  defaultPeopleCount: z.coerce.number().int(),
  budgetWeekKopecks: z.number().int().nullable().optional(),
});

export type HouseholdDto = z.infer<typeof HouseholdSchema>;

export interface HouseholdClientDeps {
  baseUrl?: string;
}

export async function getHousehold(
  deps: HouseholdClientDeps = {},
): Promise<ApiResponse<HouseholdDto>> {
  const base = deps.baseUrl ?? getApiBaseUrl();
  const result = await request<unknown>(`${base}/api/v1/household`, 'GET', undefined, {});
  if (result.error) return result;
  const parsed = HouseholdSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      error: { status: 502, error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился' } },
    };
  }
  return { data: parsed.data };
}

/** PATCH /household — owner-only (audit round-5 helper for future UI). */
export async function patchHousehold(
  patch: { name?: string; defaultPeopleCount?: number; budgetWeekKopecks?: number },
  deps: HouseholdClientDeps = {},
): Promise<ApiResponse<HouseholdDto>> {
  const result = await request<unknown>(
    `${deps.baseUrl ?? getApiBaseUrl()}/api/v1/household`,
    'PATCH',
    patch,
    {},
  );
  if (result.error) return result;
  const parsed = HouseholdSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      error: { status: 502, error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился' } },
    };
  }
  return { data: parsed.data };
}
