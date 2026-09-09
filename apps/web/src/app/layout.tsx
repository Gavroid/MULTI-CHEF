import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'MULTI-CHEF',
  description: 'Семейный планировщик питания — рецепты из того, что уже есть дома.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Theme color follows the brand orange (PRD §2.5.1) — kept identical in
  // both light/dark since PWA icons + browser chrome expect a single value.
  themeColor: '#E8590C',
};

export default function RootLayout({ children }: { children: ReactNode }): React.ReactElement {
  // data-theme defaults to "light". useTheme() client-side may override.
  // We deliberately leave the attribute static here to keep SSR markup
  // deterministic; the client effect swaps it before paint if needed.
  return (
    <html lang="ru" data-theme="light">
      <body className="min-h-screen bg-bg text-text font-sans">{children}</body>
    </html>
  );
}
