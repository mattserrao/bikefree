// tools/repair_city.mjs on one small area (the West End): the packed streets codec gives the city JSON back byte for
// byte, and the stored (repaired) data is already repaired — a second run changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeStreets, encodeStreets, withStreets, repairArea, loadRides } from '../tools/repair_city.mjs';
import { loadSceneSync } from '../tools/qc_course.mjs';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const catalog = JSON.parse(read('routes/parks/index.json'));
const item = catalog.find((it) => it.id === 'pittsburgh-westend');
const scene = loadSceneSync(item.scene), text = read(scene.cityData);

test('city repair: the streets codec round-trips the city JSON byte-identically', () => {
  const { streets, at, len } = decodeStreets(text);
  assert.equal(streets.length, JSON.parse(text).streets.count);
  assert.equal(encodeStreets(streets), text.slice(at, at + len));
  assert.equal(withStreets(text, streets), text);
});

test('city repair: a second run on the West End changes nothing (idempotent)', () => {
  const rides = loadRides(catalog);
  const r = repairArea({ item, scene, text, rides });
  assert.deepEqual(r.changes, [], `repairs: ${JSON.stringify(r.changes)}`);
  assert.equal(r.text, text);
  assert.deepEqual(r.after, r.before);
});

// [E] interchange thinning: a tertiary drawn over a highway, 3 m off its line, away from the routes (a duplicate ribbon) is
// dropped, and only it (the text comes back byte-identical: the stored data is already thinned — idempotent).
test('city repair: interchange thinning drops a duplicate ribbon drawn over a highway, and only it', () => {
  const rides = loadRides(catalog), { streets } = decodeStreets(text), city = JSON.parse(text);
  const proj = makeProjection(scene.origin.lat, scene.origin.lon), idx = rides.map((rd) => makeRouteIndex(rd.route, proj));
  const own = idx[rides.findIndex((rd) => rd.id === item.id)];
  const local = ([a, o]) => proj.toLocal(city.origin[0] + a * city.unit, city.origin[1] + o * city.unit);
  const far = (p) => idx.every((ix) => { const q = ix.nearest(p.x, p.z, 150); return !q || q.d > 60; });
  // a straight 60–190 m run of a ground highway (THIN.parMax: 200), 60+ m from every route, within 300 m of the West End's
  let run = null;
  for (const s of streets) {
    if (s.meta[0] !== 0 || s.meta[1] & 1) continue;
    const P = s.xy.map(local);
    for (let i = 0; i < P.length && !run; i++) {
      let len = 0;
      for (let j = i + 1; j < P.length; j++) {
        len += Math.hypot(P[j].x - P[j - 1].x, P[j].z - P[j - 1].z);
        if (len > 190) break;
        const chord = Math.hypot(P[j].x - P[i].x, P[j].z - P[i].z);
        if (len >= 60 && chord > .97 * len && P.slice(i, j + 1).every(far) && P.slice(i, j + 1).some((p) => own.nearest(p.x, p.z, 300))) { run = { P: P.slice(i, j + 1), chord }; break; }
      }
    }
    if (run) break;
  }
  assert.ok(run, 'a highway run to copy');
  const { P } = run, ux = (P.at(-1).x - P[0].x) / run.chord, uz = (P.at(-1).z - P[0].z) / run.chord, off = 3;   // centre lines 3 m apart: drawn over it
  const q = (x, z) => { const g = proj.toLatLon(x, z); return [Math.round((g.lat - city.origin[0]) / city.unit), Math.round((g.lon - city.origin[1]) / city.unit)]; };
  const dup = { meta: [4, 0, 8], xy: P.map((p) => q(p.x - uz * off, p.z + ux * off)), deck: P.map(() => 0) };
  const t1 = withStreets(text, [...streets, dup]);
  const r = repairArea({ item, scene, text: t1, rides, rules: ['interchange'] });
  const dropped = r.changes.filter((c) => c.rule.startsWith('ix-'));
  assert.equal(r.text, text, `thinning: ${JSON.stringify(r.changes)}`);
  assert.deepEqual(dropped.map((c) => c.rule), ['ix-parallel']);
});

