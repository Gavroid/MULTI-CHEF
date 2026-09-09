// MC-020 — Aliases (top-50 + extras).
//
// Aliases live in `IngredientAlias` with `(alias, locale)` PK. The
// default locale is `ru` (Russian); English / translit aliases are
// optional. Aliases are derived from the per-ingredient `aliases`
// arrays in `ingredients.ts` plus a few cross-locale additions for
// international recipe imports.
//
// This file does NOT contain hard-coded aliases; the seed runner
// reads them from each `IngredientSeed.aliases` so the data lives in
// one place. The functions below extract the per-locale mapping from
// the seed arrays.

import type { IngredientSeed, CategorySlug } from './ingredients.js';

export interface AliasesByLocale {
  readonly ru: Readonly<Record<string, readonly string[]>>;
}

/**
 * Aliases dictionary keyed by ingredient canonicalName. The seed
 * runner iterates this map and inserts one `IngredientAlias` row per
 * (ingredient, alias, locale) tuple.
 *
 * Currently only Russian aliases are sourced; adding `en` is future
 * work (recipe imports use canonicalName + locale-aware lookups).
 */
export function buildAliasIndex(seed: readonly IngredientSeed[]): AliasesByLocale {
  const ru: Record<string, readonly string[]> = {};
  for (const ing of seed) {
    if (ing.aliases.length > 0) {
      ru[ing.canonicalName] = ing.aliases;
    }
  }
  return { ru };
}

/**
 * Cross-cutting alias groups for ingredients whose canonical name
 * differs from common Russian usage. These let recipe searches match
 * "помидор" → Ingredient (canonicalName = "томат") once we add
 * Ingredient.aliasOf support in a future MC.
 *
 * For MC-020 we only seed aliases for the canonical ingredient itself
 * (the PK is `(alias, locale)` and the FK is `ingredientId`); a future
 * `IngredientAlias.aliasOf` column would enable cross-canonical
 * resolution.
 */
export const _EXTRA_ALIAS_GROUPS: ReadonlyArray<{
  canonicalName: string;
  category: CategorySlug;
  aliases: readonly string[];
}> = [];
