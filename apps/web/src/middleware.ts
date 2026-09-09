// Next.js middleware (Edge runtime).
//
// Currently protects only /profile — the manager-specified behaviour:
// redirect to /auth/login when the `mc_session` cookie is absent.
//
// We deliberately do NOT protect /today, /fridge, /plan, /shopping in
// MC-013: those screens have empty-state content that guests can browse
// (PRD §2.3.2 lets logged-out users see the dashboard with a CTA).
// MC-014 will tighten the policy once the auth flow ships.
//
// This middleware runs on every request matching the matcher below.

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'mc_session';
const PROTECTED_PREFIXES = ['/profile'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!needsAuth) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/auth/login';
  loginUrl.searchParams.set('redirect', pathname + (search ?? ''));
  return NextResponse.redirect(loginUrl);
}

// Limit the middleware to the (app) route group + auth redirects.
// Excluding /design and / keeps the landing + design demo fast.
export const config = {
  matcher: ['/profile/:path*', '/profile'],
};
