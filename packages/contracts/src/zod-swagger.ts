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
import { CreateMealPlanResponseDtoSchema, MealPlanSetupDtoSchema } from './meal-plans.js';

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
  MealPlanSetupDto: toSwagger('MealPlanSetupDto', MealPlanSetupDtoSchema as ZodTypeAny),
  CreateMealPlanResponseDto: toSwagger(
    'CreateMealPlanResponseDto',
    CreateMealPlanResponseDtoSchema as ZodTypeAny,
  ),
} as const;
