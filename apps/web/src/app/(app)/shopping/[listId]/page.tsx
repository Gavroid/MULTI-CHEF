// /shopping/[listId] — placeholder for the shopping list screen
// (MC-034 scope-extension, real UI lands with MC-056).
//
// «Готовлю это» deep-links here after accepting a recommendation.
// The listId is echoed so the future screen's entry contract is
// already exercised; the MC-013 /shopping stub stays untouched.

'use client';

import React, { use } from 'react';
import { ShoppingCart } from 'lucide-react';

export default function ShoppingListPage({
  params,
}: {
  params: Promise<{ listId: string }>;
}): React.ReactElement {
  const { listId } = use(params);
  return (
    <div className="flex flex-col items-center gap-3 py-16" data-testid="shopping-list-placeholder">
      <ShoppingCart size={40} className="text-[var(--color-text-muted)]" aria-hidden />
      <h1 className="text-lg font-bold text-[var(--color-text)]">Список покупок</h1>
      <p className="max-w-xs text-center text-sm text-[var(--color-text-muted)]">
        Список <span className="font-mono">{listId}</span> создан. Полный экран покупок появится
        позже (MC-056).
      </p>
    </div>
  );
}
