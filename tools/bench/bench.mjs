// The graphics bench: the same fixed views of a map measured before and after a change (tools/bench/views.json).
//   node tools/bench/bench.mjs --label before [--maps cny,skan] [--only name,...,ride] [--size 640x360] [--ride-size 256x144]
//       → tools/bench/results/<label>.json and a screenshot of every still in tools/bench/results/<label>/
//       [--effects none | water,shoreline,…]   the maps' effects replaced for the run (A/B one effect on the same code)
//   node tools/bench/bench.mjs --compare before after   → a table of the changes (and results/<before>-vs-<after>.md)
// Per still: draw calls, triangles, GPU time of one frame (render + a pixel read back, mean of 6), the programs,
// geometries and textures alive, the JS heap. Per ride (the rider at a steady speed through the live loop): frames,
// median / 95th-percentile / worst frame and how many went over 16.7 ms. Load: seconds until the world is ready.
// Headless Chrome here may fall back to a software GPU (SwiftShader): its GPU ms then track the pixel and vertex work,
// not a real card's time. Compare runs on the same machine, never across machines.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url)), HERE = fileURLToPath(new URL('./', import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RESULTS = resolve(HERE, 'results');

if (args.includes('--compare')) {
  const i = args.indexOf('--compare'), [a, b] = [args[i + 1], args[i + 2]];
  const A = JSON.parse(await readFile(resolve(RESULTS, `${a}.json`), 'utf8')), B = JSON.parse(await readFile(resolve(RESULTS, `${b}.json`), 'utf8'));
  const pct = (x, y) => (x ? `${y - x >= 0 ? '+' : ''}${(((y - x) / x) * 100).toFixed(0)}%` : '');
  const cell = (x, y, f = (v) => v) => (x == null || y == null ? '–' : `${f(x)} → ${f(y)} (${pct(x, y)})`);
  const lines = [`# Graphics bench: ${a} vs ${b}`, '', `${A.when} (${A.commit}) vs ${B.when} (${B.commit}) · ${B.size} · ${B.gpu}`, ''];
  for (const map of Object.keys(B.maps)) {
    const ma = A.maps[map] || { stills: {} }, mb = B.maps[map];
    lines.push(`## ${map}`, '', `load ${cell(ma.loadS, mb.loadS)} s`, '');
    lines.push('| view | calls | triangles (M) | GPU ms | geometries | textures |', '|---|---|---|---|---|---|');
    for (const [n, s] of Object.entries(mb.stills)) {
      const r = ma.stills[n] || {};
      lines.push(`| ${n} | ${cell(r.calls, s.calls)} | ${cell(r.triangles, s.triangles, (v) => (v / 1e6).toFixed(2))} | ${cell(r.gpuMs, s.gpuMs)} | ${cell(r.geometries, s.geometries)} | ${cell(r.textures, s.textures)} |`);
    }
    const ra = ma.ride || {}, rb = mb.ride || {};
    lines.push('', `ride: fps ${cell(ra.fps, rb.fps)} · median ${cell(ra.medianMs, rb.medianMs)} ms · p95 ${cell(ra.p95Ms, rb.p95Ms)} ms · over 16.7 ms ${cell(ra.over16, rb.over16)} · heap ${cell(ra.heapMB, rb.heapMB)} MB`, '');
  }
  const md = lines.join('\n');
  await writeFile(resolve(RESULTS, `${a}-vs-${b}.md`), md + '\n');
  console.log(md);
  process.exit(0);
}

const label = opt('--label', 'run'), VIEWS = JSON.parse(await readFile(resolve(HERE, 'views.json'), 'utf8'));
const maps = opt('--maps', Object.keys(VIEWS).filter((k) => k !== 'note').join(',')).split(','), only = opt('--only', null)?.split(',');
const [VW, VH] = opt('--size', '640x360').split('x').map(Number);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
// --effects a,b (or none): the maps' "effects" block replaced for this run (an A/B of one effect on the same code)
const fx = opt('--effects', null), fxOnly = fx == null ? null : fx === 'none' ? [] : fx.split(',');
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let body; try { body = await readFile(join(ROOT, path)); } catch { res.writeHead(404).end(); return; }
  if (fxOnly && /^routes[/\\]cities[/\\][a-z]+\.json$/.test(path)) {
    const j = JSON.parse(body); if (j.format === 'bikefree-graph-1') { const all = j.effects || {}; j.effects = Object.fromEntries(fxOnly.map((k) => [k, all[k] || {}])); body = Buffer.from(JSON.stringify(j)); }
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = opt('--chrome', process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync));
const { chromium } = await import('playwright-core');
const software = args.includes('--software');
const browser = await chromium.launch({ executablePath: chrome, args: [...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu']), '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const { execSync } = await import('node:child_process');
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() + (execSync('git status --porcelain -- js', { cwd: ROOT }).toString().trim() ? '+dirty' : ''); } catch { return '?'; } })();
const out = { label, when: new Date().toISOString(), commit, effects: fx ?? 'as the maps set them', size: `${VW}x${VH}`, gpu: '?', maps: {} };
await mkdir(resolve(RESULTS, label), { recursive: true });

