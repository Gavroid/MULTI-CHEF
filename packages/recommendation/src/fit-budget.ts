// MC-054 — «Уложиться в бюджет»: budget-fit proposal generator (pure).
//
// Order of preference (development plan MC-054):
//   1. SUBSTITUTE — swap to a declared substitute priced ≤ 70 % of the
//      original (≥ 30 % cheaper);
//   2. DROP_OPTIONAL — drop items that only serve optional recipe
//      ingredients (lowest utility first);
//   3. MERGE_MEALS — v0.2 (requires plan-entry surgery; see decision
//      log) — the generator reports it as unavailable, apply answers
//      honestly.
//
// The caller passes the current list items; proposals never mutate.

export interface BudgetItem {
  ingredientId: string;
  estimatedPriceKopecks: number;
  utilityScore: number;
  /** Item exists only because of optional recipe ingredients. */
  optionalOnly: boolean;
  /** Declared substitute (RecipeIngredient.substitutesFor). */
  substituteIngredientId: string | null;
  /** Substitute price (same package basis) when known. */
  substitutePriceKopecks: number | null;
  /** Substitute already on the list? Then substituting saves nothing. */
  substituteAlreadyListed?: boolean;
}

export type BudgetProposal =
  | {
      kind: 'SUBSTITUTE';
      ingredientId: string;
      substituteIngredientId: string;
      savingKopecks: number;
    }
  | { kind: 'DROP_OPTIONAL'; ingredientId: string; savingKopecks: number }
  | { kind: 'MERGE_MEALS'; savingKopecks: number; unavailableReason: string };

export interface FitBudgetResult {
  proposals: BudgetProposal[];
  /** Sum of all proposal savings. */
  totalPossibleSavings: number;
  /** overBudget − totalPossibleSavings ≤ 0 → the budget is reachable. */
  achievable: boolean;
  minimalTotalKopecks: number;
}

const SUBSTITUTE_MIN_RELATIVE_SAVING = 0.3;

export function fitBudgetProposals(
  items: BudgetItem[],
  targetBudgetKopecks: number,
  currentTotalKopecks: number,
): FitBudgetResult {
  const overBudget = currentTotalKopecks - targetBudgetKopecks;
  const proposals: BudgetProposal[] = [];

  // 1. SUBSTITUTE — most expensive first, must save ≥ 30 % of the item.
  const substitutable: Array<{ proposal: BudgetProposal; saving: number }> = [];
  for (const item of items) {
    if (!item.substituteIngredientId || item.substituteAlreadyListed) continue;
    if (item.substitutePriceKopecks == null) continue;
    const saving = item.estimatedPriceKopecks - item.substitutePriceKopecks;
    if (saving <= 0) continue;
    if (saving < item.estimatedPriceKopecks * SUBSTITUTE_MIN_RELATIVE_SAVING) continue;
    substitutable.push({
      proposal: {
        kind: 'SUBSTITUTE',
        ingredientId: item.ingredientId,
        substituteIngredientId: item.substituteIngredientId,
        savingKopecks: saving,
      },
      saving,
    });
  }
  substitutable.sort((a, b) => b.saving - a.saving);
  proposals.push(...substitutable.map((v) => v.proposal));

  // 2. DROP_OPTIONAL — cheapest-to-drop optional-only items.
  const droppable = items
    .filter((item) => item.optionalOnly)
    .sort(
      (a, b) =>
        a.utilityScore - b.utilityScore || b.estimatedPriceKopecks - a.estimatedPriceKopecks,
    )
    .map((item): BudgetProposal => ({
      kind: 'DROP_OPTIONAL',
      ingredientId: item.ingredientId,
      savingKopecks: item.estimatedPriceKopecks,
    }));
  proposals.push(...droppable);

  const totalPossibleSavings = proposals.reduce((sum, p) => sum + p.savingKopecks, 0);
  const minimalTotalKopecks = Math.max(0, currentTotalKopecks - totalPossibleSavings);

  return {
    proposals,
    totalPossibleSavings,
    achievable: overBudget <= 0 || totalPossibleSavings >= overBudget,
    minimalTotalKopecks,
  };
}
