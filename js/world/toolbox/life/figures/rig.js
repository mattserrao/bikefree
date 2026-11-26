// Toolbox figures: the skeletons and the motion clips, authored as keyframe curves and solved with two-bone IK.
// `npm run figures` (tools/build_figures.mjs) bakes every clip into figures/clips.js: per frame, per bone, one
// rotation and one translation. The shader plays them back from a small float texture (people.js), so a whole
// crowd animates in its vertex shader with no CPU work per frame. Edit the clips here, then rebuild.
//
// Space: metres, Y up, +Z forward (the way a figure faces), the figure's left is +X. Rest pose: standing straight,
// arms down. Bone rotations are local (relative to the parent), Euler 'XYZ'; pitch about X (+X tips the top of a
// bone forward), abduction about Z (+Z swings a hanging limb toward +X).
import * as THREE from '../../../../../vendor/three.js';

export const FRAMES = 24;   // keyframes per clip (one loop); the shader interpolates between them

// person rig (adult, height scale 1 = about 1.76 m to the top of the head); bike bones ride along for cyclists
export const BONE = {
  ROOT: 0, PELVIS: 1, CHEST: 2, HEAD: 3, L_UPPER: 4, L_FORE: 5, R_UPPER: 6, R_FORE: 7,
  L_THIGH: 8, L_SHIN: 9, L_FOOT: 10, R_THIGH: 11, R_SHIN: 12, R_FOOT: 13, BIKE_FRONT: 14, BIKE_REAR: 15, CRANK: 16,
};
export const BONES = 17;
export const PERSON = {
  parent: [-1, 0, 1, 2, 2, 4, 2, 6, 1, 8, 9, 1, 11, 12, 0, 0, 0],
  pivot: [
    [0, 0, 0], [0, .92, 0], [0, 1.02, 0], [0, 1.47, 0],
    [.19, 1.40, 0], [.205, 1.13, 0], [-.19, 1.40, 0], [-.205, 1.13, 0],
    [.095, .90, 0], [.10, .49, .01], [.10, .085, 0], [-.095, .90, 0], [-.10, .49, .01], [-.10, .085, 0],
    [0, .34, .52], [0, .34, -.50], [0, .29, -.03],
  ],
};
// dog rig (a medium dog, shares the texture's columns: bones 0–7)
export const DOG_BONE = { ROOT: 0, BODY: 1, HEAD: 2, TAIL: 3, FL: 4, FR: 5, BL: 6, BR: 7 };
export const DOG = {
  parent: [-1, 0, 1, 1, 1, 1, 1, 1],
  pivot: [[0, 0, 0], [0, .42, 0], [0, .50, .25], [0, .49, -.27], [.075, .37, .19], [-.075, .37, .19], [.075, .37, -.19], [-.075, .37, -.19]],
};

// the bike under a cyclist (shared with people.js, which builds it)
export const BIKE = { wheelR: .34, rear: [0, .34, -.50], front: [0, .34, .52], bb: [0, .29, -.03], crank: .17, gear: 2.5,
  saddle: [0, .93, -.31], bars: [.2, .99, .40] };
// where a figure's hands hold things (people.js builds the props there)
export const HOLD = { stroller: { handle: [0, .96, .56] }, leash: { hand: [.30, .86, .24], dog: [.55, 0, .50] } };

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const E = new THREE.Euler();
const qe = (x = 0, y = 0, z = 0) => Q().setFromEuler(E.set(x, y, z, 'XYZ'));
const deg = Math.PI / 180;
const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const bump = (x, c, w) => { const d = (fract(x - c + .5) - .5) / w; return Math.exp(-d * d); };   // periodic bell

