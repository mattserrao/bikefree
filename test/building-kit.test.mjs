// The building kit (js/world/toolbox/structures/buildings): planning checks on the real Alpe d'Huez footprints
// and on made-up shapes. Geometry and the shader are checked by eye: npm run gallery:buildings and npm run snap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { parseTerrainGrid } from '../js/terrain-grid.js';
import { planFootprints } from '../js/world/toolbox/structures/footprints.js';
import { planBuildingKit } from '../js/world/toolbox/structures/buildings/kit.js';
import { decompose, ROAD_HALF } from '../js/world/toolbox/structures/buildings/recipe.js';
import { STYLE_PRESETS, resolveStyle, WALLS, ROOFS, WINDOW_SETS } from '../js/world/toolbox/structures/buildings/presets.js';
import { Writer, NullWriter, assemble } from '../js/world/toolbox/structures/buildings/assemble.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const item = JSON.parse(read('routes/catalog.json')).find((c) => c.id === 'alpedhuez');
const route = buildCatalogRoute(read(item.file).toString(), item);
const scene = JSON.parse(read(item.scene));
scene.places = parseTerrainGrid(gunzipSync(read(scene.placesFile)));
let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
const proj = makeProjection((a + b) / 2, (c + d) / 2);
const index = makeRouteIndex(route, proj);
const fp = planFootprints(scene, proj, index);
const plan = planBuildingKit(fp, scene, index);
const pip = (x, z, pts) => { let c2 = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c2 = !c2; } return c2; };

test('building kit: every map footprint gets a recipe (duplicates dropped), the same every time', () => {
  assert.equal(plan.buildings.length + plan.duplicates, fp.buildings.length);
  assert.ok(plan.duplicates < fp.buildings.length * .03, `${plan.duplicates} duplicates`);
  const again = planBuildingKit(fp, scene, index);
  const sig = (p) => p.buildings.map((R) => `${R.archetype}${R.schemeIx}${R.form}${R.roof}${R.wall}${R.floors}${Object.keys(R.parts).join('')}${R.dressing.length}`).join('|');
  assert.equal(sig(again), sig(plan));
});

test('building kit: each stretch draws on its own regional style', () => {
  const share = (from, to, f) => { const list = plan.buildings.filter((R) => R.s >= from && R.s < to); return list.filter(f).length / Math.max(1, list.length); };
  assert.ok(share(125200, 1e9, (R) => R.archetype === 'chalet' || R.archetype === 'block') > .45, 'the resort is chalets and blocks');
  assert.ok(share(4800, 37000, (R) => R.archetype === 'farmhouse') > .15, 'Champsaur and Dévoluy have farmhouses');
  assert.ok(share(0, 4800, (R) => R.roof === ROOFS.canal) > .6, 'Gap has canal tiles');
  assert.ok(share(46000, 76000, (R) => R.form === 'stepped') > .03, 'the Beaumont has crow-stepped gables');
});

test('building kit: neighbours rarely look alike, and every village stretch mixes kinds and colours', () => {
  let pairs = 0, same = 0;
  const list = plan.buildings;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < Math.min(list.length, i + 40); j++) {
    const A = list[i], B = list[j];
    if (A.style !== B.style || Math.hypot(A.x - B.x, A.z - B.z) > 18) continue;
    pairs++; if (A.schemeIx === B.schemeIx && A.archetype === B.archetype && A.roof === B.roof) same++;
  }
  assert.ok(same / pairs < .06, `${same} of ${pairs} close neighbours share scheme, kind and roof`);
  const byKm = new Map();
  for (const R of list) { const k = Math.floor(R.s / 1000); if (!byKm.has(k)) byKm.set(k, []); byKm.get(k).push(R); }
  for (const [k, l] of byKm) {
    if (l.length < 15) continue;
    assert.ok(new Set(l.map((R) => R.schemeIx)).size >= 3, `km ${k}: colour schemes`);
    assert.ok(new Set(l.map((R) => R.archetype)).size >= 2, `km ${k}: kinds`);
  }
});

