// /fridge — список продуктов пользователя (PRD §2.3.3).
//
// MC-023: full CRUD (list + create + edit + soft-delete + restore).
// The orchestrator lives in FridgeClient.tsx so the unit tests can
// import it directly with stub `deps`. This file is the Next.js
// page entrypoint and intentionally has no logic of its own.
//
// R17-WP2: поверх LeftoversCard (план-привязанный виджет) добавляем
// отдельную страницу /fridge/leftovers (типовые остатки + свободный
// ввод) — для полного соответствия PRD §2.3.9. Здесь — кнопка-мост.

import type { Metadata } from 'next';
import Link from 'next/link';
export const metadata: Metadata = { title: 'Холодильник' };

import { FridgeClient } from './FridgeClient';
import { LeftoversCard } from '@/components/LeftoversCard';

export default function FridgePage(): React.JSX.Element {
  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h1 className="text-title">Холодильник</h1>
        <Link
          href="/fridge/leftovers"
          className="h-10 px-3 inline-flex items-center rounded-md border border-[var(--color-border)] text-body"
          data-testid="fridge-leftovers-cta"
        >
          Преображение остатков
        </Link>
      </div>
      <LeftoversCard />
      <FridgeClient />
    </>
  );
}