/** One frame's skeleton: set rotations top-down, then read world rotation and pivot of every bone. */
class Pose {
  constructor(rig) {
    this.rig = rig; const n = rig.parent.length;
    this.rest = rig.pivot.map((p) => V(...p));
    this.local = Array.from({ length: n }, () => Q());
    this.wq = Array.from({ length: n }, () => Q());
    this.wp = this.rest.map((p) => p.clone());
    this.rootPos = null;   // pelvis (bone 1) world pivot, when set
  }
  _update(b) {
    const p = this.rig.parent[b];
    if (p < 0) { this.wq[b].copy(this.local[b]); this.wp[b].copy(this.rest[b]); return; }
    this.wq[b].multiplyQuaternions(this.wq[p], this.local[b]);
    if (b === 1 && this.rootPos) this.wp[b].copy(this.rootPos);
    else this.wp[b].copy(this.rest[b]).sub(this.rest[p]).applyQuaternion(this.wq[p]).add(this.wp[p]);
  }
  /** Set a local rotation (Euler XYZ) and update this bone's world transform (parents must be up to date). */
  set(b, x = 0, y = 0, z = 0) { this.local[b].copy(qe(x, y, z)); this._update(b); return this; }
  setQ(b, q) { this.local[b].copy(q); this._update(b); return this; }
  /** Set a bone's world rotation (its local is solved from the parent). */
  setWorld(b, qw) { const p = this.rig.parent[b]; this.local[b].copy(this.wq[p]).invert().multiply(qw); this._update(b); return this; }
  pelvis(pos, x = 0, y = 0, z = 0) { this.rootPos = V(...pos); return this.set(1, x, y, z); }
  /** Where a rest-space point on bone b is now. */
  at(b, p) { return V(...p).sub(this.rest[b]).applyQuaternion(this.wq[b]).add(this.wp[b]); }
  /**
   * Two-bone IK: upper (pivot at its rest pivot), lower, reaching `target` (world, where the lower bone's
   * end point `endRest` should go), the middle joint bending toward `pole` (a world direction).
   * kneeLike: the lower bone bends backward (knees) rather than forward (elbows).
   */
  ik(upper, lower, endRest, target, pole, kneeLike = false) {
    this._update(upper);
    const S = this.wp[upper], Lu = this.rest[lower].distanceTo(this.rest[upper]), Ll = V(...endRest).distanceTo(this.rest[lower]);
    const T = target.clone(), d0 = T.clone().sub(S), d = Math.min(Math.max(d0.length(), Math.abs(Lu - Ll) + 1e-3), Lu + Ll - 1e-4);
    const dir = d0.normalize();
    const cosA = Math.max(-1, Math.min(1, (Lu * Lu + d * d - Ll * Ll) / (2 * Lu * d))), a = Math.acos(cosA);
    const cosB = Math.max(-1, Math.min(1, (Lu * Lu + Ll * Ll - d * d) / (2 * Lu * Ll))), bend = Math.PI - Math.acos(cosB);
    const pp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (pp.lengthSq() < 1e-8) pp.set(0, 0, kneeLike ? 1 : -1); pp.normalize();
    const u = dir.clone().multiplyScalar(Math.cos(a)).add(pp.clone().multiplyScalar(Math.sin(a))).normalize();
    // the upper bone's frame: local −Y along the bone, local Z toward the bend's open side
    const perp = dir.clone().sub(u.clone().multiplyScalar(dir.dot(u)));
    if (perp.lengthSq() < 1e-8) perp.copy(pp).negate(); perp.normalize();
    const Y = u.clone().negate(), Z = kneeLike ? perp.clone().negate() : perp.clone(), X = V().crossVectors(Y, Z).normalize();
    Z.crossVectors(X, Y).normalize();
    const qw = Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    this.setWorld(upper, qw);
    this.set(lower, kneeLike ? bend : -bend, 0, 0);
    return this;
  }
  /** Bake: world rotation and translation per bone (world = q · restPoint + t). */
  bake() {
    return this.wq.map((q, b) => { const t = this.wp[b].clone().sub(this.rest[b].clone().applyQuaternion(q)); return [q.x, q.y, q.z, q.w, t.x, t.y, t.z]; });
  }
}

