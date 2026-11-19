// PLAN 7.5: the rider and bike lean into turns (js/world/pose.js LEAN, leanTarget, stepLean, pathCurvature,
// leanAlong): roughly the physical angle atan(v²/(g·r)), sharper for tighter turns and more speed, eased, capped, zero
// at rest, into the turn — on a route's curves and through a network's junction turns and U-turns alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAN, leanTarget, stepLean, pathCurvature, leanAlong, riderPose } from '../js/world/pose.js';
import { makePathRoute } from '../js/network.js';
import { loadCatalogNetwork } from '../tools/qc_network.mjs';

const DEG = 180 / Math.PI, kph = (k) => k / 3.6, MAX = LEAN.maxDeg;
const deg = (r) => r * DEG;

test('lean angle: atan(v²/(g·r)) — more for a tighter turn and more speed, capped, none at rest', () => {
  // 25 km/h: a 10 m radius ~26°, a 30 m radius ~9°
  assert.ok(Math.abs(deg(leanTarget(kph(25), 1 / 10)) - 26.2) < 0.2, `${deg(leanTarget(kph(25), 1 / 10))}`);
  assert.ok(Math.abs(deg(leanTarget(kph(25), 1 / 30)) - 9.3) < 0.2);
  assert.ok(leanTarget(kph(25), 1 / 10) > leanTarget(kph(25), 1 / 30));     // tighter: more
  assert.ok(leanTarget(kph(35), 1 / 30) > leanTarget(kph(25), 1 / 30));     // faster: more
  assert.ok(Math.abs(deg(leanTarget(kph(40), 1 / 5)) - MAX) < 1e-9);         // capped
  assert.ok(MAX >= 35 && MAX <= 40);
  assert.equal(leanTarget(0, 1 / 5), 0);                                       // stopped
  assert.equal(leanTarget(kph(25), 0), 0);                                     // straight
  assert.equal(leanTarget(kph(25), NaN), 0);
  // sign: + right, − left, the same size
  assert.equal(leanTarget(kph(25), -1 / 10), -leanTarget(kph(25), 1 / 10));
});

test('path curvature: signed (+ right), 1/r on a circle', () => {
  // heading +z: right is −x (riderPose's right = (−fz, fx))
  const circle = (r, sgn, a) => ({ x: sgn * -(r - r * Math.cos(a)), z: r * Math.sin(a) });   // starts heading +z, turns right (sgn 1) or left
  for (const r of [8, 13, 30]) {
    const d = 5 / r;
    assert.ok(Math.abs(pathCurvature(circle(r, 1, 0), circle(r, 1, d), circle(r, 1, 2 * d)) - 1 / r) < 0.03 / r, `right r ${r}`);
    assert.ok(Math.abs(pathCurvature(circle(r, -1, 0), circle(r, -1, d), circle(r, -1, 2 * d)) + 1 / r) < 0.03 / r, `left r ${r}`);
  }
  assert.equal(pathCurvature({ x: 0, z: 0 }, { x: 0, z: 5 }, { x: 0, z: 10 }), 0);
  assert.equal(pathCurvature({ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 10 }), 0);   // degenerate
});

test('easing: no snaps, ~63 % in one time constant, back to upright, never past the cap', () => {
  const dt = 1 / 60, target = leanTarget(kph(25), 1 / 10);
  let x = 0, t = 0, maxStep = 0;
  while (t < LEAN.tauS - 1e-9) { const y = stepLean(x, target, dt); maxStep = Math.max(maxStep, Math.abs(y - x)); x = y; t += dt; }
  assert.ok(Math.abs(x / target - (1 - Math.exp(-1))) < 0.03, `${x / target}`);
  assert.ok(deg(maxStep) < 1.2, `${deg(maxStep)}° in a frame`);
  assert.ok(LEAN.tauS >= 0.3 && LEAN.tauS <= 0.5);
  for (let i = 0; i < 180; i++) x = stepLean(x, target, dt);
  assert.ok(Math.abs(x - target) < 1e-3);
  for (let i = 0; i < 180; i++) x = stepLean(x, 0, dt);   // out of the turn: upright again
  assert.ok(Math.abs(x) < 1e-3);
  assert.ok(Math.abs(deg(stepLean(0, 2, 10))) <= MAX + 1e-9);   // (capped, whatever it's given)
  assert.equal(stepLean(0.2, 0.5, 0), 0.2);                    // no time, no change
});

