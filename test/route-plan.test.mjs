import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute, routeStartM } from '../js/routes.js';
import { routeAt, finishDistanceM, isPointToPoint, parseGpx, haversine } from '../js/gpx.js';
import { startPosition, stopsForDirection, stopNear, simulateRide, planRide, legLength } from '../js/route-plan.js';
import { DEFAULTS } from '../js/physics.js';

const gpx = (id) => readFileSync(new URL(`../routes/parks/${id}.gpx`, import.meta.url), 'utf8');
const index = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8'));
const item = (id) => ({ ...index.find((r) => r.id === id), routeId: id });

test('a start is a leg plus metres along it, snapped to the 10 m grid', () => {
  const r = buildCatalogRoute(gpx('goingtothesun'), item('goingtothesun'));
  const L = legLength(r);
  assert.equal(startPosition(r), 0);
  assert.equal(startPosition(r, { offsetM: 12344 }), 12340);
  assert.equal(startPosition(r, { reverse: true }), L);
  assert.equal(startPosition(r, { reverse: true, offsetM: 5000 }), L + 5000);
  assert.equal(startPosition(r, { offsetM: L * 2 }), L - 10);   // never past the end of the leg
  assert.equal(routeStartM(r, { reverse: true, offsetM: 5000 }), L + 5000);
  // the same place from either direction (an authored there-and-back retraces the road within metres)
  const a = routeAt(r, startPosition(r, { offsetM: 20000 })), b = routeAt(r, startPosition(r, { reverse: true, offsetM: L - 20000 }));
  assert.ok(haversine(a, b) < 30, `${haversine(a, b)} m apart`);
});

test('named stops come from the catalog, in riding order for each direction', () => {
  const r = buildCatalogRoute(gpx('goingtothesun'), item('goingtothesun'));
  const names = r.stops.map((s) => s.name);
  assert.ok(names.includes('Logan Pass') && names.includes('Avalanche Creek'));
  const fwd = stopsForDirection(r, r.stops, false), rev = stopsForDirection(r, r.stops, true);
  assert.ok(fwd.findIndex((s) => s.name === 'Avalanche Creek') < fwd.findIndex((s) => s.name === 'Logan Pass'));
  assert.ok(rev.findIndex((s) => s.name === 'Logan Pass') < rev.findIndex((s) => s.name === 'Avalanche Creek'));
  const logan = r.stops.find((s) => s.name === 'Logan Pass');
  assert.equal(stopNear(r, r.stops, logan.atM + 100).name, 'Logan Pass');
  assert.equal(stopNear(r, r.stops, r.total - logan.atM).name, 'Logan Pass');   // the way back
});

test('your own GPX: named waypoints become start points', () => {
  const text = `<gpx><wpt lat="45.0010" lon="6.0000"><name>Café</name></wpt><trk><trkseg>${
    Array.from({ length: 60 }, (_, i) => `<trkpt lat="${(45 + i * 0.0005).toFixed(5)}" lon="6.0"><ele>${100 + i}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  assert.deepEqual(parseGpx(text).waypoints, { 'Café': [45.001, 6] });
  const r = buildCatalogRoute(text, { name: 'Mine' });
  assert.equal(r.stops[0].name, 'Café');
  assert.ok(Math.abs(r.stops[0].atM - 110) <= 10);
});

test('the estimate rides the road: slower uphill, faster with more power', () => {
  const r = buildCatalogRoute(gpx('alpedhuez'), item('alpedhuez'));
  const climb = simulateRide(r, startPosition(r, { offsetM: 112000 }), { watts: 200, params: DEFAULTS, distM: 10000 });
  const flat = buildCatalogRoute(gpx('route28'), item('route28'));
  const easy = simulateRide(flat, 0, { watts: 200, params: DEFAULTS, distM: 10000 });
  assert.ok(climb.timeS > easy.timeS * 1.5, `climb ${climb.timeS} vs ${easy.timeS}`);
  const hard = simulateRide(flat, 0, { watts: 300, params: DEFAULTS, distM: 10000 });
  assert.ok(hard.timeS < easy.timeS);
  assert.ok(Math.abs(easy.distM - 10000) < 1);
});

test('plan by time, distance or climbing; a stage stops at its finish', () => {
  const r = buildCatalogRoute(gpx('alpedhuez'), item('alpedhuez'));
  assert.ok(isPointToPoint(r));
  const opts = { watts: 180, params: DEFAULTS, pointToPoint: true, stopAtEnd: true };
  const t = planRide(r, 0, { mode: 'time', value: 45 }, opts);
  assert.ok(Math.abs(t.timeS - 45 * 60) < 2 && t.distM > 10000 && !t.capped);
  const d = planRide(r, 0, { mode: 'dist', value: 20000 }, opts);
  assert.ok(Math.abs(d.distM - 20000) < 1);
  const c = planRide(r, 0, { mode: 'climb', value: 600 }, opts);
  assert.ok(c.climbM >= 600 && c.climbM < 620);
  // to the finish, and a goal longer than what's left is capped at the line
  const start = startPosition(r, { offsetM: 100000 });
  const open = planRide(r, start, { mode: 'open' }, opts);
  assert.equal(Math.round(open.distM), finishDistanceM(r, start));
  const long = planRide(r, start, { mode: 'time', value: 600 }, opts);
  assert.ok(long.capped && Math.round(long.distM) === finishDistanceM(r, start));
  // keep riding: no cap, it turns and rides back
  assert.ok(planRide(r, start, { mode: 'time', value: 600 }, { ...opts, stopAtEnd: false }).distM > finishDistanceM(r, start));
  // a there-and-back route left open rides on
  const z = buildCatalogRoute(gpx('zion'), item('zion'));
  assert.equal(planRide(z, 0, { mode: 'open' }, { watts: 150 }).distM, null);
});
