// PGH GPU cost by feature (A/B): renders the same frame with one thing changed at a time and times render + finish.
//   node tools/perf_gpu_pgh.mjs [--lat --lon] [--size 640x360] [--software]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
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
const [W, H] = opt('--size', '640x360').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`${base}/tools/pgh-preview.html?${new URLSearchParams({ lat: opt('--lat', '40.42855'), lon: opt('--lon', '-79.9845'), quality: opt('--quality', 'balanced') })}`);
await page.waitForFunction(() => window.bfWorld && window.bfWorld.readiness().ready, null, { timeout: 300000, polling: 500 });
const out = await page.evaluate(async () => {
  const w = window.bfWorld; w.stop();
  const THREE = await import('/vendor/three.js');
  for (let k = 0; k < 400; k++) w._stream(w.camera.position.x, w.camera.position.z, 1e9);
  const time = (r = w.renderer, n = 3) => { const gl = r.getContext(), px = new Uint8Array(4); r.render(w.scene, w.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < n; i++) { r.render(w.scene, w.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return +((performance.now() - t0) / n).toFixed(1); };
  const res = { baseline: time() };
  const hide = (label, pred) => { const hid = []; w.scene.traverse((o) => { if (o.visible && pred(o)) { o.visible = false; hid.push(o); } }); res[label] = time(); for (const o of hid) o.visible = true; };
  const has = (o, re) => re.test(o.name || '');
  hide('- city buildings (facade shader)', (o) => o.isMesh && o.material?.customProgramCacheKey?.().includes?.('') && /Buildings|Homes|chunk/i.test(o.name));
  hide('- trees (pools + cards)', (o) => /^Trees|Tree cards/.test(o.name));
  hide('- ground tiles', (o) => o === w.water ? false : o.material === w.mats.ground);
  hide('- water plane', (o) => o === w.water);
  hide('- roads (surface shader)', (o) => o.material === w.mats.roadSurface || o.material === w.mats.road);
  hide('- storefronts', (o) => /^Storefronts/.test(o.name));
  hide('- heroes group', (o) => o === w.heroes.group);
  hide('- bridges', (o) => o === w.bridges?.group);
  hide('- city host group (all city)', (o) => o === w.city.host.group);
  // renderer options
  const canvas = w.renderer.domElement, size = w.renderer.getSize(new THREE.Vector2());
  const alt = (label, opts, pr = w.renderer.getPixelRatio()) => {
    const r = new THREE.WebGLRenderer({ powerPreference: 'high-performance', ...opts }); r.setPixelRatio(pr); r.setSize(size.x, size.y);
    r.outputColorSpace = w.renderer.outputColorSpace; r.toneMapping = w.renderer.toneMapping; r.toneMappingExposure = w.renderer.toneMappingExposure;
    r.render(w.scene, w.camera); res[label] = time(r); r.dispose(); r.forceContextLoss();
  };
  alt('renderer as is (new context)', { antialias: true, logarithmicDepthBuffer: true });
  alt('no logarithmic depth', { antialias: true, logarithmicDepthBuffer: false });
  alt('no MSAA', { antialias: false, logarithmicDepthBuffer: true });
  alt('neither', { antialias: false, logarithmicDepthBuffer: false });
  alt('neither, pixel ratio 2', { antialias: false, logarithmicDepthBuffer: false }, 2);
  alt('as is, pixel ratio 2', { antialias: true, logarithmicDepthBuffer: true }, 2);
  res.calls = w.renderer.info.render.calls; res.programs = w.renderer.info.programs.length;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
