// MC-033 — Recipes service: public catalog reads.
//
// CURATED + PUBLISHED only (gate decision: the catalog is public
// reference data). Cursor pagination is (createdAt, id) compound.
// Wire DTOs come from @multichef/contracts (Zod = source of truth).

import { Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import type { Prisma } from '@prisma/client';
import { AppHttpException } from '../common/exception-filter.js';
import { parseInstructions, recipeNotFoundError } from './recipes.mappers.js';
import type { RecipeDetailDto, RecipeDto, PaginatedRecipes } from './recipes.dto.js';

const LIST_INCLUDE = {
  ingredients: {
    include: { ingredient: { include: { category: { select: { name: true } } } } },
  },
  nutrition: true,
} satisfies Prisma.RecipeInclude;

export type RecipeRowWithRelations = Prisma.RecipeGetPayload<{ include: typeof LIST_INCLUDE }>;

/** Prisma list row → wire DTO (no nutrition/instructions detail). */
export function toDto(row: RecipeRowWithRelations): RecipeDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    imageKey: row.imageKey,
    servings: row.servings,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    difficulty: row.difficulty,
    mealTypes: row.mealTypes,
    tags: row.tags,
    requiredAppliances: row.requiredAppliances,
    chainTags: row.chainTags,
  };
}

@Injectable()
export class RecipesService {
  /** GET /recipes — public catalog list with optional filters + cursor. */
  async list(query: {
    mealType?: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | undefined;
    maxMinutes?: number | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<PaginatedRecipes> {
    const prisma = getPrisma();
    const where: Prisma.RecipeWhereInput = {
      sourceType: 'CURATED',
      status: 'PUBLISHED',
      ...(query.mealType ? { mealTypes: { has: query.mealType } } : {}),
      // maxMinutes applies to the TOTAL cooking time (prep + cook ≤ max).
      ...(query.maxMinutes !== undefined
        ? { prepMinutes: { lte: query.maxMinutes }, cookMinutes: { lte: query.maxMinutes } }
        : {}),
    };

    // Compound cursor: (createdAt, id) DESC. Seed rows often share the
    // same createdAt timestamp, so the id tiebreaker is essential.
    let cursorFilter: Prisma.RecipeWhereInput = {};
    if (query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as {
          t?: string;
          i?: string;
        };
        if (decoded.t && decoded.i) {
          const t = new Date(decoded.t);
          if (!Number.isNaN(t.getTime())) {
            cursorFilter = {
              OR: [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: decoded.i } }],
            };
          }
        }
      } catch {
        throw new AppHttpException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid cursor',
          details: { fields: { cursor: ['malformed cursor'] } },
        });
      }
    }

    const rows = await prisma.recipe.findMany({
      where: { AND: [where, cursorFilter] },
      include: LIST_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Fetch limit+1 to detect a next page; drop the extra row.
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = page[page.length - 1];
      if (last) {
        nextCursor = Buffer.from(
          JSON.stringify({ t: last.createdAt.toISOString(), i: last.id }),
          'utf8',
        ).toString('base64url');
      }
    }

    return {
      items: page.map(toDto),
      nextCursor,
    };
  }

  /** GET /recipes/:id — public detail view. 404 when not public. */
  async getById(id: string): Promise<RecipeDetailDto> {
    const prisma = getPrisma();
    const row = (await prisma.recipe.findFirst({
      where: { id, sourceType: 'CURATED', status: 'PUBLISHED' },
      include: LIST_INCLUDE,
    })) as RecipeRowWithRelations | null;

    if (!row) throw recipeNotFoundError(id);

    // Storage rules are matched by exact recipe title or any recipe tag
    // (MC-031 seeds rules with recipeTag = title).
    const storageRules = await prisma.storageRule.findMany({
      where: { OR: [{ recipeTag: row.title }, ...row.tags.map((tag) => ({ recipeTag: tag }))] },
      orderBy: { storageMethod: 'asc' },
    });

    const steps = parseInstructions(row.instructions);
    return {
      ...toDto(row),
      instructions: steps.map((s) => ({
        order: s.order,
        text: s.text,
        timerMinutes: s.timerMinutes ?? null,
      })),
      ingredients: row.ingredients.map((ri) => ({
        ingredientId: ri.ingredientId,
        canonicalName: ri.ingredient?.canonicalName ?? ri.ingredientId,
        grams: ri.grams.toNumber(),
        optional: ri.optional,
        substitutesFor: ri.substitutesFor,
      })),
      nutrition: row.nutrition
        ? {
            servingCalories: row.nutrition.servingCalories.toNumber(),
            servingProteinG: row.nutrition.servingProteinG.toNumber(),
            servingFatG: row.nutrition.servingFatG.toNumber(),
            servingCarbsG: row.nutrition.servingCarbsG.toNumber(),
            servingGrams: row.nutrition.servingGrams.toNumber(),
            calculationVersion: row.nutrition.calculationVersion,
          }
        : {
            servingCalories: 0,
            servingProteinG: 0,
            servingFatG: 0,
            servingCarbsG: 0,
            servingGrams: 0,
            calculationVersion: 0,
          },
      storageRules: storageRules.map((rule) => ({
        storageMethod: rule.storageMethod,
        maxHoursFridge: rule.maxHoursFridge,
        maxDaysFreezer: rule.maxDaysFreezer,
        freezingAllowed: rule.freezingAllowed,
        partialPrepAllowed: rule.partialPrepAllowed,
        addBeforeServing: rule.addBeforeServing,
      })),
    };
  }
}
