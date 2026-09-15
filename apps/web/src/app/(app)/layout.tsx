// (app) — route group for all pages that need the BottomTabBar.
// The group itself adds no path segment, so /today, /fridge, etc.
// all live here. (auth) is a sibling group with no BottomTabBar.
//
// The page content needs bottom padding to clear the fixed tab bar.
// We add pb-24 (=96px) to the main container so content never sits
// under the bar.
//
// Server component (no 'use client') — BottomTabBar is a single client
// boundary imported here. AuthGuard runs in a separate client boundary
// so the server layout stays fast.

import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { BottomTabBar } from '@/components/BottomTabBar';
import { AuthGuard } from '@/components/AuthGuard';

// T19-B/T1: (app) screens are private (mc_session gate) — noindex
// keeps them out of search indexes; titles per page override this
// fallback via the %s template from the root layout.
export const metadata: Metadata = {
  title: 'MULTI-CHEF',
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <AuthGuard>
      {/* pb-24 reserves space for the 64px tab bar + safe-area + breathing room. */}
      <main
        id="main-content"
        className="mx-auto max-w-content min-h-screen px-4 py-6 pb-24 md:max-w-2xl lg:max-w-4xl"
      >
        {children}
      </main>
      <BottomTabBar />
    </AuthGuard>
  );
}
