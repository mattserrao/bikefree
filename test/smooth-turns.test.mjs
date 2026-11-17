// [smooth-turns] Sharp turns drawn smoothly on Pittsburgh and Alpe d'Huez (scene "roadAlign": { "turns": … },
// js/world/road-align.js): the road's cross-sections turn in small steps, its ribbons never fold, the rider's heading
// turns without jumps, and the ride distance and drawn length stay what they were. Other routes are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { normalizeScene } from '../js/world/toolbox/scene-schema.js';
import { riderPose, ROAD_WIDTH } from '../js/world/pose.js';
import * as RA from '../js/world/road-align.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const catalog = JSON.parse(read('routes/catalog.json'));

function load(id, { turns = true } = {}) {
  const item = catalog.find((r) => r.id === id);
  const route = buildCatalogRoute(read(item.file), item);
  route.scene = normalizeScene(JSON.parse(read(item.scene)));
  if (!turns && route.scene.roadAlign) { route.scene.roadAlign = { ...route.scene.roadAlign }; delete route.scene.roadAlign.turns; }
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
  const index = makeRouteIndex(route, makeProjection((a + b) / 2, (c + d) / 2));
  return { route, index };
}

// the ribbons as world.js builds them (ribbonSections; before it existed, the central-difference sections inline)
function sections(I, n, hw) {
  if (RA.ribbonSections) return RA.ribbonSections(I, n, hw);
  const out = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = Math.max(0, i - 1), q = Math.min(n - 1, i + 1);
    let dx = I.xs[q] - I.xs[p], dz = I.zs[q] - I.zs[p]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    out.set([I.xs[i] + dz * hw, I.zs[i] - dx * hw, I.xs[i] - dz * hw, I.zs[i] + dx * hw], i * 4);
  }
  return out;
}

/** The drawn road's numbers: worst heading step between cross-sections, flipped ribbon triangles, drawn length. */
function drawn(route, index) {
  const [R, I] = RA.denseRoad(route, index);
  const n = R.turnIdx ? R.turnIdx + 1 : R.dist.length;
  const city = route.scene.terrain === 'authored-city';
  const out = { n, worstStep: 0, worstAt: 0, flips: 0, length: 0 };
  for (const hw of [ROAD_WIDTH / 2, (ROAD_WIDTH + (city ? 4 : 1.6)) / 2]) {
    const E = sections(I, n, hw);
    // a cross-section's heading: perpendicular to its left → right edge
    const head = (i) => Math.atan2(-(E[i * 4 + 2] - E[i * 4]), E[i * 4 + 3] - E[i * 4 + 1]);
    for (let i = 1; i < n; i++) {
      let d = Math.abs(head(i) - head(i - 1)); if (d > Math.PI) d = 2 * Math.PI - d;
      d *= 180 / Math.PI;
      if (R.dist[i] < (route.turnS || route.total) - 20 && d > out.worstStep) { out.worstStep = d; out.worstAt = R.dist[i]; }
      // triangles (a, b, c) and (b, d, c) of world.js: a flipped one has the other winding
      const A = [E[(i - 1) * 4], E[(i - 1) * 4 + 1]], B = [E[(i - 1) * 4 + 2], E[(i - 1) * 4 + 3]], C = [E[i * 4], E[i * 4 + 1]], D = [E[i * 4 + 2], E[i * 4 + 3]];
      const cr = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      // (world.js winds every ribbon triangle the same way: (a, b, c) and (b, d, c) are clockwise seen from above
      // in this frame; a degenerate one, where an inside edge is held still, is not a fold)
      if (cr(A, B, C) > 1e-6 || cr(B, D, C) > 1e-6) out.flips++;
    }
  }
  for (let i = 1; i < n; i++) out.length += Math.hypot(I.xs[i] - I.xs[i - 1], I.zs[i] - I.zs[i - 1]);
  return { ...out, R, I };
}

/** The rider's heading every 0.25 m on the way out: worst turn rate (°/m) and worst change of it (°/m per m). */
function riderTurn(route, index) {
  const end = (route.turnS || route.total) - 15, h = .25;
  let prev = riderPose(route, index, 15), prevRate = null, rate = 0, accel = 0, rateAt = 0;
  for (let s = 15 + h; s <= end; s += h) {
    const cur = riderPose(route, index, s);
    const r = Math.acos(Math.max(-1, Math.min(1, prev.flat.x * cur.flat.x + prev.flat.z * cur.flat.z))) * 180 / Math.PI / h;
    if (r > rate) { rate = r; rateAt = s; }
    if (prevRate != null) accel = Math.max(accel, Math.abs(r - prevRate) / h);
    prevRate = r; prev = cur;
  }
  return { rate, accel, rateAt };
}

const CASES = {
  // the sharpest turns: Pittsburgh's city corners (53° in one 10 m sample at 3.74 km), the Alpe's 21 hairpins
  // (133° in one sample at 24.56 km). Main drew them with 19° and 85° steps between cross-sections.
  pittsburgh: { maxStep: 6.5, minRadius: 7.5, maxRate: 6, maxAccel: 1.5, maxShift: 2 },
  alpedhuez: { maxStep: 6.5, minRadius: 5, maxRate: 10, maxAccel: 1.5, maxShift: 6.5 },
};

