'use client';

// ShoppingClient — /shopping «Покупки» tab (MC-056, PRD §2.3.14).
//
// Groups the ACTIVE list by department (sortOrder), item rows with a
// purchased checkbox (optimistic with rollback), a budget progress bar
// and the MC-054 fit-budget proposals. «Куплено всё» completes the
// list and credits purchases into the pantry.

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Badge, Button, Card, Input, toast } from '@multichef/ui';
import type { FitBudgetResponseDto } from '@multichef/contracts';
import {
  applyBudgetProposal as applyBudgetProposalApi,
  completeList as completeListApi,
  fitBudget as fitBudgetApi,
  getActiveShoppingList,
  setItemPurchased as setItemPurchasedApi,
  type ShoppingItemDto,
  type ShoppingListDto,
} from '@/lib/shopping-client';
import { TabTitle } from '@/components/TabTitle';

export interface ItemGroup {
  categoryId: string;
  sortOrder: number;
  items: ShoppingItemDto[];
}

export function groupItems(items: ShoppingItemDto[], orders: Map<string, number>): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  for (const item of items) {
    const sortOrder = orders.get(item.categoryId) ?? 99;
    const group = groups.get(item.categoryId) ?? { categoryId: item.categoryId, sortOrder, items: [] };
    group.items.push(item);
    groups.set(item.categoryId, group);
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function budgetPercent(total: number, limit: number | null): number {
  if (!limit || limit <= 0) return 0;
  return Math.min(110, Math.round((total / limit) * 100));
}

export function formatKopecks(kopecks: number): string {
  return `₽${Math.round(kopecks / 100)}`;
}

export interface ShoppingClientDeps {
  getActiveShoppingList: typeof getActiveShoppingList;
  setItemPurchased: typeof setItemPurchasedApi;
  completeList: typeof completeListApi;
  fitBudget: typeof fitBudgetApi;
  applyBudgetProposal: typeof applyBudgetProposalApi;
}

const defaultDeps: ShoppingClientDeps = {
  getActiveShoppingList,
  setItemPurchased: setItemPurchasedApi,
  completeList: completeListApi,
  fitBudget: fitBudgetApi,
  applyBudgetProposal: applyBudgetProposalApi,
};

export function ShoppingClient({
  deps: depsOverride,
}: {
  deps?: Partial<ShoppingClientDeps>;
}): React.ReactElement {
  const deps = useMemo<ShoppingClientDeps>(() => ({ ...defaultDeps, ...depsOverride }), [depsOverride]);
  const [list, setList] = useState<ShoppingListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetInput, setBudgetInput] = useState('');
  const [proposals, setProposals] = useState<FitBudgetResponseDto | null>(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void deps
      .getActiveShoppingList()
      .then((res) => {
        if (cancelled) return;
        if (res.error) toast.show({ message: res.error.error.message, tone: 'warning' });
        else setList(res.data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deps]);

  const toggle = useCallback(
    async (item: ShoppingItemDto): Promise<void> => {
      if (!list) return;
      // optimistic toggle with rollback (development plan MC-056).
      setList({
        ...list,
        items: list.items.map((i) => (i.id === item.id ? { ...i, purchased: !i.purchased } : i)),
      });
      const res = await deps.setItemPurchased(item.id, !item.purchased);
      if (res.error) {
        setList((current) =>
          current
            ? {
                ...current,
                items: current.items.map((i) => (i.id === item.id ? { ...i, purchased: item.purchased } : i)),
              }
            : current,
        );
        toast.show({ message: 'Не удалось отметить', tone: 'warning' });
      }
    },
    [deps, list],
  );

  const complete = useCallback(async (): Promise<void> => {
    if (!list) return;
    setBusy(true);
    const res = await deps.completeList(list.id);
    setBusy(false);
    if (res.error) {
      toast.show({ message: res.error.error.message, tone: 'warning' });
      return;
    }
    toast.show({ message: 'Покупки в холодильнике!', tone: 'success' });
    void window.location.assign('/fridge');
  }, [deps, list]);

  const runFitBudget = useCallback(async (): Promise<void> => {
    if (!list) return;
    const roubles = Number.parseInt(budgetInput, 10);
    if (!Number.isFinite(roubles)) return;
    setBusy(true);
    const res = await deps.fitBudget(list.id, roubles * 100);
    setBusy(false);
    if (res.error) {
      toast.show({ message: res.error.error.message, tone: 'warning' });
      return;
    }
    setProposals(res.data);
  }, [budgetInput, deps, list]);

  const applyOne = useCallback(
    async (proposal: FitBudgetResponseDto['proposals'][number]): Promise<void> => {
      if (!list) return;
      if (proposal.kind === 'MERGE_MEALS') {
        toast.show({ message: 'Появится в следующей версии', tone: 'info' });
        return;
      }
      if (!proposal.ingredientId) return;
      setBusy(true);
      const res = await deps.applyBudgetProposal(list.id, {
        kind: proposal.kind,
        ingredientId: proposal.ingredientId,
        ...(proposal.kind === 'SUBSTITUTE' && proposal.substituteIngredientId
          ? { substituteIngredientId: proposal.substituteIngredientId }
          : {}),
      });
      setBusy(false);
      if (res.error) {
        toast.show({ message: res.error.error.message, tone: 'warning' });
        return;
      }
      setProposals(null);
      const refreshed = await deps.getActiveShoppingList();
      if (!refreshed.error) setList(refreshed.data);
      toast.show({ message: 'Список пересобран', tone: 'success' });
    },
    [deps, list],
  );

  if (loading) {
    return (
      <>
        <TabTitle sublabel="Список покупок">Покупки</TabTitle>
        <Card data-testid="shopping-loading">
          <p className="text-body">Загрузка…</p>
        </Card>
      </>
    );
  }

  if (!list) {
    return (
      <>
        <TabTitle sublabel="Список покупок">Покупки</TabTitle>
        <Card data-testid="shopping-empty">
          <p className="text-body mb-3">Активного списка нет — он появится после принятия рецепта.</p>
          <Link href="/fridge" className="text-sm text-[var(--color-primary)] underline">
            Заглянуть в холодильник
          </Link>
        </Card>
      </>
    );
  }

  const purchasedCount = list.items.filter((i) => i.purchased).length;
  const percent = budgetPercent(list.estimatedTotalKopecks, list.budgetLimitKopecks);

  return (
    <>
      <TabTitle sublabel={`${purchasedCount} из ${list.items.length}`}>Покупки</TabTitle>

      <Card className="mb-3" data-testid="shopping-budget">
        <div className="flex items-center justify-between">
          <span className="text-body">{formatKopecks(list.estimatedTotalKopecks)}</span>
          {percent > 100 ? <Badge tone="danger">Сверх бюджета</Badge> : null}
        </div>
        {list.budgetLimitKopecks ? (
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
            data-testid="shopping-budget-bar"
          >
            <div
              className="h-full rounded-full bg-[var(--color-primary)]"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Input
            type="number"
            placeholder="Бюджет, ₽"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            data-testid="shopping-budget-input"
          />
          <Button variant="secondary" disabled={busy} onClick={() => void runFitBudget()} data-testid="shopping-fit">
            Уложить
          </Button>
        </div>
      </Card>

      {proposals ? (
        <Card className="mb-3" data-testid="shopping-proposals">
          <p className="text-body mb-2">
            {proposals.achievable
              ? 'Можно уложиться:'
              : `Достичь цели нельзя, минимально ₽${Math.round(proposals.minimalTotalKopecks / 100)}`}
          </p>
          {proposals.proposals.map((p, index) => (
            <div key={index} className="flex items-center justify-between py-1 text-sm">
              <span>
                {p.kind === 'SUBSTITUTE'
                  ? `Заменить на более дешёвый аналог (−₽${Math.round(p.savingKopecks / 100)})`
                  : p.kind === 'DROP_OPTIONAL'
                    ? `Убрать необязательное (−₽${Math.round(p.savingKopecks / 100)})`
                    : 'Объединение блюд — позже'}
              </span>
              {p.kind !== 'MERGE_MEALS' ? (
                <Button variant="secondary" disabled={busy} onClick={() => void applyOne(p)} data-testid={`shopping-apply-${index}`}>
                  Применить
                </Button>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}

      {groupItems(list.items, new Map()).map((group) => (
        <Card key={group.categoryId} className="mb-3" data-testid="shopping-group">
          {group.items.map((item) => (
            <label
              key={item.id}
              className="flex items-center justify-between border-b border-[var(--color-border)] py-2 last:border-none"
              data-testid={`shopping-item-${item.ingredientId}`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.purchased}
                  onChange={() => void toggle(item)}
                  className="h-7 w-7"
                  data-testid={`shopping-check-${item.ingredientId}`}
                />
                <span className={item.purchased ? 'text-[var(--color-text-muted)] line-through' : ''}>
                  {item.ingredientId}
                </span>
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {item.packageQuantity} уп. · {formatKopecks(item.estimatedPriceKopecks ?? 0)}
                {item.utilityScore != null ? ` · польза ${item.utilityScore}/10` : ''}
              </span>
            </label>
          ))}
        </Card>
      ))}

      <Card className="mb-6" data-testid="shopping-complete">
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || purchasedCount === 0}
          onClick={() => void complete()}
          data-testid="shopping-complete-btn"
        >
          <CheckCircle2 size={18} aria-hidden /> Куплено всё — в холодильник
        </Button>
      </Card>
    </>
  );
}
