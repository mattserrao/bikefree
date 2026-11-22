// bikefree service worker: keeps the app and downloaded park tiles available offline.
importScripts('./sw-assets.js');
const APP_CACHE = `bikefree-app-${self.BIKEFREE_APP_REVISION}`;
const TILE_CACHE = 'bikefree-tiles-v1';
// Route pictures (PLAN 6.8, routes/previews/*.webp?v=<hash>): not precached (~200 files, a few MB); each is kept the
// first time the menu shows it, in a cache that survives app updates (the page prunes ones no longer listed)
const PREVIEW_CACHE = 'bikefree-previews-v1';
const TILE_HOSTS = ['s3.amazonaws.com', 'basemap.nationalmap.gov'];
const MAX_TILES = 40000;

const APP_FILES = self.BIKEFREE_APP_FILES;
// Route data and models by content (sw-assets.js): a file is kept until its own content changes, not until the next
// deploy. Its cache key is the path plus its hash; activate drops the keys no longer listed.
const DATA_CACHE = 'bikefree-data-v1';
const DATA_FILES = self.BIKEFREE_DATA_FILES || {};
const scope = new URL(self.registration?.scope || self.location.href);
const dataPath = (url) => (url.origin === self.location.origin && url.pathname.startsWith(scope.pathname) ? decodeURIComponent(url.pathname.slice(scope.pathname.length)) : null);
const dataKey = (path) => new URL(`${path}?h=${DATA_FILES[path]}`, scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('bikefree-app-') && key !== APP_CACHE) await caches.delete(key);
    }
    // data files whose content changed (or that are gone): their old copies go
    const data = await caches.open(DATA_CACHE);
    const keep = new Set(Object.keys(DATA_FILES).map(dataKey));
    for (const req of await data.keys()) if (!keep.has(req.url)) await data.delete(req);
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

  if (url.origin === self.location.origin && url.pathname.includes('/routes/previews/') && url.pathname.endsWith('.webp')) {
    e.respondWith((async () => {
      const c = await caches.open(PREVIEW_CACHE);
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    })());
    return;
  }

  // Route data and models listed with a content hash: cache first, kept across deploys while the content is the same
  const path = dataPath(url);
  if (path && DATA_FILES[path]) {
    e.respondWith((async () => {
      const c = await caches.open(DATA_CACHE);
      const key = dataKey(path);
      const hit = await c.match(key);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && res.status === 200) c.put(key, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  // [F391] Other route data and models (not listed): cache first, in this revision's cache
  // (a new build is a new cache, so nothing stale is served); fetched and kept the first time a ride needs them
  if (url.origin === self.location.origin && /\/(routes\/(scenes|parks|cities|presets)|models)\//.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(APP_CACHE);
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && !url.search) c.put(e.request, res.clone()).catch(() => {});
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
