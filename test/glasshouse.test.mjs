// The glasshouse kit (js/world/toolbox/structures/glasshouse.js) on the Oakland area's giant Phipps Conservatory:
// the route goes in and out only through doors, the floor follows the path, the ground is levelled under the
// glass, and the build is the same every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape } from '../js/world/toolbox/city/landscape.js';
import { glasshouseFrame, makeGlasshousePads } from '../js/world/toolbox/structures/glasshouse.js';
import { ghostMask } from '../js/world/ghost.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const item = JSON.parse(read('routes/catalog.json')).find((c) => c.id === 'pittsburgh-oakland');
const route = buildCatalogRoute(read(item.file), item);
const scene = JSON.parse(read(item.scene));
scene.city = JSON.parse(read(scene.cityData));
route.scene = scene;
let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
const proj = makeProjection((a + b) / 2, (c + d) / 2);
const index = makeRouteIndex(route, proj);
const spec = scene.glasshouses[0];
const F = glasshouseFrame(spec, proj);
const ghost = ghostMask(route);
const real = [];
for (let i = 0; i <= (route.turnIdx || route.dist.length - 1); i++) if (!ghost?.[i]) real.push({ i, ...F.toUV(index.xs[i], index.zs[i]), y: route.ele[i], s: route.dist[i] });

test('glasshouse: the frame maps uv to the scene and back', () => {
  for (const [u, v] of [[0, 0], [-187, 102.5], [15, 150], [-232, 55]]) {
    const p = F.toXZ(u, v), q = F.toUV(p.x, p.z);
    assert.ok(Math.abs(q.u - u) < 1e-6 && Math.abs(q.v - v) < 1e-6, `${u},${v}`);
  }
  // the origin is junction J (Schenley Drive by Phipps), on the route
  const J = proj.toLocal(spec.origin.lat, spec.origin.lon), o = F.toXZ(0, 0);
  assert.ok(Math.hypot(J.x - o.x, J.z - o.z) < 1e-6);
});

test('glasshouse: the route crosses its walls only through doors, square on, and rides ~0.55 km under glass', () => {
  const doorW = spec.doorM[0], walls = [];
  for (const R of F.rooms) {
    const cs = [[R.u0, R.v0], [R.u1, R.v0], [R.u1, R.v1], [R.u0, R.v1]];
    for (let k = 0; k < 4; k++) walls.push([cs[k], cs[(k + 1) % 4], R.id]);
  }
  for (const p of spec.partitions) walls.push([p[0], p[1], 'partition']);
  let crossings = 0, inside = 0;
  for (let k = 1; k < real.length; k++) {
    const p = real[k - 1], q = real[k];
    if (q.i !== p.i + 1) continue;
    const mu = (p.u + q.u) / 2, mv = (p.v + q.v) / 2;
    if (F.rooms.some((R) => mu > R.u0 && mu < R.u1 && mv > R.v0 && mv < R.v1)) inside += Math.hypot(q.u - p.u, q.v - p.v);
    for (const [w0, w1, id] of walls) {
      const d1u = w1[0] - w0[0], d1v = w1[1] - w0[1], d2u = q.u - p.u, d2v = q.v - p.v, den = d1u * d2v - d1v * d2u;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p.u - w0[0]) * d2v - (p.v - w0[1]) * d2u) / den, s = ((p.u - w0[0]) * d1v - (p.v - w0[1]) * d1u) / den;
      if (t < 0 || t > 1 || s < 0 || s > 1) continue;
      const len = Math.hypot(d1u, d1v), along = t * len;
      // a door needs its whole width on the wall (not at a corner)…
      assert.ok(along > doorW / 2 - .5 && along < len - doorW / 2 + .5, `door at ${along.toFixed(1)} m of ${len.toFixed(1)} on ${id} (${route.dist[q.i].toFixed(0)} m)`);
      // …and the route goes through it near square on
      const cos = Math.abs((d1u * d2u + d1v * d2v) / (len * Math.hypot(d2u, d2v)));
      assert.ok(cos < .35, `crossing angle on ${id} at ${route.dist[q.i].toFixed(0)} m`);
      crossings++;
    }
  }
  // in at the palm court, through four inner doors, out at the sunken garden; partitions shared by two rooms count twice
  assert.ok(crossings >= 6, `${crossings} wall crossings`);
  assert.ok(inside > 500 && inside < 650, `${inside.toFixed(0)} m under glass`);
});

