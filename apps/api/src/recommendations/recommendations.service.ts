// MC-033 — Recommendations service: synchronous /today orchestration.
//
// Pipeline: load (recipes, pantry, preferences, profile, yesterday
// protein) → build GenerationContext → rank() from @multichef/recommendation
// → pickTop3() → explanations. No writes; read-only for MC-033.

import { Inject, Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import { rank } from '@multichef/recommendation';
import type { GenerationContext } from '@multichef/recommendation';
import type { TodayRecommendationDto, TodayRequestDto, RecipeDto } from '@multichef/contracts';
import { AppHttpException } from '../common/exception-filter.js';
import {
  mapPantry,
  mapPreferences,
  mapRecipeRow,
  fetchYesterdayMainProtein,
} from './recommendations.mappers.js';
import { pickTop3 } from './pick-top3.js';
import type { RecipeRowWithRelations } from '../recipes/recipes.service.js';
import type { AiExplanationProvider } from './ai/template-provider.js';

@Injectable()
export class RecommendationsService {
  constructor(@Inject('AiExplanationProvider') private readonly ai: AiExplanationProvider) {}

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
