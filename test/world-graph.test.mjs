// [review 27 Nov] W14/W15: the graph world's junction planner, curves and deck spans as pure modules
// (js/world/graph/junction-plan.js, curves.js), the point-in-polygon and device helpers (poly.js, device.js).
// The plan, curves and road hash of every graph map match the snapshot of GraphWorld's own methods before the move
// (test/fixtures/graph-plan.snapshot.json, by test/world-graph-snap.mjs); then direct tests of each function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotGraph, MAPS } from './world-graph-snap.mjs';
import { planJunctions } from '../js/world/graph/junction-plan.js';
import { curvePoint, curve, deckSpans, SUB } from '../js/world/graph/curves.js';
import { inRing, inPairs, inRingGrown } from '../js/world/graph/poly.js';
import { MOBILE, PHONE_UA } from '../js/world/graph/device.js';
import { roadHash, GraphWorld } from '../js/world/graph-world.js';

const ROOT = new URL('../', import.meta.url);
const SNAP = JSON.parse(readFileSync(new URL('./fixtures/graph-plan.snapshot.json', import.meta.url), 'utf8'));

test('the extracted planner, curves and road hash match GraphWorld\'s own before the move, on every graph map', () => {
  const now = snapshotGraph({
    plan: (M) => planJunctions(M.arms, { wOf: M.wOf, walkOf: M.walkOf, curbs: M.profile.junctionCurbs }),
    curvePoint, curve, roadHash: (edges, wOf) => roadHash(edges, wOf),
  }, ROOT);
  assert.deepEqual(Object.keys(now), MAPS);
  for (const id of MAPS) assert.deepEqual(now[id], SNAP[id], id);
  assert.ok(now.pgh.nodes > 1000 && now.nyc.nodes > 100);
});

test('GraphWorld keeps its methods as thin delegates (graph-life.js walks world._curvePoint)', () => {
  const P = GraphWorld.prototype, e = line(5);
  assert.deepEqual(P._curvePoint.call({}, e, 2.5), curvePoint(e, 2.5));
  assert.deepEqual(P._curve.call({}, e, 1, 4), curve(e, 1, 4));
  const self = { arms: cross().arms, profile: {}, wOf: () => 8, walkOf: () => 0 };
  P._planJunctions.call(self);
  assert.equal(self.jn.size, 1); assert.equal(self.trim.size, 4);
});

/** A straight edge along +x, n samples (10 m), at height 100 + x / 10. */
function line(n, x0 = 0, z0 = 0, ux = 1, uz = 0, id = 'e', bridges = []) {
  const x = new Float64Array(n + 1), z = new Float64Array(n + 1), ele = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) { x[i] = x0 + ux * i * 10; z[i] = z0 + uz * i * 10; ele[i] = 100 + i; }
  return { id, n, x, z, ele, bridges, kind: 'residential' };
}
/** Four ways out of a node at the origin (N, E, S, W): a plain crossroads. */
function cross(kind = 'residential') {
  const es = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([ux, uz], k) => ({ ...line(6, 0, 0, ux, uz, `w${k}`), kind, from: 'c', to: `t${k}` }));
  const arms = new Map([['c', es.map((e) => ({ e, end: 0 }))]]);
  for (const e of es) arms.set(e.to, [{ e, end: 1 }]);
  return { es, arms };
}

test('curvePoint: on a straight way, the samples themselves and a unit direction along it', () => {
  const e = line(5);
  for (const f of [0, 1, 2.5, 5]) { const p = curvePoint(e, f); assert.ok(Math.abs(p.x - f * 10) < 1e-9 && Math.abs(p.z) < 1e-12, `${f}`); assert.ok(Math.abs(p.dx - 1) < 1e-12 && Math.abs(p.dz) < 1e-12); }
  assert.equal(curvePoint(e, -3).x, 0); assert.equal(curvePoint(e, 99).x, 50);   // (clamped to the way)
  assert.ok(Math.abs(curvePoint(e, 2.5).y - 102.5) < 1e-12);
});

test('curve: SUB points a span plus the end, arc length along, the ends exactly on the samples', () => {
  const e = line(4), C = curve(e, 1, 3);
  assert.equal(C.length, 2 * SUB + 1);
  assert.deepEqual([C[0].x, C.at(-1).x, C.at(-1).i], [10, 30, 3]);
  assert.ok(Math.abs(C.at(-1).s - 20) < 1e-9);
  for (const p of C) assert.ok(Math.abs(Math.hypot(p.dx, p.dz) - 1) < 1e-12);
});

