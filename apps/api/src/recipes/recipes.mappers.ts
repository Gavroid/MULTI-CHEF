// MC-033 — Prisma → domain mappers for the recipes catalog and the
// recommendations engine.
//
// Purity notes:
// - Prisma Decimal crosses the boundary via .toNumber() ONLY.
// - `instructions: Json` is validated with Zod on read; malformed
//   payloads degrade to [] (with a warn), never throw.
// - Ingredient.categoryGroup does not exist in the schema (MC-003);
//   we keyword-match category.name and fall back to OTHER.
//   TODO(MC-0XX): real migration — add categoryGroup enum column.

import { z } from 'zod';
import type {
  Recipe,
  RecipeIngredient,
  PantryItem,
  UserPreferences,
} from '@multichef/recommendation';
import type { IngredientCategory, Prisma } from '@prisma/client';
import { AppHttpException } from '../common/exception-filter.js';

// --- Instructions JSON ---------------------------------------------------

export const InstructionsSchema = z.array(
  z.object({
    order: z.number().int(),
    text: z.string(),
    timerMinutes: z.number().nullish(),
  }),
);

export interface InstructionStep {
  order: number;
  text: string;
  timerMinutes?: number | null;
}

// NOTE: explicit interface + cast instead of z.infer — zod 3.25's
// safeParse generic collapses a top-level z.array output to
// T[][] under moduleResolution=node (verified by probe); the cast is
// type-safe because the schema IS the source of truth here.
export function parseInstructions(
  json: Prisma.JsonValue,
  logger?: { warn(msg: string): void },
): InstructionStep[] {
  const parsed = InstructionsSchema.safeParse(json);
  if (parsed.success) return parsed.data as InstructionStep[];
  logger?.warn(
    `recipes: malformed instructions JSON — fallback to [] (${parsed.error.issues.length} issues)`,
  );
  return [];
}

// --- categoryGroup keyword matching (WEAK — see TODO above) --------------

const GROUP_KEYWORDS: ReadonlyArray<[RegExp, RecipeIngredient['categoryGroup']]> = [
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

export function mapCategoryToGroup(
  category: Pick<IngredientCategory, 'name'> | null | undefined,
): RecipeIngredient['categoryGroup'] {
  if (!category) return 'OTHER';
  for (const [pattern, group] of GROUP_KEYWORDS) {
    if (pattern.test(category.name)) return group;
  }
  return 'OTHER';
}

// --- Recipe row → package Recipe ------------------------------------------

/** Minimal structural type for the Prisma include used by the API. */
export type PrismaRecipeWithRelations = {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: number;
  instructions: Prisma.JsonValue;
  mealTypes: string[];
  tags: string[];
  requiredAppliances: string[];
  leftoverSourceOf: string[];
  chainTags: string[];
  ingredients: Array<{
    ingredientId: string;
    grams: Prisma.Decimal;
    optional: boolean;
    substitutesFor: string | null;
    ingredient: {
      id: string;
      canonicalName: string;
      avgPriceKopecks: number | null;
      category: Pick<IngredientCategory, 'name'> | null;
    } | null;
  }>;
};

export function toInstructionsText(steps: InstructionStep[]): string[] {
  return steps.map((s) => s.text);
}

export function mapRecipeRow(
  row: PrismaRecipeWithRelations,
  logger?: { warn(msg: string): void },
): Recipe {
  const steps = parseInstructions(row.instructions, logger);
  const ingredients: RecipeIngredient[] = row.ingredients.map((ri) => ({
    ingredientId: ri.ingredientId,
    categoryGroup: mapCategoryToGroup(ri.ingredient?.category),
    name: ri.ingredient?.canonicalName ?? ri.ingredientId,
    grams: ri.grams.toNumber(),
    optional: ri.optional,
  }));
  return {
    id: row.id,
    title: row.title,
    mealTypes: row.mealTypes as Recipe['mealTypes'],
    difficulty: row.difficulty,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    requiredAppliances: row.requiredAppliances as Recipe['requiredAppliances'],
    ingredients,
    tags: row.tags,
    instructionsText: toInstructionsText(steps),
    leftoverSourceOf: row.leftoverSourceOf,
    chainTags: row.chainTags,
    nutrition: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 }, // filled by caller when needed
    estimatedExtraCostKopecks: estimateExtraCostKopecks(row),
  };
}

