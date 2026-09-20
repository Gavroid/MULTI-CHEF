// MC-033 — Zod contracts for POST /api/v1/recommendations/today.
//
// The response always contains exactly 3 options (FROM_PANTRY,
// BEST_MATCH, CHAIN); every slot is filled — missing candidates fall
// back per the MC-033 ADR (CHAIN fallback keeps type CHAIN with
// chainTag: null and empty chain).

import { z } from 'zod';
import { RecipeDtoSchema } from './recipes.js';

export const AntiFilterSchema = z.enum([
  'NO_OVEN',
  'ONE_PAN',
  'NOT_CHICKEN_AGAIN',
  'NO_LEFTOVERS',
  'NO_FRYING',
  'NO_CHOPPING',
  'SHORT_TIME',
  'NO_MULTISTEP',
]);
export type AntiFilter = z.infer<typeof AntiFilterSchema>;

export const BudgetModeSchema = z.enum(['NOTHING', 'MINIMAL', 'NORMAL']);
export type BudgetMode = z.infer<typeof BudgetModeSchema>;

export const TodayRequestDtoSchema = z.object({
  generationSettings: z
    .object({
      budgetMode: BudgetModeSchema.optional(),
      maxMinutes: z.number().int().min(5).max(360).optional(),
      antiFilters: z.array(AntiFilterSchema).max(8).optional(),
      rescueIngredientId: z.string().min(1).nullable().optional(),
    })
    .optional(),
});
export type TodayRequestDto = z.infer<typeof TodayRequestDtoSchema>;

export const TodayOptionTypeSchema = z.enum(['FROM_PANTRY', 'BEST_MATCH', 'CHAIN']);
export type TodayOptionType = z.infer<typeof TodayOptionTypeSchema>;

const TodayOptionBaseSchema = z.object({
  recipe: RecipeDtoSchema,
  score: z.number().min(0).max(1),
  explanation: z.string().min(1),
});

export const TodayOptionDtoSchema = z.discriminatedUnion('type', [
  TodayOptionBaseSchema.extend({
    type: z.literal('FROM_PANTRY'),
    toBuyCount: z.number().int().nonnegative(),
    chainTag: z.nullable(z.string()),
  }),
  TodayOptionBaseSchema.extend({
    type: z.literal('BEST_MATCH'),
  }),
  TodayOptionBaseSchema.extend({
    type: z.literal('CHAIN'),
    chainTag: z.string().nullable(),
    chain: z.array(RecipeDtoSchema),
  }),
]);
export type TodayOptionDto = z.infer<typeof TodayOptionDtoSchema>;

/** MC-040: how much of the rescued ingredient the picked recipes use. */
export const PantryUsageSchema = z.object({
  /** Grams of the ingredient used across the returned options. */
  usedGrams: z.number().nonnegative(),
  /** Current pantry stock of the ingredient. */
  totalGrams: z.number().nonnegative(),
});
export type PantryUsage = z.infer<typeof PantryUsageSchema>;

export const TodayRecommendationDtoSchema = z.object({
  options: z.array(TodayOptionDtoSchema).length(3),
  nutritionAccuracy: z.literal('ESTIMATED'),
  generatedAt: z.string().datetime(),
  // MC-040 (additive): only the rescue endpoint populates this today.
  pantryUsage: PantryUsageSchema.optional(),
});
export type TodayRecommendationDto = z.infer<typeof TodayRecommendationDtoSchema>;

// R21 (продукт-план, этап «Преображение остатков»): подобрать рецепты-
// преобразования для указанных базовых блюд (leftoverSourceOf).
export const LeftoversRequestDtoSchema = z
  .object({
    baseRecipeIds: z
      .array(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/))
      .min(1)
      .max(10),
  })
  .strict();
export type LeftoversRequestDto = z.infer<typeof LeftoversRequestDtoSchema>;

export const LeftoversOptionSchema = z.object({
  recipe: z.object({ id: z.string().min(1), title: z.string().min(1) }),
  baseRecipeId: z.string(),
});
export const LeftoversResponseDtoSchema = z.object({
  options: z.array(LeftoversOptionSchema),
});
export type LeftoversOption = z.infer<typeof LeftoversOptionSchema>;
export type LeftoversResponseDto = z.infer<typeof LeftoversResponseDtoSchema>;
