// MC-011 — ProfileController. Mounted at /api/v1/profile. Every
// route is guarded by AuthGuard (cookie → user) so the controller
// can call `currentUser(req)` instead of doing the lookup itself.
//
// OpenAPI annotations live alongside the @nestjs/swagger decorators
// so /api/v1/docs reflects the new endpoints.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ProfileService, type PreferenceKind } from './profile.service.js';
import type {
  NutritionPutBody,
  OnboardingBody,
  PreferenceCreateBody,
  ProfilePatchBody,
} from './profile.dto.js';
import type {
  NutritionPutDto,
  OnboardingDto,
  PreferenceCreateDto,
  ProfilePatchDto,
} from './profile.dto-classes.js';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import { AppHttpException } from '../common/exception-filter.js';

@ApiTags('profile')
@ApiCookieAuth('mc_session')
@ApiBearerAuth('session-token')
@Controller({ path: 'profile' })
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Profile bundle' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async get(@Req() req: FastifyRequest): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.profile.getProfile(user.id);
  }

  @Patch()
  @HttpCode(200)
  @ApiOperation({ summary: 'Update display fields on the user (email/tz/locale)' })
  @ApiResponse({ status: 200, description: 'Updated user' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async patch(@Req() req: FastifyRequest, @Body() body: ProfilePatchDto): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const patch: ProfilePatchBody = {
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.tz !== undefined ? { tz: body.tz } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
    };
    return this.profile.patchProfile(user.id, patch);
  }

  @Get('nutrition')
  @ApiOperation({ summary: 'Get NutritionProfile (1:1 with User)' })
  async getNutrition(@Req() req: FastifyRequest): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.profile.getNutrition(user.id);
  }

  @Put('nutrition')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upsert NutritionProfile (full replace semantics)' })
  @ApiResponse({ status: 200, description: 'NutritionProfile after upsert' })
  async putNutrition(@Req() req: FastifyRequest, @Body() body: NutritionPutDto): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const put: NutritionPutBody = {
      ...(body.targetCalories !== undefined ? { targetCalories: body.targetCalories } : {}),
      ...(body.targetProteinG !== undefined ? { targetProteinG: body.targetProteinG } : {}),
      ...(body.targetFatG !== undefined ? { targetFatG: body.targetFatG } : {}),
      ...(body.targetCarbsG !== undefined ? { targetCarbsG: body.targetCarbsG } : {}),
      ...(body.mealsPerDay !== undefined ? { mealsPerDay: body.mealsPerDay } : {}),
      ...(body.preferredPrepMinutes !== undefined
        ? { preferredPrepMinutes: body.preferredPrepMinutes }
        : {}),
      ...(body.skillLevel !== undefined ? { skillLevel: body.skillLevel } : {}),
      ...(body.appliances !== undefined ? { appliances: body.appliances } : {}),
      ...(body.dietType !== undefined ? { dietType: body.dietType } : {}),
      ...(body.activityNotes !== undefined ? { activityNotes: body.activityNotes } : {}),
    };
    return this.profile.putNutrition(user.id, put);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'List preferences (optionally filtered by kind)' })
  async listPreferences(@Req() req: FastifyRequest): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const kind = (req.query as { kind?: string }).kind as PreferenceKind | undefined;
    if (kind && !['LOVE', 'DISLIKE', 'ALLERGY', 'EXCLUDE'].includes(kind)) {
      throw new AppHttpException({
        code: 'VALIDATION_ERROR',
        message: 'Unknown preference kind',
        details: { fields: { kind: [`must be one of LOVE/DISLIKE/ALLERGY/EXCLUDE`] } },
      });
    }
    return this.profile.listPreferences(user.id, kind);
  }

  @Post('preferences')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a preference' })
  @ApiResponse({ status: 201, description: 'Preference added' })
  @ApiResponse({ status: 404, description: 'Ingredient not found' })
  async addPreference(
    @Req() req: FastifyRequest,
    @Body() body: PreferenceCreateDto,
  ): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const input: PreferenceCreateBody = {
      kind: body.kind,
      ...(body.ingredientId !== undefined ? { ingredientId: body.ingredientId } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    };
    return this.profile.addPreference(user.id, input);
  }

  @Delete('preferences/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a preference by id (owner-scoped)' })
  async removePreference(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    await this.profile.removePreference(user.id, id);
  }

  @Post('onboarding')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run onboarding: updates NutritionProfile + adds Preference[]' })
  async onboarding(@Req() req: FastifyRequest, @Body() body: OnboardingDto): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const input: OnboardingBody = {
      householdSize: body.householdSize,
      budgetPerWeekKopecks: body.budgetPerWeekKopecks,
      allergies: body.allergies,
      likedIngredients: body.likedIngredients,
      dislikedIngredients: body.dislikedIngredients,
      appliances: body.appliances,
      skillLevel: body.skillLevel,
      typicalCookTimeMin: body.typicalCookTimeMin,
    };
    return this.profile.onboarding(user.id, input);
  }
}
