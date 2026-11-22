// SKAN: the third free-ride road graph (user, 22 Nov: a map "focused around Skaneateles and Marcellus", extended "so
// there is a route down and around Skaneateles lake … and a route around Otisco lake as well"; "There is a lot of
// farmland, forests, rural housing, then villages / towns. Ensure these are accurate"): tools/build_pgh.py --city skan
// (tools/city/skan.json: a circle plus corridors) → routes/cities/skan.json; tools/pgh_city.py --city skan (WorldCover
// land cover); tools/pgh_routes.mjs --city skan --write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { graphNetwork, decodeGraph, nearestEdge } from '../js/graph.js';
import { loadNetwork, makePathRoute, planCloses } from '../js/network.js';
import { qcGraph } from '../tools/qc_pgh.mjs';

const json = JSON.parse(readFileSync(new URL('../routes/cities/skan.json', import.meta.url), 'utf8'));
const cfg = JSON.parse(readFileSync(new URL('../tools/city/skan.json', import.meta.url), 'utf8'));
const city = JSON.parse(readFileSync(new URL('../routes/cities/skan-city.json', import.meta.url), 'utf8'));

test('SKAN is rideable: one connected piece, no dead ends, every way through every junction (tools/qc_pgh.mjs)', () => {
  const r = qcGraph(json, { rides: 40, km: 30 });
  assert.deepEqual(r.fails.slice(0, 5), [], `${r.fails.length} rideability failures`);
  assert.ok(r.summary.km > 350, `${r.summary.km} km`);
  const deg = new Map(); for (const e of json.edges) for (const v of [e.from, e.to]) deg.set(v, (deg.get(v) || 0) + 1);
  assert.deepEqual([...deg].filter(([, d]) => d === 1).map(([v]) => v), [], 'dead ends');
});

test('SKAN keeps US 20 as Skaneateles\' main street (a trunk ridden, not cut into slips) and the Charlie Major Nature Trail', () => {
  const G = decodeGraph(json);
  const len = (re) => G.edges.filter((e) => re.test(e.name || '')).reduce((a, e) => a + e.n * 10, 0);
  assert.ok(len(/^(East|West) Genesee Street$|^Cherry Valley Turnpike$/) > 6000, 'US 20');
  assert.ok(len(/^Charlie Major Nature Trail$/) > 1000, 'the trail');
});

test('SKAN\'s two lakes are pools at their own levels with no dam, and none overlap', () => {
  const pools = json.pools;
  assert.ok(pools.some((p) => p.level === 263) && pools.some((p) => p.level === 240));
  for (const p of pools) assert.equal(p.dam, false);
  for (let a = 0; a < pools.length; a++) for (let b = a + 1; b < pools.length; b++) {
    const [s1, w1, n1, e1] = pools[a].box, [s2, w2, n2, e2] = pools[b].box;
    const overlap = Math.min(n1, n2) - Math.max(s1, s2) > 1e-6 && Math.min(e1, e2) - Math.max(w1, w2) > 1e-6;
    assert.ok(!overlap, `${pools[a].name} overlaps ${pools[b].name}`);
  }
});

test('SKAN\'s land cover is the country\'s: crops, pasture and forest from WorldCover, villages where the houses stand close', () => {
  const L = city.land, a = gunzipSync(readFileSync(new URL(`../${L.file}`, import.meta.url)));
  assert.equal(a.length, L.nx * L.ny);
  assert.ok(L.nx <= 4096 && L.ny <= 4096, 'fits a phone\'s texture');
  const share = (c) => a.reduce((n, v) => n + (v === c), 0) / a.length;
  assert.ok(share(10) > 0.15, `crops ${share(10)}`); assert.ok(share(11) > 0.07, `pasture ${share(11)}`); assert.ok(share(2) > 0.3, `woods ${share(2)}`);
  const at = (la, lo) => a[Math.round((L.north - la) / (L.north - L.south) * (L.ny - 1)) * L.nx + Math.round((lo - L.west) / (L.east - L.west) * (L.nx - 1))];
  const near = (la, lo, code, r = 6) => { let n = 0, t = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { t++; if (at(la + dy * 9e-5, lo + dx * 1.2e-4) === code) n++; } return n / t; };
  assert.ok(near(42.9500, -76.4300, 8) > 0.3, 'Skaneateles village: yards');
  assert.ok(near(42.9850, -76.3410, 8) > 0.3, 'Marcellus village: yards');
  assert.ok(near(42.9250, -76.4250, 3) > 0.9, 'Skaneateles Lake: water');
});

test('SKAN starts in Skaneateles village and has its own files (ground, city data, an empty landmarks host)', () => {
  const G = decodeGraph(json);
  const at = nearestEdge(G, json.start.lat, json.start.lon);
  assert.ok(Math.abs(at.e.lat[at.i] - json.start.lat) < 0.003);
  assert.equal(json.id, 'skan'); assert.equal(json.name, 'SKAN');
  for (const k of ['ground', 'cityData', 'heroes']) assert.ok(existsSync(new URL(`../${json[k]}`, import.meta.url)), `${k}: ${json[k]}`);
  assert.equal(cfg.area.lines, 'skan-area-lines.json');
});

test('SKAN\'s seven routes (tools/pgh_routes.mjs --city skan): closed plans over its own ways, no way twice, in skan-presets.json', () => {
  const list = JSON.parse(readFileSync(new URL('../routes/cities/skan-presets.json', import.meta.url), 'utf8'));
  const { base, network } = graphNetwork(json);
  const net = loadNetwork(network, base);
  assert.equal(list.length, 7);
  assert.equal(net.presets.length, list.length);
  for (const p of net.presets) {
    assert.ok(planCloses(net, p.path), `${p.name} does not close`);
    const ids = p.path.map((k) => k.slice(0, -1));
    assert.equal(new Set(ids).size, ids.length, `${p.name} rides a way twice`);
    const r = makePathRoute(net, p);
    assert.ok(Math.abs(r.lapM - list.find((x) => x.id === p.id).lengthM) < 50);
  }
  const loop = list.find((x) => x.id === 'skan-lake-loop'), otisco = list.find((x) => x.id === 'skan-otisco-loop');
  assert.ok(loop.lengthM > 50000 && loop.climbM > 600, 'round Skaneateles Lake');
  assert.ok(otisco.lengthM > 20000, 'round Otisco Lake');
});

test('the app lists SKAN as its own card beside PGH and CNY (routes/cities/graph-cities.json)', () => {
  const cities = JSON.parse(readFileSync(new URL('../routes/cities/graph-cities.json', import.meta.url), 'utf8'));
  const skan = cities.find((c) => c.id === 'skan');
  assert.equal(skan.name, 'SKAN');
  assert.equal(skan.park, 'Skaneateles, NY');
});
