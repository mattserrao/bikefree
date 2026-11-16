import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute, routeStartM } from '../js/routes.js';
import { buildRoute, parseGpx, isPointToPoint, finishDistanceM, legSpan } from '../js/gpx.js';
import { Session } from '../js/session.js';

const gpx = (id) => readFileSync(new URL(`../routes/parks/${id}.gpx`, import.meta.url), 'utf8');
const index = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8'));
const item = (id) => ({ ...index.find((r) => r.id === id), routeId: id });

test('point to point: one-way stages and open GPX files, not loops or there-and-back routes', () => {
  assert.equal(isPointToPoint(buildCatalogRoute(gpx('alpedhuez'), item('alpedhuez'))), true);
  assert.equal(isPointToPoint(buildCatalogRoute(gpx('yosemite'), item('yosemite'))), false);   // a loop
  assert.equal(isPointToPoint(buildCatalogRoute(gpx('zion'), item('zion'))), false);           // there and back
  // your own GPX that ends somewhere else
  const pts = Array.from({ length: 60 }, (_, i) => `<trkpt lat="${45 + i * 0.0005}" lon="6"><ele>${700 + i}</ele></trkpt>`).join('');
  const own = buildCatalogRoute(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`, { name: 'Mine' });
  assert.equal(isPointToPoint(own), true);
  assert.equal(isPointToPoint(buildRoute(parseGpx(gpx('alpedhuez')))), false);   // not mirrored: nothing to turn at
});

test('finish distance: forward to the far end, reverse back to the start, from any start point', () => {
  const r = buildCatalogRoute(gpx('alpedhuez'), item('alpedhuez'));
  const L = r.turnS;
  assert.equal(finishDistanceM(r, routeStartM(r)), L);
  assert.ok(Math.abs(finishDistanceM(r, routeStartM(r, { fraction: 1 / 3 })) - (2 / 3) * L) < 20);
  assert.equal(finishDistanceM(r, routeStartM(r, { reverse: true })), L);
  assert.ok(Math.abs(finishDistanceM(r, routeStartM(r, { reverse: true, fraction: 2 / 3 })) - L / 3) < 20);
});

const stub = () => Object.assign(new EventTarget(), { vibrate() {} });
const sessions = [];
const makeSession = () => { const s = new Session({ trainer: stub(), ride: stub(), hr: stub(), log: () => {}, settings: {} }); sessions.push(s); return s; };
after(() => { for (const s of sessions) clearInterval(s._timer); });   // the session's ride clock

test('ends at the finish: the ride finishes once, the rider stays on the line, the grade goes flat', () => {
  const r = buildCatalogRoute(gpx('alpedhuez'), item('alpedhuez'));
  const s = makeSession();
  let finished = 0;
  s.addEventListener('routeFinished', () => finished++);
  s.setRoute(r, 0, finishDistanceM(r, 0));
  s.distanceM = r.turnS - 50;
  s._updateRoute();
  assert.equal(finished, 0);
  assert.equal(s.routeLapToGo, 50);
  assert.ok(s.gradePct > 0);   // still climbing to the summit
  s.distanceM = r.turnS + 120;
  s._updateRoute(); s._updateRoute();
  assert.equal(finished, 1);
  assert.equal(s.routeDone, true);
  assert.equal(s.routePos, r.turnS);   // stopped at the finish, not on the way back down
  assert.equal(s.gradePct, 0);
});

test('reverse, ending at the finish: the rider stays at the end of the way back', () => {
  const r = buildCatalogRoute(gpx('alpedhuez'), item('alpedhuez'));
  const s = makeSession();
  const start = routeStartM(r, { reverse: true });
  s.setRoute(r, start, finishDistanceM(r, start));
  s.distanceM = r.turnS + 300;
  s._updateRoute();
  assert.equal(s.routeDone, true);
  assert.ok(s.routePos > r.total - 1);   // at A, still facing the way back
  assert.deepEqual(legSpan(r, start), [r.turnS, r.total]);
  assert.deepEqual(legSpan(r, 0), [0, r.turnS]);
});

test('endless: rides past the finish, turns and laps as before', () => {
  const r = buildCatalogRoute(gpx('alpedhuez'), item('alpedhuez'));
  const s = makeSession();
  let finished = 0;
  s.addEventListener('routeFinished', () => finished++);
  s.setRoute(r, 0, null);
  s.distanceM = r.turnS + 500;
  s._updateRoute();
  assert.equal(finished, 0);
  assert.equal(s.routePos, r.turnS + 500);   // on the way back down
  assert.equal(s.routeFinishM, null);
});
