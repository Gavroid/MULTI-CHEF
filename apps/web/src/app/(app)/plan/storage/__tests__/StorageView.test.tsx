// MC-062 — storage view helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defrostWeekday, splitByTab } from '../StorageClient';
import type { StoragePlanDto } from '@multichef/contracts';

const plan: StoragePlanDto = {
  assignments: [
    {
      entryId: 'a',
      title: 'Курица',
      dayIndex: 5,
      containerNumber: 1,
      storageMethod: 'FREEZER',
      defrostDate: '2026-09-18',
      useDate: '2026-09-19',
      addBeforeServing: false,
    },
    {
      entryId: 'b',
      title: 'Салат',
      dayIndex: 1,
      containerNumber: 2,
      storageMethod: 'FRIDGE',
      defrostDate: null,
      useDate: '2026-09-15',
      addBeforeServing: false,
    },
  ],
  addBeforeServing: [
    {
      entryId: 'c',
      title: 'Сметана',
      dayIndex: 2,
      containerNumber: null,
      storageMethod: 'NONE',
      defrostDate: null,
      useDate: '2026-09-16',
      addBeforeServing: true,
    },
  ],
  containerCount: 2,
};

test('splitByTab: freezer / fridge / add-before-serving', () => {
  const split = splitByTab(plan);
  assert.equal(split.freezer.length, 1);
  assert.equal(split.freezer[0]!.title, 'Курица');
  assert.equal(split.fridge[0]!.title, 'Салат');
  assert.equal(split.add[0]!.title, 'Сметана');
});

test('defrostWeekday: 2026-09-18 is a Friday', () => {
  assert.equal(defrostWeekday('2026-09-18'), 'пятница');
  assert.equal(defrostWeekday(null), null);
});
