'use client';

// AuthGuard — client boundary that redirects unauthenticated users to
// /auth/login. Until MC-014 lands the real auth integration, "logged in"
// means a `mc_user` key in localStorage (set by the auth screens after
// MC-014). For MC-013 we render the children during SSR + first paint
// and redirect post-hydration if no marker is present — that way search
// engines + curl see real content, and we don't ship a skeleton-only
// page to logged-out users.
//
// Why client-side and not middleware: middleware.ts runs on the Edge and
// can only inspect request headers — localStorage isn't available there.
// Until MC-014 wires real cookie auth, server-side redirect via middleware
// is only possible for /profile (already wired). MC-014 will replace this
// guard with a real session-cookie check.

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'mc_user';

export function AuthGuard({ children }: { children: ReactNode }): ReactElement {
  const router = useRouter();
  // `null` means we haven't checked yet. We render children during this
  // window so SSR + first paint show real content. After hydration we
  // re-evaluate and redirect if the user has no marker.
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw && !redirected) {
        setRedirected(true);
        router.replace('/auth/login');
      }
    } catch {
      // localStorage blocked — render as if logged-in (best-effort UX).
    }
  }, [router, redirected]);

  return <>{children}</>;
}

/** Read the local user marker — exported for tests + future auth screens. */
export function hasLocalUser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}
