import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qcRoute } from '../tools/qc_course.mjs';

const gpx = (pts) => `<?xml version="1.0"?><gpx><trk><name>QC</name><trkseg>${pts.map(([lat, lon, ele]) =>
  `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${ele.toFixed(2)}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
const M = 1 / 111195;   // degrees of latitude per metre

// A smooth 3 km loop with one gentle hill
function loop(edit = (p) => p) {
  const pts = [];
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * 2 * Math.PI, r = 3000 / (2 * Math.PI);
    pts.push([44 + r * Math.sin(a) * M, -74 + (r * Math.cos(a) * M) / Math.cos(44 * Math.PI / 180), 100 + 15 * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return gpx(edit(pts));
}
const of = (r, check) => r.findings.filter((f) => f.check === check && f.severity !== 'info');

test('a clean loop passes, and the sweep covers the whole ridden length', () => {
  const r = qcRoute({ id: 'loop', gpxText: loop() });
  assert.equal(r.fails, 0, JSON.stringify(r.findings));
  assert.equal(r.warns, 0, JSON.stringify(r.findings));
  assert.ok(r.series.s.at(-1) > r.total - 20, 'swept to the end, across the lap seam');
  assert.ok(r.outAndBack, 'catalog routes ride there and back');
});

test('a spur that doubles back is caught as a GPX hairpin and a heading snap', () => {
  const r = qcRoute({ id: 'spur', gpxText: loop((p) => {
    const [lat, lon, ele] = p[100];
    const spur = [1, 2, 3, 4, 3, 2, 1].map((k) => [lat + k * 10 * M, lon, ele]);   // 40 m up a side road and back
    return [...p.slice(0, 101), ...spur, ...p.slice(100)];
  }) });
  const snap = of(r, 'heading-snap'), hairpin = of(r, 'gpx-hairpin');
  assert.ok(hairpin.length >= 1, 'GPX zig-zag flagged');
  assert.ok(snap.length >= 1 && snap[0].severity === 'fail', 'heading snap is a FAIL');
  assert.ok(Math.abs(snap[0].at - hairpin[0].at) < 80, 'both point at the same spot');
});

test('a single bad elevation point is caught', () => {
  const r = qcRoute({ id: 'spike', gpxText: loop((p) => { p[150] = [p[150][0], p[150][1], p[150][2] + 25]; return p; }) });
  assert.equal(of(r, 'gpx-spike').length, 1);
});

test('a missing stretch of GPX (a jump) is caught', () => {
  const r = qcRoute({ id: 'gap', gpxText: loop((p) => [...p.slice(0, 120), ...p.slice(128)]) });
  assert.ok(of(r, 'gpx-gap').length >= 1);
});

test('a sideways kink in the road (a cut spur, a junction step) is caught', () => {
  // at i = 75 the loop runs east–west, so a 5 m northward bump is a sideways kink
  const r = qcRoute({ id: 'jog', gpxText: loop((p) => p.map(([lat, lon, ele], i) => i === 75 ? [lat + 5 * M, lon, ele] : [lat, lon, ele])) });
  assert.ok(of(r, 'path-jog').length >= 1);
});

// a city scene carries its bundled city data (buildings, streets, height grid), as the app loads it
const withCity = (scene) => (scene.cityData ? { ...scene, city: JSON.parse(readFileSync(new URL(`../${scene.cityData}`, import.meta.url), 'utf8')) } : scene);

test('every scenic route rides clean end to end: no discontinuities, no warnings', () => {
  const catalog = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8'));
  for (const item of catalog) {
    const r = qcRoute({ id: item.id, item, gpxText: readFileSync(new URL(`../${item.file}`, import.meta.url), 'utf8'),
      scene: withCity(JSON.parse(readFileSync(new URL(`../${item.scene}`, import.meta.url), 'utf8'))) });
    assert.ok(r.stylized && r.series.cs.length > 100, `${item.id} checked its scenery`);
    const problems = r.findings.filter((f) => f.severity !== 'info').map((f) => `${f.check} @ ${(f.at / 1000).toFixed(2)} km`);
    assert.deepEqual(problems, [], `${item.id}: run npm run qc for details`);
  }
});
