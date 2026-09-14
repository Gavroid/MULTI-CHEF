// MC-085 — wave importer (PLAN-2000-RECIPES.md §5.5). Upserts generated
// cards into the DB (idempotent, matched by case-insensitive title),
// replaces RecipeIngredient rows, computes RecipeNutrition v2 through
// @multichef/nutrition, sets sourceType=IMPORTED.
//
// Usage:
//   pnpm --filter @multichef/database exec tsx scripts/import-recipes.ts --wave 1
//   pnpm --filter @multichef/database exec tsx scripts/import-recipes.ts --wave 1 --publish
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join('..', '..', 'data');
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { computeRecipeNutrition } from '@multichef/nutrition';

const waveIdx = process.argv.indexOf('--wave');
const wave = waveIdx > -1 ? String(process.argv[waveIdx + 1]) : '1';
const publish = process.argv.includes('--publish');

function ulid(): string {
  return randomBytes(13).toString('hex').toUpperCase().padEnd(26, '0').slice(0, 26);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const waves = JSON.parse(readFileSync(join(DATA, 'recipes', 'waves.json'), 'utf8'));
    const slugs: string[] = waves[`wave${wave}`] ?? [];
    console.log(`import: wave${wave} — ${slugs.length} cards, publish=${publish}`);

    // ingredient name -> id cache
    const ingredients = await prisma.ingredient.findMany({
      select: { id: true, canonicalName: true },
    });
    const idByName = new Map(ingredients.map((i) => [i.canonicalName, i.id]));

    let created = 0,
      updated = 0,
      failed = 0;
    for (const slug of slugs) {
      const path = join(DATA, 'recipes', 'gen', `${slug}.json`);
      let card;
      try {
        card = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        console.error(`  skip (unreadable): ${slug}`);
        failed += 1;
        continue;
      }

      try {
        const existing = await prisma.recipe.findFirst({
          where: { title: { equals: card.title, mode: 'insensitive' } },
          select: { id: true },
        });

        const data = {
          title: card.title,
          description: card.description,
          servings: card.servings,
          prepMinutes: card.prepMinutes,
          cookMinutes: card.cookMinutes,
          difficulty: card.difficulty,
          imageKey: `/images/recipes/${slug}.webp`,
          instructions: card.instructions,
          mealTypes: card.mealTypes,
          tags: card.tags,
          requiredAppliances: card.requiredAppliances ?? [],
          sourceType: 'IMPORTED' as const,
          status: (publish ? 'PUBLISHED' : 'DRAFT') as 'PUBLISHED' | 'DRAFT',
        };

        const recipeId = existing
          ? (await prisma.recipe.update({ where: { id: existing.id }, data })).id
          : (await prisma.recipe.create({ data: { id: ulid(), ...data } })).id;
        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        // replace ingredient rows
        await prisma.recipeIngredient.deleteMany({ where: { recipeId } });
        const rows = [];
        for (const ing of card.ingredients) {
          const ingredientId = idByName.get(ing.ingredient);
          if (!ingredientId) throw new Error(`unknown ingredient: ${ing.ingredient}`);
          rows.push({
            recipeId,
            ingredientId,
            quantity: ing.quantity,
            unit: ing.unit,
            grams: ing.grams,
          });
        }
        await prisma.recipeIngredient.createMany({ data: rows });

        // nutrition v2 (same math as seed stage 7)
        const ingRows = await prisma.ingredient.findMany({
          where: { id: { in: rows.map((r) => r.ingredientId) } },
          select: {
            canonicalName: true,
            nutrition: {
              select: {
                caloriesPer100g: true,
                proteinPer100g: true,
                fatPer100g: true,
                carbsPer100g: true,
              },
            },
          },
        });
        const nutById = new Map(ingRows.map((i) => [i.canonicalName, i.nutrition]));
        const lines = card.ingredients.map((ing) => {
          const n = nutById.get(ing.ingredient);
          return {
            canonicalName: ing.ingredient,
            quantityG: ing.grams,
            ingredientNutrition: n
              ? {
                  servingSizeG: 100,
                  servingCalories: n.caloriesPer100g.toNumber(),
                  servingProteinG: n.proteinPer100g.toNumber(),
                  servingFatG: n.fatPer100g.toNumber(),
                  servingCarbsG: n.carbsPer100g.toNumber(),
                }
              : null,
          };
        });
        const result = computeRecipeNutrition({ servings: card.servings, ingredients: lines });
        const totalGrams = card.ingredients.reduce((sum, i) => sum + i.grams, 0);
        await prisma.recipeNutrition.upsert({
          where: { recipeId },
          create: {
            recipeId,
            servingCalories: result.perServing.kcal,
            servingProteinG: result.perServing.proteinG,
            servingFatG: result.perServing.fatG,
            servingCarbsG: result.perServing.carbsG,
            servingGrams: Math.round(totalGrams / card.servings),
            calculationVersion: 2,
          },
          update: {
            servingCalories: result.perServing.kcal,
            servingProteinG: result.perServing.proteinG,
            servingFatG: result.perServing.fatG,
            servingCarbsG: result.perServing.carbsG,
            servingGrams: Math.round(totalGrams / card.servings),
            calculationVersion: 2,
          },
        });
      } catch (err) {
        failed += 1;
        console.error(`  FAIL ${slug}: ${String((err as Error).message).slice(0, 140)}`);
      }
    }

    const total = await prisma.recipe.count();
    console.log(
      `import wave${wave}: created=${created} updated=${updated} failed=${failed}; total recipes in DB: ${total}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
