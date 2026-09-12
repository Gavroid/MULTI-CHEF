// MC-051 — MealPlans service: validate the weekly-plan setup, record
// the Job and enqueue GENERATE_PLAN (planned by the worker, MC-051).
// The actual planning is asynchronous; clients poll GET /jobs/:id.

import { Inject, Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import type {
  CreateMealPlanResponseDto,
  MealPlanSetupDto,
} from '@multichef/contracts';
import { AppHttpException } from '../common/exception-filter.js';
import { JobsService } from '../jobs/jobs.service.js';

@Injectable()
export class MealPlansService {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  async create(userId: string, setup: MealPlanSetupDto): Promise<CreateMealPlanResponseDto> {
    const householdId = await this.requireOwnedHouseholdId(userId);
    return this.jobs.enqueue(userId, householdId, 'GENERATE_PLAN', setup as unknown as Record<string, unknown>);
  }

  /** Fetch the household's active plan (web «План» tab, MC-055). */
  async getActiveForUser(userId: string) {
    const prisma = getPrisma();
    const householdId = await this.requireOwnedHouseholdId(userId);
    return prisma.mealPlan.findFirst({
      where: { householdId, status: 'ACTIVE' },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: { entries: { orderBy: { position: 'asc' }, include: { recipe: true } } },
        },
      },
    });
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
