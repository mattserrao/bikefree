#!/usr/bin/env node
// Scene snapshots: render 3D route views headlessly and save them as images, with the
// draw calls and triangles each view costs. The visual half of course QC.
//
//   npm run snap -- route28@10650 route28@19050:morning route28@16200:drone pittsburgh
//   node tools/snap_scene.mjs --out tools/snapshots --quality high bigsur@21800:golden:fall
//
// A shot is  <park>[@metres][:camera][:time][:season][:weather]  — camera chase|drone|vista|side|eye,
// time midday|morning|golden|night, season summer|fall, weather clear|marine|clouds|rain|smoke.
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

const CAMERAS = ['chase', 'drone', 'vista', 'side', 'eye'];
const TIMES = ['midday', 'morning', 'golden', 'night'];
const WEATHERS = ['clear', 'marine', 'clouds', 'rain', 'smoke'];
const shots = args.map((spec) => {
  const [where, ...tags] = spec.split(':');
  const [park, pos] = where.split('@');
  const shot = { spec, park, pos, cam: tags.find((t) => CAMERAS.includes(t)), time: tags.find((t) => TIMES.includes(t)), season: tags.find((t) => ['summer', 'fall'].includes(t)), weather: tags.find((t) => WEATHERS.includes(t)) };
  shot.name = [park, pos, shot.cam, shot.time, shot.season, shot.weather].filter(Boolean).join('-');
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
  const q = new URLSearchParams({ park: shot.park, clean: '1', quality, ...(shot.pos ? { pos: shot.pos } : {}), ...(shot.cam ? { cam: shot.cam } : {}), ...(shot.time ? { time: shot.time } : {}), ...(shot.season ? { season: shot.season } : {}), ...(shot.weather ? { weather: shot.weather } : {}) });
  await page.goto(`${base}/tools/world-preview.html?${q}`);
  if (breakdown) await page.evaluate(() => { window.__breakdown = true; });
  await page.waitForFunction(() => window.world?.terrain && (window.world.terrain.kit || !window.world.stylized) && window.world._camInit, null, { timeout: 180000, polling: 500 });
  // stop the loop, let every queued scenery tile build, then draw one frame and read it back
  const r = await page.evaluate(async () => {
    const w = window.world, t = w.terrain, c = w.camera.position;
    w.stop();
    for (let k = 0; k < 600 && (t.forestQueue?.length || k < 2); k++) { t._lastX = Infinity; t.update(c.x, c.z); }
    t.city?.streetKit?.flush();   // [street-kit] chunks whose kit work is still queued
    window.__bake = w.baked?.bakeNow();   // [baked-light] build the static scenery and bake before the one frame
    t.city?.streetKit?.flush();   // [street-kit] kit work queued by the chunks the bake just built
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    // [w2-budget] --breakdown: the frame's real draw calls by object name (wraps renderBufferDirect for the one frame;
    // the shadow pass calls it with no scene)
    const exact = {}, rbd = w.renderer.renderBufferDirect;
    if (window.__breakdown) w.renderer.renderBufferDirect = function (cam, scene, geo, mat, obj, group) {
      const key = (scene ? '' : 'shadow: ') + (obj.name || obj.parent?.name || mat?.name || obj.type).replace(/-?[0-9]+/g, '#').slice(0, 44);
      const n = (group ? group.count : geo.index ? geo.index.count : geo.attributes.position?.count || 0) / 3 * (obj.isInstancedMesh ? obj.count : 1);
      const e = (exact[key] ||= [0, 0]); e[0]++; e[1] += n;
      return rbd.apply(this, arguments);
    };
    // the app's own frame: with the post-processing chain where the scene has one (Big Sur)
    w.renderer.shadowMap.needsUpdate = true;   // the ride redraws shadows only as needed
    if (w._render) w._render(); else w.renderer.render(w.scene, w.camera);
    const info = w.renderer.info.render;
    w.renderer.renderBufferDirect = rbd;   // [w2-budget]
    let breakdown = null;
    if (window.__breakdown) {
      breakdown = Object.entries(exact).sort((a, b) => b[1][0] - a[1][0]).slice(0, 40).map(([k, [n, t]]) => [k, n, t]);   // [w2-budget]
    }
    return { breakdown, url: w.renderer.domElement.toDataURL('image/jpeg', .9), calls: info.calls, triangles: info.triangles, bake: window.__bake || null };
  });
  const file = join(out, `${shot.name}.jpg`);
  await writeFile(resolve(ROOT, file), Buffer.from(r.url.split(',')[1], 'base64'));
  rows.push({ shot: shot.spec, file, calls: r.calls, triangles: r.triangles, seconds: Math.round((Date.now() - t0) / 1000), errors: [...errors], ...(r.bake ? { bake: r.bake } : {}) });   // [baked-light] bake stats
  if (r.breakdown) console.log(r.breakdown.map(([k, n, t]) => `   ${String(n).padStart(4)}  ${String(Math.round(t / 1000)).padStart(5)} k  ${k}`).join('\n'));   // [w2-budget] calls, triangles
  console.log(`${errors.length ? 'ERR ' : 'ok  '} ${shot.spec.padEnd(34)} ${String(r.calls).padStart(5)} calls ${(r.triangles / 1e6).toFixed(2).padStart(6)} M tris  → ${file}`);
  for (const e of errors) console.log(`       ${e.slice(0, 200)}`);
}
await writeFile(resolve(ROOT, out, 'snapshots.json'), JSON.stringify({ quality, size: `${width}x${height}`, software, rows }, null, 2));
await browser.close(); server.close();
process.exitCode = rows.some((r) => r.errors.length) ? 1 : 0;
