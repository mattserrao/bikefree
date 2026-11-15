// Map math for the 3D world: web-mercator tiles and a local metre-based frame.
// Pure functions (tested in Node).

export const EARTH_R = 6378137;
const DEG = Math.PI / 180;

export const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const latToTileY = (lat, z) => {
  const r = lat * DEG;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export const tileXToLon = (x, z) => (x / 2 ** z) * 360 - 180;
export const tileYToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

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

/** Decode a Terrarium-encoded elevation pixel. */
export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Ground size of a tile edge in metres at a latitude. */
export const tileSizeM = (z, lat) => (2 * Math.PI * EARTH_R * Math.cos(lat * DEG)) / 2 ** z;

/**
 * Spatial index of route points in the local frame, for "how far is this spot from the road"
 * queries (road carving, tree placement).
 */
export function makeRouteIndex(route, proj, cell = 40) {
  const n = route.dist.length;
  const xs = new Float64Array(n), zs = new Float64Array(n);
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const p = proj.toLocal(route.lat[i], route.lon[i]);
    xs[i] = p.x; zs[i] = p.z;
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
  return { xs, zs, nearest, cell };
}