test('building kit: dressing stays off the road and out of other buildings', () => {
  let n = 0;
  for (const R of plan.buildings) for (const it of R.dressing) {
    n++;
    const near = index.nearest(it.x, it.z, ROAD_HALF + 1.2);
    assert.equal(near, null, `${it.kind} at ${Math.round(R.s)} m is ${near?.d.toFixed(1)} m from the road`);
    for (const O of plan.buildings) {
      if (Math.abs(O.x - it.x) > 60 || Math.abs(O.z - it.z) > 60) continue;
      assert.ok(!pip(it.x, it.z, O.pts), `${it.kind} at ${Math.round(R.s)} m stands in a building`);
    }
  }
  assert.ok(n > 3000, `${n} dressing items`);
});

test('building kit: lean-tos, garages, galleries and balconies never reach the road', () => {
  for (const R of plan.buildings) {
    const r = R.rects[0]; if (!r) continue;
    for (const k of ['leanTo', 'garage']) {
      const o = R.parts[k]; if (!o) continue;
      const s = o.end === 1 ? 1 : -1;
      for (const t of [0, .5, 1]) for (const bb of [-3, 0, 3]) {
        const x = r.cx + r.ux * s * (r.hu + t * 3.5) + r.vx * bb, z = r.cz + r.uz * s * (r.hu + t * 3.5) + r.vz * bb;
        assert.equal(index.nearest(x, z, ROAD_HALF + 1), null, `${k} at ${Math.round(R.s)} m`);
      }
    }
  }
});

test('building kit: footprints are cut into rectangles (L and T plans), plain ones kept whole', () => {
  const rect = decompose([[0, 0], [12, 0], [12, 8], [0, 8]]);
  assert.equal(rect.rects.length, 1);
  assert.ok(Math.abs(rect.rects[0].hu - 6) < .01 && Math.abs(rect.rects[0].hv - 4) < .01);
  const L = decompose([[0, 0], [16, 0], [16, 6], [6, 6], [6, 14], [0, 14]]);
  assert.equal(L.rects.length, 2);
  assert.ok(L.cover > .9, `L cover ${L.cover}`);
  const T = decompose([[0, 0], [18, 0], [18, 6], [12, 6], [12, 14], [6, 14], [6, 6], [0, 6]]);
  assert.ok(T.rects.length >= 2 && T.cover > .85, `T: ${T.rects.length} rects, cover ${T.cover}`);
  const real = plan.buildings.filter((R) => R.area > 120);
  assert.ok(real.filter((R) => R.rects.length > 1).length > 100, 'real L and T plans');
  assert.ok(real.filter((R) => R.outline).length / real.length < .1, 'few outlines too ragged to cut');
});

test('building kit: presets name only known materials, and every building assembles', () => {
  for (const [name, p] of Object.entries(STYLE_PRESETS)) {
    const st = resolveStyle({ preset: name });
    for (const k of Object.keys(st.walls)) assert.ok(k in WALLS, `${name}: wall ${k}`);
    for (const k of Object.keys(st.roofs)) assert.ok(k in ROOFS, `${name}: roof ${k}`);
    for (const g of ['upper', 'gable', 'barn']) for (const k of Object.keys(st[g] || {})) assert.ok(k in WALLS, `${name}: ${g} ${k}`);
    assert.ok(st.windows in WINDOW_SETS, `${name}: windows ${st.windows}`);
    assert.ok(p.schemes?.length >= 3, `${name}: at least three colour schemes`);
  }
  const flat = { heightAt: () => 0 };
  const w = new Writer(1 << 16), nul = new NullWriter();
  for (const R of plan.buildings.slice(0, 1500)) assemble(R, w, nul, flat);
  for (let i = 0; i < w.n * 3; i++) assert.ok(Number.isFinite(w.pos[i]), 'finite positions');
  for (let i = 0; i < w.n * 4; i++) assert.ok(Number.isFinite(w.surf[i]) && Number.isFinite(w.win[i]), 'finite attributes');
  for (let i = 0; i < w.ni; i++) assert.ok(w.idx[i] < w.n);
  assert.ok(w.triangles / 1500 < 200, `${(w.triangles / 1500).toFixed(0)} triangles a building`);
});

