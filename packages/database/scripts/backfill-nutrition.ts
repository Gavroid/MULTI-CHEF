// MC-085 — one-shot backfill: runs seed stages 6+7 (IngredientNutrition
// upsert + RecipeNutrition recompute to calculationVersion 2) without
// re-running the full seed. The main seed runner (src/seed/index.ts) does
// not wire the nutrition stages, so prod DBs start with an empty
// IngredientNutrition table and v1 recipe facts.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedIngredientNutrition, recomputeRecipeNutrition } from '../src/seed/nutrition/index.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const s6 = await seedIngredientNutrition(prisma);
    console.log(
      `backfill: IngredientNutrition — ${s6.resolved} resolved, ${s6.unresolved.length} unresolved`,
    );
    if (s6.unresolved.length > 0) {
      console.log(`  unresolved: ${s6.unresolved.join(', ')}`);
    }

    const s7 = await recomputeRecipeNutrition(prisma);
    console.log(
      `backfill: RecipeNutrition — ${s7.recomputed} recomputed (v2), ` +
        `${s7.skipped} skipped, ${s7.drift.length} drift >10%`,
    );
    for (const d of s7.drift) {
      console.log(`  drift: ${d.title}: ${Math.round(d.oldKcal)} -> ${Math.round(d.newKcal)} kcal`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
