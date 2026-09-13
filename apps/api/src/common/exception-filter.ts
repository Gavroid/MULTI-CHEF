// MC-010 — global NestJS exception filter that converts any thrown error
// into the { error: { code, message, details? } } envelope from
// docs/api/conventions.md §2.
//
// Usage: registered globally via `app.useGlobalFilters(new AppHttpExceptionFilter())`.
// Custom errors are thrown via `throw new AppHttpException({ code: '…' })`
// or by passing an `AppError`-shaped object to `HttpException`.

import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ErrorCode, ErrorInput } from './error-envelope.js';
import { envelopeFromRequest, STATUS_BY_CODE, type ErrorBody } from './error-envelope.js';
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

  catch(exception: unknown, host: ArgumentsHost): void {
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
      const message = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(`unhandled exception: ${message}`, exception);
      input = { code: 'INTERNAL_ERROR', message: 'Internal server error' };
    }

    const body: ErrorBody = envelopeFromRequest(request, input);
    sendErrorResponse(response, body);
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
