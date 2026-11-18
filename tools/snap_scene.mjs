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
// --arches 22350:START:Avalanche Creek,47310:FINISH:Logan Pass (the start / finish arches),
// --path e1+,e3+ (a route with a ride network: follow that path through its junctions; @metres along the path),
// --chrome <path> (default: CHROME env, else the usual Mac/Linux locations), --software (no GPU).
// --png (lossless), --fingerprint (hash of every object for refactor checks, with a frozen clock, seeded
// random and no streamed real horizon, so runs repeat exactly; see tools/toolbox_guard.mjs).
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
const arches = opt('--arches', null);   // course arches: <startM>[:TITLE[:sub]][,<finishM>[:TITLE[:sub]]] (js/world/toolbox/roadside/course-arches.js)
const pathKeys = opt('--path', null);   // a ride network's path (e1+,e3+): @metres are then path metres (js/network.js)
const areaId = opt('--area', null);     // a city of areas (PLAN 5.4): draw this area (while it covers the spot), not the one the path would pick
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const software = flag('--software');
const breakdown = flag('--breakdown');   // list draw calls by object
const png = flag('--png');   // [toolbox] lossless PNG instead of JPEG (pixel-exact refactor checks)
const fingerprint = flag('--fingerprint');   // [toolbox] hash of every mesh, matrix, attribute and material in the scene
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
if (!args.length) { console.log('usage: npm run snap -- <park>[@metres][:camera][:time][:season][:weather][:gentle|bold|current|standard] …'); process.exit(1); }

const LOOKS = ['gentle', 'bold', 'current', 'standard'];   // current = no cartoon look, whatever the scene says; standard = the toolbox standard (gentle + baked light)
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
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;   // tile downloads behind a proxy
const browser = await chromium.launch({ executablePath: chrome, proxy,
  args: [...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu']), '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width, height } });
