'use client';

// AuthGuard — client boundary that redirects unauthenticated users to
// /auth/login.
//
// T19-A (audit round 19): the redirect decision is made against the
// SERVER session — a GET /auth/session probe carrying the
// mc_session HttpOnly cookie — not against the `mc_user` localStorage
// marker. Those two sources of truth used to diverge (cleared cookies
// but stale marker → "logged-in" UI with 401s everywhere; cleared
// marker but valid cookie → premature redirect that killed a live
// session). Children still render during the probe so SSR + first
// paint show real content and curl/search engines see the page; only
// a definitive auth error redirects. Network failures keep the user
// on-screen — the API calls themselves will surface the problem.
//
// `mc_user` remains a non-authoritative UX hint (BottomTabBar
// highlighting, per auth-storage.ts). middleware.ts protects these
// routes server-side as well, so this guard is defence-in-depth for
// client navigations, not the primary boundary.

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/auth-client';
import { clearLocalUser } from '@/lib/auth-storage';

export function AuthGuard({ children }: { children: ReactNode }): ReactElement {
  const router = useRouter();
  // We render children during the probe window so SSR + first paint
  // show real content.
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    if (redirected) return;
    const controller = new AbortController();
    getSession({ signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        // Network errors (status 0) are not proof of a dead session —
        // stay on-screen. An auth error from the server is definitive.
        if (!result.error || result.error.error.code === 'NETWORK_ERROR') return;
        clearLocalUser();
        setRedirected(true);
        router.replace('/auth/login');
      })
      .catch(() => {
        // AbortError on unmount — nothing to do.
      });
    return () => controller.abort();
  }, [router, redirected]);

  return <>{children}</>;
}

/** Read the local user marker — exported for tests + future auth screens. */
export function hasLocalUser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage.getItem('mc_user'));
  } catch {
    return false;
  }
}
