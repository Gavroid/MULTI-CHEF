// MC-033 — Recipes DTOs: Zod schemas for query validation + re-exports
// of the wire contracts (packages/contracts) for Swagger generation.

import { z } from 'zod';
import {
  ListRecipesQuerySchema,
  RecipeDetailDtoSchema,
  RecipeDtoSchema,
  PaginatedRecipesSchema,
} from '@multichef/contracts';

export { ListRecipesQuerySchema, RecipeDetailDtoSchema, RecipeDtoSchema, PaginatedRecipesSchema };
export type {
  ListRecipesQuery,
  RecipeDetailDto,
  RecipeDto,
  PaginatedRecipes,
} from '@multichef/contracts';

export const RecipeIdParamsSchema = z.object({ id: z.string().min(1).max(64) });
export type RecipeIdParams = z.infer<typeof RecipeIdParamsSchema>;

void ListRecipesQuerySchema;
