// MC-051 — Zod contracts for POST /api/v1/meal-plans (weekly plan job).
//
// The endpoint validates the setup, records the Job and enqueues it;
// the worker plans the week and the web polls GET /jobs/:id.

import { z } from 'zod';
import { AntiFilterSchema, BudgetModeSchema } from './recommendations.js';

export const RepeatPolicySchema = z.enum(['ALLOW_REPEATS', 'NO_REPEATS']);
export type RepeatPolicy = z.infer<typeof RepeatPolicySchema>;

export const MealPlanSetupDtoSchema = z.object({
  /** First day (YYYY-MM-DD); defaults to today (server clock). */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  days: z.number().int().min(1).max(14).default(7),
  mealsPerDay: z.number().int().min(1).max(4).default(3),
  peopleCount: z.number().int().min(1).max(12).default(2),
  /** 0-based day indices planned as no-cook («сборные») days. */
  noCookDays: z.array(z.number().int().min(0).max(13)).max(14).default([]),
  repeatPolicy: RepeatPolicySchema.default('ALLOW_REPEATS'),
  antiFilters: z.array(AntiFilterSchema).max(8).optional(),
  budgetMode: BudgetModeSchema.optional(),
  maxMinutes: z.number().int().min(5).max(360).optional(),
  /** Weekly budget cap in KOPECKS. */
  targetBudgetKopecks: z.number().int().min(0).optional(),
  targetDailyCalories: z.number().int().min(500).max(6000).optional(),
});
export type MealPlanSetupDto = z.infer<typeof MealPlanSetupDtoSchema>;

export const CreateMealPlanResponseDtoSchema = z.object({
  jobId: z.string().min(1),
  deduplicated: z.boolean(),
});
export type CreateMealPlanResponseDto = z.infer<typeof CreateMealPlanResponseDtoSchema>;

// R21 (продукт-план, этап 1): замена блюда в активном плане.
export const MealPlanReplaceDtoSchema = z
  .object({
    entryId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'entryId must be a ULID'),
  })
  .strict();
export type MealPlanReplaceDto = z.infer<typeof MealPlanReplaceDtoSchema>;
