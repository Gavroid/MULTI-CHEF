// MC-054 — Zod contracts for the shopping-list budget-fit endpoints.

import { z } from 'zod';

export const FitBudgetRequestDtoSchema = z.object({
  /** Budget cap in KOPECKS. */
  targetBudgetKopecks: z.number().int().min(0),
});
export type FitBudgetRequestDto = z.infer<typeof FitBudgetRequestDtoSchema>;

export const BudgetProposalKindSchema = z.enum(['SUBSTITUTE', 'DROP_OPTIONAL', 'MERGE_MEALS']);
export type BudgetProposalKind = z.infer<typeof BudgetProposalKindSchema>;

export const BudgetProposalDtoSchema = z.object({
  kind: BudgetProposalKindSchema,
  ingredientId: z.string().min(1).nullable().optional(),
  substituteIngredientId: z.string().min(1).nullable().optional(),
  savingKopecks: z.number().int().min(0),
  unavailableReason: z.string().nullable().optional(),
});
export type BudgetProposalDto = z.infer<typeof BudgetProposalDtoSchema>;

export const FitBudgetResponseDtoSchema = z.object({
  proposals: z.array(BudgetProposalDtoSchema),
  totalPossibleSavings: z.number().int().min(0),
  achievable: z.boolean(),
  currentTotalKopecks: z.number().int().min(0),
  minimalTotalKopecks: z.number().int().min(0),
});
export type FitBudgetResponseDto = z.infer<typeof FitBudgetResponseDtoSchema>;

export const ApplyBudgetProposalDtoSchema = z.object({
  kind: z.enum(['SUBSTITUTE', 'DROP_OPTIONAL']),
  ingredientId: z.string().min(1),
  substituteIngredientId: z.string().min(1).optional(),
});
export type ApplyBudgetProposalDto = z.infer<typeof ApplyBudgetProposalDtoSchema>;
