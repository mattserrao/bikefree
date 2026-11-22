// CNY: the second free-ride road graph (user, 22 Nov: "Create a new map CNY following the guide used for PGH. Establish
// the map inside the red circle. Build ~5 high quality bike rides"): tools/build_pgh.py --city cny (tools/city/cny.json)
// → routes/cities/cny.json; tools/pgh_city.py --city cny; tools/pgh_routes.mjs --city cny --write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { graphNetwork, decodeGraph, nearestEdge } from '../js/graph.js';
import { loadNetwork, makePathRoute, planCloses } from '../js/network.js';
import { qcGraph } from '../tools/qc_pgh.mjs';

const json = JSON.parse(readFileSync(new URL('../routes/cities/cny.json', import.meta.url), 'utf8'));
const cfg = JSON.parse(readFileSync(new URL('../tools/city/cny.json', import.meta.url), 'utf8'));

test('CNY is rideable: one connected piece, no dead ends, every way through every junction (tools/qc_pgh.mjs)', () => {
  const r = qcGraph(json, { rides: 40, km: 20 });
  assert.deepEqual(r.fails.slice(0, 5), [], `${r.fails.length} rideability failures`);
  assert.ok(r.summary.km > 150, `${r.summary.km} km`);
  const deg = new Map(); for (const e of json.edges) for (const v of [e.from, e.to]) deg.set(v, (deg.get(v) || 0) + 1);
  assert.deepEqual([...deg].filter(([, d]) => d === 1).map(([v]) => v), [], 'dead ends (the circle\'s edge closes its loops just outside it)');
});

test('CNY is the circle: almost all of it inside, the rest only loops closed just outside (tools/build_pgh.py trim_to_circle)', () => {
  const [lat0, lon0, R] = cfg.area.circle, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  const G = decodeGraph(json);
  let inside = 0, all = 0, far = 0;
  for (const e of G.edges) for (let i = 0; i <= e.n; i++) {
    const d = Math.hypot((e.lon[i] - lon0) * kx, (e.lat[i] - lat0) * 110540); all++;
    if (d <= R) inside++; if (d > R + cfg.area.marginM) far++;
  }
  assert.ok(inside / all > 0.75, `${Math.round(inside / all * 100)} % inside`);
  assert.equal(far, 0);
  // the Erie Canalway Trail is kept beside Thompson Road (keepParallelTrails)
  const trail = G.edges.filter((e) => e.name === 'Erie Canalway Trail').reduce((a, e) => a + e.n * 10, 0);
  assert.ok(trail > 10000, `Erie Canalway Trail ${trail} m`);
});

test('CNY starts in Camillus village and has its own files (ground, city data, an empty landmarks host)', () => {
  const G = decodeGraph(json);
  const at = nearestEdge(G, json.start.lat, json.start.lon);
  assert.ok(Math.abs(at.e.lat[at.i] - json.start.lat) < 0.003);
  assert.equal(json.id, 'cny'); assert.equal(json.name, 'CNY');
  for (const k of ['ground', 'cityData', 'heroes']) assert.ok(existsSync(new URL(`../${json[k]}`, import.meta.url)), `${k}: ${json[k]}`);
  assert.equal(json.shore, undefined); assert.equal(json.bridges, undefined);
  const net = graphNetwork(json);
  assert.deepEqual(net.network.edges.filter((e) => /Interstate|I-90|Thruway|I-690/.test(e.name)).map((e) => e.name), []);
});

test('CNY\'s five routes (tools/pgh_routes.mjs --city cny): closed plans over its own ways, no way twice, in cny-presets.json', () => {
  const list = JSON.parse(readFileSync(new URL('../routes/cities/cny-presets.json', import.meta.url), 'utf8'));
  const { base, network } = graphNetwork(json);
  const net = loadNetwork(network, base);
  assert.equal(net.presets.length, list.length);
  assert.equal(list.length, 5);
  for (const p of net.presets) {
    assert.ok(planCloses(net, p.path), `${p.name} does not close`);
    const ids = p.path.map((k) => k.slice(0, -1));
    assert.equal(new Set(ids).size, ids.length, `${p.name} rides a way twice`);
    const r = makePathRoute(net, p);
    assert.ok(Math.abs(r.lapM - list.find((x) => x.id === p.id).lengthM) < 50);
  }
});

