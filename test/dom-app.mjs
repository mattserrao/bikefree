// The app in a DOM, for the tests that drive the page (test/dom-*.test.mjs): index.html loaded into happy-dom, the
// real modules (js/app.js and js/app/) imported on top of it, with fakes for what a browser gives: Web Bluetooth
// (test/trainer-fakes.mjs), IndexedDB (test/idb-fake.mjs), the service worker, fetch (the repo's own files), a canvas
// context that draws nothing, and the 3D worlds (test/fake-world.mjs: no WebGL). Each test file boots one app (ES
// modules are imported once per process; node --test runs each file in its own).
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';
import { fake as idb } from './idb-fake.mjs';
import { fakeTrainer, bikeData, flush } from './trainer-fakes.mjs';

const root = new URL('../', import.meta.url);
const SCOPE = 'https://example.test/bikefree/';

// The 3D worlds → test/fake-world.mjs (they need WebGL; the app imports them only when a ride opens)
const FAKE_WORLD = new URL('fake-world.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    return /\/js\/world\/(world|graph-world|endless-world)\.js$/.test(r.url) ? { ...r, url: FAKE_WORLD, shortCircuit: true } : r;
  },
});

/** A 2D context that draws nothing (happy-dom has no canvas): every method a no-op, measureText a width. */
function nullContext(canvas) {
  const gradient = { addColorStop() {} };
  const fixed = { canvas, measureText: (t) => ({ width: String(t).length * 6 }), createLinearGradient: () => gradient,
    createRadialGradient: () => gradient, createPattern: () => null, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    isPointInPath: () => false, getLineDash: () => [] };
  return new Proxy(fixed, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
}

/** The repo's files over fetch (relative to the page, or file: URLs from import.meta.url); `files` overrides by path. */
function makeFetch(files, fetched) {
  return async (input) => {
    const url = new URL(String(input?.url ?? input), SCOPE);   // (a string, a URL or a Request)
    const path = url.protocol === 'file:' ? url.pathname.slice(new URL(root).pathname.length) : url.pathname.replace(/^\/bikefree\//, '');
    fetched.push(path);
    if (path in files) {
      const v = typeof files[path] === 'function' ? files[path](path) : files[path];
      if (v instanceof Response) return v;
      if (v == null) return new Response('not found', { status: 404 });
      return new Response(typeof v === 'string' ? v : JSON.stringify(v), { status: 200 });
    }
    try {
      return new Response(readFileSync(new URL(path, root)), { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
}

/** A service worker container; `sw.install()`: a new revision installs and waits behind the page's worker (A7). */
function fakeServiceWorker() {
  const waiting = Object.assign(new EventTarget(), { state: 'installed', messages: [], postMessage(m) { this.messages.push(m); } });
  const reg = Object.assign(new EventTarget(), { waiting: null, installing: null });
  const sw = Object.assign(new EventTarget(), {
    controller: { state: 'activated' }, registered: [], reg, waiting,
    /** A new revision finishes installing behind the page's worker. */
    install() { reg.installing = waiting; reg.dispatchEvent(new Event('updatefound')); reg.installing = null; waiting.dispatchEvent(new Event('statechange')); },
  });
  sw.register = async (url, opts) => { sw.registered.push({ url: String(url), opts }); return reg; };
  return sw;
}

/**
 * Boots the app. `files`: fetch overrides by path (e.g. a smaller city list); `confirm`: answers confirm() (default
 * true). Waits for the menu (the selected route in the preview), then returns the page: window, document, $, the
 * IndexedDB fake (idb), the trainer's characteristics (chars), the service worker (sw), the 3D world fake (fakeWorld),
 * window.bikefree (bike), what was logged, any errors, and helpers to pedal, wait and skip the clock.
 */
export async function bootApp({ files = {}, confirm = () => true } = {}) {
  const window = new Window({ url: SCOPE, width: 1280, height: 800,
    settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true, disableCSSFileLoading: true, navigator: { userAgent: 'bikefree-test' } } });
  const document = window.document;
  document.write(readFileSync(new URL('index.html', root), 'utf8'));
  window.HTMLCanvasElement.prototype.getContext = function getContext() { return (this._ctx ??= nullContext(this)); };

  // the clock: performance.now and Date.now run on, plus whatever the test skips ahead (pedal, skip)
  let skipped = 0;
  const realPerf = performance.now.bind(performance), realDate = Date.now;
  performance.now = () => realPerf() + skipped;
  Date.now = () => realDate() + skipped;

  // the page's repeating timers (the ride clock, the recovery copy every 15 s) don't keep the test process alive, and
  // restore() clears the rest (a toast's 7 s, the ride title's 5 s)
  const realSetInterval = globalThis.setInterval, realSetTimeout = globalThis.setTimeout, timers = new Set();
  globalThis.setInterval = (...a) => { const t = realSetInterval(...a); t.unref?.(); return t; };
  globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(() => { timers.delete(t); fn(...a); }, ms); timers.add(t); return t; };

  const { device, chars } = fakeTrainer();
  const sw = fakeServiceWorker();
  const dialogs = { alert: [], confirm: [] };
  const fetched = [];
  const navigator = { userAgent: 'bikefree-test', language: 'en-US', languages: ['en-US'], onLine: true,
    bluetooth: { requestDevice: async () => device }, serviceWorker: sw,
    storage: { persisted: async () => false, persist: async () => true }, clipboard: { writeText: async () => {} } };

  // the page's globals (what a module script sees): the window's, then the fakes
  const g = globalThis;
  const keys = new Set();
  for (let o = window; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) keys.add(k);
  for (const key of keys) {
    if (key in g || key.startsWith('_') || key === 'Worker' || key === 'constructor') continue;
    const v = window[key];
    Object.defineProperty(g, key, { value: typeof v === 'function' && !/^[A-Z]/.test(key) ? v.bind(window) : v, configurable: true, writable: true });
  }
  const own = { window, document, navigator, location: window.location, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    screen: window.screen, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800, matchMedia: window.matchMedia.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16), cancelAnimationFrame: (id) => clearTimeout(id),
    requestIdleCallback: (fn) => setTimeout(fn, 0),
    fetch: makeFetch(files, fetched), indexedDB: g.indexedDB,
    alert: (m) => { dialogs.alert.push(m); }, confirm: (m) => { dialogs.confirm.push(m); return confirm(m); },
    Path2D: class Path2D { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => {}) }); } },
    // (happy-dom has no Option constructor)
    Option: function Option(text = '', value = text) { const o = document.createElement('option'); o.textContent = text; o.value = value; return o; },
    ResizeObserver: window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} } };
  for (const [k, v] of Object.entries(own)) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  Object.defineProperty(window, 'navigator', { value: navigator, configurable: true });
  window.confirm = own.confirm; window.alert = own.alert; window.requestIdleCallback = own.requestIdleCallback;
  window.requestAnimationFrame = own.requestAnimationFrame;
  window.HTMLElement.prototype.requestFullscreen = undefined;

  (0, eval)(readFileSync(new URL('js/theme.js', root), 'utf8'));   // (index.html's classic script in <head>)
  const errors = [];
  const onError = (e) => errors.push(e);
  process.on('unhandledRejection', onError);
  const logged = [];
  const origLog = console.log, origErr = console.error;
  console.log = (...a) => logged.push(a.join(' '));
  console.error = (...a) => { logged.push(a.join(' ')); errors.push(new Error(a.join(' '))); };

  const app = await import('../js/app.js');
  const { fakeWorld } = await import('./fake-world.mjs');
  const $ = (id) => document.getElementById(id);
  const page = {
    window, document, $, app, idb, device, chars, sw, dialogs, fetched, logged, errors, fakeWorld, bike: window.bikefree,
    /** Let promise chains and short timers run. */
    async settle(ms = 0) { await flush(); if (ms) await new Promise((r) => setTimeout(r, ms)); await flush(); },
    /** Waits until `fn()` is truthy (polling), or throws after `ms`. */
    async until(fn, ms = 4000, what = 'the condition') {
      const t0 = realDate();
      while (!fn()) {
        if (realDate() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    /** Pedal for `seconds` of ride time: the trainer notifies every 250 ms (the session's clock steps on its data, A3). */
    async pedal(seconds, data = { kph: 30, rpm: 90, watts: 200 }) {
      for (let i = 0; i < seconds * 4; i++) { skipped += 250; chars.bikeData.notify(bikeData(data)); }
      await flush();
    },
    /** Skips the clock ahead (as a hidden tab's timers do), without the trainer's data. */
    skip(ms) { skipped += ms; },
    bikeData,
    restore() {
      console.log = origLog; console.error = origErr; process.off('unhandledRejection', onError);
      for (const t of timers) clearTimeout(t);
      globalThis.setTimeout = realSetTimeout; globalThis.setInterval = realSetInterval;
    },
  };
  // booted: the route list is in and the selected route is in the preview
  page.loading = await import('../js/app/route-loading.js');
  page.menu = await import('../js/app/routes-menu.js');
  await page.until(() => page.loading.previewRoute && $('pvTitle').textContent === page.loading.previewRoute.name, 10000, 'the selected route\'s preview');
  return page;
}
