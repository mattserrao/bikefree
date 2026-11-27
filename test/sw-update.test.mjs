// [review 27 Nov] A7 / A8: the service worker's updates and the app's start.
// A7: the new worker used to skipWaiting + clients.claim and delete the old app cache on activate, so a tab opened
// before a deploy imported the new world modules lazily into its old page ("does not provide an export named …").
// Now it waits, the menu offers "Update ready · Reload", and tabs from before it activated keep their own revision's
// files until they're gone. A8: app files were network first with no timeout (slow starts on weak Wi-Fi with
// everything cached): now cache first from the revision's own cache (network first only on localhost).
// Runs sw.js in a sandbox with in-memory caches and fake clients (as test/sw.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { watchForUpdate, applyUpdate } from '../js/offline.js';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://example.github.io';
const SCOPE = `${ORIGIN}/bikefree/`;
const FILES = ['./', 'index.html', 'js/app.js', 'js/world/world.js'];

function makeCaches(store = new Map()) {
  const strip = (u) => u.split('?')[0];
  const key = (r) => (typeof r === 'string' ? r : r.url);
  const copy = (res) => (res instanceof Response ? res.clone() : res);
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      match: async (r, o = {}) => copy(m.get(key(r)) || (o.ignoreSearch ? m.get(strip(key(r))) : undefined)),
      put: async (r, res) => { m.set(key(r), res); },
      delete: async (r) => m.delete(key(r)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      addAll: async (paths) => { for (const p of paths) m.set(new URL(p, SCOPE).href, { ok: true, status: 200, body: `${p}@${name}`, clone() { return this; } }); },
    };
  };
  const match = async (r, o) => { for (const n of store.keys()) { const hit = await (await open(n)).match(r, o); if (hit) return hit; } return undefined; };
  return { store, api: { open, keys: async () => [...store.keys()], delete: async (n) => store.delete(n), match } };
}

