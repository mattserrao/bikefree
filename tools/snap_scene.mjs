#!/usr/bin/env node
// Scene snapshots: render 3D route views headlessly and save them as images, with the
// draw calls and triangles each view costs. The visual half of course QC.
//
//   npm run snap -- route28@10650 route28@19050:morning route28@16200 pittsburgh
//   node tools/snap_scene.mjs --out tools/snapshots --quality high bigsur@21800:golden:fall
//
// A shot is  <park>[@metres][:time][:season][:weather], always from the chase camera (the only one):
// time midday|morning|afternoon|golden|night, season summer|fall, weather clear|marine|clouds|rain|smoke,
// look gentle|bold|current (default: the scene's own look; current = no cartoon).
// No @metres = the scene's preview spot.
// Options: --out <dir> (default tools/snapshots), --quality low|balanced|high, --size 1280x720,
// --chrome <path> (default: CHROME env, else the usual Mac/Linux locations), --software (no GPU).
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
const breakdown = flag('--breakdown');   // list draw calls by object
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
if (!args.length) { console.log('usage: npm run snap -- <park>[@metres][:camera][:time][:season][:weather] …'); process.exit(1); }

const LOOKS = ['gentle', 'bold', 'current'];   // current = no cartoon look, whatever the scene says
const OLD_CAMERAS = ['chase', 'drone', 'vista', 'side', 'eye'];   // retired: ignored with a warning
const TIMES = ['midday', 'morning', 'afternoon', 'golden', 'night'];
const WEATHERS = ['clear', 'marine', 'clouds', 'rain', 'smoke'];
const shots = args.map((spec) => {
  const [where, ...tags] = spec.split(':');
  const [park, pos] = where.split('@');
  const old = tags.find((t) => OLD_CAMERAS.includes(t) && t !== 'chase');
  if (old) console.warn(`${spec}: the ${old} camera was retired; using the chase camera`);
  const shot = { spec, park, pos, time: tags.find((t) => TIMES.includes(t)), season: tags.find((t) => ['summer', 'fall'].includes(t)), weather: tags.find((t) => WEATHERS.includes(t)), look: tags.find((t) => LOOKS.includes(t)) };
  shot.name = [park, pos, shot.time, shot.season, shot.weather, shot.look].filter(Boolean).join('-');
  return shot;
});

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
const rows = [];
for (const shot of shots) {
  const t0 = Date.now(); errors.length = 0;
  const q = new URLSearchParams({ park: shot.park, clean: '1', quality, ...(shot.pos ? { pos: shot.pos } : {}), ...(shot.time ? { time: shot.time } : {}), ...(shot.season ? { season: shot.season } : {}), ...(shot.weather ? { weather: shot.weather } : {}), ...(shot.look ? { look: shot.look === 'current' ? 'none' : shot.look } : {}) });
  await page.goto(`${base}/tools/world-preview.html?${q}`);
  if (breakdown) await page.evaluate(() => { window.__breakdown = true; });
  await page.waitForFunction(() => window.world?.terrain && (window.world.terrain.kit || !window.world.stylized) && window.world._camInit, null, { timeout: 180000, polling: 500 });
  // stop the loop, let every queued scenery tile build, then draw one frame and read it back
  const r = await page.evaluate(async () => {
    const w = window.world, t = w.terrain, c = w.camera.position;
    w.stop();
    for (let k = 0; k < 600 && (t.forestQueue?.length || k < 2); k++) { t._lastX = Infinity; t.update(c.x, c.z); }
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    // the app's own frame: with the post-processing chain where the scene has one (Big Sur)
    w.renderer.shadowMap.needsUpdate = true;   // the ride redraws shadows only as needed
    if (w._render) w._render(); else w.renderer.render(w.scene, w.camera);
    const info = w.renderer.info.render;
    let breakdown = null;
    if (window.__breakdown) {
      // draw calls by object (frustum-visible meshes; ×2 for the ones that cast shadows)
      const cam = w.camera, vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
      const by = {};
      w.scene.traverseVisible((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
        if (o.frustumCulled !== false && o.geometry?.boundingSphere) {
          // the sphere's centre in clip space, with its radius as slack: a rough frustum test
          const sph = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld), c = sph.center.clone().applyMatrix4(vp);
          const d = sph.center.distanceTo(cam.position);
          if (d > sph.radius && (Math.abs(c.x) > 1 + sph.radius / d * 2.5 || Math.abs(c.y) > 1 + sph.radius / d * 2.5)) return;
        }
        const key = (o.name || o.parent?.name || o.type).replace(/[0-9]+/g, '#').slice(0, 40);
        by[key] = (by[key] || 0) + 1 + (o.castShadow ? 1 : 0);
      });
      breakdown = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25);
    }
    return { breakdown, url: w.renderer.domElement.toDataURL('image/jpeg', .9), calls: info.calls, triangles: info.triangles };
  });
  const file = join(out, `${shot.name}.jpg`);
  await writeFile(resolve(ROOT, file), Buffer.from(r.url.split(',')[1], 'base64'));
  rows.push({ shot: shot.spec, file, calls: r.calls, triangles: r.triangles, seconds: Math.round((Date.now() - t0) / 1000), errors: [...errors] });
  if (r.breakdown) console.log(r.breakdown.map(([k, n]) => `   ${String(n).padStart(4)}  ${k}`).join('\n'));
  console.log(`${errors.length ? 'ERR ' : 'ok  '} ${shot.spec.padEnd(34)} ${String(r.calls).padStart(5)} calls ${(r.triangles / 1e6).toFixed(2).padStart(6)} M tris  → ${file}`);
  for (const e of errors) console.log(`       ${e.slice(0, 200)}`);
}
await writeFile(resolve(ROOT, out, 'snapshots.json'), JSON.stringify({ quality, size: `${width}x${height}`, software, rows }, null, 2));
await browser.close(); server.close();
process.exitCode = rows.some((r) => r.errors.length) ? 1 : 0;
