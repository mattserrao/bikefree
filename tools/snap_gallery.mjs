// Renders the toolbox gallery (tools/toolbox-gallery.html) headlessly and saves a full-page image, so the
// model catalogue can be checked without a browser. Fails on any page error.
//
//   npm run gallery                            # → tools/snapshots/toolbox-gallery.png
//   node tools/snap_gallery.mjs --out /tmp/g.png --shade smooth --season fall --kit "pack: northeast"
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = resolve(ROOT, opt('--out', 'tools/snapshots/toolbox-gallery.png'));
const gallery = opt('--page', 'toolbox');
if (!['toolbox', 'textures', 'catalog'].includes(gallery)) throw new Error('--page must be toolbox, textures or catalog');
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
try {
await page.goto(`http://127.0.0.1:${server.address().port}/tools/${gallery}-gallery.html?${new URLSearchParams({ condition: opt('--condition', 'midday'), library: opt('--library', 'roads'),family:opt('--family',''),selection:opt('--selection','representatives'),limit:opt('--limit','24'),page:opt('--offset-page','0'),q:opt('--query',''),look:opt('--look',''),view:opt('--view','') })}`);
await page.waitForFunction(() => window.galleryReady || null, null, { timeout: 300000, polling: 500 });
for (const [sel, name] of [['#shade', '--shade'], ['#season', '--season']]) {
  const v = opt(name, null);
  if (v) { await page.selectOption(sel, v); await page.waitForFunction(() => !document.getElementById('stat').textContent.startsWith('building'), null, { timeout: 300000 }); }
}
const kit = opt('--kit', null);
if (kit) await page.selectOption('#kit', kit);
const stat = gallery === 'textures' ? await page.evaluate(() => `${window.textureStats.length} surface studies`) : await page.textContent('#stat');
await page.screenshot({ path: out, fullPage: true });
if (gallery === 'textures' && args.includes('--verify')) console.log(await page.evaluate(() => window.verifyTextures()));
if (gallery === 'catalog' && args.includes('--verify')) console.log(await page.evaluate(() => window.verifyCatalog()));
console.log(`${errors.length ? 'ERR' : 'ok '} ${stat} → ${out}`);
for (const e of errors) console.log('   ', e.slice(0, 200));
process.exitCode = errors.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  for (const e of errors) console.error(e.slice(0, 4000));
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