// ------------------------------------------------------------------------------------------------- Pittsburgh
import { makeCityLandscape, cityStreets } from '../js/world/toolbox/city/landscape.js';
import { planCityHomes } from '../js/world/toolbox/structures/buildings/kit.js';

const pit = (() => {
  const it = JSON.parse(read('routes/catalog.json')).find((x) => x.id === 'pittsburgh');
  const rt = buildCatalogRoute(read(it.file).toString(), it);
  const sc = JSON.parse(read(it.scene)); sc.city = JSON.parse(read(sc.cityData)); rt.scene = sc;
  let a2 = Infinity, b2 = -Infinity, c2 = Infinity, d2 = -Infinity;
  for (let i = 0; i < rt.lat.length; i++) { a2 = Math.min(a2, rt.lat[i]); b2 = Math.max(b2, rt.lat[i]); c2 = Math.min(c2, rt.lon[i]); d2 = Math.max(d2, rt.lon[i]); }
  const pr = makeProjection((a2 + b2) / 2, (c2 + d2) / 2), ix = makeRouteIndex(rt, pr);
  const L = makeCityLandscape(sc, pr, ix, rt);
  const B = sc.city.buildings, D = L.decoded;
  const u8 = (t) => Uint8Array.from(Buffer.from(t, 'base64')).buffer;
  const h = new Uint16Array(u8(B.h)), starts = new Uint32Array(u8(B.starts)), xy = new Int16Array(u8(B.xy));
  const buildings = [];
  for (let k = 0; k < B.count; k++) buildings.push({ k, ring: D.points(xy, starts[k], starts[k + 1]), h: h[k] / 10, kind: B.kind[k], name: B.names[k] || '' });
  const city = { buildings, streets: cityStreets(L, ix, rt), index: ix, route: rt };
  return { ...planCityHomes(city, sc.buildingKit), city, ix };
})();

test('building kit, Pittsburgh: homes become row houses and frame houses, rows get party walls along the street', () => {
  const P = pit.plan.buildings;
  assert.ok(P.length > 7500, `${P.length} homes`);
  const rows = P.filter((R) => R.kind === 'rowhouse'), frames = P.filter((R) => R.kind === 'house');
  assert.ok(rows.filter((R) => R.attached).length / rows.length > .2, 'row houses stand against their neighbours (many rows are mapped as one outline)');
  for (const R of rows.filter((x) => x.attached)) assert.ok(!R.party[R.front], 'a front is never a party wall');
  assert.ok(rows.filter((R) => R.style.preset === 'pittsburgh-rowhouse').length === rows.length);
  assert.ok(frames.every((R) => R.style.preset === 'pittsburgh-frame'));
  assert.ok(P.filter((R) => R.archetype === 'block').length < P.length * .02, 'rows are not blocks');
  const near = frames.filter((R) => R.full && R.rects.length);
  assert.ok(near.filter((R) => R.parts.frontPorch).length / near.length > .2, 'front porches near the route');
});

test('building kit, Pittsburgh: fronts face a street; porches and dressing stay off streets and out of buildings', () => {
  const P = pit.plan.buildings, S = pit.streets;
  let facing = 0, n = 0;
  for (const R of P) {
    const r = R.rects[0]; if (!r || R.d > 40) continue;
    const nrm = R.front === 0 ? [-r.vx, -r.vz] : R.front === 2 ? [r.vx, r.vz] : R.front === 1 ? [r.ux, r.uz] : [-r.ux, -r.uz];
    n++; if (nrm[0] * R.toRoad.x + nrm[1] * R.toRoad.z > .3) facing++;
  }
  assert.ok(facing / n > .8, `${facing} of ${n} fronts face their street`);
  const all = pit.city.buildings;
  for (const R of P) for (const it of R.dressing) {
    assert.equal(S.nearest(it.x, it.z, ROAD_HALF + 1.2), null, `${it.kind} on a street or sidewalk at ${it.x.toFixed(0)}, ${it.z.toFixed(0)}`);
    for (const O of all) {
      if (Math.abs(O.ring[0].x - it.x) > 80 || Math.abs(O.ring[0].z - it.z) > 80) continue;
      assert.ok(!pip(it.x, it.z, O.ring.map((p) => [p.x, p.z])), `${it.kind} inside a building`);
    }
  }
});
