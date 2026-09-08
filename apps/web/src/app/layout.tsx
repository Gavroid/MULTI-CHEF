import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'MULTI-CHEF',
  description: 'MULTI-CHEF scaffold (MC-001)',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // PRD §2.5.8 — mobile-first viewport, theme-color is a placeholder until MC-012 tokens land.
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
