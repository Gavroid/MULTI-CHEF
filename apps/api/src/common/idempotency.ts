// MC-010 — Idempotency-Key guard.
//
// docs/api/conventions.md §4: every state-mutating verb (POST, PUT,
// PATCH, DELETE) MUST carry an `Idempotency-Key` header. This module
// enforces the *presence* and *format* of the header.
//
// The response-level deduplication promised by conventions.md §3
// (24h TTL, request fingerprint match, cached replay) lives in
// idempotency-cache.ts — applied globally via IdempotencyReplayInterceptor.

import { Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AppHttpException } from './exception-filter.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const IDEMPOTENCY_MIN_LENGTH = 16;

/**
 * Validate an incoming request's Idempotency-Key header.
 *
 * Accepts either a raw headers object (Fastify-style: `req.headers`) or
 * a wrapper object with a `headers` field. Both shapes are supported so
 * tests can call this directly without constructing a fake request.
 */
export function requireIdempotencyKey(
  input: Record<string, unknown> | { headers: Record<string, unknown> },
): string {
  const headers = 'headers' in input && input.headers !== undefined ? input.headers : input;
  const raw = (headers as Record<string, unknown>)[IDEMPOTENCY_HEADER];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppHttpException({
      code: 'VALIDATION_ERROR',
      message: 'Missing Idempotency-Key header',
      details: { fields: { 'Idempotency-Key': ['header is required'] } },
    });
  }
  if (raw.length < IDEMPOTENCY_MIN_LENGTH) {
    throw new AppHttpException({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Key is too short',
      details: {
        fields: {
          'Idempotency-Key': [`must be at least ${IDEMPOTENCY_MIN_LENGTH} characters`],
        },
      },
    });
  }
  return raw;
}

// T69-D (E26): routes that carry their OWN idempotency (signed webhook
// event ids) opt out — external senders must not need our header.
export const IDEMPOTENCY_SKIP_KEY = 'idempotency:skip';

export function SkipIdempotency(): MethodDecorator {
  return SetMetadata(IDEMPOTENCY_SKIP_KEY, true);
}

@Injectable()
export class IdempotencyKeyGuard implements CanActivate {
  // APP_GUARD registration bypasses DI for this guard's params —
  // instantiate the (stateless) Reflector internally.
  private readonly reflector = new Reflector();

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ method?: string; headers: Record<string, unknown> }>();
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }
    const skip = this.reflector.getAllAndOverride<boolean>(IDEMPOTENCY_SKIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    requireIdempotencyKey(req.headers);
    return true;
  }
}
