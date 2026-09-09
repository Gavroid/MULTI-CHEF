// MC-021 — Catalog endpoint schemas.
//
// Query params are zod-validated INSIDE the controller (no global
// Query pipe). All fields optional with defaults; numeric values
// arrive as strings so we use `z.coerce.number()`.
//
// Public surface (per PRD §4.3 + ADR-0007):
//   GET /api/v1/ingredients                ?q=&category=&limit=&offset=&sort=&order=
//   GET /api/v1/ingredients/:id
//   GET /api/v1/ingredients/categories
//   GET /api/v1/ingredients/:id/nutrition
//
// No DTO classes are exported (no @Body() decorator); the controller
// validates manually so we don't need a `createZodDto` shim for
// query params. NestJS's URL param validation uses a dedicated
// `zodParams` schema.

import { z } from 'zod';

// ULID regex from docs/api/conventions.md §6 — 26 chars from the
// Crockford Base32 alphabet (minus I/L/O/U which the PRD excludes).
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// Sort enum — note the schema (MC-003) has NO `createdAt` column on
// `Ingredient` and no `slug` on `IngredientCategory`. The task spec
// asked for `createdAt` and a `slug` filter; we honour the schema.
// PM-prompt rule #6: bug in PRD/task-spec vs schema → flag in report
// (see MC-021 report). Recipes/pantry lists still sort by `canonicalName`
// or `avgPriceKopecks` and category is filtered by display `name`.
export const IngredientSortField = ['canonicalName', 'avgPriceKopecks'] as const;
export const IngredientSortOrder = ['asc', 'desc'] as const;

export const IngredientsQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1, 'q must not be empty')
      .max(100, 'q must be at most 100 characters')
      .optional(),
    category: z
      .string()
      .trim()
      .min(1, 'category must not be empty')
      .max(50, 'category must be at most 50 characters')
      .optional(),
    limit: z.coerce
      .number()
      .int('limit must be an integer')
      .min(1, 'limit must be ≥ 1')
      .max(100, 'limit must be ≤ 100')
      .default(50),
    offset: z.coerce.number().int('offset must be an integer').min(0).default(0),
    sort: z.enum(IngredientSortField).default('canonicalName'),
    order: z.enum(IngredientSortOrder).default('asc'),
  })
  .strict();

export type IngredientsQuery = z.infer<typeof IngredientsQuerySchema>;

// :id path param — accept any non-empty string at the schema level;
// the controller routes by ULID-style validation.
export const IngredientsIdParamsSchema = z
  .object({
    id: z.string().min(1, 'id is required'),
  })
  .strict();

export type IngredientsIdParams = z.infer<typeof IngredientsIdParamsSchema>;

// :id/nutrition path param — ULID strictly (we use it as PK lookup
// for the 1:1 IngredientNutrition row).
export const IngredientsNutritionParamsSchema = z
  .object({
    id: z.string().regex(ULID, 'id must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)'),
  })
  .strict();

export type IngredientsNutritionParams = z.infer<typeof IngredientsNutritionParamsSchema>;

// Optional id param for /categories?id=… — currently unused by the
// controller (kept for future per-id resolution if we drop /:id in
// favour of a query filter).
export const IngredientsCategoryQuerySchema = z
  .object({
    id: z.string().min(1).optional(),
  })
  .strict();

export type IngredientsCategoryQuery = z.infer<typeof IngredientsCategoryQuerySchema>;
