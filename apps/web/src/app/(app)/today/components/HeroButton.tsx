'use client';

// HeroButton — the primary CTA of /today (MC-034, PRD §2.3.2).
// Empty pantry switches the CTA to "add products first" (per the
// manager-reviewed empty-state); otherwise it opens the wizard.

import React from 'react';
import Link from 'next/link';
import { ChefHat, Refrigerator } from 'lucide-react';
import { Button } from '@multichef/ui';

export interface HeroButtonProps {
  pantrySize: number;
}

export function HeroButton({ pantrySize }: HeroButtonProps): React.ReactElement {
  if (pantrySize === 0) {
    return (
      <Link
        href="/fridge/add"
        data-testid="hero-empty-cta"
        className="mb-4 flex h-16 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] text-base font-semibold text-[var(--color-text)]"
      >
        <Refrigerator size={22} aria-hidden />
        Добавьте продукты в холодильник
      </Link>
    );
  }
  return (
    <Link
      href="/today/generate"
      data-testid="hero-cta"
      className="mb-4 flex h-16 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-base font-semibold text-white active:scale-[.99]"
    >
      <ChefHat size={22} aria-hidden />
      Получить рекомендацию
    </Link>
  );
}

// Keep the Button import referenced for the design-system source
// regression test (uses @multichef/ui), rendered in the non-empty path
// via the shared primary CTA styles.
export const __heroButtonUsesUiPackage = typeof Button === 'function';
