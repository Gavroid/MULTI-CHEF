// MC-011 mirror — Profile contracts (Zod). Mirrors
// apps/api/src/profile/profile.dto.ts so the web app can validate
// requests locally before sending and re-validate responses without
// pulling the API module (which depends on Prisma + nestjs-zod).
//
// The server is the source of truth; keep these in sync when adding
// fields. R17-WP3: power the /profile/nutrition, /profile/preferences,
// and /profile/household client pages.

import { z } from 'zod';

export const APPLIANCE_VALUES = [
  'STOVE',
  'OVEN',
  'MICROWAVE',
  'MULTICOOKER',
  'AIRFRYER',
  'BLENDER',
] as const;
export type Appliance = (typeof APPLIANCE_VALUES)[number];

export const SKILL_LEVEL_VALUES = ['BEGINNER', 'CONFIDENT', 'EXPERIMENTER'] as const;
export type SkillLevel = (typeof SKILL_LEVEL_VALUES)[number];

export const DIET_TYPE_VALUES = ['NONE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN'] as const;
export type DietType = (typeof DIET_TYPE_VALUES)[number];

export const PREFERENCE_KIND_VALUES = ['LOVE', 'DISLIKE', 'ALLERGY', 'EXCLUDE'] as const;
export type PreferenceKind = (typeof PREFERENCE_KIND_VALUES)[number];

// ─────────────────────────────────────────────────────────────────
// Nutrition profile — full replace (PUT semantics).
// ─────────────────────────────────────────────────────────────────
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
export type NutritionPutDto = z.infer<typeof NutritionPutSchema>;

export const NutritionProfileDtoSchema = z.object({
  userId: z.string(),
  targetCalories: z.number().int().nullable(),
  targetProteinG: z.number().int().nullable(),
  targetFatG: z.number().int().nullable(),
  targetCarbsG: z.number().int().nullable(),
  mealsPerDay: z.number().int(),
  preferredPrepMinutes: z.number().int(),
  skillLevel: z.enum(SKILL_LEVEL_VALUES),
  appliances: z.array(z.enum(APPLIANCE_VALUES)),
  dietType: z.enum(DIET_TYPE_VALUES),
  activityNotes: z.string().nullable(),
});
export type NutritionProfileDto = z.infer<typeof NutritionProfileDtoSchema>;

// ─────────────────────────────────────────────────────────────────
// Preferences — list view (per GET /profile/preferences).
// ─────────────────────────────────────────────────────────────────
export const PreferenceDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(PREFERENCE_KIND_VALUES),
  ingredientId: z.string().nullable(),
  note: z.string().nullable(),
});
export type PreferenceDto = z.infer<typeof PreferenceDtoSchema>;

// ─────────────────────────────────────────────────────────────────
// Household (from /api/v1/household).
// ─────────────────────────────────────────────────────────────────
export const HouseholdDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  defaultPeopleCount: z.number().int().min(1).max(20),
  currency: z.string().length(3),
  budgetWeekKopecks: z.number().int().nullable(),
});
export type HouseholdDto = z.infer<typeof HouseholdDtoSchema>;

export const HouseholdPatchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    defaultPeopleCount: z.number().int().min(1).max(20).optional(),
    currency: z.string().length(3).optional(),
    budgetWeekKopecks: z.number().int().nonnegative().max(10_000_000_000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field must be provided',
  });
export type HouseholdPatchDto = z.infer<typeof HouseholdPatchSchema>;

// ─────────────────────────────────────────────────────────────────
// UI labels (single source of truth used by both /profile/nutrition
// and the wizard). Keep Russian labels; the platform default locale
// is ru per PRD §1.3.
// ─────────────────────────────────────────────────────────────────
export const APPLIANCE_LABELS: Record<Appliance, string> = {
  STOVE: 'Плита',
  OVEN: 'Духовка',
  MICROWAVE: 'Микроволновка',
  MULTICOOKER: 'Мультиварка',
  AIRFRYER: 'Аэрогриль',
  BLENDER: 'Блендер',
};

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  BEGINNER: 'Новичок',
  CONFIDENT: 'Готовлю часто',
  EXPERIMENTER: 'Экспериментатор',
};

export const DIET_TYPE_LABELS: Record<DietType, string> = {
  NONE: 'Без ограничений',
  VEGETARIAN: 'Вегетарианство',
  VEGAN: 'Веганство',
  PESCATARIAN: 'Пескетарианство',
};