const [RW, RH] = opt('--ride-size', '256x144').split('x').map(Number);   // (the ride small: a software GPU would otherwise set the pace, not the frame's CPU work)
const open = async (graph, at, w = VW, h = VH) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const [lat, lon] = at.split(',');
  const t0 = Date.now();
  await page.goto(`${base}/tools/pgh-preview.html?${new URLSearchParams({ graph, lat, lon, dir: '+', at: 40, quality: opt('--quality', 'balanced') })}`);
  await page.waitForFunction(() => window.world && window.world.readiness().ready, null, { timeout: 300000, polling: 250 });
  return { page, errors, loadS: +((Date.now() - t0) / 1000).toFixed(1) };
};

for (const map of maps) {
  const M = VIEWS[map]; if (!M) { console.log(`no views for ${map}`); continue; }
  const R = (out.maps[map] = { loadS: null, stills: {}, ride: null });
  for (const v of M.stills) {
    if (only && !only.includes(v.name)) continue;
    const { page, errors, loadS } = await open(M.graph, v.at);
    R.loadS ??= loadS;
    const s = await page.evaluate(async (cam) => {
      const w = window.world; w.stop();
      if (cam) {
        const [ea, eo, eu, la, lo, lu] = cam.split(',').map(Number), y = (p) => Math.max(w._groundH(p.x, p.z), w.poolAt(p.x, p.z));
        const e = w.proj.toLocal(ea, eo), t = w.proj.toLocal(la, lo);
        w.camera.position.set(e.x, y(e) + eu, e.z); w.camera.lookAt(t.x, y(t) + lu, t.z);
      }
      for (let k = 0; k < 400; k++) w._stream(w.camera.position.x, w.camera.position.z, 1e9);
      if (w.baked) { w.baked.bakeNow(); w.baked.tick(1); w.baked.tick(1); }
      w.camera.updateMatrixWorld();
      if (w.city?.forest) { w.city.forest._at = null; w.city.forest.tick(w.camera); w.city.forest.impMat.uniforms.uNow.value = 1e9; }
      const r = w.renderer, gl = r.getContext(), px = new Uint8Array(4);
      r.info.autoReset = false; r.info.reset(); r.render(w.scene, w.camera);
      const calls = r.info.render.calls, triangles = r.info.render.triangles;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const N = 6, t0 = performance.now();
      for (let i = 0; i < N; i++) { r.render(w.scene, w.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      const gpuMs = +((performance.now() - t0) / N).toFixed(1);
      r.info.autoReset = true;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { calls, triangles, gpuMs, programs: r.info.programs.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };
    }, v.cam || null);
    out.gpu = s.gpu; delete s.gpu;
    R.stills[v.name] = { ...s, loadS, errors: errors.length };
    await page.screenshot({ path: resolve(RESULTS, label, `${map}-${v.name}.png`) });
    console.log(`${map}/${v.name}: ${s.calls} calls, ${(s.triangles / 1e6).toFixed(2)} M tris, ${s.gpuMs} ms GPU, ${s.geometries} geometries, load ${loadS} s${errors.length ? ` · ${errors.length} errors: ${errors[0]}` : ''}`);
    await page.close();
  }
  if (M.ride && (!only || only.includes('ride'))) {
    const { page } = await open(M.graph, M.ride.at, RW, RH);
    R.ride = await page.evaluate(async ({ seconds, speed }) => {
      const w = window.world, frames = [];
      w.setPreload?.(false);
      const pos0 = w.p, t0 = performance.now();
      w.setSource(() => ({ pos: pos0 + ((performance.now() - t0) / 1000) * speed, speed, cadence: 85, riding: true }));
      const f = w._frame; w.stop();
      let last = null;
      w._frame = (now) => { const a = performance.now(); f(now); const b = performance.now(); frames.push({ cpu: b - a, gap: last == null ? null : a - last }); last = a; };
      w.start();
      await new Promise((r) => setTimeout(r, seconds * 1000));
      w.stop();
      const gaps = frames.map((x) => x.gap).filter((x) => x != null).sort((p, q) => p - q), cpu = frames.map((x) => x.cpu).sort((p, q) => p - q);
      const q = (a, k) => +a[Math.min(a.length - 1, Math.floor(a.length * k))].toFixed(1);
      return { frames: frames.length, fps: +(frames.length / seconds).toFixed(1), medianMs: q(gaps, .5), p95Ms: q(gaps, .95), worstMs: q(gaps, 1), over16: gaps.filter((x) => x > 16.7).length,
        cpuMedianMs: q(cpu, .5), cpuP95Ms: q(cpu, .95), rodeM: Math.round(w.p - pos0), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
    }, M.ride);
    console.log(`${map}/ride: ${R.ride.fps} fps, median ${R.ride.medianMs} ms, p95 ${R.ride.p95Ms} ms, worst ${R.ride.worstMs} ms, ${R.ride.over16} over 16.7 ms (CPU median ${R.ride.cpuMedianMs} ms)`);
    await page.close();
  }
}
await writeFile(resolve(RESULTS, `${label}.json`), JSON.stringify(out, null, 1) + '\n');
console.log(`→ tools/bench/results/${label}.json (${out.gpu})`);
await browser.close(); server.close();
