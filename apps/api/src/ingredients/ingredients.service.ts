// MC-021 — IngredientsService. Read-only catalog queries against the
// 21-model Prisma schema. No mutations, no auth. Uses pg_trgm GIN
// indexes (created in MC-003) for fast fuzzy matching on
// canonicalName + alias.

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getPrisma } from '@multichef/database';
import { AppHttpException } from '../common/exception-filter.js';
import type { IngredientsQuery } from './ingredients.dto.js';

const PRISMA = getPrisma();

export interface IngredientView {
  id: string;
  canonicalName: string;
  defaultUnit: string;
  packageSize: number | null;
  avgPriceKopecks: number | null;
  density: number | null;
  ediblePartRatio: number;
  status: string;
  category: { id: string; name: string; sortOrder: number };
  aliases: { alias: string; locale: string }[];
}

export interface CategoryView {
  id: string;
  name: string;
  sortOrder: number;
}

export interface NutritionView {
  ingredientId: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  fiberPer100g: number;
  source: string;
  calculationVersion: number;
}

@Injectable()
export class IngredientsService {
  // Note: this service relies on getPrisma() returning a singleton.
  // Constructor injection of PrismaService is intentionally avoided
  // because the package exposes a lazy factory and we don't want to
  // bind the API's lifecycle to PrismaClient's open()/close()
  // (which is handled in main.ts via closePrisma() on SIGTERM).

  async listIngredients(
    query: IngredientsQuery,
  ): Promise<{ items: IngredientView[]; total: number }> {
    const where: Prisma.IngredientWhereInput = {
      status: 'ACTIVE',
    };

    if (query.q && query.q.length > 0) {
      // pg_trgm-backed fuzzy match. We OR across canonicalName and
      // aliases using case-insensitive contains. The GIN trigram
      // indexes on `canonicalName` and `alias` (MC-003) keep this
      // fast even with hundreds of rows.
      where.OR = [
        { canonicalName: { contains: query.q, mode: 'insensitive' } },
        {
          aliases: {
            some: { alias: { contains: query.q, mode: 'insensitive' } },
          },
        },
      ];
    }

    if (query.category && query.category.length > 0) {
      // MC-003 schema has no `slug` on IngredientCategory. Filter by
      // the Russian display `name` instead (the seed runner stores
      // names exactly: 'Овощи', 'Фрукты и ягоды', etc.).
      where.category = { name: query.category };
    }

    const orderBy: Prisma.IngredientOrderByWithRelationInput =
      query.sort === 'avgPriceKopecks'
        ? { avgPriceKopecks: query.order }
        : { canonicalName: query.order };

    const [items, total] = await Promise.all([
      PRISMA.ingredient.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, sortOrder: true } },
          aliases: { select: { alias: true, locale: true } },
        },
        orderBy,
        take: query.limit,
        skip: query.offset,
      }),
      PRISMA.ingredient.count({ where }),
    ]);

    return {
      items: items.map(toIngredientView),
      total,
    };
  }

  async getIngredient(id: string): Promise<IngredientView> {
    const row = await PRISMA.ingredient.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, sortOrder: true } },
        aliases: { select: { alias: true, locale: true } },
      },
    });
    if (!row) {
      throw new AppHttpException({
        code: 'INGREDIENT_NOT_FOUND',
        message: 'Ingredient not found',
        details: { id },
      });
    }
    return toIngredientView(row);
  }

  async listCategories(): Promise<CategoryView[]> {
    const rows = await PRISMA.ingredientCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder }));
  }

  async getNutrition(ingredientId: string): Promise<NutritionView | null> {
    // First confirm the ingredient exists — return 404 if not so the
    // frontend can distinguish "no nutrition data yet" from
    // "ingredient doesn't exist".
    const exists = await PRISMA.ingredient.findUnique({
      where: { id: ingredientId },
      select: { id: true },
    });
    if (!exists) {
      throw new AppHttpException({
        code: 'INGREDIENT_NOT_FOUND',
        message: 'Ingredient not found',
        details: { id: ingredientId },
      });
    }
    const row = await PRISMA.ingredientNutrition.findUnique({
      where: { ingredientId },
    });
    if (!row) return null;
    return {
      ingredientId: row.ingredientId,
      caloriesPer100g: toNumber(row.caloriesPer100g),
      proteinPer100g: toNumber(row.proteinPer100g),
      fatPer100g: toNumber(row.fatPer100g),
      carbsPer100g: toNumber(row.carbsPer100g),
      fiberPer100g: toNumber(row.fiberPer100g),
      source: row.source,
      calculationVersion: row.calculationVersion,
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Mapping helpers
// ────────────────────────────────────────────────────────────────────

type IngredientWithIncludes = Prisma.IngredientGetPayload<{
  include: {
    category: { select: { id: true; name: true; sortOrder: true } };
    aliases: { select: { alias: true; locale: true } };
  };
}>;

function toIngredientView(row: IngredientWithIncludes): IngredientView {
  return {
    id: row.id,
    canonicalName: row.canonicalName,
    defaultUnit: row.defaultUnit,
    packageSize: row.packageSize,
    avgPriceKopecks: row.avgPriceKopecks,
    density: row.density,
    ediblePartRatio: row.ediblePartRatio,
    status: row.status,
    category: {
      id: row.category.id,
      name: row.category.name,
      sortOrder: row.category.sortOrder,
    },
    aliases: row.aliases.map((a) => ({ alias: a.alias, locale: a.locale })),
  };
}

function toNumber(d: Prisma.Decimal | unknown): number {
  if (d && typeof d === 'object' && 'toNumber' in d) {
    return (d as { toNumber(): number }).toNumber();
  }
  return Number(d);
}
