// T1 (audit round 3): static sitemap for the PUBLIC pages only.
// Authenticated screens are noindex (see (app)/layout.tsx) and must
// not appear here.

import type { MetadataRoute } from 'next';

const SITE = process.env['NEXT_PUBLIC_APP_BASE_URL'] ?? 'http://localhost:3001';

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: Array<[string, number]> = [
    ['', 1],
    ['/auth/login', 0.5],
    ['/auth/register', 0.5],
    ['/design', 0.3],
  ];
  return entries.map(([path, priority]) => ({
    url: `${SITE}${path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority,
  }));
}
