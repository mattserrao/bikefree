#!/usr/bin/env node
// Load before you ride (PLAN phase 8, L7): open the app in headless Chrome, turn on Demo (the rider pedals at once),
// press Start on a route and check that the clock can't start before the route's start is ready — the loading screen
// is up, session.running stays false and no time or distance is counted — then that the first pedal stroke after
// it starts the clock. Times how long the loading screen is up (and each step of world.readiness()).
//
//   node tools/load_screen_check.mjs                          (route28, Three Rivers Loop, Stadiums Loop)
//   node tools/load_screen_check.mjs route28 "Stadiums Loop"  (a park route's catalog id, or a Pittsburgh preset's name)
//   node tools/load_screen_check.mjs --draw --phone           (draw behind the screen; a phone-sized window)
//   node tools/load_screen_check.mjs --cancel                 (also: Cancel goes back to the menu, no ride)
//   node tools/load_screen_check.mjs --hold                   (also, once riding: the world says it is waiting for the
//                                                              streets ahead for 3 s — time and distance must hold, then go on)
//
// Without --draw the 3D view isn't drawn (a software GPU takes seconds a frame): the timings are the CPU's build
// only — check the real ones on the Mac and the phone. Exits 1 if the clock started early or the screen never closed.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, findChrome } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const draw = flag('--draw'), phone = flag('--phone'), cancel = flag('--cancel'), hold = flag('--hold');
const outFile = opt('--json', null), limitS = Number(opt('--limit', '600'));
const chrome = opt('--chrome', findChrome());
const cases = args.length ? args : ['route28', 'Three Rivers Loop', 'Stadiums Loop'];

const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const viewport = phone ? { width: 844, height: 390 } : { width: 1280, height: 720 };

