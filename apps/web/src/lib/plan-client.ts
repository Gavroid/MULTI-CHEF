// plan-client — typed fetch wrappers for the weekly plan (MC-055).
//
// createMealPlan → POST /api/v1/meal-plans (202 + {jobId}).
// getJob → GET /api/v1/jobs/:id (progress mirror).
// getActivePlan → GET /api/v1/meal-plans/active (Zod-validated).

import {
  ActivePlanDtoSchema,
  JobDtoSchema,
  type ActivePlanDto,
  type JobDto,
  type MealPlanSetupDto,
} from '@multichef/contracts';
import { type ApiResponse, request } from './auth-client';
import { getApiBaseUrl } from './env';

export interface PlanClientDeps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function base(deps?: PlanClientDeps): string {
  return deps?.baseUrl ?? getApiBaseUrl();
}

export async function createMealPlan(
  setup: Partial<MealPlanSetupDto>,
  deps: PlanClientDeps = {},
): Promise<ApiResponse<{ jobId: string; deduplicated: boolean }>> {
  return request<{ jobId: string; deduplicated: boolean }>(
    `${base(deps)}/api/v1/meal-plans`,
    'POST',
    setup,
    {},
  );
}

export async function getJob(
  jobId: string,
  deps: PlanClientDeps = {},
): Promise<ApiResponse<JobDto>> {
  const result = await request<unknown>(
    `${base(deps)}/api/v1/jobs/${encodeURIComponent(jobId)}`,
    'GET',
    undefined,
    {},
  );
  if (result.error) return result;
  const parsed = JobDtoSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      error: { status: 502, error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился' } },
    };
  }
  return { data: parsed.data };
}

export async function getActivePlan(
  deps: PlanClientDeps = {},
): Promise<ApiResponse<ActivePlanDto | null>> {
  const result = await request<unknown>(
    `${base(deps)}/api/v1/meal-plans/active`,
    'GET',
    undefined,
    {},
  );
  if (result.error) return result;
  if (result.data == null) return { data: null };
  const parsed = ActivePlanDtoSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      error: { status: 502, error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился' } },
    };
  }
  return { data: parsed.data };
}
