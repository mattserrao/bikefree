// Where the rider is drawn along a route: shared by the 3D world and the course QC sweep
// (tools/qc_course.mjs), so the QC checks exactly what the app renders. Plain numbers, no three.js.
import { wrapDist } from '../gpx.js';
import { headingSpan } from '../routes.js';
import { curveOn, curveXZ } from './road-align.js';   // [road-align]

export const ROAD_WIDTH = 7;
export const LANE_OFFSET = ROAD_WIDTH * 0.22;   // rider sits right of the centre line
export const ROAD_LIFT = 0.12;                  // road surface above the route line
// The chase camera (world._updateCamera): metres behind and above the rider, and the point it aims at
// (ahead along the road, a little low so the rider sits above the HUD strip). It is kept CHASE.ground m
// above the ground. Shared with the QC tools so they check the camera the app uses.
// Two choices (Settings → Camera). CHASE is the default ("close", ride-feel-test): 3.3 m back and lower, so the
// rider is ~1.3× bigger and the road rushes past closer to the lens; world.js adds a speed-widened field of view
// and a little lag on acceleration. CHASE_CLASSIC is the earlier fixed 4.5 m camera.
export const CHASE_CLASSIC = { back: 4.5, up: 2.1, ahead: 8, lookUp: -0.6, ground: 1.6, fov: 62, speedFov: 0, pull: 0, buzz: 0 };
export const CHASE_CLOSE = { back: 3.3, up: 1.8, ahead: 7, lookUp: -0.4, ground: 1.6, fov: 58, speedFov: 10, pull: 0.25, buzz: 0.01 };
export const CAMERAS = { close: CHASE_CLOSE, classic: CHASE_CLASSIC };
export const CHASE = CHASE_CLOSE;
const DRIFT_M = 10, BLEND_M = 10;               // U-turn lane change, then hand-back to the road's direction

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