test('the app lists CNY as its own card beside PGH (routes/cities/graph-cities.json)', () => {
  const cities = JSON.parse(readFileSync(new URL('../routes/cities/graph-cities.json', import.meta.url), 'utf8'));
  assert.deepEqual(cities.find((c) => c.id === 'cny'), { ...cities.find((c) => c.id === 'cny'), name: 'CNY', park: 'Camillus, NY' });
  assert.ok(cities.findIndex((c) => c.id === 'cny') > cities.findIndex((c) => c.id === 'pgh'));
});

test('CNY\'s landmarks (tools/cny_heroes.py): the aqueduct, Sims\' Store, the Octagon House, the churches, the canal\'s water', async () => {
  const h = JSON.parse(readFileSync(new URL('../routes/cities/cny-heroes.json', import.meta.url), 'utf8'));
  const models = new Set(h.landmarks.map((l) => l.model));
  for (const m of ['aqueduct', 'canalstore', 'octagon', 'railbridge', 'canal']) assert.ok(models.has(m), m);
  assert.ok(h.heroes.filter((x) => x.model === 'church').length >= 3);
  const { cnyLandmarkModels } = await import('../js/world/toolbox/city/cny-landmarks.js');
  const M = cnyLandmarkModels({ S: {}, N: {}, glows: [], plan: () => ({}), ground: () => 0, local: () => ({ x: 0, z: 0 }), L: {} });
  for (const l of h.landmarks) assert.equal(typeof M[l.model], 'function', `no model for ${l.model}`);
});

test('CNY\'s houses: the suburban style (fewer windows, ranches and colonials) and building heights from their size', async () => {
  const { STYLE_PRESETS } = await import('../js/world/toolbox/structures/buildings/presets.js');
  const { bays } = await import('../js/world/toolbox/structures/buildings/recipe.js');
  const st = STYLE_PRESETS['cny-suburban'];
  assert.ok(st.bayM >= 4 && st.maxFloors === 2 && st.ranch > 0);
  assert.ok(bays(13.2, 7, st.bayM).n < bays(13.2, 7).n, 'fewer windows along a wall than the default sash bay');
  assert.equal(bays(13.2, 7).n, 5);   // (PGH's houses unchanged)
});

test('CNY\'s country (user, 22 Nov: "villages, suburbs, and farms … farmland requires new texture and models"): fields, barns, farmhouses, village houses', async () => {
  const { gunzipSync } = await import('node:zlib');
  const land = gunzipSync(readFileSync(new URL('../routes/cities/cny-land.bin.gz', import.meta.url)));
  const n = (a, b) => land.reduce((s, c) => s + (c >= a && c <= b ? 1 : 0), 0);
  assert.ok(n(20, 28) / land.length > 0.25, 'fields cover much of the land');
  for (const [a, b] of [[20, 23], [24, 27], [28, 28], [29, 29]]) assert.ok(n(a, b) > 1000, `land codes ${a}-${b}`);
  const idx = JSON.parse(readFileSync(new URL('../routes/cities/cny-city.json', import.meta.url), 'utf8'));
  const kinds = new Map();
  for (const k of Object.keys(idx.sectors.list)) for (const c of JSON.parse(readFileSync(new URL(`../routes/cities/cny-city/s_${k}.json`, import.meta.url), 'utf8')).buildings.kind) kinds.set(c, (kinds.get(c) || 0) + 1);
  for (const k of [20, 21, 23, 24]) assert.ok(kinds.get(k) > 20, `kind ${k}: ${kinds.get(k)}`);
  const { STYLE_PRESETS } = await import('../js/world/toolbox/structures/buildings/presets.js');
  assert.ok(STYLE_PRESETS['cny-village'] && STYLE_PRESETS['cny-farmhouse']);
  const { KIT_STYLES } = await import('../js/world/graph-city.js');
  assert.deepEqual(KIT_STYLES.cny.map((s) => s.preset), ['cny-village', 'cny-farmhouse', 'cny-suburban']);
  const { MeshBuilder } = await import('../js/world/toolbox/core/mesh-builder.js');
  const { farmBuilding, fitRect } = await import('../js/world/toolbox/city/cny-farms.js');
  const ring = [{ x: 0, z: 0 }, { x: 4, z: 30 }, { x: 18, z: 28 }, { x: 14, z: -2 }];
  const r = fitRect(ring); assert.ok(r.hu > r.hv && Math.abs(r.hu - 15.1) < 0.3);
  let silos = 0;
  for (const kind of [21, 22, 24]) for (let k = 0; k < 20; k++) { const M = new MeshBuilder({ aGlow: 1 }); silos += farmBuilding(M, { k, kind, ring }, { heightAt: () => 120 }); assert.ok(M.count > 40); }
  assert.ok(silos > 5, 'silos by many barns');
});
