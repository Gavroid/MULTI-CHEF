// MC-032 — 8 anti-recipe predicates (ADR §5).
//
// Tokens are stored in MealPlan.generationSettings JSON — renaming any
// of them is a breaking change and requires a new ADR (PM-prompt #10).
// Predicates are pure; ctx.now arrives via GenerationContext.

import type { Filter } from './index.js';
import type { AntiFilter, Recipe } from '../types.js';

const FRYING_TAG = /жарен|fried|pan-fried/i;
const FRYING_TEXT = /жар|обжар|fry|frying|saut[ée]/i;
const CHOPPING_TAG = /без-нарезки|no-chop/i;
const CHOPPING_TEXT = /нареж|резать|поруб|шинк|chop|dice|slice/i;

const CHICKEN_NAME = /куриц|курица|куриное|куриный|цыпл|бройлер|chicken/i;

const ONE_PAN_APPLIANCES = new Set(['STOVE', 'AIRFRYER', 'MICROWAVE']);

function isOnePan(recipe: Recipe): boolean {
  const byTag = recipe.tags.some((t) => /одна сковорода|one-pan|одна-сковорода/i.test(t));
  const byAppliance =
    recipe.requiredAppliances.length === 1 && ONE_PAN_APPLIANCES.has(recipe.requiredAppliances[0]!);
  return byTag || byAppliance;
}

function usesChicken(recipe: Recipe): boolean {
  return recipe.ingredients.some((i) => i.categoryGroup === 'MEAT' && CHICKEN_NAME.test(i.name));
}

function isFried(recipe: Recipe): boolean {
  return (
    recipe.tags.some((t) => FRYING_TAG.test(t)) ||
    recipe.instructionsText.some((s) => FRYING_TEXT.test(s))
  );
}

function needsChopping(recipe: Recipe): boolean {
  // Tag «без-нарезки» is the positive signal (recipe claims no chopping);
  // a chopping marker in the instructions overrides it (recipe lies).
  const claimsNoChop = recipe.tags.some((t) => CHOPPING_TAG.test(t));
  if (!claimsNoChop) return true; // without the claim we assume chopping is needed
  return recipe.instructionsText.some((s) => CHOPPING_TEXT.test(s));
}

/**
 * One predicate per AntiFilter token. Each returns true (pass) or the
 * ANTI_RECIPE rejection carrying the token back for the UI chip.
 */
export const ANTI_RECIPE_PREDICATES: Record<AntiFilter, Filter> = {
  NO_OVEN: (recipe) =>
    recipe.requiredAppliances.includes('OVEN')
      ? { reject: { code: 'ANTI_RECIPE', antiFilter: 'NO_OVEN' } }
      : true,

  ONE_PAN: (recipe) =>
    isOnePan(recipe) ? true : { reject: { code: 'ANTI_RECIPE', antiFilter: 'ONE_PAN' } },

  NOT_CHICKEN_AGAIN: (recipe, ctx) => {
    // No signal → no-op (never reject everything, ADR red flag #8).
    if (ctx.yesterdayMainProtein === undefined || ctx.yesterdayMainProtein !== 'CHICKEN') {
      return true;
    }
    return usesChicken(recipe)
      ? { reject: { code: 'ANTI_RECIPE', antiFilter: 'NOT_CHICKEN_AGAIN' } }
      : true;
  },

  NO_LEFTOVERS: (recipe) =>
    recipe.leftoverSourceOf.length > 0
      ? { reject: { code: 'ANTI_RECIPE', antiFilter: 'NO_LEFTOVERS' } }
      : true,

  NO_FRYING: (recipe) =>
    isFried(recipe) ? { reject: { code: 'ANTI_RECIPE', antiFilter: 'NO_FRYING' } } : true,

  NO_CHOPPING: (recipe) =>
    needsChopping(recipe) ? { reject: { code: 'ANTI_RECIPE', antiFilter: 'NO_CHOPPING' } } : true,

  SHORT_TIME: (recipe, ctx) => {
    const max = Math.min(ctx.maxMinutes, 20);
    return recipe.prepMinutes + recipe.cookMinutes > max
      ? { reject: { code: 'ANTI_RECIPE', antiFilter: 'SHORT_TIME' } }
      : true;
  },

  NO_MULTISTEP: (recipe) =>
    recipe.instructionsText.length > 3 || recipe.difficulty > 2
      ? { reject: { code: 'ANTI_RECIPE', antiFilter: 'NO_MULTISTEP' } }
      : true,
};
