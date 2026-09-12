// MC-051 — MealPlans service: validate the weekly-plan setup, record
// the Job and enqueue GENERATE_PLAN (planned by the worker, MC-051).
// The actual planning is asynchronous; clients poll GET /jobs/:id.

import { Inject, Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import type { CreateMealPlanResponseDto, MealPlanSetupDto } from '@multichef/contracts';
import { AppHttpException } from '../common/exception-filter.js';
import { JobsService } from '../jobs/jobs.service.js';

@Injectable()
export class MealPlansService {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  async create(userId: string, setup: MealPlanSetupDto): Promise<CreateMealPlanResponseDto> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    return this.jobs.enqueue(
      userId,
      householdId,
      'GENERATE_PLAN',
      setup as unknown as Record<string, unknown>,
    );
  }

  /** Fetch the household's active plan (web «План» tab, MC-055). */
  async getActiveForUser(userId: string) {
    const householdId = await this.requireOwnedHouseholdId(userId);
    const plan = await getPrisma().mealPlan.findFirst({
      where: { householdId, status: 'ACTIVE' },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: { entries: { orderBy: { position: 'asc' }, include: { recipe: true } } },
        },
      },
    });
    if (!plan) return null;
    return {
      id: plan.id,
      startDate: plan.startDate.toISOString(),
      endDate: plan.endDate.toISOString(),
      peopleCount: plan.peopleCount,
      status: plan.status,
      days: plan.days.map((day) => ({
        id: day.id,
        date: day.date.toISOString(),
        totalCalories: day.totalCalories.toNumber(),
        totalProteinG: day.totalProteinG.toNumber(),
        totalFatG: day.totalFatG.toNumber(),
        totalCarbsG: day.totalCarbsG.toNumber(),
        entries: day.entries.map((entry) => ({
          id: entry.id,
          mealType: entry.mealType,
          recipe: {
            id: entry.recipe.id,
            title: entry.recipe.title,
            description: entry.recipe.description,
            imageKey: entry.recipe.imageKey,
            servings: entry.recipe.servings,
            prepMinutes: entry.recipe.prepMinutes,
            cookMinutes: entry.recipe.cookMinutes,
            difficulty: entry.recipe.difficulty,
            mealTypes: entry.recipe.mealTypes,
            tags: entry.recipe.tags,
            requiredAppliances: entry.recipe.requiredAppliances,
          },
          servings: entry.servings.toNumber(),
          portionGrams: entry.portionGrams.toNumber(),
          position: entry.position,
        })),
      })),
    };
  }

  private async requireOwnedHouseholdId(userId: string): Promise<string> {
    const membership = await getPrisma().householdMember.findFirst({
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
