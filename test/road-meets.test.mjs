import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape, cityStreets } from '../js/world/toolbox/city/landscape.js';
import { alignAlongRoute, trimOverlaps, joinCrossings, roadMeets, streetSlots, MEET_LIMITS } from '../js/world/toolbox/city/road-meets.js';
import { ROAD_WIDTH } from '../js/world/pose.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// a straight route along z = 0 (x from -200 to 400), 10 m samples, at height 100
function straightRoute() {
  const n = 60, route = { dist: [], ele: [], turnIdx: n }, xs = [], zs = [];
  for (let i = 0; i <= n; i++) { route.dist.push(i * 10); route.ele.push(100); xs.push(-200 + i * 10); zs.push(0); }
  const index = { xs, zs, nearest: (x, z, r) => { let best = null; for (let i = 0; i <= n; i++) { const d = Math.hypot(xs[i] - x, zs[i] - z); if (d < r && (!best || d < best.d)) best = { i, d }; } return best; } };
  const routeDist = (x, z) => (x > -200 && x < 400 && Math.abs(z) < 30 ? { d: Math.abs(z), i: Math.max(0, Math.min(n - 1, Math.floor((x + 200) / 10))), y: 100 } : null);
  return { route, index, routeDist };
}
const P = (x, z, y = 100) => ({ x, z, y });
const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => P(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, a.y + (b.y - a.y) * i / n));
const mk = (pts, cls = 5, width = 9.5, bridge = false) => ({ cls, width, bridge, oneway: 0, layer: 0, pts, nodes: [pts[0], pts[pts.length - 1]], nodeIdx: [0, pts.length - 1] });
const landscapeFor = (streets, R) => ({ routeDist: R.routeDist, inRouteTube: () => false, heightAt: () => 99.9, streetsNear: () => [], _streets: streets });

test('road meets: a street alongside the route sits flush under its shoulder, and eases back', () => {
  const R = straightRoute();
  // a street 5 m off the route's line, 0.4 m low, for 120 m, then turning away
  const pts = [...line(P(-50, 5, 99.6), P(70, 5, 99.6), 24), ...line(P(75, 10, 99.6), P(120, 60, 99.6), 9).slice(0)];
  const st = mk(pts, 3, 11);
  const L = landscapeFor([st], R);
  alignAlongRoute([st], { ...R, landscape: L, roadWidth: ROAD_WIDTH });
  const lift = .1 + streetSlots(L, [st])[0] * .02;
  const mid = st.pts[10];
  assert.ok(mid.along, 'marked alongside');
  assert.ok(Math.abs(mid.y + lift - (100 + .12 - .08)) < 1e-6, `top ${mid.y + lift}`);
  const far = st.pts[st.pts.length - 1];
  assert.ok(Math.abs(far.y - 99.6) < 1e-6, 'far end keeps its own height');
});

test('road meets: a ramp merging into a road yields (its inner edge on the road\'s edge); peers split the overlap', () => {
  // road A west–east; ramp B ends on A at (0, 0), running alongside for 40 m 6 m off before leaving
  const A = mk(line(P(-100, 300), P(100, 300), 40), 1, 11);
  const B = mk([...line(P(-80, 306), P(-40, 306), 8), ...line(P(-35, 305), P(0, 300), 7)], 1, 7.5);
  B.nodes = [B.pts[0], B.pts[B.pts.length - 1]];
  A.pts[20] = { ...A.pts[20], x: 0, z: 300 }; A.nodes = [A.pts[0], A.pts[20], A.pts[40]]; A.nodeIdx = [0, 20, 40];
  const streets = [A, B];
  const R = straightRoute(), L = landscapeFor(streets, R);
  const before = roadMeets({ ...L }, R.index, R.route, { reach: 1000 });
  trimOverlaps(streets, L);
  for (const p of A.pts) assert.ok(!(p.tl || p.tr), 'the parent road stays whole');
  const trimmed = B.pts.filter((p) => p.tl || p.tr);
  assert.ok(trimmed.length > 5, `ramp trimmed at ${trimmed.length} points`);
  // where the ramp runs alongside (6 m off, half-widths 5.5 + 3.75): its inner 3.25 m go
  const q = B.pts[4];
  assert.ok(Math.abs((q.tl || q.tr) - 3.25) < .05, `trim ${q.tl || q.tr}`);
  assert.ok(before.sites.length >= 0);
});

test('road meets: two streets crossing at one level with no shared node get one', () => {
  const A = mk(line(P(-50, 500), P(50, 500), 10)), B = mk(line(P(3, 453), P(3, 553), 10));
  const n = joinCrossings([A, B]);
  assert.equal(n, 2);
  const key = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  const shared = A.nodes.map(key).filter((k) => B.nodes.map(key).includes(k));
  assert.equal(shared.length, 1, 'one shared node');
  for (const st of [A, B]) assert.ok(st.nodeIdx.every((i, j) => key(st.pts[i]) === key(st.nodes[j])), 'nodeIdx in step');
});

test('road meets: pittsburgh, every place roadways meet within 150 m of the route, inventoried and measured', () => {
  const item = JSON.parse(read('routes/catalog.json')).find((c) => c.id === 'pittsburgh');
  const route = buildCatalogRoute(read(item.file), item);
  const scene = JSON.parse(read(item.scene));
  scene.city = JSON.parse(read(scene.cityData));
  route.scene = scene;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
  const proj = makeProjection((a + b) / 2, (c + d) / 2), index = makeRouteIndex(route, proj);
  const L = makeCityLandscape(scene, proj, index, route);
  cityStreets(L, index, route);
  const R = roadMeets(L, index, route, { roadWidth: ROAD_WIDTH });
  assert.ok(R.sites.length > 900, `${R.sites.length} sites`);   // (fewer once overlapping carriageways are drawn as one)
  for (const kind of ['junction', 'link', 'route', 'overlap']) assert.ok(R.counts[kind] > 10, `${kind}: ${R.counts[kind]}`);
  // the junction system's own geometry: no step, gap or misplaced paint at any junction or link near the route
  // (11: lips of 0.1–0.8 m at side-street and network junctions the West End spur and Oakland added — PLAN F15;
  // 14: the Allegheny Loop's ramps by the 31st St Bridge, the Millvale ramp and the Clemente Bridge's south end — F21)
  const own = R.sites.filter((s) => s.d < 25 && (s.kind === 'junction' || s.kind === 'link') && s.issues.some((i) => ['step', 'gap', 'paint'].includes(i.check)));
  assert.ok(own.length <= 14, `junction/link issues near the route: ${own.map((s) => `${s.s} ${s.issues.map((i) => i.check)}`).join('; ')}`);
  assert.ok(R.issues < 85, `${R.issues} sites with issues`);   // (60 before the Allegheny Loop's 12 km)
  const nearN = R.sites.filter((s) => s.issues.length && s.d <= 25).length;
  assert.ok(nearN <= MEET_LIMITS.nearBudget, `within 25 m of the route: ${nearN} sites with issues (at most ${MEET_LIMITS.nearBudget})`);
});
