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
