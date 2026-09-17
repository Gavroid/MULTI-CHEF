// MC-011 — HouseholdController. GET/PATCH the current user's household
// (always the one they OWN — clients cannot target another household).

import { Body, Controller, Get, HttpCode, Inject, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { HouseholdService } from './household.service.js';
import type { HouseholdPatchDto } from '../profile/profile.dto-classes.js';
import type { HouseholdPatchBody } from '../profile/profile.dto.js';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
@ApiTags('household')
@ApiCookieAuth('mc_session')
@ApiBearerAuth('session-token')
@Controller({ path: 'household' })
@UseGuards(AuthGuard)
export class HouseholdController {
  constructor(@Inject(HouseholdService) private readonly household: HouseholdService) {}

  @Get()
  @ApiOperation({ summary: "Get the authenticated user's household" })
  async get(@Req() req: FastifyRequest): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.household.getCurrent(user.id);
  }

  @Patch()
  @HttpCode(200)
  @ApiOperation({ summary: 'Update household metadata (owner-only)' })
  async patch(@Req() req: FastifyRequest, @Body() body: HouseholdPatchDto): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const input: HouseholdPatchBody = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.defaultPeopleCount !== undefined
        ? { defaultPeopleCount: body.defaultPeopleCount }
        : {}),
      ...(body.budgetWeekKopecks !== undefined
        ? { budgetWeekKopecks: body.budgetWeekKopecks }
        : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
    };
    return this.household.patchCurrent(user.id, input);
  }
}
