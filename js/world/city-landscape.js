// City ground for the stylized renderer: real terrain (a height grid sampled from the same
// terrain tiles), the rivers and land use from OpenStreetMap, and the GPX road pressed into it.
// Pure functions — no three.js — so the QC sweep and tests can use it in Node.
// Data: "bikefree-city-1", built by tools/build_city.py. With a real height grid as well (the scene's
// `terrainGridFile`, tools/build_terrain_grid.py in rivers mode) the ground is 10 m elevation along the route
// and 40 m out to ~9 km, and the rivers beyond the city's own box come from that grid's river mask.
import { makeRouteIndex } from './geo.js';
import { smoothstep } from './coast.js';
import { ROAD_WIDTH } from './pose.js';
import { decodeTerrain } from './real-coast.js';
import { planJunctions, junctionGround, junctionTops } from './junctions.js';   // [junctions]
import { joinCrossings, densifyAlongside, clearOverpasses, alignAlongRoute, trimAtRoute, followMovedNodes, keepUnderRoad, resolveOverlaps, streetSlots } from './road-meets.js';   // [junctions]
import { alignStreetProfiles, syncPinnedNodes } from './road-align.js';   // [road-align]
import { makeStreetGrade } from './street-grade.js';   // [street-kit]
import { riverfrontGround } from './riverfront.js';   // [s1-riverfront]

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
  const T = config.terrainGrid ? decodeTerrain(config.terrainGrid, proj) : null;
  const terrainAt = T ? T.at : (x, z) => gridH((x - D.x0) / (D.x1 - D.x0) * (D.nx - 1), (z - D.z0) / (D.z1 - D.z0) * (D.ny - 1));
  // the outer river mask (20 m) beyond the city's land grid
  const OW = T && config.terrainGrid.water ? (() => {
    const W = config.terrainGrid.water, m = new Uint8Array(W.nx * W.ny);
    for (let i = 0, k = 0; i < W.rle.length; i += 2) { m.fill(W.rle[i], k, k + W.rle[i + 1]); k += W.rle[i + 1]; }
    return { ...W, m, x0: T.x0, z0: T.z0, sx: (W.nx - 1) / (T.x1 - T.x0), sz: (W.ny - 1) / (T.z1 - T.z0) };
  })() : null;
  const outerWater = (x, z) => {
    if (!OW) return 0;
    const u = (x - OW.x0) * OW.sx, v = (z - OW.z0) * OW.sz;
    if (u < 0 || v < 0 || u >= OW.nx - 1 || v >= OW.ny - 1) return 0;
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, M = OW.m, n = OW.nx;
    return (M[j * n + i] * (1 - a) + M[j * n + i + 1] * a) * (1 - b) + (M[(j + 1) * n + i] * (1 - a) + M[(j + 1) * n + i + 1] * a) * b;
  };
  // The map draws bridge decks over the rivers as paved land, so the rivers were cut into pieces at every bridge
  // (and the ground under each bridge sat at the water's level). Close the water across those gaps: dilate it by
  // three cells (~36 m) and erode it back, so deck-wide breaks fill and real shorelines stay where they were.
  {
    const nx = D.lx, ny = D.ly, Lg = D.land, R = 3, wet = new Uint8Array(nx * ny), grow = new Uint8Array(nx * ny);
    for (let k = 0; k < wet.length; k++) wet[k] = Lg[k] === LAND.water ? 1 : 0;
    const sweep = (src, dst, want) => {   // separable square max (want 1) / min (want 0) filter
      const tmp = new Uint8Array(src.length);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let v = 1 - want; for (let u = Math.max(0, i - R); u <= Math.min(nx - 1, i + R); u++) if (src[j * nx + u] === want) { v = want; break; }
        tmp[j * nx + i] = v;
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let v = 1 - want; for (let w = Math.max(0, j - R); w <= Math.min(ny - 1, j + R); w++) if (tmp[w * nx + i] === want) { v = want; break; }
        dst[j * nx + i] = v;
      }
    };
    sweep(wet, grow, 1);
    const closed = new Uint8Array(nx * ny); sweep(grow, closed, 0);
    for (let k = 0; k < closed.length; k++) if (closed[k] && !wet[k] && Lg[k] !== LAND.building) Lg[k] = LAND.water;
  }
  const landCell = (x, z) => {
    const u = Math.round((x - D.x0) / (D.x1 - D.x0) * (D.lx - 1)), v = Math.round((z - D.z0) / (D.z1 - D.z0) * (D.ly - 1));
    if (u < 0 || v < 0 || u >= D.lx || v >= D.ly) return outerWater(x, z) > .5 ? LAND.water : LAND.outside;
    return D.land[v * D.lx + u];
  };
  // Water fraction, bilinear over the land grid: soft banks instead of 12 m steps.
  const waterAt = (x, z) => {
    const u = (x - D.x0) / (D.x1 - D.x0) * (D.lx - 1), v = (z - D.z0) / (D.z1 - D.z0) * (D.ly - 1);
    if (u < 0 || v < 0 || u >= D.lx - 1 || v >= D.ly - 1) return outerWater(x, z);
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, L = D.land, n = D.lx, w = (k) => (L[k] === LAND.water ? 1 : 0);
    return (w(j * n + i) * (1 - a) + w(j * n + i + 1) * a) * (1 - b) + (w((j + 1) * n + i) * (1 - a) + w((j + 1) * n + i + 1) * a) * b;
  };

  // Route bridges (from OSM) as distance ranges along the outbound road.
  const routeBridges = (data.routeBridges || []).map((b) => ({ ...b, toM: Math.min(b.toM, route.turnS || route.total) }));
  const onRouteBridge = (s, margin = 0) => routeBridges.find((b) => s > b.fromM - margin && s < b.toM + margin);
  routeBridges.push(...underpasses());
  routeBridges.sort((a, b) => a.fromM - b.fromM);

  /**
   * Streets that pass under the route where it runs on an embankment (no bridge in the map data): the street's
   * ground on both sides of the route lies more than 4 m below the road, or a ramp's deck runs 2.5 m or more
   * below it. Each gets a short girder span, so the
   * ground opens under the route and the street runs through instead of vanishing into the bank.
   */
  function underpasses() {
    const S = data.streets;
    if (!S) return [];
    const u8 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
    const starts = new Uint32Array(u8(S.starts)), xy = new Int16Array(u8(S.xy)), deck = new Uint16Array(u8(S.deck));
    const found = [];
    for (let k = 0; k < S.count; k++) {
      const onDeck = !!(S.meta[k * 3 + 1] & 1);   // a ramp or viaduct: its own deck heights
      const w = STREET_W[S.meta[k * 3]], pts = [];
      for (let i = starts[k]; i < starts[k + 1]; i++) {
        const p = D.local(xy[i * 2], xy[i * 2 + 1]);
        p.y = onDeck && deck[i] ? 150 + deck[i] / 10 : null;
        if (pts.length) {
          const q = pts[pts.length - 1], n = Math.ceil(Math.hypot(p.x - q.x, p.z - q.z) / 3);
          for (let m = 1; m < n; m++) pts.push({ x: q.x + (p.x - q.x) * m / n, z: q.z + (p.z - q.z) * m / n, y: p.y != null && q.y != null ? q.y + (p.y - q.y) * m / n : null });
        }
        pts.push(p);
      }
      if (onDeck && pts.some((p) => p.y == null)) continue;
      let along = 0;
      pts.forEach((p, j) => { if (j) along += Math.hypot(p.x - pts[j - 1].x, p.z - pts[j - 1].z); p.a = along; });
      for (let j = 0; j < pts.length; j++) {
        const r = index.nearest(pts[j].x, pts[j].z, w / 2 + ROAD_WIDTH / 2 + 1);
        if (!r || r.i > end) continue;
        const s = route.dist[r.i], ele = route.ele[r.i];
        if (s < 30 || s > route.dist[end] - 30 || routeBridges.some((b) => s > b.fromM - 10 && s < b.toM + 10) || found.some((f) => Math.abs(f.s - s) < 25)) continue;
        // the street 12–30 m either side of the crossing
        const side = (sign) => {
          let low = Infinity;
          for (const q of pts) { const d = (q.a - pts[j].a) * sign; if (d > 12 && d < 30) low = Math.min(low, terrainAt(q.x, q.z)); }
          return low;
        };
        // a deck at least 2.5 m under the road passes beneath it; a street on the ground needs the ground on
        // both sides well below the road (otherwise it climbs to meet the route at an ordinary junction)
        // (an embankment shows in the bare-earth ground under the road; where it doesn't, the road's own height
        // is off from the ground — no underpass)
        const bank = terrainAt(index.xs[r.i], index.zs[r.i]) > ele - 2;
        if (onDeck ? ele - pts[j].y > 2.5 : bank && ele - side(1) > 4 && ele - side(-1) > 4) found.push({ s, w });
        j += 8;
      }
    }
    return found.map(({ s, w }) => ({ name: 'Underpass', fromM: Math.max(0, s - w / 2 - 4), toM: s + w / 2 + 4, style: 'girder', underpass: true }));
  }
  const routeKinds = data.routeKinds || [];
  const routeKindAt = (s) => (routeKinds.find((k) => s >= k.fromM && s < k.toM) || { kind: 'road' }).kind;

  // Walled shores: where an urban bank (streets, plazas, buildings, lawns) stands well above the water, the shore
  // is a river wall (drawn by the city), so the ground steps down at the waterline instead of sloping in.
  let walled = null;
  const URBAN = new Set([LAND.paved, LAND.grass, LAND.building, LAND.plaza]);
  const shoreWalls = () => {
    if (walled) return walled;
    const nx = D.lx, ny = D.ly, L = D.land, dx = (D.x1 - D.x0) / (nx - 1), dz = (D.z1 - D.z0) / (ny - 1);
    walled = new Uint8Array(nx * ny);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (L[k] === LAND.water || !URBAN.has(L[k])) continue;
      let shore = false;
      for (let v = -1; v <= 1 && !shore; v++) for (let u = -1; u <= 1; u++) if (L[k + v * nx + u] === LAND.water) { shore = true; break; }
      if (!shore) continue;
      // the bank ~2 cells inland must stand 1.5 m over the water
      let top = -Infinity;
      for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const q = (j + v) * nx + i + u; if (q >= 0 && q < L.length && L[q] !== LAND.water) top = Math.max(top, terrainAt(D.x0 + (i + u) * dx, D.z0 + (j + v) * dz)); }
      if (top > level + 1.5) walled[k] = 1;
    }
    return walled;
  };
  const wallAt = (x, z) => {
    const W = shoreWalls(), u = Math.round((x - D.x0) / (D.x1 - D.x0) * (D.lx - 1)), v = Math.round((z - D.z0) / (D.z1 - D.z0) * (D.ly - 1));
    if (u < 1 || v < 1 || u >= D.lx - 1 || v >= D.ly - 1) return false;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (W[(v + b) * D.lx + u + a]) return true;
    return false;
  };
  const baseHeight = (x, z) => {
    let h = terrainAt(x, z);
    const wet = waterAt(x, z);
    if (wet > 0) {
      const walledHere = wallAt(x, z);
      // behind a wall the bank keeps its height right to the waterline (and at least 1 m over the water)
      if (walledHere && wet < .5) h = Math.max(h, level + 1);
      h += (Math.min(h, level - 4.5) - h) * (walledHere ? smoothstep(.42, .58, wet) : smoothstep(.05, .7, wet));
    }
    // never level with the water (the rivers are hydro-flattened in the elevation, so the banks run out flat
    // at exactly the water level): kept 35 cm above or 60 cm below, so the shoreline is a steep crossing rather
    // than ground lying a few centimetres from the water across a whole cell (that flickers)
    if (h > level - .6 && h < level + .35) h = h >= level - .1 ? level + .35 : level - .6;
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
  const grade = makeStreetGrade(config, { data, decoded: D, route, index, outbound, routeKindAt, onRouteBridge, routeDist });   // [street-kit] main-street cross-section
  const heightAt = (x, z) => {
    let h = routeHeightAt(x, z);
    if (buildingStreets) return h;
    // Flat for 6.5 m past the carriageway (sidewalks reach 2.5 m; one more ground-mesh cell so the 6 m mesh
    // can't drag a hillside over it), easing back to the terrain by 18 m. Where streets overlap at different
    // heights (a ramp beside a street), follow the lowest, so none is buried.
    const flat = 6.5, around = streetsNear(x, z, 18).filter((o) => !streetIndex.streets[o.k].bridge);
    if (around.length) {
      let target = Infinity, edge = Infinity, ride = Infinity;
      for (const o of around) {
        edge = Math.min(edge, o.edge);
        if (o.edge < flat) target = Math.min(target, o.y - .1);
        if (o.edge < 2.5 && streetIndex.streets[o.k].rides) ride = Math.min(ride, o.y - .1);   // [road-align] rides
      }
      if (target === Infinity) target = around.reduce((a, b) => (a.edge < b.edge ? a : b)).y - .1;
      // the route's own road wins: no street grading under it, easing in beyond its shoulders — except under the
      // street the route rides on, which lies just under the road and is wider than it ([road-align] rides)
      const r = routeDist(x, z), byRoute = r ? smoothstep(ROAD_WIDTH / 2 + 2, 13, r.d) : 1;
      h += (target - h) * (1 - smoothstep(flat, 18, edge)) * byRoute;
      if (ride < Infinity) h += (ride - h) * (1 - byRoute);
      if (r && r.d < 9) h = Math.min(h, r.y - .5 + Math.max(0, r.d - 5) * .2);   // never over the route's own road
    }
    // [junctions] round a junction: just under its surface and corner sidewalks (but still never over the route's road)
    if (L._junctions) {
      const r = routeDist(x, z);
      const w = r ? smoothstep(ROAD_WIDTH / 2 + 1, ROAD_WIDTH / 2 + 7, r.d) : 1;   // (under the road and its shoulder: the road's bank)
      if (w > 0) h += (junctionGround(L._junctions, x, z, h) - h) * w;
      if (r && r.d < 9) h = Math.min(h, r.y - .5 + Math.max(0, r.d - 5) * .2);
    }
    if (grade) h = grade(x, z, h, routeDist(x, z));   // [street-kit] (after [junctions]: it fades out near other streets, so junctions keep their grading) sidewalk-level ground beside a kit zone's curbs
    // nor over a low ramp or viaduct deck (they're left out of the grading above, but one running close to the
    // ground beside the route would otherwise be buried by the bank the route's road raises)
    const own = routeDist(x, z);
    if (!own || own.d > 9) {   // (near the route's own road its bank wins: the ground mesh can't step that fast)
      for (const o of streetsNear(x, z, 1.5)) if (streetIndex.streets[o.k].bridge && h > o.y - .35) h = Math.min(h, o.y - .35);
    }
    // nor, after all that grading, near the water's level (the route's riverside trail around the Point presses
    // the ground to exactly the water's level)
    if (h > level - .6 && h < level + .35) h = h >= level - .1 ? level + .35 : level - .6;
    return h;
  };
  // [road-align] how far the ground eases towards the route's road (a route that follows its own ground needs less)
  const bankM = config.roadAlign?.bankM ?? 60;
  const routeHeightAt = (x, z) => {
    let h = baseHeight(x, z);
    const road = index.nearest(x, z, 60);
    if (road) {
      const i = outbound(road.i), s = route.dist[i];
      const bridge = onRouteBridge(s, 6);
      if (!bridge) h += (roadEle(i, x, z) - .5 - h) * (1 - smoothstep(13, bankM, road.d));   // [road-align] bankM
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
    const B = T ? { x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1, step: 40 } : { x0: D.x0, z0: D.z0, x1: D.x1, z1: D.z1, step: (D.x1 - D.x0) / (D.nx - 1) };
    const nx = Math.round((B.x1 - B.x0) / B.step) + 1, nz = Math.round((B.z1 - B.z0) / B.step) + 1;
    const dx = (B.x1 - B.x0) / (nx - 1), dz = (B.z1 - B.z0) / (nz - 1), cell = (dx + dz) / 2, X0 = B.x0, Z0 = B.z0;
    const wet = new Uint8Array(nx * nz), far = 1e9;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) wet[j * nx + i] = waterAt(X0 + i * dx, Z0 + j * dz) > .5 ? 1 : 0;
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
      ground[k] = baseHeight(X0 + (k % nx) * dx, Z0 + Math.floor(k / nx) * dz);
    }
    return (riverField = { nx, nz, x0: X0, z0: Z0, dx, dz, field, ground });
  };
  const riverDistance = (x, z) => {
    const R = rivers(), u = (x - R.x0) / R.dx, v = (z - R.z0) / R.dz;
    if (u < 0 || v < 0 || u > R.nx - 1 || v > R.nz - 1) return 1e4;
    const i = Math.min(R.nx - 2, Math.floor(u)), j = Math.min(R.nz - 2, Math.floor(v)), a = u - i, b = v - j, F = R.field, n = R.nx;
    return (F[j * n + i] * (1 - a) + F[j * n + i + 1] * a) * (1 - b) + (F[(j + 1) * n + i] * (1 - a) + F[(j + 1) * n + i + 1] * a) * b;
  };

  // [s4-section] yard trees in hillside neighbourhoods: scene `vegetation.yardTrees` = {kitDensity, boxes: [[s, w, n, e]…]}
  // (lat/lon; no boxes: every yard): the share of yard spots that take the shared kit's trees (in its grove patches);
  // the city keeps them clear of its buildings and adds its own light trees on a grid (city.js `_trees`).
  const YT = config.vegetation?.yardTrees, ytBoxes = (YT?.boxes || []).map(([s, w, n, e]) => {
    const a = proj.toLocal(s, w), b = proj.toLocal(n, e);
    return [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z)];
  });
  const yardTree = (x, z) => !!YT && (!ytBoxes.length || ytBoxes.some((b) => x > b[0] && x < b[1] && z > b[2] && z < b[3]))
    && ((h) => h - Math.floor(h))(Math.sin(x * 4.1414 + z * 91.7171) * 24634.6345) < (YT.kitDensity ?? .5);
  const L = {
    kind: 'city', city: true, data, decoded: D, level, wallAt, shoreWalls, outer: OW && { x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1, water: outerWater, mask: OW }, hasOcean: false, coastSide: 1,
    coast: [{ x: -1e5, z: 0 }, { x: -1e5, z: 1 }], coastX: () => -1e5, inlandAt: () => 1e4,
    lakes: [], waterIslands: [], creeks: [], creekAt: () => null, landmarks,
    heightAt, baseHeight, terrainAt, bridgeAt, waterLevelAt, landAt: landCell, waterAt, routeKindAt, routeBridges, broad,
    isWater: (x, z, height) => waterAt(x, z) > .35 && height < level + .6,
    colorAt: (x, z) => LAND_COLORS[landCell(x, z)] || null,
    /** Trees and shrubs from the shared kit grow only in parks, woods and the hills beyond. */
    canPlant: (x, z) => { const c = landCell(x, z); return c === LAND.woods || c === LAND.outside || (c === LAND.grass && ((x * 13 + z * 7) & 3) === 0) || (c === LAND.yards && yardTree(x, z)); },   // [s4-section] yards
    routeDist, streetAt, streetsNear,
    junctions: config.junctions || null,   // [junctions] scene key: real intersection geometry (js/world/junctions.js)
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
  // [s1-riverfront] promenade walls along the route (scene "riverfront"): the ground past them under the water
  if (config.riverfront) riverfrontGround(L, { route, index, config: config.riverfront, streets: () => (streetAt(0, 0), streetIndex.streets) });
  return L;
}

