// MC-040 — Zod contracts for POST /api/v1/recommendations/rescue.
//
// Rescue = «Спаси продукт» (PRD §2.3.7): given an ingredient from the
// user's pantry, return the best recipes that USE it. The response
// reuses TodayOptionDto cards plus rescue-specific usage telemetry.

import { z } from 'zod';
import { PantryUsageSchema, TodayOptionDtoSchema } from './recommendations.js';

export const RescueRequestDtoSchema = z.object({
  /** Ingredient the user wants to rescue; MUST be in the household pantry. */
  ingredientId: z.string().min(1),
  /** Optional time cap (minutes). */
  maxMinutes: z.number().int().min(5).max(360).optional(),
});
export type RescueRequestDto = z.infer<typeof RescueRequestDtoSchema>;

export const RescueResponseDtoSchema = z.object({
  // Deviation from the ADR draft (fixed length(3), recorded in the
  // decision log): the must-contain hard filter often leaves only 1–2
  // candidates, and padding with duplicates would be dishonest UX.
  // Empty catalog is a 422 EMPTY_RESCUE error, not an empty list.
  options: z.array(TodayOptionDtoSchema).min(1).max(3),
  nutritionAccuracy: z.literal('ESTIMATED'),
  generatedAt: z.string().datetime(),
  pantryUsage: PantryUsageSchema,
  /** The rescued ingredient, for the UI usage bar. */
  ingredient: z.object({
    id: z.string(),
    canonicalName: z.string(),
    totalGrams: z.number().nonnegative(),
  }),
});
export type RescueResponseDto = z.infer<typeof RescueResponseDtoSchema>;
