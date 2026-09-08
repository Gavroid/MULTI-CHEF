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
  sameSite: 'Lax' | 'Strict';
  domain?: string | undefined;
}

function cookieFlags(): CookieFlags {
  const env = loadServerEnv();
  return {
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'Strict' : 'Lax',
    domain: env.COOKIE_DOMAIN,
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
