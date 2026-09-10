// MC-033 — Zod → JSON-Schema for Swagger extra models (QA blocker #2).
//
// Nest Swagger documents OpenAPI schemas; our wire types are Zod. This
// module converts the public contracts once at import time so
// apps/api can register them via SwaggerModule's extraModels /
// addSchema without hand-writing OpenAPI objects.

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ListRecipesQuerySchema,
  PaginatedRecipesSchema,
  RecipeDtoSchema,
  RecipeDetailDtoSchema,
} from './recipes.js';
import { TodayRecommendationDtoSchema, TodayRequestDtoSchema } from './recommendations.js';

function toSwagger(
  name: string,
  schema: Parameters<typeof zodToJsonSchema>[0],
): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { name, target: 'openApi3' }) as Record<string, unknown>;
  // zodToJsonSchema returns a $ref root pointing at definitions[name];
  // unwrap it so the result IS the named schema body.
  const defs = json['definitions'] as Record<string, Record<string, unknown>> | undefined;
  const body = defs?.[name];
  return body ?? json;
}

export const swaggerSchemas = {
  ListRecipesQuery: toSwagger('ListRecipesQuery', ListRecipesQuerySchema),
  PaginatedRecipes: toSwagger('PaginatedRecipes', PaginatedRecipesSchema),
  RecipeDto: toSwagger('RecipeDto', RecipeDtoSchema),
  RecipeDetailDto: toSwagger('RecipeDetailDto', RecipeDetailDtoSchema),
  TodayRequestDto: toSwagger('TodayRequestDto', TodayRequestDtoSchema),
  TodayRecommendationDto: toSwagger('TodayRecommendationDto', TodayRecommendationDtoSchema),
} as const;
