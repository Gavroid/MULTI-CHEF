// recipe-client — typed fetch wrapper for /api/v1/recipes/:id (MC-035).
//
// MC-033 (backend /recipes endpoints) is NOT merged yet, so until then
// the page runs against fixtures: set NEXT_PUBLIC_USE_RECIPE_FIXTURES=1
// and getRecipe() serves the local catalog from recipe-fixtures.json
// without touching the network. In production the flag must be 0 (the
// default) — the fixture branch is then unreachable and every call goes
// through request<T>() like every other client.
//
// The RecipeDetail shape mirrors PRD §3.2 (Recipe / RecipeIngredient /
// RecipeNutrition / StorageRule) and the ADR for MC-035. When MC-033
// freezes the wire contract, these types move to packages/contracts in
// a dedicated migration task (manager decision, MC-035 pre-ADR Q3).
//
// Scaling helpers (servingsFactor / scaledIngredientGrams /
// nutritionForServings / formatMacro) are pure so the UI components stay
// render-only and the double-rounding guard
// (recipe/[id]/__tests__/scaleNutrition-usage.test.ts) has a single
// place to look at: nutritionForServings calls scaleNutrition ONCE and
// must never be wrapped in another round.

import { type ApiResponse, type ErrorEnvelope, request } from './auth-client';
import { getApiBaseUrl } from './env';
import { scaleNutrition, type NutritionFacts } from '@multichef/nutrition';
import recipeFixtures from './recipe-fixtures.json';

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export type StorageMethod =
  'FREEZE_OK' | 'FRIDGE_ONLY' | 'PARTIAL_PREP' | 'NO_PREP' | 'ADD_BEFORE_SERVING';

export interface RecipeIngredientLine {
  ingredientId: string;
  canonicalName: string;
  /** Canonical grams for the recipe's BASE servings count. */
  grams: number;
  optional: boolean;
  substitutesFor: string | null;
}

export interface RecipeInstructionStep {
  order: number;
  text: string;
  timerMinutes: number | null;
}

export interface RecipeNutritionBlock {
  servingCalories: number;
  servingProteinG: number;
  servingFatG: number;
  servingCarbsG: number;
  servingGrams: number;
  calculationVersion: number;
}

export interface RecipeStorageRule {
  storageMethod: StorageMethod;
  maxHoursFridge: number | null;
  maxDaysFreezer: number | null;
  addBeforeServing: string[];
}

export interface RecipeDetail {
  id: string;
  title: string;
  description: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: 1 | 2 | 3;
  imageKey: string | null;
  mealTypes: MealType[];
  tags: string[];
  requiredAppliances: string[];
  ingredients: RecipeIngredientLine[];
  instructions: RecipeInstructionStep[];
  nutrition: RecipeNutritionBlock;
  storageRules: RecipeStorageRule[];
  nutritionAccuracy: 'ESTIMATED';
}

export interface GetRecipeDeps {
  /** Override the API base URL (tests / SSR cookie-forwarding callers). */
  baseUrl?: string;
}

/** True when the dev fixtures catalog should be served instead of the API. */
export function usesRecipeFixtures(): boolean {
  return process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'] === '1';
}

/** Catalog served in fixture mode (NEXT_PUBLIC_USE_RECIPE_FIXTURES=1). */
const fixtureCatalog = recipeFixtures as unknown as {
  recipes: RecipeDetail[];
};

function fixtureNotFound(id: string): ErrorEnvelope {
  return {
    status: 404,
    error: { code: 'RECIPE_NOT_FOUND', message: `Рецепт не найден: ${id}` },
  };
}

/**
 * Fetch one published recipe with its ingredients, nutrition and
 * storage rules. Never throws — network failures come back as
 * `{ error }` (NETWORK_ERROR) per the auth-client envelope.
 */
export async function getRecipe(
  id: string,
  deps: GetRecipeDeps = {},
): Promise<ApiResponse<RecipeDetail>> {
  if (usesRecipeFixtures()) {
    const found = fixtureCatalog.recipes.find((recipe) => recipe.id === id);
    if (found) return { data: found };
    return { error: fixtureNotFound(id) };
  }
  const base = deps.baseUrl ?? getApiBaseUrl();
  return request<RecipeDetail>(
    `${base}/api/v1/recipes/${encodeURIComponent(id)}`,
    'GET',
    undefined,
    {},
  );
}

