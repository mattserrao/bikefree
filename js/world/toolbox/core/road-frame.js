// Toolbox core: the route's road frame — where the centre line and the rider's lane are at a distance along the route,
// and the lean into a turn. Plain numbers, no three.js: shared by the 3D world, its kits and the course QC sweep
// (tools/qc_course.mjs), so the QC checks exactly what the app renders.
// [review 27 Nov] Moved from js/world/pose.js (which re-exports it all) so the toolbox imports nothing from the app's world.
import { wrapDist } from '../../../gpx.js';   // (the GPX route's own distance rule: a pure leaf module — TOOLBOX.md, the import rule)
import { curveOn, curveXZ } from './road-align.js';   // [road-align]

export { wrapDist };
export const ROAD_WIDTH = 7;
export const LANE_OFFSET = ROAD_WIDTH * 0.22;   // rider sits right of the centre line
export const ROAD_LIFT = 0.12;                  // road surface above the route line
export const PACER_LANE = 0.07;                 // the pacer: a bike-width further in, so you can ride alongside or pass

/**
 * The span [behind, ahead] (route metres) the heading at a distance is taken over: `look` m either side, kept on the
 * leg it's on (a there-and-back's U-turn) and inside an open route's ends.
 * [review 27 Nov] The same as js/routes.js headingSpan (test/toolbox-boundary.test.mjs checks they agree); routes.js
 * should re-export this one (it is the app's file, not the toolbox's).
 */
export function headingSpan(route, distance, look = 6) {
  const x = wrapDist(route, distance);
  if (route.turnS) {
    const start = x <= route.turnS ? 0 : route.turnS;
    const end = x <= route.turnS ? route.turnS : route.total;
    return [Math.max(start, x - look), Math.min(end, x + look)];
  }
  return route.closed ? [x - look, x + look] : [Math.max(0, x - look), Math.min(route.total, x + look)];
}
const DRIFT_M = 10, BLEND_M = 10;              // U-turn lane change, then hand-back to the road's direction

