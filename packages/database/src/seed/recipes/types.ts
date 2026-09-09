// MC-031 — Recipe seed types.
//
// These types describe the *catalog* form of a recipe. The runner
// (recipes/index.ts) maps them onto the Prisma schema (MC-003):
//   Recipe.title             ← canonicalTitle (natural key for upsert)
//   Recipe.tagJson           ← category/cuisine/meal/appliance/season/diet tags
//   RecipeIngredient         ← ingredients[] (FK by Ingredient.canonicalName)
//   RecipeNutrition          ← nutrition (1:1, per serving, Decimal columns)
//   StorageRule              ← storageRule (1:0..1)
//   Recipe left/right chain  ← leftoverSourceOf (chain tags, see chains.ts)
//
// NOTE: Recipe has no unique constraint on title in the schema, so the
// runner upserts via findFirst + create/update keyed on title.

export type RecipeCategory =
  'BREAKFAST' | 'SOUP' | 'MAIN' | 'SALAD' | 'SIDE' | 'DESSERT' | 'BEVERAGE';

export type RecipeDifficulty = 'BEGINNER' | 'CONFIDENT' | 'EXPERIMENTER';

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export type Appliance = 'STOVE' | 'OVEN' | 'MICROWAVE' | 'MULTICOOKER' | 'BLENDER' | 'MIXER';

export type SeasonTag = 'SUMMER' | 'WINTER' | 'ALL_YEAR';

export type DietTag = 'VEGETARIAN' | 'VEGAN' | 'GLUTEN_FREE' | 'POST';

/** Unit enum in the schema (MC-003) is G | ML | PIECE — TBSP/TSP are not representable. */
export type RecipeIngredientUnit = 'G' | 'ML' | 'PIECE';

export interface RecipeSeedIngredient {
  /** FK lookup against the MC-020 ingredient catalog (Ingredient.canonicalName). */
  canonicalName: string;
  quantityG: number;
  unit: RecipeIngredientUnit;
  optional: boolean;
}

export interface RecipeSeed {
  /** Unique natural key for idempotent upsert. */
  canonicalTitle: string;
  category: RecipeCategory;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: RecipeDifficulty;
  cuisineTags: string[];
  mealTypes: MealType[];
  requiredAppliances: Appliance[];
  seasonTags: SeasonTag[];
  dietTags: DietTag[];
  instructions: string[];
  ingredients: RecipeSeedIngredient[];
  /** Per one serving (already divided by servings at generation time). */
  nutrition: {
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  };
  /**
   * Chain relation: titles of recipes this recipe reuses leftovers from.
   * Written onto Recipe.recipeSource (self-relation). Also aggregated
   * into CHAIN_TAGS (chains.ts) for tag-level lookup.
   */
  leftoverSourceOf?: string[];
  storageRule?: {
    shelfDaysFridge: number;
    shelfDaysFreezer: number;
    containerType: 'GLASS' | 'PLASTIC' | 'METAL';
  };
  imageUrl?: string;
}
