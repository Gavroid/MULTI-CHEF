import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PwaRegister } from '@/components/PwaRegister';
import { getSiteUrl } from '@/lib/site-url';
import './globals.css';

// T1 (audit round 3): title template gives every page a unique
// "<page> — MULTI-CHEF" title, openGraph fills the public OG tags,
// metadataBase anchors the relative OG/sitemap URLs to the public
// origin (NEXT_PUBLIC_APP_BASE_URL is inlined at build time).
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: 'MULTI-CHEF — семейный планировщик питания',
    template: '%s — MULTI-CHEF',
  },
  description: 'Семейный планировщик питания — рецепты из того, что уже есть дома.',
  openGraph: {
    type: 'website',
    siteName: 'MULTI-CHEF',
    locale: 'ru_RU',
    title: 'MULTI-CHEF — семейный планировщик питания',
    description: 'Семейный планировщик питания — рецепты из того, что уже есть дома.',
  },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Theme color follows the brand orange (PRD §2.5.1) — kept identical in
  // both light/dark since PWA icons + browser chrome expect a single value.
  themeColor: '#E8590C',
};

// Restores the theme before first paint on EVERY full page load. Without
// this script only pages mounting <ThemeToggle> (/, /design, /profile)
// re-applied the stored choice after SSR rendered data-theme="light",
// so dark mode "fell off" on navigation. Same key and OS fallback as
// useTheme (src/hooks/useTheme.ts).
const themeInitScript = `(function () {
  try {
    var t = localStorage.getItem('mc-theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }): React.ReactElement {
  // SSR keeps data-theme="light" deterministic; the inline script above the
  // app content swaps it pre-paint. suppressHydrationWarning tells React to
  // keep the client-applied attribute instead of correcting it to the
  // server value during hydration.
  return (
    <html lang="ru" data-theme="light" suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-text font-sans">
        {/* T30-B/T67-C (WCAG 2.4.1): skip-link — первый фокусируемый элемент. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--color-primary)] focus:px-4 focus:py-2 focus:text-white"
        >
          Перейти к содержимому
        </a>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
