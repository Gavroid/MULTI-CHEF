import type { Metadata } from 'next';
import type { ReactElement } from 'react';

// T66-B (E22): offline fallback for PWA navigations. sw.js precaches this
// route and serves it when a navigation fails with no cached copy.
export const metadata: Metadata = { title: 'Офлайн' };

export default function OfflinePage(): ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-content flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-heading">Нет подключения</h1>
      <p className="text-body max-w-xs text-[var(--color-text-muted)]">
        Эта страница недоступна офлайн. Разделы, которые вы открывали раньше, — План, Покупки,
        Холодильник — работают без сети.
      </p>
      <a
        href="/today"
        className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 font-medium text-white"
      >
        На главный экран
      </a>
    </main>
  );
}
