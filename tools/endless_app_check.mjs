#!/usr/bin/env node
// The endless map in the app (headless Chrome): pick the Endless card, Demo, Start; once riding check that the world is
// the endless world, the session's turn ride is the mile prompt (four terrain types, the current one picked), that a
// choice regenerates the road past the mark, and that nothing threw. Exits 1 on a failure.
//   node tools/endless_app_check.mjs [--draw]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const draw = process.argv.includes('--draw');
const chrome = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.gpx': 'application/gpx+xml', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  let body; try { body = await readFile(join(ROOT, path || 'index.html')); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push((e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
await page.goto(`${base}/index.html`);
await page.click('.ride-tab[data-mode="route"]');
await page.waitForSelector('#routeCards .rcard[data-id="builtin-endless"]');
await page.click('#routeCards .rcard[data-id="builtin-endless"]');
await page.waitForFunction(() => document.getElementById('pvTitle')?.textContent === 'Endless');
const preview = await page.evaluate(() => ({ facts: document.getElementById('pvFacts').textContent, desc: document.getElementById('pvDesc').textContent }));
await page.click('#demoBtn');
if (!draw) await page.evaluate(() => { setInterval(() => { const w = window.bikefree?.world; if (w && !w.__noDraw) { w.__noDraw = true; w._draw = () => {}; } }, 20); });
await page.click('#startBtn');
await page.waitForFunction(() => window.bikefree?.session?.running && document.getElementById('loadScreen').hidden, null, { timeout: +(process.env.WAIT || 600000), polling: 500 })
  .catch(async (e) => {
    console.log('not riding:', JSON.stringify(await page.evaluate(() => { const { session, world } = window.bikefree; return { screen: !document.getElementById('loadScreen').hidden, what: document.getElementById('loadWhat')?.textContent,
      running: session.running, mode: session.mode, route: session.route?.name, world: world?.constructor?.name, ready: world?.readiness?.(), frames: world?._frames, tiles: world?.tiles?.size, trees: world?._treesState }; })), errors);
    throw e;
  });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const { session, world } = window.bikefree, R = session.turnRide, M = 1609.344;
  const out = { world: world?.constructor?.name, endless: !!session.route?.endless, moving: session.distanceM > 0 };
  const up = R?.prompt(M - 100, 8);
  out.options = up?.options.map((o) => o.label).join(' / ');
  out.selected = up && up.options[up.selected].label;
  const dirty0 = [...world.tiles.values()].filter((t) => t.dirty).length;
  out.chose = R.choose(1, M - 100);
  out.after = R.upcoming(M - 100).options[R.upcoming(M - 100).selected].label;
  out.dirty = [...world.tiles.values()].filter((t) => t.dirty).length - dirty0;
  out.hud = document.getElementById('hRow3Box') && !document.getElementById('hRow3Box').hidden ? document.getElementById('hRow3Box').textContent.trim() : null;
  out.readiness = world.readiness().steps.map((s) => `${s.key} ${Math.round(s.p * 100)}%`).join(', ');
  return out;
});
console.log(JSON.stringify({ preview, ...r, errors }, null, 1));
const ok = r.world === 'EndlessWorld' && r.endless && r.options === 'Flat / Rolling / Climb / Descend' && r.selected === 'Rolling' && r.chose && r.after === 'Climb' && !errors.length;
console.log(ok ? 'OK' : 'FAILED');
await browser.close(); server.close();
process.exitCode = ok ? 0 : 1;
