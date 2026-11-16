// City ground for the stylized renderer: real terrain (a height grid sampled from the same
// terrain tiles), the rivers and land use from OpenStreetMap, and the GPX road pressed into it.
// Pure functions — no three.js — so the QC sweep and tests can use it in Node.
// Data: "bikefree-city-1", built by tools/build_city.py.
import { makeRouteIndex } from './geo.js';
import { smoothstep } from './coast.js';
import { ROAD_WIDTH } from './pose.js';

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
  // outbound route samples on a 20 m grid, for "every stretch of road near here"
  const near = new Map();
  for (let i = 0; i <= end; i++) { const k = `${Math.floor(index.xs[i] / 20)},${Math.floor(index.zs[i] / 20)}`; if (!near.has(k)) near.set(k, []); near.get(k).push(i); }
  const nearbyRoute = (x, z) => {
    const out = [], cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of near.get(`${cx + a},${cz + b}`) || []) out.push(i);
    return out;
  };
  /** True distance to the route's road (its segments, not its 10 m sample points) within ~30 m: {d, i, y} or null. */
  const routeDist = (x, z) => {
    let best = null;
    for (const i of nearbyRoute(x, z)) {
      for (const j of [i - 1, i]) {
        if (j < 0 || j >= end) continue;
        const ax = index.xs[j], az = index.zs[j], dx = index.xs[j + 1] - ax, dz = index.zs[j + 1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        if (!best || d < best.d) best = { d, i: j, y: route.ele[j] + (route.ele[j + 1] - route.ele[j]) * t };
      }
    }
    return best;
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
  // The ground follows the city's streets: under a street and its sidewalks it sits just below the ribbon
  // (streets are drawn level from side to side), easing back to the terrain over the next ~10 m. Without this,
  // on a hillside the uphill half of a street disappears under the grass.
  let streetIndex = null, buildingStreets = false;
  const streetAt = (x, z, extra = 0, skip = -1) => {
    if (!streetIndex) {
      if (buildingStreets) return null;
      buildingStreets = true;
      const streets = cityStreets(L, index, route);
      streetIndex = new Map();
      streets.forEach((st, k) => {
        for (let i = 1; i < st.pts.length; i++) {
          const a = st.pts[i - 1], b = st.pts[i], r = st.width / 2 + 14;
          for (let gx = Math.floor((Math.min(a.x, b.x) - r) / 24); gx <= Math.floor((Math.max(a.x, b.x) + r) / 24); gx++)
            for (let gz = Math.floor((Math.min(a.z, b.z) - r) / 24); gz <= Math.floor((Math.max(a.z, b.z) + r) / 24); gz++) {
              const key = `${gx},${gz}`; if (!streetIndex.has(key)) streetIndex.set(key, []); streetIndex.get(key).push([k, i]);
            }
        }
      });
      streetIndex.streets = streets;
      buildingStreets = false;
    }
    let best = null;
    for (const [k, i] of streetIndex.get(`${Math.floor(x / 24)},${Math.floor(z / 24)}`) || []) {
      if (k === skip) continue;
      const st = streetIndex.streets[k], a = st.pts[i - 1], b = st.pts[i];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z), edge = d - st.width / 2;
      if (edge < extra && (!best || edge < best.edge)) best = { st, k, d, edge, y: a.y + (b.y - a.y) * t };
    }
    return best;
  };
  /** Every street whose carriageway comes within `extra` of (x, z): [{k, edge}] (one per street). */
  const streetsNear = (x, z, extra = 0) => {
    if (!streetIndex) streetAt(x, z);
    const out = new Map();
    for (const [k, i] of streetIndex?.get(`${Math.floor(x / 24)},${Math.floor(z / 24)}`) || []) {
      const st = streetIndex.streets[k], a = st.pts[i - 1], b = st.pts[i];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const edge = Math.hypot(a.x + dx * t - x, a.z + dz * t - z) - st.width / 2;
      if (edge < extra && (!out.has(k) || edge < out.get(k).edge)) out.set(k, { k, edge, y: a.y + (b.y - a.y) * t });
    }
    return [...out.values()];
  };
  const heightAt = (x, z) => {
    let h = routeHeightAt(x, z);
    if (buildingStreets) return h;
    // Flat for 6.5 m past the carriageway (sidewalks reach 2.5 m; one more ground-mesh cell so the 6 m mesh
    // can't drag a hillside over it), easing back to the terrain by 18 m. Where streets overlap at different
    // heights (a ramp beside a street), follow the lowest, so none is buried.
    const flat = 6.5, around = streetsNear(x, z, 18).filter((o) => !streetIndex.streets[o.k].bridge);
    if (around.length) {
      let target = Infinity, edge = Infinity;
      for (const o of around) {
        edge = Math.min(edge, o.edge);
        if (o.edge < flat) target = Math.min(target, o.y - .1);
      }
      if (target === Infinity) target = around.reduce((a, b) => (a.edge < b.edge ? a : b)).y - .1;
      // the route's own road wins: no street grading under it, easing in beyond its shoulders
      const r = routeDist(x, z), byRoute = r ? smoothstep(ROAD_WIDTH / 2 + 2, 13, r.d) : 1;
      h += (target - h) * (1 - smoothstep(flat, 18, edge)) * byRoute;
      if (r && r.d < 9) h = Math.min(h, r.y - .5 + Math.max(0, r.d - 5) * .2);   // never over the route's own road
    }
    return h;
  };
  const routeHeightAt = (x, z) => {
    let h = baseHeight(x, z);
    const road = index.nearest(x, z, 60);
    if (road) {
      const i = outbound(road.i), s = route.dist[i];
      const bridge = onRouteBridge(s, 6);
      if (!bridge) h += (roadEle(i, x, z) - .5 - h) * (1 - smoothstep(13, 60, road.d));
      else {
        if (road.d < 14) h = Math.min(h, route.ele[i] - 2.5);   // keep the ground under a deck
        // a stretch of the route that passes under this deck (the North Shore Trail under the Clemente ramp)
        let under = null;
        for (const j of nearbyRoute(x, z)) {
          if (onRouteBridge(route.dist[j], 6)) continue;
          const dj = Math.hypot(index.xs[j] - x, index.zs[j] - z);
          if (dj < 20 && (!under || dj < under.d)) under = { j, d: dj };
        }
        if (under) h += (roadEle(under.j, x, z) - .5 - h) * (1 - smoothstep(13, 20, under.d));
      }
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

  // Distance to the rivers (negative over the water) on the 24 m height grid, plus the ground height there:
  // what the weather's fog bank needs to lie on the rivers and reach up the valleys (the "river fog").
  let riverField = null;
  const rivers = () => {
    if (riverField) return riverField;
    const nx = D.nx, nz = D.ny, dx = (D.x1 - D.x0) / (nx - 1), dz = (D.z1 - D.z0) / (nz - 1), cell = (dx + dz) / 2;
    const wet = new Uint8Array(nx * nz), far = 1e9;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) wet[j * nx + i] = waterAt(D.x0 + i * dx, D.z0 + j * dz) > .5 ? 1 : 0;
    // two-pass chamfer distance, once to the water (for land) and once to the land (for water)
    const chamfer = (src) => {
      const d = new Float32Array(nx * nz);
      for (let k = 0; k < d.length; k++) d[k] = src[k] ? 0 : far;
      const a = cell, b = cell * Math.SQRT2;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) { v = Math.min(v, d[k - nx] + a); if (i > 0) v = Math.min(v, d[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b); }
        d[k] = v;
      }
      for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i; let v = d[k];
        if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
        if (j < nz - 1) { v = Math.min(v, d[k + nx] + a); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b); if (i > 0) v = Math.min(v, d[k + nx - 1] + b); }
        d[k] = v;
      }
      return d;
    };
    const toWater = chamfer(wet), toLand = chamfer(wet.map((w) => 1 - w));
    const field = new Float32Array(nx * nz), ground = new Float32Array(nx * nz);
    for (let k = 0; k < field.length; k++) {
      field[k] = wet[k] ? -toLand[k] : toWater[k];
      ground[k] = baseHeight(D.x0 + (k % nx) * dx, D.z0 + Math.floor(k / nx) * dz);
    }
    return (riverField = { nx, nz, x0: D.x0, z0: D.z0, dx, dz, field, ground });
  };
  const riverDistance = (x, z) => {
    const R = rivers(), u = (x - R.x0) / R.dx, v = (z - R.z0) / R.dz;
    if (u < 0 || v < 0 || u > R.nx - 1 || v > R.nz - 1) return 1e4;
    const i = Math.min(R.nx - 2, Math.floor(u)), j = Math.min(R.nz - 2, Math.floor(v)), a = u - i, b = v - j, F = R.field, n = R.nx;
    return (F[j * n + i] * (1 - a) + F[j * n + i + 1] * a) * (1 - b) + (F[(j + 1) * n + i] * (1 - a) + F[(j + 1) * n + i + 1] * a) * b;
  };

  const L = {
    kind: 'city', city: true, data, decoded: D, level, hasOcean: false, coastSide: 1,
    coast: [{ x: -1e5, z: 0 }, { x: -1e5, z: 1 }], coastX: () => -1e5, inlandAt: () => 1e4,
    lakes: [], waterIslands: [], creeks: [], creekAt: () => null, landmarks,
    heightAt, baseHeight, terrainAt, bridgeAt, waterLevelAt, landAt: landCell, waterAt, routeKindAt, routeBridges, broad,
    isWater: (x, z, height) => waterAt(x, z) > .35 && height < level + .6,
    colorAt: (x, z) => LAND_COLORS[landCell(x, z)] || null,
    /** Trees and shrubs from the shared kit grow only in parks, woods and the hills beyond. */
    canPlant: (x, z) => { const c = landCell(x, z); return c === LAND.woods || c === LAND.outside || (c === LAND.grass && ((x * 13 + z * 7) & 3) === 0); },
    routeDist, streetAt, streetsNear,
    /** For the weather: fog lies on the rivers (at the water level) and reaches inland up the valleys. */
    fogBase: level, fogField: rivers, fogInlandAt: riverDistance,
    /**
     * The space the rider and the chase camera move through: over the route's road (and a little past its
     * edges), from just above the road surface to 4.1 m up. Nothing else may be drawn there.
     */
    inRouteTube: Object.assign((x, y, z) => {
      const r = routeDist(x, z);
      return !!r && r.d < ROAD_WIDTH / 2 + .6 && y > r.y + .18 && y < r.y + 4.1;
    }, {
      /** Could anything within `reach` of (x, z) be in the tube? (fast pre-check for big meshes) */
      near: (x, z, reach) => { const i = index.nearest(x, z, reach + ROAD_WIDTH / 2 + 12); return !!i; },
    }),
    /** On a street's carriageway or its sidewalks (paths: their width), for keeping scenery off them. */
    onStreet: (x, z, margin = 0) => { const st = streetAt(x, z, 2.6 + margin); return !!st && (st.st.cls !== 8 || st.edge < margin); },
  };
  return L;
}

