// City ground for the stylized renderer: real terrain (a height grid sampled from the same
// terrain tiles), the rivers and land use from OpenStreetMap, and the GPX road pressed into it.
// Pure functions — no three.js — so the QC sweep and tests can use it in Node.
// Data: "bikefree-city-1", built by tools/build_city.py.
import { makeRouteIndex } from './geo.js';
import { smoothstep } from './coast.js';

export const LAND = { paved: 0, grass: 1, woods: 2, water: 3, building: 4, sand: 5, plaza: 6, outside: 7, yards: 8 };
const LAND_COLORS = ['#8d8a84', '#77985a', '#4d6a3a', '#6c6a5e', '#7d786f', '#b5a684', '#b4ada0', '#6d8252', '#7c8c5f'];

const decode = (text, Type) => {
  const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
};

/** Decode once per data object (shared by the landscape, the renderer and the QC sweep). */
export function decodeCity(data, proj) {
  if (data._decoded?.proj === proj) return data._decoded;
  const g = data.grid;
  const nw = proj.toLocal(g.north, g.west), se = proj.toLocal(g.south, g.east);
  const heights = decode(g.h, Uint16Array);
  const land = new Uint8Array(data.land.nx * data.land.ny);
  for (let i = 0, k = 0; i < data.land.rle.length; i += 2) { land.fill(data.land.rle[i], k, k + data.land.rle[i + 1]); k += data.land.rle[i + 1]; }
  const [lat0, lon0] = data.origin, unit = data.unit;
  const local = (qlat, qlon) => proj.toLocal(lat0 + qlat * unit, lon0 + qlon * unit);
  const decoded = {
    proj, heights, land, x0: nw.x, z0: nw.z, x1: se.x, z1: se.z, nx: g.nx, ny: g.ny, lx: data.land.nx, ly: data.land.ny,
    base: g.base, scale: g.scale, local,
    /** Polylines/polygons stored as [qlat, qlon] pairs → local {x, z}. */
    points(xy, from, to) { const out = []; for (let i = from; i < to; i++) out.push(local(xy[i * 2], xy[i * 2 + 1])); return out; },
  };
  Object.defineProperty(data, '_decoded', { value: decoded, enumerable: false, configurable: true });
  return decoded;
}

