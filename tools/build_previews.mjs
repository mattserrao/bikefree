#!/usr/bin/env node
// Route preview images (PLAN 6.8): 2–3 small pictures along every route in the menu, rendered from the app's own
// 3D world (tools/world-preview.html, as tools/snap_scene.mjs does) and kept in the repo as WebP files.
//
//   node tools/build_previews.mjs                 # plan every route, render every picture, write the manifests
//   node tools/build_previews.mjs --stale         # render only missing and stale pictures (inputs changed)
//   node tools/build_previews.mjs --only bigsur   # one route (its pictures; shared ones are re-rendered too)
//   node tools/build_previews.mjs --park pittsburgh-oakland   # every picture drawn in one world
//   node tools/build_previews.mjs --plan          # no rendering: re-pick the spots, rewrite the manifests
//   node tools/build_previews.mjs --check         # report missing / stale pictures and changed picks (exit 1)
//   options: --limit <n> (stop after n worlds: run it again for the rest — under flock, the lock is released
//            between runs), --software (no GPU), --quality low|balanced|high, --chrome <path>
//
// The spots: tools/preview_spots.mjs (start, highlight, a climb or a second highlight; hand picks in
// routes/previews/picks.json). Pictures are shared: a spot several Pittsburgh presets ride is one file.
// Out: routes/previews/<world>-<metre>.webp (480×270), routes/previews/index.json (the app's: captions and
// files per route) and routes/previews/renders.json (the tool's: each picture's spot and input hash, for --check).
//
// Run it under the shared lock: flock /tmp/heavy.lock node tools/build_previews.mjs --stale --limit 3
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadSources, planRoutes, imageName } from './preview_spots.mjs';

export const SIZE = { width: 480, height: 270 };
export const RENDER = {
  version: 1,   // bump to re-render everything (a camera or encoding change)
  scale: 2,     // drawn at 960×540, scaled down (sharper edges than drawing small)
  webp: 0.72,
  time: 'midday', weather: 'clear',
  // the postcard camera: a little higher and further back than the ride's chase camera, looking down the road
  camera: { back: 7.5, up: 3.4, ahead: 30, lookUp: 1.2, ground: 2.2, fov: 55, speedFov: 0, pull: 0, buzz: 0 },
};
export const BUDGET = { imageKB: 45, totalMB: 8 };   // per picture (480×270 WebP) and all of them
const DIR = 'routes/previews', INDEX = `${DIR}/index.json`, RENDERS = `${DIR}/renders.json`;

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const only = opt('--only', null), parkOnly = opt('--park', null), limit = Number(opt('--limit', Infinity));
const quality = opt('--quality', 'balanced');
const check = flag('--check'), planOnly = flag('--plan'), staleOnly = flag('--stale'), software = flag('--software');
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));

const readJson = (p, dflt) => (existsSync(resolve(ROOT, p)) ? JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) : dflt);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- plan ----------
const t0 = Date.now();
const src = loadSources(ROOT);
const plans = planRoutes(src);   // always the whole menu: the manifests list every route
const images = new Map();        // file → { render, routes }
for (const p of plans) for (const s of p.spots) {
  s.file = imageName(s.render);
  if (!images.has(s.file)) images.set(s.file, { render: s.render, routes: [] });
  images.get(s.file).routes.push(p.id);
}
// what a picture depends on: its world's data files, the spot and the render settings (code changes are not
// tracked: re-render at the end of a phase, or bump RENDER.version)
const fileHash = new Map();
const hashOf = (p) => { if (!fileHash.has(p)) fileHash.set(p, existsSync(resolve(ROOT, p)) ? sha(readFileSync(resolve(ROOT, p))).slice(0, 16) : 'missing'); return fileHash.get(p); };
function inputsOf(render) {
  const it = src.item(render.park), sc = src.scene(render.park);
  const files = [it.file, it.scene, sc.cityData, sc.terrainGridFile, sc.placesFile, sc.terrainData?.file, sc.assets, ...(sc.extraAssets || [])].filter(Boolean);
  return sha(JSON.stringify({ files: files.map((f) => [f, hashOf(f)]), render, RENDER, SIZE, quality })).slice(0, 16);
}
for (const [file, im] of images) im.inputs = inputsOf(im.render);
const renders = readJson(RENDERS, { images: {} });
const stateOf = (file) => !existsSync(resolve(ROOT, DIR, file)) ? 'missing' : renders.images[file]?.inputs !== images.get(file).inputs ? 'stale' : 'ok';

