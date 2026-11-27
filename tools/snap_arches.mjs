#!/usr/bin/env node
// Design renders of the course arches (tools/arch-preview.html): the start and finish on a plain road,
// front-on, three-quarter and from behind, with a rider for scale. In a real scene, use
//   npm run snap -- --arches "22350:START:Avalanche Creek,47310:FINISH:Logan Pass" goingtothesun@22330
//
//   node tools/snap_arches.mjs [--out tools/snapshots/arches] [--size 1600x1000]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, findChrome } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = resolve(ROOT, opt('--out', 'tools/snapshots/arches'));
const [width, height] = opt('--size', '1600x1000').split('x').map(Number);
const chrome = opt('--chrome', findChrome());
const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
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
