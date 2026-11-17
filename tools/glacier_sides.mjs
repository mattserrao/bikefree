// One-off helper for the Going-to-the-Sun scene: for given distances, which side of the road (right of the
// outbound direction = +1, "ocean" in scene terms) falls away, and local frames for placing sites.
//   node tools/glacier_sides.mjs 41700 44345 …
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { loadSceneSync } from './qc_course.mjs';

const catalog = JSON.parse(readFileSync('routes/catalog.json', 'utf8'));
const item = catalog.find((r) => r.id === 'goingtothesun');
const route = buildCatalogRoute(readFileSync(item.file, 'utf8'), item);
let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
for (let i = 0; i < route.lat.length; i++) { minLat = Math.min(minLat, route.lat[i]); maxLat = Math.max(maxLat, route.lat[i]); minLon = Math.min(minLon, route.lon[i]); maxLon = Math.max(maxLon, route.lon[i]); }
const proj = makeProjection((minLat + maxLat) / 2, (minLon + maxLon) / 2);
const index = makeRouteIndex(route, proj);
const scene = loadSceneSync('routes/scenes/goingtothesun.json');
const L = landscapeBuilder(scene)(scene, proj, index, route);
const out = {};
for (const a of process.argv.slice(2)) {
  const s = Number(a), p = L.frameAt(s);
  const right = L.baseHeight(p.x - p.fz * 16, p.z + p.fx * 16), left = L.baseHeight(p.x + p.fz * 16, p.z - p.fx * 16);
  const toLatLon = (lat) => { const x = p.x - p.fz * lat, z = p.z + p.fx * lat; return proj.toLatLon ? proj.toLatLon(x, z) : null; };
  out[s] = { valley: right < left ? 1 : -1, y: +p.y.toFixed(1), heading: +(Math.atan2(p.fx, -p.fz) * 180 / Math.PI).toFixed(1), right: +(right - p.y).toFixed(1), left: +(left - p.y).toFixed(1),
    at40: toLatLon(40), atm40: toLatLon(-40), at100: toLatLon(100), atm100: toLatLon(-100) };
}
console.log(JSON.stringify(out, null, 1));
