// Riverfront promenades (js/world/toolbox/city/riverfront.js): the planner on Pittsburgh's riverfront trail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape, cityStreets } from '../js/world/toolbox/city/landscape.js';
import * as THREE from '../vendor/three.module.min.js';
import { planRiverfront, riverfrontField, buildRiverfront } from '../js/world/toolbox/city/riverfront.js';

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
const streets = cityStreets(L, index, route);

test('riverfront: Pittsburgh walls the Allegheny and Mon banks of the Point inside its spans', () => {
  const config = scene.riverfront;
  assert.ok(config?.spans?.length, 'the scene asks for promenades');
  const runs = planRiverfront({ landscape: L, route, index, streets, config });
  const total = runs.reduce((n, r) => n + r.samples[r.samples.length - 1].s - r.samples[0].s, 0);
  assert.ok(total > 900, `${total} m of promenade`);
  for (const run of runs) {
    const S = run.samples;
    assert.ok(config.spans.some((sp) => S[0].s >= sp.fromM && S[S.length - 1].s <= sp.toM), 'inside a span');
    for (let k = 1; k < S.length; k++) {
      // a smooth wall line, the walk never below the route's line
      assert.ok(Math.abs(S[k].outer - S[k - 1].outer) < 1.2, `wall line jumps at ${S[k].s} m`);
      assert.ok(S[k].deck >= S[k].y + .05, `walk below the route at ${S[k].s} m`);
      assert.ok(S[k].outer <= (config.maxGapM ?? 26) + 3, `wall too far out at ${S[k].s} m`);
    }
  }
  // the cover lookup: on the walk yes, the route's own centre no
  const { covers, groundCap } = riverfrontField(runs, L.level), q = runs[0].samples[10];
  assert.equal(covers(q.x + q.nx * (q.outer - 1), q.z + q.nz * (q.outer - 1)), true);
  assert.equal(covers(q.x, q.z), false);
  assert.ok(groundCap(q.x + q.nx * (q.outer + 5), q.z + q.nz * (q.outer + 5)) < L.level, 'past the wall: under the water');
  assert.equal(groundCap(q.x, q.z), Infinity);
});

test('riverfront: no spans, no promenades', () => {
  assert.deepEqual(planRiverfront({ landscape: L, route, index, streets, config: { spans: [] } }), []);
  assert.deepEqual(planRiverfront({ landscape: L, route, index, streets, config: undefined }), []);
});

test('riverfront: the meshes build (walls, railing, benches, the water steps) within a small budget', () => {
  const city = { route, index, landscape: L, streets, group: new THREE.Group(), solidMaterial: new THREE.MeshStandardMaterial(), own: (x) => x };
  const rf = buildRiverfront(city);
  assert.ok(rf.meshes.length >= 3 && rf.meshes.length <= 20, `${rf.meshes.length} meshes`);
  assert.ok(rf.tris > 5000 && rf.tris < 120000, `${rf.tris} triangles`);
  assert.ok(city.group.children.some((m) => m.name === 'Water steps'), 'the North Shore Water Steps');
  for (const m of rf.meshes) assert.ok(Number.isFinite(m.geometry.boundingSphere.radius));
});
