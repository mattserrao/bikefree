#!/usr/bin/env node
// Free-camera snapshots: put the camera anywhere (lat, lon, altitude in metres) and look at any point,
// for close-ups of landmarks the ride cameras never frame (towers, the fort, the incline stations).
//
//   node tools/snap_cam.mjs pittsburgh --shots shots.json [--software] [--out dir] [--size 1280x720]
//   shots.json: [{ "name": "gulf-night", "cam": [lat, lon, alt], "look": [lat, lon, alt], "time": "night" }, …]
//   (or pass the same JSON in the SHOTS environment variable)
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const out = opt('--out', 'tools/snapshots');   // relative to the repo, or an absolute path
const quality = opt('--quality', 'balanced');
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const software = flag('--software');
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
const shotsFile = opt('--shots', '');
if (!args.length || (!shotsFile && !process.env.SHOTS)) { console.log('usage: node tools/snap_cam.mjs <park> --shots shots.json [--software]'); process.exit(1); }

// a tiny static server for the repo (the preview needs http, not file://)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.gpx': 'application/gpx+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path || 'index.html')); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('Needs playwright-core: npm install'); server.close(); process.exit(1); }
const browser = await chromium.launch({ executablePath: chrome,
  args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width, height } });
page.setDefaultTimeout(0);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await mkdir(resolve(ROOT, out), { recursive: true });

// free-camera shots: name lat lon alt  →  lookLat lookLon lookAlt  [time]
const SHOTS = JSON.parse(process.env.SHOTS || readFileSync(shotsFile, 'utf8'));
const park = args[0] || 'pittsburgh';
await page.goto(`${base}/tools/world-preview.html?park=${park}&clean=1&quality=${quality}&pos=4300`);
await page.waitForFunction(() => window.world?.terrain && (window.world.terrain.city || !window.world.terrain.landscape?.city) && window.world.terrain.kit && window.world._camInit, null, { timeout: 300000, polling: 500 });
for (const sh of SHOTS) {
  const r = await page.evaluate(async (sh) => {
    const w = window.world, t = w.terrain, city = t.city, P = w.proj;
    w.stop();
    if (sh.time) w.setTimeOfDay(sh.time);
    const a = P.toLocal(sh.cam[0], sh.cam[1]), b = P.toLocal(sh.look[0], sh.look[1]);
    w.camera.position.set(a.x, sh.cam[2], a.z); w.camera.lookAt(b.x, sh.look[2], b.z); w.camera.updateMatrixWorld(); w.sky.position.copy(w.camera.position);
    for (let k = 0; k < 40 && city?._pending.length; k++) { city._warm = false; city._stream(a.x, a.z); }
    for (let k = 0; k < 400 && (t.forestQueue?.length || k < 2); k++) { t._lastX = Infinity; t.update(a.x, a.z); }
    city?.tick(w.camera.position, .016, 12.3, null);
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    w.renderer.shadowMap.needsUpdate = true;   // the ride redraws shadows only as needed
    if (w._render) w._render(); else w.renderer.render(w.scene, w.camera);
    return { url: w.renderer.domElement.toDataURL('image/jpeg', .9), calls: w.renderer.info.render.calls };
  }, sh);
  await writeFile(resolve(ROOT, out, sh.name + '.jpg'), Buffer.from(r.url.split(',')[1], 'base64'));
  console.log('ok', sh.name, r.calls, errors.slice(0, 3));
}
await browser.close(); server.close();