// [route-sites] at a busy route site (tools/city/pittsburgh-route-sites.json; here a made-up site on the West End's route):
// a parking aisle at the route's road is dropped and a copy of the route's road drawn 8 m beside it is moved onto the
// route's centre line; the stored data is already repaired at the real sites (a second run changes nothing).
test('city repair: route sites drop an aisle at the path and move a copy of the route\'s road under it', async () => {
  const { routeSites, routeSitePass } = await import('../tools/repair_city.mjs');
  const rides = loadRides(catalog);
  const again = repairArea({ item, scene, text, rides, sites: routeSites(), rules: ['route-stub', 'route-service', 'route-leftover', 'route-copy'] });
  assert.deepEqual(again.changes, [], `repairs: ${JSON.stringify(again.changes)}`);
  const { streets } = decodeStreets(text), city = JSON.parse(text);
  const proj = makeProjection(scene.origin.lat, scene.origin.lon), own = rides.find((rd) => rd.id === item.id).route;
  const ix = makeRouteIndex(own, proj);
  const q = (x, z) => { const g = proj.toLatLon(x, z); return [Math.round((g.lat - city.origin[0]) / city.unit), Math.round((g.lon - city.origin[1]) / city.unit)]; };
  // a straight 60 m stretch of the route with no street within 30 m of it
  const local = ([a, o]) => proj.toLocal(city.origin[0] + a * city.unit, city.origin[1] + o * city.unit);
  const pts = streets.flatMap((s) => s.xy.map(local));
  let at = -1;
  for (let i = 20; i < ix.xs.length - 20 && at < 0; i += 3) {
    const a = { x: ix.xs[i], z: ix.zs[i] }, b = { x: ix.xs[i + 6], z: ix.zs[i + 6] }, l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 58 || !pts.length || pts.some((p) => Math.hypot(p.x - (a.x + b.x) / 2, p.z - (a.z + b.z) / 2) < 70)) continue;
    let ok = true; for (let j = i; j <= i + 6; j++) { const c = (ix.xs[j] - a.x) * (b.z - a.z) - (ix.zs[j] - a.z) * (b.x - a.x); if (Math.abs(c / l) > .5) ok = false; }
    if (ok) at = i;
  }
  assert.ok(at >= 0, 'a straight, empty stretch of the route');
  const a = { x: ix.xs[at], z: ix.zs[at] }, b = { x: ix.xs[at + 6], z: ix.zs[at + 6] }, l = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
  const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, g = proj.toLatLon(m.x, m.z);
  const copy = { meta: [4, 0, 8], xy: [0, 20, 40].map((s) => q(a.x + ux * (s + 10) - uz * 8, a.z + uz * (s + 10) + ux * 8)), deck: [0, 0, 0] };
  // a parking lot on the other side: two aisles from the road joined at their far ends (no other way in: one stays)
  const P = (s, o) => q(m.x + ux * s + uz * o, m.z + uz * s - ux * o);
  const lot = [[P(-5, 2), P(-5, 16)], [P(5, 2), P(5, 16)], [P(-5, 16), P(5, 16)]].map((xy) => ({ meta: [7, 0, 8], xy, deck: [0, 0] }));
  const t1 = withStreets(text, [...streets, copy, ...lot]);
  const L = { baseHeight: () => 0 };
  const rideIdx = rides.map((rd) => ({ own: rd.id === item.id, index: makeRouteIndex(rd.route, proj) }));
  const r = routeSitePass({ streets: decodeStreets(t1).streets, city: JSON.parse(t1), proj, ground: L.baseHeight, rides: rideIdx, sites: [{ lat: g.lat, lon: g.lon, r: 60 }] });
  assert.deepEqual(r.changes.map((c) => c.rule).sort(), ['route-copy', 'route-service', 'route-service'], JSON.stringify(r.changes));
  assert.equal(r.streets.length, streets.length + 2);   // the copy and one entrance
  const segD = (p) => { let d = Infinity; for (let j = Math.max(0, at - 3); j < at + 9; j++) { const dx = ix.xs[j + 1] - ix.xs[j], dz = ix.zs[j + 1] - ix.zs[j], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - ix.xs[j]) * dx + (p.z - ix.zs[j]) * dz) / l2)); d = Math.min(d, Math.hypot(ix.xs[j] + dx * t - p.x, ix.zs[j] + dz * t - p.z)); } return d; };
  for (const p of r.streets.at(-2).xy.map(local)) assert.ok(segD(p) < .5, `copy node ${JSON.stringify(p)} on the route's centre line (${segD(p).toFixed(2)} m off)`);
  assert.equal(r.streets.at(-1).meta[0], 7);
});
