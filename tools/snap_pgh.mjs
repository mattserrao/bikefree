// Snapshots of a free-ride road graph's world (PGH), headless: tools/pgh-preview.html in Chrome.
//
//   node tools/snap_pgh.mjs <name>@<lat>,<lon>[,<dir +|->][@<metres>] …  [--software] [--size 1280x720] [--time midday] [--out tools/snapshots]
//   node tools/snap_pgh.mjs point@40.4413,-80.0105 hotmetal@40.4300,-79.9605,+@60
//   name@lat,lon@at#eyeLat,eyeLon,eyeUp,lookLat,lookLon,lookUp   a free camera: eye and target by lat/lon, each so
//                  many metres above the ground (or the water) there
//   --view 60,40   an overview: the camera 60 m behind and 40 m above the rider (writes pgh-<name>-view.png)
//   --quality low  the world at a quality tier (low | balanced | high)
//
// Each shot starts the free ride on the edge nearest the spot (dir: which way along it) and places the rider
// <metres> along the path (default 40). Writes <out>/pgh-<name>.png and prints frame stats.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const software = flag('--software');
const qc = flag('--qc');   // (tools/qc_map.mjs: the page's QC probes on)
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const view = opt('--view', null);   // "<back>,<up>": an overview camera this far behind and above the rider
const evalJs = opt('--eval', null);   // run in the page after the frame (the world as `w`, THREE as `T`): its result is printed
const preJs = opt('--pre', null);   // run in the page before the frame is drawn (the world as `w`)
const quality = opt('--quality', 'balanced');
const frozen = flag('--frozen');   // [blocks] seeded Math.random + a frozen clock (the refactor guard: tools/toolbox_guard.mjs)
const jsonOut = opt('--json', null);   // [blocks] write the shots' stats here (the guard reads it)
const ua = opt('--ua', null);   // a user agent (e.g. an iPhone's: the phones' memory caps)
const time = opt('--time', 'midday'), out = opt('--out', 'tools/snapshots'), graph = opt('--graph', 'routes/cities/pgh.json');
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { if (process.env.SNAP_DEBUG) console.log('404', path); res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width, height }, ...(ua ? { userAgent: ua } : {}) });
if (frozen) await page.addInitScript(() => {
  let s = 0x9e3779b9; Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const T0 = 1767268800000; let tick = 0; window.__tick = (ms) => { tick += ms; };
  // the clock creeps 1 ms per read so time-sliced builds still finish; the same reads give the same times every run
  performance.now = () => 1000 + (tick += 0.001); Date.now = () => T0 + Math.floor(tick);
});
const rows = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('console', (m) => { if (process.env.SNAP_DEBUG && ['error', 'warning'].includes(m.type())) console.log('  console:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => { if (process.env.SNAP_DEBUG) console.log('  pageerror:', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')); });
await mkdir(resolve(ROOT, out), { recursive: true });
for (const spec of args) {
  const [main, cam] = spec.split('#');
  const [name, where, at] = main.split('@');
  const [lat, lon, dir] = where.split(',');
  errors.length = 0;
  const t0 = Date.now();
  await page.goto(`${base}/tools/pgh-preview.html?${new URLSearchParams({ graph, lat, lon, dir: dir || '+', at: at || 40, time, quality, ...(qc ? { qc: 1 } : {}) })}`);
  await page.waitForFunction(() => window.bfWorld && window.bfWorld.readiness().ready, null, { timeout: +(process.env.SNAP_WAIT || 240000), polling: 500 })
    .catch(async (e) => { console.log('  not ready:', await page.evaluate(() => JSON.stringify([window.bfWorld?._frames, window.bfWorld?._nearTiles?.length, window.bfWorld?.tiles?.size, window.bfWorld?.readiness?.()?.steps?.map((s) => s.p)])).catch(() => '?'), errors.slice(0, 3)); throw e; });
  const stats = await page.evaluate(([view, cam, pre]) => {
    const w = window.bfWorld;
    w.stop();
    if (pre) (0, eval)(`(w) => { ${pre} }`)(w);
    if (cam) {
      const [ea, eo, eu, la, lo, lu] = cam.split(',').map(Number), y = (p) => Math.max(w._groundH(p.x, p.z), w.poolAt(p.x, p.z));
      const e = w.proj.toLocal(ea, eo), t = w.proj.toLocal(la, lo);
      w.camera.position.set(e.x, y(e) + eu, e.z); w.camera.lookAt(t.x, y(t) + lu, t.z);
    } else if (view) {
      const [back, up] = view.split(',').map(Number), r = w.rider.group.position, f = w._pose.flat;
      w.camera.position.set(r.x - f.x * back, r.y + up, r.z - f.z * back); w.camera.lookAt(r.x + f.x * back * 0.6, r.y, r.z + f.z * back * 0.6);
    }
    for (let k = 0; k < 400; k++) w._stream(w.camera.position.x, w.camera.position.z, 1e9);
    // the baked light (CNY, SKAN: golden hour) for this view, at once
    if (w.baked) { w.baked.bakeNow(); w.baked.tick(1); w.baked.tick(1); }
    // the tree engine sorts its trees round the camera it last ticked with: once more for this (moved) camera
    w.camera.updateMatrixWorld();
    w.city?.oldGrowth?.prepare(w.camera);   // (an old-growth hero area's near pieces: built now for this camera)
    if (w.city?.forest) { w.city.forest._at = null; w.city.forest._lastRebuild = -99; w.city.forest.tick(w.camera); w.city.forest.impMat.uniforms.uNow.value = 1e9; }   // (every tile's impostors in: no dissolve in a still)
    w.effects?.prepare?.();   // (time-sliced effects — the canopy shade's map — finished for this camera)
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    if (w._draw) w._draw(); else w.renderer.render(w.scene, w.camera);   // (the world's own draw: its post pass on High)
    const i = w.renderer.info.render;
    const up = window.route.netRide.upcoming(w.p);
    return { bridges: `${w._bridgesState} ${w.bridges?.count ?? ''}`, calls: i.calls, triangles: i.triangles, tiles: [...w.tiles.values()].filter((t) => t.built).length, next: `${up.node.name} in ${Math.round(up.distTo)} m: ${up.options.map((o) => o.label).join(' / ')}` };
  }, [view, cam, preJs]);
  if (evalJs) console.log('  eval:', JSON.stringify(await page.evaluate(async (code) => { const w = window.bfWorld; const T = await import('/vendor/three.js'); return eval(code); }, evalJs)));
  const file = resolve(ROOT, out, `pgh-${name}${view || cam ? '-view' : ''}.png`);
  await page.screenshot({ path: file });
  rows.push({ shot: spec, file: file.slice(ROOT.length), calls: stats.calls, triangles: stats.triangles, errors: [...errors] });
  console.log(`${name}: bridges ${stats.bridges}, ${stats.calls} draw calls, ${(stats.triangles / 1e6).toFixed(2)} M triangles, ${stats.tiles} tiles · next ${stats.next} · ${((Date.now() - t0) / 1000).toFixed(1)} s → ${file.slice(ROOT.length)}${errors.length ? `\n  errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
}
if (jsonOut) { const { writeFile } = await import('node:fs/promises'); await writeFile(resolve(ROOT, jsonOut), JSON.stringify({ rows }, null, 1)); }
await browser.close();
server.close();
