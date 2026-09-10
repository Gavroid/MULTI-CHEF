// MC-033 — Recommendations controller: POST /recommendations/today.
// AuthGuard (mc_session cookie). Idempotency-Key guard applies globally
// to POST (common/idempotency.ts). CSRF is enforced at the edge
// (mc_csrf cookie + X-CSRF-Token header) by the global middleware —
// the auth controller documents the same scheme for login.

import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppHttpException } from '../common/exception-filter.js';
import { RecommendationsService } from './recommendations.service.js';
import { TodayRequestDtoSchema, type TodayRecommendationDto } from './recommendations.dto.js';

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
  async today(@Req() req: FastifyRequest, @Body() body: unknown): Promise<TodayRecommendationDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const parsed = TodayRequestDtoSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_root';
        (fields[key] ??= []).push(issue.message);
      }
      throw new AppHttpException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: { fields },
      });
    }
    return this.svc.getToday(user.id, parsed.data, new Date());
  }
}