// a network ride through East Carson & 10th (a right turn on the South Side Short Loop), the Water Steps' "Back"
// (the Mt Washington loop) and Bakery Square's hairpin: the lean the world would show riding through at 25 km/h
const item = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8')).find((r) => r.id === 'pittsburgh');
const { net, index: worldIndex } = loadCatalogNetwork(item);
const preset = (id) => net.presets.find((p) => p.id === id);
const edge = (key) => [...net.edges.values()].find((e) => e.key === key);
const len = (...keys) => keys.reduce((t, k) => t + edge(k).len, 0);
const gAt = len('A>NS', 'NS>CB', 'CB>B', 'B>GW', 'GW>E', 'E>F', 'F>G');

/** Ride path metres a → b at v m/s, 60 frames a second, easing the lean as world.js does: [{p, target, lean}]. */
function rideThrough(ride, a, b, v, lane = 0.22) {
  const at = (p) => ride.pose(p, worldIndex, lane);
  const out = [];
  let lean = 0;
  for (let p = a; p <= b; p += v / 60) {
    const target = leanAlong(at, p, v, { minS: 0 });
    lean = stepLean(lean, target, 1 / 60);
    out.push({ p, target, lean });
  }
  return out;
}
const peak = (rows, k = 'lean') => rows.reduce((m, r) => (Math.abs(r[k]) > Math.abs(m) ? r[k] : m), 0);
const maxStep = (rows) => rows.slice(1).reduce((m, r, i) => Math.max(m, Math.abs(r.lean - rows[i].lean)), 0);

test('leaning into a network\'s junction turns: right turn right, U-turn left, eased, upright again after', () => {
  const short = makePathRoute(net, preset('pgh-short-loop')).netRide;
  const right = rideThrough(short, gAt - 60, gAt + 60, kph(25));
  assert.ok(deg(peak(right)) > 12 && deg(peak(right)) <= MAX, `right turn at 25 km/h: ${deg(peak(right))}°`);
  assert.ok(deg(maxStep(right)) < 1.5, `snap ${deg(maxStep(right))}°`);
  assert.ok(Math.abs(deg(right[0].lean)) < 2 && Math.abs(deg(right.at(-1).lean)) < 2, 'upright before and after');
  // slower: less
  assert.ok(Math.abs(peak(rideThrough(short, gAt - 60, gAt + 60, kph(12)))) < Math.abs(peak(right)));
  const mw = makePathRoute(net, preset('pgh-mt-washington')).netRide;
  const k = mw.entries.findIndex((x) => x.t.e.key === 'R>A');
  const back = mw.entries[k].p0 + mw.entries[k].t.e.len;
  const uturn = rideThrough(mw, back - 50, back + 50, kph(20));
  assert.ok(deg(peak(uturn)) < -15 && deg(peak(uturn)) >= -MAX, `U-turn (to the left, from the right lane): ${deg(peak(uturn))}°`);
  assert.ok(deg(maxStep(uturn)) < 1.5);
});

test('leaning through a sharp corner inside a segment (Bakery Square\'s hairpin) and on a plain route\'s curve (riderPose)', () => {
  const sq = makePathRoute(net, preset('pgh-squirrel-hill')).netRide, e = edge('EL>SQ');
  const at = len('SQ>K') + e.len - (16490 - e.s0);   // Bakery Square's hairpin, ridden backwards
  const hp = rideThrough(sq, at - 60, at + 60, kph(25));
  assert.ok(Math.abs(deg(peak(hp))) > 10, `Bakery Square: ${deg(peak(hp))}°`);
  // a plain route: riderPose on a straight line has no lean, on a circle the physical one
  const n = 200, r = 30, route = { total: n * 10, closed: false, turnS: null, dist: [], ele: [] }, index = { xs: [], zs: [] };
  for (let i = 0; i < n; i++) {
    const s = i * 10;
    route.dist.push(s); route.ele.push(0);
    index.xs.push(i < 50 ? 0 : -(r - r * Math.cos((s - 500) / r)));   // straight 500 m along +z, then a right-hand circle
    index.zs.push(i < 50 ? s : 500 + r * Math.sin((s - 500) / r));
  }
  const pose = (s) => riderPose(route, index, s, 0, { uturns: false });
  assert.equal(leanAlong(pose, 200, kph(25)), 0);
  // (10 m samples on a 30 m circle: a polygon; the 10 m span reads it as the circle wherever the rider is on it —
  // at a sample or between two — so the lean doesn't wobble every 10 m)
  for (let s = 700; s < 720; s += 1) { const x = deg(leanAlong(pose, s, kph(25))); assert.ok(x > 8.5 && x < 10, `${s}: ${x}°`); }
  assert.equal(leanAlong(pose, 700, 0), 0);
});
