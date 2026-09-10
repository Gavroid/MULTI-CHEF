// MC-032 — expirationBenefit factor (weight 0.20).
//
// Reward for using ingredients that are urgent: priority USE_FIRST or
// expiring within EXPIRY_WINDOW_DAYS of ctx.now. Only the grams actually
// consumed by the recipe count (capped by pantry stock). No urgent
// ingredients → 0.

import { clamp01 } from '../weights.js';
import type { GenerationContext, Recipe } from '../../types.js';

const EXPIRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function isUrgent(
  expiresAt: Date | null | undefined,
  priority: 'NORMAL' | 'USE_FIRST',
  now: Date,
): boolean {
  if (priority === 'USE_FIRST') return true;
  if (expiresAt === null || expiresAt === undefined) return false;
  return expiresAt.getTime() <= now.getTime() + EXPIRY_WINDOW_MS;
}

export function expirationBenefit(recipe: Recipe, ctx: GenerationContext): number {
  if (ctx.pantry.length === 0) return 0;

  const urgentStock = new Map<string, number>();
  for (const item of ctx.pantry) {
    if (isUrgent(item.expiresAt, item.priority, ctx.now)) {
      urgentStock.set(
        item.ingredientId,
        (urgentStock.get(item.ingredientId) ?? 0) + item.estimatedGrams,
      );
    }
  }
  if (urgentStock.size === 0) return 0;

  let requiredTotal = 0;
  let urgentUsed = 0;
  for (const ing of recipe.ingredients) {
    if (ing.optional) continue;
    requiredTotal += ing.grams;
    const stock = urgentStock.get(ing.ingredientId) ?? 0;
    if (stock > 0) {
      urgentUsed += Math.min(stock, ing.grams);
    }
  }

  if (requiredTotal === 0) return 0;
  return clamp01(urgentUsed / requiredTotal);
}
