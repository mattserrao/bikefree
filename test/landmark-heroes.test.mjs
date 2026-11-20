// The 7.7 landmark heroes (js/world/toolbox/city/landmark-heroes.js): each stands at its real spot (the OSM
// outline in its scene entry), hides the map footprints under it, keeps clear of the route and the streets,
// keeps trees off its ground, and has its postcard view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape, cityStreets, decodeCity } from '../js/world/toolbox/city/landscape.js';
import { drain } from '../js/world/toolbox/core/jobs.js';
import { centroid, inPoly } from '../js/world/toolbox/city/hero-geom.js';

const THREE = await import('../vendor/three.module.min.js');
const { CityScene } = await import('../js/world/toolbox/city/city.js');
const { buildHeroes } = await import('../js/world/toolbox/city/heroes.js');
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** An area's landscape and decoded buildings, and a stand-in city with just what buildHeroes needs. */
function areaCity(id) {
  const item = JSON.parse(read('routes/catalog.json')).find((c) => c.id === id);
  const route = buildCatalogRoute(read(item.file), item);
  const scene = JSON.parse(read(item.scene));
  scene.city = JSON.parse(read(scene.cityData));
  route.scene = scene;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < route.lat.length; i++) { a = Math.min(a, route.lat[i]); b = Math.max(b, route.lat[i]); c = Math.min(c, route.lon[i]); d = Math.max(d, route.lon[i]); }
  const proj = makeProjection((a + b) / 2, (c + d) / 2), index = makeRouteIndex(route, proj);
  const L = makeCityLandscape(scene, proj, index, route);
  const city = Object.create(CityScene.prototype);
  Object.assign(city, { route, index, landscape: L, data: L.data, D: decodeCity(L.data, L.decoded.proj), disposables: new Set(),
    group: new THREE.Group(), night: { value: 0 }, addGlows: () => null, own: (x) => x,
    buildingMaterial: new THREE.MeshStandardMaterial(), solidMaterial: new THREE.MeshStandardMaterial() });
  drain(city._decodeBuildingsJob());
  city.streets = cityStreets(L, index, route);
  // the footprints under each hero's anchor before the build (the map's own building there, if any)
  const under = new Map();
  for (const h of scene.heroes) if (h.lengthM) { const p = proj.toLocal(h.lat, h.lon); under.set(h.name, city.buildings.filter((q) => !q.hidden && inPoly(q.ring, p.x, p.z))); }
  const out = buildHeroes(city);
  return { scene, proj, L, city, out, under };
}

const NEW = { cathedral: 1, church: 1, carnegie: 1, dippy: 1, memorial: 1, pumphouse: 1, stacks: 1, carrie: 1 };
for (const [id, expect] of [
  ['pittsburgh-oakland', ['Cathedral of Learning', 'Heinz Memorial Chapel', 'Carnegie Museum & Library', 'Dippy', 'Soldiers & Sailors Memorial Hall']],
  ['pittsburgh-allegheny', ['Immaculate Heart of Mary', "Saint Anthony's Chapel", 'Most Holy Name of Jesus', 'Saint Stanislaus Kostka']],
  ['pittsburgh-homestead', ['Homestead Works Pump House', 'The Waterfront smokestacks', 'Carrie Blast Furnaces 6 & 7']],
]) {
  test(`7.7 landmark heroes in ${id}: at their spots, replacing their footprints, clear of the route, with views`, () => {
    const { scene, proj, L, city, out, under } = areaCity(id);
    const heroes = scene.heroes.filter((h) => NEW[h.model]);
    assert.deepEqual(heroes.map((h) => h.name), expect);
    // every plan fitted clear, at most 10 m from its real spot and no smaller than 0.7
    for (const f of out.heroFits) {
      if (f.name === 'stack') assert.fail(`a smokestack isn't clear at ${f.at}`);
      assert.ok(f.ok, `${f.name} fits`);
      assert.ok(Math.hypot(...f.shift) <= 10 * Math.SQRT2 && f.scale >= .7, `${f.name}: ${JSON.stringify(f)}`);
    }
    // the map's building at each hero's spot is no longer drawn: the hero replaces it
    for (const h of heroes) for (const b of under.get(h.name) || []) assert.ok(b.hero, `${h.name}: the map footprint under it is hidden`);
    // nothing of theirs in the route's tube (the rider's and camera's space)
    const meshes = city.group.children.filter((m) => /Landmark/.test(m.name));
    assert.ok(meshes.length >= 2);
    let n = 0;
    for (const m of meshes) {
      const p = m.geometry.attributes.position.array, idx = m.geometry.index?.array;
      const count = idx ? idx.length : p.length / 3;
      for (let k = 0; k < count; k += 3) {
        const v = [0, 1, 2].map((j) => (idx ? idx[k + j] : k + j) * 3), cx = (p[v[0]] + p[v[1]] + p[v[2]]) / 3, cy = (p[v[0] + 1] + p[v[1] + 1] + p[v[2] + 1]) / 3, cz = (p[v[0] + 2] + p[v[1] + 2] + p[v[2] + 2]) / 3;
        if (L.inRouteTube(cx, cy, cz)) n++;
      }
    }
    assert.equal(n, 0, 'hero triangles in the route tube');
    // trees and planting keep off each hero's ground
    for (const h of heroes) for (const [la, lo] of h.points || [[h.lat, h.lon]]) { const p = proj.toLocal(la, lo); assert.ok(out.covers(p.x, p.z), `${h.name} keeps its ground`); }
    // a postcard view for each (the Troy Hill pair share one; Oakland's Heinz and S&S views are on the Polish Hill route)
    const views = scene.views.map((v) => v.name);
    const want = { 'pittsburgh-oakland': ['The Cathedral of Learning', 'Dippy and the Carnegie Museum'], 'pittsburgh-allegheny': ['Troy Hill: Most Holy Name and Saint Anthony', 'Saint Stanislaus Kostka'],
      'pittsburgh-homestead': ['The Pump House', 'The Waterfront smokestacks', 'Carrie Blast Furnaces 6 & 7'] }[id];
    for (const v of want) assert.ok(views.includes(v), v);
    for (const v of out.landmarks.filter((l) => want.includes(l.name))) assert.ok(Number.isFinite(v.s) && v.view.pos.y > L.heightAt(v.view.pos.x, v.view.pos.z), `${v.name}: on the route, above the ground`);
  });
}

test('7.7: the Cathedral of Learning is built from the map\'s stepped parts, up to 163 m', () => {
  const { city, scene, proj } = areaCity('pittsburgh-oakland');
  const h = scene.heroes.find((q) => q.model === 'cathedral'), p = proj.toLocal(h.lat, h.lon);
  const parts = city.buildings.filter((b) => { const c = centroid(b.ring); return b.hero && b.h > 50 && Math.hypot(c.x - p.x, c.z - p.z) < 60; });
  assert.ok(parts.length >= 6, `${parts.length} tall parts`);
  assert.equal(Math.max(...parts.map((b) => b.h)), 163);
  // its stone rises over the map's footprint to the crown's pinnacles (163 m + ~11 m)
  const pos = city.group.children.find((m) => m.name === 'Landmarks').geometry.attributes.position.array, g = city.landscape.heightAt(p.x, p.z);
  let top = -Infinity; for (let k = 0; k < pos.length; k += 3) if (Math.hypot(pos[k] - p.x, pos[k + 2] - p.z) < 60) top = Math.max(top, pos[k + 1]);
  assert.ok(top - g > 165 && top - g < 185, `top ${(top - g).toFixed(1)} m`);
});
