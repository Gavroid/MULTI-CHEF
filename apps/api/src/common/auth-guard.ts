// MC-011 — shared authentication guard.
//
// Reads the `mc_session` cookie, validates it via AuthService.getSession,
// and attaches the authenticated user to the request so controller
// methods can call `currentUser(req)`. Used by every authenticated
// MC-011+ route. Reusable by future MCs.

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
// IMPORTANT: AuthService must be a *value* import, not a type-only
// import. `emitDecoratorMetadata` records the constructor parameter
// type at runtime so the DI container can resolve it; a type-only
// import erases the class binding and the metadata is recorded as
// the anonymous `Function` constructor instead. Symptom: the guard
// is constructed with `authService = undefined`. tsx 4.x loads
// files as ESM and its swc-based transformer doesn't emit
// `design:paramtypes` reliably, so we also use `@Inject(AuthService)`
// below to give the DI container an explicit symbol.
import { AuthService } from '../auth/auth.service.js';
import { Inject } from '@nestjs/common';
import { AppHttpException } from './exception-filter.js';

export const SESSION_COOKIE = 'mc_session';

export interface AuthenticatedRequest {
  cookies: Record<string, string | undefined>;
  user?: AuthenticatedUser | undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  // Constructor-injected to avoid the auth ↔ common circular import.
  // Modules that mount AuthGuard must import AuthModule so the DI
  // container can resolve AuthService. `@Inject(AuthService)` makes
  // the dependency explicit so DI works under tsx 4.x (which uses
  // swc and may not emit design:paramtypes metadata).
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = req.cookies ?? {};
    const token = cookies[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppHttpException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }
    const session = await this.authService.getSession(token);
    if (!session) {
      throw new AppHttpException({
        code: 'UNAUTHORIZED',
        message: 'Session is invalid or expired',
      });
    }
    req.user = session.user;
    return true;
  }
}

/**
 * Tiny helper — returns the user attached by AuthGuard.
 * Throws 401 when called outside an authenticated request, which
 * is a programmer error (the controller method should have run
 * after AuthGuard.canActivate).
 */
export function currentUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
  if (!req.user) {
    throw new AppHttpException({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return req.user;
}
