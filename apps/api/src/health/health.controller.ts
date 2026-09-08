import { Controller, Get } from '@nestjs/common';

// Health endpoints under the global /api/v1 prefix (configured in main.ts).
// MC-001: liveness only — readiness is wired against real dependencies in
// later milestones (see ADR-0007 / DEVELOPMENT-PLAN §0).
@Controller('health')
export class HealthController {
  @Get('live')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  readiness(): { status: 'ok' } {
    // Placeholder: real readiness will probe Postgres + Redis once MC-003 lands.
    return { status: 'ok' };
  }
}
