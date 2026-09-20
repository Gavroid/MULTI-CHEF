// MC-033 — Recommendations controller: POST /recommendations/today.
// AuthGuard (mc_session cookie). Idempotency-Key guard applies globally
// to POST (common/idempotency.ts). CSRF is enforced at the edge
// (mc_csrf cookie + X-CSRF-Token header) by the global middleware —
// the auth controller documents the same scheme for login.

import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { RecommendationsService } from './recommendations.service.js';
import {
  LeftoversRequestDtoSchema,
  RescueRequestDtoSchema,
  RouletteDrawRequestDtoSchema,
  TodayRequestDtoSchema,
  type LeftoversRequestDto,
  type LeftoversResponseDto,
  type RescueRequestDto,
  type RescueResponseDto,
  type RouletteDrawRequestDto,
  type RouletteDrawResponseDto,
  type RouletteRejectResponseDto,
  type TodayRequestDto,
  type TodayRecommendationDto,
} from './recommendations.dto.js';

@ApiTags('recommendations')
@UseGuards(AuthGuard)
@Controller({ path: 'recommendations' })
export class RecommendationsController {
  constructor(@Inject(RecommendationsService) private readonly svc: RecommendationsService) {}

  @Post('today')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate 3 "today" meal options (sync, < 500 ms)' })
  @ApiResponse({ status: 200, description: 'FROM_PANTRY / BEST_MATCH / CHAIN options' })
  @ApiResponse({ status: 401, description: 'No session' })
  @ApiResponse({ status: 400, description: 'Invalid body' })
  @ApiResponse({ status: 403, description: 'No owned household' })
  async today(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(TodayRequestDtoSchema)) body: TodayRequestDto,
  ): Promise<TodayRecommendationDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.svc.getToday(user.id, body, new Date());
  }

  /** MC-040 «Спаси продукт»: recipes that use a pantry ingredient. */
  @Post('rescue')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rescue a pantry ingredient: recipes that use it (sync)' })
  @ApiResponse({ status: 200, description: 'Ranked options + pantryUsage' })
  @ApiResponse({ status: 401, description: 'No session' })
  @ApiResponse({ status: 404, description: 'INGREDIENT_NOT_FOUND — not in this household pantry' })
  @ApiResponse({ status: 422, description: 'EMPTY_RESCUE — no published recipe uses it' })
  async rescue(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(RescueRequestDtoSchema)) body: RescueRequestDto,
  ): Promise<RescueResponseDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.svc.getRescue(user.id, body, new Date());
  }

  /**
   * R21 (продукт-план): «Преображение остатков» — опубликованные
   * рецепты-преобразования для базовых блюд (leftoverSourceOf).
   */
  @Post('leftovers')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recipes that transform the given leftover dishes' })
  @ApiResponse({ status: 200, description: 'Up to 10 transformation recipes' })
  @ApiResponse({ status: 401, description: 'No session' })
  async leftovers(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(LeftoversRequestDtoSchema)) body: LeftoversRequestDto,
  ): Promise<LeftoversResponseDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.svc.getLeftoversForBase(user.id, body.baseRecipeIds);
  }

  /** MC-042: draw one weighted-random card. */
  @Post('roulette/draw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Draw a weighted-random recipe card' })
  @ApiResponse({ status: 200, description: 'One option + attemptsLeft' })
  @ApiResponse({ status: 401, description: 'No session' })
  async rouletteDraw(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(RouletteDrawRequestDtoSchema)) body: RouletteDrawRequestDto,
  ): Promise<RouletteDrawResponseDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.svc.drawRoulette(user.id, body, new Date());
  }

  /** MC-042: reject the current card (max 2, then 409). */
  @Post('roulette/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject the drawn card (server-enforced limit of 2)' })
  @ApiResponse({ status: 200, description: 'attemptsLeft after the reject' })
  @ApiResponse({ status: 409, description: 'REJECT_LIMIT_REACHED' })
  async rouletteReject(@Req() req: FastifyRequest): Promise<RouletteRejectResponseDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.svc.rejectRoulette(user.id);
  }
}
