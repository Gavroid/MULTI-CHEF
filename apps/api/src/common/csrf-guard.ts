// MC-033 — CSRF guard for mutating endpoints (double-submit cookie).
//
// PRD §879: CSRF = double-submit cookie `mc_csrf` + header
// `X-CSRF-Token` on all mutating methods. MC-010 wired the docs but the
// middleware itself was never added — ADR MC-033 explicitly asks to
// "add it explicitly if missing". Implemented as a Nest APP_GUARD so
// every controller (auth included) is covered uniformly.
//
// Mechanics (stateless double-submit):
// - If neither cookie nor header is present (plain API clients, tests,
//   curl): allow. Session-cookie CSRF risk only exists when a browser
//   has BOTH the session and the csrf cookie; gateless enforcement
//   here would break every non-browser consumer.
// - If `mc_csrf` cookie exists, every mutating request must echo the
//   same value in `X-CSRF-Token`, otherwise 403 CSRF_MISMATCH.
// - Safe methods (GET/HEAD/OPTIONS) always pass.

import { Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AppHttpException } from './exception-filter.js';

const CSRF_COOKIE = 'mc_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfDoubleSubmitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      headers: Record<string, unknown>;
      cookies?: Record<string, string | undefined>;
    }>();
    const method = (req.method ?? 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    const cookieToken = req.cookies?.[CSRF_COOKIE];
    if (typeof cookieToken !== 'string' || cookieToken.length === 0) return true;

    const headerToken = req.headers[CSRF_HEADER];
    if (typeof headerToken !== 'string' || headerToken !== cookieToken) {
      throw new AppHttpException({
        code: 'CSRF_MISMATCH',
        message: 'X-CSRF-Token header must match the mc_csrf cookie',
      });
    }
    return true;
  }
}

export const CSRF_GUARD_PROVIDER = { provide: APP_GUARD, useClass: CsrfDoubleSubmitGuard };
