// Rider snapshots: renders tools/rider-preview.html headless in Chrome and saves PNGs to tools/snapshots/rider/.
//   npm run snap:rider -- seated:chase standing:side@1.2 tuck:quarter pacer/standing:back …
// A shot is  [pacer/]<posture>[:<camera>][@<crank radians>][#<grade>]  (posture: seated | standing | tuck | auto;
// camera: chase | side | front | back | quarter | top). --size WxH (default 1280x800), --chrome <path>, --software.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? (argv.splice(i, 1), true) : false; };
const [width, height] = opt('--size', '1280x800').split('x').map(Number);
const software = flag('--software');
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
if (!argv.length) { console.log('usage: npm run snap:rider -- [pacer/]<posture>[:camera][@crank][#grade] …'); process.exit(1); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome,
  args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const out = join(ROOT, 'tools', 'snapshots', 'rider');
await mkdir(out, { recursive: true });
for (const spec of argv) {
  const m = spec.match(/^(?:(pacer)\/)?(\w+)(?::(\w+))?(?:@([\d.]+))?(?:#(-?[\d.]+))?$/);
  if (!m) { console.warn('bad shot', spec); continue; }
  const [, kit, posture, cam = 'chase', crank = '0.6', grade] = m;
  const q = new URLSearchParams({ still: '1', posture, cam, crank, kit: kit || 'rider', ...(grade ? { grade } : {}),
    ...(posture === 'tuck' ? { cadence: '0', speed: '15', power: '0', grade: grade ?? '-6' } : {}),
    ...(posture === 'standing' ? { grade: grade ?? '9', power: '320', cadence: '68', speed: '4' } : {}) });
  errors.length = 0;
  await page.goto(`${base}/tools/rider-preview.html?${q}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const file = join(out, `${spec.replace(/[/:@#]/g, '-')}.png`);
  await writeFile(file, await page.screenshot());
  console.log(`${errors.length ? 'ERR' : 'ok '} ${spec.padEnd(28)} → ${file}${errors.length ? '\n    ' + errors.join('\n    ') : ''}`);
}
await browser.close();
server.close();