// ---------------------------------------------------------------- feet on the ground
const ANKLE_H = .085, HEEL = -.06, BALL = .13;
/** Ankle position (pelvis-relative x) for a foot whose ground point is `c` (x, z), pitched psi (+ toe up). */
function ankleFrom(x, cz, psi, lift = 0, onBall = false) {
  // toe up: the foot rocks on its heel; heel up: on the ball of the foot (the contact stays put)
  const piv = psi >= 0 && !onBall ? HEEL : BALL, a = -psi;
  const ry = ANKLE_H, rz = -piv;   // ankle relative to the pivot at rest
  const y = ry * Math.cos(a) - rz * Math.sin(a), z = ry * Math.sin(a) + rz * Math.cos(a);
  return V(x, y + lift, cz + piv + z);
}
function legs(P, side, target, psi, bodyYaw = 0) {
  const [th, sh, ft] = side > 0 ? [BONE.L_THIGH, BONE.L_SHIN, BONE.L_FOOT] : [BONE.R_THIGH, BONE.R_SHIN, BONE.R_FOOT];
  const fwd = V(Math.sin(bodyYaw), 0, Math.cos(bodyYaw));
  P.ik(th, sh, PERSON.pivot[ft], target, fwd.clone().add(V(side * .08, 0, 0)), true);
  P.setWorld(ft, qe(-psi, bodyYaw, 0));
}
function arm(P, side, target, pole) {
  const [up, lo] = side > 0 ? [BONE.L_UPPER, BONE.L_FORE] : [BONE.R_UPPER, BONE.R_FORE];
  P.ik(up, lo, [side * .22, .86, .02], target, pole, false);
}
/** Arms by angles: flexion (+ forward), abduction (+ out), elbow bend (+). */
function armAngles(P, side, flex, abd, elbow, twist = 0) {
  const [up, lo] = side > 0 ? [BONE.L_UPPER, BONE.L_FORE] : [BONE.R_UPPER, BONE.R_FORE];
  P.set(up, -flex * deg, twist * deg * side, abd * deg * side); P.set(lo, -elbow * deg, 0, 0);
}

// ---------------------------------------------------------------- locomotion
/**
 * A walking or running gait. stride: metres travelled per loop (two steps). stance: share of the loop each foot
 * is down. The stance foot moves back at exactly the ground speed, so with the right playback rate
 * (rate = speed / stride) the feet don't slide.
 */
