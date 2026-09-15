// BottomTabBar — fixed bottom navigation per PRD §2.5.8.
// 5 tabs (Сегодня / Холодильник / План / Покупки / Профиль), 24px icons +
// 11px labels. Active tab uses primary color + a small top-border indicator.
// Safe-area bottom padding for iPhone notches. Touch-target ≥ 44px (h-12
// = 48px).
//
// Client component: uses Next's usePathname for active-state. Rendered
// inside the (app) layout server component as a single client boundary.
//
// Splitting TabItem out keeps the visual logic unit-testable without
// pulling in Next's navigation runtime (which is not available in
// `node --test` + tsx without a full Next server).

'use client';

import React, { type ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Home,
  Refrigerator,
  CalendarDays,
  ShoppingCart,
  User,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@multichef/ui';
import { TABS, getActiveTabId, type TabId } from '@/lib/active-tab';

export const TAB_ICONS: Record<TabId, LucideIcon> = {
  today: Home,
  fridge: Refrigerator,
  plan: CalendarDays,
  shopping: ShoppingCart,
  profile: User,
};

/**
 * Render a single tab anchor. Uses a plain `<a>` rather than `next/link`
 * so it can be unit-tested via `renderToString` without booting Next.
 * The BottomTabBar wrapper swaps in `next/link` for client-side SPA nav.
 */
export function TabItem({
  tab,
  isActive,
  label = tab.label,
  href = tab.href,
}: {
  tab: (typeof TABS)[number];
  isActive: boolean;
  /** T46-B (E23): localized label resolved by the caller via next-intl. */
  label?: string;
  href?: string;
}): ReactElement {
  const Icon = TAB_ICONS[tab.id];
  return (
    <a
      href={href}
      aria-current={isActive ? 'page' : undefined}
      aria-label={label}
      data-tab-id={tab.id}
      data-active={isActive ? '' : undefined}
      className={cn(
        'group relative flex flex-col items-center justify-center gap-0.5',
        'h-12 self-center w-full',
        'rounded-[var(--radius-sm)]',
        'transition-colors duration-[120ms]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        isActive
          ? 'text-[var(--color-primary)]'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
      )}
    >
      {/* Top-border indicator — colour-blind reinforcement of active state. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-3 top-0 h-0.5 rounded-full transition-opacity',
          isActive ? 'bg-[var(--color-primary)] opacity-100' : 'opacity-0',
        )}
      />
      <Icon size={24} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
      <span className="text-[11px] leading-3 font-medium">{label}</span>
    </a>
  );
}

export function BottomTabBar(): ReactElement {
  const pathname = usePathname();
  const activeId = getActiveTabId(pathname);
  // T46-B (E23): labels come from the i18n dictionary (src/i18n/ru.ts).
  // Explicit per-tab calls (not t(tab.id)) keep check:i18n coverage exact.
  const t = useTranslations('nav');
  const labels = {
    today: t('today'),
    fridge: t('fridge'),
    plan: t('plan'),
    shopping: t('shopping'),
    profile: t('profile'),
  } as const;

  return (
    <nav
      aria-label={t('ariaLabel')}
      data-testid="mc-bottom-tab-bar"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30',
        'bg-[var(--color-surface)] border-t border-[var(--color-border)]',
        // 64px height + iOS safe-area. PRD §2.5.8.
        'h-16 pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="mx-auto max-w-content flex items-stretch justify-around px-2 h-full">
        {TABS.map((tab) => (
          <li key={tab.id} className="flex-1 flex">
            {/* next/link gives SPA navigation; <a> inside TabItem keeps SSR tests trivial. */}
            <Link href={tab.href} passHref legacyBehavior>
              <TabItem tab={tab} isActive={tab.id === activeId} label={labels[tab.id]} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