for (const [id, L] of Object.entries(CASES)) {
  test(`${id}: sharp turns drawn smoothly (no facets, no folds, no rider snap)`, () => {
    const { route, index } = load(id);
    const d = drawn(route, index);
    assert.ok(d.worstStep <= L.maxStep, `cross-sections turn ${d.worstStep.toFixed(1)}° in one step at ${d.worstAt.toFixed(0)} m (limit ${L.maxStep}°)`);
    assert.equal(d.flips, 0, `${d.flips} road/shoulder ribbon triangles fold over`);
    // the drawn centre line's tightest radius (circles through points 1 m apart, every 0.5 m)
    let minR = Infinity, minAt = 0;
    const P = (s) => { const i = Math.min(route.dist.length - 2, Math.floor(s / 10)); return RA.curveXZ(index, i, (s - route.dist[i]) / 10); };
    for (let s = 20; s < (route.turnS || route.total) - 20; s += .5) {
      const p = P(s - 1), q = P(s), r = P(s + 1);
      const cross = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
      const R = Math.abs(cross) < 1e-12 ? Infinity : Math.hypot(q.x - p.x, q.z - p.z) * Math.hypot(r.x - q.x, r.z - q.z) * Math.hypot(r.x - p.x, r.z - p.z) / (2 * Math.abs(cross));
      if (R < minR) { minR = R; minAt = s; }
    }
    assert.ok(minR >= L.minRadius, `the road turns on a ${minR.toFixed(2)} m radius at ${minAt} m (limit ${L.minRadius} m)`);
    const t = riderTurn(route, index);
    assert.ok(t.rate <= L.maxRate, `the rider turns ${t.rate.toFixed(1)}°/m at ${t.rateAt} m (limit ${L.maxRate})`);
    assert.ok(t.accel <= L.maxAccel, `the rider's turn rate jumps ${t.accel.toFixed(1)}°/m per m (limit ${L.maxAccel})`);
    assert.ok(RA.turnOptions?.(route), `${id}'s scene asks for roadAlign.turns`);
    assert.ok(index.turns.stats.maxShift <= L.maxShift, `the road moved ${index.turns.stats.maxShift.toFixed(2)} m off the GPX curve`);
  });

  test(`${id}: ride distance, elevation and drawn length unchanged; the rider stays on the drawn road`, () => {
    const on = load(id), off = load(id, { turns: false });
    // what the trainer rides: distance and the elevation profile are the GPX's, exactly
    assert.equal(on.route.total, off.route.total);
    assert.deepEqual(Array.from(on.route.ele), Array.from(off.route.ele));
    assert.deepEqual(Array.from(on.route.dist), Array.from(off.route.dist));
    // drawn length within 0.1 % of the ride
    assert.ok(on.index.turns, `${id}: no eased turns`);
    const d = drawn(on.route, on.index), oneWay = on.route.turnS || on.route.total;
    assert.ok(Math.abs(d.length / oneWay - 1) < .001, `drawn road ${d.length.toFixed(1)} m vs ${oneWay} m ridden`);
    // through every eased turn the rider sits its lane's width from the drawn centre line, at the drawn road's height
    // (the drawn line is the curve cut into short chords: within a few centimetres of it)
    const { R, I } = d, n = d.n;
    for (const w of on.index.turns.windows) {
      for (let s = w.a * 10 + 1; s < w.b * 10 - 1; s += .5) {
        const p = riderPose(on.route, on.index, s);
        let best = Infinity, y = 0;
        let j = 0; while (j < n - 2 && R.dist[j + 1] < s - 15) j++;
        for (; j < n - 1 && R.dist[j] < s + 15; j++) {
          const ax = I.xs[j], az = I.zs[j], dx = I.xs[j + 1] - ax, dz = I.zs[j + 1] - az, l2 = dx * dx + dz * dz || 1;
          const f = Math.max(0, Math.min(1, ((p.centre.x - ax) * dx + (p.centre.z - az) * dz) / l2));
          const dd = Math.hypot(ax + dx * f - p.centre.x, az + dz * f - p.centre.z);
          if (dd < best) { best = dd; y = R.ele[j] + (R.ele[j + 1] - R.ele[j]) * f; }
        }
        assert.ok(best < .08, `${id} @${s}: rider's centre point ${best.toFixed(3)} m off the drawn road`);
        assert.ok(Math.abs(p.centre.y - y) < .05, `${id} @${s}: rider ${(p.centre.y - y).toFixed(3)} m off the road's height`);
        assert.ok(Math.abs(p.lateral - ROAD_WIDTH * .22) < 1e-9, `${id} @${s}: rider out of the lane`);
      }
    }
  });
}

test('roadAlign.turns is off everywhere else (those routes draw exactly as before)', () => {
  for (const item of catalog) {
    if (!item.scene || item.id in CASES) continue;
    const scene = normalizeScene(JSON.parse(read(item.scene)));
    assert.equal(RA.turnOptions?.({ scene }) ?? null, null, `${item.id} has roadAlign.turns`);
  }
  const route = { scene: {}, dist: [0, 10, 20], lat: [45, 45.0001, 45.0002], lon: [6, 6, 6.0001], ele: [0, 0, 0] };
  const index = makeRouteIndex(route, makeProjection(45, 6));
  assert.equal(index.turns, undefined);
});
