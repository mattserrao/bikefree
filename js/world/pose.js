// Where the rider is drawn along a route: shared by the 3D world and the course QC sweep
// (tools/qc_course.mjs), so the QC checks exactly what the app renders. Plain numbers, no three.js.
import { wrapDist } from '../gpx.js';
import { headingSpan } from '../routes.js';

export const ROAD_WIDTH = 7;
export const LANE_OFFSET = ROAD_WIDTH * 0.22;   // rider sits right of the centre line
export const ROAD_LIFT = 0.12;                  // road surface above the route line

/** Point on the route centre line at distance s, in the local frame: {x, y, z}. */
export function routePoint(route, index, s) {
  const x = wrapDist(route, s);
  const i = Math.min(route.dist.length - 2, Math.floor(x / 10));
  const span = route.dist[i + 1] - route.dist[i] || 1;
  const f = Math.min(1, Math.max(0, (x - route.dist[i]) / span));
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
export function riderPose(route, index, s, lane = LANE_OFFSET / ROAD_WIDTH) {
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
  if (turn && Math.abs(x - turn) < 10) {
    // U-turn at the far end: drift from the outbound lane to the return lane over the last/first 10 m.
    right = flatRight(routePoint(route, index, turn - 12), routePoint(route, index, turn));
    lateral = laneM * Math.max(-1, Math.min(1, (turn - x) / 10));
  } else if (turn && (x < 10 || total - x < 10)) {
    // …and the same at the start, where the return leg turns back onto the outbound one.
    right = flatRight(routePoint(route, index, 0), routePoint(route, index, 12));
    lateral = laneM * Math.max(-1, Math.min(1, (x < 10 ? x : x - total) / 10));
  }
  const pos = { x: p.x + right.x * lateral, y: p.y + ROAD_LIFT, z: p.z + right.z * lateral };
  return { pos, fwd, flat, right, lateral, centre: p };
}
