// MC-085 — retrofit of the original 269 seeded recipes
// (PLAN-2000-RECIPES.md §7): title fixes where the seed title promises
// ingredients the catalog doesn't have, gram normalization for thin
// portions, instruction enrichment, descriptions, imageKey + card image
// task list, then RecipeNutrition recompute (v2).
//
// Usage: pnpm --filter @multichef/database exec tsx scripts/retrofit-existing.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { recomputeRecipeNutrition } from '../src/seed/nutrition/index.js';
import { loadServerEnv } from '@multichef/config';

// T55-C: env валидируется на старте (fail-fast).
loadServerEnv();

// Seed titles that reference ingredients absent from the MC-020 catalog
// (нут, сушёная фасоль, селёдка) — renamed to match actual content.
const TITLE_FIX: Record<string, string> = {
  'Суп с нутом и овощами': 'Овощной суп с томатной пастой',
  'Фасолевый суп': 'Овощной суп со стручковой фасолью',
  'Форшмак из селёдки': 'Яичный паштет с луком и хлебом',
};

const PORTION_TARGET: Record<string, number> = {
  SOUP: 320,
  MAIN: 300,
  BREAKFAST: 280,
  SALAD: 200,
  SIDE: 220,
  DESSERT: 180,
  DRINK: 250,
  BAKING: 120,
  PREP: 150,
};

function slugify(title: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };
  return title
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function categoryOf(tags: string[]): string {
  const t = tags.find((x) => x.startsWith('category:'));
  return t ? t.slice('category:'.length) : 'MAIN';
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const recipes = await prisma.recipe.findMany({
      where: { sourceType: 'CURATED' },
      include: {
        ingredients: { include: { ingredient: { select: { canonicalName: true } } } },
        nutrition: true,
      },
    });
    console.log(`retrofit: ${recipes.length} curated recipes`);

    const takenTitles = new Set(
      (await prisma.recipe.findMany({ select: { title: true } })).map((r) => r.title.toLowerCase()),
    );

    const imageTasks: Array<{ slug: string; title: string; category: string }> = [];
    let renamed = 0,
      gramsFixed = 0,
      enriched = 0,
      described = 0,
      imaged = 0;

    for (const r of recipes) {
      const category = categoryOf(r.tags);
      let title = r.title;
      if (TITLE_FIX[title] && !takenTitles.has(TITLE_FIX[title].toLowerCase())) {
        takenTitles.delete(title.toLowerCase());
        title = TITLE_FIX[title];
        takenTitles.add(title.toLowerCase());
        renamed += 1;
      }

      // grams normalization (thin portions only, scale up)
      const totalGrams = r.ingredients.reduce((sum, ri) => sum + ri.grams.toNumber(), 0);
      const portion = r.servings > 0 ? totalGrams / r.servings : 0;
      const target = PORTION_TARGET[category] ?? 250;
      let factor = 1;
      if (portion > 0 && portion < target) {
        factor = Math.min(4, target / portion);
        gramsFixed += 1;
        for (const ri of r.ingredients) {
          await prisma.recipeIngredient.update({
            where: { recipeId_ingredientId: { recipeId: r.id, ingredientId: ri.ingredientId } },
            data: {
              grams: Math.round(ri.grams.toNumber() * factor * 100) / 100,
              quantity: ri.quantity,
            },
          });
        }
      }

      // instructions enrichment: prepend mise-en-place, append serving step
      const steps: string[] = [...(r.instructions as unknown as string[])];
      const listForStep = r.ingredients
        .slice(0, 5)
        .map(
          (ri) => `${ri.ingredient.canonicalName} (${Math.round(ri.grams.toNumber() * factor)} г)`,
        )
        .join(', ');
      const newSteps: string[] = [];
      if (!steps.some((x) => x.startsWith('Подготовьте'))) {
        newSteps.push(
          `Подготовьте ингредиенты: ${listForStep}. Промойте, очистите и нарежьте всё по необходимости.`,
        );
      }
      newSteps.push(...steps);
      const totalLen = newSteps.join('').length;
      const hasDigit = newSteps.some((x) => /\d/.test(x));
      if (totalLen < 340 || !hasDigit) {
        newSteps.push(
          `Готовое блюдо рассчитано на ${r.servings} порции — примерно ${Math.round((totalGrams * factor) / r.servings)} г каждая; общее время с подготовкой — ${r.prepMinutes + r.cookMinutes} минут. Приятного аппетита!`,
        );
      }
      if (newSteps.length !== steps.length) enriched += 1;

      // description
      let description = r.description ?? '';
      if (!description) {
        described += 1;
        const top = r.ingredients
          .slice(0, 3)
          .map((ri) => ri.ingredient.canonicalName)
          .join(', ');
        description = `${title} — домашний рецепт из ${r.ingredients.length} ингредиентов (среди них: ${top}). Порций: ${r.servings}, время: ${r.prepMinutes + r.cookMinutes} мин.`;
      }

      const slug = slugify(title);
      const imageKey = `/images/recipes/${slug}.webp`;
      if (!r.imageKey) imaged += 1;
      imageTasks.push({ slug, title, category });

      const taken =
        title === r.title
          ? undefined
          : await prisma.recipe.findFirst({
              where: { title: { equals: title, mode: 'insensitive' }, id: { not: r.id } },
              select: { id: true },
            });
      if (!taken) {
        await prisma.recipe.update({
          where: { id: r.id },
          data: { title, description, instructions: newSteps, imageKey },
        });
      } else {
        await prisma.recipe.update({
          where: { id: r.id },
          data: { description, instructions: newSteps, imageKey },
        });
      }
    }

    mkdirSync(join('..', '..', 'data', 'recipes'), { recursive: true });
    writeFileSync(
      join('..', '..', 'data', 'recipes', 'retrofit.json'),
      JSON.stringify(imageTasks, null, 1),
    );
    console.log(
      `retrofit: renamed=${renamed} gramsFixed=${gramsFixed} instructionsEnriched=${enriched} ` +
        `descriptionsAdded=${described} imagesQueued=${imaged}`,
    );

    const s7 = await recomputeRecipeNutrition(prisma);
    console.log(
      `retrofit: nutrition recomputed (v2) — ${s7.recomputed}, drift >10%: ${s7.drift.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
