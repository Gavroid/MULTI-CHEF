// MC-030 — Warning taxonomy for nutrition computation.
//
// Every anomaly is EXPLICIT: nothing is skipped silently. Warnings carry
// enough context (ingredient name, impact) for the caller to surface them
// in the UI or logs.

export type NutritionWarning =
  | {
      code: 'MISSING_INGREDIENT_NUTRITION';
      ingredientName: string;
      /** Share of the dish weight this unknown ingredient accounts for: >10% → high. */
      impact: 'low' | 'medium' | 'high';
    }
  | { code: 'INGREDIENT_QUANTITY_ZERO'; ingredientName: string }
  | { code: 'NEGATIVE_QUANTITY'; ingredientName: string }
  | { code: 'SERVINGS_INVALID'; value: number };

/** Union of all warning codes, handy for exhaustive switch checks in consumers. */
export type NutritionWarningCode = NutritionWarning['code'];
