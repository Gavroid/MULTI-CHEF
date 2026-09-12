// MC-060/MC-061 — prep-session tasks + storage plan (pure functions).
//
// PrepSession (MC-060): from the week's entries build a DEDUPLICATED
// task list — «нарезать овощи для 3 блюд» is ONE task — with passive
// work (варка/духовка) in a parallelGroup and an active sequence
// (нарезать → собрать → разложить). Intensity cuts the active minutes
// (MINIMAL_15 keeps only chopping/plating; FULL_WEEK adds container
// labelling).
//
// StoragePlan (MC-061): entries are assigned containers; dishes later
// in the week are frozen (FREEZE_OK) with defrostAt = day − 1;
// NO_PREP/ADD_BEFORE_SERVING entries get no container («добавить перед
// подачей»). Nothing is stored in the fridge beyond its safe window.
//
// No I/O, no clock — dates come in as inputs.

export type PrepIntensity = 'MINIMAL_15' | 'COMPONENTS_1H' | 'BATCH_3H' | 'FULL_WEEK';

export const INTENSITY_TARGET_MINUTES: Record<PrepIntensity, number> = {
  MINIMAL_15: 15,
  COMPONENTS_1H: 60,
  BATCH_3H: 180,
  FULL_WEEK: 10_000,
};

export interface PrepEntryInput {
  entryId: string;
  recipeId: string;
  title: string;
  dayIndex: number;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  /** True when the recipe carries a FREEZE_OK storage rule. */
  freezeOk: boolean;
  /** Count of vegetable-group ingredients (chopping heuristic). */
  vegetableCount: number;
}

export interface PrepTaskDraft {
  title: string;
  durationMinutes: number;
  sequence: number;
  /** Non-null for passive parallel work (варка/духовка). */
  parallelGroup: number | null;
  instructions: string;
}

const CHOP_MINUTES_PER_RECIPE = 5;

export function buildPrepTasks(
  entries: PrepEntryInput[],
  intensity: PrepIntensity,
): PrepTaskDraft[] {
  const target = INTENSITY_TARGET_MINUTES[intensity];
  const tasks: PrepTaskDraft[] = [];
  let activeMinutes = 0;

  const addActive = (task: PrepTaskDraft, cost: number): boolean => {
    if (activeMinutes + cost > target && intensity !== 'FULL_WEEK') return false;
    activeMinutes += cost;
    tasks.push(task);
    return true;
  };

  // 1. CHOPPING — deduplicated across the whole week (PRD §2.3.12).
  const choppingRecipes = entries.filter((e) => e.vegetableCount > 0);
  if (choppingRecipes.length > 0) {
    addActive(
      {
        title: `Нарезать овощи (${choppingRecipes.length} блюд)`,
        durationMinutes: CHOP_MINUTES_PER_RECIPE * choppingRecipes.length,
        sequence: 1,
        parallelGroup: null,
        instructions: 'Овощи для всех блюд недели — нарезать и разложить по контейнерам.',
      },
      CHOP_MINUTES_PER_RECIPE * choppingRecipes.length,
    );
  }

  // 2. COMPONENT COOKING — grains/proteins for several dishes at once.
  const cookRecipes = entries.filter((e) => e.cookMinutes > 0 && e.prepMinutes >= 10);
  if (cookRecipes.length > 0) {
    addActive(
      {
        title: `Отварить/обжарить компоненты (${cookRecipes.length} блюд)`,
        durationMinutes: Math.min(
          45,
          Math.max(
            10,
            Math.round(
              cookRecipes.reduce((sum, e) => sum + e.cookMinutes, 0) /
                Math.max(1, cookRecipes.length) /
                2,
            ),
          ),
        ),
        sequence: 2,
        parallelGroup: 1,
        instructions: 'Крупы и белки готовятся параллельно с нарезкой — пассивное время.',
      },
      15,
    );
  }

  // 3. PER-RECIPE COOKING for the rest (batch oven/stove time).
  for (const entry of entries) {
    if (entry.cookMinutes <= 0) continue;
    const passive = addActive(
      {
        title: `${entry.title} — основная готовка`,
        durationMinutes: entry.cookMinutes,
        sequence: 3,
        parallelGroup: 2,
        instructions: `День ${entry.dayIndex + 1}, ${entry.servings} порц. — можно готовить параллельно с другими задачами.`,
      },
      0, // passive oven/stove time does not consume the active budget
    );
    if (!passive) break;
  }

  // 4. PLATING — pack prepared food into containers.
  addActive(
    {
      title: 'Разложить по контейнерам',
      durationMinutes: 10,
      sequence: 4,
      parallelGroup: null,
      instructions: 'Остудить, разложить по контейнерам, убрать в холодильник/морозилку.',
    },
    10,
  );

  // 5. FULL_WEEK extra: container labelling.
  if (intensity === 'FULL_WEEK' && entries.length > 0) {
    tasks.push({
      title: 'Подписать контейнеры',
      durationMinutes: 5,
      sequence: 5,
      parallelGroup: null,
      instructions: 'Подписать даты готовности — разморозка по календарю хранения.',
    });
  }

  return tasks.sort((a, b) => a.sequence - b.sequence);
}

