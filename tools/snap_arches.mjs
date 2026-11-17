#!/usr/bin/env node
// Design renders of the course arches (tools/arch-preview.html): the start and finish on a plain road,
// front-on, three-quarter and from behind, with a rider for scale. In a real scene, use
//   npm run snap -- --arches "22350:START:Avalanche Creek,47310:FINISH:Logan Pass" goingtothesun@22330
//
//   node tools/snap_arches.mjs [--out tools/snapshots/arches] [--size 1600x1000]
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = resolve(ROOT, opt('--out', 'tools/snapshots/arches'));
const [width, height] = opt('--size', '1600x1000').split('x').map(Number);
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(join(ROOT, path)); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir(out, { recursive: true });
for (const view of ['start', 'finish', 'front-start', 'front-finish', 'back', 'pair']) {
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/arch-preview.html?view=${view}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const url = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  const file = join(out, `arch-${view}.png`);
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${errors.length ? 'ERR' : 'ok '}  ${file}`);
}
for (const e of errors) console.log('   ', e);
await browser.close(); server.close();
process.exitCode = errors.length ? 1 : 0;
