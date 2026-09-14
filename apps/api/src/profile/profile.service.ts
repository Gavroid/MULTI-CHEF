// MC-011 — Profile service. All persistence is via @multichef/database.
//
// SECURITY POSTURE (PM-prompt #3, PRD §4.2):
//   * `householdId` is always derived from the authenticated user's
//     OWNER membership — clients cannot pass another household's id.
//   * Every ownership check throws FORBIDDEN (403) when the user
//     has no HouseholdMember row matching the resource.
//   * Idempotency for onboarding is enforced by the database
//     (NutritionProfile is 1:1 on userId; Preferences deduped by
//     (userId, kind, ingredientId) when ingredientId is set).
//   * Money is always stored as Int kopecks; UI converts.

import { Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
// APPLIANCE_VALUES / PREFERENCE_KIND_VALUES are exported as `as const`
// tuples; the service derives the union type via `(typeof X)[number]`
// which makes them only used in type positions. The values still need
// to be in scope for the runtime to evaluate `(typeof X)[number]`.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  APPLIANCE_VALUES,
  PREFERENCE_KIND_VALUES,
  type OnboardingBody,
  type PreferenceCreateBody,
} from './profile.dto.js';
import { generateUlid } from '../auth/session-token.js';
import { AppHttpException } from '../common/exception-filter.js';
import { isUniqueConstraintOn } from '../common/prisma-errors.js';

export interface ProfileView {
  user: {
    id: string;
    email: string;
    tz: string;
    locale: string;
    status: string;
  };
  household: {
    id: string;
    name: string;
    ownerId: string;
    defaultPeopleCount: number;
    currency: string;
    budgetWeekKopecks: number | null;
  };
  nutritionProfile: {
    userId: string;
    targetCalories: number | null;
    targetProteinG: number | null;
    targetFatG: number | null;
    targetCarbsG: number | null;
    mealsPerDay: number;
    preferredPrepMinutes: number;
    skillLevel: string;
    appliances: string[];
    dietType: string;
    activityNotes: string | null;
  } | null;
  preferences: Array<{
    id: string;
    kind: string;
    ingredientId: string | null;
    note: string | null;
  }>;
}

export type PreferenceKind = (typeof PREFERENCE_KIND_VALUES)[number];
export type Appliance = (typeof APPLIANCE_VALUES)[number];

@Injectable()
export class ProfileService {
  // T18-B (audit round 18): no service-level logger — request-scoped
  // errors are handled (once, structured) by AppHttpExceptionFilter.
  // Re-add a Logger only with a concrete log statement that needs it.

