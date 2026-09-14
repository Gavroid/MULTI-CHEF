'use client';

// /auth/login — MC-014 real screen. Replaces the MC-013 stub.
//
// Wire-up:
//   - POST /api/v1/auth/login (via lib/auth-client) with credentials: include
//   - server sets HttpOnly mc_session cookie automatically
//   - on success we mirror a non-secret user summary into localStorage
//     (lib/auth-storage) so the client UI (AuthGuard, BottomTabBar) can
//     react without an extra round-trip
//   - redirect to ?redirect=/... if present and safe (same-origin), else /today
//
// Password reset, magic-link, OAuth, rate-limit UI: out of scope for MC-014.
//
// Note on Suspense: Next.js 15 requires `useSearchParams()` to live
// inside a <Suspense> boundary at build time so static prerender can
// bail out cleanly. The boundary itself is invisible at runtime.

import React, { Suspense, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';
import { login } from '@/lib/auth-client';
import { saveLocalUser } from '@/lib/auth-storage';
import { sanitizeRedirect } from '@/lib/redirect';
import { LoginForm, type LoginFormDeps } from './LoginForm';

export default function LoginPage(): ReactElement {
  // Wrap the search-param-reading body so Next 15 can statically
  // prerender the shell without crashing the build.
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginBody />
    </Suspense>
  );
}

function LoginBody(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirect(searchParams?.get('redirect') ?? null);

  // Inject the Next runtime hooks via a deps object so unit tests can
  // pass a stub (see LoginForm for the contract).
  const deps: LoginFormDeps = {
    submit: login,
    navigate: (href) => router.push(href),
  };

  return (
    <>
      <TabTitle sublabel="Вход в аккаунт">Логин</TabTitle>
      <Card>
        <LoginForm
          deps={deps}
          redirectTo={redirectTo}
          onSuccess={(resp) => {
            if (resp.data) saveLocalUser(resp.data.user, resp.data.household);
          }}
        />
      </Card>
      <p className="text-caption text-text-muted text-center mt-4">
        Нет аккаунта?{' '}
        <a
          href="/auth/register"
          className="underline text-[var(--color-primary)] hover:no-underline"
        >
          Зарегистрироваться
        </a>
      </p>
    </>
  );
}

function LoginFallback(): ReactElement {
  // Shown only on the very first paint if the page is statically
  // generated with `redirect=...` deep-linked. The Card keeps the
  // layout stable while the form hydrates.
  return (
    <>
      <TabTitle sublabel="Вход в аккаунт">Логин</TabTitle>
      <Card>
        <div className="h-48 animate-pulse" aria-label="Загрузка формы" />
      </Card>
    </>
  );
}
