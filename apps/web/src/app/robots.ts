// T1 (audit round 3): robots.txt for the public/private split.
// Public: landing, auth entry points, design demo. Everything behind
// the mc_session gate ((app) screens + /api) is closed to crawlers
// and additionally carries noindex metadata (see (app)/layout.tsx).

import type { MetadataRoute } from 'next';

const SITE = process.env['NEXT_PUBLIC_APP_BASE_URL'] ?? 'http://localhost:3001';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/today', '/fridge', '/plan', '/shopping', '/profile', '/recipe'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
