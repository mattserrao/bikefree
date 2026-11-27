// Renders the figures gallery (tools/figures-gallery.html) headlessly: one PNG per view, frozen at a time.
//
//   npm run snap:figures                                  # every view → tools/snapshots/figures-<view>.png
//   node tools/snap_figures.mjs --views people,close --t 2.3 --lo --size 1600x900 --out /tmp
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, findChrome } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = resolve(ROOT, opt('--out', 'tools/snapshots'));
const views = opt('--views', 'people,variety,close,vehicles,street,crowd').split(',');
const [w, h] = opt('--size', '1400x800').split('x').map(Number);
const t = opt('--t', '1.7');
const chrome = opt('--chrome', findChrome());
const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
await mkdir(out, { recursive: true });
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
for (const v of views) {
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/figures-gallery.html?view=${v}&t=${t}&w=${w}&h=${h}${args.includes('--lo') ? '&lo=1' : ''}${opt('--extra', '')}`);
  await page.waitForFunction(() => window.ready || null, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  const file = join(out, `figures-${v}${args.includes('--lo') ? '-lo' : ''}.png`);
  await page.locator('canvas').screenshot({ path: file });
  console.log(file);
}
console.log(JSON.stringify(await page.evaluate(() => window.stats)));
await browser.close(); server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
