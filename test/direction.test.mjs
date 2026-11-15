import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute, mirrorRoute, routeStartM } from '../js/routes.js';
import { routeAt, wrapDist } from '../js/gpx.js';
import { parseWorkout, BUILT_IN_WORKOUTS, markFtpTest, ftpFromTwentyMinutes } from '../js/workout.js';

const gpx = (id) => readFileSync(new URL(`../routes/parks/${id}.gpx`, import.meta.url), 'utf8');
const index = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8'));
const item = (id) => ({ ...index.find((r) => r.id === id), routeId: id });

test('loops are mirrored into there-and-back laps on a 10 m grid', () => {
  const r = buildCatalogRoute(gpx('yosemite'), item('yosemite'));
  assert.equal(r.mirrored, true);
  assert.equal(r.closed, true);
  assert.ok(r.oneWay.closedLoop);
  assert.equal(r.turnS, r.turnIdx * 10);
  assert.equal(r.total, 2 * r.turnS);
  for (let i = 0; i < r.dist.length; i++) assert.equal(r.dist[i], i * 10);
  // the way back retraces the way out, with the grade reversed
  for (const k of [5, 200, r.turnIdx - 3]) {
    const j = 2 * r.turnIdx - k;
    assert.equal(r.lat[k], r.lat[j]);
    assert.equal(r.ele[k], r.ele[j]);
    assert.equal(r.grade[k], -r.grade[j]);
  }
  // a mirrored loop climbs what it descends
  assert.ok(Math.abs(r.ascent - r.descent) < 1);
});

test('out-and-back routes are left as they are', () => {
  const r = buildCatalogRoute(gpx('zion'), item('zion'));
  assert.ok(r.outAndBack && !r.mirrored);
  assert.equal(mirrorRoute(r), r);
});

test('start point: forward from the start, reverse from the far end, then a fraction along', () => {
  const r = buildCatalogRoute(gpx('yosemite'), item('yosemite'));
  const L = r.turnS;
  assert.equal(routeStartM(r), 0);
  assert.ok(Math.abs(routeStartM(r, { fraction: 1 / 3 }) - L / 3) < 1e-6);
  assert.equal(routeStartM(r, { reverse: true }), L);
  assert.ok(Math.abs(routeStartM(r, { reverse: true, fraction: 2 / 3 }) - (L + (2 * L) / 3)) < 1e-6);
  // reverse ⅓ is the same place as forward ⅔, heading the other way
  const a = routeAt(r, routeStartM(r, { reverse: true, fraction: 1 / 3 })), b = routeAt(r, routeStartM(r, { fraction: 2 / 3 }));
  assert.ok(Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4);
  assert.ok(Math.sign(a.grade) === -Math.sign(b.grade) || Math.abs(a.grade) < 0.2);
  assert.equal(wrapDist(r, r.total + 5), 5);
});

test('FTP test: 20-minute all-out segment, FTP = 95% of the average', () => {
  const b = BUILT_IN_WORKOUTS.find((w) => w.ftpTest);
  const w = markFtpTest(parseWorkout(b.text));
  const seg = w.segments.find((s) => s.ftpTest);
  assert.ok(w.ftpTest && seg && seg.kind === 'free' && seg.duration === 1200);
  assert.equal(ftpFromTwentyMinutes(260), 247);
});
