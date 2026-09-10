// MC-033 — Recommendations mappers: Prisma → GenerationContext inputs.
//
// Builds the pantry / preferences / protein signal for the MC-032
// scoring package. All Decimal → number conversions happen here (the
// package boundary).

import type { Prisma } from '@prisma/client';
import {
  mapPantry,
  mapPreferences,
  mapRecipeRow,
  mapYesterdayMainProtein,
  type PrismaRecipeWithRelations,
  type ProteinKind,
} from '../recipes/recipes.mappers.js';

export { mapPantry, mapPreferences, mapRecipeRow, mapYesterdayMainProtein };
export type { PrismaRecipeWithRelations, ProteinKind };

export type PrismaPantryRowWithIngredient = {
  ingredientId: string;
  estimatedGrams: Prisma.Decimal;
  priority: string;
  expiresAt: Date | null;
};

export type PrismaPreferenceRow = {
  kind: string;
  ingredientId: string | null;
};

export type ProfileRow = {
  dietType: string;
  appliances: string[];
} | null;

/**
 * yesterdayMainProtein — ad-hoc lookup over yesterday's DINNER entry
 * (meal-plans module lands in MC-051). Returns null when the household
 * has no plan yesterday → NOT_CHICKEN_AGAIN stays a no-op.
 */
export async function fetchYesterdayMainProtein(
  prisma: {
    mealPlanDay: {
      findFirst: (args: Prisma.MealPlanDayFindFirstArgs) => Promise<{
        entries: Array<{
          recipe: {
            ingredients: Array<{
              grams: Prisma.Decimal;
              optional: boolean;
              ingredient: {
                canonicalName: string;
                category: { name: string } | null;
              } | null;
            }>;
          };
        }>;
      } | null>;
    };
  },
  householdId: string,
  now: Date,
): Promise<ProteinKind | null> {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const day = await prisma.mealPlanDay.findFirst({
    where: {
      date: {
        gte: new Date(
          Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()),
        ),
        lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      },
      mealPlan: { householdId },
    },
    include: {
      entries: {
        where: { mealType: 'DINNER' },
        orderBy: { position: 'asc' },
        take: 1,
        include: {
          recipe: {
            include: {
              ingredients: {
                include: { ingredient: { include: { category: { select: { name: true } } } } },
              },
            },
          },
        },
      },
    },
  });

  const dinner = day?.entries[0];
  if (!dinner) return null;

  const ingredients = dinner.recipe.ingredients.map((ri) => ({
    grams: ri.grams.toNumber(),
    optional: ri.optional,
    name: ri.ingredient?.canonicalName ?? 'unknown',
    categoryGroup: groupFor(ri.ingredient?.category?.name ?? null),
  }));

  return mapYesterdayMainProtein(ingredients);
}

// Local keyword mirror to avoid a circular import for one call site.
// Subset of GROUP_KEYWORDS in recipes.mappers.ts, intentionally limited
// to PROTEIN_GROUPS (MEAT/FISH/DAIRY/EGG) — QA fix #5: patterns here
// MUST stay consistent with the canonical table; drift is caught by the
// yesterdayMainProtein keyword-match unit tests.
const GROUPS: ReadonlyArray<[RegExp, 'MEAT' | 'FISH' | 'DAIRY' | 'EGG' | 'OTHER']> = [
  [/мясо|мясн|куриц|говяд|свин|баранин|телят|фарш|индейк|утк|кролик/i, 'MEAT'],
  [/рыб|морепрод|креветк|кальмар|лосос|тунец|селед|скумбр|треск|горбуш/i, 'FISH'],
  [/молоч|молок|сыр|творог|кефир|сметан|сливк/i, 'DAIRY'],
  [/яйц/i, 'EGG'],
];

function groupFor(categoryName: string | null): 'MEAT' | 'FISH' | 'DAIRY' | 'EGG' | 'OTHER' {
  if (!categoryName) return 'OTHER';
  for (const [pattern, group] of GROUPS) {
    if (pattern.test(categoryName)) return group;
  }
  return 'OTHER';
}
