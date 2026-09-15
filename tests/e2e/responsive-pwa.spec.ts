// E22 (T66-A/B/C/D) — responsive + PWA acceptance.
// 1. No horizontal scroll on public pages at 375/768/1280.
// 2. No horizontal scroll on authed tab screens at 375 (the audit metric).
// 3. Fridge lists form responsive grids: 1 col → 2 (md) → 3 (lg).
// 4. (app) shell container widens to lg:max-w-4xl (896px) on desktop.
// 5. Manifest serves PNG icons + apple-touch-icon link; viewport allows zoom.
// 6. SW v2 precaches the shell (incl. /offline); offline navigation falls
//    back to /offline for uncached routes.
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

// Two origins, two capabilities (see E22 notes):
// - APP_ORIGIN — the NEXT_PUBLIC_APP_BASE_URL baked into the bundle. Client
//   fetches are same-origin here, so authed data flows work. Plain-LAN HTTP
//   is NOT a secure context → service workers do not register here.
// - SECURE_CTX — loopback IS a secure context → SW registers and the
//   precache/offline tests run here. The shell is static HTML, so these
//   tests need no authed API traffic.
const APP_ORIGIN = process.env['E2E_APP_ORIGIN'] ?? 'http://192.168.1.95:8080';
const SECURE_CTX = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:8080';
const unique = Date.now();
const EMAIL = `e2e-pwa-${unique}@test.ru`;
const PASSWORD = 'Passw0rd-e2e';

const PUBLIC_PAGES = ['/', '/auth/login', '/auth/register', '/design', '/offline'];
const AUTHED_PAGES = ['/today', '/fridge', '/plan', '/shopping', '/profile'];

let sessionToken = '';
// E25 CSRF hard mode: the register response hands out BOTH cookies —
// mc_session (HttpOnly) and mc_csrf (double-submit token). The `request`
// fixture keeps them in its own jar, so we re-plant mc_csrf into the
// browser context exactly as a real login would.
let csrfToken = '';
let authState: { id: string; email: string; householdId: string } | null = null;

// Auth endpoints are @Throttle(10/min): with N workers each running
// beforeAll, register bursts can 429 — retry until the window frees up.
async function registerWithBackoff(request: APIRequestContext): Promise<APIResponse> {
  let res: APIResponse | null = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    res = await request.post(`${APP_ORIGIN}/api/v1/auth/register`, {
      headers: { 'idempotency-key': randomUUID() },
      data: { email: EMAIL, password: PASSWORD, householdName: 'Семья E2E' },
    });
    if (res.status() !== 429) return res;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return res as APIResponse;
}

test.beforeAll(async ({ request }) => {
  const reg = await registerWithBackoff(request);
  expect(reg.status()).toBe(201);
  const body = (await reg.json()) as {
    sessionToken: string;
    user: { id: string; email: string };
    household: { id: string };
  };
  sessionToken = body.sessionToken;
  for (const h of reg.headersArray()) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const m = /mc_csrf=([^;]+)/.exec(h.value);
      if (m) csrfToken = m[1] as string;
    }
  }
  authState = {
    id: body.user.id,
    email: body.user.email,
    householdId: body.household.id,
  };
});

async function seedAuth(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'mc_session',
      value: sessionToken,
      url: APP_ORIGIN,
      httpOnly: true,
      sameSite: 'Lax',
    },
    ...(csrfToken
      ? [
          {
            name: 'mc_csrf',
            value: csrfToken,
            url: APP_ORIGIN,
            httpOnly: false,
            sameSite: 'Lax',
          },
        ]
      : []),
  ]);
  await page.addInitScript(
    (stored) => {
      window.localStorage.setItem('mc_user', JSON.stringify(stored));
    },
    authState as { id: string; email: string; householdId: string },
  );
}