async function run(name) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push((e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t); else if (/Start ready|Loading screen|Ride anyway|clock runs on/.test(t)) logs.push(t); });
  await page.goto(`${base}/index.html`);
  await page.click('.ride-tab[data-mode="route"]');
  const park = !/ /.test(name);
  if (park) {
    const card = `#routeCards .rcard[data-id="builtin-park-${name}"]`;
    await page.waitForSelector(card);
    await page.click(card);
    await page.click('#demoBtn');
  } else {
    await page.waitForSelector('.city-card');
    await page.click('#demoBtn');
    await page.click('.city-card');
    await page.waitForSelector('#cityDlg[open]');
    const row = page.locator('.city-row-btn', { has: page.locator('.cr-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
    await row.first().click();
  }
  // (no drawing: on a software GPU a frame takes seconds; the build still runs on the frames)
  if (!draw) await page.evaluate(() => {
    const iv = setInterval(() => { const w = window.bikefree?.world; if (w && !w.__noDraw) { w.__noDraw = true; w._render = () => { w.perf?.end(performance.now()); }; } }, 20);
    window.__noDrawTimer = iv;
  });
  // sample the screen and the clock every 100 ms from the moment Start is pressed
  await page.evaluate(() => {
    const S = (window.__load = { samples: [], t0: performance.now() });
    const $ = (id) => document.getElementById(id);
    S.timer = setInterval(() => {
      const { session, world } = window.bikefree;
      const r = world?.readiness?.();
      S.samples.push({ t: Math.round(performance.now() - S.t0), screen: !$('loadScreen').hidden, running: session.running, movingS: session.movingS,
        dist: session.distanceM, held: session.held, ready: r?.ready ?? null, progress: r ? Math.round(r.progress * 100) : null,
        steps: r ? r.steps.filter((x) => !x.done).map((x) => x.key).join(',') : '', anyway: !$('loadAnyway').hidden, what: $('loadWhat').textContent });
    }, 100);
  });
  const t0 = Date.now();
  if (park) await page.click('#startBtn');
  else await page.locator('#cityList [data-ride]').first().click();
  await page.waitForFunction(() => !document.getElementById('loadScreen').hidden || window.__load.samples.length > 3, null, { timeout: 30000 });
  let cancelled = null;
  if (cancel) {
    await page.waitForTimeout(1500);
    const hit = await page.evaluate(() => { const b = document.getElementById('loadCancel').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { box: [b.x, b.y, b.width, b.height], at: e?.id || e?.className, screen: !document.getElementById('loadScreen').hidden }; });
    if (process.env.DEBUG) console.error('cancel button', hit);
    // (as a rider would: a click at the button; how long the page takes to answer it is the input delay while loading)
    const tc = Date.now();
    await page.mouse.click(hit.box[0] + hit.box[2] / 2, hit.box[1] + hit.box[3] / 2);
    await page.waitForFunction(() => document.getElementById('loadScreen').hidden, null, { timeout: 60000, polling: 50 });
    var cancelMs = Date.now() - tc;
    await page.waitForTimeout(800);
    cancelled = await page.evaluate(() => ({ menu: !document.getElementById('setup').hidden, ride: !document.getElementById('rideScreen').hidden,
      running: window.bikefree.session.running, movingS: window.bikefree.session.movingS }));
    cancelled.ms = cancelMs;
  } else {
    // ready → the screen closes; then the demo rider's next pedal stroke starts the clock
    await page.waitForFunction(() => document.getElementById('loadScreen').hidden && window.bikefree.session.running, null, { timeout: limitS * 1000, polling: 200 });
    await page.waitForTimeout(1500);
  }
  let held = null;
  if (hold && !cancel) {
    held = await page.evaluate(async () => {
      const { session, world } = window.bikefree, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      let on = true;
      Object.defineProperty(world, 'waitingForArea', { configurable: true, get: () => on });
      await wait(600);
      const a = { t: session.movingS, d: session.distanceM, held: session.held, running: session.running };
      await wait(3000);
      const b = { t: session.movingS, d: session.distanceM, held: session.held, overlay: !document.getElementById('pauseOverlay').hidden };
      on = false;
      await wait(1500);
      const c = { t: session.movingS, d: session.distanceM, held: session.held, running: session.running };
      delete world.waitingForArea;
      return { a, b, c, ok: a.held && !a.running && b.t === a.t && b.d === a.d && !b.overlay && !c.held && c.running && c.d > b.d };
    });
  }
  const S = await page.evaluate(() => { clearInterval(window.__load.timer); return window.__load.samples; });
  await context.close();
  // what the samples say
  const shown = S.filter((s) => s.screen);
  const early = shown.filter((s) => (s.running || s.movingS > 0 || s.dist > 0) && !s.anyway);
  const closeAt = S.find((s, i) => i > 0 && !s.screen && S[i - 1].screen)?.t ?? null;
  const startAt = S.find((s) => s.running)?.t ?? null;
  // when each step of world.readiness() was first seen done (behind the screen; before the world opened it reads as not started)
  const stepsDone = {};
  for (const k of ['scenery', 'ground', 'streets', 'light', 'riders']) {
    const hit = shown.find((s) => s.progress != null && !s.steps.split(',').includes(k));
    if (hit) stepsDone[k] = hit.t;
  }
  return { name, held, ok: !early.length && !errors.length && (!held || held.ok) && (cancel ? cancelled.menu && !cancelled.running : closeAt != null && startAt != null && startAt >= closeAt),
    screenS: closeAt != null ? +(closeAt / 1000).toFixed(1) : null, clockStartS: startAt != null ? +(startAt / 1000).toFixed(1) : null,
    stepsDoneS: Object.fromEntries(Object.entries(stepsDone).map(([k, t]) => [k, +(t / 1000).toFixed(1)])),
    early: early.slice(0, 3), samples: process.env.SAMPLES ? S : undefined, anyway: shown.some((s) => s.anyway), cancelled, wallS: Math.round((Date.now() - t0) / 1000), errors: errors.slice(0, 5), logs };
}

const results = [];
for (const c of cases) {
  console.error(`— ${c}…`);
  const r = await run(c).catch((err) => ({ name: c, ok: false, errors: [err.message.split('\n')[0]] }));
  results.push(r);
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${c}: ${r.cancelled ? `cancel → menu ${r.cancelled.menu}, running ${r.cancelled.running}, answered in ${r.cancelled.ms} ms` : `screen ${r.screenS ?? '—'} s, clock from ${r.clockStartS ?? '—'} s`}` +
    `${r.stepsDoneS ? ` · steps done at ${Object.entries(r.stepsDoneS).map(([k, t]) => `${k} ${t}`).join(', ')}` : ''}${r.anyway ? ' · Ride anyway offered' : ''}` +
    `${r.held ? ` · mid-ride hold ${r.held.ok ? 'held and resumed' : `WRONG ${JSON.stringify(r.held)}`}` : ''}` +
    `${r.early?.length ? ` · CLOCK EARLY: ${JSON.stringify(r.early[0])}` : ''}${r.errors?.length ? ` · errors: ${r.errors.join(' / ')}` : ''}`);
}
if (outFile) await writeFile(outFile, JSON.stringify({ draw, phone, results }, null, 1));
await browser.close();
server.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
