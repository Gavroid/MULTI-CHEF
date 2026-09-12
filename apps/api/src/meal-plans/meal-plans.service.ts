// MC-051 — MealPlans service: validate the weekly-plan setup, record
// the Job and enqueue GENERATE_PLAN (planned by the worker, MC-051).
// The actual planning is asynchronous; clients poll GET /jobs/:id.

import { Inject, Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import {
  buildPrepTasks,
  buildStoragePlan,
  INTENSITY_TARGET_MINUTES,
  type PrepIntensity,
  type PrepEntryInput,
  type StorageEntryInput,
} from '@multichef/recommendation';
import type {
  CreateMealPlanResponseDto,
  MealPlanSetupDto,
  StoragePlanDto,
  PrepSessionDto,
} from '@multichef/contracts';
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

  /**
   * MC-060: build (or return the existing) prep session for the ACTIVE
   * plan. Tasks are deduplicated; intensity cuts active minutes.
   */
  async generatePrepSession(userId: string, intensity: PrepIntensity): Promise<PrepSessionDto> {
    const plan = await this.getActivePlanRowOrThrow(userId);
    const prisma = getPrisma();
    const sessionId = `${plan.id}-prep-${intensity}`;
    const existing = await prisma.prepSession.findFirst({
      where: { id: sessionId },
      include: { tasks: { orderBy: { sequence: 'asc' } } },
    });
    if (existing) {
      return {
        id: existing.id,
        mealPlanId: existing.mealPlanId,
        intensity: existing.intensity as PrepIntensity,
        targetMinutes: existing.targetMinutes,
        tasks: existing.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          durationMinutes: t.durationMinutes,
          sequence: t.sequence,
          parallelGroup: t.parallelGroup,
          instructions: t.instructions,
          done: t.done,
        })),
      };
    }
    const { entries, rules } = await this.loadPrepInputs(plan.id);
    const prepEntries: PrepEntryInput[] = entries.map((e) => ({
      entryId: e.id,
      recipeId: e.recipe.id,
      title: e.recipe.title,
      dayIndex: e.dayIndex,
      servings: e.servings,
      prepMinutes: e.prepMinutes,
      cookMinutes: e.cookMinutes,
      freezeOk: rules.freezeTags.some((tag) => e.recipe.tags.includes(tag)),
      vegetableCount: e.vegetableCount,
    }));
    const drafts = buildPrepTasks(prepEntries, intensity);
    const session = await prisma.prepSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        mealPlanId: plan.id,
        scheduledAt: new Date(),
        targetMinutes: INTENSITY_TARGET_MINUTES[intensity],
        intensity,
      },
      update: { targetMinutes: INTENSITY_TARGET_MINUTES[intensity], intensity },
    });
    await prisma.prepTask.deleteMany({ where: { prepSessionId: session.id } });
    for (const d of drafts) {
      await prisma.prepTask.create({
        data: {
          id: `${session.id}-t${d.sequence}`,
          prepSessionId: session.id,
          title: d.title,
          durationMinutes: d.durationMinutes,
          sequence: d.sequence,
          parallelGroup: d.parallelGroup,
          instructions: d.instructions,
        },
      });
    }
    return {
      id: session.id,
      mealPlanId: session.mealPlanId,
      intensity,
      targetMinutes: INTENSITY_TARGET_MINUTES[intensity],
      tasks: drafts.map((d, i) => ({
        id: `${session.id}-t${d.sequence}`,
        title: d.title,
        durationMinutes: d.durationMinutes,
        sequence: d.sequence,
        parallelGroup: d.parallelGroup,
        instructions: d.instructions,
        done: false,
        ...(i === -1 ? { done: false } : {}),
      })),
    };
  }

  async togglePrepTask(userId: string, taskId: string, done: boolean): Promise<{ done: boolean }> {
    const plan = await this.getActivePlanRowOrThrow(userId);
    const prisma = getPrisma();
    const task = await prisma.prepTask.findFirst({
      where: { id: taskId, prepSession: { mealPlanId: plan.id } },
      select: { id: true },
    });
    if (!task) {
      throw new AppHttpException({
        code: 'PREP_TASK_NOT_FOUND',
        message: 'Задача не найдена',
        details: { taskId },
      });
    }
    await prisma.prepTask.update({ where: { id: taskId }, data: { done } });
    return { done };
  }

  /** MC-061: containers + defrost calendar for the ACTIVE plan. */
  async getStoragePlan(userId: string): Promise<StoragePlanDto> {
    const plan = await this.getActivePlanRowOrThrow(userId);
    const { entries, rules } = await this.loadPrepInputs(plan.id);
    const startIso = plan.startDate.toISOString().slice(0, 10);
    const storageEntries: StorageEntryInput[] = entries.map((e) => {
      const method = rules.freezeTags.some((tag) => e.recipe.tags.includes(tag))
        ? 'FREEZE_OK'
        : rules.noPrepTags.some((tag) => e.recipe.tags.includes(tag))
          ? 'NO_PREP'
          : 'FRIDGE_ONLY';
      return {
        entryId: e.id,
        recipeId: e.recipe.id,
        title: e.recipe.title,
        dayIndex: e.dayIndex,
        servings: e.servings,
        portionGrams: e.portionGrams,
        storageMethod: method,
        maxHoursFridge: rules.maxHoursFridge,
      };
    });
    return buildStoragePlan(storageEntries, startIso);
  }

  private async loadPrepInputs(planId: string) {
    const prisma = getPrisma();
    const plan = await prisma.mealPlan.findUniqueOrThrow({ where: { id: planId } });
    const days = await prisma.mealPlanDay.findMany({
      where: { mealPlanId: planId },
      orderBy: { date: 'asc' },
      include: { entries: { orderBy: { position: 'asc' }, include: { recipe: true } } },
    });
    const start = plan.startDate;
    const allRules = await prisma.storageRule.findMany({
      where: { OR: [{ recipeTag: { not: null } }, { storageMethod: 'FREEZE_OK' }] },
      select: { recipeTag: true, storageMethod: true, maxHoursFridge: true },
    });
    const entries = days.flatMap((day) => {
      const dayIndex = Math.round((day.date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      return day.entries.map((entry) => ({
        id: entry.id,
        recipe: {
          id: entry.recipe.id,
          title: entry.recipe.title,
          tags: entry.recipe.tags,
        },
        dayIndex,
        servings: entry.servings.toNumber(),
        portionGrams: entry.portionGrams.toNumber(),
        prepMinutes: entry.recipe.prepMinutes,
        cookMinutes: entry.recipe.cookMinutes,
        vegetableCount: 0, // refined below
      }));
    });
    // vegetableCount: VEGETABLE-group ingredients per recipe (one query).
    const recipeIds = [...new Set(entries.map((e) => e.recipe.id))];
    const vegRows = await prisma.recipeIngredient.findMany({
      where: {
        recipeId: { in: recipeIds },
        ingredient: { category: { name: { contains: 'овощ' } } },
      },
      select: { recipeId: true },
    });
    const vegCount = new Map<string, number>();
    for (const row of vegRows) vegCount.set(row.recipeId, (vegCount.get(row.recipeId) ?? 0) + 1);
    const withVeg = entries.map((e) => ({
      ...e,
      vegetableCount: vegCount.get(e.recipe.id) ?? 0,
    }));
    return {
      entries: withVeg,
      rules: {
        freezeTags: allRules
          .filter((r) => r.storageMethod === 'FREEZE_OK')
          .map((r) => r.recipeTag)
          .filter((t): t is string => t != null),
        noPrepTags: allRules
          .filter((r) => r.storageMethod === 'NO_PREP')
          .map((r) => r.recipeTag)
          .filter((t): t is string => t != null),
        maxHoursFridge: Math.max(24, ...allRules.map((r) => r.maxHoursFridge ?? 72)),
      },
    };
  }

  private async getActivePlanRowOrThrow(userId: string) {
    const householdId = await this.requireOwnedHouseholdId(userId);
    const plan = await getPrisma().mealPlan.findFirst({
      where: { householdId, status: 'ACTIVE' },
    });
    if (!plan) {
      throw new AppHttpException({
        code: 'PLAN_NOT_FOUND',
        message: 'Активный план не найден',
      });
    }
    return plan;
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
