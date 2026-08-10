/* End of the Road 2026 — service worker
 * Bump CACHE_VERSION whenever the app or the festival data changes so clients
 * download fresh copies.
 */
const CACHE_VERSION = 'eotr2026-v1.5.0';
const APP_CACHE = `app-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
// The page downloads all clips into this cache with progress UI, so offline
// works once the visible download has finished. Do NOT precache clips here in
// install — 114 MB of audio in install stalls activation and fails silently.
const CLIPS_CACHE = 'eotr2026-clips';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './fonts/fonts.css',
  './fonts/Fraunces-500.woff2',
  './fonts/Fraunces-600.woff2',
  './fonts/Fraunces-700.woff2',
  './fonts/Fraunces-italic500.woff2',
  './fonts/Inter-400.woff2',
  './fonts/Inter-500.woff2',
  './fonts/Inter-600.woff2',
  './fonts/Inter-700.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
  './data/meta.json',
  './data/acts.json',
  './data/artists.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = (await cache.match(request)) || (await caches.match(fallbackUrl || './index.html'));
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (url.origin === self.location.origin) {
    // Bundled preview clips may live in the page's offline cache.
    if (/\.mp3$/i.test(url.pathname)) {
      event.respondWith(
        (async () => {
          const clips = await caches.open(CLIPS_CACHE);
          const hit = await clips.match(request);
          if (hit) return hit;
          return cacheFirst(request);
        })()
      );
      return;
    }
    event.respondWith(cacheFirst(request));
    return;
  }

  // Images + audio previews from external CDNs: cache for offline.
  if (/\.(png|jpe?g|webp|avif|gif|svg|m4a|mp3|mp4|webm|aac)(\?|$)/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