export const STREET_W = [15, 7.5, 13, 11, 9.5, 7.5, 9, 5, 3.4];   // street width by class (tools/build_city.py)
export const STREET_LIFT = .24;                                     // highest a street ribbon sits above its line

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
  const streets = [], align = route.scene?.roadAlign;
  // a street point over or beside the route's road, near its height, is kept just below the road (pinned there)
  // [road-align] `along`: the street runs along the route there and the route's centre line lies inside its
  // carriageway — it is the street the route rides on (the other half of a mapped dual carriageway, or a way
  // mapped a few metres off), so it is pinned even when the ground left it lower: drawn 0.3–2 m below the road
  // and offset sideways, its outer half showed beside the road and z-fought the route's bank (McArdle, 12.1 km)
  const lower = (p, width, along = false) => {
    const r = index.nearest(p.x, p.z, width / 2 + ROAD_WIDTH / 2 + 2);
    if (!r || r.d > width / 2 + ROAD_WIDTH / 2 + 1.5) return false;
    const i = r.i > end ? Math.max(0, 2 * end - r.i) : r.i;
    // [road-align] the road's height interpolated along the route (the nearest 10 m sample's left steps of up to
    // 0.8 m in streets pinned along the route)
    const rd = align && landscape.routeDist?.(p.x, p.z), e = rd && Math.abs(rd.y - route.ele[i]) < 3 ? rd.y : route.ele[i];
    const low = along && r.d < width / 2 ? e - 2.5 : e - .18;
    if (p.y > e - 4 && p.y < e + 4 && p.y > low) { p.y = e - .12 - STREET_LIFT + .1; p.pin = true; if (along && r.d < width / 2) p.along = true; return true; }   // [road-align] pin
    return false;
  };
  // [road-align] is this street running along the route at point j (within ~20°)?
  const alongRoute = (pts, j) => {
    if (!align?.streets) return false;
    const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)], r = index.nearest(pts[j].x, pts[j].z, 12);
    if (!r) return false;
    const i = Math.min(index.xs.length - 2, r.i), dx = index.xs[i + 1] - index.xs[i], dz = index.zs[i + 1] - index.zs[i];
    const sx = b.x - a.x, sz = b.z - a.z, l = Math.hypot(dx, dz) * Math.hypot(sx, sz);
    return l > 0 && Math.abs(dx * sx + dz * sz) / l > .94;
  };
  for (let k = 0; k < S.count; k++) {
    const cls = S.meta[k * 3], flags = S.meta[k * 3 + 1], layer = S.meta[k * 3 + 2] - 8;
    const bridge = !!(flags & 1), oneway = (flags >> 1) - 1, width = STREET_W[cls];
    const raw = [];
    for (let i = starts[k]; i < starts[k + 1]; i++) {
      const p = D.local(xy[i * 2], xy[i * 2 + 1]);
      p.y = bridge && deck[i] ? 150 + deck[i] / 10 : null;
      raw.push(p);
    }
    const pts = [raw[0]], step = bridge ? 6 : 7, nodeIdx = [0];
    let under = false;
    for (let j = 1; j < raw.length; j++) {
      const a = raw[j - 1], b = raw[j], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
      for (let m = 1; m <= n; m++) { const f = m / n; pts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y != null && b.y != null ? a.y + (b.y - a.y) * f : null }); }
      nodeIdx.push(pts.length - 1);   // [junctions]
    }
    pts.forEach((p, j) => {
      if (p.y == null) p.y = landscape.heightAt(p.x, p.z);
      if (lower(p, width, !bridge && alongRoute(pts, j))) under = true;   // [road-align] along
    });
    streets.push({ cls, bridge, oneway, layer, pts, width, underRoute: under, rides: width > ROAD_WIDTH + 1 && pts.some((p) => p.along),   // [road-align] rides (wider than the road: sticks out)
      nodes: raw, nodeIdx });   // [junctions] OSM nodes → pts index
  }
  // [road-align] smooth, grade-limited street profiles with one height per junction (js/world/road-align.js)
  if (align?.streets) {
    const nearRoute = (x, z) => { const r = index.nearest(x, z, 24); return r ? 1 - smoothstep(12, 22, r.d) : 0; };
    alignStreetProfiles(streets, { ...align, ground: landscape.baseHeight, nearRoute, floor: landscape.level + .6 });
    for (const st of streets) st.pts.forEach((p, j) => { if (lower(p, st.width, !st.bridge && alongRoute(st.pts, j))) st.underRoute = true; });
    syncPinnedNodes(streets);
  }
  landscape._streets = streets;
  // [junctions] real intersection geometry: street heights inside junctions, trims, the junction surfaces
  if (landscape.junctions) {
    joinCrossings(streets);   // [junctions] streets crossing at one level with no shared node: give them one
    densifyAlongside(streets);   // [junctions] (finer points where carriageways run side by side, for the trims below)
    clearOverpasses(streets, { route, index, roadWidth: ROAD_WIDTH });   // [junctions] decks over the road clear the rider
    alignAlongRoute(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] streets alongside the road: flush with it
    trimAtRoute(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] …or beside it at another level: kept off its shoulder
    resolveOverlaps(streets, landscape);   // [junctions] [w2-meets] carriageways side by side or merging: drawn as their union (gores)
    landscape._junctions = planJunctions(streets, { route, index, end, routeDist: landscape.routeDist, roadWidth: ROAD_WIDTH,
      onRouteBridge: (s, m) => landscape.routeBridges.some((b) => s > b.fromM - m && s < b.toM + m), liftOf: (k) => .1 + streetSlots(landscape, streets)[k] * .02 }, landscape.junctions);
    keepUnderRoad(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] nothing over the road
    followMovedNodes(streets);   // [junctions] paths, side streets and decks meet the moved ones at their height
    resolveOverlaps(streets, landscape, { final: true });   // [w2-meets] again: heights moved since (decks and their links)
    keepUnderRoad(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] (and still nothing over the road)
    junctionTops(landscape._junctions, streets, landscape.routeDist, ROAD_WIDTH);   // [junctions] mouths at the streets' final heights
  }
  return streets;
}
