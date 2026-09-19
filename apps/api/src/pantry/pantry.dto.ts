// MC-022 — Pantry DTO schemas.
//
// Schema reality (ADR-0021 + T15-B обновили модель — см.
// packages/database/prisma/schema.prisma): PantryItem HAS `notes` и
// `archivedAt` (soft delete); `addedAt` так и не появился.
//   It DOES have `quantity` (Decimal), `unit` (Unit enum),
//   `estimatedGrams` (Decimal), `amountStatus`, `priority`,
//   `storageLocation`, `opened`, `purchaseDate`, `expiresAt`,
//   `createdAt`, `updatedAt`.
//
// Task spec asked for `notes`, `archivedAt`, and `addedAt`. We drop
// those because the schema can't be touched from MC-022 (PM-prompt
// rule #6: bug in spec vs schema → flag and honor schema).
//
// Result:
//   - DTO has NO `notes`.
//   - DELETE = hard delete (no archivedAt column to flip).
//   - restore endpoint returns 400 ITEM_NOT_ARCHIVED always (no
//     archive state possible without `archivedAt`).
//   - ?includeArchived is accepted but is a no-op.
//   - ?sort uses `createdAt` instead of `addedAt`.

import { z } from 'zod';

// ULID regex from docs/api/conventions.md §6.
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// Sort field → column mapping. The schema has Decimal columns; for
// `quantityG` sort we order on `quantity` (the Decimal column is the
// canonical grams value).
export const PANTRY_SORT_FIELDS = ['createdAt', 'expiresAt', 'quantityG'] as const;
export const PANTRY_SORT_ORDERS = ['asc', 'desc'] as const;

// Schema enum mirror — kept here so zod can validate without
// pulling Prisma. The strings MUST match Prisma's enum values.
export const UNIT_VALUES = ['G', 'ML', 'PIECE'] as const;
export const AMOUNT_STATUS_VALUES = ['PLENTY', 'SOME', 'LOW'] as const;
export const PRIORITY_VALUES = ['NORMAL', 'USE_FIRST', 'STAPLE'] as const;
export const STORAGE_LOCATION_VALUES = ['PANTRY', 'FRIDGE', 'FREEZER'] as const;

const ulidSchema = z.string().regex(ULID, 'must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date (YYYY-MM-DD)')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be a valid date');

export const CreatePantryItemSchema = z
  .object({
    ingredientId: ulidSchema,
    quantityG: z.number().positive('quantityG must be > 0').max(1_000_000, 'quantityG too large'),
    unit: z.enum(UNIT_VALUES).default('G'),
    amountStatus: z.enum(AMOUNT_STATUS_VALUES).default('SOME'),
    priority: z.enum(PRIORITY_VALUES).default('NORMAL'),
    storageLocation: z.enum(STORAGE_LOCATION_VALUES).default('FRIDGE'),
    opened: z.boolean().default(false),
    expiresAt: isoDate.optional(),
    purchaseDate: isoDate.optional(),
    // ADR-0021: user annotations (≤ 500 chars enforced here, schema
    // allows any length up to Postgres TEXT).
    notes: z.string().trim().max(500, 'notes must be at most 500 characters').optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.expiresAt === undefined || v.purchaseDate === undefined || v.purchaseDate <= v.expiresAt,
    { message: 'purchaseDate must be on or before expiresAt' },
  );
export type CreatePantryItemBody = z.infer<typeof CreatePantryItemSchema>;

export const PatchPantryItemSchema = z
  .object({
    quantityG: z.number().positive().max(1_000_000).optional(),
    // R20 F1: UI отправляет unit в PATCH (EditPantryItemDialog) —
    // strict-схема его отвергала → 400 при каждом редактировании.
    unit: z.enum(UNIT_VALUES).optional(),
    expiresAt: isoDate.nullable().optional(),
    amountStatus: z.enum(AMOUNT_STATUS_VALUES).optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    storageLocation: z.enum(STORAGE_LOCATION_VALUES).optional(),
    opened: z.boolean().optional(),
    notes: z.string().trim().max(500, 'notes must be at most 500 characters').nullable().optional(),
  })
  .strict();
export type PatchPantryItemBody = z.infer<typeof PatchPantryItemSchema>;

export const ListPantryQuerySchema = z
  .object({
    ingredientId: ulidSchema.optional(),
    includeArchived: z
      .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
      .transform((v) => v === 'true' || v === '1')
      .optional()
      .transform((v) => v ?? false),
    sort: z.enum(PANTRY_SORT_FIELDS).default('createdAt'),
    order: z.enum(PANTRY_SORT_ORDERS).default('desc'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListPantryQuery = z.infer<typeof ListPantryQuerySchema>;

export const PantryItemIdParamsSchema = z
  .object({
    id: ulidSchema,
  })
  .strict();
export type PantryItemIdParams = z.infer<typeof PantryItemIdParamsSchema>;

export const RestorePantryItemParamsSchema = PantryItemIdParamsSchema;
export type RestorePantryItemParams = z.infer<typeof RestorePantryItemParamsSchema>;

// ListQuerySchema for the "ingredientId" filter on GET list — same
// field as the PantryItemIdParamsSchema but optional.
export const IngredientIdQuerySchema = z
  .object({
    ingredientId: ulidSchema.optional(),
  })
  .strict();