function gait(P, t, o) {
  const { stride, stance, lift = .11, bob = .015, height = .893, lean = 3, arms = 22, elbow = 18, toeUp = 10, heel = 32, hipYaw = 5, width = .1, kick = 0 } = o;
  const E2 = stride * stance / 2;
  const foot = (u) => {
    // u: this foot's phase (0 = heel strike)
    if (u < stance) {
      const w = u / stance, cz = E2 - w * 2 * E2;
      const psi = w < .15 ? toeUp * (1 - w / .15) : w > .6 ? -heel * smooth(.6, 1, w) : 0;
      return { a: ankleFrom(0, cz, psi * deg), psi: psi * deg };
    }
    const s = (u - stance) / (1 - stance), e = s * s * (3 - 2 * s);
    const A = ankleFrom(0, -E2, -heel * deg), B = ankleFrom(0, E2, toeUp * deg);
    const a = A.clone().lerp(B, e); a.y += lift * Math.sin(Math.PI * s) ** .8 + kick * Math.sin(Math.PI * Math.min(1, s * 1.6)) * (1 - s);
    a.z -= kick * .7 * Math.sin(Math.PI * Math.min(1, s * 1.6)) * (1 - s);
    const psi = (-heel + (heel + toeUp) * smooth(0, .8, s)) * deg;
    return { a, psi };
  };
  const midL = stance / 2;
  const y = height + bob * Math.cos(4 * Math.PI * (t - midL)) * (o.flight ? -1 : 1);   // walking: highest over the stance foot
  const yaw = -hipYaw * deg * Math.cos(TAU * t);   // the hip of the swinging leg comes forward
  const roll = 2.5 * deg * Math.sin(4 * Math.PI * t);
  P.pelvis([0, y, 0], o.pelvisLean ? o.pelvisLean * deg : 0, yaw, roll);
  P.set(BONE.CHEST, (lean + 1.2 * Math.cos(4 * Math.PI * t)) * deg, -yaw * 1.6, -roll * .6);
  P.set(BONE.HEAD, (-lean * .8 - (o.pelvisLean || 0)) * deg, yaw * .6, roll * .3);
  for (const side of [1, -1]) {
    const u = fract(t + (side > 0 ? 0 : .5)), f = foot(u);
    // into the pelvis' turned frame: the feet stay on lines under the hips
    const tgt = f.a.clone(); tgt.x = side * width;
    legs(P, side, tgt, f.psi);
    if (o.armsFn) continue;
    // arms swing against the same-side leg
    const swing = -Math.cos(TAU * (u - .02));
    armAngles(P, side, swing * arms, 7, elbow + Math.max(0, swing) * (o.elbowSwing ?? elbow * .5));
  }
  if (o.armsFn) o.armsFn(P, t);
}

// ---------------------------------------------------------------- standing
function stand(P, t, o = {}) {
  const { sway = .018, height = .918, width = .11, lean = 0, breathe = 1.2, headYaw = 6, feetZ = [.03, -.02] } = o;
  const s = Math.sin(TAU * t);
  P.pelvis([sway * s, height + (o.bounce || 0), o.z || 0], 0, (o.yaw || 0) * deg, -2.2 * deg * s);
  P.set(BONE.CHEST, (lean + breathe * Math.sin(TAU * t * (o.breaths || 3))) * deg, (o.chestYaw || 0) * deg, 1.4 * deg * s);
  P.set(BONE.HEAD, (o.nod || 0) * deg, (o.headYawFn ? o.headYawFn(t) : headYaw * Math.sin(TAU * t + 1)) * deg, 0);
  for (const side of [1, -1]) legs(P, side, ankleFrom(side * width, side > 0 ? feetZ[0] : feetZ[1], 0), 0);
}

