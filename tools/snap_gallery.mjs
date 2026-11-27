// Renders the toolbox gallery (tools/toolbox-gallery.html) headlessly and saves a full-page image, so the
// model catalogue can be checked without a browser. Fails on any page error.
//
//   npm run gallery                            # → tools/snapshots/toolbox-gallery.png
//   node tools/snap_gallery.mjs --out /tmp/g.png --shade smooth --season fall --kit "pack: northeast"
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, findChrome } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = resolve(ROOT, opt('--out', 'tools/snapshots/toolbox-gallery.png'));
const chrome = opt('--chrome', findChrome());
const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`http://127.0.0.1:${server.address().port}/tools/toolbox-gallery.html`);
await page.waitForFunction(() => window.galleryReady || null, null, { timeout: 300000, polling: 500 });
for (const [sel, name] of [['#shade', '--shade'], ['#season', '--season']]) {
  const v = opt(name, null);
  if (v) { await page.selectOption(sel, v); await page.waitForFunction(() => !document.getElementById('stat').textContent.startsWith('building'), null, { timeout: 300000 }); }
}
const kit = opt('--kit', null);
if (kit) await page.selectOption('#kit', kit);
const stat = await page.textContent('#stat');
await page.screenshot({ path: out, fullPage: true });
console.log(`${errors.length ? 'ERR' : 'ok '} ${stat} → ${out}`);
for (const e of errors) console.log('   ', e.slice(0, 200));
await browser.close(); server.close();
process.exitCode = errors.length ? 1 : 0;
