'use client';

// HouseholdClient — /profile/household (PRD §2.3.16, R17-WP3).
//
// Edit household name, default people count, currency, weekly budget.
// The household is owned by the current user; PATCH is owner-only on
// the API side.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Skeleton, toast } from '@multichef/ui';
import type { HouseholdDto } from '@multichef/contracts';
import { getHousehold, patchHousehold, type ProfileClientDeps } from '@/lib/profile-client';

export interface HouseholdClientProps {
  deps?: Partial<ProfileClientDeps>;
}

export function HouseholdClient({ deps }: HouseholdClientProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<HouseholdDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [peopleCount, setPeopleCount] = useState<number>(2);
  const [currency, setCurrency] = useState<string>('RUB');
  const [budgetPerWeek, setBudgetPerWeek] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getHousehold(deps ?? {}).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setError(res.error.error.message);
        setLoading(false);
        return;
      }
      setCurrent(res.data);
      setName(res.data.name);
      setPeopleCount(res.data.defaultPeopleCount);
      setCurrency(res.data.currency);
      setBudgetPerWeek(
        res.data.budgetWeekKopecks !== null ? (res.data.budgetWeekKopecks / 100).toString() : '',
      );
      setLoading(false);
    });
    return (): void => {
      cancelled = true;
    };
  }, [deps]);

  const onSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const budgetRub = budgetPerWeek.trim() === '' ? null : Number.parseFloat(budgetPerWeek);
    if (
      budgetPerWeek.trim() !== '' &&
      (!Number.isFinite(budgetRub as number) || (budgetRub as number) < 0)
    ) {
      setError('Бюджет должен быть положительным числом');
      setSaving(false);
      return;
    }
    const result = await patchHousehold(
      {
        name: name.trim(),
        defaultPeopleCount: peopleCount,
        currency,
        budgetWeekKopecks: budgetRub === null ? null : Math.round((budgetRub as number) * 100),
      },
      deps ?? {},
    );
    setSaving(false);
    if (result.error) {
      setError(result.error.error.message);
      toast.danger('Не удалось сохранить — ' + result.error.error.message);
      return;
    }
    setCurrent(result.data);
    toast.success('Домохозяйство обновлено');
  }, [budgetPerWeek, currency, deps, name, peopleCount]);

  if (loading) {
    return (
      <Card>
        <Skeleton className="h-4 w-2/3 mb-2" />
        <Skeleton className="h-4 w-1/2 mb-2" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="profile-household-page">
      <Link
        href="/profile"
        className="text-body text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← Профиль
      </Link>

      <Card>
        <h2 className="text-heading mb-1">Домохозяйство</h2>
        <p className="text-body text-[var(--color-text-muted)] mb-3">
          Эти настройки используются по умолчанию в недельном плане и списке покупок.
        </p>

        <label className="flex flex-col gap-1 mb-3">
          <span className="text-body-strong">Название</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Моя семья"
            className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            data-testid="household-name"
          />
        </label>

        <label className="flex flex-col gap-1 mb-3">
          <span className="text-body-strong">Сколько человек</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={peopleCount}
            onChange={(e) => setPeopleCount(Number.parseInt(e.target.value, 10) || 1)}
            className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            data-testid="household-people"
          />
        </label>

        <label className="flex flex-col gap-1 mb-3">
          <span className="text-body-strong">Валюта (ISO 4217, 3 буквы)</span>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            placeholder="RUB"
            className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            data-testid="household-currency"
          />
        </label>

        <label className="flex flex-col gap-1 mb-3">
          <span className="text-body-strong">Бюджет на неделю (в валюте)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={budgetPerWeek}
            onChange={(e) => setBudgetPerWeek(e.target.value)}
            placeholder="оставьте пустым, если не задан"
            className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            data-testid="household-budget"
          />
        </label>

        {error ? (
          <p className="text-body text-[var(--color-danger)] mb-2" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          variant="primary"
          disabled={saving || name.trim() === ''}
          onClick={() => void onSave()}
          data-testid="household-save"
        >
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </Card>

      {current ? (
        <Card>
          <p className="text-caption text-[var(--color-text-muted)]">
            Владелец: {current.ownerId.slice(-6)} · Валюта: {current.currency} · Бюджет:{' '}
            {current.budgetWeekKopecks !== null
              ? `${(current.budgetWeekKopecks / 100).toFixed(2)} ${current.currency}/нед`
              : 'не задан'}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