// ---------------------------------------------------------------- clips
// each: frames(t) poses the skeleton; seconds: natural loop length; stride: metres per loop (locomotion)
/** Where a fisher's hands hold the rod (chest bone's rest frame; people.js builds the rod from here). */
export const FISH_HAND = [-.06, 1.08, .34];
export const CLIPS = [
  { name: 'idle', seconds: 5, pose(P, t) {
    stand(P, t);
    for (const s of [1, -1]) armAngles(P, s, 3 + 2 * Math.sin(TAU * t + s), 7, 12);
  } },
  { name: 'look', seconds: 8, pose(P, t) {
    // hands behind the back, looking around slowly
    stand(P, t, { sway: .01, headYawFn: (u) => 38 * Math.sin(TAU * u), chestYaw: 6 * Math.sin(TAU * t), nod: -4 });
    for (const s of [1, -1]) arm(P, s, P.at(BONE.CHEST, [s * .06, .98, -.16]), V(s * .6, -.3, -.5));
  } },
  { name: 'stroll', seconds: 1.1, stride: 1.0, pose(P, t) { gait(P, t, { stride: 1.0, stance: .62, lift: .08, bob: .012, lean: 1, arms: 12, elbow: 10, hipYaw: 4 }); } },
  { name: 'walk', seconds: .86, stride: 1.16, pose(P, t) { gait(P, t, { stride: 1.16, stance: .6, lift: .11, bob: .016, lean: 3, arms: 19, elbow: 12 }); } },
  { name: 'jog', seconds: .7, stride: 1.95, pose(P, t) {
    gait(P, t, { stride: 1.95, stance: .36, lift: .2, kick: .2, bob: .03, height: .86, lean: 8, pelvisLean: 4, arms: 30, elbow: 68, elbowSwing: 12, toeUp: 6, heel: 30, hipYaw: 7, flight: true });
  } },
  { name: 'cheer', seconds: 1.2, pose(P, t) {
    const b = Math.max(0, Math.sin(TAU * t)) * .05;
    stand(P, t, { sway: .006, height: .9 + b, breathe: 0, headYaw: 0, nod: -12 });
    for (const s of [1, -1]) armAngles(P, s, 158 + 10 * Math.sin(TAU * t * 2 + s), 26 + 12 * Math.sin(TAU * t * 2 + s * 1.3), 20 + 15 * Math.sin(TAU * t * 2));
  } },
  { name: 'clap', seconds: 1.6, pose(P, t) {
    stand(P, t, { sway: .008, nod: -5, headYaw: 3 });
    const k = .5 + .5 * Math.cos(TAU * t * 4);
    for (const s of [1, -1]) arm(P, s, P.at(BONE.CHEST, [s * (.025 + .11 * k), 1.26, .30]), V(s * .8, -.6, -.1));
  } },
  { name: 'wave', seconds: 1.4, pose(P, t) {
    stand(P, t, { sway: .01, nod: -4, headYaw: 4 });
    armAngles(P, 1, 4, 7, 12);
    P.set(BONE.R_UPPER, -125 * deg, -10 * deg, -38 * deg);
    P.set(BONE.R_FORE, -35 * deg, 0, 26 * deg * Math.sin(TAU * t * 2));
  } },
  { name: 'photo', seconds: 6, pose(P, t) {
    // both hands up holding a phone in front of the face
    stand(P, t, { sway: .008, headYaw: 2, nod: 6, lean: -2 });
    const c = P.at(BONE.CHEST, [0, 1.47, .30]); c.x += .03 * Math.sin(TAU * t);
    for (const s of [1, -1]) arm(P, s, c.clone().add(V(s * .055, 0, 0)), V(s * .7, -.7, -.1));
  } },
  { name: 'phone', seconds: 6, pose(P, t) {
    stand(P, t, { sway: .012, headYaw: 3, nod: 28, lean: 3 });
    const c = P.at(BONE.CHEST, [0, 1.13, .26]);
    arm(P, -1, c.clone().add(V(-.04, 0, 0)), V(-.7, -.7, -.2));
    arm(P, 1, c.clone().add(V(.07, -.02, -.02)), V(.7, -.7, -.2));
  } },
  { name: 'push', seconds: .95, stride: 1.05, pose(P, t) {
    gait(P, t, { stride: 1.05, stance: .62, lift: .09, bob: .012, lean: 7, hipYaw: 3, armsFn: (Q2) => {
      for (const s of [1, -1]) arm(Q2, s, V(s * .2, HOLD.stroller.handle[1], HOLD.stroller.handle[2]), V(s * .6, -.8, -.2));
    } });
  } },
  { name: 'leash', seconds: .95, stride: 1.1, pose(P, t) {
    gait(P, t, { stride: 1.1, stance: .6, lift: .1, bob: .014, lean: 2, hipYaw: 4, armsFn: (Q2, u) => {
      const h = V(...HOLD.leash.hand); h.y += .02 * Math.sin(TAU * u * 2); h.z += .03 * Math.sin(TAU * u);
      arm(Q2, 1, h, V(.6, -.8, -.3));
      const swing = -Math.cos(TAU * (fract(u + .5) - .02));
      armAngles(Q2, -1, swing * 20, 7, 18 + Math.max(0, swing) * 14);
    } });
  } },
  { name: 'flag', seconds: 1.3, pose(P, t) {
    const b = Math.max(0, Math.sin(TAU * t)) * .035;
    stand(P, t, { sway: .008, height: .9 + b, nod: -10, headYaw: 3 });
    arm(P, -1, V(-.27 + .05 * Math.sin(TAU * t), 1.72, .12), V(-.8, -.4, -.4));
    armAngles(P, 1, 70 + 40 * Math.max(0, Math.sin(TAU * t * 2)), 20, 95);
  } },
  { name: 'sit', seconds: 7, pose(P, t) {
    // on a chair (seat about 0.47 m), hands on the knees
    const s = Math.sin(TAU * t);
    P.pelvis([0, .55, -.08], -4 * deg, 0, 1 * deg * s);
    P.set(BONE.CHEST, (-6 + 1.2 * Math.sin(TAU * t * 4)) * deg, 4 * deg * s, 0);
    P.set(BONE.HEAD, 4 * deg, 22 * deg * Math.sin(TAU * t + 2), 0);
    for (const side of [1, -1]) legs(P, side, ankleFrom(side * .13, side > 0 ? .36 : .33, 0), 0);
    for (const side of [1, -1]) arm(P, side, V(side * .15, .62, .26), V(side * .7, -.2, -.6));
  } },
  { name: 'cycle', seconds: .75, stride: 2 * Math.PI * BIKE.wheelR * BIKE.gear, pose(P, t) {
    const th = TAU * t, [, bby, bbz] = BIKE.bb;
    P.set(BONE.CRANK, th, 0, 0);
    P.set(BONE.BIKE_FRONT, th * BIKE.gear, 0, 0); P.set(BONE.BIKE_REAR, th * BIKE.gear, 0, 0);
    P.pelvis([0, .99 + .006 * Math.sin(2 * th), -.31], 26 * deg, 1.5 * deg * Math.sin(th), 1.2 * deg * Math.sin(th));
    P.set(BONE.CHEST, 30 * deg, -2 * deg * Math.sin(th), 0);
    P.set(BONE.HEAD, -44 * deg, 0, 0);
    for (const side of [1, -1]) {
      const a = th + (side > 0 ? 0 : Math.PI);
      const pedal = V(side * .12, bby + BIKE.crank * Math.cos(a), bbz + BIKE.crank * Math.sin(a));
      const psi = (8 + 14 * Math.sin(a)) * deg;   // ankling: toes down at the back of the stroke
      legs(P, side, ankleFrom(side * .12, pedal.z - BALL, psi, 0, true).add(V(0, pedal.y, 0)), psi);
      arm(P, side, V(side * BIKE.bars[0], BIKE.bars[1], BIKE.bars[2]), V(side * .4, -.5, -.8));
    }
  } },
  { name: 'moto', seconds: 2, pose(P, t) {
    // on a motorbike (static, built into the moto model)
    P.pelvis([0, .86, -.30], 18 * deg, 0, 0);
    P.set(BONE.CHEST, 14 * deg, 0, 0); P.set(BONE.HEAD, -22 * deg, 0, 0);
    for (const side of [1, -1]) {
      legs(P, side, V(side * .2, .40, -.06), 0);
      arm(P, side, V(side * .32, 1.02, .34), V(side * .6, -.6, -.6));
    }
  } },
  { name: 'ride', seconds: 6, pose(P, t) {
    // a passenger on a bench seat, looking around
    P.pelvis([0, .52, -.06], -6 * deg, 0, 0);
    P.set(BONE.CHEST, -4 * deg, 0, 0); P.set(BONE.HEAD, -2 * deg, 25 * deg * Math.sin(TAU * t), 0);
    for (const side of [1, -1]) legs(P, side, ankleFrom(side * .13, .34, 0), 0);
    for (const side of [1, -1]) arm(P, side, V(side * .17, .60, .22), V(side * .7, -.2, -.6));
  } },
  // ---- dog clips (dog rig)
  { name: 'fish', seconds: 7, pose(P, t) {
    // standing at the rail or the bank with a rod held out over the water (the rod: the figure's ROD part, on the
    // chest bone, from the hands at FISH_HAND), the line watched; now and then a small twitch of the tip
    const tw = Math.max(0, Math.sin(TAU * t * 2)) ** 8 * .04;
    stand(P, t, { sway: .006, headYaw: 4, nod: 14, breathe: 1, feetZ: [.06, -.06] });
    const h = P.at(BONE.CHEST, FISH_HAND);
    arm(P, -1, V(h.x, h.y + tw, h.z), V(-.6, -.6, -.4));
    arm(P, 1, V(h.x + .1, h.y - .1 + tw * .5, h.z - .12), V(.7, -.7, -.2));
  } },
  { name: 'chat', seconds: 6, pose(P, t) {
    // standing in a group, talking: the weight shifting, one hand gesturing now and then, the head turning between the others
    const g = Math.max(0, Math.sin(TAU * t * 1.5)) ** 2;
    stand(P, t, { sway: .014, headYawFn: (u) => 25 * Math.sin(TAU * u * 1.5 + 1), nod: -2 + 4 * Math.sin(TAU * t * 3), chestYaw: 5 * Math.sin(TAU * t) });
    armAngles(P, -1, 4, 7, 14);
    arm(P, 1, P.at(BONE.CHEST, [.12 + .06 * g, 1.0 + .12 * g, .2 + .1 * g]), V(.8, -.5, -.3));
  } },
  { name: 'dog-walk', rig: 'dog', seconds: .6, stride: .8, pose(P, t) {
    const th = TAU * t;
    P.pelvis([0, .42 + .012 * Math.cos(2 * th), 0], 1.5 * deg * Math.sin(2 * th), 3 * deg * Math.sin(th), 2 * deg * Math.sin(th));
    P.set(2, (-4 + 4 * Math.sin(2 * th + .6)) * deg, 4 * deg * Math.sin(th), 0);
    P.set(3, -35 * deg, 22 * deg * Math.sin(2 * th), 0);
    const leg = (b, ph) => P.set(b, -26 * deg * Math.sin(th + ph), 0, 0);
    leg(4, 0); leg(7, 0); leg(5, Math.PI); leg(6, Math.PI);
  } },
  { name: 'dog-idle', rig: 'dog', seconds: 4, pose(P, t) {
    const th = TAU * t;
    P.set(1, 1 * deg * Math.sin(th * 3), 0, 0);
    P.set(2, (-8 + 5 * Math.sin(th)) * deg, 30 * deg * Math.sin(th + 1), 0);
    P.set(3, -45 * deg, 30 * deg * Math.sin(th * 8), 0);
    for (const b of [4, 5, 6, 7]) P.set(b, 0, 0, 0);
  } },
];
export const CLIP = Object.fromEntries(CLIPS.map((c, i) => [c.name, i]));

/** Bake every clip: Float32Array [clip][frame][bone][q.xyzw, t.xyz]. */
export function bakeClips() {
  const out = new Float32Array(CLIPS.length * FRAMES * BONES * 7);
  CLIPS.forEach((c, ci) => {
    for (let f = 0; f < FRAMES; f++) {
      const rig = c.rig === 'dog' ? DOG : PERSON;
      const P = new Pose(rig);
      for (let b = 0; b < rig.parent.length; b++) P._update(b);
      c.pose(P, f / FRAMES);
      // bones a clip leaves alone keep the identity; recompute world transforms top-down
      for (let b = 0; b < rig.parent.length; b++) P._update(b);
      const baked = P.bake();
      for (let b = 0; b < BONES; b++) {
        const v = baked[b] || [0, 0, 0, 1, 0, 0, 0];
        out.set(v, ((ci * FRAMES + f) * BONES + b) * 7);
      }
    }
  });
  return out;
}
