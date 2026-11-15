// bikefree service worker: keeps the app and downloaded park tiles available offline.
importScripts('./sw-assets.js');
const APP_CACHE = `bikefree-app-${self.BIKEFREE_APP_REVISION}`;
const TILE_CACHE = 'bikefree-tiles-v1';
const TILE_HOSTS = ['s3.amazonaws.com', 'basemap.nationalmap.gov'];
const MAX_TILES = 40000;

const APP_FILES = self.BIKEFREE_APP_FILES;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('bikefree-app-') && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILE_CACHE);
    const keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]); // oldest first
  } finally { trimming = false; }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Map tiles: cache first (they never change), store what we fetch.
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) { c.put(e.request.url, res.clone()); if (Math.random() < 0.01) trimTiles(); }
      return res;
    })());
    return;
  }

  // The app itself: network first so updates show up, cache when offline.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok) (await caches.open(APP_CACHE)).put(e.request, res.clone());
        return res;
      } catch {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        throw new Error('offline');
      }
    })());
  }
});