function writeManifests() {
  const routes = {};
  for (const p of plans) {
    const list = p.spots.filter((s) => existsSync(resolve(ROOT, DIR, s.file)))
      .map((s) => ({ file: s.file, caption: s.caption, role: s.role, atM: s.atM, v: renders.images[s.file]?.sha?.slice(0, 8) || '' }));
    if (list.length) routes[p.id] = list;
  }
  let total = 0;
  for (const f of Object.keys(renders.images)) if (!images.has(f)) delete renders.images[f];   // no longer used
  for (const [file] of images) if (existsSync(resolve(ROOT, DIR, file))) total += statSync(resolve(ROOT, DIR, file)).size;
  const index = { format: 'bikefree-previews-1', size: `${SIZE.width}x${SIZE.height}`, images: Object.values(routes).flat().filter((s, i, a) => a.findIndex((o) => o.file === s.file) === i).length, bytes: total, routes };
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return Promise.all([
    writeFile(resolve(ROOT, INDEX), JSON.stringify({ ...index, routes: sorted(routes) }, null, 1) + '\n'),
    writeFile(resolve(ROOT, RENDERS), JSON.stringify({ format: 'bikefree-preview-renders-1', note: 'tools/build_previews.mjs: each picture\'s spot and input hash (--check)', images: sorted(renders.images) }, null, 1) + '\n'),
  ]);
}

// ---------- --check ----------
if (check) {
  const index = readJson(INDEX, { routes: {} });
  const problems = [];
  for (const p of plans) {
    const now = p.spots.map((s) => `${s.file}|${s.caption}`).join(',');
    const was = (index.routes[p.id] || []).map((s) => `${s.file}|${s.caption}`).join(',');
    if (now !== was) problems.push(`${p.id}: picks changed (${was || 'none'} → ${now}); run --plan, then render the new ones`);
  }
  const counts = { ok: 0, missing: 0, stale: 0 };
  for (const [file] of images) { const st = stateOf(file); counts[st]++; if (st !== 'ok') problems.push(`${file}: ${st} (${images.get(file).routes.slice(0, 3).join(', ')}${images.get(file).routes.length > 3 ? ' …' : ''})`); }
  const onDisk = existsSync(resolve(ROOT, DIR)) ? readdirSync(resolve(ROOT, DIR)).filter((f) => f.endsWith('.webp')) : [];
  for (const f of onDisk) if (!images.has(f)) problems.push(`${f}: not used by any route (delete it)`);
  let total = 0;
  for (const f of onDisk) { const kb = statSync(resolve(ROOT, DIR, f)).size / 1024; total += kb; if (kb > BUDGET.imageKB) problems.push(`${f}: ${kb.toFixed(1)} kB, over the ${BUDGET.imageKB} kB budget`); }
  if (total / 1024 > BUDGET.totalMB) problems.push(`all pictures: ${(total / 1024).toFixed(2)} MB, over the ${BUDGET.totalMB} MB budget`);
  for (const p of problems) console.log('  ' + p);
  console.log(`${plans.length} routes · ${images.size} pictures: ${counts.ok} ok, ${counts.stale} stale, ${counts.missing} missing · ${(total / 1024).toFixed(2)} MB${problems.length ? ` · ${problems.length} to fix` : ' · all current'}`);
  process.exit(problems.length ? 1 : 0);
}

// ---------- choose what to render ----------
let todo = [...images.keys()].filter((f) => (!only || images.get(f).routes.includes(only)) && (!parkOnly || images.get(f).render.park === parkOnly) && (!staleOnly || stateOf(f) !== 'ok'));
if (planOnly) todo = [];
const byPark = new Map();
for (const f of todo) { const k = images.get(f).render.park; if (!byPark.has(k)) byPark.set(k, []); byPark.get(k).push(f); }
const parks = [...byPark.keys()].slice(0, limit);
console.log(`${plans.length} routes · ${images.size} pictures · planned in ${Date.now() - t0} ms · rendering ${parks.reduce((n, k) => n + byPark.get(k).length, 0)} in ${parks.length} world${parks.length === 1 ? '' : 's'}${byPark.size > parks.length ? ` (${byPark.size - parks.length} more worlds left: run again)` : ''}`);
await mkdir(resolve(ROOT, DIR), { recursive: true });
if (!parks.length) { await writeManifests(); console.log(`Wrote ${INDEX}`); process.exit(0); }