  async getProfile(userId: string): Promise<ProfileView> {
    const user = await getPrisma().user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        tz: true,
        locale: true,
        status: true,
      },
    });
    const household = await this.requireOwnedHousehold(userId);
    const [nutritionProfile, preferences] = await Promise.all([
      getPrisma().nutritionProfile.findUnique({ where: { userId } }),
      getPrisma().preference.findMany({
        where: { userId },
        orderBy: [{ kind: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      user,
      household: this.toHouseholdView(household),
      nutritionProfile: nutritionProfile ? this.toNutritionView(nutritionProfile) : null,
      preferences: preferences.map((p) => ({
        id: p.id,
        kind: p.kind,
        ingredientId: p.ingredientId,
        note: p.note,
      })),
    };
  }

  async patchProfile(
    userId: string,
    patch: { email?: string | undefined; tz?: string | undefined; locale?: string | undefined },
  ): Promise<ProfileView['user']> {
    if (patch.email) {
      const existing = await getPrisma().user.findUnique({
        where: { email: patch.email },
      });
      if (existing && existing.id !== userId) {
        throw new AppHttpException({
          code: 'CONFLICT',
          message: 'Email is already in use',
        });
      }
    }
    const updated = await getPrisma().user.update({
      where: { id: userId },
      data: {
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.tz !== undefined ? { tz: patch.tz } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
      },
      select: { id: true, email: true, tz: true, locale: true, status: true },
    });
    return updated;
  }

  async getNutrition(userId: string): Promise<ProfileView['nutritionProfile']> {
    const np = await getPrisma().nutritionProfile.findUnique({ where: { userId } });
    return np ? this.toNutritionView(np) : null;
  }

  async putNutrition(
    userId: string,
    body: {
      targetCalories?: number | null | undefined;
      targetProteinG?: number | null | undefined;
      targetFatG?: number | null | undefined;
      targetCarbsG?: number | null | undefined;
      mealsPerDay?: number | undefined;
      preferredPrepMinutes?: number | undefined;
      skillLevel?: string | undefined;
      appliances?: string[] | undefined;
      dietType?: string | undefined;
      activityNotes?: string | null | undefined;
    },
  ): Promise<ProfileView['nutritionProfile']> {
    const np = await getPrisma().nutritionProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...(body.targetCalories !== undefined ? { targetCalories: body.targetCalories } : {}),
        ...(body.targetProteinG !== undefined ? { targetProteinG: body.targetProteinG } : {}),
        ...(body.targetFatG !== undefined ? { targetFatG: body.targetFatG } : {}),
        ...(body.targetCarbsG !== undefined ? { targetCarbsG: body.targetCarbsG } : {}),
        ...(body.mealsPerDay !== undefined ? { mealsPerDay: body.mealsPerDay } : {}),
        ...(body.preferredPrepMinutes !== undefined
          ? { preferredPrepMinutes: body.preferredPrepMinutes }
          : {}),
        ...(body.skillLevel !== undefined
          ? { skillLevel: body.skillLevel as 'BEGINNER' | 'CONFIDENT' | 'EXPERIMENTER' }
          : {}),
        ...(body.appliances !== undefined ? { appliances: body.appliances } : {}),
        ...(body.dietType !== undefined
          ? { dietType: body.dietType as 'NONE' | 'VEGETARIAN' | 'VEGAN' | 'PESCATARIAN' }
          : {}),
        ...(body.activityNotes !== undefined ? { activityNotes: body.activityNotes } : {}),
      },
      update: {
        ...(body.targetCalories !== undefined ? { targetCalories: body.targetCalories } : {}),
        ...(body.targetProteinG !== undefined ? { targetProteinG: body.targetProteinG } : {}),
        ...(body.targetFatG !== undefined ? { targetFatG: body.targetFatG } : {}),
        ...(body.targetCarbsG !== undefined ? { targetCarbsG: body.targetCarbsG } : {}),
        ...(body.mealsPerDay !== undefined ? { mealsPerDay: body.mealsPerDay } : {}),
        ...(body.preferredPrepMinutes !== undefined
          ? { preferredPrepMinutes: body.preferredPrepMinutes }
          : {}),
        ...(body.skillLevel !== undefined
          ? { skillLevel: body.skillLevel as 'BEGINNER' | 'CONFIDENT' | 'EXPERIMENTER' }
          : {}),
        ...(body.appliances !== undefined ? { appliances: body.appliances } : {}),
        ...(body.dietType !== undefined
          ? { dietType: body.dietType as 'NONE' | 'VEGETARIAN' | 'VEGAN' | 'PESCATARIAN' }
          : {}),
        ...(body.activityNotes !== undefined ? { activityNotes: body.activityNotes } : {}),
      },
    });
    return this.toNutritionView(np);
  }

  async listPreferences(
    userId: string,
    kind?: PreferenceKind,
  ): Promise<ProfileView['preferences']> {
    const rows = await getPrisma().preference.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: [{ kind: 'asc' }, { id: 'asc' }],
    });
    return rows.map((p) => ({
      id: p.id,
      kind: p.kind,
      ingredientId: p.ingredientId,
      note: p.note,
    }));
  }

  async addPreference(
    userId: string,
    body: PreferenceCreateBody,
  ): Promise<ProfileView['preferences'][number]> {
    if (body.ingredientId) {
      const ingredient = await getPrisma().ingredient.findUnique({
        where: { id: body.ingredientId },
        select: { id: true },
      });
      if (!ingredient) {
        throw new AppHttpException({
          code: 'NOT_FOUND',
          message: 'Ingredient not found',
        });
      }
    }
    try {
      // T14-A (audit round 14): the whole check-then-act runs inside one
      // transaction; the @@unique([userId, kind, ingredientId]) index is
      // the final arbiter when two concurrent adds both miss findFirst.
      return await getPrisma().$transaction(async (tx) => {
        if (body.ingredientId) {
          const existing = await tx.preference.findFirst({
            where: { userId, kind: body.kind, ingredientId: body.ingredientId },
          });
          if (existing) {
            return {
              id: existing.id,
              kind: existing.kind,
              ingredientId: existing.ingredientId,
              note: existing.note,
            };
          }
        }
        const created = await tx.preference.create({
          data: {
            id: generateUlid(),
            userId,
            ...(body.ingredientId !== undefined ? { ingredientId: body.ingredientId } : {}),
            kind: body.kind,
            ...(body.note !== undefined ? { note: body.note } : {}),
          },
        });
        return {
          id: created.id,
          kind: created.kind,
          ingredientId: created.ingredientId,
          note: created.note,
        };
      });
    } catch (err) {
      // Lost the insert race — return the winner's row so the replay
      // stays idempotent (same shape as the findFirst hit above).
      if (isUniqueConstraintOn(err, 'ingredientId')) {
        const winner = await getPrisma().preference.findFirstOrThrow({
          where: { userId, kind: body.kind, ingredientId: body.ingredientId ?? null },
        });
        return {
          id: winner.id,
          kind: winner.kind,
          ingredientId: winner.ingredientId,
          note: winner.note,
        };
      }
      throw err;
    }
  }

  async removePreference(userId: string, preferenceId: string): Promise<void> {
    const row = await getPrisma().preference.findUnique({ where: { id: preferenceId } });
    if (!row) {
      throw new AppHttpException({ code: 'NOT_FOUND', message: 'Preference not found' });
    }
    if (row.userId !== userId) {
      // Don't leak the existence of someone else's preference.
      throw new AppHttpException({ code: 'NOT_FOUND', message: 'Preference not found' });
    }
    await getPrisma().preference.delete({ where: { id: preferenceId } });
  }

  async onboarding(
    userId: string,
    body: OnboardingBody,
  ): Promise<{ nutritionProfile: ProfileView['nutritionProfile']; preferencesCreated: number }> {
    // Idempotent onboarding: upsert NutritionProfile, then for each
    // list (allergies → ALLERGY, liked → LOVE, disliked → DISLIKE)
    // dedupe by (userId, kind, ingredientId) before inserting.
    const result = await getPrisma().$transaction(async (tx) => {
      const np = await tx.nutritionProfile.upsert({
        where: { userId },
        create: {
          userId,
          mealsPerDay: 3,
          preferredPrepMinutes: body.typicalCookTimeMin,
          skillLevel: body.skillLevel,
          appliances: body.appliances,
          dietType: 'NONE',
        },
        update: {
          preferredPrepMinutes: body.typicalCookTimeMin,
          skillLevel: body.skillLevel,
          appliances: body.appliances,
        },
      });

      // Update household with size + budget
      const ownedHousehold = await tx.household.findFirstOrThrow({
        where: { ownerId: userId, members: { some: { userId, role: 'OWNER' } } },
      });
      await tx.household.update({
        where: { id: ownedHousehold.id },
        data: {
          defaultPeopleCount: body.householdSize,
          budgetWeekKopecks: body.budgetPerWeekKopecks,
        },
      });

      const ingredientIds = new Set<string>([
        ...body.allergies,
        ...body.likedIngredients,
        ...body.dislikedIngredients,
      ]);
      const knownIngredients = ingredientIds.size
        ? await tx.ingredient.findMany({
            where: { id: { in: [...ingredientIds] } },
            select: { id: true },
          })
        : [];
      const knownSet = new Set(knownIngredients.map((i) => i.id));
      const unknown = [...ingredientIds].filter((id) => !knownSet.has(id));
      if (unknown.length > 0) {
        throw new AppHttpException({
          code: 'VALIDATION_ERROR',
          message: 'Unknown ingredient IDs',
          details: { unknownIngredientIds: unknown },
        });
      }

      let preferencesCreated = 0;
      const insertPreferences = async (
        kind: 'ALLERGY' | 'LOVE' | 'DISLIKE',
        ids: string[],
      ): Promise<void> => {
        for (const ingredientId of ids) {
          const existing = await tx.preference.findFirst({
            where: { userId, kind, ingredientId },
          });
          if (existing) continue;
          try {
            await tx.preference.create({
              data: {
                id: generateUlid(),
                userId,
                kind,
                ingredientId,
              },
            });
            preferencesCreated += 1;
          } catch (err) {
            // T14-A: a concurrent onboarding may have inserted the same
            // (userId, kind, ingredientId) after our findFirst — the
            // unique index keeps one row, treat it as already-present
            // (don't count it: this request didn't create it).
            if (!isUniqueConstraintOn(err, 'ingredientId')) throw err;
          }
        }
      };
      await insertPreferences('ALLERGY', body.allergies);
      await insertPreferences('LOVE', body.likedIngredients);
      await insertPreferences('DISLIKE', body.dislikedIngredients);

      return { np, preferencesCreated };
    });
    return {
      nutritionProfile: this.toNutritionView(result.np),
      preferencesCreated: result.preferencesCreated,
    };
  }

  private async requireOwnedHousehold(userId: string): Promise<{
    id: string;
    name: string;
    ownerId: string;
    defaultPeopleCount: number;
    currency: string;
    budgetWeekKopecks: number | null;
  }> {
    const membership = await getPrisma().householdMember.findFirst({
      where: { userId, role: 'OWNER' },
    });
    if (!membership) {
      throw new AppHttpException({
        code: 'FORBIDDEN',
        message: 'No owned household for this user',
      });
    }
    const household = await getPrisma().household.findUnique({
      where: { id: membership.householdId },
    });
    if (!household) {
      throw new AppHttpException({
        code: 'FORBIDDEN',
        message: 'No owned household for this user',
      });
    }
    return household;
  }

  private toHouseholdView(h: {
    id: string;
    name: string;
    ownerId: string;
    defaultPeopleCount: number;
    currency: string;
    budgetWeekKopecks: number | null;
  }): ProfileView['household'] {
    return {
      id: h.id,
      name: h.name,
      ownerId: h.ownerId,
      defaultPeopleCount: h.defaultPeopleCount,
      currency: h.currency,
      budgetWeekKopecks: h.budgetWeekKopecks,
    };
  }

  private toNutritionView(np: {
    userId: string;
    targetCalories: number | null;
    targetProteinG: number | null;
    targetFatG: number | null;
    targetCarbsG: number | null;
    mealsPerDay: number;
    preferredPrepMinutes: number;
    skillLevel: string;
    appliances: string[];
    dietType: string;
    activityNotes: string | null;
  }): ProfileView['nutritionProfile'] {
    return {
      userId: np.userId,
      targetCalories: np.targetCalories,
      targetProteinG: np.targetProteinG,
      targetFatG: np.targetFatG,
      targetCarbsG: np.targetCarbsG,
      mealsPerDay: np.mealsPerDay,
      preferredPrepMinutes: np.preferredPrepMinutes,
      skillLevel: np.skillLevel,
      appliances: np.appliances,
      dietType: np.dietType,
      activityNotes: np.activityNotes,
    };
  }
}