export const STREET_W = [15, 7.5, 13, 11, 9.5, 7.5, 9, 5, 3.4];   // street width by class (tools/build_city.py)
export const STREET_LIFT = .16;                                     // highest a street ribbon sits above its line

/**
 * The city's streets as drawn: [{cls, bridge, oneway, layer, width, pts: [{x, y, z}]}]. Bridge decks keep their
 * built heights; everything else follows the ground. Where another street runs over or alongside the route
 * (the rest of a bridge's roadway, a ramp, the street the route rides on), it is kept just below the route's
 * own road, so it can never cover the road or the rider. Shared by the renderer and the course QC sweep.
 */
export function cityStreets(landscape, index, route) {
  if (landscape._streets) return landscape._streets;
  const S = landscape.data.streets, D = landscape.decoded;
  const u8 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
  const starts = new Uint32Array(u8(S.starts)), xy = new Int16Array(u8(S.xy)), deck = new Uint16Array(u8(S.deck));
  const end = route.turnIdx || route.dist.length - 1;
  const streets = [];
  for (let k = 0; k < S.count; k++) {
    const cls = S.meta[k * 3], flags = S.meta[k * 3 + 1], layer = S.meta[k * 3 + 2] - 8;
    const bridge = !!(flags & 1), oneway = (flags >> 1) - 1, width = STREET_W[cls];
    const raw = [];
    for (let i = starts[k]; i < starts[k + 1]; i++) {
      const p = D.local(xy[i * 2], xy[i * 2 + 1]);
      p.y = bridge && deck[i] ? 150 + deck[i] / 10 : null;
      raw.push(p);
    }
    const pts = [raw[0]], step = bridge ? 6 : 7;
    let under = false;
    for (let j = 1; j < raw.length; j++) {
      const a = raw[j - 1], b = raw[j], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
      for (let m = 1; m <= n; m++) { const f = m / n; pts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y != null && b.y != null ? a.y + (b.y - a.y) * f : null }); }
    }
    for (const p of pts) {
      if (p.y == null) p.y = landscape.heightAt(p.x, p.z);
      const r = index.nearest(p.x, p.z, width / 2 + ROAD_WIDTH / 2 + 2);
      if (!r || r.d > width / 2 + ROAD_WIDTH / 2 + 1.5) continue;
      const i = r.i > end ? Math.max(0, 2 * end - r.i) : r.i, e = route.ele[i];
      if (p.y > e - 4 && p.y < e + 4 && p.y > e - .18) { p.y = e - .12 - STREET_LIFT + .1; under = true; }
    }
    streets.push({ cls, bridge, oneway, layer, pts, width, underRoute: under });
  }
  landscape._streets = streets;
  return streets;
}
