import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGpx, buildRoute, routeAt, averageGradeAhead, ascentRemaining, haversine } from '../js/gpx.js';

// A straight line north: 1 km flat, then 1 km at 5%.
function makeGpx() {
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const d = i * 10;
    const lat = 44 + d / 111195;
    const ele = d <= 1000 ? 100 : 100 + (d - 1000) * 0.05;
    pts.push(`<trkpt lat="${lat}" lon="-74"><ele>${ele}</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Test &amp; Climb</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('parse GPX', () => {
  const { name, points } = parseGpx(makeGpx());
  assert.equal(name, 'Test & Climb');
  assert.equal(points.length, 201);
  assert.equal(points[200].ele, 150);
});

test('build route: distance, grade, ascent', () => {
  const r = buildRoute(parseGpx(makeGpx()));
  assert.ok(Math.abs(r.total - 2000) < 5, `total ${r.total}`);
  assert.ok(Math.abs(routeAt(r, 500).grade) < 0.2);
  assert.ok(Math.abs(routeAt(r, 1500).grade - 5) < 0.3, `grade ${routeAt(r, 1500).grade}`);
  assert.ok(Math.abs(r.ascent - 50) < 3, `ascent ${r.ascent}`);
  assert.ok(Math.abs(averageGradeAhead(r, 1200, 500) - 5) < 0.3);
  assert.ok(ascentRemaining(r, 1500) < 27 && ascentRemaining(r, 1500) > 23);
  const end = routeAt(r, 99999);
  assert.ok(Math.abs(end.lat - (44 + 2000 / 111195)) < 1e-4);
});

test('rtept and missing elevation', () => {
  const gpx = '<gpx><rte><rtept lat="44" lon="-74"/><rtept lat="44.001" lon="-74"/><rtept lat="44.002" lon="-74"/></rte></gpx>';
  const r = buildRoute(parseGpx(gpx));
  assert.equal(r.hasElevation, false);
  assert.equal(r.ascent, 0);
});

test('demo route file parses', () => {
  const r = buildRoute(parseGpx(readFileSync(new URL('../routes/demo-hills.gpx', import.meta.url), 'utf8')));
  assert.ok(r.total > 5000 && r.total < 20000, `total ${r.total}`);
  assert.ok(r.ascent > 50);
});

test('haversine 1 degree latitude', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 10);
});

// A closed 4 km loop: a circle with one hill.
function loopGpx(gapM = 0) {
  const pts = [];
  const R = 4000 / (2 * Math.PI);
  for (let i = 0; i <= 400; i++) {
    const a = (i / 400) * 2 * Math.PI - (gapM / R);
    const x = R * Math.sin(a), y = R * (1 - Math.cos(a));
    const lat = 44 + y / 111195, lon = -74 + x / (111195 * Math.cos((44 * Math.PI) / 180));
    const ele = 100 + 30 * Math.sin(a + 0.4);
    pts.push(`<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`);
  }
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('closed loop is detected, wraps, and has no seam', () => {
  const r = buildRoute(parseGpx(loopGpx()));
  assert.equal(r.closed, true);
  assert.ok(Math.abs(r.total - 4000) < 20, `total ${r.total}`);
  const a = routeAt(r, 100), b = routeAt(r, r.total + 100), c = routeAt(r, 3 * r.total + 100);
  assert.ok(Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lat - c.lat) < 1e-9);
  // Grade and elevation continuous across the start/finish
  const before = routeAt(r, r.total - 5), after = routeAt(r, r.total + 5);
  assert.ok(Math.abs(before.ele - after.ele) < 0.5, `${before.ele} vs ${after.ele}`);
  assert.ok(Math.abs(before.grade - after.grade) < 0.5, `${before.grade} vs ${after.grade}`);
  assert.ok(ascentRemaining(r, r.total + 10) > 0);
});

test('small gap gets closed; open route is not a loop', () => {
  assert.equal(buildRoute(parseGpx(loopGpx(60))).closed, true);
  assert.equal(buildRoute(parseGpx(makeGpx())).closed, false);
});

test('scenic routes are closed (lap endlessly) and the right length', () => {
  const catalog = JSON.parse(readFileSync(new URL('../routes/catalog.json', import.meta.url), 'utf8'));
  // km for the full lap (out-and-back routes: there and back)
  for (const item of catalog) {
    const r = buildRoute(parseGpx(readFileSync(new URL(`../${item.file}`, import.meta.url), 'utf8')));
    const [lo, hi] = item.expectedKm;
    assert.equal(r.closed, !item.oneWay, item.id);   // a oneWay route (a Tour stage) stops at its finish
    assert.ok(r.total / 1000 >= lo && r.total / 1000 <= hi, `${item.id} ${r.total}`);
  }
});

test('out-and-back routes are symmetric and have rideable grades', async () => {
  const index = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(readFileSync(new URL('../routes/catalog.json', import.meta.url), 'utf8'));
  const oab = index.filter((r) => r.outAndBack);
  assert.deepEqual(oab.map((r) => r.id), catalog.filter((r) => r.outAndBack).map((r) => r.id));
  for (const item of oab) {
    const r = buildRoute(parseGpx(readFileSync(new URL(`../${item.file}`, import.meta.url), 'utf8')));
    const n = r.lat.length, half = Math.floor((n - 1) / 2);
    // the way back retraces the way out
    for (const k of [0, Math.floor(half / 3), half - 1]) {
      assert.ok(Math.abs(r.lat[k] - r.lat[n - 1 - k]) < 1e-4 && Math.abs(r.lon[k] - r.lon[n - 1 - k]) < 1e-4, `${item.id} @${k}`);
    }
    // no bridge dips or cliff spikes left in the profile
    const steepest = Math.max(...r.grade.map(Math.abs));
    assert.ok(steepest < 12, `${item.id} steepest ${steepest.toFixed(1)}%`);
  }
});
