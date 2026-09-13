// MC-010 — AuthController. Sets mc_session cookie on register/login,
// clears on logout. The cookie shape is:
//
//   mc_session=<token>; HttpOnly; SameSite=Lax|Strict; Path=/; Max-Age=...
//   Secure when NODE_ENV=production
//   Domain from COOKIE_DOMAIN (default: unset)
//
// CSRF (mc_csrf + X-CSRF-Token) and rate-limit throttling are wired
// in main.ts / app.module.ts so they apply to every mutating endpoint.

import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadServerEnv } from '@multichef/config';
import { AuthService, type AuthResult } from './auth.service.js';
import type { LoginDto, LogoutDto, RegisterDto } from './auth.dto-classes.js';
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
const COOKIE_PATH = '/';

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
}

function clearSessionCookie(res: FastifyReply): void {
  const flags = cookieFlags();
  (res as CookieReply).clearCookie(SESSION_COOKIE, {
    path: COOKIE_PATH,
    secure: flags.secure,
    sameSite: flags.sameSite,
    ...(flags.domain ? { domain: flags.domain } : {}),
  });
}

@ApiTags('auth')
// Audit fix (2026-09-13): the tight 10/min bucket now applies ONLY to
// auth endpoints — the global throttler default is 300/min so normal
// multi-screen usage (pantry + plan + shopping reads) is not throttled.
@Throttle({ default: { ttl: 60_000, limit: 10 } })
@Controller({ path: 'auth' })
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new user + create household + create session' })
  @ApiResponse({ status: 201, description: 'User registered' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() body: RegisterDto,
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

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate by email + password, set mc_session cookie' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() body: LoginDto,
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
    @Body() _body: LogoutDto,
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
}
