// getActiveTabId — pure helper that maps a URL pathname to one of the five
// bottom tab ids. Extracted so it's trivially unit-testable (no React
// rendering, no Next.js navigation context).
//
// Matching rule: longest tab prefix wins. `/today/wizard` → 'today'. Unknown
// paths return null (no tab should appear active).

export type TabId = 'today' | 'fridge' | 'plan' | 'shopping' | 'profile';

export interface TabSpec {
  id: TabId;
  href: string;
  /** Russian label rendered under the icon (PRD §2.5.8). */
  label: string;
}

export const TABS: readonly TabSpec[] = [
  { id: 'today', href: '/today', label: 'Сегодня' },
  { id: 'fridge', href: '/fridge', label: 'Холодильник' },
  { id: 'plan', href: '/plan', label: 'План' },
  { id: 'shopping', href: '/shopping', label: 'Покупки' },
  { id: 'profile', href: '/profile', label: 'Профиль' },
] as const;

export function getActiveTabId(pathname: string | null | undefined): TabId | null {
  if (!pathname) return null;
  // Strip trailing slash except for root.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let bestMatch: TabSpec | null = null;
  for (const tab of TABS) {
    if (normalized === tab.href || normalized.startsWith(`${tab.href}/`)) {
      if (!bestMatch || tab.href.length > bestMatch.href.length) {
        bestMatch = tab;
      }
    }
  }
  return bestMatch?.id ?? null;
}
