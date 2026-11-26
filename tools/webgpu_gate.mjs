// The WebGPU gate bench headless (tools/webgpu-gate.html): classic vs WebGPU vs the WebGL2 fallback on one map.
//   node tools/webgpu_gate.mjs [--map endless|routes/cities/pgh.json] [--lat 40.4413 --lon -80.0005] [--quality balanced] [--frames 120]
// Headless numbers come from a software GPU (SwiftShader): good for "it runs" and draw/triangle counts, not timings.
// The real gate is the page on the M4 Air and the iPhone (githack link, tap Run).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const params = new URLSearchParams({ auto: '1', map: opt('--map', 'routes/cities/pgh.json'), quality: opt('--quality', 'balanced'), frames: opt('--frames', '120') });
if (opt('--lat')) { params.set('lat', opt('--lat')); params.set('lon', opt('--lon')); }
if (opt('--at')) params.set('at', opt('--at'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  let body; try { body = await readFile(join(ROOT, path)); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = await import('playwright-core');
const chrome = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/tools/webgpu-gate.html?${params}`);
await page.waitForFunction(() => window.gateResult, null, { timeout: 900000, polling: 1000 });
console.log(JSON.stringify(await page.evaluate(() => window.gateResult), null, 1));
await browser.close(); server.close();
