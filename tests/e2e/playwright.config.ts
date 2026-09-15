// MC-073 — Playwright E2E config. Runs against the DEPLOYED gateway
// (nginx :8080) — see infrastructure/scripts. Not part of PR CI
// (nightly workflow per the development plan); run manually:
//   E2E_BASE_URL=http://192.168.1.95:8080 pnpm --filter @multichef/web test:e2e
// The default MUST match the NEXT_PUBLIC_APP_BASE_URL baked into the web
// bundle (/etc/multichef/multichef.env): client-side fetches go to that
// absolute origin, so a different host (e.g. 127.0.0.1) breaks them via CORS.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 1,
  // E22: 30 viewport/PWA tests SSR-load the gateway in parallel — the box
  // is small; the default (cpus/2) workers caused load-dependent flakes.
  workers: 4,
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://192.168.1.95:8080',
    screenshot: 'only-on-failure',
  },
});
