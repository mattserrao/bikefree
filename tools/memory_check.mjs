#!/usr/bin/env node
// [F399] What holds a ride's memory at its start (PLAN phase 8, L9): opens the app in headless Chrome (phone-sized
// window, Demo), rides a Pittsburgh preset until the loading screen closes, uploads every mesh once (one draw with
// culling off, as the bake and riding round do), collects garbage and reports: the live JS heap, the scene's geometry
// (typed arrays still held on the CPU) by top group and by mesh name, the building meshes, and a sampled heap profile
// of what is still alive (by file on the stack and by allocating function). The CPU copies the app releases after
// upload (js/world/toolbox/core/release.js) are counted as "released".
//
//   node tools/memory_check.mjs "Three Rivers Loop" [/tmp/memory.txt]
//   node tools/memory_check.mjs --map outwest [--ride "Kanab Town Loop"] [/tmp/memory.txt]   (any graph map: its first ride
//        by default; the heap checked against the map definition's budget — js/world/toolbox/map-definition.js, phone = low)
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { serve, findChrome } from './lib/harness.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const MAP = opt('--map'), RIDE = opt('--ride');
const mapJson = MAP ? JSON.parse(await readFile(join(ROOT, `routes/cities/${MAP}.json`), 'utf8')) : null;
const [name0 = 'Three Rivers Loop', out = null] = argv;
const name = RIDE || (MAP ? mapJson.presets?.[0]?.name : name0);
const { TIER_BUDGETS } = await import('../js/world/toolbox/map-definition.js');
const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
await page.click('.ride-tab[data-mode="route"]');
await page.waitForSelector('.city-card'); await page.click('#demoBtn'); await page.click(MAP ? `.city-card[data-city="${MAP}"]` : '.city-card'); await page.waitForSelector('#cityDlg[open]');
await page.locator('.city-row-btn', { has: page.locator('.cr-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
await page.evaluate(() => { setInterval(() => { const w = window.bikefree?.world; if (w && !w.__nd) { w.__nd = 1; w._render = () => {}; } }, 20); });
await page.locator('#cityList [data-ride]').first().click();
await page.waitForFunction(() => document.getElementById('loadScreen').hidden && window.bikefree.session.running, null, { timeout: 600000, polling: 500 });
await page.waitForTimeout(5000);
const upl = await page.evaluate(async () => {
  // upload everything once (as the bake and riding round would): one draw with culling off
  const w = window.bikefree.world, off = [];
  w.scene.traverse((o) => { if (o.isMesh && o.frustumCulled && o.visible) { o.frustumCulled = false; off.push(o); } });
  w.renderer.render(w.scene, w.camera);
  for (const o of off) o.frustumCulled = true;
  const m = await import('/js/world/world.js');
  return m.releaseStats;
});
console.log('released', JSON.stringify(upl));
await page.evaluate(() => { window.gc(); window.gc(); });
const heapMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1e6));
const budgetMB = TIER_BUDGETS.low.heapMB;   // (the phone's tier: this check rides in a phone-sized window)
console.log(`heap ${heapMB} MB of the low tier's ${budgetMB} MB budget${heapMB > budgetMB ? ' — OVER' : ''} (${MAP || 'pgh'} · ${name})`);
if (heapMB > budgetMB) process.exitCode = 1;
const { profile } = await cdp.send('HeapProfiler.stopSampling');
// live sampled bytes by allocating function (self) and by file (inclusive along the stack, deduped per sample)
const self = new Map(), byFile = new Map();
const walk = (n, stack) => {
  const cf = n.callFrame, key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
  const st = [...stack, cf.url.split('/').slice(-3).join('/')];
  if (n.selfSize) {
    self.set(key, (self.get(key) || 0) + n.selfSize);
    for (const f of new Set(st)) if (f) byFile.set(f, (byFile.get(f) || 0) + n.selfSize);
  }
  for (const c of n.children) walk(c, st);
};
walk(profile.head, []);
// the scene: geometry bytes (typed arrays) by top-level group name, plus parsed scene data
const geo = await page.evaluate(() => {
  const w = window.bikefree.world, by = {}, seen = new Set();
  let total = 0, tex = 0, meshes = 0, inst = 0;
  const top = (o) => { let p = o, path = []; while (p && p.parent && p.parent !== w.scene) { path.unshift(p.name || p.type); p = p.parent; } return (p?.name || p?.type || '?') + ' › ' + (path[0] || '') + ' › ' + (path[1] || ''); };
  const sizeOf = (g) => { let b = 0; for (const a of Object.values(g.attributes)) b += a.array?.byteLength || 0; if (g.index) b += (g.index.array?.byteLength || 0); return b; };
  w.scene.traverse((o) => {
    if (!o.geometry) return; meshes++;
    let b = 0;
    if (!seen.has(o.geometry)) { seen.add(o.geometry); b += sizeOf(o.geometry); }
    if (o.isInstancedMesh) { inst++; b += (o.instanceMatrix.array?.byteLength||0) + (o.instanceColor?.array?.byteLength || 0); }
    const k = top(o); by[k] = (by[k] || 0) + b; total += b;
    for (const m of [].concat(o.material || [])) for (const t of ['map', 'normalMap', 'bumpMap', 'aoMap', 'alphaMap']) { const im = m[t]?.image; if (im && !seen.has(im)) { seen.add(im); tex += (im.width || 0) * (im.height || 0) * 4; } }
  });
  let tris = 0, bverts = 0, trees = 0; const perArea = {};
  w.scene.traverse((o) => { if (!o.geometry) return; const g = o.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); tris += t;
    let p = o; while (p.parent && p.parent !== w.scene) p = p.parent; const an = (p.name || '?').split(' · ')[1] || p.name; const b = Object.values(g.attributes).reduce((s, a) => s + (a.array?.byteLength || 0), 0) + (g.index?.array?.byteLength || 0); perArea[an] = +((perArea[an] || 0) + b / 1e6).toFixed(1);
    { const nm = (o.name || o.parent?.name || o.type).replace(/[-\d,. ]+$/, ''); (window.__byName ||= {})[nm] = +(((window.__byName[nm]) || 0) + b / 1e6).toFixed(2); }
    if (/^Building/.test(o.name)) bverts += g.attributes.position.count; if (o.isInstancedMesh && /tree/i.test(o.name)) trees += o.count; });
  window.__t = { tris: Math.round(tris), bverts, trees, perArea, byName: Object.entries(window.__byName).sort((a, b) => b[1] - a[1]).slice(0, 30) };
  const kit = []; w.scene.traverse((o) => { if (o.geometry && /Building/.test((o.parent?.name || '') + o.name)) { const g = o.geometry; kit.push({ name: o.name, verts: g.attributes.position?.count, tris: g.index ? g.index.count / 3 : g.attributes.position.count / 3, attrs: Object.entries(g.attributes).map(([k, a]) => `${k}:${(a.array?.constructor.name||'released').replace('Array', '')}x${a.itemSize}`).join(' '), MB: +(Object.values(g.attributes).reduce((s, a) => s + (a.array?.byteLength || 0), 0) / 1e6 + (g.index?.array?.byteLength || 0) / 1e6).toFixed(1) }); } });
  const keep = {}; w.scene.traverse((o) => { if (!o.geometry || !/^Building/.test(o.name)) return; const g = o.geometry; const mb = Object.values(g.attributes).reduce((s, a) => s + (a.array?.byteLength || 0), 0) / 1e6; if (mb < .01) return; const k = `${o.name.replace(/[-\d,. ]+$/, '')} | marked ${!!g.userData.release} | visible ${o.visible} | parent ${o.parent?.name}`; keep[k] = +((keep[k] || 0) + mb).toFixed(1); });
  kit.unshift({ keep });
  window.__kit = kit.sort((a, b) => b.MB - a.MB).slice(0, 8);
  const areas = [...w.areas.values()].map((a) => `${a.id}:${a.ready ? 'built' : 'building'}`);
  return { ...window.__t, kit: window.__kit, totalMB: +(total / 1e6).toFixed(1), texMB: +(tex / 1e6).toFixed(1), meshes, inst, areas, top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / 1e6).toFixed(1)} MB  ${k}`) };
});
const fmt = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1e6).toFixed(1).padStart(7)} MB  ${k}`).join('\n');
const sampled = [...self.values()].reduce((a, b) => a + b, 0);
const report = `${name}: live JS heap ${heapMB} MB after GC (sampled live ${(sampled / 1e6).toFixed(0)} MB); tris ${geo.tris}, building verts ${geo.bverts}, trees ${geo.trees}; per area ${JSON.stringify(geo.perArea)}; areas ${geo.areas.join(', ')}\n\nGEOMETRY in the scene: ${geo.totalMB} MB typed arrays (${geo.meshes} meshes, ${geo.inst} instanced), textures ~${geo.texMB} MB decoded\n${geo.top.join('\n')}\n\nBY NAME\n${geo.byName.map(([k, v]) => `${v} MB ${k}`).join('\n')}\n\nBUILDING MESHES\n${geo.kit.map((k) => JSON.stringify(k)).join('\n')}\n\nLIVE HEAP (sampled) BY FILE ON THE STACK\n${fmt(byFile, 30)}\n\nLIVE HEAP BY ALLOCATING FUNCTION\n${fmt(self, 40)}\n`;
if (out) await writeFile(out, report);
console.log(report);
await browser.close(); server.close();
