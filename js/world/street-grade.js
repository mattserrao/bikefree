// Main-street cross-section for the street & facade kit (js/world/street-kit.js): where the route runs as a
// city street in one of the scene's kit zones, the ground beside it is graded to the sidewalk's level instead
// of the half-metre-lower bank the city landscape gives every road (city-landscape.js: routeHeightAt), so the
// curb, the sidewalks, the buildings, the lamps, the trees and the people all stand on one level, and the road
// sits between its curbs instead of on a raised wall.
//
//   carriageway  |d| < curb            the route's road (ROAD_LIFT over the route line) and its parking lanes
//   curb         curb … curb + 0.6     the kit's curb face, CURB_H high
//   sidewalk     curb + 2.5 … +14     ground = sidewalk top − 6 cm (hidden under the kit's slabs; buildings stand on it)
//   ramp         curb + 0.6 … +2.5    ground eases up from the old bank (a 6 m ground mesh can't step at the curb)
//   beyond       +14 … +32            eases back to the terrain
//
// Other streets (cross streets, alleys) keep their own grading: within 4–10 m of their carriageways the
// sidewalk grade fades out, so no street is buried. Their ends inside a junction belong to the junctions module.
// Pure functions (no three.js): the city landscape, the QC sweep and the renderer all see the same ground.
import { ROAD_WIDTH, ROAD_LIFT } from './pose.js';

export const CURB_H = .15;                          // sidewalk top above the carriageway
export const ROUTE_CURB = ROAD_WIDTH / 2 + 2.4;     // default curb line from the route's centre: lanes + a parking lane
const STREET_W = [15, 7.5, 13, 11, 9.5, 7.5, 9, 5, 3.4];   // (city-landscape.js STREET_W; kept here to stay import-free)
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The scene's street-kit settings, normalised; null when the scene doesn't use the kit. Zones:
 *   { name, style, fromM, toM, widthM: 80, parking: false, sidewalkM: 3, curbM: ROUTE_CURB, grade: true, trees: 0 }
 * `curbM`: the route's curb line from its centre (the asphalt between the lanes and the curb is the kit's);
 * `grade`: the sidewalk-level ground above; `trees`: street-tree spacing in metres (0: none).
 */
export function streetKitConfig(scene) {
  const k = scene?.streetKit;
  if (!k) return null;
  const zones = (k.zones || (scene.mainStreets || []).map((m) => ({ ...m, style: 'victorian', parking: true })))
    .map((z) => ({ widthM: 80, parking: false, sidewalkM: 3, curbM: ROUTE_CURB, grade: true, trees: 0, ...z }));
  return { fromM: 0, toM: Infinity, rangeM: 220, ...k, zones };
}

/** A kit zone's curb line (metres from the route's centre) at outbound distance s, or null outside the zones. */
export function zoneCurbAt(cfg, s) {
  const z = cfg?.zones.find((q) => s >= q.fromM && s <= q.toM);
  return z ? z.curbM : null;
}
/** The kit's sidewalk top beside the route where the route line is at height y. */
export const walkTopAt = (y) => y + ROAD_LIFT + CURB_H;
/** The route's curb line at outbound distance s: the zone's, else ROUTE_CURB. */
export function routeCurbAt(cfg, s) { return zoneCurbAt(cfg, s) ?? ROUTE_CURB; }

/**
 * The grading function for CityLandscape.heightAt: (x, z, h, r) → h, where r = routeDist(x, z). Null when
 * no zone grades. `deps`: { data, decoded, route, end, outbound, routeKindAt, onRouteBridge, routeDist }.
 */
export function makeStreetGrade(scene, deps) {
  const cfg = streetKitConfig(scene);
  const zones = cfg?.zones.filter((z) => z.grade);
  if (!zones?.length) return null;
  const { route, outbound, routeKindAt, onRouteBridge, routeDist } = deps;
  // the city's street centrelines (raw, so no heights are needed: heightAt itself runs while streets are built)
  let grid = null;
  const segs = () => {
    if (grid) return grid;
    grid = new Map();
    const S = deps.data.streets, D = deps.decoded;
    if (!S) return grid;
    const u8 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
    const starts = new Uint32Array(u8(S.starts)), xy = new Int16Array(u8(S.xy));
    for (let k = 0; k < S.count; k++) {
      const cls = S.meta[k * 3], bridge = S.meta[k * 3 + 1] & 1;
      if (bridge || cls > 7) continue;   // decks keep their heights; footpaths follow the ground
      const w = STREET_W[cls] / 2;
      let p = D.local(xy[starts[k] * 2], xy[starts[k] * 2 + 1]);
      for (let i = starts[k] + 1; i < starts[k + 1]; i++) {
        const q = D.local(xy[i * 2], xy[i * 2 + 1]), seg = { ax: p.x, az: p.z, bx: q.x, bz: q.z, w, own: null };
        const r = w + 11;
        for (let gx = Math.floor((Math.min(p.x, q.x) - r) / 24); gx <= Math.floor((Math.max(p.x, q.x) + r) / 24); gx++)
          for (let gz = Math.floor((Math.min(p.z, q.z) - r) / 24); gz <= Math.floor((Math.max(p.z, q.z) + r) / 24); gz++) {
            const key = gx * 65536 + gz; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(seg);
          }
        p = q;
      }
    }
    return grid;
  };
  /** Is this segment the route's own street (runs along the route, its centreline within 3.5 m of it)? */
  const own = (g) => {
    if (g.own != null) return g.own;
    const mx = (g.ax + g.bx) / 2, mz = (g.az + g.bz) / 2, r = routeDist(mx, mz), l = Math.hypot(g.bx - g.ax, g.bz - g.az) || 1;
    if (!r || r.d > 3.5) return (g.own = false);
    const X = deps.index.xs, Z = deps.index.zs, i = r.i, tx = X[i + 1] - X[i], tz = Z[i + 1] - Z[i], tl = Math.hypot(tx, tz) || 1;
    return (g.own = Math.abs(((g.bx - g.ax) * tx + (g.bz - g.az) * tz) / (l * tl)) > .85);
  };

  return (x, z, h, r) => {
    if (!r || r.d > 46) return h;
    const s = route.dist[outbound(r.i)];
    const zone = zones.find((q) => s > q.fromM - 30 && s < q.toM + 30);
    if (!zone) return h;
    const curb = zone.curbM;
    if (r.d < curb + .6) return h;
    if (routeKindAt(s) !== 'road' || onRouteBridge(s, 20)) return h;
    let w = ss(curb + .6, curb + 2.5, r.d) * (1 - ss(curb + 14, curb + 32, r.d)) * ss(zone.fromM - 30, zone.fromM, s) * (1 - ss(zone.toM, zone.toM + 30, s));
    if (w <= 0) return h;
    for (const g of segs().get(Math.floor(x / 24) * 65536 + Math.floor(z / 24)) || []) {
      const dx = g.bx - g.ax, dz = g.bz - g.az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - g.ax) * dx + (z - g.az) * dz) / l2));
      const edge = Math.hypot(g.ax + dx * t - x, g.az + dz * t - z) - g.w;
      if (edge > 10 || own(g)) continue;
      w *= ss(4, 10, edge);
      if (w <= 0) return h;
    }
    const target = r.y + ROAD_LIFT + CURB_H - .06;
    return h + (target - h) * w;
  };
}
