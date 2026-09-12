// MC-060/MC-061 — prep tasks + storage plan unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrepTasks,
  buildStoragePlan,
  type PrepEntryInput,
  type StorageEntryInput,
} from '../prep.js';

function entry(over: Partial<PrepEntryInput>): PrepEntryInput {
  return {
    entryId: 'e1',
    recipeId: 'r1',
    title: 'Курица с рисом',
    dayIndex: 0,
    servings: 2,
    prepMinutes: 15,
    cookMinutes: 25,
    freezeOk: true,
    vegetableCount: 2,
    ...over,
  };
}

test('buildPrepTasks: chopping deduplicated into ONE week task', () => {
  const tasks = buildPrepTasks(
    [
      entry({ entryId: 'e1', vegetableCount: 2 }),
      entry({ entryId: 'e2', recipeId: 'r2', vegetableCount: 1 }),
      entry({ entryId: 'e3', recipeId: 'r3', vegetableCount: 3 }),
    ],
    'BATCH_3H',
  );
  const chop = tasks.filter((t) => t.title.includes('Нарезать'));
  assert.equal(chop.length, 1, 'one chopping task for all dishes');
  assert.equal(chop[0]!.durationMinutes, 5 * 3);
});

test('buildPrepTasks: sequence topological, passive work in a parallelGroup', () => {
  const tasks = buildPrepTasks([entry({})], 'FULL_WEEK');
  const seq = tasks.map((t) => t.sequence);
  assert.deepEqual(
    [...seq].sort((a, b) => a - b),
    seq,
    'sequence ascending',
  );
  const passive = tasks.filter((t) => t.parallelGroup != null);
  assert.ok(passive.length > 0, 'cooking runs in a parallel group');
});

test('buildPrepTasks: MINIMAL_15 cuts active minutes at 15', () => {
  const tasks = buildPrepTasks(
    [
      entry({ entryId: 'e1', vegetableCount: 4 }),
      entry({ entryId: 'e2', vegetableCount: 4 }),
      entry({ entryId: 'e3', vegetableCount: 4 }),
    ],
    'MINIMAL_15',
  );
  const active = tasks.filter((t) => t.parallelGroup == null && t.sequence < 4);
  const minutes = active.reduce((s, t) => s + t.durationMinutes, 0);
  assert.ok(minutes <= 15 + 10, `plating allowed after the cap, got ${minutes}`);
});

test('buildPrepTasks: FULL_WEEK adds container labelling', () => {
  const tasks = buildPrepTasks([entry({})], 'FULL_WEEK');
  assert.ok(tasks.some((t) => t.title.includes('Подписать')));
});

/* ---------------- storage plan ---------------- */

function sentry(over: Partial<StorageEntryInput>): StorageEntryInput {
  return {
    entryId: 'e1',
    recipeId: 'r1',
    title: 'Курица',
    dayIndex: 0,
    servings: 2,
    portionGrams: 700,
    storageMethod: 'FREEZE_OK',
    maxHoursFridge: 72,
    ...over,
  };
}

test('buildStoragePlan: late dishes are frozen with defrost = day − 1', () => {
  const plan = buildStoragePlan([sentry({ entryId: 'late', dayIndex: 5 })], '2026-09-14');
  const a = plan.assignments[0]!;
  assert.equal(a.storageMethod, 'FREEZER');
  assert.equal(a.defrostDate, '2026-09-18', 'Friday dish ← defrost Thursday');
});

test('buildStoragePlan: early dish stays in the fridge within its window', () => {
  const plan = buildStoragePlan([sentry({ dayIndex: 1 })], '2026-09-14');
  const a = plan.assignments[0]!;
  assert.equal(a.storageMethod, 'FRIDGE');
  assert.equal(a.defrostDate, null);
});

test('buildStoragePlan: NO_PREP has no container, lands in add-before-serving', () => {
  const plan = buildStoragePlan(
    [
      sentry({ storageMethod: 'NO_PREP' }),
      sentry({ entryId: 'e2', storageMethod: 'ADD_BEFORE_SERVING', dayIndex: 2 }),
    ],
    '2026-09-14',
  );
  assert.equal(plan.containerCount, 0);
  assert.equal(plan.addBeforeServing.length, 2);
  assert.ok(plan.assignments.every((a) => a.containerNumber === null));
});
