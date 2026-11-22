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

test('the app lists CNY as its own card beside PGH (js/app.js GRAPH_CITIES)', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /\{ id: 'cny', name: 'CNY', park: 'Camillus, NY'/);
  assert.match(app, /routes\/cities\/\$\{c\.id\}-presets\.json/);
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
