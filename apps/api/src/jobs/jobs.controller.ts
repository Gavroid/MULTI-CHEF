// MC-050 — Jobs controller: GET /api/v1/jobs/:id (ownership-scoped).

import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnprocessableEntityResponse,
  ApiTooManyRequestsResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { JobDto } from '@multichef/contracts';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { JobsService } from './jobs.service.js';

@ApiTags('jobs')
@UseGuards(AuthGuard)
// Class-level error contract (E15/T34-B): применяется ко всем маршрутам.
@ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
@ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
@ApiNotFoundResponse({ description: 'Ресурс не найден' })
@ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
@ApiTooManyRequestsResponse({ description: 'Rate limit' })
@ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
@Controller({ path: 'jobs' })
export class JobsController {
  constructor(@Inject(JobsService) private readonly svc: JobsService) {}
  @ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
  @ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
  @ApiNotFoundResponse({ description: 'Ресурс не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit' })
  @ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
  @Get(':id')
  @ApiOperation({ summary: 'Job status mirror (QUEUED → PROCESSING → COMPLETED/FAILED)' })
  @ApiResponse({ status: 200, description: 'Job row' })
  @ApiResponse({ status: 404, description: 'JOB_NOT_FOUND (own or foreign)' })
  async get(@Req() req: FastifyRequest, @Param('id') id: string): Promise<JobDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const job = await this.svc.getForUser(id, user.id);
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      resultRef: job.resultRef,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
