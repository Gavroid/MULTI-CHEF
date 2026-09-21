'use client';

// NutritionClient — /profile/nutrition (PRD §2.3.16, R17-WP3).
//
// Form for NutritionProfile: target КБЖУ (kcal/P/F/C), mealsPerDay,
// preferredPrepMinutes, skillLevel, appliances (multi-select chips),
// dietType. PUT semantics — partial updates use the same endpoint
// (server replaces nullable fields, keeps already-set ones when
// omitted).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Chip, Skeleton, toast } from '@multichef/ui';
import {
  APPLIANCE_LABELS,
  APPLIANCE_VALUES,
  SKILL_LEVEL_LABELS,
  SKILL_LEVEL_VALUES,
  DIET_TYPE_LABELS,
  DIET_TYPE_VALUES,
  type Appliance,
  type DietType,
  type NutritionProfileDto,
  type SkillLevel,
} from '@multichef/contracts';
import { getNutrition, putNutrition, type ProfileClientDeps } from '@/lib/profile-client';

const PREP_PRESETS = [15, 30, 60, 120] as const;

export interface NutritionClientProps {
  deps?: Partial<ProfileClientDeps>;
}

export function NutritionClient({ deps }: NutritionClientProps): React.ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<NutritionProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [targetCalories, setTargetCalories] = useState<string>('');
  const [targetProteinG, setTargetProteinG] = useState<string>('');
  const [targetFatG, setTargetFatG] = useState<string>('');
  const [targetCarbsG, setTargetCarbsG] = useState<string>('');
  const [mealsPerDay, setMealsPerDay] = useState<number>(3);
  const [preferredPrepMinutes, setPreferredPrepMinutes] = useState<number>(30);
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('CONFIDENT');
  const [appliances, setAppliances] = useState<ReadonlyArray<Appliance>>(['STOVE']);
  const [dietType, setDietType] = useState<DietType>('NONE');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getNutrition(deps ?? {}).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setError(res.error.error.message);
        setLoading(false);
        return;
      }
      const np = res.data;
      setCurrent(np);
      if (np) {
        setTargetCalories(np.targetCalories?.toString() ?? '');
        setTargetProteinG(np.targetProteinG?.toString() ?? '');
        setTargetFatG(np.targetFatG?.toString() ?? '');
        setTargetCarbsG(np.targetCarbsG?.toString() ?? '');
        setMealsPerDay(np.mealsPerDay);
        setPreferredPrepMinutes(np.preferredPrepMinutes);
        setSkillLevel(np.skillLevel);
        setAppliances(np.appliances);
        setDietType(np.dietType);
      }
      setLoading(false);
    });
    return (): void => {
      cancelled = true;
    };
  }, [deps]);

  const toggleAppliance = useCallback((a: Appliance): void => {
    setAppliances((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }, []);

  const onSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const toIntOrUndef = (s: string): number | undefined => {
      const t = s.trim();
      if (!t) return undefined;
      const n = Number.parseInt(t, 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const cal = toIntOrUndef(targetCalories);
    const p = toIntOrUndef(targetProteinG);
    const f = toIntOrUndef(targetFatG);
    const c = toIntOrUndef(targetCarbsG);
    const result = await putNutrition(
      {
        ...(cal !== undefined ? { targetCalories: cal } : {}),
        ...(p !== undefined ? { targetProteinG: p } : {}),
        ...(f !== undefined ? { targetFatG: f } : {}),
        ...(c !== undefined ? { targetCarbsG: c } : {}),
        mealsPerDay,
        preferredPrepMinutes,
        skillLevel,
        appliances: appliances.length === 0 ? ['STOVE'] : [...appliances],
        dietType,
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
    toast.success('КБЖУ сохранено');
    router.refresh();
  }, [
    appliances,
    deps,
    dietType,
    mealsPerDay,
    preferredPrepMinutes,
    router,
    skillLevel,
    targetCalories,
    targetCarbsG,
    targetFatG,
    targetProteinG,
  ]);

  const appliancesList = useMemo(() => [...APPLIANCE_VALUES], []);
  const skillList = useMemo(() => [...SKILL_LEVEL_VALUES], []);
  const dietList = useMemo(() => [...DIET_TYPE_VALUES], []);

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
    <div className="flex flex-col gap-4" data-testid="profile-nutrition-page">
      <Link
        href="/profile"
        className="text-body text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← Профиль
      </Link>

      <Card>
        <h2 className="text-heading mb-1">Цели и КБЖУ</h2>
        <p className="text-body text-[var(--color-text-muted)] mb-3">
          Эти значения используются в рекомендациях «на сегодня» и в недельном плане.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="flex flex-col gap-1">
            <span className="text-body-strong">Калории в день</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={50}
              value={targetCalories}
              onChange={(e) => setTargetCalories(e.target.value)}
              placeholder="напр. 2200"
              className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              data-testid="nutrition-calories"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-body-strong">Белки, г</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={targetProteinG}
              onChange={(e) => setTargetProteinG(e.target.value)}
              placeholder="напр. 125"
              className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              data-testid="nutrition-protein"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-body-strong">Жиры, г</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={targetFatG}
              onChange={(e) => setTargetFatG(e.target.value)}
              placeholder="напр. 70"
              className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              data-testid="nutrition-fat"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-body-strong">Углеводы, г</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={targetCarbsG}
              onChange={(e) => setTargetCarbsG(e.target.value)}
              placeholder="напр. 220"
              className="h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              data-testid="nutrition-carbs"
            />
          </label>
        </div>

        <label className="block text-body-strong mb-1">Приёмов пищи в день</label>
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Приёмы пищи">
          {[2, 3, 4, 5].map((n) => (
            <Chip
              key={n}
              selected={mealsPerDay === n}
              onClick={() => setMealsPerDay(n)}
              data-testid={`nutrition-meals-${n}`}
              aria-pressed={mealsPerDay === n}
            >
              {n}
            </Chip>
          ))}
        </div>

        <label className="block text-body-strong mb-1">Время на готовку</label>
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Время на готовку">
          {PREP_PRESETS.map((m) => (
            <Chip
              key={m}
              selected={preferredPrepMinutes === m}
              onClick={() => setPreferredPrepMinutes(m)}
              data-testid={`nutrition-prep-${m}`}
              aria-pressed={preferredPrepMinutes === m}
            >
              {m < 60 ? `${m} мин` : m === 60 ? '1 час' : m === 120 ? '2 часа' : `${m} мин`}
            </Chip>
          ))}
        </div>

        <label className="block text-body-strong mb-1">Кулинарный уровень</label>
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Уровень">
          {skillList.map((s) => (
            <Chip
              key={s}
              selected={skillLevel === s}
              onClick={() => setSkillLevel(s)}
              data-testid={`nutrition-skill-${s}`}
              aria-pressed={skillLevel === s}
            >
              {SKILL_LEVEL_LABELS[s]}
            </Chip>
          ))}
        </div>

        <label className="block text-body-strong mb-1">Кухонная техника</label>
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Техника">
          {appliancesList.map((a) => (
            <Chip
              key={a}
              selected={appliances.includes(a)}
              onClick={() => toggleAppliance(a)}
              data-testid={`nutrition-appliance-${a}`}
              aria-pressed={appliances.includes(a)}
            >
              {APPLIANCE_LABELS[a]}
            </Chip>
          ))}
        </div>

        <label className="block text-body-strong mb-1">Тип питания</label>
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Тип питания">
          {dietList.map((d) => (
            <Chip
              key={d}
              selected={dietType === d}
              onClick={() => setDietType(d)}
              data-testid={`nutrition-diet-${d}`}
              aria-pressed={dietType === d}
            >
              {DIET_TYPE_LABELS[d]}
            </Chip>
          ))}
        </div>

        {error ? (
          <p className="text-body text-[var(--color-danger)] mb-2" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          variant="primary"
          disabled={saving}
          onClick={() => void onSave()}
          data-testid="nutrition-save"
        >
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </Card>

      {current ? (
        <Card>
          <p className="text-caption text-[var(--color-text-muted)]">
            Сохранено: КБЖУ {current.targetCalories ?? '—'}/{current.targetProteinG ?? '—'}/
            {current.targetFatG ?? '—'}/{current.targetCarbsG ?? '—'} · {current.mealsPerDay} приёма
            · {current.preferredPrepMinutes} мин
          </p>
        </Card>
      ) : null}
    </div>
  );
}
