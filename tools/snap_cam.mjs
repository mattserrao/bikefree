#!/usr/bin/env node
// Free-camera snapshots: put the camera anywhere (lat, lon, altitude in metres) and look at any point,
// for close-ups of landmarks the ride cameras never frame (towers, the fort, the incline stations).
//
//   node tools/snap_cam.mjs pittsburgh --shots shots.json [--software] [--out dir] [--size 1280x720]
//   shots.json: [{ "name": "gulf-night", "cam": [lat, lon, alt], "look": [lat, lon, alt], "time": "night" }, …]
//   (or pass the same JSON in the SHOTS environment variable)
//   node tools/snap_cam.mjs pittsburgh-oakland --views [--time night]   (the scene's postcard `views`: each camera
//   `up` metres over the ground at its spot, looking at its `look` point `up` metres over the ground there; PLAN F111)
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, findChrome } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const out = opt('--out', 'tools/snapshots');   // relative to the repo, or an absolute path
const quality = opt('--quality', 'balanced');
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const software = flag('--software');
const chrome = opt('--chrome', findChrome());
const shotsFile = opt('--shots', '');
const views = flag('--views'), viewTime = opt('--time', null);
if (!args.length || (!shotsFile && !process.env.SHOTS && !views)) { console.log('usage: node tools/snap_cam.mjs <park> --shots shots.json [--software]'); process.exit(1); }

// a tiny static server for the repo (the preview needs http, not file://)
const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
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
const park = args[0] || 'pittsburgh';
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SHOTS = views
  ? (JSON.parse(readFileSync(resolve(ROOT, `routes/scenes/${park}.json`), 'utf8')).views || []).map((v) => ({ name: `view-${slug(v.name)}${viewTime ? `-${viewTime}` : ''}`,
    cam: [v.cam.lat, v.cam.lon, v.cam.abs ?? null], camUp: v.cam.up ?? 30, look: [v.look.lat, v.look.lon, v.look.abs ?? null], lookUp: v.look.up ?? 0, time: viewTime }))
  : JSON.parse(process.env.SHOTS || readFileSync(shotsFile, 'utf8'));
await page.goto(`${base}/tools/world-preview.html?park=${park}&clean=1&quality=${quality}&pos=4300`);
await page.waitForFunction(() => window.bfWorld?.terrain && (window.bfWorld.terrain.city || !window.bfWorld.terrain.landscape?.city) && window.bfWorld.terrain.kit && window.bfWorld._camInit, null, { timeout: 300000, polling: 500 });
for (const sh of SHOTS) {
  const r = await page.evaluate(async (sh) => {
    const w = window.bfWorld, t = w.terrain, city = t.city, P = w.proj;
    w.stop();
    if (sh.time) w.setTimeOfDay(sh.time);
    const a = P.toLocal(sh.cam[0], sh.cam[1]), b = P.toLocal(sh.look[0], sh.look[1]);
    if (sh.cam[2] == null) sh.cam[2] = t.heightAt(a.x, a.z) + (sh.camUp ?? 30);   // (--views: over the ground)
    if (sh.look[2] == null) sh.look[2] = t.heightAt(b.x, b.z) + (sh.lookUp ?? 0);    w.camera.position.set(a.x, sh.cam[2], a.z); w.camera.lookAt(b.x, sh.look[2], b.z); w.camera.updateMatrixWorld(); w.sky.position.copy(w.camera.position);
    for (let k = 0; k < 40 && city?._pending.length; k++) { city._warm = false; city._stream(a.x, a.z); }
    for (let k = 0; k < 400 && (t.forestQueue?.length || k < 2); k++) { t._lastX = Infinity; t.update(a.x, a.z); }
    city?.tick(w.camera.position, .016, 12.3, null);
    if (w.baked && !w.baked.ready) w.baked.bakeNow();   // [baked-light] bake once, before the first frame
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    w.renderer.shadowMap.needsUpdate = true;   // the ride redraws shadows only as needed
    if (w._render) w._render(); else w.renderer.render(w.scene, w.camera);
    return { url: w.renderer.domElement.toDataURL('image/jpeg', .9), calls: w.renderer.info.render.calls, tris: w.renderer.info.render.triangles };
  }, sh);
  await writeFile(resolve(ROOT, out, sh.name + '.jpg'), Buffer.from(r.url.split(',')[1], 'base64'));
  console.log('ok', sh.name, r.calls, 'calls', (r.tris / 1e6).toFixed(2), 'M tris', errors.slice(0, 3));
}
await browser.close(); server.close();
