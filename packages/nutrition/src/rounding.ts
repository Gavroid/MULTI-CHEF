// MC-030 — Rounding rules (PRD convention).
//
// kcal is displayed as an integer; macros keep one decimal place.
// Rounding is plain Math.round (half away from zero on positives) —
// deterministic across platforms, no banker's rounding.

import type { NutritionFacts } from './types.js';

/** Round kcal to an integer: 180.4 → 180, 180.5 → 181. */
export function roundKcal(kcal: number): number {
  return Math.round(kcal);
}

/** Round a macro (grams) to one decimal place: 12.34 → 12.3, 12.35 → 12.4. */
export function roundMacro(grams: number): number {
  return Math.round(grams * 10) / 10;
}

/** Apply the PRD rounding convention to a full NutritionFacts value. */
export function roundNutrition(facts: NutritionFacts): NutritionFacts {
  return {
    kcal: roundKcal(facts.kcal),
    proteinG: roundMacro(facts.proteinG),
    fatG: roundMacro(facts.fatG),
    carbsG: roundMacro(facts.carbsG),
  };
}
