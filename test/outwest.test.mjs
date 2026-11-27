// Out West: the fifth free-ride road graph (user, 26 Nov 2026: "a blend of many of the famous Utah and Arizona national
// parks (Arches, Bryce, Monument Valley, Zion) … 6+ well thought out rides … the same 'grid' road architecture as the
// other major maps … Moody landscapes and detailed hero structures"; base region Kanab, UT). npm run map:build -- outwest
// (tools/city/outwest.json: a circle round Kanab plus corridors up the canyons) → routes/cities/outwest.json; the land
// cover from WorldCover as the desert's covers; the heroes by tools/outwest_heroes.py; the rides by
// tools/city/outwest-routes.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { graphNetwork, decodeGraph } from '../js/graph.js';
import { loadNetwork, makePathRoute, planCloses } from '../js/network.js';
import { qcGraph } from '../tools/qc_pgh.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const json = read('routes/cities/outwest.json'), city = read('routes/cities/outwest-city.json'), heroes = read('routes/cities/outwest-heroes.json');

test('Out West is rideable: one piece, every way through every junction, its canyons out and back (tools/qc_pgh.mjs)', () => {
  const r = qcGraph(json, { rides: 40, km: 30 });
  assert.deepEqual(r.fails.slice(0, 5), [], `${r.fails.length} rideability failures`);
  // (user, 26 Nov 2026: the corridors' empty middles cut out and Kanab shrunk to 2.5 km — tools/citylib/warp.py: 413 → ~250 km)
  assert.ok(r.summary.km > 200 && r.summary.km < 330, `${r.summary.km} km`);
});

test('Out West keeps its corridors: US 89 up Kanab Creek Canyon over the summit to Mt Carmel, Johnson Canyon, Hancock Road', () => {
  const G = decodeGraph(json);
  const north = Math.max(...G.edges.filter((e) => e.name === 'US 89').flatMap((e) => [...e.lat]));
  assert.ok(north > 37.17, `US 89 reaches ${north}`);   // (the canyon climb shortened by the warp: the tunnel ~14 km out, not 22)
  const top = Math.max(...G.edges.flatMap((e) => [...e.ele]));
  assert.ok(top > 1700, `the summit ${top} m`);
  for (const n of ['Johnson Canyon Road', 'Hancock Road', 'Coral Pink Sand Dunes Road', 'Eight Mile Gap Road']) assert.ok(G.edges.some((e) => e.name === n), n);
});

test('Out West\'s land is the desert\'s: pinyon-juniper, sage and slickrock from WorldCover, the dunes sand', () => {
  const L = city.land, a = gunzipSync(readFileSync(new URL(`../${L.file}`, import.meta.url)));
  assert.equal(a.length, L.nx * L.ny);
  assert.ok(L.nx <= 4096 && L.ny <= 4096, 'fits a phone\'s texture');
  const share = (c) => a.reduce((n, v) => n + (v === c), 0) / a.length;
  assert.ok(share(40) + share(41) + share(42) > .6, 'the desert covers');
  assert.equal(share(2), 0, 'no eastern woods');
  const at = (la, lo) => a[Math.round((L.north - la) / (L.north - L.south) * (L.ny - 1)) * L.nx + Math.round((lo - L.west) / (L.east - L.west) * (L.nx - 1))];
  assert.equal(at(37.03514, -112.66977), 5, 'the Coral Pink dunes are sand');   // (37.032, −112.728 moved by the warp)
});

test('Out West\'s eight rides each close and ride as presets: flat, rolling, climbs, gravel, out-and-back canyons', () => {
  const { base, network } = graphNetwork(json), net = loadNetwork(network, base);
  assert.ok(json.presets.length >= 6, `${json.presets.length} rides`);
  const tags = new Set();
  for (const p of json.presets) {
    assert.ok(planCloses(net, p.path), `${p.id} closes`);
    const r = makePathRoute(net, p);
    assert.ok(r.lapM > 5000, `${p.id}: ${r.lapM} m`);
    for (const t of p.tags) tags.add(t);
  }
  for (const t of ['flat', 'rolling', 'climb', 'gravel']) assert.ok(tags.has(t), t);
  const climb = json.presets.find((p) => p.id === 'ow-kolob-climb');
  assert.ok(climb.climbM > 280, `the Kolob Terrace climb: ${climb.climbM} m`);   // (the warp cut part of the canyon climb: user, 26 Nov — "it can shrink")
  assert.ok(json.presets.some((p) => p.id === 'ow-tunnel-hoodoos'), 'the ride through the tunnel');
});

