// PGH frame-time breakdown (CPU): rides the free ride at a steady speed for a while in headless Chrome and times each
// part of GraphWorld._frame (and the city's pieces), the long frames and what they were doing.
//   node tools/perf_pgh.mjs [--lat 40.4469 --lon -80.0058] [--quality balanced] [--seconds 20] [--speed 9] [--software]
//   --profile  also a CPU profile: the functions with the most time of their own
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let body; try { body = await readFile(join(ROOT, path)); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = opt('--chrome', process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync));
const { chromium } = await import('playwright-core');
const software = args.includes('--software');
const browser = await chromium.launch({ executablePath: chrome, args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'] });
const [VW, VH] = opt('--size', '640x360').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const q = new URLSearchParams({ lat: opt('--lat', '40.4469'), lon: opt('--lon', '-80.0058'), quality: opt('--quality', 'balanced') });
await page.goto(`${base}/tools/pgh-preview.html?${q}`);
await page.waitForFunction(() => window.world && window.world.readiness().ready, null, { timeout: 300000, polling: 500 });
const cdp = args.includes('--profile') ? await page.context().newCDPSession(page) : null;
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
const res = await page.evaluate(async ({ seconds, speed }) => {
  const w = window.world, T = {}, frames = [];
  let cur = null;
  const wrap = (obj, name, label) => {
    const f = obj[name]; if (typeof f !== 'function') return;
    obj[name] = function (...a) {
      const t0 = performance.now(); const r = f.apply(this, a); const d = performance.now() - t0;
      (T[label] ||= { n: 0, ms: 0, max: 0 }); T[label].n++; T[label].ms += d; T[label].max = Math.max(T[label].max, d);
      if (cur) cur[label] = (cur[label] || 0) + d;
      return r;
    };
  };
  w.setPreload(false);
  const c = w.city;
  wrap(w, '_stream', 'world._stream'); wrap(w, '_release', '  world release'); wrap(w, '_nodeWidths', '  nodeWidths');
  wrap(c, 'stream', 'city.stream'); wrap(c.kit, 'planned', '  kit.planned'); wrap(c, '_carMeshes', '  carMeshes'); wrap(c.host, 'addGlows', '  addGlows'); wrap(c, '_frontsOf', '  frontsOf'); wrap(c, 'tick', 'city.tick'); wrap(c, '_poolTrees', '  poolTrees'); 
  wrap(c, '_release', '  city release');
  wrap(w.heroes, 'tick', 'heroes.tick'); if (w.bridges) wrap(w.bridges, 'tick', 'bridges.tick');
  wrap(w.rider, 'update', 'rider.update'); wrap(w, '_updateCamera', 'camera'); wrap(w.renderer, 'render', 'render (CPU)');
  const pos0 = w.p, t0 = performance.now();
  w.setSource(() => ({ pos: pos0 + (performance.now() - t0) / 1000 * speed, speed, cadence: 85, riding: true }));
  // the loop re-requests this._frame each frame: a wrapper there times every frame
  const f = w._frame;
  w.stop();
  w._frame = (now) => { cur = { t: performance.now() }; f(now); cur.total = performance.now() - cur.t; frames.push(cur); cur = null; };
  w.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  w.stop();
  const tot = frames.map((x) => x.total).sort((a, b) => a - b);
  const long = frames.filter((x) => x.total > 16).sort((a, b) => b.total - a.total).slice(0, 8).map((x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => k !== 't' && v > 1).map(([k, v]) => [k, +v.toFixed(1)])));
  const scene = { objects: 0, meshes: 0, instanced: 0, visibleMeshes: 0 };
  w.scene.traverse((o) => { scene.objects++; if (o.isMesh) { scene.meshes++; if (o.isInstancedMesh) scene.instanced++; let v = o.visible, p = o.parent; while (v && p) { v = p.visible; p = p.parent; } if (v) scene.visibleMeshes++; } });
  const info = w.renderer.info;
  return { frames: frames.length, rodeM: Math.round(w.p - pos0), fps: +(frames.length / seconds).toFixed(1),
    frameMs: { median: +tot[tot.length >> 1].toFixed(2), p95: +tot[Math.floor(tot.length * 0.95)].toFixed(2), max: +tot[tot.length - 1].toFixed(1), over16: frames.filter((x) => x.total > 16).length },
    parts: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, { perFrame: +(v.ms / frames.length).toFixed(2), calls: v.n, max: +v.max.toFixed(1) }])),
    median: Object.fromEntries(Object.keys(T).map((k) => { const a = frames.map((x) => x[k] || 0).sort((p, q) => p - q); return [k, +a[a.length >> 1].toFixed(2)]; })),
    long, scene, programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures, calls: info.render.calls, pixelRatio: w.renderer.getPixelRatio(),
    tiles: w.tiles.size, cityTiles: c.tiles.size, sectors: c.sectors.size };
}, { seconds: +opt('--seconds', 20), speed: +opt('--speed', 9) });
if (cdp) {
  // the functions with the most time of their own (--profile): what the long frames were doing
  const { profile } = await cdp.send('Profiler.stop'), self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, k) => { const n = byId.get(id), f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + (dt[k] || 0) / 1000); });
  res.profile = [...self].filter(([k]) => !/\(idle\)|\(program\)|\(garbage/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)} ms  ${k}`);
}
console.log(JSON.stringify(res, null, 1));
await browser.close(); server.close();
