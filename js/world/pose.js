// Where the rider is drawn along a route: shared by the 3D world and the course QC sweep
// (tools/qc_course.mjs), so the QC checks exactly what the app renders. Plain numbers, no three.js.
// [review 27 Nov] The road frame (road width and lift, the lanes, routePoint, riderPose, the lean) lives in the toolbox's
// core (toolbox/core/road-frame.js) and is re-exported here; the chase camera stays (the app's own).
export * from './toolbox/core/road-frame.js';

// The chase camera (world._updateCamera): metres behind and above the rider, and the point it aims at
// (ahead along the road, a little low so the rider sits above the HUD strip). It is kept CHASE.ground m
// above the ground. Shared with the QC tools so they check the camera the app uses.
// Three choices (Settings → Camera). CHASE is the default, "closest" (PLAN 6.10): the rider's back wheel just above
// the bottom of the screen's open view (over the HUD strip, desktop and phone), the rider ~1.4× bigger than "close".
// 7.2: closer (2.3 → 2.0 m back) and higher (1.5 → 1.7 m), aimed ~28° down so the back wheel almost touches the
// power bar (measured at 1440×900 and 390×844 with the HUD on); the horizon sits near the top of the screen.
// 7.2b (user's Zwift reference, 19 Nov): a Zwift-style chase instead — 6.3 m back, 2.35 m up, a narrower 50° view,
// aimed ~8° down: the rider ~26 % of the screen height, the back wheel just at the power bar, the horizon ~43 % down.
// "close" (ride-feel-test, the default before 6.10): 3.3 m back and lower, ~1.3× bigger than classic; world.js adds a
// speed-widened field of view and a little lag on acceleration. CHASE_CLASSIC is the earlier fixed 4.5 m camera.
export const CHASE_CLASSIC = { back: 4.5, up: 2.1, ahead: 8, lookUp: -0.6, ground: 1.6, fov: 62, speedFov: 0, pull: 0, buzz: 0 };
export const CHASE_CLOSE = { back: 3.3, up: 1.8, ahead: 7, lookUp: -0.4, ground: 1.6, fov: 58, speedFov: 10, pull: 0.25, buzz: 0.01 };
export const CHASE_CLOSEST = { back: 6.3, up: 2.35, ahead: 8, lookUp: 1.05, ground: 1.4, fov: 50, speedFov: 0, pull: 0, buzz: 0 };   // (user, 19 Nov: the distance stays the same as you speed up — no pull-back, no speed-widened view — and no road shake)
export const CAMERAS = { closest: CHASE_CLOSEST, close: CHASE_CLOSE, classic: CHASE_CLASSIC };
export const DEFAULT_CAMERA = 'close';   // (user, 23 Nov: "ensure the default camera is close")
export const CHASE = CAMERAS[DEFAULT_CAMERA];

/**
 * The chase camera's follow (user, 22 Nov: "the cyclist should not pull away from the camera at higher speeds —
 * the camera locked distance-wise behind the rider"). The old follow eased the camera's *position* toward its spot,
 * so it trailed by about speed / 3.5 m (3–4 m extra at 40 km/h). This eases only the camera's *offset from the rider*
 * (its swing round the rider on a turn, its height on a grade change), then puts it back exactly `back` m behind the
 * rider on the level: the distance is the same at every speed. `world`: its camera, camTarget and _chaseOff are used.
 * pos, look: where the camera and its aim want to be this frame; riderPos: the rider (all {x, y, z}); floorAt(x, z):
 * the lowest the camera may sit there (null: none, as underground).
 */
export function lockedChase(world, riderPos, pos, look, dt, back, floorAt = null) {
  const k = 1 - Math.exp(-Math.min(Math.max(dt, 0), 0.1) * 3.5), kl = 1 - Math.exp(-Math.min(Math.max(dt, 0), 0.1) * 5);
  const O = (world._chaseOff ||= { x: pos.x - riderPos.x, y: pos.y - riderPos.y, z: pos.z - riderPos.z, lx: look.x - riderPos.x, ly: look.y - riderPos.y, lz: look.z - riderPos.z });
  O.x += (pos.x - riderPos.x - O.x) * k; O.y += (pos.y - riderPos.y - O.y) * k; O.z += (pos.z - riderPos.z - O.z) * k;
  O.lx += (look.x - riderPos.x - O.lx) * kl; O.ly += (look.y - riderPos.y - O.ly) * kl; O.lz += (look.z - riderPos.z - O.lz) * kl;
  // the level distance held at exactly `back` (a swing round a turn eases; the distance never stretches)
  const h = Math.hypot(O.x, O.z) || 1, s = back / h;
  const cx = riderPos.x + O.x * s, cz = riderPos.z + O.z * s;
  let cy = riderPos.y + O.y;
  const f = floorAt?.(cx, cz);   // (the lowest the camera may sit there: the ground + K.ground; null: no floor)
  if (f != null && cy < f) cy = f;
  world.camera.position.set(cx, cy, cz);
  world.camTarget.set(riderPos.x + O.lx, riderPos.y + O.ly, riderPos.z + O.lz);
}
