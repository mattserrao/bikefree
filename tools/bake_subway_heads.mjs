#!/usr/bin/env node
// [F123] Bake a subway area's station headhouses into a neighbouring area's scene, so the area that rides past them on
// the street draws them too (they don't pop in at the swap): the scene's `subway.heads` (each escalator in the subway
// line's metres and the line's own 10 m samples round it, as the app builds the line) and `subway.platforms`.
// js/world/toolbox/structures/subway.js `_headsOnly` builds them on the same frames as the subway area does.
//
//   node tools/bake_subway_heads.mjs <subway catalog id> <scene.json> [--check]
//   node tools/bake_subway_heads.mjs pittsburgh-subway routes/scenes/pittsburgh.json
//
// Re-run it when the subway's line changes (tools/build_subway_line.py, build_city.py pittsburgh-subway); --check
// exits 1 if the scene's baked heads are out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogRoute } from '../js/routes.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const args = process.argv.slice(2);
const check = args.includes('--check');
const [id, scenePath] = args.filter((a) => !a.startsWith('--'));
if (!id || !scenePath) { console.log('usage: node tools/bake_subway_heads.mjs <subway catalog id> <scene.json> [--check]'); process.exit(1); }
const item = JSON.parse(read('routes/catalog.json')).find((r) => r.id === id);
if (!item) throw new Error(`no catalog route ${id}`);
const route = buildCatalogRoute(read(item.file), { ...item, routeId: item.id });
const city = JSON.parse(read(JSON.parse(read(item.scene)).cityData));
const conv = (city.routeConveyors || []).filter((c) => c.kind !== 'stadium');   // (F355: not a stadium's escalator on an apron)
if (!conv.length) throw new Error(`${id}: no escalators (city data routeConveyors)`);
const R6 = (v) => Math.round(v * 1e6) / 1e6, R2 = (v) => Math.round(v * 100) / 100;
const MARGIN = 30;   // metres of line beyond the shaft each way: the headhouse (16 m), the frames' ±1.5 m and the curve's neighbours
const heads = conv.map((c) => {
  const a = Math.floor((Math.min(c.fromM, c.toM) - MARGIN) / 10) * 10, b = Math.ceil((Math.max(c.fromM, c.toM) + MARGIN) / 10) * 10;
  const pts = [];
  for (let s = a; s <= b; s += 10) { const i = Math.round(s / 10); pts.push([R6(route.lat[i]), R6(route.lon[i]), R2(route.ele[i])]); }
  return { name: c.name, dir: c.dir, fromM: c.fromM, toM: c.toM, s0: a, pts };
});
const platforms = (city.subway?.platforms || []).map((p) => ({ name: p.name, fromM: p.fromM, toM: p.toM }));
const raw = read(scenePath), scene = JSON.parse(raw);
const next = { kit: 'toolbox/structures/subway.js', note: `the ${id} area's station headhouses (escalator tops), seen from the street here: baked by tools/bake_subway_heads.mjs from its line (F123)`, heads, platforms };
const same = JSON.stringify(scene.subway) === JSON.stringify(next);
if (check) { console.log(same ? `${scenePath}: subway heads up to date` : `${scenePath}: subway heads out of date (run tools/bake_subway_heads.mjs ${id} ${scenePath})`); process.exit(same ? 0 : 1); }
scene.subway = next;
writeFileSync(resolve(root, scenePath), `${JSON.stringify(scene, null, 2)}\n`);
console.log(`${scenePath}: ${heads.length} headhouses (${heads.map((h) => `${h.name} ${h.fromM}–${h.toM} m, ${h.pts.length} samples`).join('; ')})`);
