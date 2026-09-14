// U1 (audit round 3, VERIFICATION.md §U1) — WCAG AA acceptance gate.
// axe-core runs on the four public pages that carried the original
// color-contrast / link-in-text-block findings; serious and critical
// violations fail the run. Full violation JSON is printed on failure
// so the offending color pairs can be fixed in @multichef/ui tokens.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = ['/', '/auth/login', '/auth/register', '/design'];

test.describe.configure({ mode: 'parallel' });

for (const path of PAGES) {
  test(`axe: no serious/critical violations on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    );
    if (blocking.length > 0) {
      console.log(
        `axe violations on ${path}:`,
        JSON.stringify(
          blocking.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.map((n) => ({ target: n.target, html: n.html.slice(0, 160) })),
          })),
          null,
          2,
        ),
      );
    }
    expect(blocking, `${path}: ${blocking.length} blocking a11y violations`).toEqual([]);
  });
}
