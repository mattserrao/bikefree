#!/usr/bin/env node
// Main page load (PLAN 7.11): how long the menu's route list takes to appear, in headless Chrome against a local
// server that serves like GitHub Pages (gzip for text, Cache-Control max-age=600, ETag / 304).
//
//   node tools/menu_load.mjs                         (cold and warm, unthrottled and 10 Mbps / 40 ms)
//   node tools/menu_load.mjs --root /tmp/oldmain     (measure another checkout)
//   node tools/menu_load.mjs --runs 3 --json /tmp/menu-load.json
//
// cold: a fresh profile (no cache, no service worker). warm: the same profile reloaded after the service worker
// has installed (its precache done) and the page settled. Recorded per run: first route card, the city card,
// every card's thumbnail drawn (canvas painted), requests / bytes before the first card, long tasks before it,
// and the biggest / slowest requests of the load.
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const ROOT = resolve(opt('--root', join(dirname(fileURLToPath(import.meta.url)), '..')));
const runs = Number(opt('--runs', '1'));
const jsonOut = opt('--json', null);
const only = opt('--only', null);   // e.g. "cold-10mbps"
const chrome = opt('--chrome', process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.gpx': 'application/gpx+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream', '.gz': 'application/gzip', '.glb': 'model/gltf-binary' };
const TEXT = new Set(['.html', '.js', '.mjs', '.json', '.css', '.gpx', '.svg']);
const memo = new Map();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try {
    const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
    const st = await stat(file);
    let m = memo.get(file);
    if (!m || m.mtime !== st.mtimeMs) {
      const body = await readFile(file);
      const ext = extname(file);
      m = { mtime: st.mtimeMs, ext, body, gz: TEXT.has(ext) ? gzipSync(body, { level: 6 }) : null, etag: `"${createHash('md5').update(body).digest('hex')}"` };
      memo.set(file, m);
    }
    const head = { 'content-type': TYPES[m.ext] || 'application/octet-stream', 'cache-control': 'max-age=600', etag: m.etag };
    if (req.headers['if-none-match'] === m.etag) { res.writeHead(304, head).end(); return; }
    if (m.gz && /gzip/.test(req.headers['accept-encoding'] || '')) res.writeHead(200, { ...head, 'content-encoding': 'gzip' }).end(m.gz);
    else res.writeHead(200, head).end(m.body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;
const { chromium } = await import('playwright-core');

const NETS = { unthrottled: null, '10mbps': { offline: false, latency: 40, downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8 } };

// in the page: when the first card, the city card and every card's thumbnail appear
const PROBE = () => {
  window.__ml = { longTasks: [] };
  const t = () => performance.now();
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ml.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* */ }
  const painted = (c) => { try { const x = c.getContext('2d'); if (!x || !c.width) return false; const d = x.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 64) if (d[i]) return true; } catch { /* */ } return false; };
  const tick = () => {
    const box = document.getElementById('routeCards');
    const cards = box ? box.querySelectorAll('.rcard') : [];
    const m = window.__ml;
    if (cards.length && m.firstCard == null) { m.firstCard = t(); m.cardsAtFirst = cards.length; }
    if (box?.querySelector('.city-card') && m.cityCard == null) m.cityCard = t();
    if (cards.length && m.thumbs == null) {
      const cs = [...box.querySelectorAll('.rcard canvas')].filter((c) => c.clientWidth);
      if (cs.length && cs.every(painted)) { m.thumbs = t(); m.cards = cards.length; }
    }
    if (m.thumbs == null || m.firstCard == null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function measure(ctx, net, label) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (NETS[net]) await cdp.send('Network.emulateNetworkConditions', NETS[net]);
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url.replace(base, ''), start: e.timestamp }));
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.fromSW = e.response.fromServiceWorker; r.fromCache = e.response.fromDiskCache; } });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; } });
  await page.addInitScript(PROBE);
  const t0 = Date.now();
  let navStart;
  page.once('request', () => {});
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  navStart = await page.evaluate(() => performance.timeOrigin);
  await page.waitForFunction(() => window.__ml.thumbs != null && window.__ml.firstCard != null, null, { timeout: 180000, polling: 100 }).catch(() => {});
  const ml = await page.evaluate(() => window.__ml);
  const wall0 = navStart / 1000;
  // CDP timestamps are monotonic seconds; line them up with the first request (the document)
  const all = [...reqs.values()].filter((r) => r.start);
  const docStart = Math.min(...all.map((r) => r.start));
  const rel = (s) => Math.round((s - docStart) * 1000);
  const firstCard = ml.firstCard;
  const before = all.filter((r) => r.end && rel(r.end) <= firstCard);
  const sum = (l) => l.reduce((a, r) => a + (r.bytes || 0), 0);
  const top = [...all].filter((r) => r.end).sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 8)
    .map((r) => ({ url: r.url.slice(0, 70), kB: Math.round((r.bytes || 0) / 1024), start: rel(r.start), end: rel(r.end), sw: !!r.fromSW }));
  const res = {
    label, net, firstCardMs: Math.round(firstCard ?? -1), cityCardMs: Math.round(ml.cityCard ?? -1), thumbsMs: Math.round(ml.thumbs ?? -1), cards: ml.cards,
    reqsBefore: before.length, kBBefore: Math.round(sum(before) / 1024), reqsTotalSoFar: all.length, kBTotalSoFar: Math.round(sum(all) / 1024),
    byDir: Object.entries(before.reduce((o, r) => { const d = r.url.split('?')[0].split('/').slice(0, -1).join('/') || '.'; o[d] = (o[d] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6),
    longTasksBefore: ml.longTasks.filter(([s]) => s < firstCard), longTasksToThumbs: ml.longTasks.filter(([s]) => s < (ml.thumbs ?? Infinity)), top,
  };
  void wall0; void t0;
  await page.close();
  return res;
}

const results = [];
for (let run = 0; run < runs; run++) {
  for (const net of Object.keys(NETS)) {
    if (only && !only.endsWith(net)) continue;
    const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    if (!only || only.startsWith('cold')) results.push(await measure(ctx, net, 'cold'));
    // let the service worker install (precache) and the page's background work finish
    const p = await ctx.newPage();
    await p.goto(base);
    await p.evaluate(async () => { const r = await navigator.serviceWorker?.ready; return !!r; }).catch(() => {});
    await p.waitForTimeout(3000);
    await p.close();
    if (!only || only.startsWith('warm')) results.push(await measure(ctx, net, 'warm'));
    await browser.close();
  }
}
server.close();
for (const r of results) {
  console.log(`${r.label.padEnd(5)} ${r.net.padEnd(11)} first card ${r.firstCardMs} ms · city card ${r.cityCardMs} ms · thumbnails ${r.thumbsMs} ms · ${r.cards} cards · before the list: ${r.reqsBefore} requests ${r.kBBefore} kB, ${r.longTasksBefore.length} long tasks (${r.longTasksBefore.reduce((a, [, d]) => a + d, 0)} ms)`);
  for (const q of r.top.slice(0, 5)) console.log(`        ${String(q.kB).padStart(6)} kB  ${String(q.start).padStart(6)}–${String(q.end).padEnd(6)} ms ${q.sw ? '(sw) ' : ''}${q.url}`);
}
if (jsonOut) await writeFile(jsonOut, JSON.stringify(results, null, 1));
