// prep-client — typed fetch wrappers for prep sessions + storage (MC-062).

import {
  PrepSessionDtoSchema,
  StoragePlanDtoSchema,
  type PrepIntensity,
  type PrepSessionDto,
  type StoragePlanDto,
} from '@multichef/contracts';
import { type ApiResponse, request } from './auth-client';
import { getApiBaseUrl } from './env';

export interface PrepClientDeps {
  baseUrl?: string;
}

function base(deps?: PrepClientDeps): string {
  return deps?.baseUrl ?? getApiBaseUrl();
}

export async function generatePrepSession(
  intensity: PrepIntensity,
  deps: PrepClientDeps = {},
): Promise<ApiResponse<PrepSessionDto>> {
  const result = await request<unknown>(
    `${base(deps)}/api/v1/meal-plans/active/prep`,
    'POST',
    { intensity },
    {},
  );
  if (result.error) return result;
  const parsed = PrepSessionDtoSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      error: { status: 502, error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился' } },
    };
  }
  return { data: parsed.data };
}

export async function togglePrepTask(
  taskId: string,
  done: boolean,
  deps: PrepClientDeps = {},
): Promise<ApiResponse<{ done: boolean }>> {
  return request<{ done: boolean }>(
    `${base(deps)}/api/v1/meal-plans/prep-tasks/${encodeURIComponent(taskId)}`,
    'PATCH',
    { done },
    {},
  );
}

export async function getStoragePlan(
  deps: PrepClientDeps = {},
): Promise<ApiResponse<StoragePlanDto>> {
  const result = await request<unknown>(
    `${base(deps)}/api/v1/meal-plans/active/storage`,
    'GET',
    undefined,
    {},
  );
  if (result.error) return result;
  const parsed = StoragePlanDtoSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      error: { status: 502, error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился' } },
    };
  }
  return { data: parsed.data };
}
