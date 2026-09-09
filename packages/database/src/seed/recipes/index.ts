// MC-031 — Recipe seed stage (stage 5 of the seed runner).
//
// Pipeline (idempotent, upsert by Recipe.title):
//   1. Resolve Ingredient ids by canonicalName (MC-020 catalog).
//   2. Upsert Recipe rows (title is the natural key; schema has no
//      unique constraint on it, so findFirst + create/update).
//   3. Full-replace RecipeIngredient rows per recipe (delete + create).
//   4. Upsert RecipeNutrition (1:1, recipeId PK).
//   5. Upsert StorageRule (1:0..1, matched by recipeTag) — method is
//      derived from shelf days: freezer>0 → FREEZE_OK, else FRIDGE_ONLY.
//   6. Chain tags: CHAIN_TAGS entries are written onto every member
//      recipe's chainTags[] (tag-level), leftoverSourceOf keeps the
//      recipe-level links from recipes.ts.
//
// Recipe.tags carries: category:<CAT> (first element), cuisine:<x>,
// season:<X>, diet:<X>. mealTypes / requiredAppliances have their own
// scalar columns.
//
// NOTE (schema honesty): Recipe.title has NO unique constraint and no
// @@index. This runner therefore does one findFirst per recipe — for
// ~270 rows that's fine for a seed script.

import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { RECIPES } from './recipes.js';
import { CHAIN_TAGS } from './chains.js';
import type { RecipeSeed } from './types.js';

export { RECIPES, CHAIN_TAGS };
export type { RecipeSeed };

function ulid(): string {
  return randomBytes(13).toString('hex').toUpperCase().padEnd(26, '0').slice(0, 26);
}

/** ["category:MAIN", "cuisine:русская", "season:ALL_YEAR", ...] */
export function buildRecipeTags(recipe: RecipeSeed): string[] {
  return [
    `category:${recipe.category}`,
    ...recipe.cuisineTags.map((c) => `cuisine:${c}`),
    ...recipe.seasonTags.map((s) => `season:${s}`),
    ...recipe.dietTags.map((d) => `diet:${d}`),
  ];
}

/** StorageRule row for a recipe, or null if the recipe has no rule. */
export function storageRuleData(recipe: RecipeSeed) {
  if (!recipe.storageRule) return null;
  const freezerDays = recipe.storageRule.shelfDaysFreezer;
  return {
    recipeTag: recipe.canonicalTitle,
    storageMethod: freezerDays > 0 ? ('FREEZE_OK' as const) : ('FRIDGE_ONLY' as const),
    maxHoursFridge: recipe.storageRule.shelfDaysFridge * 24,
    maxDaysFreezer: freezerDays,
    freezingAllowed: freezerDays > 0,
    partialPrepAllowed: true,
    notes: `Seed rule for «${recipe.canonicalTitle}»`,
  };
}