/** Point on the route centre line at distance s, in the local frame: {x, y, z}. */
export function routePoint(route, index, s) {
  const x = wrapDist(route, s);
  const i = Math.min(route.dist.length - 2, Math.floor(x / 10));
  const span = route.dist[i + 1] - route.dist[i] || 1;
  const f = Math.min(1, Math.max(0, (x - route.dist[i]) / span));
  if (curveOn(route)) { const c = curveXZ(index, i, f); return { x: c.x, y: route.ele[i] + (route.ele[i + 1] - route.ele[i]) * f, z: c.z }; }   // [road-align]
  return {
    x: index.xs[i] + (index.xs[i + 1] - index.xs[i]) * f,
    y: route.ele[i] + (route.ele[i + 1] - route.ele[i]) * f,
    z: index.zs[i] + (index.zs[i + 1] - index.zs[i]) * f,
  };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const flatRight = (a, b) => { const f = unit({ x: b.x - a.x, y: 0, z: b.z - a.z }); return { x: -f.z, y: 0, z: f.x }; };

/**
 * The rider's pose at distance s: position (right-hand lane, drifting across at U-turns),
 * forward direction (3D), flat forward and right vectors, and the lateral offset used.
 * `lane` is the offset right of the centre line as a fraction of the road width (the pacer rides further in).
 */
export function riderPose(route, index, s, lane = LANE_OFFSET / ROAD_WIDTH, { uturns = true } = {}) {
  const total = route.total;
  const p = routePoint(route, index, s);
  const turn = route.turnS;
  const [behindS, aheadS] = headingSpan(route, s);
  const x = wrapDist(route, s);
  const fwd = unit(sub(routePoint(route, index, aheadS), routePoint(route, index, behindS)));
  const flat = unit({ x: fwd.x, y: 0, z: fwd.z });
  let right = { x: -flat.z, y: 0, z: flat.x };
  const laneM = ROAD_WIDTH * lane;
  let lateral = laneM;
  // U-turns (at the far end, and at the start where the return leg turns back onto the outbound one):
  // over the last/first 10 m the rider drifts across from one lane to the other along a fixed sideways
  // direction; over the 10 m beyond that, that direction blends into the road's own, so there is no hop
  // where the drift starts even when the road bends there.
  const reach = DRIFT_M + BLEND_M;
  // (a ride network's path turns by itself at junctions: js/network.js passes uturns: false)
  const atFar = uturns && !!turn && Math.abs(x - turn) < reach;
  const atStart = uturns && !!turn && !atFar && (x < reach || total - x < reach);
  if (atFar || atStart) {
    const u = atFar ? turn - x : (x < total / 2 ? x : x - total);   // + before the U-turn, − after it
    const fixed = atFar
      ? flatRight(routePoint(route, index, turn - 12), routePoint(route, index, turn))
      : flatRight(routePoint(route, index, 0), routePoint(route, index, 12));
    const k = Math.max(-1, Math.min(1, u / DRIFT_M));
    const w = Math.max(0, Math.min(1, (Math.abs(u) - DRIFT_M) / BLEND_M));   // 0 in the drift, 1 past the blend
    const v = {
      x: fixed.x * laneM * k * (1 - w) + right.x * laneM * w,
      z: fixed.z * laneM * k * (1 - w) + right.z * laneM * w,
    };
    lateral = Math.hypot(v.x, v.z);
    right = lateral > 1e-9 ? { x: v.x / lateral, y: 0, z: v.z / lateral } : right;
  }
  const pos = { x: p.x + right.x * lateral, y: p.y + ROAD_LIFT, z: p.z + right.z * lateral };
  return { pos, fwd, flat, right, lateral, centre: p };
}

// ------------------------------------------------------------------------------------------- lean (PLAN 7.5)
// The rider and bike lean into turns (the camera stays level): roughly the physical lean angle of a bike holding a
// curve, φ = atan(v² / (g·r)) — sharper turns and more speed lean more, nothing when stopped — capped, and eased in
// and out (a first-order response, `tauS`) so it never snaps. The turn is the drawn path's own: three poses `spanM`
// apart round the rider (route curves, the curves through a network's junctions and U-turns alike). 10 m: the routes'
// sample spacing, so a line drawn as a polygon of 10 m chords reads as its circle wherever the rider is along it (a
// shorter span sees each corner twice as sharp and the chords between them straight: the lean would wobble).
// (25 km/h: a 10 m radius → 26°, a 30 m radius → 9°; 40 km/h on a 30 m radius → 23°; the cap 38° below a ~6.3 m radius at 25 km/h)
export const LEAN = { g: 9.81, maxDeg: 38, tauS: 0.4, spanM: 10 };

/**
 * Signed curvature (1/m; + turning right, − left) of the flat path a → b → c ({x, z} points in the world frame,
 * where right of a heading (fx, fz) is (−fz, fx), as riderPose's `right`). 0 for a straight or degenerate path.
 */
export function pathCurvature(a, b, c) {
  const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z;
  const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  // the angle turned (toward the right is +), over the arc between the chords' midpoints
  const turn = Math.atan2(vx * -uz + vz * ux, vx * ux + vz * uz);
  return turn / ((lu + lv) / 2);
}

/** The lean angle (radians; + to the right) for speed (m/s) through a curve of signed curvature (1/m): atan(v²κ/g), capped. */
export function leanTarget(speed, curvature) {
  const v = Math.max(0, speed || 0);
  if (!v || !curvature || !Number.isFinite(curvature)) return 0;
  const max = (LEAN.maxDeg * Math.PI) / 180;
  return Math.sign(curvature) * Math.min(max, Math.atan((v * v * Math.abs(curvature)) / LEAN.g));
}

/** Ease the lean shown toward the target over dt seconds (first order, time constant tauS); capped. */
export function stepLean(current, target, dt, tauS = LEAN.tauS) {
  const max = (LEAN.maxDeg * Math.PI) / 180;
  const k = dt > 0 ? 1 - Math.exp(-dt / tauS) : 0;
  const x = (current || 0) + (target - (current || 0)) * k;
  return Math.max(-max, Math.min(max, x));
}

/**
 * The lean target at distance s along a path: `poseAt(s)` → {pos: {x, z}} (riderPose, or a network path's pose)
 * sampled `spanM` either side of s (clamped at `minS`), at `speed` m/s.
 */
export function leanAlong(poseAt, s, speed, { minS = -Infinity, spanM = LEAN.spanM } = {}) {
  if (!(speed > 0)) return 0;
  const s0 = Math.max(minS, s - spanM), s2 = Math.max(s0 + 0.5, s + spanM);
  const at = (x) => { const p = poseAt(x).pos; return { x: p.x, z: p.z }; };   // (copied: poseAt may reuse its result)
  const a = at(s0), b = at(s), c = at(s2);
  return leanTarget(speed, pathCurvature(a, b, c));
}
