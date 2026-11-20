// City ground for the stylized renderer: real terrain (a height grid sampled from the same
// terrain tiles), the rivers and land use from OpenStreetMap, and the GPX road pressed into it.
// Pure functions — no three.js — so the QC sweep and tests can use it in Node.
// Data: "bikefree-city-1", built by tools/build_city.py. With a real height grid as well (the scene's
// `terrainGridFile`, tools/build_terrain_grid.py in rivers mode) the ground is 10 m elevation along the route
// and 40 m out to ~9 km, and the rivers beyond the city's own box come from that grid's river mask.
import { makeGlasshousePads } from '../structures/glasshouse.js';
import { ghostMask } from '../../ghost.js';
import { makeRouteIndex } from '../../geo.js';
import { smoothstep } from '../core/random.js';
import { ROAD_WIDTH } from '../../pose.js';
import { decodeTerrain } from '../landscape/real-terrain.js';
import { planJunctionsJob, junctionGround, junctionTopsJob } from './junctions.js';   // [junctions]
import { joinCrossingsJob, densifyAlongsideJob, clearOverpassesJob, alignAlongRouteJob, trimAtRouteJob, followMovedNodesJob, keepUnderRoadJob, resolveOverlapsJob, hideCrossingsAtRouteJob, landFreeDeckEndsJob, streetSlots, dropCutStubsJob } from './road-meets.js';   // [junctions] ([F30] as jobs)
import { alignStreetProfilesJob, syncPinnedNodesJob } from '../../road-align.js';   // [road-align]
import { drain, due } from '../core/jobs.js';   // [F30] the city's streets are built as a job (in frame slices on the ride)
import { makeStreetGrade } from './street-grade.js';   // [street-kit]
import { riverfrontGroundJob } from './riverfront.js';   // [s1-riverfront]

// [6.5] pond: hill water at its own level (the city data's "ponds", build_city.py): not the rivers' water
export const LAND = { paved: 0, grass: 1, woods: 2, water: 3, building: 4, sand: 5, plaza: 6, outside: 7, yards: 8, pond: 9 };
const LAND_COLORS = ['#8d8a84', '#77985a', '#4d6a3a', '#6c6a5e', '#7d786f', '#b5a684', '#b4ada0', '#6d8252', '#7c8c5f', '#6f7a58'];
/** [6.5] (F131) How a pond's bank is built, by kind: `rim` the bank's top over the water, `wall` a stone edge (a
 *  reservoir's or a basin's coping) rather than a sloping earth bank. */
