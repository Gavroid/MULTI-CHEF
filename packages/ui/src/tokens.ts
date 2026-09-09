// Design tokens for MULTI-CHEF.
//
// These are TypeScript constants that mirror the CSS custom properties
// declared in apps/web/src/app/globals.css. The two MUST stay in sync —
// CSS values drive runtime layout, TS values drive programmatic access
// (tests, analytics, dynamic inline styles).
//
// PRD §2.5.1 (colors), §2.5.2 (typography), §2.5.3 (spacing/radii/shadows).
// Do NOT add tokens that are not documented in the PRD — the design
// system is the contract.

export const colors = {
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  surface2: 'var(--color-surface-2)',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  textMuted: 'var(--color-text-muted)',
  primary: 'var(--color-primary)',
  primaryPress: 'var(--color-primary-press)',
  primarySoft: 'var(--color-primary-soft)',
  fresh: 'var(--color-fresh)',
  freshSoft: 'var(--color-fresh-soft)',
  warning: 'var(--color-warning)',
  warningSoft: 'var(--color-warning-soft)',
  danger: 'var(--color-danger)',
  dangerSoft: 'var(--color-danger-soft)',
  info: 'var(--color-info)',
  infoSoft: 'var(--color-info-soft)',
} as const;

export const fontFamily = {
  sans: 'var(--font-family-sans)',
  mono: 'var(--font-family-mono)',
} as const;

export const fontWeight = {
  normal: 'var(--font-weight-normal)',
  medium: 'var(--font-weight-medium)',
  semibold: 'var(--font-weight-semibold)',
  bold: 'var(--font-weight-bold)',
} as const;

export const lineHeight = {
  tight: 'var(--line-height-tight)',
  normal: 'var(--line-height-normal)',
  loose: 'var(--line-height-loose)',
} as const;

// 4px base scale — see PRD §2.5.3.
export const space = {
  1: 'var(--space-1)', // 4px
  2: 'var(--space-2)', // 8px
  3: 'var(--space-3)', // 12px
  4: 'var(--space-4)', // 16px
  5: 'var(--space-5)', // 20px
  6: 'var(--space-6)', // 24px
  8: 'var(--space-8)', // 32px
} as const;

export const radius = {
  sm: 'var(--radius-sm)', // 8px
  md: 'var(--radius-md)', // 12px
  lg: 'var(--radius-lg)', // 16px
  xl: 'var(--radius-xl)', // 24px
  full: 'var(--radius-full)', // 9999px
} as const;

export const shadow = {
  card: 'var(--shadow-card)',
  sheet: 'var(--shadow-sheet)',
} as const;

export type ColorToken = keyof typeof colors;
export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radius;
