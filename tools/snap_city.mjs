#!/usr/bin/env node
// City card QC: the route list's city card (a ride network, e.g. Pittsburgh) and its full-screen panel, in
// headless Chrome at desktop and phone sizes. Screenshots: the main page, the panel opened, a route picked in
// the list, a line tapped on the map (and tapped again: the next route on it), a goal chip, and back; Options
// (the menu with the route's start options), Ride with no trainer (the route chosen), and Ride with the Demo
// trainer on (F104: the ride starts at once on the route); then Pittsburgh as a free ride's scenery (F37: its free
// ride over the network, with the turn prompt; --no-scenery skips it).
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
    // the ride screen: stop the 3D loop (software GL keeps the page too busy to screenshot), draw one frame, shoot
    const rideShot = async (name) => {
      await page.evaluate(() => { const w = window.bikefree.world; w?.stop(); if (w?._render) w._render(); else w?.renderer.render(w.scene, w.camera); });
      const f = join(out, `${tag}-${name}.png`); await page.screenshot({ path: f, timeout: 120000 }); saved.push(f);
    };
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
    // Options: back on the menu with the route chosen, its preview and start options showing (F104)
    const picked = await page.locator('#cityList [data-ride]').getAttribute('data-ride');
    await page.locator('#cityList [data-options]').click();
    await page.waitForTimeout(500);
    await shot('8-after-options');
    const onMenu = await page.evaluate((id) => !document.getElementById('cityDlg').open && document.getElementById('rideScreen').hidden && !document.getElementById('routeOpts').hidden
      && document.querySelector('.city-card')?.textContent.length > 0, picked);
    if (!onMenu) { console.error(`${tag}: Options did not go back to the menu with the route's options`); failed = true; }
    // keyboard: open with Enter, Escape closes
    await page.focus('.city-card');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cityDlg[open]');
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => !document.getElementById('cityDlg').open && document.activeElement?.classList.contains('city-card'));
    if (!closed) { console.error(`${tag}: Escape did not close the panel back onto the card`); failed = true; }
    // zoom (F102): the wheel over the North Side zooms in about the pointer, "Whole map" goes back out
    await page.click('.city-card');
    await page.waitForSelector('#cityDlg[open]');
    await page.waitForTimeout(300);
    const box = await page.locator('#cityMap').boundingBox();
    // hovering a line previews its routes in the hint (F105)
    const hp = await page.evaluate(() => { const c = document.getElementById('cityMap'), r = c.getBoundingClientRect(), L = [...c.lines].sort((a, b) => b.pts.length - a.pts.length)[0]; const [x, y] = L.pts[Math.floor(L.pts.length / 2)]; return { x: r.left + x, y: r.top + y }; });
    await page.mouse.move(hp.x, hp.y);
    await page.waitForTimeout(100);
    if (!/ride/.test(await page.textContent('#cityMapHint'))) { console.error(`${tag}: hovering a line did not preview its routes`); failed = true; }
    await page.mouse.move(box.x + box.width * .3, box.y + box.height * .45);
    for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
    await page.waitForTimeout(200);
    await shot('9-zoomed');
    const zoomed = await page.evaluate(() => !document.getElementById('cityFit').hidden);
    if (!zoomed) { console.error(`${tag}: the wheel did not zoom the map`); failed = true; }
    await page.click('#cityFit');
    if (!(await page.evaluate(() => document.getElementById('cityFit').hidden))) { console.error(`${tag}: "Whole map" did not zoom back out`); failed = true; }
    // the browser's Back closes the panel and stays on the app (F100)
    const url = page.url();
    await page.goBack();
    await page.waitForTimeout(300);
    if (await page.evaluate(() => document.getElementById('cityDlg').open) || page.url() !== url) { console.error(`${tag}: Back did not close the panel`); failed = true; }
    // Ride with no trainer: the route is chosen on the menu (its Start button asks for the trainer)
    await page.click('.city-card');
    await page.waitForSelector('#cityDlg[open]');
    await page.locator('.city-row-btn').nth(1).click();
    await page.locator('#cityList [data-ride]').click();
    await page.waitForTimeout(500);
    if (!(await page.evaluate(() => !document.getElementById('cityDlg').open && document.getElementById('rideScreen').hidden && /Connect/.test(document.getElementById('startBtn').textContent)))) {
      console.error(`${tag}: Ride with no trainer did not leave the route chosen on the menu`); failed = true;
    }
    // Ride with the Demo trainer on: riding at once (F104), on the route picked, from its start
    await page.click('#demoBtn');
    await page.click('.city-card');
    await page.waitForSelector('#cityDlg[open]');
    await page.locator('.city-row-btn').nth(2).click();
    const want = await page.locator('#cityList [data-ride]').getAttribute('data-ride');
    await page.locator('#cityList [data-ride]').click();
    await page.waitForFunction(() => !document.getElementById('rideScreen').hidden && window.bikefree?.world && document.getElementById('hLoading').hidden, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    await rideShot('10-ride-now');
    const rode = await page.evaluate(() => { const s = window.bikefree.session; return { mode: s.mode, name: s.route?.name, start: s.routeStart, plan: !!s.route?.netRide?.plan }; });
    const wantName = await page.evaluate((id) => document.querySelector(`.city-card`) && id, want);
    if (rode.mode !== 'route' || !rode.plan || !wantName) { console.error(`${tag}: Ride did not start the route at once: ${JSON.stringify(rode)}`); failed = true; }
    else console.log(`${tag}: Ride started ${rode.name} at ${rode.start} m`);
    if (errors.length) { console.error(`${tag}: page errors:\n  ${errors.join('\n  ')}`); failed = true; }
    await page.close();
  }
  // Pittsburgh as scenery (F37): a free ride with no route rides the city's free ride over the network, its turn
  // prompts included (desktop size only: one 3D start)
  if (!args.includes('--no-scenery')) {
    const [w, h] = sizes[0], tag = `${w}x${h}`;
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript((t) => { localStorage.setItem('bikefree.theme', t); }, theme);
    await page.goto(`${base}/index.html`);
    await page.waitForSelector('#sceneCards .rcard[data-id="builtin-park-pittsburgh"]', { timeout: 120000 });
    await page.click('#sceneCards .rcard[data-id="builtin-park-pittsburgh"]');
    await page.waitForTimeout(300);
    const f0 = join(out, `${tag}-11-scenery-menu.png`); await page.screenshot({ path: f0 }); saved.push(f0);
    if (!/free ride/.test(await page.textContent('#pvDesc'))) { console.error(`${tag}: the scenery preview doesn't say it rides the free ride`); failed = true; }
    await page.click('#demoBtn');
    await page.click('#startBtn');
    await page.waitForFunction(() => !document.getElementById('rideScreen').hidden && window.bikefree?.world && document.getElementById('hLoading').hidden, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    // just before the first junction (the Clemente Bridge's south end): the turn prompt is up
    const st = await page.evaluate(async () => {
      const { session, world } = window.bikefree, r = session.sceneryRoute;
      if (!r) return { ok: false, why: 'no scenery path' };
      session.distanceM = session.sceneryOffset + r.netRide.entries[1].p0 - 80;
      session._updateRoute();
      await new Promise((ok) => setTimeout(ok, 1200));
      return { ok: session.mode === 'free' && r.free && world.path === r.netRide && !document.getElementById('hTurn').hidden,
        name: r.name, prompt: document.getElementById('hTurn').textContent.replace(/\s+/g, ' ').trim().slice(0, 120) };
    });
    const f = join(out, `${tag}-12-scenery-ride.png`);
    await page.evaluate(() => { const w = window.bikefree.world; w?.stop(); if (w?._render) w._render(); else w?.renderer.render(w.scene, w.camera); });
    await page.screenshot({ path: f, timeout: 120000 }); saved.push(f);
    if (!st.ok) { console.error(`${tag}: Pittsburgh scenery is not the free ride with prompts: ${JSON.stringify(st)}`); failed = true; }
    else console.log(`${tag}: scenery rides ${st.name} · prompt: ${st.prompt}`);
    if (errors.length) { console.error(`${tag}: page errors (scenery):\n  ${errors.join('\n  ')}`); failed = true; }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(saved.join('\n'));
process.exit(failed ? 1 : 0);
