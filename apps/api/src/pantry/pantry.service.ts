// MC-022 — PantryService. Household-scoped CRUD for PantryItem.
// All reads/writes include a householdId predicate derived from
// the authenticated session — clients cannot pass a different
// householdId via query or body (PM-prompt #3).
//
// Schema reality (MC-003, not modified in MC-022):
//   PantryItem has no `archivedAt`, no `notes`, no `addedAt`.
//   DELETE is hard delete (no soft-delete state exists).
//   ?includeArchived is a no-op (always returns all rows since none
//   can be archived). The restore endpoint exists for forward
//   compatibility but always returns 400 ITEM_NOT_ARCHIVED.
//
// Cross-household behavior: every per-id lookup adds householdId
// to the WHERE clause. If the row exists but belongs to another
// household, the lookup returns null → controller throws 404
// PANTRY_ITEM_NOT_FOUND (NEVER 403 — do not leak existence of
// other households' items).

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getPrisma } from '@multichef/database';
import { AppHttpException } from '../common/exception-filter.js';
import type { CreatePantryItemBody, ListPantryQuery, PatchPantryItemBody } from './pantry.dto.js';

const PRISMA = getPrisma();

export interface PantryItemView {
  id: string;
  householdId: string;
  ingredientId: string;
  quantity: number; // Decimal → number (grams)
  unit: string;
  estimatedGrams: number;
  amountStatus: string;
  priority: string;
  storageLocation: string;
  opened: boolean;
  expiresAt: string | null; // ISO date YYYY-MM-DD or null
  purchaseDate: string | null;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

function toView(row: PantryItemRow): PantryItemView {
  return {
    id: row.id,
    householdId: row.householdId,
    ingredientId: row.ingredientId,
    quantity: toNumber(row.quantity),
    unit: row.unit,
    estimatedGrams: toNumber(row.estimatedGrams),
    amountStatus: row.amountStatus,
    priority: row.priority,
    storageLocation: row.storageLocation,
    opened: row.opened,
    expiresAt: row.expiresAt ? toIsoDate(row.expiresAt) : null,
    purchaseDate: row.purchaseDate ? toIsoDate(row.purchaseDate) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toNumber(d: Prisma.Decimal | unknown): number {
  if (d && typeof d === 'object' && 'toNumber' in d) {
    return (d as { toNumber(): number }).toNumber();
  }
  return Number(d);
}

function toIsoDate(d: Date): string {
  // Postgres @db.Date serialises as midnight UTC. Format YYYY-MM-DD.
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

type PantryItemRow = Prisma.PantryItemGetPayload<Record<string, never>>;

@Injectable()
export class PantryService {
  async createItem(userId: string, body: CreatePantryItemBody): Promise<PantryItemView> {
    // Verify the ingredient exists — 404 INGREDIENT_NOT_FOUND if not.
    const ingredient = await PRISMA.ingredient.findUnique({
      where: { id: body.ingredientId },
      select: { id: true },
    });
    if (!ingredient) {
      throw new AppHttpException({
        code: 'INGREDIENT_NOT_FOUND',
        message: 'Ingredient not found',
        details: { ingredientId: body.ingredientId },
      });
    }
    const householdId = await this.requireOwnedHouseholdId(userId);
    const row = await PRISMA.pantryItem.create({
      data: {
        id: generateId(),
        householdId,
        ingredientId: body.ingredientId,
        quantity: new Prisma.Decimal(body.quantityG),
        unit: body.unit,
        estimatedGrams: new Prisma.Decimal(body.quantityG),
        amountStatus: body.amountStatus,
        priority: body.priority,
        storageLocation: body.storageLocation,
        opened: body.opened,
        ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
        ...(body.purchaseDate ? { purchaseDate: new Date(body.purchaseDate) } : {}),
      },
    });
    return toView(row);
  }

  async listItems(userId: string, query: ListPantryQuery): Promise<PantryItemView[]> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // The schema has no archivedAt column; includeArchived is a no-op
    // — we always return all rows for the household.
    const orderBy: Prisma.PantryItemOrderByWithRelationInput = (() => {
      switch (query.sort) {
        case 'expiresAt':
          return { expiresAt: query.order };
        case 'quantityG':
          // Decimal column is named `quantity` in the schema.
          return { quantity: query.order };
        case 'createdAt':
        default:
          return { createdAt: query.order };
      }
    })();

    const rows = await PRISMA.pantryItem.findMany({
      where: {
        householdId,
        ...(query.ingredientId ? { ingredientId: query.ingredientId } : {}),
      },
      orderBy,
      take: query.limit,
      skip: query.offset,
    });
    return rows.map(toView);
  }

  async getItem(userId: string, id: string): Promise<PantryItemView> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // householdId is part of the WHERE — we never return items from
    // other households, even if id exists.
    const row = await PRISMA.pantryItem.findFirst({
      where: { id, householdId },
    });
    if (!row) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_NOT_FOUND',
        message: 'Pantry item not found',
        details: { id },
      });
    }
    return toView(row);
  }

  async updateItem(userId: string, id: string, body: PatchPantryItemBody): Promise<PantryItemView> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // Confirm existence + ownership first (so we can return 404 even
    // if the row would otherwise produce 0 affected rows).
    const existing = await PRISMA.pantryItem.findFirst({
      where: { id, householdId },
    });
    if (!existing) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_NOT_FOUND',
        message: 'Pantry item not found',
        details: { id },
      });
    }

    const data: Prisma.PantryItemUpdateInput = {};
    if (body.quantityG !== undefined) {
      data.quantity = new Prisma.Decimal(body.quantityG);
      data.estimatedGrams = new Prisma.Decimal(body.quantityG);
    }
    if (body.amountStatus !== undefined) data.amountStatus = body.amountStatus;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.storageLocation !== undefined) data.storageLocation = body.storageLocation;
    if (body.opened !== undefined) data.opened = body.opened;
    if (body.expiresAt !== undefined) {
      data.expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
    }

    const row = await PRISMA.pantryItem.update({
      where: { id },
      data,
    });
    return toView(row);
  }

  async deleteItem(userId: string, id: string): Promise<void> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // Hard delete. Schema has no `archivedAt` column to flip, so we
    // physically remove the row. (Soft delete + restore is a future
    // ADR — see MC-022 report red flags.)
    const existing = await PRISMA.pantryItem.findFirst({
      where: { id, householdId },
      select: { id: true },
    });
    if (!existing) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_NOT_FOUND',
        message: 'Pantry item not found',
        details: { id },
      });
    }
    await PRISMA.pantryItem.delete({ where: { id } });
  }

  async restoreItem(userId: string, id: string): Promise<PantryItemView> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // The schema has no `archivedAt` column — there is no archived
    // state possible. We always 400 ITEM_NOT_ARCHIVED for forward
    // compatibility: when the column is added, this same code path
    // returns the row with archivedAt cleared.
    const existing = await PRISMA.pantryItem.findFirst({
      where: { id, householdId },
      select: { id: true },
    });
    if (!existing) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_NOT_FOUND',
        message: 'Pantry item not found',
        details: { id },
      });
    }
    throw new AppHttpException({
      code: 'ITEM_NOT_ARCHIVED',
      message: 'Item is not archived (archive state is not supported in this version)',
      details: { id },
    });
  }

  /**
   * Resolve the user's OWNER-role household id. If the user doesn't
   * own a household, returns 403 — pantry is meaningless without one.
   * (Should never happen for a registered user; register() creates
   * the OWNER member row in the same transaction as User+Household.)
   */
  private async requireOwnedHouseholdId(userId: string): Promise<string> {
    const membership = await PRISMA.householdMember.findFirst({
      where: { userId, role: 'OWNER' },
      select: { householdId: true },
    });
    if (!membership) {
      throw new AppHttpException({
        code: 'FORBIDDEN',
        message: 'No owned household for this user',
      });
    }
    return membership.householdId;
  }
}

// ULID-style id (26-char hex) — same generator the seed uses.
function generateId(): string {
  // randomBytes(13) = 26 hex chars when uppercased.
  return randomBytes(13).toString('hex').toUpperCase();
}
