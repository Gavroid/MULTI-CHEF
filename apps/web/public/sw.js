// MC-070 — hand-rolled service worker (Serwist deferred post-MVP; see
// decision log). Precache the app shell, stale-while-revalidate the
// read-model GETs the PWA needs offline (plan / shopping list /
// recipes), network-first for everything else.
const VERSION = 'v1';
const SHELL_CACHE = `mc-shell-${VERSION}`;
const DATA_CACHE = `mc-data-${VERSION}`;
const SHELL_URLS = ['/', '/today', '/manifest.webmanifest', '/icons/icon.svg'];
const SWR_PREFIXES = [
  '/api/v1/meal-plans/active',
  '/api/v1/shopping-lists/active',
  '/api/v1/recipes',
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
