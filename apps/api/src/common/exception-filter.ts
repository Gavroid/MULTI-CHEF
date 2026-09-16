// MC-010 — global NestJS exception filter that converts any thrown error
// into the { error: { code, message, details? } } envelope from
// docs/api/conventions.md §2.
//
// Usage: registered globally via `app.useGlobalFilters(new AppHttpExceptionFilter())`.
// Custom errors are thrown via `throw new AppHttpException({ code: '…' })`
// or by passing an `AppError`-shaped object to `HttpException`.

import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getPrisma } from '@multichef/database';
import { hashSessionToken } from '../auth/session-token.js';
import { captureException } from './sentry.js';
import type { ErrorCode, ErrorInput } from './error-envelope.js';
import {
  envelopeFromRequest,
  localizeErrorMessage,
  redactSecrets,
  STATUS_BY_CODE,
  type ErrorBody,
} from './error-envelope.js';
export class AppHttpException extends HttpException {
  readonly code: ErrorCode | string;
  readonly details?: Record<string, unknown> | null | undefined;

  constructor(input: ErrorInput) {
    // Audit fix (round 3, 2026-09-13): the previous constructor passed
    // only the CODE string into HttpException with a hardcoded 500 —
    // the filter then lost message/details AND every domain error
    // (INGREDIENT_NOT_FOUND, JOB_NOT_FOUND, CSRF_MISMATCH, ...) came
    // out as 500 INTERNAL_ERROR on the wire. Now the full envelope is
    // carried and the HTTP status is derived from STATUS_BY_CODE.
    const status =
      STATUS_BY_CODE[(input.code ?? 'INTERNAL_ERROR') as keyof typeof STATUS_BY_CODE] ?? 500;
    super(
      {
        code: input.code ?? 'INTERNAL_ERROR',
        message: input.message,
        ...(input.details ? { details: input.details } : {}),
      },
      status,
    );
    this.code = input.code;
    this.details = input.details;
  }
}

@Catch()
export class AppHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppHttpExceptionFilter.name);

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let input: ErrorInput;
    if (exception instanceof AppHttpException) {
      const inner = exception.getResponse();
      input = typeof inner === 'string' ? { code: inner } : (inner as ErrorInput);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const inner = exception.getResponse();
      input = mapHttpStatusToError(status, inner);
    } else {
      // T18-A: ONE compact record + the stack string — never the raw
      // exception object (Nest pretty-printed it, dumping Prisma meta,
      // clientVersion and dist paths into the journal next to the
      // prisma:error line).
      // T18-D: the record passes through redactSecrets so secret-shaped
      // keys in error payloads cannot reach the journal ahead of the
      // structured-logging migration.
      const name = exception instanceof Error ? exception.name : 'unknown';
      const message = exception instanceof Error ? exception.message : String(exception);
      const record = redactSecrets({
        type: name,
        message,
        ...(exception instanceof Prisma.PrismaClientKnownRequestError
          ? { prismaCode: exception.code, target: exception.meta?.['target'] }
          : {}),
      });
      this.logger.error(
        `unhandled exception: ${JSON.stringify(record)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // T54-D (E24): Fastify framework errors (payload too large,
      // unsupported media type, ...) carry a numeric statusCode — map
      // client-side ones to their envelope codes instead of a 500.
      const statusCode = (exception as { statusCode?: number } | null)?.statusCode;
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        input = mapHttpStatusToError(statusCode, message);
      } else {
        input = { code: 'INTERNAL_ERROR', message: 'Internal server error' };
      }
    }

    // T46-A/T46-C (E23): human message resolved from the contracts
    // dictionary by User.locale (default 'ru' — also covers anonymous
    // callers whose errors fire before AuthGuard fills request.user).
    // Public routes (recipes catalog) carry no request.user — fall back
    // to the mc_session cookie, and only on this rare error path.
    const locale =
      (request as { user?: { locale?: string } } | undefined)?.user?.locale ??
      (await this.resolveLocaleFromSession(request));
    input = {
      ...input,
      message: localizeErrorMessage(input.code, locale, input.message ?? 'Internal server error'),
    };

    const body: ErrorBody = envelopeFromRequest(request, input);
    // WP-6.2 (#16 recommendation): greppable 5xx marker per response —
    // the seed for a Prometheus counter until real metrics land.
    if (body.status >= 500) {
      const path =
        (request as { url?: string } | undefined)?.url ??
        (request as { raw?: { url?: string } } | undefined)?.raw?.url ??
        'unknown';
      this.logger.warn(`metric_5xx path=${path} code=${body.error.code}`);
      // T69-C (E26): 5xx -> Sentry (no-op without SENTRY_DSN).
      captureException(exception);
    }
    sendErrorResponse(response, body);
  }

  /**
   * T46-C (E23): locale for callers without request.user (public routes
   * like the recipes catalog). Reads the session cookie once per ERROR
   * response — success paths never pay this cost.
   */
  private async resolveLocaleFromSession(request: unknown): Promise<string | undefined> {
    const cookies = (request as { cookies?: Record<string, string | undefined> } | undefined)
      ?.cookies;
    const token = cookies?.['mc_session'];
    if (typeof token !== 'string' || token.length === 0) return undefined;
    try {
      const row = await getPrisma().session.findFirst({
        where: { tokenHash: hashSessionToken(token) },
        select: { userId: true, revokedAt: true, expiresAt: true },
      });
      if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= Date.now()) {
        return undefined;
      }
      const user = await getPrisma().user.findUnique({
        where: { id: row.userId },
        select: { locale: true },
      });
      return user?.locale ?? undefined;
    } catch {
      return undefined;
    }
  }
}

// Fastify's reply doesn't have `.json()`; NestJS's Express reply does.
// We try `.json()` first, fall back to `.send()`, and ultimately to
// `.status().send()` for raw http responses.
function sendErrorResponse(response: unknown, body: ErrorBody): void {
  type Reply = {
    status?: (code: number) => unknown;
    json?: (payload: unknown) => unknown;
    send?: (payload: unknown) => unknown;
  };
  const r = response as Reply;
  if (typeof r.json === 'function' && typeof r.status === 'function') {
    r.status(body.status);
    r.json(body);
    return;
  }
  if (typeof r.send === 'function' && typeof r.status === 'function') {
    r.status(body.status);
    r.send(body);
    return;
  }
  if (typeof r.send === 'function') {
    r.send(body);
  }
}

function mapHttpStatusToError(status: number, inner: unknown): ErrorInput {
  const message = extractMessage(inner);
  if (status === 401) return { code: 'UNAUTHORIZED', message };
  if (status === 403) return { code: 'FORBIDDEN', message };
  if (status === 404) return { code: 'NOT_FOUND', message };
  if (status === 409) return { code: 'CONFLICT', message };
  if (status === 429) return { code: 'RATE_LIMITED', message };
  if (status === 503) return { code: 'SERVICE_UNAVAILABLE', message };
  if (status === 400 || status === 422) {
    return { code: 'VALIDATION_ERROR', message, details: extractDetails(inner) };
  }
  return { code: 'INTERNAL_ERROR', message };
}

function extractMessage(inner: unknown): string | undefined {
  if (typeof inner === 'string') return inner;
  if (inner && typeof inner === 'object' && 'message' in inner) {
    const m = (inner as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return undefined;
}

function extractDetails(inner: unknown): Record<string, unknown> | undefined {
  if (inner && typeof inner === 'object' && 'details' in inner) {
    const d = (inner as { details?: unknown }).details;
    if (d && typeof d === 'object') return d as Record<string, unknown>;
  }
  return undefined;
}
