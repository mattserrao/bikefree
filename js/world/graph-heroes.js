// PGH's landmarks: the Pittsburgh map's own hero models (toolbox/city/heroes.js, landmark-heroes.js,
// heroes-northshore.js) built in a free-ride graph's world. The builders were written for the city scene (CityScene),
// so they get a small stand-in for it: the city's own materials (CityScene.prototype._materials — the towers' windows,
// the solid details, the night glows), the map footprints round each hero (tools/pgh_heroes.mjs: the models size and
// turn themselves from them), and the graph world's ground for their heights. No streets, no route: PGH has neither.
//
//   const h = await buildGraphHeroes(world, json)   → { group, tick(time, dt), setNight(v), dispose(), heroes }
import * as THREE from '../../vendor/three.module.min.js';

export async function buildGraphHeroes(world, json) {
  const [{ CityScene }, { buildHeroes }] = await Promise.all([import('./toolbox/city/city.js'), import('./toolbox/city/heroes.js')]);
  const proj = world.proj;
  const host = Object.create(CityScene.prototype);
  host.group = new THREE.Group(); host.group.name = 'PGH landmarks';
  host.disposables = new Set();
  host.night = { value: 0 };
  host.uniforms = { uSkyTop: { value: new THREE.Color('#7fb0e0') }, uTime: { value: 0 } };
  host.qualityKey = world.qualityKey || 'balanced';
  host.route = { scene: { heroes: json.heroes.map((h) => ({ ...h })) }, dist: [0], turnIdx: 0 };   // (no views, overlooks or fountain: PGH has its own Point)
  host.D = { proj };
  host.index = { nearest: () => null, xs: [], zs: [] };
  host.streets = [];
  const pool = () => world.waterY - 0.35;
  const H = (x, z) => world._groundH(x, z);
  host.landscape = {
    decoded: { proj }, level: pool(), landmarks: [], routeBridges: [],
    heightAt: H, terrainAt: H,
    waterAt: (x, z) => (H(x, z) < world.poolAt(x, z) ? 1 : 0),
    routeDist: () => 1e9, streetsNear: () => [], onStreet: () => false, inRouteTube: () => false, sheltered: () => false,
  };
  // the footprints round the heroes, as the city decodes them
  host.buildings = json.buildings.map((b, k) => {
    const ring = b.ring.map(([la, lo]) => proj.toLocal(la, lo));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    return { k, ring, h: b.h, mh: b.mh, kind: b.kind, name: b.name, bb: [x0, x1, z0, z1] };
  });
  host.buildingGrid = new Map();
  for (const b of host.buildings) for (let gx = Math.floor(b.bb[0] / 40); gx <= Math.floor(b.bb[1] / 40); gx++) for (let gz = Math.floor(b.bb[2] / 40); gz <= Math.floor(b.bb[3] / 40); gz++) {
    const key = `${gx},${gz}`; if (!host.buildingGrid.has(key)) host.buildingGrid.set(key, []); host.buildingGrid.get(key).push(b);
  }
  host._materials();
  const heroes = buildHeroes(host);
  // the footprints the heroes stand on (claimed) — for the clash check: a PGH way through one is a conflict
  const claimed = host.buildings.filter((b) => b.hero);
  return {
    claimed,
    group: host.group, heroes,
    tick(time, dt) { host.uniforms.uTime.value = time; heroes.tick?.(time, dt); },
    setNight(v) { host.night.value = v; for (const m of host.nightOnly || []) m.visible = v > 0.01; heroes.setNight?.(v); },
    dispose() { host.group.removeFromParent(); for (const d of host.disposables) d.dispose?.(); },
  };
}
