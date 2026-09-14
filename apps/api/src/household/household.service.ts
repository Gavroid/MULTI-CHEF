// MC-011 — HouseholdService. Household ownership is implicit in
// every method: the caller is the OWNER of the household they pass
// (or the request is rejected with 403). MC-011 is single-user-per
// household; multi-member households are a future MC.

import { Injectable } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import type { HouseholdPatchBody } from '../profile/profile.dto.js';
import { AppHttpException } from '../common/exception-filter.js';

export interface HouseholdView {
  id: string;
  name: string;
  ownerId: string;
  defaultPeopleCount: number;
  currency: string;
  budgetWeekKopecks: number | null;
}

@Injectable()
export class HouseholdService {
  // T18-B (audit round 18): no service-level logger — request-scoped
  // errors are handled (once, structured) by AppHttpExceptionFilter.
  // Re-add a Logger only with a concrete log statement that needs it.

  async getCurrent(userId: string): Promise<HouseholdView> {
    const household = await this.requireOwnedHousehold(userId);
    return household;
  }

  async patchCurrent(userId: string, body: HouseholdPatchBody): Promise<HouseholdView> {
    const household = await this.requireOwnedHousehold(userId);
    const updated = await getPrisma().household.update({
      where: { id: household.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.defaultPeopleCount !== undefined
          ? { defaultPeopleCount: body.defaultPeopleCount }
          : {}),
        ...(body.budgetWeekKopecks !== undefined
          ? { budgetWeekKopecks: body.budgetWeekKopecks }
          : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      ownerId: updated.ownerId,
      defaultPeopleCount: updated.defaultPeopleCount,
      currency: updated.currency,
      budgetWeekKopecks: updated.budgetWeekKopecks,
    };
  }

  private async requireOwnedHousehold(userId: string): Promise<HouseholdView> {
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
    return {
      id: household.id,
      name: household.name,
      ownerId: household.ownerId,
      defaultPeopleCount: household.defaultPeopleCount,
      currency: household.currency,
      budgetWeekKopecks: household.budgetWeekKopecks,
    };
  }
}
