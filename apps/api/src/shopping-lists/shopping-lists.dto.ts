// MC-054 — ShoppingLists DTOs (re-export contracts).

import { z } from 'zod';

import {
  ApplyBudgetProposalDtoSchema,
  FitBudgetRequestDtoSchema,
  FitBudgetResponseDtoSchema,
  MarkPurchasedRequestDtoSchema,
} from '@multichef/contracts';

export {
  ApplyBudgetProposalDtoSchema,
  FitBudgetRequestDtoSchema,
  FitBudgetResponseDtoSchema,
  MarkPurchasedRequestDtoSchema,
};
export type {
  ApplyBudgetProposalDto,
  FitBudgetRequestDto,
  FitBudgetResponseDto,
  MarkPurchasedRequestDto,
} from '@multichef/contracts';

// ULID остаётся каноничным форматом для сущностей, создаваемых с
// автогенерацией id; composite-схема ниже допускает оба варианта.
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- каноничный формат, см. комментарий выше
const ulidSchema = z.string().regex(ULID, 'must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)');

// PROD-001/002 fix (2026-09-30): worker создаёт списки с составными
// детерминированными id — `{planId}-list` для ShoppingList и
// `{listId}-{ingredientId}` для ShoppingListItem (plan-week.ts). Эти id
// НЕ ULID, поэтому строгие path-схемы отвергали каждый реальный запрос:
// PATCH items/:itemId (чекбокс «куплено»), POST :id/complete,
// :id/fit-budget, :id/apply-proposal — все 400 на живом проде.
// Валидируем ФОРМУ (составной id из UUID+суффиксов), существование и
// tenant-принадлежность проверяет сервис через findFirst с household-scope.
const compositeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{8,120}$/, 'must be 8-120 chars of [A-Za-z0-9-] (ULID or composite)');

export const ShoppingListIdParamsSchema = z
  .object({
    id: compositeIdSchema,
  })
  .strict();
export type ShoppingListIdParams = z.infer<typeof ShoppingListIdParamsSchema>;

export const ShoppingListItemIdParamsSchema = z
  .object({
    itemId: compositeIdSchema,
  })
  .strict();
export type ShoppingListItemIdParams = z.infer<typeof ShoppingListItemIdParamsSchema>;
