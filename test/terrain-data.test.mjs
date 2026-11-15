import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeRegionalLandscape } from '../js/world/regional-landscape.js';
import { attachTerrainBuffer, makeTerrainSampler } from '../js/world/terrain-data.js';
import { planSettlement } from '../js/world/settlement.js';
import { ForestPlanner, TILE_M } from '../js/world/forest.js';
import { loadSceneSync } from '../tools/qc_course.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const item = JSON.parse(read('routes/catalog.json')).find((r) => r.id === 'route28');
const route = buildCatalogRoute(read(item.file), item);
const scene = loadSceneSync(item.scene);
route.scene = scene;
const proj = makeProjection((Math.min(...route.lat) + Math.max(...route.lat)) / 2, (Math.min(...route.lon) + Math.max(...route.lon)) / 2);
const index = makeRouteIndex(route, proj);
const landscape = makeRegionalLandscape(scene, proj, index, route);

test('route 28 follows NY-28 through Eagle Bay', () => {
  const eagleBay = proj.toLocal(43.7686, -74.8181);
  assert.ok(index.nearest(eagleBay.x, eagleBay.z, 200), 'the road passes Eagle Bay');
});

test('baked terrain decodes, rejects the wrong size, and has the Fulton Chain at real levels', () => {
  assert.throws(() => attachTerrainBuffer({ terrainData: { ...scene.terrainData } }, new ArrayBuffer(10)), /size/);
  const lakes = Object.fromEntries(scene.terrainData.lakes.filter((l) => l.name).map((l) => [l.name, l]));
  assert.ok(Math.abs(lakes['Fourth Lake'].level - 520) < 1.5, 'lower chain near 1,707 ft');
  assert.ok(lakes['Fourth Lake'].areaHa > 600, 'Fourth Lake is the big one');
  assert.ok(lakes['Sixth and Seventh Lake'].level - lakes['Fourth Lake'].level > 20, 'upper chain sits higher');
  const t = makeTerrainSampler(scene.terrainData, proj);
  const fourth = proj.toLocal(lakes['Fourth Lake'].lat, lakes['Fourth Lake'].lon);
  assert.ok(t.shore(fourth.x, fourth.z) < 0, 'Fourth Lake centroid is on the water');
});

test('the road never runs through a lake, and the ground follows the real elevation', () => {
  for (let i = 0; i < route.turnIdx; i += 7) {
    const x = index.xs[i], z = index.zs[i];
    assert.ok(landscape.shoreAt(x, z) > 0, `@${route.dist[i]} m on land`);
    assert.ok(landscape.waterLevelAt(x, z) < route.ele[i] - 1, `@${route.dist[i]} m water below road`);
  }
  // 400 m off the road the ground is the real terrain, not authored sine hills
  const t = landscape.terrain, i = Math.floor(route.turnIdx / 3), x = index.xs[i] + 400, z = index.zs[i];
  if (landscape.shoreAt(x, z) > 30) assert.ok(Math.abs(landscape.heightAt(x, z) - t.height(x, z)) < 4);
});

test('villages and camps stay off the road and out of the water; docks reach it', () => {
  const plan = planSettlement(scene, route, index, landscape);
  const camps = plan.items.filter((i) => i.asset.startsWith('camp')), docks = plan.items.filter((i) => i.water);
  assert.ok(plan.items.filter((i) => i.asset.startsWith('house')).length > 60, 'Old Forge and Inlet have streets of houses');
  assert.ok(camps.length > 20 && docks.length > 15, 'the lakeshore is lined with camps and docks');
  for (const it of plan.items) {
    const road = index.nearest(it.x, it.z, 60);
    assert.ok(!road || road.d > it.r * .7 + 5, `${it.asset} clear of the road`);
    if (!it.water) assert.ok(landscape.shoreAt(it.x, it.z) > 0, `${it.asset} on land`);
  }
  assert.deepEqual(planSettlement(scene, route, index, landscape).items.length, plan.items.length, 'deterministic');
});

test('forest tiers are nested: a tree never moves when its tile changes detail', () => {
  const plan = planSettlement(scene, route, index, landscape);
  const forest = new ForestPlanner(scene, landscape, index, (x, z) => landscape.heightAt(x, z), plan.clearings);
  const i = 300, cx = Math.floor(index.xs[i] / TILE_M) + 1, cz = Math.floor(index.zs[i] / TILE_M);
  const spots = (tier) => new Set(Object.entries(forest.tile(cx, cz, tier)).filter(([n]) => /^(maple|spruce|hemlock|birch|whitepine)/.test(n))
    .flatMap(([, ms]) => ms.map((m) => `${m.elements[12].toFixed(2)},${m.elements[14].toFixed(2)}`)));
  const near = spots(0), mid = spots(1), far = spots(2);
  assert.ok(near.size > 300, `a dense stand (${near.size} trees in a 3.7 ha tile)`);
  for (const p of mid) assert.ok(near.has(p));
  for (const p of far) assert.ok(mid.has(p) || near.has(p));
  // no tree trunk on the road
  for (const p of near) { const [x, z] = p.split(',').map(Number); assert.ok((index.nearest(x, z, 8)?.d ?? 9) > 6.5); }
});
