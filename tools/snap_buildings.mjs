// Renders the building kit gallery (tools/buildings-gallery.html) headlessly: one image per style and view.
//
//   npm run gallery:buildings                                   # every style × street, aerial, close, roofs
//   node tools/snap_buildings.mjs --styles oisans,dauphine --views close --seed 2 --size 1600x900 --out /tmp
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_PRESETS } from '../js/world/toolbox/structures/buildings/presets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = resolve(ROOT, opt('--out', 'tools/snapshots'));
const styles = opt('--styles', Object.keys(STYLE_PRESETS).join(',')).split(',');
const views = opt('--views', 'street,aerial,close,roofs').split(',');
const seed = opt('--seed', '1');
const [w, h] = opt('--size', '1280x720').split('x').map(Number);
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
await mkdir(out, { recursive: true });
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 3000)); });
for (const s of styles) for (const v of views) {
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/buildings-gallery.html?style=${s}&view=${v}&seed=${seed}`);
  await page.waitForFunction(() => window.__ready || null, null, { timeout: 120000 });
  const file = join(out, `buildings-${s}-${v}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  const st = await page.evaluate(() => window.__stats);
  console.log(`${file}  ${st.buildings} buildings, ${st.calls} calls, ${(st.triangles / 1000).toFixed(0)}k tris drawn, built in ${st.ms} ms`);
}
await browser.close(); server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
