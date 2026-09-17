// MC-010 — AuthController. Sets mc_session cookie on register/login,
// clears on logout. The cookie shape is:
//
//   mc_session=<token>; HttpOnly; SameSite=Lax|Strict; Path=/; Max-Age=...
//   Secure when NODE_ENV=production
//   Domain from COOKIE_DOMAIN (default: unset)
//
// CSRF (mc_csrf + X-CSRF-Token) and rate-limit throttling are wired
// in main.ts / app.module.ts so they apply to every mutating endpoint.

import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadServerEnv } from '@multichef/config';
import { generateSessionToken } from './session-token.js';
import { AuthService, type AuthResult } from './auth.service.js';
import type { LocaleDto, LoginDto, LogoutDto, RegisterDto } from './auth.dto-classes.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppHttpException } from '../common/exception-filter.js';

// @fastify/cookie decorates FastifyRequest / FastifyReply at runtime;
// the @nestjs/platform-fastify types don't reflect those properties.
type CookieReply = FastifyReply & {
  setCookie: (
    name: string,
    value: string,
    options: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'Lax' | 'Strict' | 'None';
      path?: string;
      maxAge?: number;
      domain?: string;
    },
  ) => void;
  clearCookie: (
    name: string,
    options?: {
      path?: string;
      secure?: boolean;
      sameSite?: 'Lax' | 'Strict' | 'None';
      domain?: string;
    },
  ) => void;
};
type CookieRequest = FastifyRequest & {
  cookies: Record<string, string | undefined>;
};

export const SESSION_COOKIE = 'mc_session';
// Audit 2026-09-13: the guard only VERIFIED mc_csrf — nobody ever SET
// it, so double-submit CSRF was de-facto disabled. Issued on
// register/login alongside the session cookie (readable by JS by
// design — double-submit needs the JS to echo it in a header).
export const CSRF_COOKIE = 'mc_csrf';
// T32-A: cookie ограничен /api/v1 — не уходит на статику/health/docs.
// (Все авторизованные вызовы идут через /api/v1/*, сужение до
// /api/v1/auth сломало бы pantry/plan/shopping запросы.)
const COOKIE_PATH = '/api/v1';

interface CookieFlags {
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  domain?: string | undefined;
}

function sameSiteFromEnv(value: 'lax' | 'strict' | 'none'): 'Lax' | 'Strict' | 'None' {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as 'Lax' | 'Strict' | 'None';
}

function cookieFlags(): CookieFlags {
  const env = loadServerEnv();
  const domain = env.COOKIE_DOMAIN;
  // Omit the Domain attribute for IP/LAN hosts and the localhost default:
  // a Domain=<ip|localhost> attribute makes browsers REJECT the cookie,
  // which silently kills the session on IP-served deployments.
  const useDomain = domain && domain !== 'localhost' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(domain);
  // Audit fix (2026-09-13): honour COOKIE_SECURE / COOKIE_SAMESITE from
  // env — the previous NODE_ENV-only branching made those knobs dead
  // configuration (the cookie was never marked Secure on TLS deploys).
  return {
    secure: env.COOKIE_SECURE,
    sameSite: sameSiteFromEnv(env.COOKIE_SAMESITE),
    ...(useDomain ? { domain } : {}),
  };
}

function setSessionCookie(res: FastifyReply, result: AuthResult): void {
  const flags = cookieFlags();
  const maxAgeSec = Math.max(60, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
  (res as CookieReply).setCookie(SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    secure: flags.secure,
    sameSite: flags.sameSite,
    path: COOKIE_PATH,
    maxAge: maxAgeSec,
    ...(flags.domain ? { domain: flags.domain } : {}),
  });
  // Double-submit pair: JS-readable so request() can echo the header.
  (res as CookieReply).setCookie(CSRF_COOKIE, generateSessionToken(), {
    httpOnly: false,
    secure: flags.secure,
    sameSite: flags.sameSite,
    path: COOKIE_PATH,
    maxAge: maxAgeSec,
    ...(flags.domain ? { domain: flags.domain } : {}),
  });
}

function clearSessionCookie(res: FastifyReply): void {
  const flags = cookieFlags();
  // Audit fix: drop the double-submit pair together with the session.
  (res as CookieReply).clearCookie(CSRF_COOKIE, {
    path: COOKIE_PATH,
    secure: flags.secure,
    sameSite: flags.sameSite,
    ...(flags.domain ? { domain: flags.domain } : {}),
  });
  (res as CookieReply).clearCookie(SESSION_COOKIE, {
    path: COOKIE_PATH,
    secure: flags.secure,
    sameSite: flags.sameSite,
    ...(flags.domain ? { domain: flags.domain } : {}),
  });
}

