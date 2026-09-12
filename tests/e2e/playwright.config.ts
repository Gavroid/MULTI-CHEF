// MC-073 — Playwright E2E config. Runs against the DEPLOYED gateway
// (nginx :8080) — see infrastructure/scripts. Not part of PR CI
// (nightly workflow per the development plan); run manually:
//   E2E_BASE_URL=http://127.0.0.1:8080 pnpm --filter @multichef/web test:e2e
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:8080',
    screenshot: 'only-on-failure',
  },
});
