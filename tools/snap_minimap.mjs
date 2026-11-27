#!/usr/bin/env node
// Ride-screen minimap QC: the ride HUD with the minimap on a Pittsburgh network ride (just before a junction, its
// options up), a park route (Yosemite) and a free ride, in headless Chrome with the Demo trainer, at desktop and
// phone sizes (the phone at devicePixelRatio 2). With --bench it also times the minimap's draw on each ride
// (the drawing alone, the 3D loop stopped): ms per draw, mean and 95th percentile over a ride's worth of positions.
//
//   node tools/snap_minimap.mjs                  → tools/snapshots/minimap/*.png
//   options: --out <dir>  --sizes 1440x900,390x844  --theme dark|light  --bench  --only net,park,free  --chrome <path>
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, findChrome } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const out = join(ROOT, opt('--out', 'tools/snapshots/minimap'));
const sizes = opt('--sizes', '1440x900,390x844').split(',').map((s) => s.split('x').map(Number));
const theme = opt('--theme', 'dark');
const bench = args.includes('--bench');
const only = opt('--only', 'net,park,free').split(',');
const chrome = opt('--chrome', findChrome());

const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
await mkdir(out, { recursive: true });
const saved = [], timings = [];
let failed = false;

const riding = (page) => page.waitForFunction(() => !document.getElementById('rideScreen').hidden && window.bikefree?.world && document.getElementById('hLoading').hidden, null, { timeout: 240000 });

// Times the minimap's draw over 200 positions a few metres apart (as on a ride), the way js/app.js calls it.
async function benchDraw(page, label) {
  const r = await page.evaluate(async () => {
    const v = await import('/js/views.js');
    const { session, pacer } = window.bikefree;
    const route = session.mode === 'route' ? session.route : session.sceneryRoute || null;
    const c = document.getElementById('hMapCanvas');
    const res = {};
    for (const mode of ['course', 'follow']) {
      const ts = [], js = [];
      for (let k = 0; k < 220; k++) {
        const t0 = performance.now();
        if (route?.netRide) {
          const net = route.netRide, pos = session.turnPos + k * 3;
          const up = net.prompt(pos, 8), span = net.profileSpan(pos);
          v.drawNetworkMinimap(c, net, pos, { mode, spanM: 3000, up, pacerPos: pos + 40, now: t0,
            aheadTo: Math.max(span[1], net.endOf(Math.min(net.entries.length - 1, net.entryAt(pos) + 1))) });
        } else {
          const rt = route || window.bikefree.world?.route;
          const pos = (session.mode === 'route' ? session.routePos : session.distanceM % rt.total) + k * 3;
          v.drawMinimap(c, rt, pos, { mode, spanM: 3000, pacerPos: pos + 40, now: t0 });
        }
        const t1 = performance.now();
        c.getContext('2d').getImageData(0, 0, 1, 1);   // flush: the raster work (and a 1 px read back) counts too
        if (k >= 20) { ts.push(performance.now() - t0); js.push(t1 - t0); }   // the first draws build the caches
      }
      ts.sort((a, b) => a - b); js.sort((a, b) => a - b);
      res[mode] = { mean: ts.reduce((a, b) => a + b, 0) / ts.length, p95: ts[Math.floor(ts.length * 0.95)], max: ts[ts.length - 1],
        js: js.reduce((a, b) => a + b, 0) / js.length, jsP95: js[Math.floor(js.length * 0.95)] };
    }
    void pacer;
    return res;
  });
  const f = (x) => x.toFixed(3);
  const line = `${label}: draw calls (JS) course ${f(r.course.js)} ms (p95 ${f(r.course.jsP95)}) · follow ${f(r.follow.js)} ms (p95 ${f(r.follow.jsP95)})`
    + ` | with raster flush: course ${f(r.course.mean)} ms (p95 ${f(r.course.p95)}) · follow ${f(r.follow.mean)} ms (p95 ${f(r.follow.p95)})`;
  timings.push(line); console.log(line);
}

