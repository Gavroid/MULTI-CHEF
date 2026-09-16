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

import type { PrismaClient } from '@prisma/client';
import { RECIPES } from './recipes.js';
import { CHAIN_TAGS } from './chains.js';
import type { RecipeSeed } from './types.js';
import { generateUlid as ulid } from '../../ulid.js';

export { RECIPES, CHAIN_TAGS };
export type { RecipeSeed };

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
  // T60-D: advisory lock — параллельные запуски seed сериализуются.
  await prisma.$executeRawUnsafe("SELECT pg_advisory_lock(hashtext('multichef-recipes-seed'))");

  let recipesCreated = 0;
  let recipesUpdated = 0;
  let recipeIngredients = 0;
  let nutrition = 0;
  let storageRules = 0;

  // 1. Ingredient name → id map (single query).
  const ingredients = await prisma.ingredient.findMany({
    select: { id: true, canonicalName: true },
  });
  const ingredientByCanonicalName = new Map(ingredients.map((i) => [i.canonicalName, i.id]));

  // 2. Chain tag map: recipe title → slugs of chains containing it.
  const chainSlugsByTitle = new Map<string, string[]>();
  for (const chain of CHAIN_TAGS) {
    for (const title of chain.titles) {
      const arr = chainSlugsByTitle.get(title) ?? [];
      arr.push(chain.slug);
      chainSlugsByTitle.set(title, arr);
    }
  }

  for (const recipe of RECIPES) {
    const ingredientRows = recipe.ingredients.map((ing) => {
      const ingredientId = ingredientByCanonicalName.get(ing.canonicalName);
      if (!ingredientId) throw new Error(`unknown ingredient: ${ing.canonicalName}`);
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

    // T60-B (audit round 60): рецепт + ингредиенты + нутрицы + правило —
    // одна транзакция; падение между шагами не оставит «голый» рецепт.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.recipe.findFirst({
        where: { title: recipe.canonicalTitle },
        select: { id: true },
      });

      const recipeId = existing ? existing.id : ulid();

      if (existing) {
        await tx.recipe.update({ where: { id: recipeId }, data });
        recipesUpdated += 1;
      } else {
        await tx.recipe.create({ data: { id: recipeId, ...data } });
        recipesCreated += 1;
      }

      // 3. Full replace of RecipeIngredient (PK = (recipeId, ingredientId)
      // — the model has NO id column; generateId() is not used here).
      await tx.recipeIngredient.deleteMany({ where: { recipeId } });
      await tx.recipeIngredient.createMany({
        data: ingredientRows.map((row) => ({
          recipeId,
          ingredientId: row.ingredientId,
          quantity: row.ing.quantityG,
          unit: row.ing.unit,
          grams: row.ing.quantityG,
          optional: row.ing.optional,
        })),
      });
      recipeIngredients += ingredientRows.length;

      // 4. RecipeNutrition (PK = recipeId → upsert).
      await tx.recipeNutrition.upsert({
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
        const existingRule = await tx.storageRule.findFirst({
          where: { recipeTag: recipe.canonicalTitle },
          select: { id: true },
        });
        if (existingRule) {
          await tx.storageRule.update({ where: { id: existingRule.id }, data: rule });
        } else {
          await tx.storageRule.create({ data: { id: ulid(), ...rule } });
        }
        storageRules += 1;
      }
    });
  }

  // T60-D: снимаем advisory lock в конце.
  await prisma.$executeRawUnsafe("SELECT pg_advisory_unlock(hashtext('multichef-recipes-seed'))");
  return { recipesCreated, recipesUpdated, recipeIngredients, nutrition, storageRules };
}

/** Deterministic ingredient-scoped id (26 chars, no slashes). */
