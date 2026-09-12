// MC-032 — Public API of @multichef/recommendation.
//
// Pure functions and types only: no I/O, no clock (ctx.now is injected),
// no randomness. apps/api maps DB rows to these DTOs (MC-033).

export { rank, scoreRecipe } from './scoring/index.js';
export { applyHardFilters, ANTI_RECIPE_PREDICATES } from './filters/index.js';
export { buildExplanation } from './explain.js';
export { FACTOR_WEIGHTS, FACTOR_NAMES, RESCUE_FACTOR_WEIGHTS } from './scoring/weights.js';
export { rankRescue } from './scoring/rescue.js';
export {
  planWeek,
  mulberry32,
  MEAL_ORDER,
  type PlannerInput,
  type PlannerEntry,
  type PlannerResult,
  type PlannerMetrics,
  type RepeatPolicy,
} from './planner.js';
export {
  buildPrepTasks,
  buildStoragePlan,
  INTENSITY_TARGET_MINUTES,
  type PrepIntensity,
  type PrepEntryInput,
  type PrepTaskDraft,
  type StorageEntryInput,
  type StorageAssignment,
  type StoragePlanResult,
} from './prep.js';
export {
  fitBudgetProposals,
  type BudgetItem,
  type BudgetProposal,
  type FitBudgetResult,
} from './fit-budget.js';
export {
  buildShoppingList,
  requiredGramsFromEntries,
  type ShoppingIngredientMeta,
  type ShoppingListItemDraft,
  type BuildShoppingListInput,
} from './shopping.js';
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
