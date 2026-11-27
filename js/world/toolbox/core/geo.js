// Toolbox core: the local metre frame and the route's spatial index. Pure functions (tested in Node).
// [review 27 Nov] Moved from js/world/geo.js (which re-exports them) so the toolbox imports nothing from the app's world.
import { turnOptions, smoothTurns } from './road-align.js';   // [smooth-turns]
import { ghostMask } from './ghost.js';

export const EARTH_R = 6378137;
const DEG = Math.PI / 180;

/**
 * Local frame centred on (lat0, lon0): x = metres east, z = metres south (three.js: −z is north),
 * y = elevation in metres. Equirectangular around the centre — accurate to well under 1%
 * across a national park, and terrain and road use the same mapping so they line up exactly.
 */
export function makeProjection(lat0, lon0) {
  const k = EARTH_R * DEG;
  const kx = k * Math.cos(lat0 * DEG);
  return {
    lat0, lon0,
    toLocal: (lat, lon) => ({ x: (lon - lon0) * kx, z: -(lat - lat0) * k }),
    toLatLon: (x, z) => ({ lat: lat0 - z / k, lon: lon0 + x / kx }),
  };
}

/**
 * Spatial index of route points in the local frame, for "how far is this spot from the road"
 * queries (road carving, tree placement).
 */
export function makeRouteIndex(route, proj, cell = 40) {
  const n = route.dist.length;
  const xs = new Float64Array(n), zs = new Float64Array(n);
  const grid = new Map();
  const ghost = ghostMask(route);   // a network tour's repeated stretches: never "the nearest route point" (core/ghost.js)
  for (let i = 0; i < n; i++) { const p = proj.toLocal(route.lat[i], route.lon[i]); xs[i] = p.x; zs[i] = p.z; }
  // [smooth-turns] a scene with roadAlign.turns eases its too-tight turns (core/road-align.js); others unchanged
  const turns = turnOptions(route);
  const smoothed = turns ? smoothTurns(route, xs, zs, turns) : null;
  for (let i = 0; i < n; i++) {
    if (ghost?.[i]) continue;
    const p = { x: xs[i], z: zs[i] };
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    let arr = grid.get(key);
    if (!arr) grid.set(key, (arr = []));
    arr.push(i);
  }
  /** Nearest route point within `maxR` metres: {d, i, ele} or null. */
  function nearest(x, z, maxR = cell) {
    const r = Math.ceil(maxR / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = null, bd = maxR * maxR;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const arr = grid.get(`${cx + dx},${cz + dz}`);
        if (!arr) continue;
        for (const i of arr) {
          const ddx = xs[i] - x, ddz = zs[i] - z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bd) { bd = d2; best = i; }
        }
      }
    }
    return best == null ? null : { d: Math.sqrt(bd), i: best, ele: route.ele[best] };
  }
  return smoothed ? { xs, zs, nearest, cell, turns: smoothed } : { xs, zs, nearest, cell };
}
