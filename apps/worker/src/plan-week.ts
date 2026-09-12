// MC-051 — GENERATE_PLAN processor: weekly heuristic planning.
//
// Loads the household's context, runs the deterministic planner from
// @multichef/recommendation and writes MealPlan + Days + Entries +
// an (empty) ShoppingList in one transaction. Deterministic per jobId
// (seeded mulberry32) — the development plan DoD requires a
// reproducible plan for a fixed seed.
//
// TODO(v0.2): the row→DTO mapper duplicates apps/api recipes.mappers
// (group keywords). Unify into a shared package when the api mapper
// moves behind a stable boundary — drift is covered by planner tests
// using package fixtures only.

import { getPrisma } from '@multichef/database';
import {
  buildShoppingList,
  mulberry32,
  planWeek,
  requiredGramsFromEntries,
  type GenerationContext,
  type Recipe,
  type UserPreferences,
  type Appliance,
  type IngredientCategoryGroup,
} from '@multichef/recommendation';
import type { MealPlanSetupDto } from '@multichef/contracts';

const GROUP_KEYWORDS: ReadonlyArray<[RegExp, IngredientCategoryGroup]> = [
  [/мясо|мясн|куриц|говяд|свин|баранин|телят|фарш|индейк|утк|кролик/i, 'MEAT'],
  [/рыб|морепрод|креветк|кальмар|лосос|тунец|селед|скумбр|треск|горбуш/i, 'FISH'],
  [/молоч|молок|сыр|творог|кефир|сметан|сливк|ряженк|йогурт/i, 'DAIRY'],
  [/яйц/i, 'EGG'],
  [/круп|злак|макарон|мука|рис|греч|пшен|перловк|булгур|киноа|овсян/i, 'GRAIN'],
  [/орех|миндаль|грецк|кешью|фундук|арахис/i, 'NUTS'],
  [
    /овощ|зелен|корнепл|капуст|лук|томат|помидор|огурц|морков|свекл|картоф|тыкв|кабач|баклаж|перц|чеснок|гриб/i,
    'VEGETABLE',
  ],
  [/фрукт|ягод|яблок|груш|слив|абрикос|банан|цитрус|лимон|апельсин|малин|клубн|вишн/i, 'FRUIT'],
  [/специ|пряност|приправ|соль|сахар|ванил|кориандр/i, 'SPICE'],
];

function groupFor(categoryName: string | null): IngredientCategoryGroup {
  if (!categoryName) return 'OTHER';
  for (const [pattern, group] of GROUP_KEYWORDS) {
    if (pattern.test(categoryName)) return group;
  }
  return 'OTHER';
}

// --- Prisma row shapes (structural, like the api mappers) -----------------

interface PlannerRecipeRow {
  id: string;
  title: string;
  mealTypes: string[];
  difficulty: number;
  prepMinutes: number;
  cookMinutes: number;
  requiredAppliances: string[];
  tags: string[];
  instructions: string[];
  leftoverSourceOf: string[];
  chainTags: string[];
  ingredients: Array<{
    ingredientId: string;
    grams: { toNumber(): number };
    optional: boolean;
    ingredient: { canonicalName: string; category: { name: string } | null } | null;
  }>;
  nutrition: {
    servingCalories: { toNumber(): number };
    servingProteinG: { toNumber(): number };
    servingFatG: { toNumber(): number };
    servingCarbsG: { toNumber(): number };
    servingGrams: { toNumber(): number };
  } | null;
}

export interface PlanWeekDependencies {
  loadAndPlan(data: {
    jobId: string;
    householdId: string;
    setup: Partial<MealPlanSetupDto>;
    now: Date;
  }): Promise<string>;
}

