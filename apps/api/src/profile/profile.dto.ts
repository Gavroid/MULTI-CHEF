// MC-011 — Profile request schemas (zod). The DTO classes that
// `nestjs-zod` needs are in `profile.dto-classes.ts`. Unit tests
// import the raw schemas to avoid pulling nestjs-zod's rxjs peer
// into the test runner.

import { z } from 'zod';

// ULID regex from docs/api/conventions.md §6 — 26 chars from the
// Crockford Base32 alphabet (minus I/L/O/U which the PRD excludes).
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const APPLIANCE_VALUES = [
  'STOVE',
  'OVEN',
  'MICROWAVE',
  'MULTICOOKER',
  'AIRFRYER',
  'BLENDER',
] as const;

export const SKILL_LEVEL_VALUES = ['BEGINNER', 'CONFIDENT', 'EXPERIMENTER'] as const;
export const DIET_TYPE_VALUES = ['NONE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN'] as const;
export const PREFERENCE_KIND_VALUES = ['LOVE', 'DISLIKE', 'ALLERGY', 'EXCLUDE'] as const;

const ulidSchema = z.string().regex(ULID, 'must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)');

export const ProfilePatchSchema = z
  .object({
    email: z.string().email().toLowerCase().optional(),
    tz: z.string().min(1).max(64).optional(),
    locale: z.string().min(2).max(16).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field must be provided',
  });
export type ProfilePatchBody = z.infer<typeof ProfilePatchSchema>;

export const NutritionPutSchema = z
  .object({
    targetCalories: z.number().int().nonnegative().optional(),
    targetProteinG: z.number().int().nonnegative().optional(),
    targetFatG: z.number().int().nonnegative().optional(),
    targetCarbsG: z.number().int().nonnegative().optional(),
    mealsPerDay: z.number().int().min(1).max(10).optional(),
    preferredPrepMinutes: z.number().int().min(5).max(480).optional(),
    skillLevel: z.enum(SKILL_LEVEL_VALUES).optional(),
    appliances: z.array(z.enum(APPLIANCE_VALUES)).min(1).optional(),
    dietType: z.enum(DIET_TYPE_VALUES).optional(),
    activityNotes: z.string().max(2000).optional(),
  })
  .strict();
export type NutritionPutBody = z.infer<typeof NutritionPutSchema>;

export const PreferenceCreateSchema = z
  .object({
    ingredientId: ulidSchema.optional(),
    kind: z.enum(PREFERENCE_KIND_VALUES),
    note: z.string().max(200).optional(),
  })
  .strict()
  .refine((v) => v.ingredientId !== undefined || (v.note !== undefined && v.note.length > 0), {
    message: 'either ingredientId or note must be provided',
  });
export type PreferenceCreateBody = z.infer<typeof PreferenceCreateSchema>;

export const OnboardingSchema = z
  .object({
    householdSize: z.number().int().min(1).max(20),
    budgetPerWeekKopecks: z.number().int().nonnegative().max(10_000_000_000),
    allergies: z.array(ulidSchema).max(50).default([]),
    likedIngredients: z.array(ulidSchema).max(50).default([]),
    dislikedIngredients: z.array(ulidSchema).max(50).default([]),
    appliances: z.array(z.enum(APPLIANCE_VALUES)).min(1).max(20),
    skillLevel: z.enum(SKILL_LEVEL_VALUES),
    typicalCookTimeMin: z.number().int().min(5).max(480),
  })
  .strict();
export type OnboardingBody = z.infer<typeof OnboardingSchema>;

export const HouseholdPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    defaultPeopleCount: z.number().int().min(1).max(20).optional(),
    budgetWeekKopecks: z.number().int().nonnegative().max(10_000_000_000).optional(),
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field must be provided',
  });
export type HouseholdPatchBody = z.infer<typeof HouseholdPatchSchema>;