// ---------- render ----------
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
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;   // streamed terrain behind a proxy
const launch = () => chromium.launch({ executablePath: chrome, proxy,
  args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'] });
let browser = await launch();
const W = SIZE.width * RENDER.scale, H = SIZE.height * RENDER.scale;
let failed = 0, done = 0;
const tRender = Date.now();

async function renderPark(park, files) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(0);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  // chase spots in riding order, then the fixed postcards (views)
  files.sort((a, b) => (images.get(a).render.s ?? 1e9) - (images.get(b).render.s ?? 1e9));
  const first = images.get(files[0]).render;
  const q = new URLSearchParams({ park, clean: '1', quality, pos: String(first.s ?? 0), time: RENDER.time, weather: RENDER.weather });
  const tp = Date.now();
  await page.goto(`${base}/tools/world-preview.html?${q}`);
  await page.waitForFunction(() => window.world?.terrain && (window.world.terrain.kit || !window.world.stylized) && window.world._camInit && window.world.rider?.triangles, null, { timeout: 240000, polling: 500 });
  await page.evaluate(async (cam) => { const pose = await import('/js/world/pose.js'); pose.CAMERAS.postcard = cam; window.world.camKey = 'postcard'; window.world._camInit = false; }, RENDER.camera);
  console.log(`  ${park}: world ready in ${Math.round((Date.now() - tp) / 1000)} s`);
  for (const file of files) {
    const r0 = Date.now(), { render } = images.get(file);
    errors.length = 0;
    try {
      if (render.s != null) await page.evaluate((s) => { const w = window.world; window.preview.seek(s); w._camInit = false; if (!w.running) w.start(); }, render.s);
      else await page.evaluate(() => { const w = window.world; if (!w.running) w.start(); });
      // let the world follow (camera, terrain and city chunks streamed in frames), then build what's queued
      await page.waitForFunction(() => window.world._camInit, null, { timeout: 60000, polling: 100 });
      await page.waitForTimeout(1200);
      const t1 = Date.now();
      await page.waitForFunction(() => { const w = window.world; if (w.stylized) return !w.loading; const c = w.camera.position; w.terrain.update(c.x, c.z); return w.terrain.loadingCount === 0 && w.terrain.stats.ready > 4; }, null, { timeout: 180000, polling: 500 });
      const t2 = Date.now();
      const url = await page.evaluate(async ({ render, W, H, out, webp }) => {
        const w = window.world, t = w.terrain, city = t.city;
        w.stop();
        const cam = w.camera, P = w.proj;
        if (render.view) {
          // a scene view's postcard camera (as tools/snap_cam.mjs --views)
          const sc = w.route.scene, v = (sc.views || []).find((x) => x.name === render.view);
          const a = P.toLocal(v.cam.lat, v.cam.lon), b = P.toLocal(v.look.lat, v.look.lon);
          cam.position.set(a.x, v.cam.abs ?? t.heightAt(a.x, a.z) + (v.cam.up ?? 30), a.z);
          cam.lookAt(b.x, v.look.abs ?? t.heightAt(b.x, b.z) + (v.look.up ?? 0), b.z);
        } else if (render.aim) {
          const b = P.toLocal(render.aim.lat, render.aim.lon);
          cam.lookAt(b.x, (t.heightAt(b.x, b.z) ?? cam.position.y) + (render.aim.up || 0), b.z);
        }
        cam.updateMatrixWorld(); w.sky.position.copy(cam.position);
        const cx = cam.position.x, cz = cam.position.z;
        for (let k = 0; k < 60 && city?._pending?.length; k++) { city._warm = false; city._stream(cx, cz); }
        for (let k = 0; k < 600 && (t.forestQueue?.length || k < 2); k++) { t._lastX = Infinity; t.update(cx, cz); }
        city?.streetKit?.flush();
        if (w.baked && !w.baked.ready) w.baked.bakeNow();   // [baked-light] once per world (as snap_cam)
        city?.streetKit?.flush();
        w.renderer.shadowMap.needsUpdate = true;
        if (w._render) w._render(); else w.renderer.render(w.scene, cam);
        const c = document.createElement('canvas'); c.width = out[0]; c.height = out[1];
        const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(w.renderer.domElement, 0, 0, W, H, 0, 0, out[0], out[1]);
        return c.toDataURL('image/webp', webp);
      }, { render, W, H, out: [SIZE.width, SIZE.height], webp: RENDER.webp });
      if (!url.startsWith('data:image/webp')) throw new Error('no WebP encoder in this browser');
      const buf = Buffer.from(url.split(',')[1], 'base64');
      await writeFile(resolve(ROOT, DIR, file), buf);
      renders.images[file] = { park, ...(render.s != null ? { s: render.s } : {}), ...(render.view ? { view: render.view } : {}), ...(render.aim ? { aim: render.aim } : {}), inputs: images.get(file).inputs, sha: sha(buf), bytes: buf.length };
      done++;
      console.log(`${errors.length ? 'ERR' : 'ok '} ${file.padEnd(46)} ${(buf.length / 1024).toFixed(1).padStart(5)} kB  ${Math.round((Date.now() - r0) / 1000)} s (seek ${Math.round((t1 - r0) / 1000)}, stream ${Math.round((t2 - t1) / 1000)}, draw ${Math.round((Date.now() - t2) / 1000)})${errors.length ? '  ' + errors.slice(0, 2).join(' | ').slice(0, 200) : ''}`);
      if (errors.length) failed++;
    } catch (e) {
      failed++;
      console.log(`ERR ${file}: ${e.message.split('\n')[0]}`);
      if (/crash|closed|Target/.test(e.message)) { try { await browser.close(); } catch { /* gone */ } browser = await launch(); break; }
    }
  }
  await page.close().catch(() => {});
}

for (const park of parks) {
  await renderPark(park, byPark.get(park));
  await writeManifests();   // keep what's done if a later world fails
}
await browser.close(); server.close();
const used = new Set(images.keys());
if (!only && !parkOnly) for (const f of readdirSync(resolve(ROOT, DIR)).filter((x) => x.endsWith('.webp'))) if (!used.has(f)) { unlinkSync(resolve(ROOT, DIR, f)); console.log(`removed ${f} (no route uses it)`); }
await writeManifests();
console.log(`Rendered ${done} picture${done === 1 ? '' : 's'} in ${Math.round((Date.now() - tRender) / 1000)} s${failed ? ` · ${failed} failed` : ''} → ${DIR}/`);
process.exitCode = failed ? 1 : 0;
