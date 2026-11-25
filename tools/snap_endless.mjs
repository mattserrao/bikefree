// Snapshots of the endless map's world, headless: tools/endless-preview.html in Chrome.
//
//   node tools/snap_endless.mjs <name>@<metres>[:day][:modes] …  [--seed 1] [--software] [--size 1280x720] [--quality balanced] [--out tools/snapshots]
//   node tools/snap_endless.mjs farm@800 forest@9000:0.5 climb@3300:0.4:rolling,rolling,climb,climb
// Each shot places the rider <metres> along the course; day is the cycle's time (0–1); modes the miles' terrain types.
// Writes <out>/endless-<name>.png and prints frame stats.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const evalJs = opt('--eval', null);   // run in the page after the frame (the world as `w`, THREE as `T`): its result is printed (tools/qc_map.mjs endless)
const software = flag('--software'), seed = opt('--seed', '1'), quality = opt('--quality', 'balanced'), out = opt('--out', 'tools/snapshots'), view = opt('--view', null);
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  let body; try { body = await readFile(join(ROOT, path)); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.env.SNAP_DEBUG) console.log('  console:', m.text().slice(0, 300)); });
await mkdir(resolve(ROOT, out), { recursive: true });
for (const spec of args) {
  const [name, rest] = spec.split('@'), [at, day, modes] = rest.split(':');
  errors.length = 0; const t0 = Date.now();
  await page.goto(`${base}/tools/endless-preview.html?${new URLSearchParams({ seed, at, quality, ...(day ? { day } : {}), ...(modes ? { modes } : {}) })}`);
  await page.waitForFunction(() => window.bfWorld && window.bfWorld.readiness().ready, null, { timeout: 240000, polling: 500 })
    .catch(async (e) => { console.log('  not ready:', await page.evaluate(() => JSON.stringify(window.bfWorld?.readiness?.()?.steps?.map((s) => [s.key, s.p.toFixed(2)]))).catch(() => '?'), errors.slice(0, 3)); });
  const stats = await page.evaluate(async (view) => {
    const w = window.bfWorld;
    w.stop();
    for (let k = 0; k < 6; k++) w._stream(w.camera.position, 1e9);
    if (view) { const [back, up] = view.split(',').map(Number), r = w.rider.group.position, f = w._pose.flat; w.camera.position.set(r.x - f.x * back, r.y + up, r.z - f.z * back); w.camera.lookAt(r.x + f.x * back, r.y, r.z + f.z * back); }
    w.camera.updateMatrixWorld();
    if (w.forest) { w.forest._at = null; w.forest._lastRebuild = -99; w.forest.tick(w.camera); w.forest.impMat && (w.forest.impMat.uniforms.uNow.value = 1e9); }
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    w._draw();
    const i = w.renderer.info.render, st = window.route.endlessRide.stateAt(w.p);
    return { calls: i.calls, triangles: i.triangles, tiles: w.tiles.size, biome: st.biome, mode: st.mode, day: w.dayAt.toFixed(2) };
  }, view);
  if (evalJs) console.log('  eval:', JSON.stringify(await page.evaluate(async (code) => { const w = window.bfWorld; const T = await import('/vendor/three.module.min.js'); return eval(code); }, evalJs)));
  const file = resolve(ROOT, out, `endless-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${name}: ${stats.biome}, ${stats.mode}, day ${stats.day} · ${stats.calls} draw calls, ${(stats.triangles / 1e6).toFixed(2)} M triangles, ${stats.tiles} tiles · ${((Date.now() - t0) / 1000).toFixed(1)} s → ${file.slice(ROOT.length)}${errors.length ? `\n  errors: ${errors.slice(0, 4).join(' | ')}` : ''}`);
}
await browser.close();
server.close();