test('glasshouse: under the glass the path keeps 7 m off the walls but where it goes through a door', () => {
  const inR = (R, p) => p.u > R.u0 && p.u < R.u1 && p.v > R.v0 && p.v < R.v1;
  for (const R of F.rooms) {
    const doors = [];
    for (let k = 1; k < real.length; k++) if (real[k].i === real[k - 1].i + 1 && inR(R, real[k]) !== inR(R, real[k - 1])) doors.push(real[k].s);
    for (const p of real) {
      if (!inR(R, p)) continue;
      const dw = Math.min(p.u - R.u0, R.u1 - p.u, p.v - R.v0, R.v1 - p.v);
      if (dw < 7) assert.ok(doors.some((s) => Math.abs(s - p.s) < 12), `the path runs ${dw.toFixed(1)} m from a wall of ${R.id} at ${p.s.toFixed(0)} m`);
    }
  }
});

test('glasshouse: the ground is levelled under the glass, following the path, and eased back outside', () => {
  const pads = makeGlasshousePads(scene, proj, route, index);
  assert.ok(pads);
  const L = makeCityLandscape(scene, proj, index, route);
  for (const p of real) {
    const q = F.toXZ(p.u, p.v);
    if (!pads.sheltered(q.x, q.z)) continue;
    // under the path: just below the road, as anywhere on the route
    assert.ok(Math.abs(L.heightAt(q.x, q.z) - (p.y - .45)) < .35, `floor at ${p.s.toFixed(0)} m`);
  }
  // in a bed 12 m off the path in the tropical range: level with the path there
  const q = F.toXZ(-80, 143), n = real.reduce((best, r) => (Math.hypot(r.u + 80, r.v - 143) < Math.hypot(best.u + 80, best.v - 143) ? r : best));
  assert.ok(Math.abs(L.heightAt(q.x, q.z) - (n.y - .45)) < .3);
  // far outside: untouched
  const far = F.toXZ(-120, 260);
  assert.equal(pads.at(far.x, far.z), null);
  assert.equal(pads.sheltered(far.x, far.z), false);
  // no rain, no lamps: sheltered inside the footprint only
  const inPalm = F.toXZ(-200, 120), outside = F.toXZ(-250, 120);
  assert.ok(L.sheltered(inPalm.x, inPalm.z));
  assert.ok(!L.sheltered(outside.x, outside.z));
});

test('glasshouse: the sunken garden dips and the rest of the glass is level', () => {
  const inRoom = (id) => real.filter((p) => { const R = F.rooms.find((q) => q.id === id); return p.u > R.u0 + 3 && p.u < R.u1 - 3 && p.v > R.v0 + 3 && p.v < R.v1 - 3; });
  const lv = (ps) => [Math.min(...ps.map((p) => p.y)), Math.max(...ps.map((p) => p.y))];
  for (const id of ['palm', 'range1']) { const [lo, hi] = lv(inRoom(id)); assert.ok(hi - lo < .6, `${id} level (${(hi - lo).toFixed(2)} m)`); }
  const [lo, hi] = lv(inRoom('range3'));
  assert.ok(hi - lo > 1.2 && hi - lo < 2.5, `sunken garden dips ${(hi - lo).toFixed(2)} m`);
  for (let k = 1; k < real.length; k++) {
    const p = real[k - 1], q = real[k];
    if (q.i !== p.i + 1 || !F.rooms.some((R) => q.u > R.u0 && q.u < R.u1 && q.v > R.v0 && q.v < R.v1)) continue;
    assert.ok(Math.abs(q.y - p.y) / Math.max(1, q.s - p.s) < .07, `grade under glass at ${q.s.toFixed(0)} m`);
  }
});
