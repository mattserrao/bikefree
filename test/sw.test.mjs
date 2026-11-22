// The service worker keeps route data across deploys (code review, Nov 2026): data files are cached by their own
// content hash (sw-assets.js BIKEFREE_DATA_FILES), so a new app revision keeps every file whose content is the same
// and drops only the ones that changed. Runs sw.js in a sandbox with in-memory caches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://example.github.io';
const SCOPE = `${ORIGIN}/bikefree/`;

function makeCaches(store = new Map()) {
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    const key = (r) => (typeof r === 'string' ? r : r.url);
    return {
      match: async (r) => m.get(key(r)) || m.get(key(r).split('?')[0]),
      put: async (r, res) => { m.set(key(r), res); },
      delete: async (r) => m.delete(key(r)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      addAll: async () => {},
    };
  };
  return { store, api: { open, keys: async () => [...store.keys()], delete: async (n) => store.delete(n), match: async () => undefined } };
}

/** Load sw.js with these data hashes; returns { fetchUrl, activate, fetched } over the shared caches. */
function loadSW(dataFiles, revision, caches) {
  const listeners = {};
  const fetched = [];
  const self = {
    BIKEFREE_APP_REVISION: revision, BIKEFREE_APP_FILES: [], BIKEFREE_DATA_FILES: dataFiles,
    location: new URL(`${SCOPE}sw.js`), registration: { scope: SCOPE },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {}, clients: { claim: async () => {} },
  };
  const fetch = async (req) => { fetched.push(req.url); return { ok: true, status: 200, body: `${req.url}@${revision}`, clone() { return this; } }; };
  vm.runInNewContext(SW, { self, caches: caches.api, fetch, URL, Math, console, importScripts: () => {}, decodeURIComponent, Set, Promise });
  const fetchUrl = async (path) => {
    let p;
    listeners.fetch({ request: { url: `${SCOPE}${path}`, method: 'GET' }, respondWith: (x) => { p = x; } });
    return p;
  };
  const activate = async () => { let p; listeners.activate({ waitUntil: (x) => { p = x; } }); await p; };
  return { fetchUrl, activate, fetched };
}

test('a data file is fetched once, then served from the data cache', async () => {
  const caches = makeCaches();
  const sw = loadSW({ 'routes/scenes/zion.json': 'aaa' }, 'r1', caches);
  await sw.activate();
  await sw.fetchUrl('routes/scenes/zion.json');
  await sw.fetchUrl('routes/scenes/zion.json');
  assert.equal(sw.fetched.length, 1);
});

test('a new deploy keeps unchanged data and refetches only what changed', async () => {
  const caches = makeCaches();
  const v1 = loadSW({ 'routes/scenes/zion.json': 'aaa', 'routes/cities/pgh.json': 'bbb' }, 'r1', caches);
  await v1.activate();
  await v1.fetchUrl('routes/scenes/zion.json');
  await v1.fetchUrl('routes/cities/pgh.json');
  // deploy: new app revision; zion unchanged, pgh rebuilt
  const v2 = loadSW({ 'routes/scenes/zion.json': 'aaa', 'routes/cities/pgh.json': 'ccc' }, 'r2', caches);
  await v2.activate();
  const keys = [...caches.store.get('bikefree-data-v1').keys()];
  assert.deepEqual(keys, [`${SCOPE}routes/scenes/zion.json?h=aaa`], 'the stale pgh copy is dropped on activate');
  await v2.fetchUrl('routes/scenes/zion.json');
  await v2.fetchUrl('routes/cities/pgh.json');
  assert.deepEqual(v2.fetched, [`${SCOPE}routes/cities/pgh.json`]);
});

test('sw-assets.js lists the catalog\'s scenes and the city graphs with hashes', () => {
  const ctx = { self: {} };
  vm.runInNewContext(readFileSync(new URL('../sw-assets.js', import.meta.url), 'utf8'), ctx);
  const data = ctx.self.BIKEFREE_DATA_FILES;
  for (const p of ['routes/scenes/bigsur.json', 'routes/cities/pgh.json', 'routes/cities/skan.json', 'models/rider.json']) {
    assert.match(data[p] || '', /^[0-9a-f]{10}$/, p);
  }
  assert.ok(!ctx.self.BIKEFREE_APP_FILES.includes('routes/cities/pgh.json'), 'big data is not precached');
});
