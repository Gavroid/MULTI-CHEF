// MC-030 — Demo: computeRecipeNutrition on a real MC-031 seed recipe.
// Standalone: imports only @multichef/nutrition + the seed catalog data.
import { computeRecipeNutrition, combineNutrition, scaleNutrition } from './src/index.js';
import { RECIPES } from '../database/src/seed/recipes/recipes.js';

// Minimal in-memory nutrition table for demo (per 100 g) — in prod these
// values come from IngredientNutrition (MC-040 fills it).
const PER100 = {
  картофель: [77, 2, 0.1, 17],
  молоко: [52, 2.9, 2, 4.7],
  'масло сливочное': [748, 0.5, 82.5, 0.8],
  'лук репчатый': [41, 1.1, 0.1, 9],
  соль: [0, 0, 0, 0],
};

const recipe = RECIPES.find((r) => r.canonicalTitle === 'Картофельное пюре') ?? RECIPES[0];
const lines = recipe.ingredients.map((i) => {
  const row = PER100[i.canonicalName];
  return {
    canonicalName: i.canonicalName,
    quantityG: i.quantityG,
    ingredientNutrition:
      row === undefined
        ? null
        : {
            servingSizeG: 100,
            servingCalories: row[0],
            servingProteinG: row[1],
            servingFatG: row[2],
            servingCarbsG: row[3],
          },
  };
});

console.log('Recipe:', recipe.canonicalTitle, '| servings:', recipe.servings);
console.log('Lines:', lines.map((l) => `${l.canonicalName} ${l.quantityG}g`).join(', '));
const result = computeRecipeNutrition({ servings: recipe.servings, ingredients: lines });
console.log('computeRecipeNutrition →', JSON.stringify(result, null, 2));

// MC-031 recipe nutrition cross-check
console.log('\nseed RecipeNutrition:', JSON.stringify(recipe.nutrition));

// scale x2
const scaled = scaleNutrition(
  { total: result.total, perServing: result.perServing, currentServings: recipe.servings },
  recipe.servings * 2,
);
console.log('\nscaleNutrition x2 →', JSON.stringify(scaled));

// day plan: пюре + борщ + сырники (approx facts)
const day = combineNutrition([
  result.perServing,
  { kcal: 350, proteinG: 20, fatG: 12, carbsG: 40 },
  { kcal: 280, proteinG: 15, fatG: 8, carbsG: 38 },
]);
console.log('\ncombineNutrition (3 meals) →', JSON.stringify(day));
