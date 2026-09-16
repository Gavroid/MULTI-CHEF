// T69-D (E26): the single inbound webhook endpoint. Signature is
// verified against the RAW body (before any JSON re-serialisation);
// event ids are deduplicated; unknown types ack 200.
import { Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SkipIdempotency } from '../common/idempotency.js';
import { verifySignature, WebhooksService } from './webhooks.service.js';
import type { WebhookEvent } from './webhooks.service.js';

const WebhookEventSchema = z.object({
  id: z.string().min(8).max(200),
  type: z.string().regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/),
  occurredAt: z.string().datetime(),
  data: z.record(z.unknown()).optional(),
});

/** Verifies X-MC-Signature (HMAC-SHA256 over the raw body). */
class WebhookSignatureGuard {
  /** 'ok' | 'no-secret' | 'no-raw' | 'bad-signature' */
  check(req: FastifyRequest): string {
    const secret = process.env['WEBHOOK_SIGNING_SECRET'];
    if (!secret) return 'no-secret';
    const raw =
      (req as unknown as { rawBody?: Buffer; body?: Buffer }).rawBody ??
      (req as unknown as { body?: Buffer }).body;
    if (!Buffer.isBuffer(raw)) return 'no-raw';
    const header = req.headers['x-mc-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!verifySignature(secret, raw, signature)) return 'bad-signature';
    return 'ok';
  }
}

@ApiTags('webhooks')
@Controller({ path: 'webhooks' })
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly svc: WebhooksService) {}

  @Get('health')
  @ApiOperation({ summary: 'Webhook receiver configuration status' })
  health(): { endpoint: string; secretConfigured: boolean } {
    return {
      endpoint: '/api/v1/webhooks/inbound',
      secretConfigured: Boolean(process.env['WEBHOOK_SIGNING_SECRET']),
    };
  }

  @SkipIdempotency()
  @Post('inbound')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signed inbound webhook receiver (docs/api/webhooks.md)' })
  async inbound(@Req() req: FastifyRequest): Promise<{ received: boolean }> {
    const verdict = new WebhookSignatureGuard().check(req);
    if (verdict === 'no-raw') {
      // rawBody tee missing — without exact bytes we cannot verify HMAC.
      throw new AppHttpException({
        code: 'VALIDATION_ERROR',
        message: 'raw body unavailable for signature verification',
      });
    }
    if (verdict !== 'ok') {
      // 401 envelope — unsigned/tampered deliveries never reach handlers.
      throw new UnauthorizedWebhookError();
    }
    const parsed = WebhookEventSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InvalidWebhookError();
    }
    const event: WebhookEvent = {
      id: parsed.data.id,
      type: parsed.data.type,
      occurredAt: parsed.data.occurredAt,
      data: (parsed.data.data ?? {}) as Record<string, unknown>,
    };
    if (!this.svc.claimEventId(event.id)) {
      return { received: true }; // replay — ack without reprocessing
    }
    await this.svc.dispatch(event);
    return { received: true };
  }
}

import { AppHttpException } from '../common/exception-filter.js';

class UnauthorizedWebhookError extends AppHttpException {
  constructor() {
    super({ code: 'UNAUTHORIZED', message: 'Invalid webhook signature' });
  }
}

class InvalidWebhookError extends AppHttpException {
  constructor() {
    super({ code: 'VALIDATION_ERROR', message: 'Invalid webhook event' });
  }
}
