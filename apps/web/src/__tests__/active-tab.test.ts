import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getActiveTabId, TABS } from '../lib/active-tab';

test('TABS has exactly 5 entries in the documented order', () => {
  assert.equal(TABS.length, 5);
  assert.deepEqual(
    TABS.map((t) => t.id),
    ['today', 'fridge', 'plan', 'shopping', 'profile'],
  );
});

test('getActiveTabId maps each root path to its tab id', () => {
  for (const tab of TABS) {
    assert.equal(getActiveTabId(tab.href), tab.id);
  }
});

test('getActiveTabId returns the longest matching prefix for nested paths', () => {
  assert.equal(getActiveTabId('/today/wizard'), 'today');
  assert.equal(getActiveTabId('/plan/2025-01-15'), 'plan');
  assert.equal(getActiveTabId('/shopping/list/purchased'), 'shopping');
});

test('getActiveTabId handles trailing slashes', () => {
  assert.equal(getActiveTabId('/today/'), 'today');
  assert.equal(getActiveTabId('/profile/'), 'profile');
});

test('getActiveTabId returns null for paths outside the tab set', () => {
  assert.equal(getActiveTabId('/auth/login'), null);
  assert.equal(getActiveTabId('/design'), null);
  assert.equal(getActiveTabId('/'), null);
});

test('getActiveTabId tolerates null and undefined input', () => {
  assert.equal(getActiveTabId(null), null);
  assert.equal(getActiveTabId(undefined), null);
  assert.equal(getActiveTabId(''), null);
});
