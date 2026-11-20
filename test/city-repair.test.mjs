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
