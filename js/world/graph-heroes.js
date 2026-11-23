// PGH's landmarks: the Pittsburgh map's own hero models (toolbox/city/heroes.js, landmark-heroes.js,
// heroes-northshore.js) built in a free-ride graph's world. The builders were written for the city scene (CityScene),
// so they get a small stand-in for it: the city's own materials (CityScene.prototype._materials — the towers' windows,
// the solid details, the night glows), the map footprints round each hero (tools/pgh_heroes.mjs: the models size and
// turn themselves from them), and the graph world's ground for their heights. No streets, no route: PGH has neither.
//
//   const h = await buildGraphHeroes(world, json)   → { group, tick(time, dt), setNight(v), dispose(), heroes }
import * as THREE from '../../vendor/three.module.min.js';

export async function buildGraphHeroes(world, json) {
  const [{ CityScene }, { buildHeroes }, { buildPghLandmarks }, { frameOf, orient }] = await Promise.all([import('./toolbox/city/city.js'), import('./toolbox/city/heroes.js'),
    import('./toolbox/city/pgh-landmarks.js'), import('./toolbox/city/hero-geom.js')]);
  const proj = world.proj;
  const host = Object.create(CityScene.prototype);
  host.group = new THREE.Group(); host.group.name = 'PGH landmarks';
  host.disposables = new Set();
  host.night = { value: 0 };
  host.uniforms = { uSkyTop: { value: new THREE.Color('#7fb0e0') }, uTime: { value: 0 } };
  host.qualityKey = world.qualityKey || 'balanced';
  host.route = { scene: { heroes: json.heroes.map((h) => ({ ...h })) }, dist: [0], turnIdx: 0 };   // (no views, overlooks or fountain: PGH has its own Point)
  host.D = { proj };
  host.waterMaterial = world.mats.water;   // (the creeks' surfaces: the water effect's ripples and glints)
  // Saint Josaphat (twin towers, copper domes, buff brick) and the Union Project (the old Union Baptist: Gothic stone,
  // one square corner tower) are churches: the map's church builder, sized and turned from their OSM outlines
  const CHURCHES = { josaphat: { look: 'ihm', style: { wall: '#c7a873', towerM: 40, crown: 'onion', crownM: 12 } },
    unionproject: { look: 'holyname', style: { wall: '#8a8274', roof: '#4b4f52', crown: 'pinnacles', crownM: 4, towerM: 26 } } };
  for (const l of json.landmarks || []) {
    const c = CHURCHES[l.model]; if (!c || !l.ring) continue;
    const F = frameOf(orient(l.ring.map(([a, o]) => proj.toLocal(a, o))));
    host.route.scene.heroes.push({ model: 'church', name: l.label, ...c, lat: l.center[0], lon: l.center[1], lengthM: F.hl * 2, widthM: F.hw * 2, axisDeg: Math.atan2(F.u.x, -F.u.z) * 180 / Math.PI });
  }
  host.index = { nearest: () => null, xs: [], zs: [] };
  host.streets = [];
  const pool = () => world.waterY - 0.35;
  const H = (x, z) => world._groundH(x, z);
  host.landscape = {
    decoded: { proj }, level: pool(), landmarks: [], routeBridges: [],
    heightAt: H, terrainAt: H,
    waterAt: (x, z) => (H(x, z) < world.poolAt(x, z) ? 1 : 0),
    poolAt: (x, z) => world.poolAt(x, z),
    lifeSpots: world.lifeSpots,
    // a PGH way within r of (x, z) (its edge): monuments and dressing keep off the ways
    wayNear: (x, z, r = 1) => { const g = world.cut, c = g.cell, k = Math.ceil((r + 8) / c); for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) { const a = g.cellAt(Math.floor(x / c) + i, Math.floor(z / c) + j); if (!a) continue; for (let q = 0; q < a.length; q += 5) if (Math.hypot(a[q] - x, a[q + 1] - z) - a[q + 3] < r) return true; } return false; },
    routeDist: () => 1e9, streetsNear: () => [], onStreet: () => false, inRouteTube: () => false, sheltered: () => false,
    /** How far (x, z) is from the edge of the nearest way, up to r (segments, not samples: CNY's canal banks keep off
     *  the towpath between its samples too). */
    wayDist: (x, z, r = 10) => {
      const G = host._segGrid ||= (() => {
        const m = new Map();
        for (const e of world.G.edges) for (let i = 0; i + 1 < e.x.length; i++) {
          const k = `${Math.floor((e.x[i] + e.x[i + 1]) / 40)},${Math.floor((e.z[i] + e.z[i + 1]) / 40)}`;
          if (!m.has(k)) m.set(k, []); m.get(k).push(e, i);
        }
        return m;
      })();
      let best = r;
      const gx = Math.floor(x / 20), gz = Math.floor(z / 20), k = Math.ceil((r + 12) / 20);
      for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) {
        const arr = G.get(`${gx + a},${gz + b}`); if (!arr) continue;
        for (let q = 0; q < arr.length; q += 2) {
          const e = arr[q], i = arr[q + 1], ax = e.x[i], az = e.z[i], dx = e.x[i + 1] - ax, dz = e.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - (world.wOf ? world.wOf(e) : 7) / 2;
          if (d < best) best = d;
        }
      }
      return best;
    },
    /** The nearest ridden deck (a way's bridge run) within r of (x, z): { x, z, y, e } — CNY's aqueduct carries the trail's. */
    deckNear: (x, z, r = 30) => {
      let best = null;
      for (const e of world.G.edges) for (const [a, b] of e.bridges || []) for (let i = a + 1; i < b; i++) { const d = Math.hypot(e.x[i] - x, e.z[i] - z); if (d < r && (!best || d < best.d)) best = { d, x: e.x[i], z: e.z[i], y: e.ele[i], e }; }
      return best;
    },
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
  // the windows' night light, softer than the city scenes' (PGH's exposure is higher and there's no bloom: the lit
  // windows burnt out white)
  host.windowNight = { value: 0 };
  // the city's facades (brick, stone, metal, window frames, sills) as the Pittsburgh map draws them: they come with a
  // building kit in the scene (js/world/graph-city.js plans PGH's homes with it)
  // (Light / phones: the city's plain window shader, not the brick-and-frames facade shader — a third of a frame's GPU time)
  host.route.scene.buildingKit = { cityFacades: world.qualityKey !== 'low', detailM: 150, dressingM: 80, styles: world.json?.id === 'cny' ? [{ preset: 'cny-suburban', kinds: ['house', 'rowhouse'] }] : [{ preset: 'pittsburgh-rowhouse', kinds: ['rowhouse'] }, { preset: 'pittsburgh-frame', kinds: ['house', 'barn', 'shed'] }] };
  host._materials();
  const heroes = buildHeroes(host);
  let landmarks = { count: 0, tick() {} };
  try { landmarks = buildPghLandmarks(host, json); } catch (err) { console.warn(`PGH landmarks: ${err.message}`); }
  // the footprints the heroes stand on (claimed) — for the clash check: a PGH way through one is a conflict
  const claimed = host.buildings.filter((b) => b.hero);
  return {
    claimed,
    group: host.group, heroes, landmarks, host, json,
    addGlows: (list, name) => host.addGlows(list, name),
    tick(time, dt) { host.uniforms.uTime.value = time; heroes.tick?.(time, dt); landmarks.tick(time); },
    setNight(v) { host.night.value = v; host.windowNight.value = v * 0.45; for (const m of host.nightOnly || []) m.visible = v > 0.01; heroes.setNight?.(v); },
    dispose() { host.group.removeFromParent(); for (const d of host.disposables) d.dispose?.(); },
  };
}
