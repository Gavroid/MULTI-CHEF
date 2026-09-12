// MC-033 — Recommendations service: synchronous /today orchestration.
//
// Pipeline: load (recipes, pantry, preferences, profile, yesterday
// protein) → build GenerationContext → rank() from @multichef/recommendation
// → pickTop3() → explanations. No writes; read-only for MC-033.

import { Inject, Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import { rank, rankRescue } from '@multichef/recommendation';
import type { GenerationContext } from '@multichef/recommendation';
import type {
  TodayRecommendationDto,
  TodayRequestDto,
  RecipeDto,
  RescueRequestDto,
  RescueResponseDto,
  RouletteDrawRequestDto,
  RouletteDrawResponseDto,
  RouletteRejectResponseDto,
} from '@multichef/contracts';
import { MAX_ROULETTE_REJECTS } from '@multichef/contracts';
import { AppHttpException } from '../common/exception-filter.js';
import {
  mapPantry,
  mapPreferences,
  mapRecipeRow,
  fetchYesterdayMainProtein,
} from './recommendations.mappers.js';
import { pickTop3, countMissingIngredients } from './pick-top3.js';
import { pickRescue, rescueUsedGrams } from './pick-rescue.js';
import { pickWeightedByScore } from './pick-roulette.js';
import { ROULETTE_TTL_SECONDS, type RouletteCounter } from './roulette-counter.js';
import type { RecipeRowWithRelations } from '../recipes/recipes.service.js';
import type { AiExplanationProvider } from './ai/template-provider.js';

@Injectable()
export class RecommendationsService {
  constructor(
    @Inject('AiExplanationProvider') private readonly ai: AiExplanationProvider,
    @Inject('RouletteCounter') private readonly rouletteCounter: RouletteCounter,
  ) {}

  async getToday(
    userId: string,
    input: TodayRequestDto,
    now: Date,
  ): Promise<TodayRecommendationDto> {
    const prisma = getPrisma();
    const householdId = await this.requireOwnedHouseholdId(userId);

    const [recipeRows, pantryRows, preferenceRows, profile, yesterdayProtein] = await Promise.all([
      prisma.recipe.findMany({
        where: { sourceType: 'CURATED', status: 'PUBLISHED' },
        include: {
          ingredients: {
            include: { ingredient: { include: { category: { select: { name: true } } } } },
          },
          nutrition: true,
        },
      }),
      prisma.pantryItem.findMany({
        where: { householdId, archivedAt: null, estimatedGrams: { gt: 0 } },
        select: { ingredientId: true, estimatedGrams: true, priority: true, expiresAt: true },
      }),
      prisma.preference.findMany({
        where: { userId, ingredientId: { not: null } },
        select: { kind: true, ingredientId: true },
      }),
      prisma.nutritionProfile.findUnique({
        where: { userId },
        select: {
          dietType: true,
          appliances: true,
          targetCalories: true,
          targetProteinG: true,
          targetFatG: true,
          targetCarbsG: true,
          mealsPerDay: true,
          preferredPrepMinutes: true,
        },
      }),
      // Sequential block below is one call; keep Promise.all honest.
      Promise.resolve(null),
    ]);

    void yesterdayProtein;
    const protein = await fetchYesterdayMainProtein(prisma as never, householdId, now);
    // GenerationContext accepts 'NONE' too; package treats non-CHICKEN as
    // no-op for NOT_CHICKEN_AGAIN. 'OTHER' maps to 'NONE'.
    const proteinSignal: GenerationContext['yesterdayMainProtein'] =
      protein === null ? 'NONE' : protein === 'OTHER' ? 'NONE' : protein;

    const settings = input.generationSettings ?? {};
    const maxMinutes = settings.maxMinutes ?? profile?.preferredPrepMinutes ?? 60;

    const ctx: GenerationContext = {
      now,
      pantry: mapPantry(pantryRows),
      preferences: mapPreferences(preferenceRows, profile),
      maxMinutes,
      ...(settings.budgetMode ? { budgetMode: settings.budgetMode } : {}),
      antiFilters: settings.antiFilters ?? [],
      yesterdayMainProtein: proteinSignal,
      recentRecipeIds7d: [], // meal-plans history lands in MC-051
      ...(profile?.targetCalories && profile.targetCalories > 0
        ? {
            targetDailyMacros: {
              calories: profile.targetCalories,
              proteinG: profile.targetProteinG ?? 0,
              fatG: profile.targetFatG ?? 0,
              carbsG: profile.targetCarbsG ?? 0,
            },
          }
        : {}),
      mealsPerDay: profile?.mealsPerDay ?? 3,
      ...(settings.rescueIngredientId != null
        ? { rescue: { targetIngredientId: settings.rescueIngredientId } }
        : {}),
    };

    // Map once, keep the row ↔ package-Recipe pairing for DTO output.
    const pairs = recipeRows.map((row) => ({
      row: row as RecipeRowWithRelations,
      recipe: mapRecipeRow(row as RecipeRowWithRelations),
    }));
    const rowById = new Map(pairs.map((p) => [p.recipe.id, p.row]));

    const ranked = rank(
      pairs.map((p) => p.recipe),
      ctx,
    );

    const options = pickTop3(
      ranked,
      ctx,
      {
        toRecipeDto: (row) => mapDto(row),
        rowById,
      },
      (scored, extra) => this.ai.explain(scored, extra),
    );

    return {
      options,
      nutritionAccuracy: 'ESTIMATED' as const,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * MC-040 «Спаси продукт»: rank the catalog under the rescue hard
   * filter (must contain the ingredient) + rescue weights, then pick
   * «очевидные → необычные». 404 when the ingredient is not in the
   * household's pantry (privacy: never 403), 422 when nothing can be
   * cooked from it.
   */
  async getRescue(userId: string, input: RescueRequestDto, now: Date): Promise<RescueResponseDto> {
    const prisma = getPrisma();
    const householdId = await this.requireOwnedHouseholdId(userId);

    // Security invariant (ADR decision #8): the ingredient MUST be in
    // THIS household's pantry, otherwise 404 — existence must not leak.
    const pantryItem = await prisma.pantryItem.findFirst({
      where: {
        householdId,
        ingredientId: input.ingredientId,
        archivedAt: null,
        estimatedGrams: { gt: 0 },
      },
      include: { ingredient: { select: { canonicalName: true } } },
    });
    if (!pantryItem) {
      throw new AppHttpException({
        code: 'INGREDIENT_NOT_FOUND',
        message: 'Продукт не найден в холодильнике',
        details: { ingredientId: input.ingredientId },
      });
    }

    const [recipeRows, pantryRows, preferenceRows, profile] = await Promise.all([
      prisma.recipe.findMany({
        where: { sourceType: 'CURATED', status: 'PUBLISHED' },
        include: {
          ingredients: {
            include: { ingredient: { include: { category: { select: { name: true } } } } },
          },
          nutrition: true,
        },
      }),
      prisma.pantryItem.findMany({
        where: { householdId, archivedAt: null, estimatedGrams: { gt: 0 } },
        select: { ingredientId: true, estimatedGrams: true, priority: true, expiresAt: true },
      }),
      prisma.preference.findMany({
        where: { userId, ingredientId: { not: null } },
        select: { kind: true, ingredientId: true },
      }),
      prisma.nutritionProfile.findUnique({
        where: { userId },
        select: {
          dietType: true,
          appliances: true,
          targetCalories: true,
          targetProteinG: true,
          targetFatG: true,
          targetCarbsG: true,
          mealsPerDay: true,
          preferredPrepMinutes: true,
        },
      }),
    ]);

    // NOT_CHICKEN_AGAIN can never fire (antiFilters is empty in rescue),
    // so the yesterday-protein lookup is skipped for latency.
    const ctx: GenerationContext = {
      now,
      pantry: mapPantry(pantryRows),
      preferences: mapPreferences(preferenceRows, profile),
      maxMinutes: input.maxMinutes ?? profile?.preferredPrepMinutes ?? 60,
      budgetMode: 'NORMAL',
      antiFilters: [],
      yesterdayMainProtein: 'NONE',
      recentRecipeIds7d: [], // meal-plans history lands in MC-051
      ...(profile?.targetCalories && profile.targetCalories > 0
        ? {
            targetDailyMacros: {
              calories: profile.targetCalories,
              proteinG: profile.targetProteinG ?? 0,
              fatG: profile.targetFatG ?? 0,
              carbsG: profile.targetCarbsG ?? 0,
            },
          }
        : {}),
      mealsPerDay: profile?.mealsPerDay ?? 3,
    };

    const pairs = recipeRows.map((row) => ({
      row: row as RecipeRowWithRelations,
      recipe: mapRecipeRow(row as RecipeRowWithRelations),
    }));
    const rowById = new Map(pairs.map((p) => [p.recipe.id, p.row]));

    const ranked = rankRescue(
      pairs.map((p) => p.recipe),
      ctx,
      {
        targetIngredientId: input.ingredientId,
      },
    );
    const picked = pickRescue(ranked, 3);
    if (picked.length === 0) {
      throw new AppHttpException({
        code: 'EMPTY_RESCUE',
        message: 'Нет рецептов с этим продуктом',
        details: { ingredientId: input.ingredientId },
      });
    }

    const options: RescueResponseDto['options'] = picked.map((s) => {
      const toBuyCount = countMissingIngredients(s.recipe, ctx);
      return {
        type: 'FROM_PANTRY' as const,
        recipe: mapDto(rowById.get(s.recipe.id)!),
        score: s.score,
        toBuyCount,
        chainTag: s.recipe.chainTags?.[0] ?? null,
        explanation: this.ai.explain(s, { toBuyCount }),
      };
    });

    const totalGrams = pantryItem.estimatedGrams.toNumber();
    return {
      options,
      nutritionAccuracy: 'ESTIMATED' as const,
      generatedAt: now.toISOString(),
      pantryUsage: {
        usedGrams: rescueUsedGrams(picked, input.ingredientId),
        totalGrams,
      },
      ingredient: {
        id: input.ingredientId,
        canonicalName: pantryItem.ingredient.canonicalName,
        totalGrams,
      },
    };
  }

  /**
   * MC-042 «Кулинарная рулетка»: one score-weighted random card.
   * The reject counter lives on the server (Redis, TTL 30 min) — the
   * client cannot bypass the limit (DoD).
   */
  async drawRoulette(
    userId: string,
    input: RouletteDrawRequestDto,
    now: Date,
    rng: () => number = Math.random,
  ): Promise<RouletteDrawResponseDto> {
    const prisma = getPrisma();
    const householdId = await this.requireOwnedHouseholdId(userId);

    const [recipeRows, pantryRows, preferenceRows, profile] = await Promise.all([
      prisma.recipe.findMany({
        where: { sourceType: 'CURATED', status: 'PUBLISHED' },
        include: {
          ingredients: {
            include: { ingredient: { include: { category: { select: { name: true } } } } },
          },
          nutrition: true,
        },
      }),
      prisma.pantryItem.findMany({
        where: { householdId, archivedAt: null, estimatedGrams: { gt: 0 } },
        select: { ingredientId: true, estimatedGrams: true, priority: true, expiresAt: true },
      }),
      prisma.preference.findMany({
        where: { userId, ingredientId: { not: null } },
        select: { kind: true, ingredientId: true },
      }),
      prisma.nutritionProfile.findUnique({
        where: { userId },
        select: {
          dietType: true,
          appliances: true,
          targetCalories: true,
          targetProteinG: true,
          targetFatG: true,
          targetCarbsG: true,
          mealsPerDay: true,
          preferredPrepMinutes: true,
        },
      }),
    ]);

    const ctx: GenerationContext = {
      now,
      pantry: mapPantry(pantryRows),
      preferences: mapPreferences(preferenceRows, profile),
      maxMinutes: input.maxMinutes ?? profile?.preferredPrepMinutes ?? 60,
      ...(input.budgetMode ? { budgetMode: input.budgetMode } : {}),
      antiFilters: [],
      yesterdayMainProtein: 'NONE',
      recentRecipeIds7d: [],
      ...(profile?.targetCalories && profile.targetCalories > 0
        ? {
            targetDailyMacros: {
              calories: profile.targetCalories,
              proteinG: profile.targetProteinG ?? 0,
              fatG: profile.targetFatG ?? 0,
              carbsG: profile.targetCarbsG ?? 0,
            },
          }
        : {}),
      mealsPerDay: profile?.mealsPerDay ?? 3,
    };

    const pairs = recipeRows.map((row) => ({
      row: row as RecipeRowWithRelations,
      recipe: mapRecipeRow(row as RecipeRowWithRelations),
    }));
    const rowById = new Map(pairs.map((p) => [p.recipe.id, p.row]));

    const ranked = rank(
      pairs.map((p) => p.recipe),
      ctx,
    );
    const picked = pickWeightedByScore(ranked, rng);
    if (!picked) {
      throw new AppHttpException({
        code: 'ROULETTE_EMPTY',
        message: 'Подходящих рецептов не нашлось',
      });
    }

    const rejects = await this.rouletteCounter.get(`roulette:${householdId}`);
    return {
      option: {
        type: 'BEST_MATCH',
        recipe: mapDto(rowById.get(picked.recipe.id)!),
        score: picked.score,
        explanation: this.ai.explain(picked),
      },
      attemptsLeft: Math.max(0, MAX_ROULETTE_REJECTS - rejects),
    };
  }

  /** Burn one of the 2 rejects; 409 once the limit is exhausted. */
  async rejectRoulette(userId: string): Promise<RouletteRejectResponseDto> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    const rejects = await this.rouletteCounter.incr(
      `roulette:${householdId}`,
      ROULETTE_TTL_SECONDS,
    );
    if (rejects > MAX_ROULETTE_REJECTS) {
      throw new AppHttpException({
        code: 'REJECT_LIMIT_REACHED',
        message: 'Судьба выбрана',
      });
    }
    return { attemptsLeft: MAX_ROULETTE_REJECTS - rejects };
  }

  private async requireOwnedHouseholdId(userId: string): Promise<string> {
    const prisma = getPrisma();
    const membership = await prisma.householdMember.findFirst({
      where: { userId, role: 'OWNER' },
      select: { householdId: true },
    });
    if (!membership) {
      throw new AppHttpException({
        code: 'FORBIDDEN',
        message: 'No owned household for this user',
      });
    }
    return membership.householdId;
  }
}

// Local import cycle avoidance: replicate the tiny RecipeDto mapper here
// instead of importing it from recipes.service (which pulls Prisma
// service deps into every consumer).
function mapDto(row: RecipeRowWithRelations): RecipeDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    imageKey: row.imageKey,
    servings: row.servings,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    difficulty: row.difficulty,
    mealTypes: row.mealTypes,
    tags: row.tags,
    requiredAppliances: row.requiredAppliances,
    chainTags: row.chainTags,
  };
}
