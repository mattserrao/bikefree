#!/usr/bin/env node
// City card QC: the route list's city card (a ride network, e.g. Pittsburgh) and its full-screen panel, in
// headless Chrome at desktop and phone sizes. Screenshots: the main page, the panel opened, a route picked in
// the list, a line tapped on the map (and tapped again: the next route on it), a goal chip, and back.
//
//   node tools/snap_city.mjs                     → tools/snapshots/card/*.png
//   options: --out <dir>  --sizes 1440x900,390x844  --theme dark|light  --chrome <path> (or CHROME)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = join(ROOT, opt('--out', 'tools/snapshots/card'));
const sizes = opt('--sizes', '1440x900,390x844').split(',').map((s) => s.split('x').map(Number));
const theme = opt('--theme', 'dark');
const chrome = opt('--chrome', process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.gpx': 'application/gpx+xml', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { const body = await readFile(join(ROOT, path || 'index.html')); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
await mkdir(out, { recursive: true });
const saved = [];
let failed = false;
try {
  for (const [w, h] of sizes) {
    const tag = `${w}x${h}`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, hasTouch: w < 600 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript((t) => { localStorage.setItem('bikefree.theme', t); }, theme);
    await page.goto(`${base}/index.html`);
    await page.click('.mode[data-mode="route"]');
    await page.waitForSelector('.city-card', { timeout: 120000 });
    await page.waitForTimeout(600);
    const shot = async (name, full = false) => { const f = join(out, `${tag}-${name}.png`); await page.screenshot({ path: f, fullPage: full }); saved.push(f); };
    await page.locator('.city-card').scrollIntoViewIfNeeded();
    await shot('1-main');
    await page.click('.city-card');
    await page.waitForSelector('#cityDlg[open]');
    await page.waitForTimeout(400);
    await shot('2-panel');
    // pick a route in the list (the fourth)
    await page.locator('.city-row-btn').nth(3).click();
    await page.waitForTimeout(200);
    await shot('3-route-picked');
    // tap a line on the map that several routes ride, then again for the next
    const pt = await page.evaluate(() => {
      const c = document.getElementById('cityMap'), r = c.getBoundingClientRect();
      const L = [...c.lines].sort((a, b) => b.pts.length - a.pts.length)[2];
      const [x, y] = L.pts[Math.floor(L.pts.length / 2)];
      return { x: r.left + x, y: r.top + y };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(200);
    await shot('4-line-tapped');
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(200);
    await shot('5-line-tapped-again');
    await page.click('#cityGoals button[data-goal="hilly"]');
    await page.waitForTimeout(200);
    await shot('6-goal-hilly');
    if (w < 600) { await page.evaluate(() => document.querySelector('.city-body').scrollTo(0, 99999)); await page.waitForTimeout(150); await shot('7-panel-scrolled'); }
    // Ride: back on the menu with the route chosen
    await page.locator('#cityList [data-ride]').click();
    await page.waitForTimeout(500);
    await shot('8-after-ride');
    // keyboard: open with Enter, Escape closes
    await page.focus('.city-card');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cityDlg[open]');
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => !document.getElementById('cityDlg').open && document.activeElement?.classList.contains('city-card'));
    if (!closed) { console.error(`${tag}: Escape did not close the panel back onto the card`); failed = true; }
    if (errors.length) { console.error(`${tag}: page errors:\n  ${errors.join('\n  ')}`); failed = true; }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(saved.join('\n'));
process.exit(failed ? 1 : 0);
