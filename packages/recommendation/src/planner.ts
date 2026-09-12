// MC-051 — weekly menu planner (TS heuristic, ADR-0005: not LLM, not solver).
//
// Pipeline (development plan MC-051):
//   hard filters → scoring → greedy layout over (day × mealType) →
//   up to 10 local swaps minimising daily calorie deviation → chain
//   priority (bonus for recipes linked to already-picked chains) →
//   noCookDays filled with «сборными» блюдами (prep = 0 preferred).
//
// Determinism: the RNG is injected; with a seeded rng the plan is
// reproducible (DoD). No I/O, no clock — the ctx carries `now`.

import { rank } from './scoring/index.js';
import type { GenerationContext, MealType, Recipe, ScoredRecipe } from './types.js';

export type RepeatPolicy = 'ALLOW_REPEATS' | 'NO_REPEATS';

export const MEAL_ORDER: readonly MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

export const PLANNER_STAGES = ['filtering', 'scoring', 'optimizing', 'building-list'] as const;

export interface PlannerInput {
  recipes: Recipe[];
  ctx: GenerationContext;
  /** Number of days to plan (>= 1). */
  days: number;
  /** Meals per day (1..4), filled in MEAL_ORDER. */
  mealsPerDay: number;
  /** Servings cooked per meal. */
  peopleCount: number;
  /** 0-based day indices that must use no-cook («сборные») dishes. */
  noCookDays: number[];
  repeatPolicy: RepeatPolicy;
  /** Daily calorie target for the deviation metric and swap phase. */
  targetDailyCalories?: number;
}

export interface PlannerEntry {
  dayIndex: number;
  mealType: MealType;
  recipe: Recipe;
  servings: number;
  score: number;
}

export interface PlannerMetrics {
  slots: number;
  filled: number;
  /** mean |daily kcal − target| / target across days (null without target). */
  avgDailyCalorieDeviation: number | null;
  /** Recipe ids used more than once (only possible with ALLOW_REPEATS). */
  repeatCount: number;
  /** no-cook slots actually filled with a prep=0 dish. */
  noCookFilled: number;
  noCookSlots: number;
}

export interface PlannerResult {
  entries: PlannerEntry[];
  metrics: PlannerMetrics;
}

/** Small deterministic PRNG (mulberry32) — seed from the jobId hash. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHAIN_BONUS = 0.05;
const NO_COOK_MAX_PREP_MINUTES = 0;
const SWAP_ITERATIONS = 10;

function sharesChain(recipe: Recipe, chosen: PlannerEntry[]): boolean {
  const tags = recipe.chainTags ?? [];
  if (tags.length === 0) return false;
  return chosen.some((e) => (e.recipe.chainTags ?? []).some((t) => tags.includes(t)));
}

function dayCalories(entries: PlannerEntry[], dayIndex: number): number {
  return entries
    .filter((e) => e.dayIndex === dayIndex)
    .reduce((sum, e) => sum + e.recipe.nutrition.kcal * e.servings, 0);
}

/** Daily calories PER PERSON (targets are per-person in the PRD). */
function dayCaloriesPerPerson(
  entries: PlannerEntry[],
  dayIndex: number,
  peopleCount: number,
): number {
  return dayCalories(entries, dayIndex) / Math.max(1, peopleCount);
}

/**
 * Plan a week. `rng` is REQUIRED — the repo lint bans Math.random in
 * this package because plans must be reproducible: callers pass a
 * seeded generator (e.g. mulberry32(seedFromJobId)).
 */
