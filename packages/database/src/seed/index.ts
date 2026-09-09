// MC-020 — Seed runner.
//
// Pipeline:
//   1. Upsert 8 IngredientCategory rows by slug.
//   2. Upsert 300 Ingredient rows by canonicalName (categoryId resolved
//      from step 1).
//   3. Insert IngredientAlias rows. PK is (alias, locale) so a fresh
//      `createMany({ skipDuplicates: true })` is idempotent without
//      needing explicit upserts.
//   4. Demo household + member row (skipped if DEMO_USER_EMAIL doesn't
//      exist yet — register a user at that email via the API to wire
//      up the demo flow).
//
// Idempotency:
//   * Categories: upsert by slug.
//   * Ingredients: upsert by canonicalName.
//   * Aliases: createMany skipDuplicates — running the seed twice is
//     a no-op.
//   * Demo household: skipped if a household with that id already
//     exists.

import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CATEGORIES } from './categories.js';
import { INGREDIENTS } from './ingredients.js';
import { buildAliasIndex } from './aliases.js';
import { DEMO_HOUSEHOLD, DEMO_HOUSEHOLD_OWNER_EMAIL } from './demo-household.js';
import { seedRecipes, RECIPES } from './recipes/index.js';

const LOCALE_RU = 'ru';

// The seed only needs DATABASE_URL — we deliberately do not call
// loadServerEnv() (which requires REDIS_URL, SESSION_SECRET, etc.)
// because the seed is a pure catalog script.
function loadDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url || url.length === 0) {
    throw new Error('DATABASE_URL is required for `pnpm db:seed`.');
  }
  return url;
}

function ulid(): string {
  return randomBytes(13).toString('hex').toUpperCase().padEnd(26, '0').slice(0, 26);
}

async function main(): Promise<void> {
  const url = loadDatabaseUrl();
  console.log('seed: connecting…');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    // 1. Categories
    console.log('seed: upserting 8 categories…');
    const categoryIds = new Map<string, string>();
    for (const cat of CATEGORIES) {
      // Try insert first; on unique-constraint failure (slug collision
      // on a future migration) fall back to update. Today the schema
      // doesn't enforce slug uniqueness so this is upsert-by-name.
      const existing = await prisma.ingredientCategory.findFirst({
        where: { name: cat.name },
      });
      if (existing) {
        categoryIds.set(cat.slug, existing.id);
      } else {
        const created = await prisma.ingredientCategory.create({
          data: {
            id: ulid(),
            name: cat.name,
            sortOrder: cat.sortOrder,
          },
        });
        categoryIds.set(cat.slug, created.id);
      }
    }
    console.log(`seed: ${categoryIds.size} categories ready`);

    // 2. Ingredients (upsert by canonicalName)
    console.log(`seed: upserting ${INGREDIENTS.length} ingredients…`);
    let ingCreated = 0;
    let ingUpdated = 0;
    for (const ing of INGREDIENTS) {
      const categoryId = categoryIds.get(ing.category);
      if (!categoryId) {
        throw new Error(`unknown category slug: ${ing.category}`);
      }
      const existing = await prisma.ingredient.findUnique({
        where: { canonicalName: ing.canonicalName },
      });
      const data = {
        canonicalName: ing.canonicalName,
        categoryId,
        defaultUnit: ing.defaultUnit,
        packageSize: ing.packageSize,
        avgPriceKopecks: ing.avgPriceKopecks,
        defaultShelfDaysFridge: ing.defaultShelfDaysFridge,
        defaultShelfDaysPantry: ing.defaultShelfDaysPantry,
        defaultShelfDaysFreezer: ing.defaultShelfDaysFreezer,
        density: ing.density,
        ediblePartRatio: ing.ediblePartRatio,
        status: 'ACTIVE' as const,
      };
      if (existing) {
        await prisma.ingredient.update({
          where: { id: existing.id },
          data,
        });
        ingUpdated += 1;
      } else {
        await prisma.ingredient.create({
          data: { id: ulid(), ...data },
        });
        ingCreated += 1;
      }
    }
    console.log(`seed: ingredients — ${ingCreated} created, ${ingUpdated} updated`);

    // 3. Aliases (createMany skipDuplicates is idempotent for the
    //    (alias, locale) PK).
    const aliasIndex = buildAliasIndex(INGREDIENTS);
    const aliasRows: { ingredientId: string; alias: string; locale: string }[] = [];
    for (const [canonicalName, aliases] of Object.entries(aliasIndex[LOCALE_RU])) {
      const ing = await prisma.ingredient.findUnique({
        where: { canonicalName },
        select: { id: true },
      });
      if (!ing) continue;
      for (const alias of aliases) {
        aliasRows.push({
          ingredientId: ing.id,
          alias,
          locale: LOCALE_RU,
        });
      }
    }
    // createMany with skipDuplicates is one round-trip; idempotent.
    if (aliasRows.length > 0) {
      console.log(`seed: inserting ${aliasRows.length} aliases (skipDuplicates)…`);
      await prisma.ingredientAlias.createMany({
        data: aliasRows,
        skipDuplicates: true,
      });
    }

    // 4. Demo household + member. Only inserted if the demo user
    //    already exists (created via /api/v1/auth/register earlier).
    const demoUser = await prisma.user.findUnique({
      where: { email: DEMO_HOUSEHOLD_OWNER_EMAIL },
    });
    if (demoUser) {
      const existingHh = await prisma.household.findUnique({
        where: { id: DEMO_HOUSEHOLD.id },
      });
      if (!existingHh) {
        await prisma.household.create({
          data: {
            id: DEMO_HOUSEHOLD.id,
            name: DEMO_HOUSEHOLD.name,
            ownerId: demoUser.id,
            defaultPeopleCount: DEMO_HOUSEHOLD.defaultPeopleCount,
            currency: DEMO_HOUSEHOLD.currency,
          },
        });
        console.log('seed: demo household created');
      } else {
        console.log('seed: demo household already present');
      }
      const existingMember = await prisma.householdMember.findFirst({
        where: { householdId: DEMO_HOUSEHOLD.id, userId: demoUser.id },
      });
      if (!existingMember) {
        await prisma.householdMember.create({
          data: {
            householdId: DEMO_HOUSEHOLD.id,
            userId: demoUser.id,
            role: 'OWNER',
          },
        });
        console.log('seed: demo household OWNER member added');
      }
    } else {
      console.log(
        `seed: demo user ${DEMO_HOUSEHOLD_OWNER_EMAIL} not found — skipping demo household. ` +
          'Register via /api/v1/auth/register to enable the demo flow.',
      );
    }

    // 5. Recipes + RecipeIngredient + RecipeNutrition + StorageRule +
    //    chain tags (MC-031 stage). Runs after ingredients so the FK
    //    map in seedRecipes() can resolve canonicalName → id.
    console.log(`seed: upserting ${RECIPES.length} recipes…`);
    const recipeStats = await seedRecipes(prisma);
    console.log(
      `seed: recipes — ${recipeStats.recipesCreated} created, ${recipeStats.recipesUpdated} updated, ` +
        `${recipeStats.recipeIngredients} ingredients, ${recipeStats.nutrition} nutrition, ` +
        `${recipeStats.storageRules} storage rules`,
    );

    // Summary
    const totalIngs = await prisma.ingredient.count();
    const totalAliases = await prisma.ingredientAlias.count();
    const totalRecipes = await prisma.recipe.count();
    console.log(
      `seed: done — ${totalIngs} ingredients, ${totalAliases} aliases, ${totalRecipes} recipes total in DB`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
