#!/usr/bin/env node
// Headless ride frame times: ride a stretch of a route in headless Chrome, a frame at a time, and record
// what each frame costs (the whole frame, and the baked-lighting work in it), from the moment the world
// opens. The GPU is synced (gl.finish) around the frame and around the bake's share of it, so the times
// include the GPU work, not just the JavaScript.
//
//   node tools/ride_frames.mjs pittsburgh 0-3000 8000-10000
//   node tools/ride_frames.mjs --mpf 1.5 --dt 0.1 --size 960x540 --out /tmp/ride.json pittsburgh 0-3000
//
// A stretch is  <from>-<to>  in metres. The rider waits at <from> while the world loads (and, on a scene
// with baked lighting, while it prepares behind the loader), then rides at --mpf metres per frame
// (default 1.5) with --dt seconds of ride time per frame (default 0.1).
// Prints, per stretch: the load (time, frames, worst frame) and the ride (frames, median / p95 / worst
// frame, frames over 25 ms, and the bake's ms per frame: frames with bake work, worst, p95, total).
// Options: --quality low|balanced|high, --size WxH (default 960x540), --chrome <path>, --out <file.json>,
// --time golden|… (default: the scene's), --cam chase|…, --rebake <m,m,…> (force a re-bake there, as a
// streamed chunk changing the static set would)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = opt('--quality', 'balanced');
const [width, height] = opt('--size', '960x540').split('x').map(Number);
const mpf = Number(opt('--mpf', '1.5')), dtRide = Number(opt('--dt', '0.1'));
const outFile = opt('--out', null);
const time = opt('--time', null), cam = opt('--cam', null);
const rebake = (opt('--rebake', '') || '').split(',').filter(Boolean).map(Number);   // force a re-bake at these metres (as a streamed chunk would)
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
const park = args.shift();
const stretches = args.map((a) => a.split('-').map(Number));
if (!park || !stretches.length) { console.log('usage: node tools/ride_frames.mjs <park> <from>-<to> …'); process.exit(1); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.gpx': 'application/gpx+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path || 'index.html')); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });   // no offline caching in the background

const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const r1 = (v) => Math.round(v * 10) / 10;
const results = [];
for (const [from, to] of stretches) {
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.text().startsWith('progress')) console.error(`  ${from}-${to} ${m.text()}`); else if (/bak/i.test(m.text())) logs.push(m.text()); });
  const q = new URLSearchParams({ park, clean: '1', quality, pos: String(from), ...(time ? { time } : {}), ...(cam ? { cam } : {}) });
  await page.goto(`${base}/tools/world-preview.html?${q}`);
  await page.waitForFunction(() => window.world, null, { polling: 50 });
  const run = await page.evaluate(async ({ from, to, mpf, dtRide, rebake }) => {
    const forced = new Set();
    const w = window.world, gl = w.renderer.getContext();
    w.stop();
    let pos = from;
    w.setSource(() => ({ pos, speed: mpf / dtRide, cadence: 84, riding: true }));
    const frames = [];
    let bakeMs = 0, bakeWork = false;
    const hook = () => {
      const b = w.baked;
      if (!b || b.__hooked) return;
      b.__hooked = true;
      const tick = b.tick.bind(b);
      b.tick = (dt) => {
        gl.finish();
        const t = performance.now(), before = b._job || b.preparing;
        const r = tick(dt);
        gl.finish();
        bakeMs = performance.now() - t; bakeWork = !!(before || b._job);
        return r;
      };
    };
    const t0 = performance.now();
    let now = performance.now(), riding = false, loadMs = 0, lastEnd = 0;
    const tick = () => new Promise((ok) => setTimeout(ok, 0));
    for (let i = 0; i < 40000; i++) {
      hook();
      const loaded = !!(w.terrain?.kit || !w.stylized) && !w.baked?.preparing && !(w.loading > 0 && !w.terrain?.kit);
      if (!riding && loaded) { riding = true; loadMs = performance.now() - t0; }
      if (riding) pos += mpf;
      for (const m of rebake) if (riding && pos >= m && !forced.has(m) && w.baked) { forced.add(m); w.baked._bakedSig = null; w.baked._settled = 99; }
      if (pos > to) break;
      bakeMs = 0; bakeWork = false;
      now += dtRide * 1000;
      const tg = performance.now();
      gl.finish();
      const t = performance.now(), pre = t - tg, gap = tg - (lastEnd || tg);
      w.running = true; w._frame(now); cancelAnimationFrame(w._raf); w.running = false;
      gl.finish();
      const ms = performance.now() - t;
      lastEnd = performance.now();
      frames.push({ i, pos: Math.round(pos), ms: Math.round(ms * 10) / 10, gap: Math.round(gap), pre: Math.round(pre), bake: Math.round(bakeMs * 10) / 10, baking: bakeWork, ride: riding, prep: !!w.baked?.preparing, bakes: w.baked?.bakes || 0 });
      if (i % 100 === 0) console.log(`progress frame ${i} at ${Math.round(pos)} m: ${ms.toFixed(0)} ms, bakes ${w.baked?.bakes || 0}${w.baked?.preparing ? ', preparing' : ''} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
      await tick();
      if (!riding && performance.now() - t0 > 600000) break;
    }
    return { frames, loadMs, stats: w.baked?.stats || null, bakes: w.baked?.bakes || 0, history: w.baked?.history || null };
  }, { from, to, mpf, dtRide, rebake });
  await page.close();
  const load = run.frames.filter((f) => !f.ride), ride = run.frames.filter((f) => f.ride);
  const bk = ride.filter((f) => f.baking);
  const summary = {
    stretch: `${from}-${to}`,
    load: { s: r1(run.loadMs / 1000), frames: load.length, worstMs: r1(Math.max(0, ...load.map((f) => f.ms))), worstBakeMs: r1(Math.max(0, ...load.map((f) => f.bake))) },
    ride: {
      frames: ride.length, medianMs: r1(pct(ride.map((f) => f.ms), .5)), p95Ms: r1(pct(ride.map((f) => f.ms), .95)), worstMs: r1(Math.max(0, ...ride.map((f) => f.ms))),
      over25: ride.filter((f) => f.ms > 25).length,
      worstNoBakeMs: r1(Math.max(0, ...ride.filter((f) => !f.baking).map((f) => f.ms))),
    },
    bake: { framesWithWork: bk.length, worstMs: r1(Math.max(0, ...bk.map((f) => f.bake))), p95Ms: r1(pct(bk.map((f) => f.bake), .95)), medianMs: r1(pct(bk.map((f) => f.bake), .5)), totalMs: Math.round(bk.reduce((a, f) => a + f.bake, 0)),
      bakesDuringRide: (ride.at(-1)?.bakes ?? 0) - (load.at(-1)?.bakes ?? 0), bakesTotal: run.bakes, worstFrameWithBake: r1(Math.max(0, ...bk.map((f) => f.ms))) },
    lastBake: run.stats, errors,
  };
  results.push({ ...summary, frames: run.frames, logs });
  console.log(JSON.stringify(summary));
}
if (outFile) await writeFile(outFile, JSON.stringify({ park, quality, size: `${width}x${height}`, mpf, dt: dtRide, results }, null, 1));
await browser.close(); server.close();
