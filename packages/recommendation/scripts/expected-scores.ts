// Compute expected scores for the fixture scenarios, print them as TS
// literal — paste into expectedScores.ts. Run with tsx.
import { rank } from '../src/scoring/index.js';
import { CATALOG } from '../src/__tests__/fixtures/catalog.js';
import { CTX_A, CTX_B, CTX_C } from '../src/__tests__/fixtures/contexts.js';

for (const [name, ctx] of [
  ['A', CTX_A],
  ['B', CTX_B],
  ['C', CTX_C],
] as const) {
  const scored = rank(CATALOG, ctx);
  console.log(`// Scenario ${name}`);
  for (const s of scored.slice(0, 5)) {
    console.log(
      `${s.recipe.id}: score=${s.score.toFixed(6)} passed=${s.passed} ` +
        `pantry=${s.breakdown.pantryMatch.value.toFixed(4)} expiry=${s.breakdown.expirationBenefit.value.toFixed(4)} ` +
        `budget=${s.breakdown.budgetMatch.value.toFixed(4)} nutrition=${s.breakdown.nutritionMatch.value.toFixed(4)} ` +
        `time=${s.breakdown.timeMatch.value.toFixed(4)} pref=${s.breakdown.preferenceMatch.value.toFixed(4)} variety=${s.breakdown.varietyScore.value.toFixed(4)}`,
    );
  }
  console.log('');
}
