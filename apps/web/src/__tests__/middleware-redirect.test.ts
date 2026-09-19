// R20 F7: the auth redirect must be built from the proxy headers
// (Host/X-Forwarded-Proto), not from nextUrl — behind nginx the latter
// reflects the server binding (localhost:3000) and sends users into
// connection refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { middleware } from '../middleware';

interface FakeReq {
  nextUrl: { pathname: string; search: string };
  cookies: { get(name: string): { value: string } | undefined };
  headers: Headers;
}

function req(path: string, authed: boolean, headers: Record<string, string>): FakeReq {
  const u = new URL(`http://placeholder${path}`);
  return {
    nextUrl: { pathname: u.pathname, search: u.search },
    cookies: {
      get: (name: string) => (authed && name === 'mc_session' ? { value: 'tok' } : undefined),
    },
    headers: new Headers(headers),
  };
}

test('unauth /today redirects to the PROXY host (192.168.1.95:8080), not the server binding', () => {
  const res = middleware(
    req('/today?x=1', false, {
      host: '192.168.1.95:8080',
      'x-forwarded-proto': 'http',
    }) as never,
  );
  assert.equal(res.status, 307);
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.startsWith('http://192.168.1.95:8080/auth/login'), `unexpected location: ${loc}`);
  assert.ok(loc.includes('redirect=%2Ftoday'), 'redirect param preserved');
});

test('x-forwarded-host wins over host when present', () => {
  const res = middleware(
    req('/fridge', false, {
      host: '127.0.0.1:3000',
      'x-forwarded-host': '192.168.1.95:8080',
      'x-forwarded-proto': 'http',
    }) as never,
  );
  const loc = res.headers.get('location') ?? '';
  assert.ok(loc.startsWith('http://192.168.1.95:8080/auth/login'), loc);
});

test('authed user passes through (NextResponse.next)', () => {
  const res = middleware(req('/today', true, { host: '192.168.1.95:8080' }) as never);
  assert.equal(res.headers.get('location'), null);
});

test('public pages pass through without auth', () => {
  const res = middleware(req('/design', false, { host: '192.168.1.95:8080' }) as never);
  assert.equal(res.headers.get('location'), null);
});
