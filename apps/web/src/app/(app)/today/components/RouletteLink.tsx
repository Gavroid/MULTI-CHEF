'use client';

// RouletteLink — teaser link to the culinary roulette (MC-034).
// /today/roulette does not exist until MC-042; the link is still
// rendered (PRD §2.3.2 shows the entry point on /today) and Next.js
// serves the standard 404 until then.

import React from 'react';
import Link from 'next/link';
import { Dices } from 'lucide-react';

export function RouletteLink(): React.ReactElement {
  return (
    <Link
      href="/today/roulette"
      data-testid="roulette-link"
      className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-text)] active:bg-[var(--color-surface-2)]"
    >
      <Dices size={18} className="text-[var(--color-primary)]" aria-hidden />
      Кулинарная рулетка
    </Link>
  );
}
