// MC-033 — Zod → JSON-Schema for Swagger extra models (QA blocker #2).
//
// Nest Swagger documents OpenAPI schemas; our wire types are Zod. This
// module converts the public contracts once at import time so
// apps/api can register them via SwaggerModule's extraModels /
// addSchema without hand-writing OpenAPI objects.

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import {
  ListRecipesQuerySchema,
  PaginatedRecipesSchema,
  RecipeDtoSchema,
  RecipeDetailDtoSchema,
} from './recipes.js';
import { TodayRecommendationDtoSchema, TodayRequestDtoSchema } from './recommendations.js';
import { RescueRequestDtoSchema, RescueResponseDtoSchema } from './rescue.js';
import {
  RouletteDrawRequestDtoSchema,
  RouletteDrawResponseDtoSchema,
  RouletteRejectResponseDtoSchema,
} from './roulette.js';
import { JobDtoSchema } from './jobs.js';
import { MealPlanSetupDtoSchema as MealPlanSetupWire } from './meal-plans.js';
import { z } from 'zod';

// T34-A (audit round 34): недостающие wire-схемы — компактные версии
// публичных DTO (поля, приходящие в ответах API).
const NutritionProfileDtoSchema = z.object({
  userId: z.string(),
  targetCalories: z.number().int().nullable().optional(),
  targetProteinG: z.number().int().nullable().optional(),
  targetFatG: z.number().int().nullable().optional(),
  targetCarbsG: z.number().int().nullable().optional(),
  mealsPerDay: z.number().int(),
  preferredPrepMinutes: z.number().int(),
  skillLevel: z.enum(['BEGINNER', 'CONFIDENT', 'EXPERIMENTER']),
  appliances: z.array(z.string()),
  dietType: z.enum(['NONE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN']),
  activityNotes: z.string().nullable().optional(),
});
const PreferenceDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['LOVE', 'DISLIKE', 'ALLERGY', 'EXCLUDE']),
  ingredientId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
const PantryItemDtoSchema = z.object({
  id: z.string(),
  ingredientId: z.string(),
  name: z.string().nullable(),
  quantity: z.number(),
  unit: z.string(),
  estimatedGrams: z.number(),
  amountStatus: z.enum(['CRITICAL', 'LOW', 'ENOUGH', 'PLENTY']),
  priority: z.enum(['NORMAL', 'USE_FIRST']),
  storageLocation: z.enum(['FRIDGE', 'FREEZER', 'PANTRY']),
  opened: z.boolean(),
  expiresAt: z.string().nullable(),
  notes: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
const ShoppingListDtoSchema = z.object({
  id: z.string(),
  status: z.enum(['ACTIVE', 'COMPLETED']),
  estimatedTotalKopecks: z.number().int(),
  items: z.array(
    z.object({
      id: z.string(),
      ingredientId: z.string(),
      name: z.string().nullable(),
      requiredGrams: z.number(),
      packageQuantity: z.number(),
      packageSize: z.number(),
      estimatedPriceKopecks: z.number().nullable(),
      purchased: z.boolean(),
    }),
  ),
});
const MealPlanSetupWireSchema = z.object({
  days: z.number().int().min(1).max(7).optional(),
  peopleCount: z.number().int().min(1).max(12).optional(),
  startDate: z.string().optional(),
  maxMinutes: z.number().optional(),
  budgetMode: z.enum(['NORMAL', 'SAVER']).optional(),
  targetBudgetKopecks: z.number().int().optional(),
  antiFilters: z.array(z.string()).optional(),
  generationSettings: z.record(z.unknown()).optional(),
});
const ErrorEnvelopeSchema = z.object({
  status: z.number().int(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).nullable().optional(),
    requestId: z.string().optional(),
  }),
});

// Bypass deep Zod inference (TS2589) by typing the parameter as ZodTypeAny.
// zod-to-json-schema v3 accepts any zod schema; the concrete ZodObject /
// ZodDiscriminatedUnion we pass has too many nested fields for TS to infer
// through, so we explicitly erase the type at the boundary.
function toSwagger(name: string, schema: ZodTypeAny): Record<string, unknown> {
  // Deep cast through unknown + never: zod-to-json-schema's parameter type
  // is a discriminated union over every ZodType variant, which TS cannot
  // resolve for our concrete ZodObject/ZodDiscriminatedUnion schemas
  // (TS2589 «Type instantiation is excessively deep»). Cast at the call
  // site to bypass inference — runtime behaviour is unaffected.
  const json = zodToJsonSchema(schema as never, { name, target: 'openApi3' }) as Record<
    string,
    unknown
  >;
  // zodToJsonSchema returns a $ref root pointing at definitions[name];
  // unwrap it so the result IS the named schema body.
  const defs = json['definitions'] as Record<string, Record<string, unknown>> | undefined;
  const body = defs?.[name];
  return body ?? json;
}

export const swaggerSchemas = {
  ListRecipesQuery: toSwagger('ListRecipesQuery', ListRecipesQuerySchema as ZodTypeAny),
  PaginatedRecipes: toSwagger('PaginatedRecipes', PaginatedRecipesSchema as ZodTypeAny),
  RecipeDto: toSwagger('RecipeDto', RecipeDtoSchema as ZodTypeAny),
  RecipeDetailDto: toSwagger('RecipeDetailDto', RecipeDetailDtoSchema as ZodTypeAny),
  TodayRequestDto: toSwagger('TodayRequestDto', TodayRequestDtoSchema as ZodTypeAny),
  TodayRecommendationDto: toSwagger(
    'TodayRecommendationDto',
    TodayRecommendationDtoSchema as ZodTypeAny,
  ),
  RescueRequestDto: toSwagger('RescueRequestDto', RescueRequestDtoSchema as ZodTypeAny),
  RescueResponseDto: toSwagger('RescueResponseDto', RescueResponseDtoSchema as ZodTypeAny),
  RouletteDrawRequestDto: toSwagger(
    'RouletteDrawRequestDto',
    RouletteDrawRequestDtoSchema as ZodTypeAny,
  ),
  RouletteDrawResponseDto: toSwagger(
    'RouletteDrawResponseDto',
    RouletteDrawResponseDtoSchema as ZodTypeAny,
  ),
  RouletteRejectResponseDto: toSwagger(
    'RouletteRejectResponseDto',
    RouletteRejectResponseDtoSchema as ZodTypeAny,
  ),
  JobDto: toSwagger('JobDto', JobDtoSchema as ZodTypeAny),
  MealPlanSetupDto: toSwagger('MealPlanSetupDto', MealPlanSetupWireSchema as ZodTypeAny),
  PantryItemDto: toSwagger('PantryItemDto', PantryItemDtoSchema as ZodTypeAny),
  ShoppingListDto: toSwagger('ShoppingListDto', ShoppingListDtoSchema as ZodTypeAny),
  ErrorEnvelope: toSwagger('ErrorEnvelope', ErrorEnvelopeSchema as ZodTypeAny),
  NutritionProfileDto: toSwagger('NutritionProfileDto', NutritionProfileDtoSchema as ZodTypeAny),
  PreferenceDto: toSwagger('PreferenceDto', PreferenceDtoSchema as ZodTypeAny),
} as const;
