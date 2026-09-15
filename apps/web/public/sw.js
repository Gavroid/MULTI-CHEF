// MC-070/E22-T66-B — hand-rolled service worker (Serwist deferred post-MVP;
// see decision log). v2: precache the full tab shell (/, /today, /plan,
// /shopping, /fridge) plus a dedicated /offline fallback and PWA icons;
// navigations are network-first with cache->/offline fallback; read-model
// GETs are stale-while-revalidate.
const VERSION = 'v2';
const SHELL_CACHE = `mc-shell-${VERSION}`;
const DATA_CACHE = `mc-data-${VERSION}`;
const SHELL_URLS = [
  '/',
  '/today',
  '/plan',
  '/shopping',
  '/fridge',
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
const SWR_PREFIXES = [
  '/api/v1/meal-plans/active',
  '/api/v1/shopping-lists/active',
  '/api/v1/recipes',
  '/api/v1/images',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => ![SHELL_CACHE, DATA_CACHE].includes(k)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // T66-B: navigations go network-first; when offline fall back to the
  // cached copy of the route, and to /offline when there is none.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(event.request);
          if (res.ok) {
            caches
              .open(SHELL_CACHE)
              .then((cache) => cache.put(event.request, res.clone()))
              .catch(() => undefined);
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(event.request)) ||
            (await cache.match('/offline')) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }
  const isData = SWR_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (isData) {
    // stale-while-revalidate
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});
