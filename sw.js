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

// [review 27 Nov] A7: a new revision no longer takes over mid-session. The world modules are imported lazily, so a tab
// opened before a deploy that switched to the new files mid-ride mixed module versions ("does not provide an export
// named …" → "Could not start the 3D view"). The new worker installs and waits; the page shows "Update ready" and
// sends 'skipWaiting' when you reload with it (or quietly when no ride is going: js/offline.js watchForUpdate).
// The tabs open when it activates (other tabs, mid-ride) are still served from their own revision's cache, which is
// kept until they're gone (LEGACY_KEY).
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);   // (A8: editing locally, the network first)
const META_CACHE = 'bikefree-meta';
const LEGACY_KEY = new URL('sw-legacy-clients.json', scope).href;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)));
});
self.addEventListener('message', (e) => {
  if (e.data?.type === 'skipWaiting') self.skipWaiting();
});

/** The tabs from before this revision activated, and their revisions' caches: { caches: [names], ids: [client ids] }. */
let legacy;
async function getLegacy() {
  if (legacy === undefined) {
    try { legacy = await (await (await caches.open(META_CACHE)).match(LEGACY_KEY))?.json() || null; } catch { legacy = null; }
  }
  return legacy;
}
async function setLegacy(v) {
  legacy = v;
  const c = await caches.open(META_CACHE);
  if (v) await c.put(LEGACY_KEY, new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }));
  else await c.delete(LEGACY_KEY);
}
/** The open tabs' client ids (the uncontrolled ones too). */
const openTabs = async () => ((await self.clients.matchAll?.({ type: 'window', includeUncontrolled: true })) || []).map((c) => c.id);
/** Once none of the old tabs is open, their revisions' caches go. */
async function pruneLegacy() {
  const old = await getLegacy();
  if (!old) return;
  const open = new Set(await openTabs());
  const ids = old.ids.filter((id) => open.has(id));
  if (ids.length) { if (ids.length < old.ids.length) await setLegacy({ ...old, ids }); return; }
  for (const key of old.caches) await caches.delete(key);
  await setLegacy(null);
}
/** An old tab's request: from its own revision's cache first (the files it started with), else the network. */
async function legacyResponse(request, old) {
  for (const name of old.caches) {
    const hit = await (await caches.open(name)).match(request, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // [review 27 Nov] A7: older revisions' caches stay while a tab from before this activation is open
    const prev = (await caches.keys()).filter((key) => key.startsWith('bikefree-app-') && key !== APP_CACHE);
    const tabs = await openTabs();
    const old = await getLegacy();
    const keepCaches = [...new Set([...prev, ...(old?.caches || [])])].filter((k) => k !== APP_CACHE);
    if (tabs.length && keepCaches.length) await setLegacy({ caches: keepCaches, ids: [...new Set([...tabs, ...(old?.ids || [])])] });
    else { for (const key of prev) await caches.delete(key); await setLegacy(null); }
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
  if (e.request.mode === 'navigate') e.waitUntil?.(pruneLegacy().catch(() => {}));   // (a tab opened or reloaded)

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

  // The app itself. [review 27 Nov] A8: cache first from this revision's cache (it was network first with no timeout:
  // a slow start on weak Wi-Fi with everything cached). The revision's cache is its own files, precached at install:
  // a deploy is a new sw-assets.js, so a new worker and cache, and the "Update ready" prompt (A7), not a refresh.
  // A7: a tab from before this revision activated keeps its own revision's files. Locally (DEV): network first.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const old = e.clientId && !DEV ? await getLegacy() : null;
      if (old?.ids.includes(e.clientId)) {
        const hit = await legacyResponse(e.request, old);
        if (hit) return hit;
      }
      const c = await caches.open(APP_CACHE);
      if (!DEV) {
        const hit = await c.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
      }
      try {
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone()).catch(() => {});
        return res;
      } catch {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        throw new Error('offline');
      }
    })());
  }
});
