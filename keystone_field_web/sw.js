const CACHE_NAME = 'ks-field-v2';
const SHELL = [
  './index.html',
  './login.html',
  './admin.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always network-first for Supabase API calls
  if (url.includes('supabase.co') || url.includes('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache-first for fonts and map tiles
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com') ||
      url.includes('openstreetmap.org') || url.includes('cartocdn.com') ||
      url.includes('arcgisonline.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          // Tile servers don't send CORS headers, so the offline-map
          // pre-cacher fetches them with mode:'no-cors' which yields
          // opaque responses (res.ok === false, status === 0). Cache
          // those too — `caches.put` accepts opaque responses, the
          // browser just won't let JS read the body. That's fine: the
          // map renders them as <img> elements.
          if (res.ok || res.type === 'opaque') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Cache-first for app shell (CDN scripts, app pages)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