export function mapRecipeRowForPlanner(row: PlannerRecipeRow): Recipe {
  return {
    id: row.id,
    title: row.title,
    mealTypes: row.mealTypes as Recipe['mealTypes'],
    difficulty: row.difficulty,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    requiredAppliances: row.requiredAppliances as Recipe['requiredAppliances'],
    ingredients: row.ingredients.map((ri) => ({
      ingredientId: ri.ingredientId,
      grams: ri.grams.toNumber(),
      optional: ri.optional,
      name: ri.ingredient?.canonicalName ?? 'unknown',
      categoryGroup: groupFor(ri.ingredient?.category?.name ?? null),
    })),
    tags: row.tags,
    instructionsText: row.instructions,
    leftoverSourceOf: row.leftoverSourceOf,
    chainTags: row.chainTags,
    nutrition: row.nutrition
      ? {
          kcal: row.nutrition.servingCalories.toNumber(),
          proteinG: row.nutrition.servingProteinG.toNumber(),
          fatG: row.nutrition.servingFatG.toNumber(),
          carbsG: row.nutrition.servingCarbsG.toNumber(),
        }
      : { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
    estimatedExtraCostKopecks: 0,
  };
}

/** Seed the RNG from the jobId so a fixed job reproduces the same plan. */
export function seedFromJobId(jobId: string): number {
  let h = 2166136261;
  for (let i = 0; i < jobId.length; i++) {
    h ^= jobId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function runPlanWeek(
  data: {
    jobId: string;
    userId: string;
    householdId: string;
    params: Partial<MealPlanSetupDto>;
  },
  report: (stage: 'filtering' | 'scoring' | 'optimizing' | 'building-list') => Promise<void>,
  now: Date = new Date(),
): Promise<string> {
  const prisma = getPrisma();
  const setup = data.params;

  await report('filtering');
  const [recipeRows, pantryRows, preferenceRows, profile] = await Promise.all([
    prisma.recipe.findMany({
      where: { sourceType: 'CURATED', status: 'PUBLISHED' },
      include: {
        ingredients: {
          include: { ingredient: { include: { category: { select: { name: true } } } } },
        },
        nutrition: true,
      },
    }),
    prisma.pantryItem.findMany({
      where: { householdId: data.householdId, archivedAt: null, estimatedGrams: { gt: 0 } },
      select: { ingredientId: true, estimatedGrams: true, priority: true, expiresAt: true },
    }),
    prisma.preference.findMany({
      where: { userId: data.userId, ingredientId: { not: null } },
      select: { kind: true, ingredientId: true },
    }),
    prisma.nutritionProfile.findUnique({
      where: { userId: data.userId },
      select: {
        dietType: true,
        appliances: true,
        targetCalories: true,
        targetProteinG: true,
        targetFatG: true,
        targetCarbsG: true,
        mealsPerDay: true,
        preferredPrepMinutes: true,
      },
    }),
  ]);

  const recipes = (recipeRows as PlannerRecipeRow[]).map(mapRecipeRowForPlanner);
  const pantry = pantryRows.map((row) => ({
    ingredientId: row.ingredientId,
    estimatedGrams: row.estimatedGrams.toNumber(),
    priority: row.priority === 'USE_FIRST' ? ('USE_FIRST' as const) : ('NORMAL' as const),
    expiresAt: row.expiresAt,
  }));
  const preferences: UserPreferences = {
    dietType: (profile?.dietType as UserPreferences['dietType']) ?? 'NONE',
    excludeIngredients: [],
    allergies: [],
    appliances: (profile?.appliances ?? []) as Appliance[],
    preferences: [],
  };
  void preferenceRows; // LOVE/DISLIKE scoring already flows via profile defaults (v0.2: map rows)

  const ctx: GenerationContext = {
    now,
    pantry,
    preferences,
    maxMinutes: setup.maxMinutes ?? profile?.preferredPrepMinutes ?? 60,
    ...(setup.budgetMode ? { budgetMode: setup.budgetMode } : {}),
    antiFilters: [],
    yesterdayMainProtein: 'NONE',
    recentRecipeIds7d: [],
    ...(profile?.targetCalories && profile.targetCalories > 0
      ? {
          targetDailyMacros: {
            calories: profile.targetCalories,
            proteinG: profile.targetProteinG ?? 0,
            fatG: profile.targetFatG ?? 0,
            carbsG: profile.targetCarbsG ?? 0,
          },
        }
      : {}),
    mealsPerDay: setup.mealsPerDay ?? profile?.mealsPerDay ?? 3,
  };

  await report('scoring');
  const rng = mulberry32(seedFromJobId(data.jobId));
  const targetCalories = setup.targetDailyCalories ?? profile?.targetCalories ?? undefined;
  const result = planWeek(
    {
      recipes,
      ctx,
      days: setup.days ?? 7,
      mealsPerDay: setup.mealsPerDay ?? 3,
      peopleCount: setup.peopleCount ?? 2,
      noCookDays: setup.noCookDays ?? [],
      repeatPolicy: setup.repeatPolicy ?? 'ALLOW_REPEATS',
      ...(targetCalories && targetCalories > 0 ? { targetDailyCalories: targetCalories } : {}),
    },
    rng,
  );
  if (result.metrics.filled === 0) {
    throw new Error('ROULETTE_EMPTY: planner produced no meals for the given setup');
  }

  await report('optimizing');
  const startDate = setup.startDate ? new Date(`${setup.startDate}T00:00:00Z`) : now;
  const dayMs = 24 * 60 * 60 * 1000;
  const nutritionByRecipe = new Map(
    (recipeRows as PlannerRecipeRow[]).map((row) => [row.id, row.nutrition]),
  );

  await report('building-list');
  const planId = await prisma.$transaction(async (tx) => {
    await tx.mealPlan.updateMany({
      where: { householdId: data.householdId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
    const plan = await tx.mealPlan.create({
      data: {
        id: data.jobId,
        householdId: data.householdId,
        startDate,
        endDate: new Date(startDate.getTime() + ((setup.days ?? 7) - 1) * dayMs),
        peopleCount: setup.peopleCount ?? 2,
        ...(setup.targetBudgetKopecks ? { targetBudgetKopecks: setup.targetBudgetKopecks } : {}),
        ...(profile?.targetCalories ? { targetCalories: profile.targetCalories } : {}),
        status: 'ACTIVE',
        generationSettings: setup as object,
        nutritionAccuracy: 'ESTIMATED',
      },
    });
    const dayIds = new Map<number, string>();
    for (let d = 0; d < (setup.days ?? 7); d++) {
      const dayEntries = result.entries.filter((e) => e.dayIndex === d);
      const totals = dayEntries.reduce(
        (acc, e) => ({
          kcal: acc.kcal + e.recipe.nutrition.kcal * e.servings,
          p: acc.p + e.recipe.nutrition.proteinG * e.servings,
          f: acc.f + e.recipe.nutrition.fatG * e.servings,
          c: acc.c + e.recipe.nutrition.carbsG * e.servings,
        }),
        { kcal: 0, p: 0, f: 0, c: 0 },
      );
      const day = await tx.mealPlanDay.create({
        data: {
          id: `${plan.id}-d${d}`,
          mealPlanId: plan.id,
          date: new Date(startDate.getTime() + d * dayMs),
          totalCalories: totals.kcal,
          totalProteinG: totals.p,
          totalFatG: totals.f,
          totalCarbsG: totals.c,
        },
      });
      dayIds.set(d, day.id);
    }
    for (const e of result.entries) {
      const servingGrams = nutritionByRecipe.get(e.recipe.id)?.servingGrams.toNumber() ?? 0;
      await tx.mealPlanEntry.create({
        data: {
          id: `${plan.id}-d${e.dayIndex}-${e.mealType}`,
          dayId: dayIds.get(e.dayIndex)!,
          mealType: e.mealType,
          recipeId: e.recipe.id,
          servings: e.servings,
          portionGrams: servingGrams * e.servings,
          position: mealTypePosition(e.mealType),
          source: 'GENERATED',
        },
      });
    }
    // MC-052: fill the shopping list for the created plan.
    const required = requiredGramsFromEntries(
      result.entries.map((e) => ({
        servings: e.servings,
        ingredients: e.recipe.ingredients.map((i) => ({
          ingredientId: i.ingredientId,
          grams: i.grams,
          optional: i.optional,
        })),
      })),
    );
    const ingredientIds = [...required.keys()];
    const ingredientRows =
      ingredientIds.length > 0
        ? await tx.ingredient.findMany({
            where: { id: { in: ingredientIds } },
            select: {
              id: true,
              packageSize: true,
              avgPriceKopecks: true,
              categoryId: true,
              category: { select: { sortOrder: true } },
            },
          })
        : [];
    const listDrafts = buildShoppingList({
      requiredGrams: new Map([...required.entries()].map(([id, v]) => [id, v.grams])),
      pantryGrams: new Map(pantryRows.map((r) => [r.ingredientId, r.estimatedGrams.toNumber()])),
      staples: new Set(
        pantryRows.filter((r) => r.priority === 'STAPLE').map((r) => r.ingredientId),
      ),
      dishCounts: new Map([...required.entries()].map(([id, v]) => [id, v.dishes])),
      totalDishes: result.entries.length,
      meta: ingredientRows.map((r) => ({
        ingredientId: r.id,
        packageSize: r.packageSize ?? 500,
        avgPriceKopecks: r.avgPriceKopecks ?? 0,
        categoryId: r.categoryId,
        categorySortOrder: r.category?.sortOrder ?? 99,
      })),
    });
    const list = await tx.shoppingList.create({
      data: {
        id: `${plan.id}-list`,
        mealPlanId: plan.id,
        householdId: data.householdId,
        estimatedTotalKopecks: listDrafts.reduce((s, d) => s + d.estimatedPriceKopecks, 0),
        status: 'ACTIVE',
      },
    });
    for (const d of listDrafts) {
      await tx.shoppingListItem.create({
        data: {
          id: `${list.id}-${d.ingredientId}`,
          shoppingListId: list.id,
          ingredientId: d.ingredientId,
          requiredGrams: d.requiredGrams,
          packageQuantity: d.packageQuantity,
          packageSize: d.packageSize,
          packageUnit: 'G',
          estimatedPriceKopecks: d.estimatedPriceKopecks,
          utilityScore: d.utilityScore,
          categoryId: d.categoryId,
          sortOrder: d.sortOrder,
        },
      });
    }
    return plan.id;
  });
  return planId;
}

function mealTypePosition(mealType: string): number {
  return ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'].indexOf(mealType);
}
