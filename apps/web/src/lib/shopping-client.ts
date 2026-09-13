// shopping-client — typed fetch wrappers for the shopping list (MC-056).

import { z } from 'zod';
import type { ApplyBudgetProposalDto, FitBudgetResponseDto } from '@multichef/contracts';
import { type ApiResponse, request } from './auth-client';
import { getApiBaseUrl } from './env';

export interface PlanClientDeps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function base(deps?: PlanClientDeps): string {
  return deps?.baseUrl ?? getApiBaseUrl();
}

const ItemSchema = z.object({
  id: z.string(),
  ingredientId: z.string(),
  /** Catalogue name (audit fix — UI must not render raw ids). */
  name: z.string().nullable().optional(),
  requiredGrams: z.coerce.number(),
  packageQuantity: z.coerce.number(),
  packageSize: z.coerce.number(),
  estimatedPriceKopecks: z.number().int().nullable(),
  utilityScore: z.number().int().nullable(),
  purchased: z.boolean(),
  categoryId: z.string(),
  sortOrder: z.number().int(),
});

const ListSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  mealPlanId: z.string().nullable(),
  estimatedTotalKopecks: z.number().int(),
  budgetLimitKopecks: z.number().int().nullable(),
  status: z.string(),
  items: z.array(ItemSchema),
});
export type ShoppingListDto = z.infer<typeof ListSchema>;
export type ShoppingItemDto = z.infer<typeof ItemSchema>;

export async function getActiveShoppingList(
  deps: PlanClientDeps = {},
): Promise<ApiResponse<ShoppingListDto | null>> {
  const result = await request<unknown>(
    `${base(deps)}/api/v1/shopping-lists/active`,
    'GET',
    undefined,
    {},
  );
  if (result.error) return result;
  if (result.data == null) return { data: null };
  const parsed = ListSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      error: { status: 502, error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился' } },
    };
  }
  return { data: parsed.data };
}

export async function setItemPurchased(
  itemId: string,
  purchased: boolean,
  deps: PlanClientDeps = {},
): Promise<ApiResponse<{ purchased: boolean }>> {
  return request<{ purchased: boolean }>(
    `${base(deps)}/api/v1/shopping-lists/items/${encodeURIComponent(itemId)}`,
    'PATCH',
    { purchased },
    {},
  );
}

export async function completeList(
  listId: string,
  deps: PlanClientDeps = {},
): Promise<ApiResponse<{ completed: boolean; pantryItemsTouched: number }>> {
  return request<{ completed: boolean; pantryItemsTouched: number }>(
    `${base(deps)}/api/v1/shopping-lists/${encodeURIComponent(listId)}/complete`,
    'POST',
    {},
    {},
  );
}

export async function fitBudget(
  listId: string,
  targetBudgetKopecks: number,
  deps: PlanClientDeps = {},
): Promise<ApiResponse<FitBudgetResponseDto>> {
  return request<FitBudgetResponseDto>(
    `${base(deps)}/api/v1/shopping-lists/${encodeURIComponent(listId)}/fit-budget`,
    'POST',
    { targetBudgetKopecks },
    {},
  );
}

export async function applyBudgetProposal(
  listId: string,
  proposal: ApplyBudgetProposalDto,
  deps: PlanClientDeps = {},
): Promise<ApiResponse<{ applied: boolean; estimatedTotalKopecks: number }>> {
  return request<{ applied: boolean; estimatedTotalKopecks: number }>(
    `${base(deps)}/api/v1/shopping-lists/${encodeURIComponent(listId)}/apply-proposal`,
    'POST',
    proposal,
    {},
  );
}
