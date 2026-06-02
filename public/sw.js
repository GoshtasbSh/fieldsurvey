/* FieldSurvey service worker. Caches tiles + fonts for offline field use;
   always-network for user-scoped APIs. Ported from KeyStone's proven sw.js. */

const VERSION = 'v2';
const TILE_CACHE = `fs-tiles-${VERSION}`;
const APP_CACHE = `fs-app-${VERSION}`;

const TILE_HOSTS = [
  /^https?:\/\/[a-c]?\.?tile\.openstreetmap\.org\//,
  /^https?:\/\/(server|services)\.arcgisonline\.com\//,
  /^https?:\/\/[a-z\d.-]*\.basemaps\.cartocdn\.com\//,
  /^https?:\/\/cartodb-basemaps-[a-d]\.global\.ssl\.fastly\.net\//,
  /^https?:\/\/[a-c]?\.?tile\.opentopomap\.org\//,
];
const FONT_HOST = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const NETWORK_ONLY = [
  /\.supabase\.co\//,
  /^.+\/api\//,
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== TILE_CACHE && k !== APP_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // User-scoped: always go to network. Caching these would leak the
  // previous user's Bearer JWT / guest cookie if the browser is shared.
  if (NETWORK_ONLY.some((rx) => rx.test(url))) {
    return; // pass-through, no respondWith
  }

  // Tile CDNs — cache-first with stale-while-revalidate. Opaque (no-cors)
  // responses are cached too so the offline pre-cache works.
  if (TILE_HOSTS.some((rx) => rx.test(url))) {
    e.respondWith(staleWhileRevalidate(req, TILE_CACHE, 800));
    return;
  }

  // Google Fonts — cache-first.
  if (FONT_HOST.test(url)) {
    e.respondWith(staleWhileRevalidate(req, APP_CACHE, 100));
    return;
  }
});

async function staleWhileRevalidate(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') {
        cache.put(req, res.clone()).then(() => trimCache(cache, maxEntries));
      }
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('sync', (e) => {
  if (e.tag === 'fs-outbox-sync') {
    e.waitUntil(notifyClients('outbox:drain'));
  }
});

async function notifyClients(type) {
  const list = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of list) c.postMessage({ type });
}