export const POND_KINDS = {
  reservoir: { rim: .55, wall: true }, fountain: { rim: .45, wall: true }, pool: { rim: .45, wall: true }, pond: { rim: .3, wall: false },
};
/** The ground a pond holds (metres out from its edge): raised to its bank, easing back to the hillside. */
export const POND_BANK_M = 9;

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
  // [6.5] (F131) hill water: each pond's ring in local metres, its level, kind and box
  const ponds = (data.ponds || []).map((p, k) => {
    const ring = p.ring.map(([a, o]) => local(a, o));
    let area = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a.x * b.z - b.x * a.z; }
    if (area < 0) ring.reverse();   // counter-clockwise in (x, z): the outward normal of edge a→b is (dz, -dx)
    const xs = ring.map((q) => q.x), zs = ring.map((q) => q.z);
    return { k, name: p.name || '', kind: POND_KINDS[p.kind] ? p.kind : 'pond', level: p.level, ring, area: Math.abs(area) / 2,
      x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const decoded = {
    proj, heights, land, ponds, x0: nw.x, z0: nw.z, x1: se.x, z1: se.z, nx: g.nx, ny: g.ny, lx: data.land.nx, ly: data.land.ny,
    base: g.base, scale: g.scale, local,
    /** Polylines/polygons stored as [qlat, qlon] pairs → local {x, z}. */
    points(xy, from, to) { const out = []; for (let i = from; i < to; i++) out.push(local(xy[i * 2], xy[i * 2 + 1])); return out; },
  };
  Object.defineProperty(data, '_decoded', { value: decoded, enumerable: false, configurable: true });
  return decoded;
}

/**
 * [6.5] (F131) A street or path running along a pond (a service road on a reservoir's edge) keeps its carriageway
 * and sidewalks 35 cm over the water, ramping back to its own profile at 8 %; streets sharing a lifted node follow
 * (two passes). The route's road is never moved (its bank rules round it).
 */
function* liftOverPondsJob(streets, landscape) {
  if (!landscape.ponds?.length) return;
  const key = (p) => Math.round(p.x * 100) * 4194304 + Math.round(p.z * 100), need = new Map();
  for (let pass = 0; pass < 2; pass++) {
    for (const st of streets) {
      if (st.bridge || !st.pts.length) continue;
      const P = st.pts, n = P.length, req = new Float64Array(n).fill(-Infinity);
      let any = false;
      for (let i = 0; i < n; i++) {
        const pd = landscape.pondAt(P[i].x, P[i].z, st.width / 2 + 2.6), k = need.get(key(P[i]));
        if (pd && !P[i].pin) { req[i] = pd.p.level + .35; any = true; }
        if (k != null && k > P[i].y + .005) { req[i] = Math.max(req[i], k); any = true; }
      }
      if (!any) continue;
      const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
      for (let i = 1; i < n; i++) req[i] = Math.max(req[i], req[i - 1] - .08 * (s[i] - s[i - 1]));
      for (let i = n - 2; i >= 0; i--) req[i] = Math.max(req[i], req[i + 1] - .08 * (s[i + 1] - s[i]));
      for (let i = 0; i < n; i++) if (req[i] > P[i].y && !P[i].pin) { P[i].y = req[i]; need.set(key(P[i]), Math.max(need.get(key(P[i])) ?? -Infinity, req[i])); }
      if (due()) yield;
    }
  }
}

export function makeCityLandscape(config, proj, index, route) { return drain(makeCityLandscapeJob(config, proj, index, route)); }
/** makeCityLandscape as a job ([F30]): the same build, pausing (between rows, streets…) when its slice is used up. */
export function* makeCityLandscapeJob(config, proj, index, route) {
  const data = config.city;
  if (!data || data.format !== 'bikefree-city-1') throw new Error('City scenery data is missing');
  const D = decodeCity(data, proj);
  const level = data.waterLevelM;
  const end = route.turnIdx || route.dist.length - 1;
  const samples = Array.from({ length: Math.ceil(end / 3) }, (_, i) => i * 3).filter((i) => !ghostMask(route)?.[i]);
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
  const ghost = ghostMask(route);   // (a network tour's repeated stretches are never the route's road here: js/world/ghost.js)
  const nearKey = (i, j) => (i + 32768) * 65536 + (j + 32768);   // [audit-C] numeric cell keys: no string per lookup
  for (let i = 0; i <= end; i++) { if (ghost?.[i] || (ghost?.[i + 1] && i < end)) continue; const k = nearKey(Math.floor(index.xs[i] / 20), Math.floor(index.zs[i] / 20)); if (!near.has(k)) near.set(k, []); near.get(k).push(i); }
  const nearbyRoute = (x, z) => {
    const out = [], cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = near.get(nearKey(cx + a, cz + b)); if (l) for (let q = 0; q < l.length; q++) out.push(l[q]); }
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
    const sweep = function* (src, dst, want) {   // separable square max (want 1) / min (want 0) filter
      const tmp = new Uint8Array(src.length);
      for (let j = 0; j < ny; j++) for (let i = 0, last = nx - 1; i < nx; i++) {
        if (i === last && due()) yield;
        let v = 1 - want; for (let u = Math.max(0, i - R); u <= Math.min(nx - 1, i + R); u++) if (src[j * nx + u] === want) { v = want; break; }
        tmp[j * nx + i] = v;
      }
      for (let j = 0; j < ny; j++) for (let i = 0, last = nx - 1; i < nx; i++) {
        if (i === last && due()) yield;
        let v = 1 - want; for (let w = Math.max(0, j - R); w <= Math.min(ny - 1, j + R); w++) if (tmp[w * nx + i] === want) { v = want; break; }
        dst[j * nx + i] = v;
      }
    };
    yield* sweep(wet, grow, 1);
    const closed = new Uint8Array(nx * ny); yield* sweep(grow, closed, 0);
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

  // [6.5] (F131) Hill water: the pond at (x, z) or within `band` of its edge — {p, d}: d the distance to its edge,
  // positive inside (the ponds on a 32 m grid of their boxes and banks)
  const pondGrid = new Map();
  for (const p of D.ponds) {
    for (let gx = Math.floor((p.x0 - POND_BANK_M) / 32); gx <= Math.floor((p.x1 + POND_BANK_M) / 32); gx++)
      for (let gz = Math.floor((p.z0 - POND_BANK_M) / 32); gz <= Math.floor((p.z1 + POND_BANK_M) / 32); gz++) {
        const key = `${gx},${gz}`; if (!pondGrid.has(key)) pondGrid.set(key, []); pondGrid.get(key).push(p);
      }
  }
  const pondAt = (x, z, band = 0) => {
    if (!pondGrid.size) return null;
    let best = null;
    for (const p of pondGrid.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) || []) {
      if (x < p.x0 - band || x > p.x1 + band || z < p.z0 - band || z > p.z1 + band) continue;
      const R = p.ring; let inside = false, d2 = Infinity;
      for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
        const a = R[j], b = R[i];
        if ((b.z > z) !== (a.z > z) && x < (a.x - b.x) * (z - b.z) / (a.z - b.z) + b.x) inside = !inside;
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        d2 = Math.min(d2, (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2);
      }
      const d = inside ? Math.sqrt(d2) : -Math.sqrt(d2);
      if (d >= -band && (!best || d > best.d)) best = { p, d };
    }
    return best;
  };
  /** The ground at a pond: under the water a basin (0.8 m under it at the edge, down to 2.8 m), round it a bank
   *  just over the water (its rim) for 1.6 m, then easing down 1:2 to the hillside where that lies lower. */
  const pondGround = (h, hit) => {
    const lv = hit.p.level, d = hit.d;
    if (d > 0) return Math.min(h, lv - .8 - Math.min(2, d * .25));
    return Math.max(h, lv + .35 - Math.max(0, -d - 1.6) * .5);
  };

  // Route bridges (from OSM) as distance ranges along the outbound road.
  const routeBridges = (data.routeBridges || []).map((b) => ({ ...b, toM: Math.min(b.toM, route.turnS || route.total) }));
  const onRouteBridge = (s, margin = 0) => routeBridges.find((b) => s > b.fromM - margin && s < b.toM + margin);
  routeBridges.push(...(yield* underpasses()));
  routeBridges.sort((a, b) => a.fromM - b.fromM);

  /**
   * Streets that pass under the route where it runs on an embankment (no bridge in the map data): the street's
   * ground on both sides of the route lies more than 4 m below the road, or a ramp's deck runs 2.5 m or more
   * below it. Each gets a short girder span, so the
   * ground opens under the route and the street runs through instead of vanishing into the bank.
   */
  function* underpasses() {
    const S = data.streets;
    if (!S) return [];
    const u8 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
    const starts = new Uint32Array(u8(S.starts)), xy = new Int16Array(u8(S.xy)), deck = new Uint16Array(u8(S.deck));
    const found = [];
    for (let k = 0; k < S.count; k++) {
      if (due()) yield;
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
    { const pd = pondAt(x, z, POND_BANK_M); if (pd) h = pondGround(h, pd); }   // [6.5] hill water
    return h;
  };
  // The ground follows the city's streets: under a street and its sidewalks it sits just below the ribbon
  // (streets are drawn level from side to side), easing back to the terrain over the next ~10 m. Without this,
  // on a hillside the uphill half of a street disappears under the grass.
  let streetIndex = null, buildingStreets = false;
  // [F399] the grid compact: a number per cell (not a "gx,gz" string) and a number per street segment (street k,
  // point i: k·2^20 + i, not a [k, i] pair) — it was ~60 MB of small arrays on a Pittsburgh area
  const cellOf = (gx, gz) => (gx + 32768) * 65536 + (gz + 32768);
  const SEG = 1 << 20;   // (a street up to a million points; numbers past 2^31 just make the cell a double array)
  // the streets and their 24 m segment grid, built on first use (or by the job, [F30], where the old code first used them)
  function* streetIndexJob() {
    if (streetIndex || buildingStreets) return;
    buildingStreets = true;
    const streets = yield* cityStreetsJob(L, index, route);
    const grid = new Map();
    for (let k = 0; k < streets.length; k++) {
      const st = streets[k];
      if (due()) yield;
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i], r = st.width / 2 + 14;
        for (let gx = Math.floor((Math.min(a.x, b.x) - r) / 24); gx <= Math.floor((Math.max(a.x, b.x) + r) / 24); gx++)
          for (let gz = Math.floor((Math.min(a.z, b.z) - r) / 24); gz <= Math.floor((Math.max(a.z, b.z) + r) / 24); gz++) {
            const key = cellOf(gx, gz); let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(k * SEG + i);
          }
      }
    }
    grid.streets = streets;
    streetIndex = grid;
    buildingStreets = false;
  }
  const streetAt = (x, z, extra = 0, skip = -1) => {
    if (!streetIndex) {
      if (buildingStreets) return null;
      drain(streetIndexJob());
    }
    let best = null;
    for (const v of streetIndex.get(cellOf(Math.floor(x / 24), Math.floor(z / 24))) || []) {
      const k = Math.floor(v / SEG), i = v - k * SEG;
      if (k === skip) continue;
      const st = streetIndex.streets[k], a = st.pts[i - 1], b = st.pts[i];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z), edge = d - st.width / 2;
      if (edge < extra && (!best || edge < best.edge)) best = { st, k, d, edge, y: a.y + (b.y - a.y) * t };
    }
    return best;
  };
  /** [w2-align] Points along the ground streets (centre, carriageway edges, sidewalk edges every `step` m) inside a
   *  box: the drawn ground mesh must not rise above the ground there (js/world/toolbox/landscape/ground-drape.js). Not within
   *  `clearOfRouteM` of the route's road, whose bank and verge the course QC holds to the 6 m mesh as sampled. */
  const groundClearPoints = (x0, z0, x1, z1, step = 2, clearOfRouteM = 9) => {
    if (!streetIndex) streetAt(x0, z0);
    if (!streetIndex) return [];
    const out = [], up = [], seen = new Set();
    for (let gx = Math.floor(x0 / 24); gx <= Math.floor(x1 / 24); gx++) for (let gz = Math.floor(z0 / 24); gz <= Math.floor(z1 / 24); gz++) {
      for (const v of streetIndex.get(cellOf(gx, gz)) || []) {
        const k = Math.floor(v / SEG), i = v - k * SEG;
        if (seen.has(v)) continue; seen.add(v);
        const st = streetIndex.streets[k]; if (st.bridge) continue;
        const a = st.pts[i - 1], b = st.pts[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (len < .01) continue;
        const nx = -dz / len, nz = dx / len, hw = st.width / 2, n = Math.max(1, Math.ceil(len / step));
        for (let j = 0; j <= n; j++) {
          const cx = a.x + dx * j / n, cz = a.z + dz * j / n;
          for (const o of [-hw - 2.5, -hw, 0, hw, hw + 2.5]) {
            const x = cx + nx * o, z = cz + nz * o;
            if (!(x >= x0 && x <= x1 && z >= z0 && z <= z1)) continue;
            const r = routeDist(x, z); if (r && r.d < clearOfRouteM && !onRouteBridge(route.dist[r.i], -10)) continue;   // the route's own bank and verge rule there
            out.push({ x, z });
          }
          // [audit-E1] a street on a bank (the ground falls away more than 1.5 m in the 6 m past its shoulder): its
          // bank's top, so the mesh can't sag under its edge (ground-drape.js `up`; raised before any clearing)
          if (st.cls > 6) continue;
          const sh = hw + (SIDEWALK_CLS(st.cls) ? 2.5 : 1);
          for (const sg of [-1, 1]) {
            const x = cx + nx * sg * sh, z = cz + nz * sg * sh;
            if (!(x >= x0 && x <= x1 && z >= z0 && z <= z1)) continue;
            const r = routeDist(x, z); if (r && r.d < clearOfRouteM + 4) continue;
            const top = heightAt(x, z);
            if (top - heightAt(x + nx * sg * 6, z + nz * sg * 6) < 1.5) continue;
            up.push({ x, z, up: true }, { x: cx + nx * sg * (hw + .3), z: cz + nz * sg * (hw + .3), up: true });
          }
        }
      }
    }
    return up.concat(out);
  };
  /** Every street whose carriageway comes within `extra` of (x, z): [{k, edge}] (one per street). */
  const streetsNear = (x, z, extra = 0) => {
    if (!streetIndex) streetAt(x, z);
    // [audit-C] (no Map and no object per segment: a cell holds a few streets, a linear scan of the kept ones is faster
    // and this runs for every ground height; the same streets, in the same order, as before)
    const out = [], cell = streetIndex?.get(cellOf(Math.floor(x / 24), Math.floor(z / 24)));
    if (!cell) return out;
    for (let q = 0; q < cell.length; q++) {
      const v = cell[q], k = Math.floor(v / SEG), i = v - k * SEG;
      const st = streetIndex.streets[k], a = st.pts[i - 1], b = st.pts[i];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const ex = a.x + dx * t - x, ez = a.z + dz * t - z, edge = Math.sqrt(ex * ex + ez * ez) - st.width / 2;
      if (!(edge < extra)) continue;
      let o = null;
      for (let m = 0; m < out.length; m++) if (out[m].k === k) { o = out[m]; break; }
      if (!o) out.push({ k, edge, y: a.y + (b.y - a.y) * t, i, t });
      else if (edge < o.edge) { o.edge = edge; o.y = a.y + (b.y - a.y) * t; o.i = i; o.t = t; }
    }
    return out;
  };
  const pads = makeGlasshousePads(config, proj, route, index);   // [glasshouse] (js/world/toolbox/structures/glasshouse.js)
  const grade = makeStreetGrade(config, { data, decoded: D, route, index, outbound, routeKindAt, onRouteBridge, routeDist });   // [street-kit] main-street cross-section
  // [audit-E1] how far the ground stays under a ramp deck at a point of it: DECK_UNDER, eased to the ground street's
  // .1 m over the last ~12 m to each end (p.endM: rampDecksJob)
  // (and within 20 m of the route's road, whose bank the drape holds to the 6 m mesh: .1 m there, as a ground street's)
  const deckUnder = (st, o, own) => {
    const a = st.pts[o.i - 1], b = st.pts[o.i], e = (a.endM ?? 99) + ((b.endM ?? 99) - (a.endM ?? 99)) * o.t;
    return .1 + (Math.min(DECK_UNDER, .1 + Math.max(0, e) * .2) - .1) * (own ? smoothstep(13, 20, own.d) : 1);
  };
  const heightAt = (x, z) => {
    let h = routeHeightAt(x, z);
    { const pad = pads?.at(x, z); if (pad) h += (pad.y - h) * pad.w; }   // [glasshouse] level under the glass, eased back outside
    if (buildingStreets) return h;
    // Flat for 6.5 m past the carriageway (sidewalks reach 2.5 m; one more ground-mesh cell so the 6 m mesh
    // can't drag a hillside over it), easing back to the terrain by 18 m. Where streets overlap at different
    // heights (a ramp beside a street), follow the lowest, so none is buried.
    // [audit-C] one street lookup and one route lookup per call (they were made up to 3 and 4 times): every smaller
    // radius below is a subset of the 18 m one (each street's nearest piece is the same), so the result is identical
    const all = streetsNear(x, z, 18), own = routeDist(x, z);
    const flat = 6.5, around = all.filter((o) => !streetIndex.streets[o.k].bridge);
    // [audit-E1] the ground is graded to a ramp deck (rampDecksJob) as to a street 2.5 m under its roadway (less towards
    // its ends, where it lands on the ground street it continues): under and beside it the ground follows it down to
    // the street below, eased back to the terrain like any street's, not a hillside or a cliff right against it
    let graded = around;
    if (all.length !== around.length) {
      graded = around.slice();
      for (const o of all) { const st = streetIndex.streets[o.k]; if (st.rampDeck) graded.push({ k: o.k, edge: o.edge, y: o.y - deckUnder(st, o, own) + .1 }); }
    }
    if (graded.length) {
      let target = Infinity, edge = Infinity, ride = Infinity;
      for (const o of graded) {
        edge = Math.min(edge, o.edge);
        if (o.edge < flat) target = Math.min(target, o.y - .1);
        if (o.edge < 2.5 && streetIndex.streets[o.k].rides) ride = Math.min(ride, o.y - .1);   // [road-align] rides
      }
      if (target === Infinity) target = graded.reduce((a, b) => (a.edge < b.edge ? a : b)).y - .1;
      // the route's own road wins: no street grading under it, easing in beyond its shoulders — except under the
      // street the route rides on, which lies just under the road and is wider than it ([road-align] rides)
      const r = own, byRoute = r ? smoothstep(ROAD_WIDTH / 2 + 2, 13, r.d) : 1;
      h += (target - h) * (1 - smoothstep(flat, 18, edge)) * byRoute;
      if (ride < Infinity) h += (ride - h) * (1 - byRoute);
      if (r && r.d < 9) h = Math.min(h, r.y - .5 + Math.max(0, r.d - 5) * .2);   // never over the route's own road
    }
    // [audit-E1] streets at two levels (a ramp on its embankment beside the carriageway it leaves): the "lowest street
    // wins" above pulled the ground under the upper one's edge down to the lower one (a slab in the air) and stepped
    // between the two in a vertical dirt wall. Between them the ground is a 1:2 bank instead (BANK_SLOPE): no lower
    // than each street's shoulder less half the distance past it (the upper one's embankment), no higher than each
    // street's shoulder plus half (the lower one's cut); the lower street wins where both can't hold (a ramp deck
    // counts as above). Not in the water; eased out under the route's own road.
    {
      let lo = -Infinity, hi = Infinity, yMin = Infinity, yMax = -Infinity, n = 0;
      const onGround = around.some((o) => o.edge < .5);
      for (const o of graded) {
        const st = streetIndex.streets[o.k];
        if (st.cls > 7 || o.edge > BANK_REACH + 2) continue;
        const y = o.y - .1, run = Math.max(0, o.edge - (SIDEWALK_CLS(st.cls) && !st.bridge ? 2.5 : 1)) * BANK_SLOPE + Math.max(0, o.edge - BANK_REACH) * 2;   // (past BANK_REACH it lets go: the terrain's again)
        lo = Math.max(lo, y - run); if (!(onGround && st.bridge)) hi = Math.min(hi, y + run);
        yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); n++;
      }
      if (n > 1 && yMax - yMin > 1) {
        const byRoute = own ? smoothstep(13, 20, own.d) : 1;   // (not on the route's bank: the drape holds it to the mesh there)
        const want = Math.min(waterAt(x, z) > 0 ? h : Math.max(h, lo), hi);
        h += (want - h) * byRoute;
        if (own && own.d < 9) h = Math.min(h, own.y - .5 + Math.max(0, own.d - 5) * .2);
      }
      // under and beside a ramp deck the lower street's grading wins: its 1:2 bank, without letting go, reaches under
      // the deck (the embankment the deck replaced is still in the terrain there: it stood as a dirt cliff)
      if (graded !== around && around.length) {
        let deckEdge = Infinity, deckY = -Infinity;
        for (const o of all) if (streetIndex.streets[o.k].rampDeck && o.edge < deckEdge) { deckEdge = o.edge; deckY = o.y; }
        let cap = Infinity;
        for (const o of around) if (o.y < deckY - DECK_UNDER) cap = Math.min(cap, o.y - .1 + Math.max(0, o.edge - (SIDEWALK_CLS(streetIndex.streets[o.k].cls) ? 2.5 : 1)) * BANK_SLOPE);
        if (cap < h) h += (cap - h) * (1 - smoothstep(4, 12, deckEdge)) * (own ? smoothstep(13, 20, own.d) : 1);
      }
    }
    // [junctions] round a junction: just under its surface and corner sidewalks (but still never over the route's road)
    if (L._junctions) {
      const r = own;
      const w = r ? smoothstep(ROAD_WIDTH / 2 + 1, ROAD_WIDTH / 2 + 7, r.d) : 1;   // (under the road and its shoulder: the road's bank)
      if (w > 0) h += (junctionGround(L._junctions, x, z, h) - h) * w;
      if (r && r.d < 9) h = Math.min(h, r.y - .5 + Math.max(0, r.d - 5) * .2);
    }
    if (grade) h = grade(x, z, h, own);   // [street-kit] (after [junctions]: it fades out near other streets, so junctions keep their grading) sidewalk-level ground beside a kit zone's curbs
    // nor over a low ramp or viaduct deck (they're left out of the grading above, but one running close to the
    // ground beside the route would otherwise be buried by the bank the route's road raises)
    // [network] a trail on a ledge (the Jail Trail under the parkway): the ground's 6 m mesh must not reach over
    // the shoulders from the embankment beside it, so out to 14 m it stays under a gentle bank — where no
    // street lies (a street keeps its own grading)
    if (own && own.d < 14 && own.d >= 9 && routeKindAt(route.dist[outbound(own.i)]) === 'trail' && !all.some((o) => o.edge < 2 && o.y < own.y + 1)) {
      h = Math.min(h, own.y - .5 + (own.d - 5) * .12);
    }
    // [parkway-east] past the 9 m clamp a hillside cut could stand right over the verge, and the 6 m mesh then
    // draws it over the shoulder (Three Rivers Loop 6.21 km, once the Parkway East ramps that graded it were removed):
    // out to 13 m it stays under a 1:1.25 bank from the clamp's edge
    if (own && own.d >= 9 && own.d < 13) h = Math.min(h, own.y - .5 + .8 + (own.d - 9) * .8);
    if (!own || own.d > 9) {   // (near the route's own road its bank wins: the ground mesh can't step that fast)
      // ([audit-E1] a ramp deck doesn't, on a ground street's own carriageway: the ground street wins there)
      const onGround = around.some((o) => o.edge < .5);
      for (const o of all) if (o.edge < 1.5 && streetIndex.streets[o.k].bridge && h > o.y - .35 && !(onGround && streetIndex.streets[o.k].rampDeck)) h = Math.min(h, o.y - .35);
    }
    // [6.1] and never over a street's own carriageway, sidewalk or path (away from the route's road, whose
    // bank wins there): the route's bank, a hillside or a junction's grading used to rise over a lower street beside
    // the route, and the grass covered its edge
    if (!own || own.d > 9) {   // (as decks: within 9 m the route's bank wins — the 6 m mesh couldn't follow a step there)
      for (const o of around) if (o.edge < (SIDEWALK_CLS(streetIndex.streets[o.k].cls) ? 2.6 : .4) && h > o.y - .12) h = o.y - .12;   // (around: no decks)
    }
    // nor, after all that grading, near the water's level (the route's riverside trail around the Point presses
    // the ground to exactly the water's level)
    if (h > level - .6 && h < level + .35) h = h >= level - .1 ? level + .35 : level - .6;
    // [6.5] nor over a pond's water inside it (a street's grading reaching over its edge)
    // (and its basin kept under the water: a path's grading beside a small basin reached right across it)
    // and its bank's top over the water where no street or path runs along it (their grading may bring it down)
    { const pd = pondAt(x, z, 1.6); if (pd) h = pd.d > 0 ? Math.min(h, pd.p.level - .8 - Math.min(2, pd.d * .25)) : (!own || own.d > 9) && around.every((o) => o.edge > 3) ? Math.max(h, pd.p.level + .35) : h; }
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
      // [6.5] a pond beside the route keeps its basin and bank through the route's bank (but never over its road)
      const pd = pondAt(x, z, POND_BANK_M);
      if (pd) { h = pondGround(h, pd); if (!bridge && road.d < 9) h = Math.min(h, roadEle(i, x, z) - .5 + Math.max(0, road.d - 5) * .2); }
    }
    return h;
  };
  const bridgeAt = (x, z, margin = 0) => {
    const road = index.nearest(x, z, 30);
    if (!road || road.d > 26) return null;
    return onRouteBridge(route.dist[outbound(road.i)], margin) || null;
  };
  const waterLevelAt = (x, z) => { if (waterAt(x, z) > .5) return level; const pd = pondAt(x, z); return pd ? pd.p.level : -Infinity; };

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
  const rivers = () => riverField || drain(riversJob());
  function* riversJob() {   // ([F30] as a job: the start of an area built on the ride asks for it)
    if (riverField) return riverField;
    const B = T ? { x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1, step: 40 } : { x0: D.x0, z0: D.z0, x1: D.x1, z1: D.z1, step: (D.x1 - D.x0) / (D.nx - 1) };
    const nx = Math.round((B.x1 - B.x0) / B.step) + 1, nz = Math.round((B.z1 - B.z0) / B.step) + 1;
    const dx = (B.x1 - B.x0) / (nx - 1), dz = (B.z1 - B.z0) / (nz - 1), cell = (dx + dz) / 2, X0 = B.x0, Z0 = B.z0;
    const wet = new Uint8Array(nx * nz), far = 1e9;
    for (let j = 0; j < nz; j++) { for (let i = 0; i < nx; i++) wet[j * nx + i] = waterAt(X0 + i * dx, Z0 + j * dz) > .5 ? 1 : 0; if (due()) yield; }
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
    const toWater = chamfer(wet); yield;
    const toLand = chamfer(wet.map((w) => 1 - w)); yield;
    const field = new Float32Array(nx * nz), ground = new Float32Array(nx * nz);
    for (let k = 0; k < field.length; k++) {
      field[k] = wet[k] ? -toLand[k] : toWater[k];
      ground[k] = baseHeight(X0 + (k % nx) * dx, Z0 + Math.floor(k / nx) * dz);
      if (k % nx === nx - 1 && due()) yield;
    }
    return (riverField = { nx, nz, x0: X0, z0: Z0, dx, dz, field, ground });
  }
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
  // a scene may ask for finer ground (groundMesh.fineCells) along stretches of the route (groundMesh.fineRanges:
  // [{fromM, toM}]) where a road cut into a steep hillside carves a bank the 6 m mesh can't follow (a park road
  // spiralling round a hill): the 96 m ground patches within 30 m of the road there (stylized-terrain.js)
  const fineRanges = config.groundMesh?.fineCells ? config.groundMesh.fineRanges || [] : [];
  const fineCells = fineRanges.length ? (() => {
    const set = new Set();
    for (let i = 0; i < route.dist.length; i++) {
      const s = route.dist[i];
      if (!fineRanges.some((r) => s >= r.fromM && s <= r.toM)) continue;
      for (const dx of [-30, 30]) for (const dz of [-30, 30]) set.add(`${Math.floor((index.xs[i] + dx) / 96)},${Math.floor((index.zs[i] + dz) / 96)}`);
    }
    return set;
  })() : null;
  const L = {
    kind: 'city', city: true, data, decoded: D, level, wallAt, shoreWalls, outer: OW && { x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1, water: outerWater, mask: OW }, hasOcean: false, coastSide: 1,
    coast: [{ x: -1e5, z: 0 }, { x: -1e5, z: 1 }], coastX: () => -1e5, inlandAt: () => 1e4,
    lakes: [], waterIslands: [], creeks: [], creekAt: () => null, landmarks,
    sheltered: pads ? pads.sheltered : () => false,   // [glasshouse] under glass (no rain, no street lamps)
    heightAt, baseHeight, terrainAt, bridgeAt, waterLevelAt, landAt: landCell, waterAt, routeKindAt, routeBridges, broad,
    isWater: (x, z, height) => (waterAt(x, z) > .35 && height < level + .6) || (((pd) => !!pd && height < pd.p.level + .6)(pondAt(x, z))),
    ponds: D.ponds, pondAt,   // [6.5] (F131) hill water at its own level
    colorAt: (x, z) => LAND_COLORS[landCell(x, z)] || null,
    /** Trees and shrubs from the shared kit grow only in parks, woods and the hills beyond. */
    canPlant: (x, z) => { const c = landCell(x, z); return c === LAND.woods || c === LAND.outside || (c === LAND.grass && ((x * 13 + z * 7) & 3) === 0) || (c === LAND.yards && yardTree(x, z)); },   // [s4-section] yards
    ...(fineCells ? { fineGroundAt: (x, z) => fineCells.has(`${Math.floor(x / 96)},${Math.floor(z / 96)}`) } : {}),
    routeDist, streetAt, streetsNear, groundClearPoints,   // [w2-align] groundClearPoints, groundDrapeFixed/Last
    // the route's bank and verge (not under its bridges and viaducts, 10 m in from their ends: the ground there is the streets' below)
    groundDrapeFixed: (x, z) => { const r = routeDist(x, z); return !!r && r.d < 20 && !onRouteBridge(route.dist[r.i], -10); },
    groundDrapeLast: (x, z) => streetsNear(x, z, 2.5).some((o) => !streetIndex.streets[o.k].bridge),   // on a street
    junctions: config.junctions || null,   // [junctions] scene key: real intersection geometry (js/world/toolbox/city/junctions.js)
    /** For the weather: fog lies on the rivers (at the water level) and reaches inland up the valleys. */
    fogBase: level, fogField: rivers, fogFieldJob: riversJob, fogInlandAt: riverDistance,   // ([F30] fogFieldJob: the same field, as a job)
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
  // ([F30] the streets first, as a job: planning the promenades is what used to build them, on its first step)
  if (config.riverfront) { yield* streetIndexJob(); yield* riverfrontGroundJob(L, { route, index, config: config.riverfront, streets: () => (streetAt(0, 0), streetIndex.streets) }); }
  return L;
}

