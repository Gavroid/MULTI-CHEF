// playwright.config.ts — MC-SMOKE-AUTH-FRIDGE.
//
// Real-browser E2E: launches API + Next dev via Playwright's
// webServer pool, then drives the login form + fridge FAB through
// the actual chromium bundle. Source-regression tests pass with
// happy-dom, but they would never catch a missing migration, a
// broken cookie, or a wrong redirect target — this test does.
//
// Single worker (no parallelism) because both webServer targets
// share the same Postgres database; concurrent runs would race
// on the mc_user row.

import { defineConfig, devices } from '@playwright/test';

const API_PORT = Number(process.env['API_PORT'] ?? '3001');
const WEB_PORT = Number(process.env['WEB_PORT'] ?? '3000');
void API_PORT;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,

  // The bundle is fast; we mainly wait on Postgres seed + Next dev
  // compile. 60 s ceiling per the DoD.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    // Smaller viewport matches the PRD's mobile-first target.
    viewport: { width: 414, height: 896 },
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Playwright starts each command with the env from this process.
  // .env at the repo root is sourced by the wrapper scripts below.
  // R17-WP25: webServer disabled — Playwright runs against the
  // production nginx gateway on :8080 (which proxies to api:3001
  // and web:3000 already started by systemd). E2E_BASE_URL
  // env var overrides the baseURL.
  webServer: [],
});
