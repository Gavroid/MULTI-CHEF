// Next.js middleware (Edge runtime).
//
// MC-014 policy (T19-B, audit round 19): every authenticated screen is
// gated server-side. The previous matcher covered only /profile, so
// /today, /fridge, /plan, /shopping and /recipe/<id> rendered their
// SSR HTML for logged-out visitors and relied on the client-side
// AuthGuard to redirect after hydration — a flash of private content
// plus a broken empty view when JS was blocked. Now a request without
// the mc_session cookie is redirected to /auth/login (with a
// `redirect` param) before any rendering happens.
//
// The landing (/) and /design stay public on purpose: PRD §2.3.2 lets
// guests browse the dashboard with a CTA.
//
// The client AuthGuard remains as defence-in-depth for client-side
// navigations; its redirect decision is server-verified (T19-A).

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'mc_session';
const PROTECTED_PREFIXES = ['/profile', '/today', '/fridge', '/plan', '/shopping', '/recipe'];

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

// One matcher branch per protected prefix; the bare path + /:path*
// form matches both the prefix itself and its subpaths.
// /design and / stay outside — landing + design demo.
export const config = {
  matcher: [
    '/profile/:path*',
    '/profile',
    '/today/:path*',
    '/today',
    '/fridge/:path*',
    '/fridge',
    '/plan/:path*',
    '/plan',
    '/shopping/:path*',
    '/shopping',
    '/recipe/:path*',
  ],
};
