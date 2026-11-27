// Map math for the 3D world: web-mercator tiles and a local metre-based frame.
// Pure functions (tested in Node).
// [review 27 Nov] The local frame and the route index live in the toolbox's core (toolbox/core/geo.js), re-exported here.
import { EARTH_R } from './toolbox/core/geo.js';
export { EARTH_R, makeProjection, makeRouteIndex } from './toolbox/core/geo.js';

// ---- Tile sources and level-of-detail rules (shared by the live terrain and offline downloads) ----
export const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const IMG_URL = (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;

export const ROOT_Z = 9;
export const MAX_Z = 15;
export const IMG_MAX_Z = 16;
export const SPLIT = 1.0;            // split a tile when the camera is closer than SPLIT × its size
export const ROOT_PAD_DEG = 0.3;     // root tiles cover the route plus this margin (~25–35 km)
/** Split a tile into its four children when the camera is closer than this. */
export const splitDistance = (z, size) => size * (z >= 13 ? SPLIT : SPLIT * 0.7);

/** Every URL the 3D world loads for one tile (elevation + imagery). */
export function tileUrls(z, x, y) {
  const imgZ = z >= 14 ? Math.min(z + 1, IMG_MAX_Z) : z;
  const f = 2 ** (imgZ - z);
  const urls = [DEM_URL(Math.min(z, 15), x, y)];
  for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) urls.push(IMG_URL(imgZ, x * f + i, y * f + j));
  return urls;
}

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

/** Decode a Terrarium-encoded elevation pixel. */
export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Ground size of a tile edge in metres at a latitude. */
export const tileSizeM = (z, lat) => (2 * Math.PI * EARTH_R * Math.cos(lat * DEG)) / 2 ** z;