export async function seedRecipes(prisma: PrismaClient): Promise<{
  recipesCreated: number;
  recipesUpdated: number;
  recipeIngredients: number;
  nutrition: number;
  storageRules: number;
}> {
  // 1. Ingredient name → id map (single query).
  const ingredients = await prisma.ingredient.findMany({
    select: { id: true, canonicalName: true },
  });
  const ingredientIdByName = new Map(ingredients.map((i) => [i.canonicalName, i.id]));

  // 2. Chain tag map: recipe title → slugs of chains containing it.
  const chainSlugsByTitle = new Map<string, string[]>();
  for (const chain of CHAIN_TAGS) {
    for (const title of chain.titles) {
      const arr = chainSlugsByTitle.get(title) ?? [];
      arr.push(chain.slug);
      chainSlugsByTitle.set(title, arr);
    }
  }

  let recipesCreated = 0;
  let recipesUpdated = 0;
  let recipeIngredients = 0;
  let nutrition = 0;
  let storageRules = 0;

  for (const recipe of RECIPES) {
    // Validate ingredient references eagerly — fail the seed loudly on
    // an orphan FK instead of silently dropping the row.
    const ingredientRows = recipe.ingredients.map((ing) => {
      const ingredientId = ingredientIdByName.get(ing.canonicalName);
      if (!ingredientId) {
        throw new Error(
          `recipe "${recipe.canonicalTitle}": unknown ingredient "${ing.canonicalName}" (not in MC-020 catalog)`,
        );
      }
      return { ing, ingredientId };
    });

    const tags = buildRecipeTags(recipe);
    const chainTags = chainSlugsByTitle.get(recipe.canonicalTitle) ?? [];
    const leftover = recipe.leftoverSourceOf ?? [];

    const data = {
      title: recipe.canonicalTitle,
      servings: recipe.servings,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      // Difficulty enum in schema is Int 1..3 (BEGINNER=1, CONFIDENT=2,
      // EXPERIMENTER=3). The string form lives in tags: difficulty:<X>.
      difficulty: { BEGINNER: 1, CONFIDENT: 2, EXPERIMENTER: 3 }[recipe.difficulty],
      instructions: recipe.instructions,
      mealTypes: recipe.mealTypes,
      tags,
      requiredAppliances: recipe.requiredAppliances,
      leftoverSourceOf: leftover,
      chainTags,
      status: 'PUBLISHED' as const,
      sourceType: 'CURATED' as const,
    };

    const existing = await prisma.recipe.findFirst({
      where: { title: recipe.canonicalTitle },
      select: { id: true },
    });

    const recipeId = existing ? existing.id : ulid();

    if (existing) {
      await prisma.recipe.update({ where: { id: recipeId }, data });
      recipesUpdated += 1;
    } else {
      await prisma.recipe.create({ data: { id: recipeId, ...data } });
      recipesCreated += 1;
    }

    // 3. Full replace of RecipeIngredient (id PK is (recipeId, ingredientId)).
    await prisma.recipeIngredient.deleteMany({ where: { recipeId } });
    await prisma.recipeIngredient.createMany({
      data: ingredientRows.map(({ ing, ingredientId }) => ({
        recipeId,
        ingredientId,
        quantity: ing.quantityG,
        unit: ing.unit,
        // ML/PIECE rows keep the declared qty in `quantity` and the
        // gram equivalent in `grams` (PIECE ≈ qty g here; ML ≈ 1 g/ml).
        grams: ing.quantityG,
        optional: ing.optional,
      })),
    });
    recipeIngredients += ingredientRows.length;

    // 4. RecipeNutrition (PK = recipeId → upsert).
    await prisma.recipeNutrition.upsert({
      where: { recipeId },
      create: {
        recipeId,
        servingCalories: recipe.nutrition.kcal,
        servingProteinG: recipe.nutrition.proteinG,
        servingFatG: recipe.nutrition.fatG,
        servingCarbsG: recipe.nutrition.carbsG,
        servingGrams: 0,
        calculationVersion: 1,
      },
      update: {
        servingCalories: recipe.nutrition.kcal,
        servingProteinG: recipe.nutrition.proteinG,
        servingFatG: recipe.nutrition.fatG,
        servingCarbsG: recipe.nutrition.carbsG,
      },
    });
    nutrition += 1;

    // 5. StorageRule (matched by recipeTag).
    const rule = storageRuleData(recipe);
    if (rule) {
      const existingRule = await prisma.storageRule.findFirst({
        where: { recipeTag: recipe.canonicalTitle },
        select: { id: true },
      });
      if (existingRule) {
        await prisma.storageRule.update({ where: { id: existingRule.id }, data: rule });
      } else {
        await prisma.storageRule.create({ data: { id: ulid(), ...rule } });
      }
      storageRules += 1;
    }
  }

  return { recipesCreated, recipesUpdated, recipeIngredients, nutrition, storageRules };
}