test.describe('T66-A: no horizontal scroll (public pages)', () => {
  for (const width of [375, 768, 1280]) {
    for (const path of PUBLIC_PAGES) {
      test(`${width}px ${path}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${APP_ORIGIN}${path}`, { waitUntil: 'load' });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `${path} overflows at ${width}px`).toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe('T66-A: no horizontal scroll (authed tab screens @375)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await seedAuth(page);
  });

  for (const path of AUTHED_PAGES) {
    test(path, async ({ page }) => {
      await page.goto(`${APP_ORIGIN}${path}`, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} overflows at 375px`).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('T66-A: responsive grids + shell width', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
  });

  test('fridge: stock one item, ul grid goes 1 → 2 (md) → 3 (lg) columns', async ({ page }) => {
    await page.goto(`${APP_ORIGIN}/fridge`, { waitUntil: 'load' });
    // Stock the fridge from inside the page context (cookies + CSRF ride along).
    const added = (await page.evaluate(async () => {
      const csrf = document.cookie
        .split('; ')
        .find((c) => c.startsWith('mc_csrf='))
        ?.split('=')[1];
      const search = await fetch(
        '/api/v1/ingredients?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE&limit=1',
        {
          credentials: 'include',
        },
      );
      const searchJson = (await search.json()) as { data?: Array<{ id: string }> };
      const ingredientId = searchJson.data?.[0]?.id;
      if (!ingredientId) {
        return { step: 'search', status: search.status, body: await search.text() };
      }
      const res = await fetch('/api/v1/pantry/items', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          // crypto.randomUUID exists only in secure contexts; the LAN
          // origin is plain HTTP — mirror happy-today's fallback.
          'Idempotency-Key': crypto.randomUUID
            ? crypto.randomUUID()
            : `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({ ingredientId, quantityG: 1000 }),
      });
      return { step: 'post', status: res.status, body: await res.text() };
    })) as { step: string; status: number; body: string };
    console.log('[e2e-debug] stock:', JSON.stringify(added).slice(0, 300));
    expect(added.step === 'post' && added.status < 400, 'fridge stocking failed').toBeTruthy();

    await page.reload({ waitUntil: 'load' });
    const ul = page.locator('[data-testid="fridge-section-fresh"] ul').first();
    await expect(ul).toBeVisible({ timeout: 10_000 });

    const cols = async (): Promise<number> =>
      ul.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);

    await page.setViewportSize({ width: 375, height: 800 });
    expect(await cols()).toBe(1);
    await page.setViewportSize({ width: 768, height: 900 });
    expect(await cols()).toBe(2);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await cols()).toBe(3);
  });

  test('(app) shell container: 480px cap on mobile, 896px (lg) on desktop', async ({ page }) => {
    await page.goto(`${APP_ORIGIN}/today`, { waitUntil: 'load' });
    const mainWidth = async (): Promise<number> =>
      page.locator('#main-content').evaluate((el) => el.getBoundingClientRect().width);
    await page.setViewportSize({ width: 375, height: 800 });
    expect(await mainWidth()).toBeLessThanOrEqual(375);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await mainWidth()).toBe(896); // lg:max-w-4xl = 56rem = 896px
  });
});

test.describe('T66-C/D: manifest, icons, viewport zoom', () => {
  test('manifest serves PNG + maskable icons', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as {
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };
    const srcs = manifest.icons.map((i) => i.src);
    expect(srcs).toContain('/icons/icon-192.png');
    expect(srcs).toContain('/icons/icon-512.png');
    expect(manifest.icons.some((i) => i.purpose.includes('maskable'))).toBe(true);
  });

  for (const icon of [
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
  ]) {
    test(`GET /icons/${icon} → 200 image/png`, async ({ request }) => {
      const res = await request.get(`/icons/${icon}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
    });
  }

  test('head has apple-touch-icon link and zoom-friendly viewport meta', async ({ page }) => {
    await page.goto(`${APP_ORIGIN}/`, { waitUntil: 'load' });
    const apple = page.locator('link[rel="apple-touch-icon"]');
    await expect(apple).toHaveCount(1);
    expect(await apple.getAttribute('href')).toBe('/icons/apple-touch-icon.png');
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport ?? '').toContain('maximum-scale=5');
    expect(viewport ?? '').not.toContain('user-scalable=no');
    expect(viewport ?? '').not.toContain('maximum-scale=1');
  });
});

test.describe('T66-B: service worker shell + offline fallback', () => {
  // Service workers require a SECURE context. The LAN deployment serves
  // plain HTTP on a non-loopback host, so these tests run against the
  // loopback origin, where the browser treats the gateway as secure.
  test.use({ baseURL: SECURE_CTX });

  test('sw.js is v2 and precaches the full shell incl. /offline', async ({ page }) => {
    const res = await page.request.get('/sw.js');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("VERSION = 'v2'");
    expect(body).toContain("'/offline'");

    await page.goto(`${SECURE_CTX}/`, { waitUntil: 'load' });
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      await navigator.serviceWorker.ready;
      return true;
    });
    expect(registered).toBe(true);

    // Install precache is async — wait until every shell URL resolves.
    const precached = await page.waitForFunction(
      async () => {
        const keys = await caches.keys();
        const shell = keys.find((k) => k.startsWith('mc-shell-v2'));
        if (!shell) return false;
        const cache = await caches.open(shell);
        const urls = ['/plan', '/shopping', '/fridge', '/offline'];
        const hits = await Promise.all(urls.map((u) => cache.match(u)));
        return hits.every((h) => h !== undefined);
      },
      undefined,
      { timeout: 20_000 },
    );
    expect(precached).toBeTruthy();
  });

  test('offline navigation to an uncached route lands on /offline', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(`${SECURE_CTX}/`, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(
      async () => {
        const keys = await caches.keys();
        const shell = keys.find((k) => k.startsWith('mc-shell-v2'));
        if (!shell) return false;
        const cache = await caches.open(shell);
        return (await cache.match('/offline')) !== undefined;
      },
      undefined,
      { timeout: 20_000 },
    );

    await page.context().setOffline(true);
    try {
      // /profile is not in SHELL_URLS — network-first navigation must fall
      // back through the SW to the precached /offline page.
      await page.goto(`${SECURE_CTX}/profile`, { waitUntil: 'load', timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Нет подключения' })).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await page.context().setOffline(false);
    }
  });
});
