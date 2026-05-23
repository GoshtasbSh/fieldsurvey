/* FieldSurvey service worker. Caches OSM tiles + app shell for offline
   field use. Ported from keystone_field_web/sw.js patterns. */

const VERSION = 'v1';
const TILE_CACHE = `fs-tiles-${VERSION}`;
const APP_CACHE = `fs-app-${VERSION}`;
const TILE_HOST = /^https?:\/\/tile\.openstreetmap\.org\//;
const FONT_HOST = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== TILE_CACHE && k !== APP_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // OSM tiles: cache-first with background revalidate (stale-while-revalidate)
  if (TILE_HOST.test(url)) {
    e.respondWith(staleWhileRevalidate(req, TILE_CACHE, 500));
    return;
  }
  // Google Fonts: cache-first
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
      if (res.ok) {
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

// Hook the periodic-sync API where available — replays the outbox by
// posting a message to the active client which calls drainOutbox().
self.addEventListener('sync', (e) => {
  if (e.tag === 'fs-outbox-sync') {
    e.waitUntil(notifyClients('outbox:drain'));
  }
});

async function notifyClients(type) {
  const list = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of list) c.postMessage({ type });
}