/** sw.js of `revision`; `net`: 'ok' | 'down' | 'hang'; `tabs`: the open window clients' ids. */
function loadSW(revision, caches, { tabs = [], host = 'example.github.io' } = {}) {
  const listeners = {};
  const fetched = [];
  const origin = `https://${host}`, scope = `${origin}/bikefree/`;
  const sw = { net: 'ok', skipped: 0, claimed: 0, fetched, tabs };
  const self = {
    BIKEFREE_APP_REVISION: revision, BIKEFREE_APP_FILES: FILES, BIKEFREE_DATA_FILES: {},
    location: new URL(`${scope}sw.js`), registration: { scope },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { sw.skipped++; return Promise.resolve(); },
    clients: { claim: async () => { sw.claimed++; }, matchAll: async () => sw.tabs.map((id) => ({ id })) },
  };
  const fetch = (req) => {
    fetched.push(req.url);
    if (sw.net === 'down') return Promise.reject(new TypeError('Failed to fetch'));
    if (sw.net === 'hang') return new Promise(() => {});
    return Promise.resolve({ ok: true, status: 200, body: `${req.url}@network`, clone() { return this; } });
  };
  vm.runInNewContext(SW, { self, caches: caches.api, fetch, URL, Math, console, importScripts: () => {}, decodeURIComponent, Set, Promise, Response });
  const ev = (extra) => { const waits = []; return { waits, e: { waitUntil: (p) => waits.push(p), ...extra } }; };
  sw.install = async () => { const { e, waits } = ev(); listeners.install(e); await Promise.all(waits); };
  sw.activate = async () => { const { e, waits } = ev(); listeners.activate(e); await Promise.all(waits); };
  sw.message = (data) => listeners.message({ data });
  /** A GET of `path` from client `clientId` ('' for a navigation); resolves to the response (or rejects). */
  sw.get = async (path, clientId = 'tabNew', mode = 'cors') => {
    let p; const { e, waits } = ev({ request: { url: `${scope}${path}`, method: 'GET', mode }, clientId, respondWith: (x) => { p = x; } });
    listeners.fetch(e);
    const res = await p;
    await Promise.all(waits);
    return res;
  };
  return sw;
}
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no response in ${ms} ms`)), ms))]);

test('A7: install precaches but does not skip waiting; the page\'s "skipWaiting" message does', async () => {
  const caches = makeCaches();
  const sw = loadSW('r2', caches);
  await sw.install();
  assert.equal(sw.skipped, 0, 'took over at install');
  assert.ok(caches.store.get('bikefree-app-r2').has(`${SCOPE}js/world/world.js`));
  sw.message({ type: 'other' });
  assert.equal(sw.skipped, 0);
  sw.message({ type: 'skipWaiting' });
  assert.equal(sw.skipped, 1);
});

test('A8: a precached app file is served from the revision\'s cache, not held up by a slow network', async () => {
  const caches = makeCaches();
  const sw = loadSW('r1', caches);
  await sw.install(); await sw.activate();
  sw.net = 'hang';   // weak Wi-Fi: the request never comes back
  const res = await within(sw.get('js/app.js?x=1'), 200);
  assert.equal(res.body, 'js/app.js@bikefree-app-r1');
  assert.equal((await within(sw.get('', '', 'navigate'), 200)).body, './@bikefree-app-r1');
  assert.deepEqual(sw.fetched, []);
  // a file that isn't cached: the network, kept for next time; offline: an error as before
  sw.net = 'ok';
  assert.equal((await sw.get('js/extra.js')).body, `${SCOPE}js/extra.js@network`);
  sw.net = 'down';
  assert.equal((await sw.get('js/extra.js')).body, `${SCOPE}js/extra.js@network`);
  await assert.rejects(sw.get('js/missing.js'), /offline/);
});

test('A8: on localhost (editing the app) app files are still network first', async () => {
  const caches = makeCaches();
  const sw = loadSW('r1', caches, { host: 'localhost' });
  await sw.install(); await sw.activate();
  const res = await sw.get('js/app.js');
  assert.match(res.body, /@network$/);
  sw.net = 'down';
  assert.match((await sw.get('js/app.js')).body, /@network$|@bikefree-app-r1$/);
});

test('A7: tabs open when the new revision activates keep their own revision\'s files until they close', async () => {
  const caches = makeCaches();
  const v1 = loadSW('r1', caches);
  await v1.install(); await v1.activate();
  // deploy: r2 installs and waits; tab A reloads onto it (Reload), tab B is mid-ride
  const v2 = loadSW('r2', caches, { tabs: ['tabA', 'tabB'] });
  await v2.install();
  v2.message({ type: 'skipWaiting' });
  await v2.activate();
  assert.ok(caches.store.has('bikefree-app-r1'), 'the old revision\'s cache was deleted with its tabs still open');
  // tab B's lazy import of the world: its own (r1) file, not r2's
  assert.equal((await v2.get('js/world/world.js', 'tabB')).body, 'js/world/world.js@bikefree-app-r1');
  // the reloaded tab A (a new client): r2
  v2.tabs.splice(0, 1, 'tabA2');
  assert.equal((await v2.get('', '', 'navigate')).body, './@bikefree-app-r2');
  assert.equal((await v2.get('js/world/world.js', 'tabA2')).body, 'js/world/world.js@bikefree-app-r2');
  // the worker restarts (its memory gone): the old tabs are remembered
  const v2b = loadSW('r2', caches, { tabs: ['tabA2', 'tabB'] });
  assert.equal((await v2b.get('js/world/world.js', 'tabB')).body, 'js/world/world.js@bikefree-app-r1');
  // tab B closes: the next page load drops r1
  v2b.tabs.splice(1, 1);
  await v2b.get('', '', 'navigate');
  assert.ok(!caches.store.has('bikefree-app-r1'), 'the old cache outlived its tabs');
  assert.equal((await v2b.get('js/world/world.js', 'tabB')).body, 'js/world/world.js@bikefree-app-r2');
});

test('A7: with no tab open at activation the old revision\'s cache goes at once', async () => {
  const caches = makeCaches();
  const v1 = loadSW('r1', caches);
  await v1.install(); await v1.activate();
  const v2 = loadSW('r2', caches, { tabs: [] });
  await v2.install(); await v2.activate();
  assert.deepEqual([...caches.store.keys()].filter((k) => k.startsWith('bikefree-app-')), ['bikefree-app-r2']);
});

/** A fake ServiceWorkerContainer / registration / worker. */
function fakeSW({ controller = {}, waiting = null } = {}) {
  const container = Object.assign(new EventTarget(), { controller });
  const reg = Object.assign(new EventTarget(), { waiting, installing: null });
  const worker = (state = 'installing') => Object.assign(new EventTarget(), { state, posted: [], postMessage(m) { this.posted.push(m); } });
  return { container, reg, worker };
}

test('A7: the page hears of a waiting worker (already there, or once installed); not on a first install', () => {
  let f = fakeSW();
  const w0 = f.worker('installed');
  f.reg.waiting = w0;
  const got = [];
  watchForUpdate(f.reg, f.container, (w) => got.push(w));
  assert.deepEqual(got, [w0]);
  const w1 = f.worker();
  f.reg.installing = w1;
  f.reg.dispatchEvent(new Event('updatefound'));
  w1.state = 'installed'; w1.dispatchEvent(new Event('statechange'));
  assert.deepEqual(got, [w0, w1]);
  // the first install (no worker runs the page yet): nothing to offer
  f = fakeSW({ controller: null });
  const w2 = f.worker();
  watchForUpdate(f.reg, f.container, (w) => got.push(w));
  f.reg.installing = w2; f.reg.dispatchEvent(new Event('updatefound'));
  w2.state = 'installed'; w2.dispatchEvent(new Event('statechange'));
  assert.equal(got.length, 2);
});

test('A7: Reload tells the waiting worker to take over and reloads when it has; a quiet takeover doesn\'t reload', () => {
  const f = fakeSW();
  const w = f.worker('installed');
  let reloads = 0;
  applyUpdate(w, f.container, () => reloads++);
  assert.deepEqual(w.posted, [{ type: 'skipWaiting' }]);
  assert.equal(reloads, 0, 'reloaded before the new worker took over');
  f.container.dispatchEvent(new Event('controllerchange'));
  f.container.dispatchEvent(new Event('controllerchange'));
  assert.equal(reloads, 1);
  // without reload (the page was hidden, no ride): no reload on the takeover — nor on another tab's
  const g = fakeSW();
  let r2 = 0;
  const w2 = g.worker('installed');
  applyUpdate(w2, g.container, null);
  assert.deepEqual(w2.posted, [{ type: 'skipWaiting' }]);
  g.container.addEventListener('controllerchange', () => r2++);
  g.container.dispatchEvent(new Event('controllerchange'));
  assert.equal(r2, 1);   // (only our own counter: applyUpdate added no reload)
});

test('A7: the menu\'s Update ready prompt waits for a ride in progress; hidden with no ride, it takes over quietly', () => {
  const src = readFileSync(new URL('../js/app/offline-ui.js', import.meta.url), 'utf8');
  const i = src.indexOf('function updatePrompt(');
  const updatePrompt = new Function(`${src.slice(i, src.indexOf('\n}\n', i) + 2)}; return updatePrompt;`)();
  const el = () => Object.assign(new EventTarget(), { hidden: true, textContent: '', disabled: false });
  const bar = el(), text = el(), btn = el();
  const session = { hasRide: true };
  const applied = [];
  const p = updatePrompt(bar, text, btn, session, (w, reload) => applied.push([w, reload]), 'RELOAD');
  assert.ok(bar.hidden);
  p.ready('W');
  assert.ok(!bar.hidden);
  assert.match(text.textContent, /after this ride/);
  assert.ok(btn.disabled);
  btn.dispatchEvent(new Event('click'));
  p.hidden();
  assert.deepEqual(applied, [], 'took over during a ride');
  session.hasRide = false; p.render();
  assert.equal(text.textContent, 'Update ready');
  assert.ok(!btn.disabled);
  btn.dispatchEvent(new Event('click'));
  btn.dispatchEvent(new Event('click'));
  assert.deepEqual(applied, [['W', 'RELOAD']]);
  // another prompt: the page hidden with no ride → quietly, no reload
  const q = updatePrompt(el(), el(), el(), { hasRide: false }, (w, reload) => applied.push([w, reload]), 'RELOAD');
  q.hidden();
  assert.equal(applied.length, 1, 'nothing waiting: nothing applied');
  q.ready('W2'); q.hidden();
  assert.deepEqual(applied[1], ['W2', null]);
  // and the app wires it: registerServiceWorker(log, onUpdateReady), hidden on visibilitychange
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /registerServiceWorker\(log, onUpdateReady\)/);
  assert.match(src, /visibilitychange', \(\) => \{ if \(document\.hidden\) update\.hidden\(\); \}/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['updateBar', 'updateText', 'updateBtn']) assert.match(html, new RegExp(`id="${id}"`));
});
