// (auth) — route group for unauthenticated screens. Layout does NOT
// include BottomTabBar (full-bleed forms). Server component.

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <main className="mx-auto max-w-content min-h-screen px-4 py-6 flex flex-col">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-heading text-text">
          MULTI-CHEF
        </Link>
      </header>
      <div className="flex-1 flex flex-col justify-center">{children}</div>
    </main>
  );
}
