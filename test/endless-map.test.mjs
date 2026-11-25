// The endless map's course (js/endless/course.js): seeded, every mile a terrain choice, biomes in sequence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Course, makeEndlessRoute, biomePlan, biomeAt, MILE_M, BIOMES, MODES } from '../js/endless/course.js';
import { routeAt } from '../js/gpx.js';

const gradeOver = (C, a, b) => { let g = 0, n = 0; for (let s = a; s < b; s += 10) { g += C.at(s).grade; n++; } return g / n; };

test('the same seed gives the same road', () => {
  const a = new Course(7), b = new Course(7); a.extend(20000); b.extend(20000);
  assert.deepEqual([...a.ele.subarray(0, a.n)], [...b.ele.subarray(0, b.n)]);
  assert.deepEqual([...a.x.subarray(0, a.n)], [...b.x.subarray(0, b.n)]);
});

test('the road always goes forward and bends no tighter than ~150 m', () => {
  const C = new Course(3); C.extend(60000);
  for (let i = 1; i < C.n; i++) assert.ok(C.z[i] > C.z[i - 1], `z at ${i}`);
  for (let i = 1; i < C.n; i++) assert.ok(Math.abs(C.heading[i] - C.heading[i - 1]) / 10 < 1 / 150, `curvature at ${i * 10} m`);
  assert.equal(C.indexAtZ(C.z[1234]), 1234);
});

test('moderate grades for each terrain type', () => {
  // (a seed whose first ten miles have no coast: a coast keeps the road above its sea, levelling a long descent)
  let seed = 5; while (biomePlan(seed, 12 * MILE_M).some((b) => b.biome === 'coast' && b.from < 10 * MILE_M)) seed++;
  const C = new Course(seed, 'flat'); C.extend(10 * MILE_M);
  C.setMode(1, 'climb'); C.setMode(3, 'descend'); C.setMode(5, 'rolling'); C.setMode(7, 'flat');
  const g = (k) => gradeOver(C, k * MILE_M + 300, (k + 1) * MILE_M);
  assert.ok(g(0) >= 0 && g(0) <= 1, `flat ${g(0)}`);
  assert.ok(g(1) > 5 && g(1) < 7, `climb ${g(1)}`);
  assert.ok(g(3) < -4 && g(3) > -6, `descend ${g(3)}`);
  assert.ok(Math.abs(g(5)) < 1.2, `rolling mean ${g(5)}`);
  for (let s = 5 * MILE_M + 300; s < 6 * MILE_M; s += 10) assert.ok(Math.abs(C.at(s).grade) <= 3.05);
  // a change eases in (no step in grade)
  for (let s = MILE_M - 50; s < MILE_M + 300; s += 10) assert.ok(Math.abs(C.at(s + 10).grade - C.at(s).grade) < 0.5);
});

test('a coast keeps the road above its sea', () => {
  const P = biomePlan(1, 30 * MILE_M), coast = P.find((b) => b.biome === 'coast');
  const C = new Course(1, 'descend'); C.extend(coast.to + MILE_M);
  const sea = C.seaLevel(coast.from + 100);
  for (let s = coast.from; s < coast.to; s += 50) assert.ok(C.at(s).ele > sea + 5, `ele at ${s}`);
});

test('a long descent levels out above the sea', () => {
  const C = new Course(2, 'descend'); C.extend(40 * MILE_M);
  for (let i = 0; i < C.n; i++) assert.ok(C.ele[i] > 0, `ele at ${i * 10}`);
});

test('biomes: seeded, all six, never twice in a row, 3–5 miles each, starting in the farmland', () => {
  const P = biomePlan(11, 80 * MILE_M);
  assert.equal(P[0].biome, 'farmland');
  for (const b of BIOMES) assert.ok(P.some((x) => x.biome === b), b);
  for (let i = 1; i < P.length; i++) assert.notEqual(P[i].biome, P[i - 1].biome);
  for (const x of P) assert.ok(x.to - x.from >= 3 * MILE_M - 1 && x.to - x.from <= 5 * MILE_M + 1);
  assert.deepEqual(biomePlan(11, 80 * MILE_M), P);
  const mid = biomeAt(P, P[1].from); assert.ok(mid.t > 0.4 && mid.t < 0.6);
});

test('the mile prompt: four terrain types, doing nothing keeps the current one, ◀ ▶ changes it', () => {
  const route = makeEndlessRoute({ seed: 4, startMode: 'rolling' }), R = route.endlessRide;
  assert.equal(R.prompt(500, 8), null);
  const up = R.prompt(MILE_M - 100, 8);
  assert.deepEqual(up.options.map((o) => o.key), MODES);
  assert.equal(up.options[up.selected].key, 'rolling');
  let changed = 0; R.addEventListener('change', (e) => { changed = e.fromS; });
  assert.ok(R.choose(1, MILE_M - 100));
  assert.equal(R.upcoming(MILE_M - 100).options[R.upcoming(MILE_M - 100).selected].key, 'climb');
  assert.equal(changed, MILE_M);
  assert.ok(routeAt(route, MILE_M + 800).grade > 4.5);
  // locked close to the mark
  R.update(MILE_M - 20);
  assert.equal(R.choose(1, MILE_M - 20), false);
  // the route keeps growing ahead
  R.update(route.total - 3000);
  assert.ok(route.total >= 8990);
});
