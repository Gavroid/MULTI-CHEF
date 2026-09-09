// BottomTabBar component tests.
//
// We test `TabItem` (the rendered link for a single tab) directly — no
// Next navigation runtime needed because TabItem uses a plain `<a>` and
// only the wrapper BottomTabBar pulls in `next/link` + `usePathname`.
// The pathname → tab id mapping lives in `lib/active-tab.ts` and is
// covered separately by active-tab.test.ts.

import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { TabItem, TAB_ICONS } from '../components/BottomTabBar';
import { TABS } from '../lib/active-tab';

function renderTab(tabId: string, active: boolean): string {
  const tab = TABS.find((t) => t.id === tabId);
  if (!tab) throw new Error(`unknown tab id in test: ${tabId}`);
  return renderToString(React.createElement(TabItem, { tab, isActive: active }));
}

test('BottomTabBar: every tab id maps to a non-empty icon component', () => {
  for (const tab of TABS) {
    assert.ok(TAB_ICONS[tab.id], `tab ${tab.id} should have an icon`);
  }
});

test('BottomTabBar has exactly 5 navigation tabs', () => {
  assert.equal(TABS.length, 5);
});

test('BottomTabBar labels are Russian (PRD §2.5.8)', () => {
  for (const tab of TABS) {
    const html = renderTab(tab.id, false);
    assert.ok(html.includes(tab.label), `tab ${tab.id} missing label "${tab.label}"`);
  }
});

test('TabItem active=true renders aria-current="page"', () => {
  const html = renderTab('today', true);
  assert.ok(/aria-current="page"/.test(html), 'active tab should be aria-current=page');
  assert.ok(/data-active/.test(html), 'active tab should set data-active attribute');
});

test('TabItem active=false does not render aria-current', () => {
  const html = renderTab('today', false);
  assert.ok(!html.includes('aria-current'));
});

test('TabItem touch-target is ≥ 44px on every tab (PRD §2.5.4)', () => {
  for (const tab of TABS) {
    const html = renderTab(tab.id, false);
    // h-12 = 48px (Tailwind default).
    assert.ok(/\bh-12\b/.test(html), `tab ${tab.id} missing h-12 (≥44px touch-target)`);
  }
});

test('TabItem href matches the tab spec', () => {
  for (const tab of TABS) {
    const html = renderTab(tab.id, false);
    assert.ok(html.includes(`href="${tab.href}"`), `tab ${tab.id} should link to ${tab.href}`);
  }
});

test('TabItem renders primary colour when active, muted when not', () => {
  const activeHtml = renderTab('fridge', true);
  const inactiveHtml = renderTab('fridge', false);
  assert.ok(activeHtml.includes('--color-primary'), 'active should use primary token');
  assert.ok(inactiveHtml.includes('--color-text-muted'), 'inactive should use muted token');
});
