// MC-054 — ShoppingLists service: budget-fit proposals + apply.
//
// fitBudget loads the household's ACTIVE list, classifies each item
// (optional-only usage, declared substitutes) and asks the pure
// fitBudgetProposals generator for savings in preference order.
// applyProposal mutates the list transactionally (SUBSTITUTE replaces
// the row, DROP_OPTIONAL deletes it) and recomputes the total.
//
// ADR-0023 phase 2: ShoppingList* are RLS-protected (mc089) — every
// tenant operation runs inside withTenantContext().

import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma, withTenantContext } from '@multichef/database';
import {
  fitBudgetProposals,
  type BudgetItem,
  type BudgetProposal,
} from '@multichef/recommendation';
import type { ApplyBudgetProposalDto, FitBudgetResponseDto } from '@multichef/contracts';
import { AppHttpException } from '../common/exception-filter.js';

type PrismaLike = ReturnType<typeof getPrisma>;

@Injectable()
export class ShoppingListsService {
  private readonly prismaOverride: PrismaLike | undefined;

  constructor(@Optional() prisma?: PrismaLike) {
    this.prismaOverride = prisma;
  }

  private get db(): PrismaLike {
    return this.prismaOverride ?? getPrisma();
  }

  /** The household's ACTIVE shopping list; 404 when there is none. */
  async getActiveForUser(userId: string) {
    const householdId = await this.requireOwnedHouseholdId(userId);
    // T16-A (audit round 16): typed 404 instead of a raw null body —
    // the web client maps SHOPPING_LIST_NOT_FOUND back to null.
    return withTenantContext({ householdId, userId }, async (tx) => {
      const list = await tx.shoppingList.findFirst({
        where: { householdId, status: 'ACTIVE' },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { ingredientId: 'asc' }],
            // Audit fix: the UI must show catalogue names, not raw ids.
            include: { ingredient: { select: { canonicalName: true } } },
          },
        },
      });
      if (!list) {
        throw new AppHttpException({
          code: 'SHOPPING_LIST_NOT_FOUND',
          message: 'Активный список покупок не найден',
        });
      }
      return {
        ...list,
        items: list.items.map((item) => ({
          ...item,
          name: item.ingredient?.canonicalName ?? null,
        })),
      };
    });
  }

  async fitBudget(
    userId: string,
    listId: string,
    targetBudgetKopecks: number,
  ): Promise<FitBudgetResponseDto> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    return withTenantContext({ householdId, userId }, async (tx) => {
      const { list, budgetItems } = await this.loadBudgetItems(tx, userId, listId, householdId);
      const result = fitBudgetProposals(
        budgetItems,
        targetBudgetKopecks,
        list.estimatedTotalKopecks,
      );
      return {
        proposals: result.proposals.map((p) => this.toDto(p)),
        totalPossibleSavings: result.totalPossibleSavings,
        achievable: result.achievable,
        currentTotalKopecks: list.estimatedTotalKopecks,
        minimalTotalKopecks: result.minimalTotalKopecks,
      };
    });
  }

  async applyProposal(
    userId: string,
    listId: string,
    input: ApplyBudgetProposalDto,
  ): Promise<{ applied: boolean; estimatedTotalKopecks: number }> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    return withTenantContext({ householdId, userId }, async (tx) => {
      const { list, budgetItems } = await this.loadBudgetItems(tx, userId, listId, householdId);
      const rawItem = list.items.find((i) => i.ingredientId === input.ingredientId);
      const target = budgetItems.find((i) => i.ingredientId === input.ingredientId);
      if (!target || !rawItem) {
        throw new AppHttpException({
          code: 'SHOPPING_ITEM_NOT_FOUND',
          message: 'Позиция не найдена в списке',
          details: { ingredientId: input.ingredientId },
        });
      }
      const total = await (async () => {
        if (input.kind === 'SUBSTITUTE') {
          const substituteId = input.substituteIngredientId;
          if (!substituteId) {
            throw new AppHttpException({
              code: 'VALIDATION_ERROR',
              message: 'substituteIngredientId is required for SUBSTITUTE',
            });
          }
          const substituteMeta = await tx.ingredient.findUnique({
            where: { id: substituteId },
            select: { avgPriceKopecks: true, categoryId: true },
          });
          await tx.shoppingListItem.updateMany({
            where: { shoppingListId: list.id, ingredientId: input.ingredientId },
            data: {
              ingredientId: substituteId,
              categoryId: substituteMeta?.categoryId ?? rawItem.categoryId,
              estimatedPriceKopecks: Math.round(
                (substituteMeta?.avgPriceKopecks ?? 0) * rawItem.packageQuantity,
              ),
            },
          });
        } else {
          await tx.shoppingListItem.deleteMany({
            where: { shoppingListId: list.id, ingredientId: input.ingredientId },
          });
        }
        const agg = await tx.shoppingListItem.aggregate({
          where: { shoppingListId: list.id },
          _sum: { estimatedPriceKopecks: true },
        });
        const estimatedTotalKopecks = agg._sum.estimatedPriceKopecks ?? 0;
        await tx.shoppingList.update({
          where: { id: list.id },
          data: { estimatedTotalKopecks },
        });
        return estimatedTotalKopecks;
      })();
      return { applied: true, estimatedTotalKopecks: total };
    });
  }

  /** MC-056: toggle purchased on an item owned by the household. */
  async setItemPurchased(userId: string, itemId: string, purchased: boolean) {
    const householdId = await this.requireOwnedHouseholdId(userId);
    return withTenantContext({ householdId, userId }, async (tx) => {
      const item = await tx.shoppingListItem.findFirst({
        where: {
          id: itemId,
          shoppingList: { household: { members: { some: { userId, role: 'OWNER' } } } },
        },
        select: { id: true, purchased: true },
      });
      if (!item) {
        throw new AppHttpException({
          code: 'SHOPPING_ITEM_NOT_FOUND',
          message: 'Позиция не найдена в списке',
          details: { itemId },
        });
      }
      await tx.shoppingListItem.update({
        where: { id: itemId },
        data: { purchased, purchasedAt: purchased ? new Date() : null },
      });
      return { purchased };
    });
  }

  /**
   * MC-056: complete the list — archive it and credit every purchased
   * item to the pantry (existing active row → grams increased, else a
   * new row with purchaseDate = today).
   */
  async complete(userId: string, listId: string) {
    const householdId = await this.requireOwnedHouseholdId(userId);
    return withTenantContext({ householdId, userId }, async (tx) => {
      const list = await tx.shoppingList.findFirst({
        where: { id: listId, householdId },
        include: {
          items: {
            where: { purchased: true },
            include: { ingredient: { select: { canonicalName: true } } },
          },
        },
      });
      if (!list) {
        throw new AppHttpException({
          code: 'SHOPPING_LIST_NOT_FOUND',
          message: 'Shopping list not found',
          details: { listId },
        });
      }
      const today = new Date();
      for (const item of list.items) {
        const grams = item.packageQuantity * item.packageSize.toNumber();
        const existing = await tx.pantryItem.findFirst({
          where: { householdId, ingredientId: item.ingredientId, archivedAt: null },
          select: { id: true, estimatedGrams: true },
        });
        if (existing) {
          await tx.pantryItem.update({
            where: { id: existing.id },
            data: { estimatedGrams: { increment: grams }, purchaseDate: today },
          });
        } else {
          await tx.pantryItem.create({
            data: {
              id: randomUUID(),
              householdId,
              ingredientId: item.ingredientId,
              quantity: item.packageQuantity,
              unit: item.packageUnit,
              estimatedGrams: grams,
              amountStatus: 'PLENTY',
              storageLocation: 'PANTRY',
              purchaseDate: today,
            },
          });
        }
      }
      await tx.shoppingList.update({ where: { id: list.id }, data: { status: 'COMPLETED' } });
      return { completed: true, pantryItemsTouched: list.items.length };
    });
  }

  // --- internals -------------------------------------------------------------

  private async loadBudgetItems(
    tx: Prisma.TransactionClient,
    userId: string,
    listId: string,
    householdId: string,
  ) {
    const list = await tx.shoppingList.findFirst({
      where: { id: listId, householdId },
      include: {
        items: { include: { ingredient: { select: { canonicalName: true } } } },
      },
    });
    if (!list) {
      throw new AppHttpException({
        code: 'SHOPPING_LIST_NOT_FOUND',
        message: 'Shopping list not found',
        details: { listId },
      });
    }
    const budgetItems: BudgetItem[] = list.items.map((item) => ({
      ingredientId: item.ingredientId,
      estimatedPriceKopecks: item.estimatedPriceKopecks ?? 0,
      utilityScore: item.utilityScore ?? 0,
      optionalOnly: false, // refined below
      substituteIngredientId: null,
      substitutePriceKopecks: null,
      substituteAlreadyListed: false,
    }));
    const listedIds = new Set(list.items.map((i) => i.ingredientId));

    // Refine substitutes: the most common declared substitute per item.
    const substituteRows = await tx.recipeIngredient.groupBy({
      by: ['ingredientId', 'substitutesFor'],
      where: {
        ingredientId: { in: [...listedIds] },
        substitutesFor: { not: null },
      },
      _count: { _all: true },
    });
    const substituteByIngredient = new Map<string, string>();
    for (const row of substituteRows) {
      if (!row.substitutesFor) continue;
      const current = substituteByIngredient.get(row.ingredientId);
      if (!current) substituteByIngredient.set(row.ingredientId, row.substitutesFor);
    }
    const substituteIds = [...new Set(substituteByIngredient.values())];
    const substitutePrices = new Map(
      (
        await tx.ingredient.findMany({
          where: { id: { in: substituteIds } },
          select: { id: true, avgPriceKopecks: true },
        })
      ).map((r) => [r.id, r.avgPriceKopecks]),
    );
    for (const item of budgetItems) {
      const subId = substituteByIngredient.get(item.ingredientId);
      if (subId) {
        const rawItem = list.items.find((i) => i.ingredientId === item.ingredientId);
        item.substituteIngredientId = subId;
        const price = substitutePrices.get(subId);
        item.substitutePriceKopecks =
          price == null ? null : Math.round(price * rawItem!.packageQuantity);
        item.substituteAlreadyListed = listedIds.has(subId);
      }
    }

    // Optional-only: the ingredient appears in plan recipes ONLY as an
    // optional recipe-ingredient (one grouped query over plan entries).
    const usage = await tx.recipeIngredient.groupBy({
      by: ['ingredientId', 'optional'],
      where: {
        ingredientId: { in: [...listedIds] },
        ...(list.mealPlanId
          ? { recipe: { entries: { some: { day: { mealPlanId: list.mealPlanId } } } } }
          : {}),
      },
      _count: { _all: true },
    });
    for (const item of budgetItems) {
      const rows = usage.filter((u) => u.ingredientId === item.ingredientId);
      const hasRequired = rows.some((u) => !u.optional);
      const hasOptional = rows.some((u) => u.optional);
      item.optionalOnly = !hasRequired && hasOptional;
    }
    return { list, budgetItems };
  }

  private toDto(p: BudgetProposal) {
    if (p.kind === 'SUBSTITUTE') {
      return {
        kind: p.kind,
        ingredientId: p.ingredientId,
        substituteIngredientId: p.substituteIngredientId,
        savingKopecks: p.savingKopecks,
      };
    }
    if (p.kind === 'DROP_OPTIONAL') {
      return { kind: p.kind, ingredientId: p.ingredientId, savingKopecks: p.savingKopecks };
    }
    return { kind: p.kind, savingKopecks: p.savingKopecks, unavailableReason: p.unavailableReason };
  }

  private async requireOwnedHouseholdId(userId: string): Promise<string> {
    const membership = await this.db.householdMember.findFirst({
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
