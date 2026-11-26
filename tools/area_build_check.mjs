#!/usr/bin/env node
// Area build check (PLAN F30): build city areas in headless Chrome the way the ride does — a hidden area of a
// network of areas, its build run in frame slices (`--budget` ms a slice, the world's _runAreaJobs) — or all at once,
// stream every chunk round one spot, and fingerprint what was built (a hash per object of its geometry, transforms,
// instances and materials, as snap --fingerprint does, with a seeded Math.random). Two runs that print the same
// fingerprints built the same scene.
//
//   node tools/area_build_check.mjs oakland westend                    (sliced, 4 ms slices)
//   node tools/area_build_check.mjs --budget 0 oakland                 (all at once)
//   node tools/area_build_check.mjs --root /tmp/old-site oakland       (another checkout: before F30 there were no
//                                                                       slices, the area is built by _buildArea)
//   node tools/area_build_check.mjs --out /tmp/a.json oakland          (the fingerprints per object kind, to diff)
//
// Areas are the network's area ids (core, allegheny, oakland, …). Prints per area: the build's main-thread time, its
// slices (count, longest), the objects and the fingerprint.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const ROOT = resolve(opt('--root', join(dirname(fileURLToPath(import.meta.url)), '..')));
const budget = Number(opt('--budget', '4'));
const park = opt('--park', 'pittsburgh'), quality = opt('--quality', 'balanced'), outFile = opt('--out', null);
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
const gapsOpt = (() => { const i = args.indexOf('--gaps'); if (i < 0) return false; args.splice(i, 1); return true; })();   // (debug: a jobs.js that records gaps)
const areas = args.length ? args : ['oakland'];

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
const context = await browser.newContext({ viewport: { width: 640, height: 360 }, serviceWorkers: 'block' });
// a seeded Math.random (reset before each build, so both ways draw the same numbers)
await context.addInitScript(() => {
  let s = 0x9e3779b9;
  window.__seed = (v) => { s = v >>> 0; };
  Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
});
if (gapsOpt) await context.addInitScript(() => { window.__gapDebug = true; });
const rows = [];
for (const id of areas) {
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // a network ride on the city's first area (horizon off: no streamed tiles), the world stopped once it stands
  // (the world opens in another area: the core's first segment, or — checking the core — the Allegheny's)
  await page.goto(`${base}/tools/world-preview.html?${new URLSearchParams({ park, clean: '1', quality, path: id === 'core' ? 'e13+' : 'e1+', pos: '0', horizon: '0' })}`);
  await page.waitForFunction(() => window.bfWorld?.terrain?.kit && window.bfWorld.rider?.triangles && window.bfWorld.areaSet, null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async ({ id, budget }) => {
    const w = window.bfWorld;
    w.stop();
    if (w.area.id === id) throw new Error(`${id} is the area drawn`);
    for (const a of [...w.areas.values()]) if (a !== w.area && a.id === id) w._releaseArea(a);
    const tick = () => new Promise((ok) => setTimeout(ok, 0));
    await tick();
    window.__seed(12345);
    const t0 = performance.now();
    let parts, slices = [], sliced = !!w._runAreaJobs && budget > 0;
    if (w._runAreaJobs) {
      // [F30] the ride's way: the build as a job, a slice at a time (budget 0: all at once)
      w.areaBudget = { urgent: budget || Infinity, soon: budget || Infinity, ahead: budget || Infinity };
      w._soon = new Set();
      w._ensureArea(id);
      while (!w.areas.get(id)?.job) await tick();
      window.__seed(12345);
      for (let k = 0; k < 1e6 && !w.areas.get(id)?.ready; k++) {
        const before = w.areaWork?.[id]?.steps?.build?.ms || 0;
        w._runAreaJobs(id, false);
        const after = w.areaWork?.[id]?.steps?.build?.ms || 0;
        if (after > before) slices.push(after - before);
        await tick();
      }
      parts = w.areas.get(id);
    } else {
      // before F30: built by _buildArea, the scenery at once, then the road, then the kit's callback (the city)
      const route = await w.areaSet.load(id);
      window.__seed(12345);
      parts = w._buildArea(id, route, 'all');
      await parts.terrain.ready;
    }
    const buildMs = performance.now() - t0;
    // stream everything round the middle of the area's line, at once
    const t = parts.terrain, ix = parts.index, i = Math.floor(ix.xs.length / 2), cx = ix.xs[i], cz = ix.zs[i];
    t._lastX = Infinity; t.update(cx, cz);
    t.city?._stream(cx, cz, Infinity);
    t.city?.streetKit?.flush();
    // fingerprint (as tools/snap_scene.mjs --fingerprint)
    const THREE = await import('/vendor/three.js');
    const H = (h, bytes) => { for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619) >>> 0; return h; };
    const num = (h, v) => H(h, new Uint8Array(new Float64Array([Math.round(v * 1e4) / 1e4]).buffer));
    const str = (h, s) => H(h, new TextEncoder().encode(String(s)));
    const arr = (h, a) => { if (!a) return h; const f = a instanceof Float32Array ? a.map((v) => Math.round(v * 1e3) / 1e3) : a; return H(h, new Uint8Array(f.buffer, f.byteOffset, f.byteLength)); };
    const mat = (h, m) => { if (!m) return h; for (const k of ['type', 'name', 'side', 'transparent', 'opacity', 'vertexColors', 'flatShading', 'depthWrite', 'alphaTest', 'fog', 'wireframe']) h = str(h, m[k]); if (m.color) h = str(h, m.color.getHexString()); if (m.map) h = str(h, m.map.image ? (m.map.image.width + 'x' + m.map.image.height) : 'map'); if (m.defines) h = str(h, JSON.stringify(m.defines)); return h; };
    const per = {}; let all = 2166136261, n = 0, tris = 0;
    const roots = [t.group, parts.road, parts.shoulder].filter(Boolean);
    for (const root of roots) root.updateMatrixWorld(true);
    for (const root of roots) root.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
      let h = 2166136261; h = str(h, o.type + '|' + o.name + '|' + o.castShadow + '|' + o.receiveShadow + '|' + o.renderOrder + '|' + o.frustumCulled);
      for (const v of o.matrixWorld.elements) h = num(h, v);
      const g = o.geometry; if (g) { if (g.index) h = arr(h, g.index.array); for (const [k, a] of Object.entries(g.attributes)) { h = str(h, k); h = arr(h, a.array); } for (const gr of g.groups) h = str(h, gr.start + ',' + gr.count + ',' + gr.materialIndex); tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3 * (o.isInstancedMesh ? o.count : 1); }
      if (o.isInstancedMesh) { h = str(h, o.count); h = arr(h, o.instanceMatrix.array.subarray(0, o.count * 16)); if (o.instanceColor) h = arr(h, o.instanceColor.array.subarray(0, o.count * 3)); }
      for (const m of [].concat(o.material || [])) h = mat(h, m);
      const key = (o.name || o.parent?.name || o.type).replace(/-?[0-9]+/g, '#').slice(0, 44);
      per[key] = ((per[key] || 0) + h) >>> 0; all = (all + h) >>> 0; n++;
    });
    const sorted = slices.slice().sort((a, b) => b - a);
    const gaps = window.__gapDebug ? (await import('/js/world/toolbox/core/jobs.js')).gaps?.sort((a, b) => b.ms - a.ms).slice(0, 12) : null;
    return { id, sliced, buildMs: Math.round(buildMs), workMs: Math.round(slices.reduce((a, b) => a + b, 0)), slices: slices.length, longest: sorted.slice(0, 5).map((v) => Math.round(v * 10) / 10),
      objects: n, triangles: Math.round(tris), fingerprint: all.toString(16), per, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, gaps };
  }, { id, budget });
  await page.close();
  rows.push({ ...r, errors });
  console.log(`${errors.length ? 'ERR' : 'ok '} ${id.padEnd(10)} ${r.sliced ? `sliced ${budget} ms: ${r.slices} slices, ${r.workMs} ms of work, longest ${r.longest.join(' / ')} ms` : `at once`} · built in ${r.buildMs} ms · ${r.objects} objects, ${(r.triangles / 1e6).toFixed(2)} M tris · fingerprint ${r.fingerprint}`);
  for (const e of errors) console.log(`     ${e.slice(0, 200)}`);
  for (const g of r.gaps || []) console.log(`   gap ${Math.round(g.ms)} ms\n      from ${g.from.replace(/http:[^ ]*\/js\/world\//g, '')}\n      to   ${g.to.replace(/http:[^ ]*\/js\/world\//g, '')}`);
}
if (outFile) await writeFile(outFile, JSON.stringify({ root: ROOT, budget, rows }, null, 1));
await browser.close(); server.close();