test('deckSpans: the deck inside a bridge\'s ends, metres to the nearest sample off it', () => {
  const { deck, toEnd } = deckSpans(line(10, 0, 0, 1, 0, 'b', [[2, 8]]));
  assert.deepEqual([...deck], [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual([...toEnd], [0, 0, 0, 10, 20, 30, 20, 10, 0, 0, 0]);
  assert.ok(deckSpans(line(3)).toEnd.every((d) => d === 0));
});

test('planJunctions: a crossroads gets four mouths, four curb returns and a polygon round the node', () => {
  const { arms } = cross();
  const { jn, trim } = planJunctions(arms, { wOf: () => 8, walkOf: () => 0 });
  assert.equal(jn.size, 1);   // (the ways' far ends meet nothing: no junction there)
  const J = jn.get('c');
  assert.equal(J.arms.length, 4); assert.equal(J.corners.length, 4);
  assert.ok(J.corners.every((c) => c.arc && c.arc.r === 4), 'a residential curb return, radius 4');
  for (const A of J.arms) { assert.ok(A.t >= 1.5 && A.t <= 26); assert.equal(trim.get(A.e.id)[0], A.t); assert.ok(Math.abs(Math.hypot(A.mouth[0].x - A.mouth[1].x, A.mouth[0].z - A.mouth[1].z) - 8) < 1e-9); }
  assert.ok(J.poly.length > 8 && J.poly.every((p) => Math.hypot(p.x, p.z) < 30));
  assert.ok(Math.abs(J.y - J.J(0, 0)) < 1e-12);
});

test('planJunctions: the profile\'s curbs win over the defaults; a node on a deck\'s end and singletrack are left alone', () => {
  assert.ok(planJunctions(cross().arms, { wOf: () => 8, walkOf: () => 0, curbs: { residential: 6 } }).jn.get('c').corners.every((c) => c.arc?.r === 6));
  const deckEnd = cross(); deckEnd.es[0].bridges = [[0, 3]];
  assert.equal(planJunctions(deckEnd.arms, { wOf: () => 8, walkOf: () => 0 }).jn.size, 0);
  const cf = cross(); for (const e of cf.es) e._cf = true;
  assert.equal(planJunctions(cf.arms, { wOf: () => 2, walkOf: () => 0 }).jn.size, 0);
});

test('poly: inside a ring of points or pairs, and within a grown margin', () => {
  const sq = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
  assert.ok(inRing(sq, 5, 5)); assert.ok(!inRing(sq, 11, 5)); assert.ok(!inRing(sq, -0.1, 5));
  assert.ok(inPairs(sq.map((p) => [p.x, p.z]), 5, 5)); assert.ok(!inPairs(sq.map((p) => [p.x, p.z]), 5, 10.5));
  assert.ok(!inRingGrown(sq, 11, 5)); assert.ok(inRingGrown(sq, 11, 5, 2)); assert.ok(!inRingGrown(sq, 13, 5, 2));
  const L = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }];   // (concave)
  assert.ok(inRing(L, 2, 8)); assert.ok(!inRing(L, 8, 8));
});

test('device: one phone test; Node is not a phone', () => {
  assert.equal(MOBILE, false);
  for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'Mozilla/5.0 (Linux; Android 14) Mobile']) assert.ok(PHONE_UA.test(ua));
  assert.ok(!PHONE_UA.test('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'));
  for (const f of ['graph-world.js', 'graph-city.js', 'endless-world.js']) assert.doesNotMatch(readFileSync(new URL(`../js/world/${f}`, import.meta.url), 'utf8'), /maxTouchPoints/, f);
});

test('W15 dead code and duplicates are gone from graph-world.js and graph-city.js', () => {
  const W = readFileSync(new URL('../js/world/graph-world.js', import.meta.url), 'utf8'), C = readFileSync(new URL('../js/world/graph-city.js', import.meta.url), 'utf8');
  for (const re of [/_build(Roads|Ground|Bank|Dressing)\(t\)/, /\bstrip\(L, R/, /\bdisc\(x, y, z/, /LAND_PAVED/, /RURAL_MAPS/, /const meshH/, /new Float32Array\(e\.n \+ 1\)\.fill\(Infinity\)/]) assert.doesNotMatch(W, re, String(re));
  for (const src of [W, C]) assert.doesNotMatch(src, /c = !c/);
});
