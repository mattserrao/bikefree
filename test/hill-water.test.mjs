// PLAN 6.5 (F131): hill water — reservoirs, ponds, lakes and fountain basins up on the hills drawn as water at
// their own level (the city data's `ponds`, tools/build_city.py), with a basin under the water and a bank round it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildCatalogRoute } from '../js/routes.js';
import { parseTerrainGrid } from '../js/terrain-grid.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape, LAND, POND_KINDS } from '../js/world/toolbox/city/landscape.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('routes/catalog.json'));

function area(id) {
  const item = catalog.find((c) => c.id === id);
  const route = buildCatalogRoute(read(item.file), item);
  const scene = JSON.parse(read(item.scene));
  scene.city = JSON.parse(read(scene.cityData));
  scene.terrainGrid = parseTerrainGrid(gunzipSync(readFileSync(new URL(`../${scene.terrainGridFile}`, import.meta.url))));
  route.scene = scene;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
  const proj = makeProjection((a + b) / 2, (c + d) / 2);
  const index = makeRouteIndex(route, proj);
  return { L: makeCityLandscape(scene, proj, index, route), scene };
}

/** Points along a pond's ring every `step` m, `off` metres out (negative: in), with the outward normal. */
function ringPoints(p, off, step = 2) {
  const out = [], R = p.ring;
  for (let k = 0; k < R.length; k++) {
    const a = R[k], b = R[(k + 1) % R.length], len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < .01) continue;
    const nx = (b.z - a.z) / len, nz = -(b.x - a.x) / len;   // outward (the ring runs counter-clockwise)
    for (let t = step / 2; t < len; t += step) out.push({ x: a.x + (b.x - a.x) * t / len + nx * off, z: a.z + (b.z - a.z) * t / len + nz * off });
  }
  return out;
}

for (const [id, named] of [['pittsburgh-eastend', ['Reservoir No. 1', 'Reservoir No. 2', 'Lake Carnegie', 'Highland Park Entry Fountain']], ['pittsburgh-oakland', ['Panther Hollow Lake', 'Westinghouse Pond']]]) {
  test(`${id}: hill water at its own level, in a basin with a bank, clear of the streets`, () => {
    const { L } = area(id);
    for (const n of named) {
      const p = L.ponds.find((q) => q.name === n);
      assert.ok(p, `${n} is drawn as water`);
      assert.ok(p.level > L.level + 10, `${n}: its own level (${p.level} m), over the rivers' (${L.level} m)`);
      assert.ok(POND_KINDS[p.kind], `${n}: kind ${p.kind}`);
    }
    let checked = 0;
    for (const p of L.ponds) {
      // the water's own level, and the ground under it (a few metres in from the edge: the 6 m mesh)
      for (const q of ringPoints(p, -2.5, 4)) {
        const hit = L.pondAt(q.x, q.z);
        if (!hit || hit.p !== p || hit.d < 2) continue;   // (a narrow arm)
        assert.equal(L.waterLevelAt(q.x, q.z), p.level);
        assert.ok(L.isWater(q.x, q.z, p.level - .1), `${p.name || p.k}: water`);
        assert.ok(L.heightAt(q.x, q.z) < p.level - .5, `${p.name || p.k}: ground ${L.heightAt(q.x, q.z).toFixed(2)} under its water ${p.level}`);
        assert.equal(L.landAt(q.x, q.z) === LAND.water, false, 'not the rivers\' water');
        checked++;
      }
      // the bank: just outside the edge the ground stands over the water (nothing floats at the edge), unless the
      // route's own road is right there (its bank rules) or a street or path runs along the edge (its grading does;
      // the bank's wall or slope stands between them)
      for (const q of ringPoints(p, .8, 3)) {
        const r = L.routeDist(q.x, q.z);
        if (r && r.d < 9) continue;
        if (L.streetsNear(q.x, q.z, 3).length) continue;
        if (L.pondAt(q.x, q.z)?.d > 0) continue;   // (another pond next to it, or a ring folding back)
        assert.ok(L.heightAt(q.x, q.z) > p.level + .05, `${p.name || p.k}: bank ${L.heightAt(q.x, q.z).toFixed(2)} over its water ${p.level}`);
      }
      // no street, path or sidewalk runs in the water
      for (const q of [...ringPoints(p, -.5, 2), ...ringPoints(p, -3, 3)]) {
        if (!(L.pondAt(q.x, q.z)?.d > 0)) continue;
        for (const o of L.streetsNear(q.x, q.z, 0)) assert.ok(o.y > p.level + .2, `${p.name || p.k}: a street in the water (${o.y.toFixed(2)} vs ${p.level})`);
      }
    }
    assert.ok(checked > 100, `${checked} water points`);
  });
}