try {
  for (const [w, h] of sizes) {
    const tag = `${w}x${h}`;
    const phone = w < 600;
    const open = async () => {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript((t) => { localStorage.setItem('bikefree.theme', t); }, theme);
      await page.goto(`${base}/index.html`);
      return { page, errors };
    };
    const shoot = async (page, name) => {
      await page.evaluate(() => { const wd = window.bikefree.world; wd?.stop(); if (wd?._render) wd._render(); else wd?.renderer.render(wd.scene, wd.camera); });
      await page.waitForTimeout(300);
      const f = join(out, `${tag}-${name}.png`); await page.screenshot({ path: f, timeout: 120000 }); saved.push(f);
      const mf = join(out, `${tag}-${name}-map.png`); await page.locator('#hMap').screenshot({ path: mf, timeout: 60000 }); saved.push(mf);
    };
    const done = async (page, errors, what) => {
      if (errors.length) { console.error(`${tag} ${what}: page errors:\n  ${errors.join('\n  ')}`); failed = true; }
      await page.close();
    };

    if (only.includes('net')) {
      // a Pittsburgh network ride, just before its second junction: the next options are up
      const { page, errors } = await open();
      await page.click('.ride-tab[data-mode="route"]');
      await page.waitForSelector('.city-card', { timeout: 120000 });
      await page.click('#demoBtn');
      await page.click('.city-card');
      await page.waitForSelector('#cityDlg[open]');
      await page.locator('.city-row-btn').nth(2).click();
      await page.locator('#cityList [data-ride]').click();
      await riding(page);
      await page.waitForTimeout(1500);
      const st = await page.evaluate(async () => {
        const { session } = window.bikefree, net = session.route.netRide;
        const target = net.entries[Math.min(2, net.entries.length - 1)].p0 - 120;
        session.distanceM += target - session.routePos;
        session._updateRoute();
        await new Promise((ok) => setTimeout(ok, 1500));
        return { name: session.route.name, pos: Math.round(session.routePos), prompt: !document.getElementById('hTurn').hidden };
      });
      console.log(`${tag}: network ride ${st.name} at ${st.pos} m, prompt ${st.prompt ? 'up' : 'not up'}`);
      await shoot(page, '1-network-junction');
      if (bench && !phone) await benchDraw(page, 'network (Pittsburgh)');
      await done(page, errors, 'network');
    }
    if (only.includes('park')) {
      const { page, errors } = await open();
      await page.click('.ride-tab[data-mode="route"]');
      await page.waitForSelector('#routeCards .rcard[data-id="builtin-park-yosemite"]', { timeout: 120000 });
      await page.click('#routeCards .rcard[data-id="builtin-park-yosemite"]');
      await page.click('#demoBtn');
      await page.click('#startBtn');
      await riding(page);
      await page.waitForTimeout(1500);
      await page.evaluate(async () => { const { session } = window.bikefree; session.distanceM += 2500; session._updateRoute(); await new Promise((ok) => setTimeout(ok, 1500)); });
      await shoot(page, '2-park-yosemite');
      if (bench && !phone) await benchDraw(page, 'park (Yosemite)');
      await done(page, errors, 'park');
    }
    if (only.includes('free')) {
      const { page, errors } = await open();
      await page.click('.ride-tab[data-mode="free"]');   // (no tab of its own, PLAN 6.9)
      await page.waitForSelector('#sceneCards .rcard', { timeout: 120000 });
      await page.click('#demoBtn');
      await page.click('#startBtn');
      await riding(page);
      await page.waitForTimeout(1500);
      await page.evaluate(async () => { const { session } = window.bikefree; session.distanceM += 1200; await new Promise((ok) => setTimeout(ok, 1500)); });
      await shoot(page, '3-free-ride');
      if (bench && !phone) await benchDraw(page, 'free ride (scenery loop)');
      await done(page, errors, 'free');
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(saved.join('\n'));
if (timings.length) console.log(timings.join('\n'));
process.exit(failed ? 1 : 0);
