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
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const view = opt('--view', null);
const evalJs = opt('--eval', null);   // run in the page after the frame (the world as `w`, THREE as `T`): its result is printed   // "<back>,<up>": an overview camera this far behind and above the rider
const quality = opt('--quality', 'balanced');
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
const page = await browser.newPage({ viewport: { width, height } });
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
  await page.goto(`${base}/tools/pgh-preview.html?${new URLSearchParams({ graph, lat, lon, dir: dir || '+', at: at || 40, time, quality })}`);
  await page.waitForFunction(() => window.world && window.world.readiness().ready, null, { timeout: 240000, polling: 500 });
  const stats = await page.evaluate(([view, cam]) => {
    const w = window.world;
    w.stop();
    if (cam) {
      const [ea, eo, eu, la, lo, lu] = cam.split(',').map(Number), y = (p) => Math.max(w._groundH(p.x, p.z), w.poolAt(p.x, p.z));
      const e = w.proj.toLocal(ea, eo), t = w.proj.toLocal(la, lo);
      w.camera.position.set(e.x, y(e) + eu, e.z); w.camera.lookAt(t.x, y(t) + lu, t.z);
    } else if (view) {
      const [back, up] = view.split(',').map(Number), r = w.rider.group.position, f = w._pose.flat;
      w.camera.position.set(r.x - f.x * back, r.y + up, r.z - f.z * back); w.camera.lookAt(r.x + f.x * back * 0.6, r.y, r.z + f.z * back * 0.6);
    }
    for (let k = 0; k < 400; k++) w._stream(w.camera.position.x, w.camera.position.z, 1e9);
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    w.renderer.render(w.scene, w.camera);
    const i = w.renderer.info.render;
    const up = window.route.netRide.upcoming(w.p);
    return { bridges: `${w._bridgesState} ${w.bridges?.count ?? ''}`, calls: i.calls, triangles: i.triangles, tiles: [...w.tiles.values()].filter((t) => t.built).length, next: `${up.node.name} in ${Math.round(up.distTo)} m: ${up.options.map((o) => o.label).join(' / ')}` };
  }, [view, cam]);
  if (evalJs) console.log('  eval:', JSON.stringify(await page.evaluate(async (code) => { const w = window.world; const T = await import('/vendor/three.module.min.js'); return eval(code); }, evalJs)));
  const file = resolve(ROOT, out, `pgh-${name}${view || cam ? '-view' : ''}.png`);
  await page.screenshot({ path: file });
  console.log(`${name}: bridges ${stats.bridges}, ${stats.calls} draw calls, ${(stats.triangles / 1e6).toFixed(2)} M triangles, ${stats.tiles} tiles · next ${stats.next} · ${((Date.now() - t0) / 1000).toFixed(1)} s → ${file.slice(ROOT.length)}${errors.length ? `\n  errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
}
await browser.close();
server.close();
