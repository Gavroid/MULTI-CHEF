// MC-032 — DTO types for the recommendation package.
//
// These are the package's OWN types (no Prisma, no @multichef/database).
// apps/api maps DB rows → these DTOs (MC-033, mappers.ts). Units are
// stated at every field: grams, minutes, kopecks (integer money!),
// kcal/grams for macros.

// --- Shared enums -------------------------------------------------------
// TODO(MC-033): @multichef/contracts is an empty scaffold today (MC-001).
// When real enums land there, re-export from contracts and delete these
// local copies (ADR-0007 §7 default: re-export to avoid drift). Values
// mirror packages/database/prisma/schema.prisma enums where they exist.

export type Appliance =
  'STOVE' | 'OVEN' | 'MICROWAVE' | 'MULTICOOKER' | 'BLENDER' | 'MIXER' | 'AIRFRYER';

export type DietType = 'NONE' | 'VEGETARIAN' | 'VEGAN' | 'PESCATARIAN';

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

/** Ingredient group for diet/allergy checks (mirrors IngredientCategoryGroup). */
export type IngredientCategoryGroup =
  | 'MEAT'
  | 'FISH'
  | 'DAIRY'
  | 'EGG'
  | 'GLUTEN'
  | 'NUTS'
  | 'VEGETABLE'
  | 'FRUIT'
  | 'GRAIN'
  | 'SPICE'
  | 'OTHER';

export type PreferenceKind = 'LOVE' | 'DISLIKE' | 'ALLERGY' | 'EXCLUDE';

/** 8 anti-recipe chips (PRD §2.3.3 lists 7; NO_MULTISTEP is the agreed 8th — ADR §5). */
export type AntiFilter =
  | 'NO_OVEN'
  | 'ONE_PAN'
  | 'NOT_CHICKEN_AGAIN'
  | 'NO_LEFTOVERS'
  | 'NO_FRYING'
  | 'NO_CHOPPING'
  | 'SHORT_TIME'
  | 'NO_MULTISTEP';

export type BudgetMode = 'NOTHING' | 'MINIMAL' | 'NORMAL';

/** How a pantry item is prioritised in expiry tracking. */
export type PantryPriority = 'NORMAL' | 'USE_FIRST';

// --- Recipe DTO ---------------------------------------------------------

export interface RecipeIngredient {
  /** Canonical ingredient id (catalog id, not the Russian name). */
  ingredientId: string;
  /** Ingredient group — used by dietType/allergy filters. */
  categoryGroup: IngredientCategoryGroup;
  /** Human name for explain strings. */
  name: string;
  grams: number;
  optional: boolean;
}

export interface Recipe {
  id: string;
  title: string;
  mealTypes: MealType[];
  /** 1..3 (BEGINNER..EXPERIMENTER). */
  difficulty: number;
  prepMinutes: number;
  cookMinutes: number;
  requiredAppliances: Appliance[];
  ingredients: RecipeIngredient[];
  tags: string[];
  /** Instruction step texts (for NO_FRYING / NO_CHOPPING heuristics). */
  instructionsText: string[];
  /** Recipe-level chain links (leftover chains), may be empty. */
  leftoverSourceOf: string[];
  /** Per-serving macros (already mapped from RecipeNutrition by the caller). */
  nutrition: {
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  };
  /** Estimated extra-shopping cost in KOPECKS (integer; never a float). */
  estimatedExtraCostKopecks: number;
}

// --- Pantry / preferences / context -------------------------------------

export interface PantryItem {
  ingredientId: string;
  estimatedGrams: number;
  priority: PantryPriority;
  /** null/undefined = no known expiry (treated as non-urgent). */
  expiresAt?: Date | null;
}

export interface UserPreferences {
  dietType: DietType;
  /** Ingredient ids the user must never receive (allergy OR explicit exclude). */
  excludeIngredients: string[];
  /** Same list as excludeIngredients but semantically allergies; kept separate for explain. */
  allergies: string[];
  appliances: Appliance[];
  /** LOVE/DISLIKE preferences by ingredient id. */
  preferences: Array<{
    kind: Exclude<PreferenceKind, 'ALLERGY' | 'EXCLUDE'>;
    ingredientId: string;
  }>;
}

export interface GenerationContext {
  /** Injected clock — NEVER Date.now() inside the package. */
  now: Date;
  pantry: PantryItem[];
  preferences: UserPreferences;
  /** Remaining shopping budget in KOPECKS. Undefined = no budget constraint. */
  remainingBudgetKopecks?: number;
  maxMinutes: number;
  budgetMode?: BudgetMode;
  antiFilters: AntiFilter[];
  yesterdayMainProtein?: 'CHICKEN' | 'BEEF' | 'PORK' | 'FISH' | 'NONE';
  /** Recipe ids cooked in the last 7 days (varietyScore). */
  recentRecipeIds7d: string[];
  targetDailyMacros?: { calories: number; proteinG: number; fatG: number; carbsG: number };
  mealsPerDay: number;
  /** MC-040 rescue mode: only recipes containing this ingredient pass. */
  rescue?: { targetIngredientId: string };
}

// --- Scoring / filtering results ----------------------------------------

export interface FactorContribution {
  /** Normalised factor value ∈ [0, 1]. */
  value: number;
  weight: number;
  /** value * weight. */
  contribution: number;
}

export type ScoreBreakdown = {
  pantryMatch: FactorContribution;
  expirationBenefit: FactorContribution;
  budgetMatch: FactorContribution;
  nutritionMatch: FactorContribution;
  timeMatch: FactorContribution;
  preferenceMatch: FactorContribution;
  varietyScore: FactorContribution;
};

export type RejectionReason =
  | { code: 'ALLERGY'; ingredientId: string }
  | { code: 'APPLIANCE_MISSING'; appliance: Appliance }
  | { code: 'DIET_CONFLICT'; ingredientId: string }
  | { code: 'EXCEEDS_TIME'; required: number; max: number }
  | { code: 'ANTI_RECIPE'; antiFilter: AntiFilter }
  | { code: 'NOT_RESCUE_TARGET' };

/** true = passed; otherwise the rejection with its reason. */
export type FilterVerdict = true | { reject: RejectionReason };

export interface ScoredRecipe {
  recipe: Recipe;
  /** 0..1 total weighted score. */
  score: number;
  breakdown: ScoreBreakdown;
  passed: boolean;
  reject?: RejectionReason;
}

/** Result of applyHardFilters: two disjoint sets. */
export interface FilterResult {
  passed: Recipe[];
  rejected: Array<{ recipe: Recipe; reason: RejectionReason }>;
}