// [toolbox] --fingerprint: a seeded Math.random and a clock that only moves when asked, so two builds of the
// same scene are byte-identical (water, weather and traffic otherwise depend on wall time)
if (fingerprint) await page.addInitScript(() => {
  let s = 0x9e3779b9; Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const T0 = 1767268800000; let tick = 0; window.__tick = (ms) => { tick += ms; };
  performance.now = () => 1000 + tick; Date.now = () => T0 + tick;
  const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf(() => cb(1000 + tick));
});
page.setDefaultTimeout(0);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await mkdir(resolve(ROOT, out), { recursive: true });
const rows = [];
for (const shot of shots) {
  const t0 = Date.now(); errors.length = 0;
  const q = new URLSearchParams({ park: shot.park, clean: '1', quality, ...(shot.pos ? { pos: shot.pos } : {}), ...(pathKeys ? { path: pathKeys } : {}), ...(areaId ? { area: areaId } : {}), ...(shot.time ? { time: shot.time } : {}), ...(shot.season ? { season: shot.season } : {}), ...(shot.weather ? { weather: shot.weather } : {}), ...(shot.look === 'standard' ? { standard: '1' } : shot.look ? { look: shot.look === 'current' ? 'none' : shot.look } : {}), ...(fingerprint ? { horizon: '0' } : {}), ...(arches ? { arches } : {}) });
  await page.goto(`${base}/tools/world-preview.html?${q}`);
  if (breakdown) await page.evaluate(() => { window.__breakdown = true; });
  await page.evaluate(([p, f]) => { window.__png = p; window.__fingerprint = f; }, [png, fingerprint]);   // [toolbox]
  await page.waitForFunction(() => window.world?.terrain && (window.world.terrain.kit || !window.world.stylized) && window.world._camInit && window.world.rider?.triangles, null, { timeout: 180000, polling: 500 });
  // a city of areas: wait until the areas the path reaches soon are built too (resident, hidden), as at a portal
  await page.waitForFunction(() => { const w = window.world; return !w._multi || (w._resT != null && [...w.path.areasNear(w.p)].every((id) => w.areas.get(id)?.ready) && [...w.areas.values()].every((a) => a.ready)); }, null, { timeout: 180000, polling: 500 });
  // streamed terrain (non-stylized and wireframe scenes): wait until the visible tiles are in
  await page.waitForFunction(() => { const w = window.world; if (w.stylized) return true; const c = w.camera.position; w.terrain.update(c.x, c.z); return w.terrain.loadingCount === 0 && w.terrain.stats.ready > 4; }, null, { timeout: 180000, polling: 1000 });
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
    // [toolbox] --fingerprint: one hash per object of its geometry, transforms and material settings, so a refactor
    // can prove the scene is built identically (pixels alone miss off-screen changes)
    let fp = null;
    const THREE = window.__fingerprint ? await import('/vendor/three.module.min.js') : null;
    if (window.__fingerprint) {
      const H = (h, bytes) => { for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619) >>> 0; return h; };
      const num = (h, v) => H(h, new Uint8Array(new Float64Array([Math.round(v * 1e4) / 1e4]).buffer));
      const str = (h, s) => H(h, new TextEncoder().encode(String(s)));
      const arr = (h, a) => { if (!a) return h; const f = a instanceof Float32Array ? a.map((v) => Math.round(v * 1e3) / 1e3) : a; return H(h, new Uint8Array(f.buffer, f.byteOffset, f.byteLength)); };
      const mat = (h, m) => { if (!m) return h; for (const k of ['type', 'name', 'side', 'transparent', 'opacity', 'vertexColors', 'flatShading', 'depthWrite', 'alphaTest', 'fog', 'wireframe']) h = str(h, m[k]); if (m.color) h = str(h, m.color.getHexString()); if (m.emissive) h = str(h, m.emissive.getHexString()); if (m.map) h = str(h, m.map.image ? (m.map.image.width + 'x' + m.map.image.height) : 'map'); h = str(h, patched(m)); if (m.defines) h = str(h, JSON.stringify(m.defines)); if (m.uniforms) for (const [k, u] of Object.entries(m.uniforms)) { const v = u?.value; h = str(h, k); if (typeof v === 'number') h = num(h, v); else if (v?.isColor) h = str(h, v.getHexString()); else if (v?.isVector3 || v?.isVector2) h = str(h, v.toArray().map((x) => x.toFixed(3)).join()); } if (m.vertexShader) h = str(h, m.vertexShader); if (m.fragmentShader) h = str(h, m.fragmentShader); return h; };
      // a material's shader patches, by what they produce: run its onBeforeCompile on the stock shader for its
      // type and hash the result (so moving or reformatting the patch code doesn't count as a change)
      const LIB = { MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong', MeshBasicMaterial: 'basic', MeshToonMaterial: 'toon', PointsMaterial: 'points', LineBasicMaterial: 'basic', MeshDepthMaterial: 'depth', MeshDistanceMaterial: 'distanceRGBA', SpriteMaterial: 'sprite' };
      const sources = new Map();
      const patched = (m) => {
        if (!m.onBeforeCompile || m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) return '';
        if (sources.has(m)) return sources.get(m);
        const lib = THREE.ShaderLib[LIB[m.type]] || { vertexShader: m.vertexShader || '', fragmentShader: m.fragmentShader || '' };
        const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, defines: {} };
        let out;
        try { m.onBeforeCompile(shader, w.renderer); out = shader.vertexShader + '\n' + shader.fragmentShader + '\n' + Object.keys(shader.uniforms).sort().join(); } catch (e) { out = 'error:' + e.message; }
        out = out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');   // comments and spacing don't change a shader
        sources.set(m, out); return out;
      };
      const per = {}; let all = 2166136261, n = 0;
      w.scene.updateMatrixWorld(true);
      w.scene.traverse((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
        let h = 2166136261; h = str(h, o.type + '|' + o.name + '|' + o.visible + '|' + o.castShadow + '|' + o.receiveShadow + '|' + o.renderOrder + '|' + o.frustumCulled);
        for (const v of o.matrixWorld.elements) h = num(h, v);
        const g = o.geometry; if (g) { if (g.index) h = arr(h, g.index.array); for (const [k, a] of Object.entries(g.attributes)) { h = str(h, k); h = arr(h, a.array); } for (const gr of g.groups) h = str(h, gr.start + ',' + gr.count + ',' + gr.materialIndex); }
        if (o.isInstancedMesh) { h = str(h, o.count); h = arr(h, o.instanceMatrix.array.subarray(0, o.count * 16)); if (o.instanceColor) h = arr(h, o.instanceColor.array.subarray(0, o.count * 3)); }
        for (const m of [].concat(o.material || [])) h = mat(h, m);
        const key = (o.name || o.parent?.name || o.type).replace(/-?[0-9]+/g, '#').slice(0, 44);
        per[key] = ((per[key] || 0) + h) >>> 0; all = (all + h) >>> 0; n++;
      });
      fp = { all: all.toString(16), objects: n, per };
    }
    return { fp, breakdown, url: w.renderer.domElement.toDataURL(window.__png ? 'image/png' : 'image/jpeg', .9), calls: info.calls, triangles: info.triangles, bake: window.__bake || null,
      areas: w._multi ? [...w.areas.values()].map((a) => `${a.id}${a === w.area ? '*' : ''}`).join(' ') : null, memory: { ...w.renderer.info.memory, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null } };
  });
  const file = join(out, `${shot.name}.${png ? 'png' : 'jpg'}`);
  await writeFile(resolve(ROOT, file), Buffer.from(r.url.split(',')[1], 'base64'));
  rows.push({ shot: shot.spec, file, calls: r.calls, triangles: r.triangles, seconds: Math.round((Date.now() - t0) / 1000), errors: [...errors], ...(r.areas ? { areas: r.areas } : {}), memory: r.memory, ...(r.bake ? { bake: r.bake } : {}), ...(r.fp ? { fingerprint: r.fp } : {}) });   // [baked-light] bake stats
  if (r.breakdown) console.log(r.breakdown.map(([k, n, t]) => `   ${String(n).padStart(4)}  ${String(Math.round(t / 1000)).padStart(5)} k  ${k}`).join('\n'));   // [w2-budget] calls, triangles
  console.log(`${errors.length ? 'ERR ' : 'ok  '} ${shot.spec.padEnd(34)} ${String(r.calls).padStart(5)} calls ${(r.triangles / 1e6).toFixed(2).padStart(6)} M tris${r.areas ? ` · areas ${r.areas}` : ''} · ${r.memory.geometries} geometries, ${r.memory.textures} textures, heap ${r.memory.heapMB} MB  → ${file}`);
  for (const e of errors) console.log(`       ${e.slice(0, 200)}`);
}
await writeFile(resolve(ROOT, out, 'snapshots.json'), JSON.stringify({ quality, size: `${width}x${height}`, software, rows }, null, 2));
await browser.close(); server.close();
process.exitCode = rows.some((r) => r.errors.length) ? 1 : 0;
