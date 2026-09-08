// MC-010 — Idempotency-Key guard.
//
// docs/api/conventions.md §4: every state-mutating verb (POST, PUT,
// PATCH, DELETE) MUST carry an `Idempotency-Key` header. This module
// enforces the *presence* and *format* of the header.
//
// Real cache-backed deduplication (24h TTL, request fingerprint
// match, in-flight serialization) is MC-051 work. For MC-010 we
// only validate the header.

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AppHttpException } from './exception-filter.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

const MIN_LENGTH = 16;

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
  if (raw.length < MIN_LENGTH) {
    throw new AppHttpException({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Key is too short',
      details: {
        fields: {
          'Idempotency-Key': [`must be at least ${MIN_LENGTH} characters`],
        },
      },
    });
  }
  return raw;
}

@Injectable()
export class IdempotencyKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ method?: string; headers: Record<string, unknown> }>();
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }
    requireIdempotencyKey(req.headers);
    return true;
  }
}
