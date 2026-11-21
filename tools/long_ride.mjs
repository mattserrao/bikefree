#!/usr/bin/env node
// [perf-6] Does the app get slower or bigger the longer you ride? Opens the app in headless Chrome (Demo, a Pittsburgh
// preset, as tools/memory_check.mjs does), then rides the whole preset a frame at a time (everything but drawing the
// view: a software GPU's draw drowns the rest) and every --every metres records the live JS heap after GC, the areas
// held, the scene's meshes, and the frame times since the last sample (median, p95, worst). Prints the samples and the
// trend: heap and median frame at the start vs the end. A heap that only climbs, or frames that slow down area after
// area, is the gradual slowdown.
//
//   node tools/long_ride.mjs ["Three Rivers Loop"] [--mpf 4] [--every 1000] [--to 30000] [--out /tmp/long.json]
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const mpf = Number(opt('--mpf', '4')), every = Number(opt('--every', '1000')), toM = Number(opt('--to', '0')), out = opt('--out', null);
const name = args[0] || 'Three Rivers Loop';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer(async (req, res) => { const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, ''); try { res.writeHead(200, { 'content-type': T[extname(p)] || 'application/octet-stream' }).end(await readFile(join(ROOT, p || 'index.html'))); } catch { res.writeHead(404).end(); } });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p)), args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.setDefaultTimeout(0);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.text().startsWith('sample')) console.error(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.click('.mode[data-mode="route"]');
await page.waitForSelector('.city-card'); await page.click('#demoBtn'); await page.click('.city-card'); await page.waitForSelector('#cityDlg[open]');
await page.locator('.city-row-btn', { has: page.locator('.cr-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
await page.evaluate(() => { setInterval(() => { const w = window.bikefree?.world; if (w && !w.__nd) { w.__nd = 1; w._render = () => { w.perf?.end?.(performance.now()); }; } }, 20); });
await page.locator('#cityList [data-ride]').first().click();
await page.waitForFunction(() => document.getElementById('loadScreen').hidden && window.bikefree.session.running, null, { timeout: 900000, polling: 500 });
const run = await page.evaluate(async ({ mpf, every, toM }) => {
  const w = window.bikefree.world;
  const total = toM || w.route.dist?.at?.(-1) || w.path?.length || 30000;
  w.stop();
  let pos = 0, now = performance.now();
  w.setSource(() => ({ pos, speed: mpf * 10, cadence: 84, riding: true }));
  const samples = [], win = [];
  const pct = (l, p) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const sample = () => {
    window.gc?.(); window.gc?.();
    let meshes = 0; w.scene.traverse((o) => { if (o.isMesh) meshes++; });
    const s = { m: Math.round(pos), heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6), areas: [...w.areas.keys()].join('+'), meshes,
      medianMs: +pct(win, .5).toFixed(1), p95Ms: +pct(win, .95).toFixed(1), worstMs: +Math.max(0, ...win).toFixed(1), drawn: w.area?.id };
    samples.push(s); win.length = 0;
    console.log(`sample ${JSON.stringify(s)}`);
  };
  sample();
  let next = every;
  for (let i = 0; pos < total && i < 200000; i++) {
    pos += mpf; now += 100;
    const t = performance.now();
    w.running = true; w._frame(now); cancelAnimationFrame(w._raf); w.running = false;
    win.push(performance.now() - t);
    if (pos >= next) { sample(); next += every; }
    if (i % 25 === 0) await new Promise((ok) => setTimeout(ok, 0));
  }
  return { samples, total };
}, { mpf, every, toM });
const s = run.samples, a = s.slice(1, 4), b = s.slice(-3), avg = (l, k) => +(l.reduce((x, y) => x + y[k], 0) / Math.max(1, l.length)).toFixed(1);
const summary = { route: name, rodeM: run.total, samples: s.length, heapStartMB: avg(a, 'heapMB'), heapEndMB: avg(b, 'heapMB'), heapPeakMB: Math.max(...s.map((x) => x.heapMB)),
  medianStartMs: avg(a, 'medianMs'), medianEndMs: avg(b, 'medianMs'), p95StartMs: avg(a, 'p95Ms'), p95EndMs: avg(b, 'p95Ms'), worstMs: Math.max(...s.map((x) => x.worstMs)), errors };
console.log(JSON.stringify(summary));
if (out) await writeFile(out, JSON.stringify({ summary, samples: s }, null, 1));
await browser.close(); server.close();