/* ------------------------------------------------------------------ */
/* Pure scaling helpers (servings stepper math)                        */
/* ------------------------------------------------------------------ */

/** Servings the UI allows — PRD stepper range; also the URL clamp. */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 12;

/** Clamp a raw servings value into the legal 1..12 range (red flag #2/#9). */
export function clampServings(value: number): number {
  if (!Number.isFinite(value)) return MIN_SERVINGS;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(value)));
}

/**
 * Scale factor for ingredient grams. Callers guarantee recipeServings ≥ 1
 * (clamped upstream), so the division can not produce Infinity/NaN.
 */
export function servingsFactor(servings: number, recipeServings: number): number {
  return servings / recipeServings;
}

/**
 * Display grams for one ingredient line at the target servings.
 * Rounded ONCE for display only — this is grams, not nutrition facts;
 * the state keeps the original `grams` for lossless round-trips.
 */
export function scaledIngredientGrams(grams: number, factor: number): number {
  return Math.round(grams * factor);
}

/**
 * Rescale the dish nutrition from its base servings to `servings`.
 *
 * Wraps @multichef/nutrition's scaleNutrition — which already rounds
 * internally per the PRD convention (kcal to 1, macros to 0.1 g) — so
 * callers MUST NOT round the result again. Per-serving facts are
 * constant by definition; only the dish total scales.
 */
export function nutritionForServings(
  recipe: Pick<RecipeDetail, 'servings' | 'nutrition'>,
  servings: number,
): { total: NutritionFacts; perServing: NutritionFacts } {
  const safeBase = clampServings(recipe.servings);
  return scaleNutrition(
    {
      total: {
        kcal: recipe.nutrition.servingCalories * safeBase,
        proteinG: recipe.nutrition.servingProteinG * safeBase,
        fatG: recipe.nutrition.servingFatG * safeBase,
        carbsG: recipe.nutrition.servingCarbsG * safeBase,
      },
      perServing: {
        kcal: recipe.nutrition.servingCalories,
        proteinG: recipe.nutrition.servingProteinG,
        fatG: recipe.nutrition.servingFatG,
        carbsG: recipe.nutrition.servingCarbsG,
      },
      currentServings: safeBase,
    },
    servings,
  );
}

/** "37" for integers, "12,3" for fractional macros (RU decimal comma). */
export function formatMacro(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

/**
 * True when the household's pantry covers `neededGrams` of the
 * ingredient (active rows only — archived rows are ignored).
 */
export function hasIngredientAmount(
  pantry: Array<{ ingredientId: string; estimatedGrams: number; archivedAt: string | null }>,
  ingredientId: string,
  neededGrams: number,
): boolean {
  return pantry.some(
    (item) =>
      item.ingredientId === ingredientId &&
      item.archivedAt === null &&
      item.estimatedGrams >= neededGrams,
  );
}

/**
 * Ingredient ids covered by the pantry at the given servings — the seed
 * for the «есть дома» checkboxes while the user has not overridden any.
 */
export function pantryCoveredIds(
  recipe: Pick<RecipeDetail, 'ingredients'>,
  factor: number,
  pantry: Array<{ ingredientId: string; estimatedGrams: number; archivedAt: string | null }>,
): Set<string> {
  const covered = new Set<string>();
  for (const line of recipe.ingredients) {
    if (hasIngredientAmount(pantry, line.ingredientId, scaledIngredientGrams(line.grams, factor))) {
      covered.add(line.ingredientId);
    }
  }
  return covered;
}

/**
 * Required (non-optional) ingredients that are NOT checked «есть дома» —
 * drives the «Не хватает: N из M» warning badge (PRD §2.3.15).
 */
export function missingIngredients(
  recipe: Pick<RecipeDetail, 'ingredients'>,
  checked: Set<string>,
): RecipeIngredientLine[] {
  return recipe.ingredients.filter((line) => !line.optional && !checked.has(line.ingredientId));
}
