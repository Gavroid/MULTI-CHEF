// MC-054 — ShoppingLists DTOs (re-export contracts).

import { z } from 'zod';

import {
  ApplyBudgetProposalDtoSchema,
  FitBudgetRequestDtoSchema,
  FitBudgetResponseDtoSchema,
} from '@multichef/contracts';

export { ApplyBudgetProposalDtoSchema, FitBudgetRequestDtoSchema, FitBudgetResponseDtoSchema };
export type {
  ApplyBudgetProposalDto,
  FitBudgetRequestDto,
  FitBudgetResponseDto,
} from '@multichef/contracts';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const ulidSchema = z.string().regex(ULID, 'must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)');

export const ShoppingListIdParamsSchema = z
  .object({
    id: ulidSchema,
  })
  .strict();
export type ShoppingListIdParams = z.infer<typeof ShoppingListIdParamsSchema>;

export const ShoppingListItemIdParamsSchema = z
  .object({
    itemId: ulidSchema,
  })
  .strict();
export type ShoppingListItemIdParams = z.infer<typeof ShoppingListItemIdParamsSchema>;