export const STREET_W = [15, 7.5, 13, 11, 9.5, 7.5, 9, 5, 3.4];   // street width by class (tools/build_city.py)
export const STREET_LIFT = .24;                                     // highest a street ribbon sits above its line
const SIDEWALK_CLS = (cls) => cls >= 2 && cls <= 6;   // [6.1] streets drawn with sidewalks (city.js), 2.5 m past the carriageway
export const BANK_SLOPE = .45;   // [audit-E1] a grassy bank between two street levels: about 1 m up per 2 m across
const BANK_REACH = 10;        // [audit-E1] m past a street's edge its bank reaches (≈ 4 m high at 1:2); beyond, it lets go quickly
const DECK_UNDER = 2.5;         // [audit-E1] the ground under a ramp deck stays this far under its roadway (bridges.js: a 2.2 m slab)

/**
 * The city's streets as drawn: [{cls, bridge, oneway, layer, width, pts: [{x, y, z}]}]. Bridge decks keep their
 * built heights; everything else follows the ground. Where another street runs over or alongside the route
 * (the rest of a bridge's roadway, a ramp, the street the route rides on), it is kept just below the route's
 * own road, so it can never cover the road or the rider. Shared by the renderer and the course QC sweep.
 */
export function cityStreets(landscape, index, route) { return drain(cityStreetsJob(landscape, index, route)); }
// [audit-A] Street profile fairing. Street heights are set point by point by several passes: the ground under each
// point, then pins just under the route's road (lower(): a point over or beside the road, while its neighbours
// keep the ground or their deck height), junction-node sync, and the road-meets passes (keepUnderRoad, …) that
// move single points. Nothing eased between, so a ribbon could dip 2 m and hump 2 m back within 6 m beside the
// route (the "jagged highways": tools/qc_map.mjs `bump`, `height-step`). This pass fairs every street profile
// (decks too) without moving what other passes rely on. It runs twice: once the pins are set (so the junction and
// road-meets passes see eased heights) and again before the junction tops (for what those passes moved).
//   fixed   ends · pinned points (p.pin, p.under: under the route's road) · junction points (p.jn) · nodes shared
//           with another street (streets meeting there still arrive at one height) · points over the route's
//           road at its level (they meet it) or at another level (over the rider's head, or far below)
//   capped  other points over the route's road never rise above the pinned height (just under the road's
//           surface) or, if already above it, above where they are: nothing comes up through the road
//   free    every other point
// Free and capped points move (Gauss–Seidel) just far enough that every point — a fixed one too, by moving its
// neighbours — lies within `bump` of the straight line through its neighbours and, on ground streets, within
// `grade` of them: a pinned dip or a deck's step spreads into a ramp over the points around it.
const FAIR = { bump: .3, grade: .36, gradeSeg: 3, iters: 400, overRoad: 1.5, under: .26 };
function* fairStreetProfilesJob(streets, { landscape, index, route }) {
  const end = route.turnIdx || route.dist.length - 1;
  // the route's road height under a street point whose ribbon reaches over the road (as lower() and the course QC
  // see it: the nearest 10 m sample, else the road between samples when that is the same pass), else null
  const roadUnder = (p, width) => {
    const r = index.nearest(p.x, p.z, width / 2 + ROAD_WIDTH / 2 + FAIR.overRoad);
    if (!r) return null;
    const i = r.i > end ? Math.max(0, 2 * end - r.i) : r.i, rd = landscape.routeDist?.(p.x, p.z);
    return rd && Math.abs(rd.y - route.ele[i]) < 3 ? rd.y : route.ele[i];
  };
  const key = (p) => Math.round(p.x * 100) * 4194304 + Math.round(p.z * 100);
  const shared = new Map();
  streets.forEach((st, k) => { for (const p of st.pts) { const id = key(p), o = shared.get(id); shared.set(id, o == null || o === k ? k : -1); } });
  for (let k = 0; k < streets.length; k++) {
    if (due()) yield;
    const st = streets[k], P = st.pts, n = P.length;
    if (n < 3 || st.cls > 7) continue;
    const s = new Float64Array(n), y = Float64Array.from(P, (p) => p.y), fixed = new Uint8Array(n), cap = new Float64Array(n).fill(Infinity);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    for (let i = 0; i < n; i++) {
      const p = P[i];
      fixed[i] = i === 0 || i === n - 1 || p.pin || p.under || p.jn != null || shared.get(key(p)) === -1;
      const e = fixed[i] ? null : roadUnder(p, st.width);
      if (e == null) continue;
      if (e - y[i] >= 6 || y[i] >= e + 4 || Math.abs(y[i] - e + .1) < .4) fixed[i] = 1;   // (another level: over the rider, far below; or flush: it meets the road)
      else cap[i] = Math.max(e - FAIR.under, y[i]);
    }
    const put = (i, v) => { const w = Math.min(cap[i], v); if (Math.abs(w - y[i]) < 1e-4) return false; y[i] = w; return true; };
    let moved = false;
    for (let it = 0; it < FAIR.iters; it++) {
      let any = false;
      for (let i = 1; i + 1 < n; i++) {
        const d1 = s[i] - s[i - 1], d2 = s[i + 1] - s[i];
        if (d1 < .5 || d2 < .5) continue;
        const off = y[i] - (y[i - 1] + (y[i + 1] - y[i - 1]) * d1 / (d1 + d2));
        if (Math.abs(off) <= FAIR.bump + 1e-3) continue;
        const dy = off - Math.sign(off) * FAIR.bump;
        if (!fixed[i]) { any = put(i, y[i] - dy) || any; continue; }
        // a fixed point off the line: its free neighbours come towards it (never past it, never away from it)
        const a = !fixed[i - 1], b = !fixed[i + 1];
        const toward = (j, by) => { const v = y[j] + by; if ((y[i] - y[j]) * by <= 0) return false; return put(j, by > 0 ? Math.min(v, y[i]) : Math.max(v, y[i])); };
        if (a && b) { any = toward(i - 1, dy) || any; any = toward(i + 1, dy) || any; }
        else if (a) any = toward(i - 1, dy * Math.min(2, (d1 + d2) / d2)) || any;
        else if (b) any = toward(i + 1, dy * Math.min(2, (d1 + d2) / d1)) || any;
      }
      if (!st.bridge) for (let i = 0; i + 1 < n; i++) {
        const ds = s[i + 1] - s[i], d = y[i + 1] - y[i], over = Math.abs(d) - FAIR.grade * ds;
        if (ds < FAIR.gradeSeg || over <= 1e-3 || (fixed[i] && fixed[i + 1])) continue;
        const a = fixed[i] ? 0 : fixed[i + 1] ? 1 : .5;
        if (a) any = put(i, y[i] + Math.sign(d) * over * a) || any;
        if (a < 1) any = put(i + 1, y[i + 1] - Math.sign(d) * over * (1 - a)) || any;
      }
      if (!any) break;
      moved = true;
    }
    if (moved) for (let i = 0; i < n; i++) P[i].y = y[i];
  }
}
/**
 * [audit-E1] Raised roads with no room for a bank. OSM maps many ramps and carriageways on embankments (not tagged
 * bridge); the ground under them follows the streets, and where a lower street runs too close for a 1:2 bank
 * (BANK_SLOPE) between them, the lower one's grading wins and the upper one was a slab in the air. Those stretches
 * become decks (bridge streets: the bridge kit draws the slab, railings and piers, js/world/toolbox/city/bridges.js;
 * the ground under them follows the lower street): a highway, ramp or primary point that would float more than
 * `floatM` over the bank from any lower street (or the route's road) nearby. Short gaps are closed, short runs
 * dropped, and the street is split at the run's ends (new OSM-style nodes, so the pieces meet end to end).
 * The bank's shoulders: 1 m past a carriageway (2.5 m where it has sidewalks).
 */