export function planWeek(input: PlannerInput, rng: () => number): PlannerResult {
  const days = Math.max(1, Math.floor(input.days));
  const mealsPerDay = Math.min(4, Math.max(1, Math.floor(input.mealsPerDay)));
  const mealSlots = MEAL_ORDER.slice(0, mealsPerDay);
  const noCookSet = new Set(input.noCookDays);

  // 1. hard filters + scoring (reuse the single rank pipeline).
  const ranked = rank(input.recipes, input.ctx);
  const passed = ranked.filter((s) => s.passed);

  // 2. candidate pool per meal slot, best score first.
  const byMeal = new Map<MealType, ScoredRecipe[]>();
  for (const mt of MEAL_ORDER) {
    byMeal.set(
      mt,
      passed
        .filter((s) => s.recipe.mealTypes.includes(mt))
        .sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id)),
    );
  }

  const used = new Set<string>();
  const chosen: PlannerEntry[] = [];
  const takenByDay = new Map<number, Set<string>>();
  for (let d = 0; d < days; d++) takenByDay.set(d, new Set());

  const pickFor = (mealType: MealType, dayIndex: number): ScoredRecipe | null => {
    const pool = byMeal.get(mealType) ?? [];
    const taken = takenByDay.get(dayIndex)!;
    const noCookDay = noCookSet.has(dayIndex);
    let best: { s: ScoredRecipe; key: number } | null = null;
    let fallback: { s: ScoredRecipe; key: number } | null = null;
    for (const s of pool) {
      if (input.repeatPolicy === 'NO_REPEATS' && used.has(s.recipe.id)) continue;
      if (taken.has(s.recipe.id)) continue;
      // score + chain priority (+ no-cook preference), seeded jitter
      // breaks exact ties while keeping the plan reproducible.
      let key = s.score;
      if (sharesChain(s.recipe, chosen)) key += CHAIN_BONUS;
      if (noCookDay && s.recipe.prepMinutes <= 5) key += CHAIN_BONUS;
      key += rng() * 0.001;
      if (noCookDay && s.recipe.prepMinutes > NO_COOK_MAX_PREP_MINUTES) {
        // soft fallback on no-cook days: prefer filling the day.
        if (!fallback || key > fallback.key) fallback = { s, key };
        continue;
      }
      if (!best || key > best.key) best = { s, key };
    }
    return best?.s ?? fallback?.s ?? null;
  };

  // 3. greedy layout.
  for (let d = 0; d < days; d++) {
    for (const mt of mealSlots) {
      const picked = pickFor(mt, d);
      if (!picked) continue;
      used.add(picked.recipe.id);
      takenByDay.get(d)!.add(picked.recipe.id);
      chosen.push({
        dayIndex: d,
        mealType: mt,
        recipe: picked.recipe,
        servings: Math.max(1, Math.floor(input.peopleCount)),
        score: picked.score,
      });
    }
  }

  // 4. local swaps: reduce the worst daily calorie deviation.
  const target = input.targetDailyCalories;
  if (target && target > 0) {
    for (let it = 0; it < SWAP_ITERATIONS; it++) {
      let worstDay = -1;
      let worstDev = 0;
      for (let d = 0; d < days; d++) {
        const dev = Math.abs(dayCaloriesPerPerson(chosen, d, input.peopleCount) - target) / target;
        if (dev > worstDev) {
          worstDev = dev;
          worstDay = d;
        }
      }
      if (worstDay < 0 || worstDev <= 0.1) break; // within ±10% — good enough
      const dayEntries = chosen.filter((e) => e.dayIndex === worstDay);
      if (dayEntries.length === 0) break;
      dayEntries.sort((a, b) => b.recipe.nutrition.kcal - a.recipe.nutrition.kcal);
      const victim = dayEntries[0]!;
      const over = dayCalories(chosen, worstDay) > target;
      let bestSwap: { entry: PlannerEntry; dev: number } | null = null;
      for (const s of byMeal.get(victim.mealType) ?? []) {
        if (s.recipe.id === victim.recipe.id) continue;
        if (input.repeatPolicy === 'NO_REPEATS' && used.has(s.recipe.id)) continue;
        if (noCookSet.has(worstDay)) continue; // no-cook days keep their shape
        const kcal = s.recipe.nutrition.kcal * victim.servings;
        const rest = dayCalories(chosen, worstDay) - victim.recipe.nutrition.kcal * victim.servings;
        const perPerson = (rest + kcal) / Math.max(1, input.peopleCount);
        const dev = Math.abs(perPerson - target) / target;
        if (!bestSwap || dev < bestSwap.dev) {
          bestSwap = { entry: { ...victim, recipe: s.recipe, score: s.score }, dev };
        }
        void over;
      }
      if (bestSwap && bestSwap.dev < worstDev) {
        used.delete(victim.recipe.id);
        used.add(bestSwap.entry.recipe.id);
        const idx = chosen.indexOf(victim);
        chosen[idx] = bestSwap.entry;
      } else {
        break; // no improving swap found
      }
    }
  }

  // 5. metrics.
  let noCookFilled = 0;
  let noCookSlots = 0;
  for (let d = 0; d < days; d++) {
    if (!noCookSet.has(d)) continue;
    for (const e of chosen.filter((e) => e.dayIndex === d)) {
      noCookSlots += 1;
      if (e.recipe.prepMinutes === NO_COOK_MAX_PREP_MINUTES) noCookFilled += 1;
    }
  }
  const counts = new Map<string, number>();
  for (const e of chosen) counts.set(e.recipe.id, (counts.get(e.recipe.id) ?? 0) + 1);
  const repeatCount = [...counts.values()].filter((n) => n > 1).length;
  const deviations: number[] = [];
  for (let d = 0; d < days; d++) {
    if (target && target > 0) {
      deviations.push(
        Math.abs(dayCaloriesPerPerson(chosen, d, input.peopleCount) - target) / target,
      );
    }
  }
  const avgDailyCalorieDeviation =
    deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length : null;

  return {
    entries: chosen,
    metrics: {
      slots: days * mealsPerDay,
      filled: chosen.length,
      avgDailyCalorieDeviation,
      repeatCount,
      noCookFilled,
      noCookSlots,
    },
  };
}
