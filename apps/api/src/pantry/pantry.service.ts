// MC-022 — PantryService. Household-scoped CRUD for PantryItem.
// All reads/writes include a householdId predicate derived from
// the authenticated session — clients cannot pass a different
// householdId via query or body (PM-prompt #3).
//
// Schema (MC-003 + ADR-0021 fix-forward):
//   - PantryItem has `archivedAt` (nullable, soft-delete tombstone)
//     and `notes` (nullable, user annotation, ≤ 500 chars enforced
//     in DTO).
//   - DELETE = soft delete (sets `archivedAt = now()`).
//   - restore = clears `archivedAt` to null; 400 ITEM_NOT_ARCHIVED
//     if the row was already active.
//   - ?includeArchived filters the list query.
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
  archivedAt: string | null; // ISO timestamp or null
  notes: string | null;
  /** Catalogue name for UI (null only for deleted ingredients). */
  name: string | null;
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
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    notes: row.notes,
    name: row.ingredient?.canonicalName ?? null,
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

// Audit fix: include the ingredient name so UI never renders raw
// ingredient ids (product audit 2026-09-13).
type PantryItemRow = Prisma.PantryItemGetPayload<{
  include: { ingredient: { select: { canonicalName: true } } };
}>;

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
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
      include: { ingredient: { select: { canonicalName: true } } },
    });
    return toView(row);
  }

  async listItems(userId: string, query: ListPantryQuery): Promise<PantryItemView[]> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // ADR-0021: includeArchived=false (default) hides soft-deleted rows.
    const where: Prisma.PantryItemWhereInput = {
      householdId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.ingredientId ? { ingredientId: query.ingredientId } : {}),
    };
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
      where,
      orderBy,
      take: query.limit,
      skip: query.offset,
      include: { ingredient: { select: { canonicalName: true } } },
    });
    return rows.map(toView);
  }

  async getItem(userId: string, id: string): Promise<PantryItemView> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // householdId is part of the WHERE — we never return items from
    // other households, even if id exists.
    const row = await PRISMA.pantryItem.findFirst({
      where: { id, householdId },
      include: { ingredient: { select: { canonicalName: true } } },
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
      include: { ingredient: { select: { canonicalName: true } } },
    });
    if (!existing) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_NOT_FOUND',
        message: 'Pantry item not found',
        details: { id },
      });
    }
    // T15-B (audit round 15): archive is a soft delete — silently
    // editing an archived row contradicted the restore-first flow.
    // Require an explicit POST /:id/restore before PATCH.
    if (existing.archivedAt !== null) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_ARCHIVED',
        message: 'Cannot modify an archived item; restore it first',
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
    if (body.notes !== undefined) {
      data.notes = body.notes;
    }

    const row = await PRISMA.pantryItem.update({
      where: { id },
      data,
      include: { ingredient: { select: { canonicalName: true } } },
    });
    return toView(row);
  }

  async deleteItem(userId: string, id: string): Promise<void> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // ADR-0021: soft delete — set archivedAt = now() instead of
    // physically removing the row. Use a guarded update so we can
    // return 404 when (id, householdId) doesn't match.
    const result = await PRISMA.pantryItem.updateMany({
      where: { id, householdId },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_NOT_FOUND',
        message: 'Pantry item not found',
        details: { id },
      });
    }
  }

  async restoreItem(userId: string, id: string): Promise<PantryItemView> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // ADR-0021: restore only makes sense if the row is currently
    // archived. If archivedAt is null we return 400 ITEM_NOT_ARCHIVED.
    const existing = await PRISMA.pantryItem.findFirst({
      where: { id, householdId },
      include: { ingredient: { select: { canonicalName: true } } },
    });
    if (!existing) {
      throw new AppHttpException({
        code: 'PANTRY_ITEM_NOT_FOUND',
        message: 'Pantry item not found',
        details: { id },
      });
    }
    if (existing.archivedAt === null) {
      throw new AppHttpException({
        code: 'ITEM_NOT_ARCHIVED',
        message: 'Item is not archived',
        details: { id },
      });
    }
    const row = await PRISMA.pantryItem.update({
      where: { id },
      data: { archivedAt: null },
      include: { ingredient: { select: { canonicalName: true } } },
    });
    return toView(row);
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
