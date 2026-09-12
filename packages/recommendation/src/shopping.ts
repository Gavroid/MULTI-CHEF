// MC-052 — ShoppingList builder (pure function, development plan MC-052).
//
// required grams per ingredient (Σ over plan entries, servings already
// applied by the caller) − pantry stock → rounded UP to whole packages
// (ceil), priced with the catalogue average, scored 0..10 for the
// «индекс полезности покупки» (PRD UC-08), grouped by category
// sort order.
//
// Rules (development plan fixtures):
//  - STAPLE pantry items (соль, масло) are NEVER purchased;
//  - net requirement ≤ 0 → the item does not appear;
//  - every produced item has packageQuantity ≥ 1 and utility 0..10.
//
// No I/O, no clock — callers pass the resolved ingredient metadata.

import { clamp01 } from './scoring/weights.js';

export interface ShoppingIngredientMeta {
  ingredientId: string;
  /** Grams per package (caller converts ML/PIECE via density). */
  packageSize: number;
  /** Average shelf price in KOPECKS per package. */
  avgPriceKopecks: number;
  categoryId: string;
  /** Department order (IngredientCategory.sortOrder). */
  categorySortOrder: number;
}

export interface ShoppingListItemDraft {
  ingredientId: string;
  requiredGrams: number;
  packageQuantity: number;
  packageSize: number;
  estimatedPriceKopecks: number;
  /** 0..10 — how useful this purchase is (PRD UC-08). */
  utilityScore: number;
  categoryId: string;
  /** Department order for the web grouping. */
  sortOrder: number;
}

export interface BuildShoppingListInput {
  /** ingredientId → total grams required by the plan. */
  requiredGrams: Map<string, number>;
  /** ingredientId → available pantry grams. */
  pantryGrams: Map<string, number>;
  /** Staple pantry items are never purchased (salt, oil…). */
  staples: Set<string>;
  /** ingredientId → number of dishes in the plan using the ingredient. */
  dishCounts: Map<string, number>;
  /** Total dishes in the plan (dishCount normalisation denominator). */
  totalDishes: number;
  meta: ShoppingIngredientMeta[];
}

export function buildShoppingList(input: BuildShoppingListInput): ShoppingListItemDraft[] {
  const items: ShoppingListItemDraft[] = [];

  for (const meta of input.meta) {
    if (input.staples.has(meta.ingredientId)) continue;
    const required = input.requiredGrams.get(meta.ingredientId) ?? 0;
    if (required <= 0) continue;
    const available = input.pantryGrams.get(meta.ingredientId) ?? 0;
    const net = required - available;
    if (net <= 0) continue;

    const packageSize = meta.packageSize > 0 ? meta.packageSize : 1;
    const packageQuantity = Math.max(1, Math.ceil(net / packageSize));
    const estimatedPriceKopecks = Math.round(meta.avgPriceKopecks * packageQuantity);

    // utilityScore: how many dishes need it (0..5) + how fully the
    // bought packages are used (0..4) + LOVE bonus (0..1).
    const dishPart =
      5 * clamp01((input.dishCounts.get(meta.ingredientId) ?? 1) / Math.max(1, input.totalDishes));
    const boughtGrams = packageQuantity * packageSize;
    const usagePart = 4 * clamp01(required / boughtGrams);
    const utilityScore = Math.max(0, Math.min(10, Math.round(dishPart + usagePart)));

    items.push({
      ingredientId: meta.ingredientId,
      requiredGrams: Math.round(net * 10) / 10,
      packageQuantity,
      packageSize,
      estimatedPriceKopecks,
      utilityScore,
      categoryId: meta.categoryId,
      sortOrder: meta.categorySortOrder,
    });
  }

  items.sort((a, b) => a.sortOrder - b.sortOrder || a.ingredientId.localeCompare(b.ingredientId));
  return items;
}

/** Σ grams per ingredient over plan entries, already × servings. */
export function requiredGramsFromEntries(
  entries: Array<{
    servings: number;
    ingredients: Array<{ ingredientId: string; grams: number; optional: boolean }>;
  }>,
): Map<string, { grams: number; dishes: number }> {
  const result = new Map<string, { grams: number; dishes: number }>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const ing of entry.ingredients) {
      if (ing.optional) continue; // optional items are never purchased
      const current = result.get(ing.ingredientId) ?? { grams: 0, dishes: 0 };
      current.grams += ing.grams * entry.servings;
      if (!seen.has(ing.ingredientId)) {
        current.dishes += 1;
        seen.add(ing.ingredientId);
      }
      result.set(ing.ingredientId, current);
    }
  }
  return result;
}
