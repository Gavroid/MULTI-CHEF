import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PwaRegister } from '@/components/PwaRegister';
import './globals.css';

export const metadata: Metadata = {
  title: 'MULTI-CHEF',
  description: 'Семейный планировщик питания — рецепты из того, что уже есть дома.',
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
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
