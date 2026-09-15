'use client';

// StorageClient — /plan/storage (MC-062, PRD §2.3.13).
//
// Tabs Морозилка / Холодильник / Добавить перед подачей + the defrost
// calendar («достать из морозилки: четверг вечер»).

import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Card } from '@multichef/ui';
import type { StoragePlanDto } from '@multichef/contracts';
import { getStoragePlan } from '@/lib/prep-client';
import { TabTitle } from '@/components/TabTitle';

export type StorageTab = 'freezer' | 'fridge' | 'add';

export function splitByTab(plan: StoragePlanDto): {
  freezer: StoragePlanDto['assignments'];
  fridge: StoragePlanDto['assignments'];
  add: StoragePlanDto['assignments'];
} {
  return {
    freezer: plan.assignments.filter((a) => a.storageMethod === 'FREEZER'),
    fridge: plan.assignments.filter((a) => a.storageMethod === 'FRIDGE'),
    add: plan.addBeforeServing,
  };
}

export function defrostWeekday(defrostDate: string | null): string | null {
  if (!defrostDate) return null;
  return new Date(`${defrostDate}T00:00:00`).toLocaleDateString('ru-RU', { weekday: 'long' });
}

export function StorageClient(): React.ReactElement {
  const [plan, setPlan] = useState<StoragePlanDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<StorageTab>('freezer');

  const deps = useMemo(() => ({ getStoragePlan }), []);
  useEffect(() => {
    let cancelled = false;
    void deps
      .getStoragePlan()
      .then((res) => {
        if (!cancelled) {
          if (!res.error) setPlan(res.data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deps]);

  if (loading) {
    return (
      <>
        <TabTitle sublabel="Хранение">Контейнеры</TabTitle>
        <Card data-testid="storage-loading">
          <p className="text-body">Загрузка…</p>
        </Card>
      </>
    );
  }

  if (!plan) {
    return (
      <>
        <TabTitle sublabel="Хранение">Контейнеры</TabTitle>
        <Card data-testid="storage-empty">
          <p className="text-body">Активного плана нет — сначала соберите план.</p>
        </Card>
      </>
    );
  }

  const split = splitByTab(plan);
  const shown = split[tab];

  return (
    <>
      <TabTitle sublabel={`${plan.containerCount} контейнеров`}>Хранение</TabTitle>

      <div className="mb-3 flex gap-2">
        {(
          [
            ['freezer', 'Морозилка'],
            ['fridge', 'Холодильник'],
            ['add', 'Добавить перед подачей'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1 text-sm ${tab === key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text)]'}`}
            data-testid={`storage-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card data-testid="storage-tab-empty">
          <p className="text-body">Здесь пока ничего нет.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <Card key={a.entryId} data-testid={`storage-item-${a.entryId}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-title">{a.title}</h3>
                {a.storageMethod === 'FREEZER' ? <Badge tone="info">Морозилка</Badge> : null}
              </div>
              <p className="text-caption text-[var(--color-text-muted)]">
                {a.containerNumber != null ? `Контейнер №${a.containerNumber} · ` : ''}
                День {a.dayIndex + 1}
                {a.storageMethod === 'FREEZER' && defrostWeekday(a.defrostDate)
                  ? ` · достать из морозилки: ${defrostWeekday(a.defrostDate)} вечер`
                  : ''}
                {a.addBeforeServing ? ' · добавить перед подачей' : ''}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
