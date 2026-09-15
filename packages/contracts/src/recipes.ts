// MC-033 — Zod contracts for the public recipe catalog endpoints.
//
// These schemas are the single source of truth for the wire format of
// GET /api/v1/recipes and GET /api/v1/recipes/:id. The API maps Prisma
// rows into these shapes; the web client (MC-034) validates with the
// same schemas.

import { z } from 'zod';

export const MealTypeSchema = z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);
export type MealType = z.infer<typeof MealTypeSchema>;

export const StorageMethodSchema = z.enum([
  'FREEZE_OK',
  'FRIDGE_ONLY',
  'PARTIAL_PREP',
  'NO_PREP',
  'ADD_BEFORE_SERVING',
]);
export type StorageMethod = z.infer<typeof StorageMethodSchema>;

export const ListRecipesQuerySchema = z.object({
  mealType: MealTypeSchema.optional(),
  maxMinutes: z.coerce.number().int().min(1).max(360).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListRecipesQuery = z.infer<typeof ListRecipesQuerySchema>;

export const RecipeDtoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  // T54-B (audit round 54, P1): только внутренние пути сид-хранилища.
  // Запрещает data:/http(s)/SVG-инъекции через src у <img>.
  imageKey: z
    .string()
    .regex(/^\/images\/recipes\/[a-z0-9-]+\.webp$/)
    .nullable(),
  servings: z.number().int().positive(),
  prepMinutes: z.number().int().nonnegative(),
  cookMinutes: z.number().int().nonnegative(),
  difficulty: z.number().int().min(1).max(3),
  mealTypes: z.array(MealTypeSchema),
  tags: z.array(z.string()),
  requiredAppliances: z.array(z.string()),
  // PR#1 extension: recipe-level chain links; optional so older payloads
  // (pre-MC-033 cache entries) still parse. Absent ≡ empty.
  chainTags: z.array(z.string()).optional(),
});
export type RecipeDto = z.infer<typeof RecipeDtoSchema>;

export const RecipeIngredientDtoSchema = z.object({
  ingredientId: z.string().min(1),
  canonicalName: z.string().min(1),
  grams: z.number().nonnegative(),
  optional: z.boolean(),
  substitutesFor: z.string().nullable(),
});
export type RecipeIngredientDto = z.infer<typeof RecipeIngredientDtoSchema>;

export const RecipeInstructionStepDtoSchema = z.object({
  order: z.number().int(),
  text: z.string(),
  timerMinutes: z.number().nullable(),
});
export type RecipeInstructionStepDto = z.infer<typeof RecipeInstructionStepDtoSchema>;

export const RecipeNutritionDtoSchema = z.object({
  servingCalories: z.number().nonnegative(),
  servingProteinG: z.number().nonnegative(),
  servingFatG: z.number().nonnegative(),
  servingCarbsG: z.number().nonnegative(),
  servingGrams: z.number().nonnegative(),
  calculationVersion: z.number().int(),
});
export type RecipeNutritionDto = z.infer<typeof RecipeNutritionDtoSchema>;

export const StorageRuleDtoSchema = z.object({
  storageMethod: StorageMethodSchema,
  maxHoursFridge: z.number().int().nullable(),
  maxDaysFreezer: z.number().int().nullable(),
  freezingAllowed: z.boolean(),
  partialPrepAllowed: z.boolean(),
  addBeforeServing: z.array(z.string()),
});
export type StorageRuleDto = z.infer<typeof StorageRuleDtoSchema>;

export const RecipeDetailDtoSchema = RecipeDtoSchema.extend({
  instructions: z.array(RecipeInstructionStepDtoSchema),
  ingredients: z.array(RecipeIngredientDtoSchema),
  nutrition: RecipeNutritionDtoSchema,
  storageRules: z.array(StorageRuleDtoSchema),
});
export type RecipeDetailDto = z.infer<typeof RecipeDetailDtoSchema>;

export const PaginatedRecipesSchema = z.object({
  items: z.array(RecipeDtoSchema),
  nextCursor: z.string().nullable(),
});
export type PaginatedRecipes = z.infer<typeof PaginatedRecipesSchema>;
