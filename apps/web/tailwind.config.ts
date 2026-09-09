import type { Config } from 'tailwindcss';

/**
 * Tailwind config — MULTI-CHEF web app.
 *
 * Maps PRD §2.5 design tokens (declared as CSS custom properties in
 * `apps/web/src/app/globals.css`) into Tailwind's theme so utility classes
 * like `bg-primary`, `text-text`, `rounded-md` resolve to the same values
 * used by `@multichef/ui` components.
 *
 * Why CSS-vars instead of static values? Light/dark themes swap variable
 * values; classes stay the same. See globals.css for the variable values.
 */
const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        primary: 'var(--color-primary)',
        'primary-press': 'var(--color-primary-press)',
        'primary-soft': 'var(--color-primary-soft)',
        fresh: 'var(--color-fresh)',
        'fresh-soft': 'var(--color-fresh-soft)',
        warning: 'var(--color-warning)',
        'warning-soft': 'var(--color-warning-soft)',
        danger: 'var(--color-danger)',
        'danger-soft': 'var(--color-danger-soft)',
        info: 'var(--color-info)',
        'info-soft': 'var(--color-info-soft)',
      },
      fontFamily: {
        sans: ['var(--font-family-sans)'],
        mono: ['var(--font-family-mono)'],
      },
      fontSize: {
        // PRD §2.5.2 text scale.
        display: ['1.75rem', { lineHeight: '2.125rem', fontWeight: '700' }], // 28/34
        title: ['1.375rem', { lineHeight: '1.75rem', fontWeight: '700' }], // 22/28
        heading: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '600' }], // 18/24
        body: ['1rem', { lineHeight: '1.5rem', fontWeight: '400' }], // 16/24
        caption: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400' }], // 14/20
        small: ['0.75rem', { lineHeight: '1rem', fontWeight: '500' }], // 12/16
        price: ['1.25rem', { lineHeight: '1.625rem', fontWeight: '700' }], // 20/26
      },
      spacing: {
        // 4px base scale (PRD §2.5.3).
        'space-1': 'var(--space-1)',
        'space-2': 'var(--space-2)',
        'space-3': 'var(--space-3)',
        'space-4': 'var(--space-4)',
        'space-5': 'var(--space-5)',
        'space-6': 'var(--space-6)',
        'space-8': 'var(--space-8)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        sheet: 'var(--shadow-sheet)',
      },
      maxWidth: {
        // PRD §2.5.3 / §2.3: mobile-first 480px content width.
        content: '480px',
      },
    },
  },
  plugins: [],
};

export default config;