/** Sum of avgPriceKopecks for ingredients NOT fully covered by the pantry. */
function estimateExtraCostKopecks(row: PrismaRecipeWithRelations): number {
  let sum = 0;
  for (const ri of row.ingredients) {
    const price = ri.ingredient?.avgPriceKopecks;
    if (typeof price === 'number' && Number.isFinite(price))
      sum += Math.round(price * (ri.grams.toNumber() / 100));
  }
  return sum;
}

// --- Pantry rows → package PantryItem -------------------------------------

export type PrismaPantryRow = {
  ingredientId: string;
  estimatedGrams: Prisma.Decimal;
  priority: string;
  expiresAt: Date | null;
};

export function mapPantry(rows: PrismaPantryRow[]): PantryItem[] {
  return rows.map((row) => ({
    ingredientId: row.ingredientId,
    estimatedGrams: row.estimatedGrams.toNumber(),
    priority: row.priority === 'USE_FIRST' ? ('USE_FIRST' as const) : ('NORMAL' as const),
    expiresAt: row.expiresAt,
  }));
}

// --- Preferences + profile → package UserPreferences -----------------------

export type PrismaPreferenceRow = {
  kind: string;
  ingredientId: string | null;
};

export type ProfileLike = {
  dietType: string;
  appliances: string[];
};

export function mapPreferences(
  rows: PrismaPreferenceRow[],
  profile: ProfileLike | null,
): UserPreferences {
  const allergyAndExclude = rows
    .filter((r) => (r.kind === 'ALLERGY' || r.kind === 'EXCLUDE') && r.ingredientId !== null)
    .map((r) => r.ingredientId as string);
  return {
    dietType: (profile?.dietType ?? 'NONE') as UserPreferences['dietType'],
    excludeIngredients: allergyAndExclude,
    allergies: rows
      .filter((r) => r.kind === 'ALLERGY' && r.ingredientId !== null)
      .map((r) => r.ingredientId as string),
    appliances: (profile?.appliances ?? ['STOVE']) as UserPreferences['appliances'],
    preferences: rows
      .filter((r) => (r.kind === 'LOVE' || r.kind === 'DISLIKE') && r.ingredientId !== null)
      .map((r) => ({
        kind: r.kind === 'LOVE' ? ('LOVE' as const) : ('DISLIKE' as const),
        ingredientId: r.ingredientId as string,
      })),
  };
}

// --- yesterdayMainProtein ---------------------------------------------------

export type ProteinKind = 'CHICKEN' | 'BEEF' | 'PORK' | 'FISH' | 'OTHER';

// WEAK: keyword matching on canonicalName — TODO replace with a real
// migration (ingredient.proteinKind column) once MC-0XX lands.
export const PROTEIN_KEYWORDS: ReadonlyArray<[RegExp, ProteinKind]> = [
  [/куриц|курица|куриное|куриный|цыпл|бройлер|chicken/i, 'CHICKEN'],
  [/говяд|телят|beef/i, 'BEEF'],
  [/свин|pork/i, 'PORK'],
  [/рыб|лосос|тунец|треск|горбуш|селед|скумбр|креветк|кальмар|fish/i, 'FISH'],
];

export function proteinKindForName(name: string): ProteinKind | null {
  for (const [pattern, kind] of PROTEIN_KEYWORDS) {
    if (pattern.test(name)) return kind;
  }
  return null;
}

/** Ingredient group names treated as potential "main protein" sources. */
const PROTEIN_GROUPS = new Set(['MEAT', 'FISH', 'DAIRY', 'EGG']);

export function mapYesterdayMainProtein(
  dinnerIngredients: Array<{
    categoryGroup: RecipeIngredient['categoryGroup'];
    name: string;
    grams: number;
  }>,
): ProteinKind | null {
  const candidates = dinnerIngredients
    .filter((i) => PROTEIN_GROUPS.has(i.categoryGroup))
    .sort((a, b) => b.grams - a.grams);
  for (const candidate of candidates) {
    const kind = proteinKindForName(candidate.name);
    if (kind) return kind;
  }
  // Protein-group ingredient without a keyword hit → generic.
  return candidates.length > 0 ? 'OTHER' : null;
}

// --- shared error -----------------------------------------------------------

export function recipeNotFoundError(id: string): AppHttpException {
  return new AppHttpException({
    code: 'RECIPE_NOT_FOUND',
    message: `Recipe ${id} not found or not published`,
  });
}