export function makeCityLandscape(config, proj, index, route) {
  const data = config.city;
  if (!data || data.format !== 'bikefree-city-1') throw new Error('City scenery data is missing');
  const D = decodeCity(data, proj);
  const level = data.waterLevelM;
  const end = route.turnIdx || route.dist.length - 1;
  const samples = Array.from({ length: Math.ceil(end / 3) }, (_, i) => i * 3);
  const broad = makeRouteIndex({ dist: samples, lat: samples.map((i) => route.lat[i]), lon: samples.map((i) => route.lon[i]),
    ele: samples.map((i) => route.ele[i]) }, proj, 128);

  const outbound = (i) => (i > end ? Math.max(0, 2 * end - i) : i);   // the return leg retraces the outbound road
  // road height at (x, z) projected onto the route segment next to sample i (not a 10 m staircase)
  const roadEle = (i, x, z) => {
    const j = i < end && (i === 0 || (x - index.xs[i]) * (index.xs[i + 1] - index.xs[i]) + (z - index.zs[i]) * (index.zs[i + 1] - index.zs[i]) > 0) ? i + 1 : i - 1;
    const dx = index.xs[j] - index.xs[i], dz = index.zs[j] - index.zs[i], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - index.xs[i]) * dx + (z - index.zs[i]) * dz) / l2));
    return route.ele[i] + (route.ele[j] - route.ele[i]) * t;
  };
  const gridH = (u, v) => {
    u = Math.max(0, Math.min(D.nx - 1.001, u)); v = Math.max(0, Math.min(D.ny - 1.001, v));
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, H = D.heights, n = D.nx;
    const h = (H[j * n + i] * (1 - a) + H[j * n + i + 1] * a) * (1 - b) + (H[(j + 1) * n + i] * (1 - a) + H[(j + 1) * n + i + 1] * a) * b;
    return D.base + h * D.scale;
  };
  const terrainAt = (x, z) => gridH((x - D.x0) / (D.x1 - D.x0) * (D.nx - 1), (z - D.z0) / (D.z1 - D.z0) * (D.ny - 1));
  const landCell = (x, z) => {
    const u = Math.round((x - D.x0) / (D.x1 - D.x0) * (D.lx - 1)), v = Math.round((z - D.z0) / (D.z1 - D.z0) * (D.ly - 1));
    if (u < 0 || v < 0 || u >= D.lx || v >= D.ly) return LAND.outside;
    return D.land[v * D.lx + u];
  };
  // Water fraction, bilinear over the land grid: soft banks instead of 12 m steps.
  const waterAt = (x, z) => {
    const u = (x - D.x0) / (D.x1 - D.x0) * (D.lx - 1), v = (z - D.z0) / (D.z1 - D.z0) * (D.ly - 1);
    if (u < 0 || v < 0 || u >= D.lx - 1 || v >= D.ly - 1) return 0;
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, L = D.land, n = D.lx, w = (k) => (L[k] === LAND.water ? 1 : 0);
    return (w(j * n + i) * (1 - a) + w(j * n + i + 1) * a) * (1 - b) + (w((j + 1) * n + i) * (1 - a) + w((j + 1) * n + i + 1) * a) * b;
  };

  // Route bridges (from OSM) as distance ranges along the outbound road.
  const routeBridges = (data.routeBridges || []).map((b) => ({ ...b, toM: Math.min(b.toM, route.turnS || route.total) }));
  const onRouteBridge = (s, margin = 0) => routeBridges.find((b) => s > b.fromM - margin && s < b.toM + margin);
  const routeKinds = data.routeKinds || [];
  const routeKindAt = (s) => (routeKinds.find((k) => s >= k.fromM && s < k.toM) || { kind: 'road' }).kind;

  const baseHeight = (x, z) => {
    let h = terrainAt(x, z);
    const wet = waterAt(x, z);
    if (wet > 0) h += (Math.min(h, level - 4.5) - h) * smoothstep(.05, .7, wet);
    return h;
  };
  const heightAt = (x, z) => {
    let h = baseHeight(x, z);
    const road = index.nearest(x, z, 60);
    if (road) {
      const i = outbound(road.i), s = route.dist[i];
      const bridge = onRouteBridge(s, 6);
      if (!bridge) h += (roadEle(i, x, z) - .5 - h) * (1 - smoothstep(13, 60, road.d));
      else if (road.d < 14) h = Math.min(h, route.ele[i] - 2.5);   // keep the ground under a deck
    }
    return h;
  };
  const bridgeAt = (x, z, margin = 0) => {
    const road = index.nearest(x, z, 30);
    if (!road || road.d > 26) return null;
    return onRouteBridge(route.dist[outbound(road.i)], margin) || null;
  };
  const waterLevelAt = (x, z) => (waterAt(x, z) > .5 ? level : -Infinity);

  // A first landmark for the scenic camera: the first styled bridge on the route.
  const landmarks = [];
  const firstBridge = routeBridges.find((b) => b.style && b.style !== 'girder');
  if (firstBridge) {
    const s = (firstBridge.fromM + firstBridge.toM) / 2, i = Math.min(end - 6, Math.round(s / 10));
    const dx = index.xs[i + 5] - index.xs[i - 5], dz = index.zs[i + 5] - index.zs[i - 5], len = Math.hypot(dx, dz) || 1;
    landmarks.push({ name: firstBridge.name, x: index.xs[i], y: route.ele[i], z: index.zs[i], s, fx: dx / len, fz: dz / len, slope: 0, asset: null });
  }

  return {
    kind: 'city', city: true, data, decoded: D, level, hasOcean: false, coastSide: 1,
    coast: [{ x: -1e5, z: 0 }, { x: -1e5, z: 1 }], coastX: () => -1e5, inlandAt: () => 1e4,
    lakes: [], waterIslands: [], creeks: [], creekAt: () => null, landmarks,
    heightAt, baseHeight, terrainAt, bridgeAt, waterLevelAt, landAt: landCell, waterAt, routeKindAt, routeBridges, broad,
    isWater: (x, z, height) => waterAt(x, z) > .35 && height < level + .6,
    colorAt: (x, z) => LAND_COLORS[landCell(x, z)] || null,
    /** Trees and shrubs from the shared kit grow only in parks, woods and the hills beyond. */
    canPlant: (x, z) => { const c = landCell(x, z); return c === LAND.woods || c === LAND.outside || (c === LAND.grass && ((x * 13 + z * 7) & 3) === 0); },
  };
}
