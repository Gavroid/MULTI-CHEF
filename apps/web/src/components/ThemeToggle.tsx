// ThemeToggle — small UI control bound to useTheme(). Renders a button
// that swaps light <-> dark. Used in the landing header and the design
// demo page. Accessible: aria-label updates with the action.

'use client';

import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle(): React.ReactElement {
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      aria-pressed={isDark}
      data-testid="mc-theme-toggle"
      className="inline-flex items-center justify-center h-10 w-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
    >
      <span aria-hidden="true" className="text-base">
        {isDark ? '☾' : '☀'}
      </span>
    </button>
  );
}
