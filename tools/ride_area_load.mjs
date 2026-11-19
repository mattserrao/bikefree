#!/usr/bin/env node
// Area loading on the ride (PLAN F30): ride a free ride (no plan) in headless Chrome across a portal into an area
// that wasn't built at the start, in real time at a steady speed, and record what building it costs the frames.
//
//   node tools/ride_area_load.mjs                       (pittsburgh, free ride e2+ from 2000 m to 4500 m at 10 m/s)
//   node tools/ride_area_load.mjs --free e2+ --from 2000 --to 4500 --speed 10 --out /tmp/area-load.json
//
// The world opens at --from (the areas within 1.5 km built behind the loader, as the app does), settles, then
// rides at --speed m/s on the page's own animation frames. Recorded: every frame's interval (requestAnimationFrame),
// long tasks (PerformanceObserver), the main-thread time the world spent on area building (world.areaWork: per
// area and step, its longest slice), when each area was ready and drawn (swap), frames under the fade (an area
// not ready at its swap), and the JS heap. Prints a summary (and the longest frames with what ran in them).
// Options: --park pittsburgh, --quality low|balanced|high, --size WxH (960x540), --draw (draw the view: on a
// software GPU a frame takes 100s of ms and hides the rest; default: everything but the draw), --chrome <path>,
// --profile <file.cpuprofile> (a CPU profile of the ride, for chrome://inspect / speedscope).
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const park = opt('--park', 'pittsburgh'), free = opt('--free', 'e2+');
const from = Number(opt('--from', '2000')), to = Number(opt('--to', '4500')), speed = Number(opt('--speed', '10'));
const quality = opt('--quality', 'balanced'), outFile = opt('--out', null), profile = opt('--profile', null);
const [width, height] = opt('--size', '960x540').split('x').map(Number);
const draw = flag('--draw');
const trace = flag('--trace');
const gapsOpt = flag('--gaps');   // (debug: with a jobs.js that records gaps between pause points — see the F30 notes)   // list the slow calls (> 25 ms) of the build's and streaming's main methods
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.gpx': 'application/gpx+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.gz': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path || 'index.html')); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
const page = await context.newPage();
if (gapsOpt) await page.addInitScript(() => { window.__gapDebug = true; });
page.setDefaultTimeout(0);
const errors = [], logs = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t); else if (/Area |Drawing area|Released area/.test(t)) logs.push(t); });
const q = new URLSearchParams({ park, clean: '1', quality, pos: String(from), free, horizon: '0' });
const t0 = Date.now();
await page.goto(`${base}/tools/world-preview.html?${q}`);
await page.waitForFunction(() => window.world?.terrain?.kit && window.world._camInit && window.world.rider?.triangles, null, { timeout: 300000, polling: 500 });
// the areas within reach at the start are built (as behind the app's loader), then a few quiet seconds
await page.waitForFunction(() => { const w = window.world; return !w._multi || (w._resT != null && [...w.areas.values()].every((a) => a.ready) && !w.baked?.preparing); }, null, { timeout: 300000, polling: 500 });
await page.waitForTimeout(3000);
const startAreas = await page.evaluate(() => [...window.world.areas.keys()]);
console.error(`opened at ${from} m in ${((Date.now() - t0) / 1000).toFixed(0)} s, areas built: ${startAreas.join(', ')}`);
let cdp = null;
if (profile) { cdp = await context.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
if (trace) await page.evaluate(async () => {
  const slow = (window.__slow = []);
  const wrap = (proto, names, tag) => { for (const n of names) { const f = proto[n]; if (!f) continue; proto[n] = function (...a) { const t = performance.now(); const r = f.apply(this, a); const ms = performance.now() - t; if (ms > 25) slow.push({ at: Math.round(t), fn: `${tag}.${n}`, ms: Math.round(ms), area: this.route?.name || this.city?.route?.name }); return r; }; } };
  const ST = (await import('/js/world/stylized-terrain.js')).StylizedTerrain, CS = (await import('/js/world/toolbox/city/city.js')).CityScene;
  const P = await import('/js/world/toolbox/core/pools.js');
  wrap(ST.prototype, ['_plan', '_build', 'prepare', 'update', 'tick'], 'terrain');
  wrap(CS.prototype, ['_stream', '_buildChunk', 'tick'], 'city');
  wrap(P.GroundBlocks.prototype, ['set'], 'groundBlocks'); wrap(P.InstancePool.prototype, ['set'], 'pool');
  const W = window.world; wrap(Object.getPrototypeOf(W), ['_areaTick', '_useArea', '_releaseArea'], 'world');
});
const run = await page.evaluate(async ({ from, to, speed, draw }) => {
  const w = window.world;
  if (!draw) w._render = () => { w.perf?.end(performance.now()); };
  w.areaWork = {};   // (the start's building isn't the ride's)
  const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
  const long = [];
  const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); });
  try { obs.observe({ type: 'longtask', buffered: false }); } catch { /* no long tasks API */ }
  let pos = from, last = performance.now();
  const t0 = performance.now();
  w.setSource(() => { const now = performance.now(); pos += speed * (now - last) / 1000; last = now; return { pos, speed, cadence: 84, riding: true }; });
  w.p = from; w.s = w.path.worldAt(from, w.area.id).s;
  const frames = [], events = [];
  const workNow = () => { let n = 0; for (const a of Object.values(w.areaWork || {})) n += a.ms; return n; };
  let work0 = workNow();
  let prev = performance.now(), area = w.area.id, have = new Set([...w.areas.keys()].filter((id) => w.areas.get(id).ready));
  const heaps = [{ p: Math.round(pos), mb: heap() }];
  await new Promise((done) => {
    const tick = (now) => {
      const t = performance.now();
      const wk = workNow();
      frames.push({ at: Math.round(t - t0), p: Math.round(w.p), ms: Math.round((t - prev) * 10) / 10, work: Math.round((wk - work0) * 10) / 10, fade: !!w._waitingArea });
      work0 = wk;
      prev = t;
      if (w.area.id !== area) { events.push({ at: Math.round(t - t0), p: Math.round(w.p), swap: `${area}→${w.area.id}` }); area = w.area.id; }
      for (const [id, a] of w.areas) {
        if (!have.has(id) && a.ready) { have.add(id); events.push({ at: Math.round(t - t0), p: Math.round(w.p), ready: id, ms: a.ms, buildMs: a.buildMs }); }
      }
      for (const id of [...have]) if (!w.areas.has(id)) { have.delete(id); events.push({ at: Math.round(t - t0), p: Math.round(w.p), released: id }); }
      for (const id of w.areas.keys()) if (!have.has(id) && !events.some((e) => e.start === id)) events.push({ at: Math.round(t - t0), p: Math.round(w.p), start: id });
      if (frames.length % 120 === 0) { heaps.push({ p: Math.round(w.p), mb: heap() }); console.log(`progress ${Math.round(w.p)} m · areas ${[...w.areas.keys()].join(',')}`); }
      if (w.p >= to) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  obs.disconnect();
  heaps.push({ p: Math.round(w.p), mb: heap() });
  const gaps = window.__gapDebug ? (await import('/js/world/toolbox/core/jobs.js')).gaps?.sort((a, b) => b.ms - a.ms).slice(0, 25) : null;
  return { gaps, frames, events, long, heaps, work: w.areaWork, rel: Math.round(t0), slow: (window.__slow || []).filter((x) => x.at >= t0).map((x) => ({ ...x, at: x.at - Math.round(t0) })) };
}, { from, to, speed, draw });
if (cdp) { const { profile: prof } = await cdp.send('Profiler.stop'); await writeFile(profile, JSON.stringify(prof)); }
await browser.close(); server.close();

const r1 = (v) => Math.round(v * 10) / 10;
const ride = run.frames.slice(1);
const sorted = [...ride].sort((a, b) => b.ms - a.ms);
const pct = (p) => { const s = ride.map((f) => f.ms).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const work = Object.fromEntries(Object.entries(run.work).map(([id, a]) => [id, { ms: Math.round(a.ms), slices: a.slices, maxSliceMs: r1(a.maxMs),
  steps: Object.fromEntries(Object.entries(a.steps).map(([k, s]) => [k, { ms: Math.round(s.ms), n: s.n, maxMs: r1(s.maxMs) }])) }]));
const summary = {
  park, free, from, to, speed, draw, startAreas,
  frames: ride.length, medianMs: pct(.5), p99Ms: pct(.99), worstMs: sorted[0]?.ms,
  over50: ride.filter((f) => f.ms > 50).length, over33: ride.filter((f) => f.ms > 33.4).length, fadeFrames: ride.filter((f) => f.fade).length,
  longest: sorted.slice(0, 8).map((f) => `${f.ms} ms @ ${f.p} m (area work ${f.work} ms)`),
  // frames the area building is in: the area work they carried, and how long they took
  areaFrames: (() => { const wf = ride.filter((f) => f.work > 0), ws = wf.map((f) => f.work).sort((a, b) => b - a);
    return { frames: wf.length, maxWorkMs: ws[0] || 0, p99WorkMs: ws[Math.floor(ws.length / 100)] || 0, workOver16: wf.filter((f) => f.work > 16).length, workOver33: wf.filter((f) => f.work > 33).length, workOver50: wf.filter((f) => f.work > 50).length,
      worstFrameWithWork: Math.max(0, ...wf.map((f) => f.ms)), over50WithWork: wf.filter((f) => f.ms > 50).length }; })(),
  longTasks: { count: run.long.length, worstMs: Math.max(0, ...run.long.map((l) => l.ms)), totalMs: run.long.reduce((a, l) => a + l.ms, 0) },
  areaWork: work, areaWorkMs: Object.values(work).reduce((a, w) => a + w.ms, 0),
  events: run.events, heapMB: { start: run.heaps[0].mb, max: Math.max(...run.heaps.map((h) => h.mb)), end: run.heaps.at(-1).mb }, errors,
  ...(trace ? { slow: run.slow } : {}), ...(run.gaps ? { gaps: run.gaps } : {}),
};
console.log(JSON.stringify(summary, null, 1));
if (outFile) await writeFile(outFile, JSON.stringify({ summary, frames: run.frames, long: run.long, logs }, null, 1));