@ApiTags('auth')
// Audit fix (2026-09-13, refined 2026-09-16): the tight 10/min bucket
// applies ONLY to the credential endpoints (register/login) — it sits on
// those routes, NOT on the class. GET /session is probed by AuthGuard on
// every (app) screen mount; per-IP 10/min bounced real multi-user NAT
// households (and the e2e workers) to /auth/login at random. Everything
// else stays at the global 300/min default.
// Class-level error contract (E15/T34-B): применяется ко всем маршрутам.
@ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
@ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
@ApiNotFoundResponse({ description: 'Ресурс не найден' })
@ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
@ApiTooManyRequestsResponse({ description: 'Rate limit' })
@ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
@Controller({ path: 'auth' })
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
  @ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
  @ApiNotFoundResponse({ description: 'Ресурс не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit' })
  @ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new user + create household + create session' })
  @ApiResponse({ status: 201, description: 'User registered' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body(new ZodValidationPipe()) body: RegisterDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ user: AuthResult['user']; household: { id: string }; sessionToken: string }> {
    const result = await this.auth.register(body);
    setSessionCookie(res, result);
    const household = await (
      await import('@multichef/database')
    )
      .getPrisma()
      .household.findFirstOrThrow({ where: { ownerId: result.user.id } });
    return {
      user: result.user,
      household: { id: household.id },
      sessionToken: result.sessionToken,
    };
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate by email + password, set mc_session cookie' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body(new ZodValidationPipe()) body: LoginDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ user: AuthResult['user']; household: { id: string }; sessionToken: string }> {
    const result = await this.auth.login(body);
    setSessionCookie(res, result);
    const household = await (
      await import('@multichef/database')
    )
      .getPrisma()
      .household.findFirstOrThrow({ where: { ownerId: result.user.id } });
    return {
      user: result.user,
      household: { id: household.id },
      sessionToken: result.sessionToken,
    };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Invalidate the current session' })
  @ApiResponse({ status: 204, description: 'Session invalidated' })
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body(new ZodValidationPipe()) _body: LogoutDto,
  ): Promise<void> {
    const token = (req as CookieRequest).cookies[SESSION_COOKIE];
    if (typeof token === 'string') {
      await this.auth.logout(token);
    }
    clearSessionCookie(res);
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Invalidate every session for the current user' })
  @ApiResponse({ status: 204, description: 'All sessions invalidated' })
  async logoutAll(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const token = (req as CookieRequest).cookies[SESSION_COOKIE];
    const session = typeof token === 'string' ? await this.auth.getSession(token) : null;
    if (session) {
      await this.auth.logoutAll(session.user.id);
    }
    clearSessionCookie(res);
  }

  @Get('session')
  @ApiOperation({ summary: 'Return the current session (or 401)' })
  @ApiResponse({ status: 200, description: 'Session is valid' })
  @ApiResponse({ status: 401, description: 'No/invalid session' })
  async session(
    @Req() req: FastifyRequest,
  ): Promise<{ user: AuthResult['user']; household: { id: string } }> {
    const token = (req as CookieRequest).cookies[SESSION_COOKIE];
    const session = typeof token === 'string' ? await this.auth.getSession(token) : null;
    if (!session) {
      throw new AppHttpException({ code: 'UNAUTHORIZED', message: 'No active session' });
    }
    const household = await (
      await import('@multichef/database')
    )
      .getPrisma()
      .household.findFirstOrThrow({ where: { ownerId: session.user.id } });
    return { user: session.user, household: { id: household.id } };
  }

  // T46-C (E23): UI locale switch — drives API error-message language
  // (resolved by the exception filter from request.user.locale).
  @Patch('locale')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set the UI locale of the session user' })
  @ApiResponse({ status: 200, description: 'Locale updated' })
  @ApiResponse({ status: 401, description: 'No/invalid session' })
  async updateLocale(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe()) body: LocaleDto,
  ): Promise<{ locale: string }> {
    const token = (req as CookieRequest).cookies[SESSION_COOKIE];
    const session = typeof token === 'string' ? await this.auth.getSession(token) : null;
    if (!session) {
      throw new AppHttpException({ code: 'UNAUTHORIZED', message: 'No active session' });
    }
    const updated = await this.auth.updateLocale(session.user.id, body.locale);
    return { locale: updated.locale };
  }
}