export const RAMP_DECK = { maxCls: 4, floatM: 1.2, reachM: 30, minRun: 4, gap: 2, routeM: 3, junctionM: 12 };
export function* rampDecksJob(streets, { index, route } = {}) {
  const C = 24, grid = new Map(), cell = (x, z) => Math.floor(x / C) * 100003 + Math.floor(z / C);
  const shoulder = (st) => (SIDEWALK_CLS(st.cls) ? 2.5 : 1);
  const orig = streets.slice();   // (the neighbours as built: the pieces split off below don't move them)
  orig.forEach((st, k) => {
    if (st.cls > 7 || (st.bridge && st.pts.some((p) => p.y == null))) return;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / C); gx <= Math.floor(Math.max(a.x, b.x) / C); gx++)
        for (let gz = Math.floor(Math.min(a.z, b.z) / C); gz <= Math.floor(Math.max(a.z, b.z) / C); gz++) {
          const key = gx * 100003 + gz; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(k * 65536 + i);
        }
    }
  });
  const R = RAMP_DECK, end = route ? route.turnIdx || route.dist.length - 1 : 0;
  // city junctions (an OSM node three or more street arms meet at, one of them a secondary or smaller, or a path): a deck stays
  // clear of them (the junction is on the ground)
  const arms = new Map(), nk = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  for (const st of orig) if (st.nodes) st.nodes.forEach((p, j) => { const o = arms.get(nk(p)) || { p, n: 0, city: false }; o.n += j === 0 || j === st.nodes.length - 1 ? 1 : 2; o.city ||= st.cls >= 3; arms.set(nk(p), o); });
  const jGrid = new Map();
  // (a city street's junction: a highway's gores are the decks' to carry)
  for (const { p, n, city } of arms.values()) if (n >= 3 && city) { const c = cell(p.x, p.z); if (!jGrid.has(c)) jGrid.set(c, []); jGrid.get(c).push(p); }
  const nearJunction = (p) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of jGrid.get(cell(p.x, p.z) + a * 100003 + b) || []) if (Math.hypot(q.x - p.x, q.z - p.z) < R.junctionM) return true; return false; };
  // how far a point of street k (half width hw, shoulder s) would float over a 1:2 bank down to the lowest neighbour
  const floatAt = (k, p, hw, s, cls) => {
    let worst = -Infinity;
    const span = Math.ceil(R.reachM / C);
    const best = new Map();   // nearest piece of each other street
    for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) {
      for (const v of grid.get(cell(p.x, p.z) + a * 100003 + b) || []) {
        const q = Math.floor(v / 65536), i = v % 65536;
        if (q === k) continue;
        const st = orig[q], A = st.pts[i - 1], B = st.pts[i], dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.z - A.z) * dz) / l2));
        const d = Math.hypot(A.x + dx * t - p.x, A.z + dz * t - p.z);
        const o = best.get(q);
        if (o?.cross) continue;
        // (a bridge crossing over or under it, or a city street it crosses or merges into: not beside it — a
        // highway's ramps merging into it are)
        if (d - st.width / 2 - hw < -1 && (st.bridge || Math.max(st.cls, cls) >= 2)) { best.set(q, { d: Infinity, st, cross: true }); continue; }
        if (!o || d < o.d) best.set(q, { d, y: A.y + (B.y - A.y) * t, st });
      }
    }
    for (const o of best.values()) {
      if (o.cross) continue;
      const gap = o.d - hw - o.st.width / 2;
      if (gap > R.reachM) continue;
      // (an OSM bridge below: the ground must pass under it, .35 m down, right at its edge)
      worst = Math.max(worst, o.st.bridge ? p.y - o.y + .35 - Math.max(0, gap - s) * BANK_SLOPE : p.y - o.y - Math.max(0, gap - s - shoulder(o.st)) * BANK_SLOPE);
    }
    // the route's road below (a bank would cover it)
    if (index && route) {
      const r = index.nearest(p.x, p.z, hw + ROAD_WIDTH / 2 + 20);
      if (r) {
        const i = r.i > end ? Math.max(0, 2 * end - r.i) : r.i, gap = r.d - hw - ROAD_WIDTH / 2;
        worst = Math.max(worst, p.y - route.ele[i] - Math.max(0, gap - s - 1) * BANK_SLOPE);
      }
    }
    return worst;
  };
  const n0 = streets.length;
  for (let k = 0; k < n0; k++) {
    if (due()) yield;
    const st = streets[k], P = st.pts, n = P.length;
    if (st.bridge || st.cls > R.maxCls || n < 2) continue;
    // (not within routeM of the route's road: its bank, junctions and clearances rule there — tools/qc_course.mjs)
    const nearRoute = (p) => index && !!index.nearest(p.x, p.z, st.width / 2 + ROAD_WIDTH / 2 + R.routeM);
    const mask = P.map((p) => !nearRoute(p) && !nearJunction(p) && floatAt(k, p, st.width / 2, shoulder(st), st.cls) > R.floatM);
    // close short gaps, drop short runs, and widen each run by a point (the deck lands where the bank can take it)
    for (let i = 0; i < n; i++) if (!mask[i]) { let j = i; while (j < n && !mask[j]) j++; if (i > 0 && j < n && j - i <= R.gap) for (let q = i; q < j; q++) mask[q] = true; i = j; }
    const runs = [];
    for (let i = 0; i < n; i++) if (mask[i]) { let j = i; while (j + 1 < n && mask[j + 1]) j++; if (j - i + 1 >= R.minRun) runs.push([Math.max(0, i - 1), Math.min(n - 1, j + 1)]); i = j; }
    if (!runs.length) continue;
    // a run within a couple of points of an end reaches it (no stub of ground street left at the end)
    for (const r of runs) { if (r[0] <= 2) r[0] = 0; if (r[1] >= n - 3) r[1] = n - 1; }
    if (runs.length === 1 && runs[0][0] === 0 && runs[0][1] === n - 1) { streets[k] = { ...st, bridge: true, rampDeck: true }; continue; }
    // split at the runs' ends: pieces [cut_i, cut_i+1], every other one a deck
    const cuts = [0], deckFrom = new Set();
    for (const [a, b] of runs) { if (a > cuts[cuts.length - 1]) cuts.push(a); deckFrom.add(cuts[cuts.length - 1]); if (b > cuts[cuts.length - 1]) cuts.push(b); }
    if (cuts[cuts.length - 1] !== n - 1) cuts.push(n - 1);
    const pieces = [];
    for (let c = 0; c + 1 < cuts.length; c++) {
      const a = cuts[c], b = cuts[c + 1];
      const nodes = [], nodeIdx = [];
      st.nodeIdx.forEach((ni, j) => { if (ni >= a && ni <= b) { nodes.push(st.nodes[j]); nodeIdx.push(ni - a); } });
      if (nodeIdx[0] !== 0) { nodes.unshift(P[a]); nodeIdx.unshift(0); }
      if (nodeIdx[nodeIdx.length - 1] !== b - a) { nodes.push(P[b]); nodeIdx.push(b - a); }
      const pts = P.slice(a, b + 1).map((p, j) => (j === 0 && c > 0 ? { ...p } : p));   // (the shared end point: one object per street)
      const deck = deckFrom.has(a);
      pieces.push({ ...st, bridge: deck, ...(deck ? { rampDeck: true } : {}), pts, nodes, nodeIdx, underRoute: st.underRoute && pts.some((p) => p.pin) });
    }
    // (the longest ground piece keeps the street's index: passes that go street by street see it where they did)
    let keep = 0;
    pieces.forEach((pc, c) => { if (!pc.bridge && (pieces[keep].bridge || pc.pts.length > pieces[keep].pts.length)) keep = c; });
    streets[k] = pieces[keep];
    pieces.forEach((pc, c) => { if (c !== keep) streets.push(pc); });
  }
  // each deck point's distance to the deck's nearer end (heightAt: the ground under it eases to the street it lands on)
  for (const st of streets) if (st.rampDeck) {
    const P = st.pts, s = [0];
    for (let i = 1; i < P.length; i++) s.push(s[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    P.forEach((p, i) => { p.endM = Math.min(s[i], s[P.length - 1] - s[i]); });
  }
}

/** [audit-E1] A ramp deck's ends meet what they carry on as at one height (the passes after the split move them
 *  apart: the ground piece's grading, the junctions; an OSM bridge keeps its own deck heights): each end of a ramp
 *  deck takes the height of the other street's point there (not a ramp deck's), and the fairing after eases the deck to it. */
function syncDeckJoins(streets) {
  const key = (p) => Math.round(p.x * 20) * 1e7 + Math.round(p.z * 20);
  const ends = new Map();
  for (const st of streets) if (st.rampDeck) for (const p of [st.pts[0], st.pts[st.pts.length - 1]]) ends.set(key(p), p);
  if (!ends.size) return;
  for (const st of streets) {
    if (st.rampDeck) continue;
    for (const q of st.pts) { const p = ends.get(key(q)); if (p) p.y = q.y; }
  }
}

/** cityStreets as a job ([F30]: js/world/toolbox/core/jobs.js): the same passes, pausing between streets when its slice is used up. */
export function* cityStreetsJob(landscape, index, route) {
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
    if (due()) yield;
    const cls = S.meta[k * 3], flags = S.meta[k * 3 + 1], layer = S.meta[k * 3 + 2] - 8;
    const bridge = !!(flags & 1), oneway = ((flags >> 1) & 3) - 1, width = STREET_W[cls], brick = !!(flags & 8);   // [finish] bit 3: brick or sett (OSM surface)
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
    for (let j = 0; j < pts.length; j++) {   // ([F30] a loop, not forEach: a long street may pause half way)
      const p = pts[j];
      if (p.y == null) p.y = landscape.heightAt(p.x, p.z);
      if (lower(p, width, !bridge && alongRoute(pts, j))) under = true;   // [road-align] along
      if ((j & 63) === 63 && due()) yield;
    }
    streets.push({ cls, bridge, oneway, layer, pts, width, ...(brick ? { brick } : {}), underRoute: under, rides: width > ROAD_WIDTH + 1 && pts.some((p) => p.along),   // [road-align] rides (wider than the road: sticks out)
      nodes: raw, nodeIdx });   // [junctions] OSM nodes → pts index
  }
  yield* rampDecksJob(streets, { index, route });   // [audit-E1] raised roads with no room for a bank: decks
  // [road-align] smooth, grade-limited street profiles with one height per junction (js/world/road-align.js)
  if (align?.streets) {
    const nearRoute = (x, z) => { const r = index.nearest(x, z, 24); return r ? 1 - smoothstep(12, 22, r.d) : 0; };
    yield* alignStreetProfilesJob(streets, { ...align, ground: landscape.baseHeight, nearRoute, floor: landscape.level + .6 });
    for (const st of streets) { st.pts.forEach((p, j) => { if (lower(p, st.width, !st.bridge && alongRoute(st.pts, j))) st.underRoute = true; }); if (due()) yield; }
    yield* syncPinnedNodesJob(streets);
  }
  syncDeckJoins(streets);   // [audit-E1]
  yield* fairStreetProfilesJob(streets, { landscape, index, route });   // [audit-A] pinned dips and deck steps eased (before the junction passes see them)
  yield* liftOverPondsJob(streets, landscape);   // [6.5] no street, path or sidewalk at or under a pond's water
  landscape._streets = streets;
  // [junctions] real intersection geometry: street heights inside junctions, trims, the junction surfaces
  if (landscape.junctions) {
    yield* joinCrossingsJob(streets);   // [junctions] streets crossing at one level with no shared node: give them one
    yield* densifyAlongsideJob(streets);   // [junctions] (finer points where carriageways run side by side, for the trims below)
    yield* clearOverpassesJob(streets, { route, index, roadWidth: ROAD_WIDTH });   // [junctions] decks over the road clear the rider
    yield* landFreeDeckEndsJob(streets, { route, index, landscape });   // [w2-meets] a deck end that meets nothing lands on the ground
    yield* alignAlongRouteJob(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] streets alongside the road: flush with it
    yield* trimAtRouteJob(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] …or beside it at another level: kept off its shoulder
    yield* resolveOverlapsJob(streets, landscape);   // [junctions] [w2-meets] carriageways side by side or merging: drawn as their union (gores)
    yield* followMovedNodesJob(streets);   // [w2-meets] streets joining lifted decks and flush streets follow them before junctions are planned
    landscape._junctions = yield* planJunctionsJob(streets, { route, index, end, routeDist: landscape.routeDist, roadWidth: ROAD_WIDTH,
      onRouteBridge: (s, m) => landscape.routeBridges.some((b) => s > b.fromM - m && s < b.toM + m), liftOf: (k) => .1 + streetSlots(landscape, streets)[k] * .02 }, landscape.junctions);
    yield* keepUnderRoadJob(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] nothing over the road
    yield* followMovedNodesJob(streets);   // [junctions] paths, side streets and decks meet the moved ones at their height
    yield* resolveOverlapsJob(streets, landscape, { final: true });   // [w2-meets] again: heights moved since (decks and their links)
    yield* keepUnderRoadJob(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [junctions] (and still nothing over the road)
    yield* hideCrossingsAtRouteJob(streets, { route, index, landscape, roadWidth: ROAD_WIDTH });   // [w2-meets] crossings at another level: under the road's bank
    yield* dropCutStubsJob(streets);   // [finish] stubs cut away at one end aren't drawn
    syncDeckJoins(streets);   // [audit-E1]
    yield* fairStreetProfilesJob(streets, { landscape, index, route });   // [audit-A] …and again: what the passes above moved
    yield* junctionTopsJob(landscape._junctions, streets, landscape.routeDist, ROAD_WIDTH);   // [junctions] mouths at the streets' final heights
  }
  return streets;
}
