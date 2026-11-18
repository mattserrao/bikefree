import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape, cityStreets } from '../js/world/toolbox/city/landscape.js';
import { planJunctions, streetPieces, streetOverlaps } from '../js/world/toolbox/city/junctions.js';
import { ROAD_WIDTH, ROAD_LIFT } from '../js/world/pose.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// a tiny synthetic city: a plus-shaped crossing of two streets, and a T onto a straight route
function synthetic() {
  const P = (x, z, y = 100) => ({ x, z, y });
  const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => P(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n));
  const mk = (pts, nodeIdx, cls = 5, width = 9.5) => ({ cls, width, bridge: false, oneway: 0, layer: 0, pts, nodes: nodeIdx.map((i) => pts[i]), nodeIdx });
  // street A: west–east through (0, 0); street B: north–south through (0, 0); (nodes shared at the crossing)
  const A = mk(line(P(-60, 0), P(60, 0), 12), [0, 6, 12]);
  const B = mk(line(P(0, -60), P(0, 60), 12), [0, 6, 12]);
  // street C ends on the route (which runs along z = 200)
  const C = mk(line(P(100, 140), P(100, 200), 6), [0, 6]);
  const n = 60, route = { dist: [], ele: [], turnIdx: n }, xs = [], zs = [];
  for (let i = 0; i <= n; i++) { route.dist.push(i * 10); route.ele.push(100); xs.push(-200 + i * 10); zs.push(200); }
  const index = { xs, zs, nearest: (x, z, r) => { let best = null; for (let i = 0; i <= n; i++) { const d = Math.hypot(xs[i] - x, zs[i] - z); if (d < r && (!best || d < best.d)) best = { i, d }; } return best; } };
  const routeDist = (x, z) => (x > -200 && x < 400 && Math.abs(z - 200) < 30 ? { d: Math.abs(z - 200), i: Math.floor((x + 200) / 10), y: 100 } : null);
  return { streets: [A, B, C], ctx: { route, index, end: n, routeDist, roadWidth: ROAD_WIDTH } };
}

test('junctions: a plain crossing becomes one level surface with four trimmed arms and four curb returns', () => {
  const { streets, ctx } = synthetic();
  const before = streetOverlaps(streets, null).overlapM;
  const plan = planJunctions(streets, ctx, true);
  const cross = plan.list.find((j) => !j.route);
  assert.ok(cross, 'the crossing is a junction');
  assert.equal(cross.arms.length, 4);
  assert.equal(cross.curbs.length, 4, 'a curb return in every corner');
  for (const a of cross.arms) assert.ok(a.t > 4.75 && a.t < 15, `arm trimmed at ${a.t} m`);
  // streets are cut at the junction's edge: two pieces each, none reaching the centre
  for (const k of [0, 1]) {
    const pieces = streetPieces(streets[k], plan.cuts.get(k));
    assert.equal(pieces.length, 2);
    for (const pc of pieces) for (const p of pc) assert.ok(Math.hypot(p.x, p.z) > 4.7, 'no ribbon inside the junction');
  }
  assert.ok(before > 10, `overlap without junctions ${before} m`);
  assert.equal(streetOverlaps(streets, plan).overlapM, 0, 'no overlapping ribbons left');
  // the surface is level and the polygon goes round the centre
  for (const p of cross.poly) assert.ok(Math.abs(cross.J(p.x, p.z) - 100) < 1e-6);
});

test('junctions: a street meeting the route gets a route junction just under the road surface', () => {
  const { streets, ctx } = synthetic();
  const plan = planJunctions(streets, ctx, true);
  const t = plan.list.find((j) => j.route);
  assert.ok(t, 'route junction');
  assert.equal(t.arms.filter((a) => a.route).length, 2);
  assert.equal(plan.spans.length, 1);
  const sp = plan.spans[0];
  assert.ok(sp.s0 < t.s && sp.s1 > t.s && sp.s1 - sp.s0 < 40, `span ${sp.s0}–${sp.s1}`);
  for (const p of t.poly) {
    const top = t.J(p.x, p.z) + t.lift;
    assert.ok(top < 100 + ROAD_LIFT - .02 && top > 100 + ROAD_LIFT - .1, `surface ${top}`);
  }
});

test('junctions: pittsburgh, planned the way the renderer and the course QC see it', () => {
  const item = JSON.parse(read('routes/catalog.json')).find((c) => c.id === 'pittsburgh');
  const route = buildCatalogRoute(read(item.file), item);
  const scene = JSON.parse(read(item.scene));
  scene.city = JSON.parse(read(scene.cityData));
  scene.junctions = true;
  route.scene = scene;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
  const proj = makeProjection((a + b) / 2, (c + d) / 2), index = makeRouteIndex(route, proj);
  const L = makeCityLandscape(scene, proj, index, route);
  const streets = cityStreets(L, index, route), plan = L._junctions;
  assert.ok(plan.list.length > 1000, `${plan.list.length} junctions`);
  assert.ok(plan.list.filter((j) => j.route).length > 60);
  const o = streetOverlaps(streets, plan);
  assert.ok(o.overlapM < 12000, `overlapping ribbons ${o.overlapM} m (41.8 km without junctions)`);
  // every junction surface the route passes through stays under its road
  for (const jn of plan.list) for (const p of jn.poly) {
    const r = L.routeDist(p.x, p.z);
    if (r && r.d < ROAD_WIDTH / 2) assert.ok(jn.J(p.x, p.z) + jn.lift < r.y + ROAD_LIFT, `junction ${jn.id} over the road`);
  }
});

test('junctions: cutting the route shoulder at a junction keeps the quads the ribbon left out (ghost repeats, F19)', async () => {
  const THREE = await import('../vendor/three.module.min.js');
  const { cutRouteRibbon } = await import('../js/world/toolbox/city/junction-mesh.js');
  // a straight 10-station ribbon along z; segments 6–7 dropped (a ghost repeat), a junction span over 2–3.5 m
  const n = 10, pos = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) { pos.push(-1, 0, i, 1, 0, i); uv.push(0, i, 1, i); }
  for (let i = 0; i < n - 1; i++) { if (i === 6 || i === 7) continue; const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const mesh = new THREE.Mesh(g);
  cutRouteRibbon(mesh, { spans: [{ s0: 2, s1: 3.5 }] }, Float64Array.from({ length: n }, (_, i) => i));
  const P = mesh.geometry.attributes.position.array, I = mesh.geometry.index.array;
  const covered = (z) => { for (let t = 0; t < I.length; t += 6) { const zs = [I[t], I[t + 2]].map((v) => P[v * 3 + 2]); if (z > Math.min(...zs) && z < Math.max(...zs)) return true; } return false; };
  for (const z of [0.5, 1.5, 3.7, 5.5, 8.5]) assert.ok(covered(z), `shoulder at ${z} m`);
  for (const z of [2.5, 3.2, 6.5, 7.5]) assert.ok(!covered(z), `no shoulder at ${z} m`);
});
