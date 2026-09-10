// MC-032 — Public API of @multichef/recommendation.
//
// Pure functions and types only: no I/O, no clock (ctx.now is injected),
// no randomness. apps/api maps DB rows to these DTOs (MC-033).

export { rank, scoreRecipe } from './scoring/index.js';
export { applyHardFilters, ANTI_RECIPE_PREDICATES } from './filters/index.js';
export { buildExplanation } from './explain.js';
export { FACTOR_WEIGHTS, FACTOR_NAMES } from './scoring/weights.js';
export type { FactorName } from './scoring/weights.js';
export type { Filter } from './filters/index.js';
export type {
  Recipe,
  RecipeIngredient,
  PantryItem,
  UserPreferences,
  GenerationContext,
  AntiFilter,
  ScoredRecipe,
  ScoreBreakdown,
  FactorContribution,
  RejectionReason,
  FilterResult,
  Appliance,
  DietType,
  MealType,
  IngredientCategoryGroup,
  PreferenceKind,
  BudgetMode,
  PantryPriority,
} from './types.js';