// --- MC-061 storage plan ---------------------------------------------------

export interface StorageEntryInput {
  entryId: string;
  recipeId: string;
  title: string;
  /** 0-based day index within the plan. */
  dayIndex: number;
  servings: number;
  portionGrams: number;
  /** Recipe storage method derived from StorageRule (FREEZE_OK / FRIDGE_ONLY / NO_PREP / ADD_BEFORE_SERVING). */
  storageMethod: 'FREEZE_OK' | 'FRIDGE_ONLY' | 'NO_PREP' | 'ADD_BEFORE_SERVING' | 'PARTIAL_PREP';
  /** Safe fridge window in hours (StorageRule.maxHoursFridge). */
  maxHoursFridge: number;
}

export interface StorageAssignment {
  entryId: string;
  title: string;
  dayIndex: number;
  containerNumber: number | null;
  storageMethod: 'FREEZER' | 'FRIDGE' | 'NONE';
  /** ISO date — take it out of the freezer the day before serving. */
  defrostDate: string | null;
  /** ISO date — the day the dish is eaten. */
  useDate: string;
  /** For ADD_BEFORE_SERVING entries. */
  addBeforeServing: boolean;
}

export interface StoragePlanResult {
  assignments: StorageAssignment[];
  /** Entries without a container — «добавить перед подачей». */
  addBeforeServing: StorageAssignment[];
  containerCount: number;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Assign storage for every entry. Dishes on day index ≥ 3 are frozen
 * when the recipe allows it (they would exceed the fridge window
 * otherwise); defrost = the day before serving. Fridge window is never
 * exceeded: only days < fridgeDays stay in the fridge.
 */
export function buildStoragePlan(
  entries: StorageEntryInput[],
  startDateIso: string,
  fridgeSafeDays = 3,
): StoragePlanResult {
  let container = 0;
  const assignments: StorageAssignment[] = [];
  const addBefore: StorageAssignment[] = [];

  for (const entry of entries) {
    const useDate = addDays(startDateIso, entry.dayIndex);
    if (entry.storageMethod === 'ADD_BEFORE_SERVING' || entry.storageMethod === 'NO_PREP') {
      const assignment: StorageAssignment = {
        entryId: entry.entryId,
        title: entry.title,
        dayIndex: entry.dayIndex,
        containerNumber: null,
        storageMethod: 'NONE',
        defrostDate: null,
        useDate,
        addBeforeServing: true,
      };
      assignments.push(assignment);
      addBefore.push(assignment);
      continue;
    }
    const fridgeDays = Math.max(1, Math.floor(entry.maxHoursFridge / 24) || fridgeSafeDays);
    const freeze = entry.dayIndex >= fridgeDays && entry.storageMethod !== 'FRIDGE_ONLY';
    if (freeze) {
      container += 1;
      assignments.push({
        entryId: entry.entryId,
        title: entry.title,
        dayIndex: entry.dayIndex,
        containerNumber: container,
        storageMethod: 'FREEZER',
        defrostDate: addDays(startDateIso, entry.dayIndex - 1),
        useDate,
        addBeforeServing: false,
      });
    } else {
      container += 1;
      assignments.push({
        entryId: entry.entryId,
        title: entry.title,
        dayIndex: entry.dayIndex,
        containerNumber: container,
        storageMethod: 'FRIDGE',
        defrostDate: null,
        useDate,
        addBeforeServing: false,
      });
    }
  }

  return {
    assignments,
    addBeforeServing: addBefore,
    containerCount: container,
  };
}