test('Out West\'s heroes: the tunnel on US 89, Hoodoo Rim, the Arch Garden, Butte Valley, the movie set — off the ways but the tunnel', () => {
  const by = Object.fromEntries(heroes.landmarks.map((l) => [l.model, l]));
  for (const m of ['ow_tunnel', 'ow_hoodoos', 'ow_arches', 'ow_buttes', 'ow_frontier']) assert.ok(by[m], m);
  const G = decodeGraph(json), pts = G.edges.flatMap((e) => [...e.lat].map((la, i) => [la, e.lon[i], e.name]));
  const near = (la, lo) => pts.reduce((b, [a, o, n]) => { const d = Math.hypot((a - la) * 110540, (o - lo) * 88900); return d < b.d ? { d, n } : b; }, { d: Infinity });
  for (const [la, lo] of by.ow_tunnel.path.filter((_, i) => i % 10 === 0)) { const n = near(la, lo); assert.ok(n.d < 12 && n.n === 'US 89', `the bore on US 89 (${n.d.toFixed(1)} m off ${n.n})`); }
  assert.ok(by.ow_tunnel.galleries.length >= 2, 'galleries');
  for (const b of by.ow_buttes.buttes) assert.ok(near(...b.center).d > b.R * 1.5, `${b.name} clear of the ways`);
  assert.ok(by.ow_hoodoos.points.length > 100, 'a field of hoodoos');
});

test('Out West\'s red rock and desert kit stay inside their triangle budget', async () => {
  const { RockBuilder } = await import('../js/world/toolbox/landscape/redrock.js');
  const { outwestLandmarkModels } = await import('../js/world/toolbox/city/outwest-landmarks.js');   // (it parses: a slip there loses every landmark and the city)
  assert.equal(typeof outwestLandmarkModels, 'function');
  const R = new RockBuilder(), flat = () => 0;
  for (let k = 0; k < 10; k++) R.hoodoo(k * 10, 0, 0, 20, 2.5, k + 1, flat);
  assert.ok(R.tris / 10 < 800, `a hoodoo: ${R.tris / 10} triangles`);
  const B = new RockBuilder(); B.butte(0, 0, flat, { R: 100, H: 150 });
  assert.ok(B.tris < 6000, `a butte: ${B.tris}`);
  const { makeUpstateTrees } = await import('../js/world/toolbox/vegetation/upstate-trees.js');
  const kit = makeUpstateTrees({ desert: true });
  for (const n of ['juniper', 'pinyon', 'cottonwood']) assert.ok(kit.species[n], n);
  for (const n of ['sage', 'rabbitbrush', 'redrock']) assert.ok(kit.understory[n], n);
});

test('Out West is squeezed (user, 26 Nov 2026): the landmarks closer to Kanab, the town 2.5 km, half the homes adobe', async () => {
  // (tools/citylib/warp.py: the corridors' empty middles cut out — Butte Valley ~6 km out, the Arch Garden ~10, the tunnel ~14)
  const s = json.start, d = ([la, lo]) => Math.hypot((la - s.lat) * 110540, (lo - s.lon) * 88900) / 1000;
  const by = Object.fromEntries(heroes.landmarks.map((l) => [l.model, l]));
  assert.ok(d(by.ow_buttes.center) < 8, `Butte Valley ${d(by.ow_buttes.center).toFixed(1)} km`);
  assert.ok(d(by.ow_arches.center) < 11.5, `the Arch Garden ${d(by.ow_arches.center).toFixed(1)} km`);
  assert.ok(d(by.ow_tunnel.center) < 16, `the tunnel ${d(by.ow_tunnel.center).toFixed(1)} km`);
  assert.ok(by.ow_adobe?.sites.length >= 8, 'the old adobe in the country');
  const { KIT_STYLES } = await import('../js/world/graph-city.js');
  const pueblo = KIT_STYLES.outwest.find((st) => st.preset === 'kanab-pueblo');
  assert.equal(pueblo.share, .5);
});
