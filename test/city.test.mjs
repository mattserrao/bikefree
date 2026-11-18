import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape, LAND } from '../js/world/toolbox/city/landscape.js';
import { ghostAt } from '../js/world/ghost.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const item = JSON.parse(read('routes/catalog.json')).find((c) => c.id === 'pittsburgh');
const route = buildCatalogRoute(read(item.file), item);
const scene = JSON.parse(read(item.scene));
scene.city = JSON.parse(read(scene.cityData));
route.scene = scene;
let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
const proj = makeProjection((a + b) / 2, (c + d) / 2);
const index = makeRouteIndex(route, proj);
const L = makeCityLandscape(scene, proj, index, route);
const at = (lat, lon) => proj.toLocal(lat, lon);

test('pittsburgh: the core area\'s line (downtown, the South Side, the Jail Trail, the bridges) with the Mount Washington climb', () => {
  // (a city of areas, PLAN 5.4: Allegheny & Troy Hill, Oakland & Schenley, the West End and the North Side are areas of their own)
  assert.ok(route.turnS > 26000 && route.turnS < 32000, `${route.turnS} m`);
  const net = JSON.parse(read(item.network));
  assert.deepEqual(net.areas.map((x) => x.catalogId), ['pittsburgh', 'pittsburgh-allegheny', 'pittsburgh-westend', 'pittsburgh-oakland', 'pittsburgh-northside']);
  assert.equal(net.areas[0].legM, route.turnS);
  const top = Math.max(...route.ele), bottom = Math.min(...route.ele);
  assert.ok(top - bottom > 110, `climb ${top - bottom} m`);
  assert.ok(Math.max(...route.grade.map(Math.abs)) < 25);
});

test('pittsburgh: the three rivers are water, the road sits on the ground', () => {
  for (const [name, lat, lon] of [['Allegheny', 40.4455, -80.0035], ['Monongahela', 40.4350, -80.0021], ['Ohio', 40.4470, -80.0265]]) {
    const p = at(lat, lon);
    assert.equal(L.landAt(p.x, p.z), LAND.water, name);
    assert.ok(L.heightAt(p.x, p.z) < L.level, `${name} riverbed below the water`);
  }
  for (let i = 0; i <= route.turnIdx; i += 25) {
    const x = index.xs[i], z = index.zs[i];
    if (L.bridgeAt(x, z, 15)) continue;
    if (ghostAt(route, route.dist[i])) continue;   // a network tour's repeat is never drawn: the ground follows the real pass
    if (Math.abs(route.ele[i] - .5 - L.level) < 1) continue;   // a wharf at the water's edge: the ground keeps off the water's level
    assert.ok(Math.abs(L.heightAt(x, z) - (route.ele[i] - .5)) < .25, `ground meets the road at ${route.dist[i]} m`);
  }
});

test('pittsburgh: famous bridges are on the ride, buildings and streets are bundled', () => {
  const names = L.routeBridges.map((r) => r.name);
  for (const n of ['Roberto Clemente Bridge', 'Smithfield Street Bridge', 'West End Bridge']) assert.ok(names.includes(n), n);
  for (const r of L.routeBridges) assert.ok(r.fromM >= 0 && r.toM <= route.turnS + 1 && r.toM > r.fromM);
  assert.ok(scene.city.buildings.count > 5000);
  assert.ok(scene.city.streets.count > 1000);
  assert.ok((scene.city.rails || []).some((r) => r.kind === 'funicular'), 'the inclines');
});
