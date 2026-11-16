// The rider + road bike modelled in Blender (tools/build_rider.py → models/rider.json + the atlases),
// animated here. One skinned mesh (one draw call): the app poses its bones every frame.
//   - wheels and crank spin; the shoes ride the pedals (with a little ankling); legs and arms are
//     two-bone IK (hip → ankle, shoulder → wrist on the hoods or the drops)
//   - three postures, eased into one another: seated; standing and pumping on hard climbs (the bike
//     rocks under the rider, hips bob over the pushing leg); and the tuck on descents (flat back, hands
//     in the drops, knees in, pedals level when coasting)
//   - what triggers them: grade + effort (see POSTURE_RULES)
import * as THREE from '../../vendor/three.module.min.js';

const MODEL_URL = new URL('../../models/rider.json', import.meta.url);
const atlasUrl = (file) => new URL(`../../models/${file}`, import.meta.url);

// Stand on climbs of 7 % or more when pushing at least 90 % of FTP; tuck on descents of 4 % or more when
// coasting or soft-pedalling. Looser limits to stay in a posture (so it doesn't flicker), a minimum time
// in each, and standing in bouts like a real rider (sit for a while after ~25 s out of the saddle).
export const POSTURE_RULES = {
  stand: { grade: 7, ftp: 0.9, keepGrade: 5.5, keepFtp: 0.75, maxS: 25, restS: 8 },
  tuck: { grade: -4, ftp: 0.4, cadence: 30, speed: 6, keepGrade: -2.5, keepFtp: 0.55, keepSpeed: 4 },
  dwellS: 1.2,          // minimum time in a posture before changing
  easeS: 0.45,          // posture blend time constant
};

// Pose targets for each posture (model space, three.js axes: x = rider's left, y up, z forward; radians).
const POSTURES = {
  seated: { pelvis: [0, 0, 0], pelvisPitch: 0, chestPitch: 0, headPitch: 0, grip: 0, handPitch: 0, kneeIn: 0, elbowDown: 0 },
  standing: { pelvis: [0, 0.04, 0.22], pelvisPitch: -0.22, chestPitch: -0.1, headPitch: 0.04, grip: 0, handPitch: 0, kneeIn: 0, elbowDown: 0 },
  tuck: { pelvis: [0, -0.012, -0.035], pelvisPitch: 0.3, chestPitch: 0.46, headPitch: -0.1, grip: 1, handPitch: 0.25, kneeIn: 0.45, elbowDown: 0.6 },
};
const KEYS = ['seated', 'standing', 'tuck'];

/** A fresh posture state for stepPosture. */
export function postureState() {
  return { posture: 'seated', forced: null, since: 99, standFor: 0, restFor: 99 };
}

/**
 * Advance the posture state by dt seconds: seated | standing | tuck, from grade + effort (POSTURE_RULES).
 * effort = {grade (%), power (W), ftp (W), cadence (rpm)}; no effort, or stopped, means seated.
 */
export function stepPosture(st, effort, speed, dt) {
  st.since += dt;
  const cur = st.posture;
  if (cur === 'standing') st.standFor += dt; else st.restFor += dt;
  let want = 'seated';
  if (st.forced) want = st.forced;
  else if (effort && speed >= 0.5) {
    const ftp = effort.ftp > 0 ? effort.ftp : 250;
    const g = effort.grade ?? 0, p = effort.power ?? 0, cad = effort.cadence ?? 80;
    const S = POSTURE_RULES.stand, T = POSTURE_RULES.tuck;
    if (cur === 'standing' ? (g >= S.keepGrade && p >= S.keepFtp * ftp) : (g >= S.grade && p >= S.ftp * ftp)) want = 'standing';
    else if (cur === 'tuck' ? (g <= T.keepGrade && speed > T.keepSpeed && p < T.keepFtp * ftp)
      : (g <= T.grade && speed > T.speed && (p < T.ftp * ftp || cad < T.cadence))) want = 'tuck';
    // stand in bouts, like a real rider
    if (want === 'standing' && cur === 'standing' && st.standFor > S.maxS) want = 'seated';
    if (want === 'standing' && cur !== 'standing' && st.restFor < S.restS) want = 'seated';
    if (want !== cur && st.since < POSTURE_RULES.dwellS) want = cur;
  }
  if (want !== cur) {
    if (want === 'standing') st.standFor = 0;
    if (cur === 'standing') st.restFor = 0;
    st.posture = want; st.since = 0;
  }
  return st.posture;
}

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function buildGeometry(m) {
  const pos16 = new Int16Array(b64(m.pos));
  const pos = new Float32Array(pos16.length);
  for (let i = 0; i < pos.length; i++) pos[i] = pos16[i] / 4000;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(b64(m.nrm)), 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(b64(m.uv)), 2, true));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(b64(m.skin)), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(b64(m.weights)), 4, true));
  g.setAttribute('aShade', new THREE.BufferAttribute(new Uint8Array(b64(m.shade)), 2, true));   // baked AO, specular strength
  g.setIndex(new THREE.BufferAttribute(m.idx32 ? new Uint32Array(b64(m.idx)) : new Uint16Array(b64(m.idx)), 1));
  g.computeBoundingSphere();
  return g;
}

/** Semi-realistic shading: the atlas, baked AO, per-vertex specular. The cartoon look leaves it alone. */
function riderMaterial(map) {
  const m = new THREE.MeshPhongMaterial({ map, shininess: 36, specular: new THREE.Color(0.3, 0.3, 0.3) });
  m.userData.keepShading = true;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aShade;\nvarying vec2 vShade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = aShade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vShade;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vShade.x;')
      .replace('#include <specularmap_fragment>', 'float specularStrength = vShade.y;');
  };
  m.customProgramCacheKey = () => 'bf-rider-2';
  return m;
}

/** Soft oval shadow under the bike so it sits on the road. */
function makeShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.02, 0.08);
  m.renderOrder = 3;
  return m;
}

let modelData = null;          // shared by the rider and the pacer
let geometry = null;
const atlases = {};

function loadAtlas(file) {
  return atlases[file] ||= new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(atlasUrl(file).href, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.anisotropy = 4;
      resolve(t);
    }, undefined, () => { delete atlases[file]; reject(new Error(`rider atlas ${file} failed to load`)); });
  });
}

// --------------------------------------------------------------------------------------------- pose maths
const X = new THREE.Vector3(1, 0, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

/** Knee/elbow for a two-bone chain from `a` to target `t` (lengths l1, l2), bending toward `pole`. */
function solve2(a, t, l1, l2, pole, out) {
  const d = _dv.copy(t).sub(a);
  const L = Math.min(l1 + l2 - 1e-4, d.length());
  d.normalize();
  const k = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L))));
  const p = _pv.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
  return out.copy(a).addScaledVector(d, Math.cos(k) * l1).addScaledVector(p, Math.sin(k) * l1);
}
const _pv = new THREE.Vector3(), _dv = new THREE.Vector3();

/** Orthonormal frame (bone direction, plane normal, their cross) as a rotation matrix. */
function frame(dir, n, out) {
  const x = _f1.copy(dir).normalize();
  const y = _f2.copy(n).addScaledVector(x, -n.dot(x)).normalize();
  const z = _f3.crossVectors(x, y);
  return out.makeBasis(x, y, z);
}
const _f1 = new THREE.Vector3(), _f2 = new THREE.Vector3(), _f3 = new THREE.Vector3();

/** Rotation taking a rest frame to the current one: Bcur · Brestᵀ. */
function limbRotation(restFrameT, dir, n, out) {
  return frame(dir, n, out).multiply(restFrameT);
}

/**
 * Load the model. Resolves to {group, update(pos, fwd, crank, speed, dt, effort), setPosture, posture, triangles}.
 * opts.jersey = 'checker' dresses the rider as the pacer (yellow-and-black kit, black bike with yellow accents).
 * effort = {grade (%), power (W), ftp (W), cadence (rpm)} picks the posture; omit it to stay seated.
 */
export async function loadRider(opts = {}) {
  modelData = modelData || fetch(MODEL_URL).then((r) => r.json());
  let data;
  try { data = await modelData; } catch (err) { modelData = null; throw err; }
  if (data.format !== 'bikefree-model-2') throw new Error('Unknown rider model format');
  const checker = opts.jersey === 'checker';
  const map = await loadAtlas(checker ? data.atlas.pacer : data.atlas.rider);
  geometry ||= buildGeometry(data.mesh);

  const R = data.rig;
  const v = (a) => new THREE.Vector3().fromArray(a);
  const J = Object.fromEntries(Object.entries(R.joints).map(([k, a]) => [k, v(a)]));
  const bones = R.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.matrixAutoUpdate = false;
    return bone;
  });
  const B = Object.fromEntries(bones.map((b) => [b.name, b]));
  const inverses = R.bones.map((b) => new THREE.Matrix4().makeTranslation(-b.pivot[0], -b.pivot[1], -b.pivot[2]));
  const mesh = new THREE.SkinnedMesh(geometry, riderMaterial(map));
  mesh.name = checker ? 'pacer-body' : 'rider-body';
  mesh.frustumCulled = false;
  for (const b of bones) mesh.add(b);
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  const group = new THREE.Group();
  group.name = checker ? 'pacer' : 'rider';
  group.add(mesh, makeShadow());

  // Rest frames for the limbs (all bend in the plane through root, target and pole).
  const KNEE_POLE = v(R.kneePole);
  const sides = ['R', 'L'].map((s) => {
    const sign = s === 'R' ? -1 : 1;                    // three.js x of the rider's right side is negative
    const legN = new THREE.Vector3().subVectors(J['ANKLE' + s], J['HIP' + s]).cross(KNEE_POLE).normalize();
    const armPole = v(R.elbowPole[s]);
    const armN = new THREE.Vector3().subVectors(J['WR' + s], J['SH' + s]).cross(armPole).normalize();
    const restT = (a, b, n) => frame(new THREE.Vector3().subVectors(b, a), n, new THREE.Matrix4()).transpose();
    return {
      s, sign, phase: s === 'R' ? 0 : Math.PI, restAngle: R.restCrank + (s === 'R' ? 0 : Math.PI),
      thighT: restT(J['HIP' + s], J['KNEE' + s], legN), shinT: restT(J['KNEE' + s], J['ANKLE' + s], legN),
      upperT: restT(J['SH' + s], J['ELB' + s], armN), foreT: restT(J['ELB' + s], J['WR' + s], armN),
      armPole, ankleFromPedal: new THREE.Vector3().subVectors(J['ANKLE' + s], J['PEDAL' + s]),
      wristFromGrip: new THREE.Vector3().subVectors(J['WR' + s], J['G' + s]),
      bones: { thigh: B['thigh' + s], shin: B['shin' + s], foot: B['foot' + s], upper: B['upperArm' + s], fore: B['forearm' + s], hand: B['hand' + s] },
      hip: new THREE.Vector3(), knee: new THREE.Vector3(), ankle: new THREE.Vector3(), pedal: new THREE.Vector3(),
      sh: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), grip: new THREE.Vector3(),
    };
  });
  const HC = v(R.hc), LB = v(R.lb), NB = v(R.nb), BB = v(R.bb), FH = v(R.frontHub), RH = v(R.rearHub);
  const LEG = R.thigh + R.shin;

  // scratch (no allocations per frame)
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), n1 = new THREE.Vector3();
  const mBike = new THREE.Matrix4(), qBike = new THREE.Quaternion();
  const mRot = new THREE.Matrix4(), mTmp = new THREE.Matrix4();
  const rotP = new THREE.Matrix4(), rotC = new THREE.Matrix4(), rotH = new THREE.Matrix4(), rotHand = new THREE.Matrix4(), rotFoot = new THREE.Matrix4();
  const hc = new THREE.Vector3(), lb = new THREE.Vector3(), nb = new THREE.Vector3();
  const P = { pelvis: [0, 0, 0], pelvisPitch: 0, chestPitch: 0, headPitch: 0, grip: 0, handPitch: 0, kneeIn: 0, elbowDown: 0 };

  const st = { ...postureState(), w: { seated: 1, standing: 0, tuck: 0 }, crankOffset: 0, lastCrank: null, spinF: 0, spinR: 0, t: 0 };

  const setBone = (bone, m) => { bone.matrix.copy(m); bone.matrixWorldNeedsUpdate = true; };
  const place = (bone, at, rot) => { mTmp.copy(rot).setPosition(at); setBone(bone, mTmp); };
  const rotXZ = (pitch, roll, out) => out.makeRotationFromEuler(_e.set(pitch, 0, roll, 'ZYX'));

  function update(pos, fwd, crank, speed, dt, effort = null) {
    group.position.copy(pos);
    group.lookAt(t1.copy(pos).add(fwd));
    st.t += dt;

    // posture + blend weights
    stepPosture(st, effort, speed, dt);
    const k = dt > 0 ? 1 - Math.exp(-dt / POSTURE_RULES.easeS) : 1;
    for (const key of KEYS) st.w[key] += ((key === st.posture ? 1 : 0) - st.w[key]) * k;
    const W = st.w, ws = W.standing, wt = W.tuck;
    for (const f of ['pelvisPitch', 'chestPitch', 'headPitch', 'grip', 'handPitch', 'kneeIn', 'elbowDown']) {
      P[f] = KEYS.reduce((acc, key) => acc + POSTURES[key][f] * W[key], 0);
    }
    for (let i = 0; i < 3; i++) P.pelvis[i] = KEYS.reduce((acc, key) => acc + POSTURES[key].pelvis[i] * W[key], 0);

    // crank: coasting in the tuck brings the pedals level (3 and 9 o'clock)
    const coasting = st.lastCrank !== null && Math.abs(crank - st.lastCrank) < 1e-5;
    st.lastCrank = crank;
    if (coasting && wt > 0.5) {
      const c = crank + st.crankOffset;
      const level = Math.round((c - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      st.crankOffset += (level - c) * (1 - Math.exp(-dt / 0.35));
    }
    const a = crank + st.crankOffset;

    // the bike: rocks side to side under a standing rider, away from the pushing leg
    const roll = -0.12 * Math.sin(a) * ws;
    qBike.setFromAxisAngle(_f3.set(0, 0, 1), roll);
    mBike.makeRotationFromQuaternion(qBike);
    setBone(B.bike, mBike);
    st.spinF += (speed / R.wheelRadius) * dt; st.spinR = st.spinF;
    for (const [bone, hub, spin] of [[B.wheelF, FH, st.spinF], [B.wheelR, RH, st.spinR], [B.crank, BB, a]]) {
      mRot.makeRotationAxis(X, spin).setPosition(hub);
      setBone(bone, mTmp.multiplyMatrices(mBike, mRot));
    }

    // pelvis: blended offset, plus the standing bob and sway over the pushing pedal
    const breathe = Math.sin(st.t * 2.4) * 0.008;
    hc.set(HC.x + P.pelvis[0] - 0.022 * Math.sin(a) * ws, HC.y + P.pelvis[1] + 0.012 * Math.cos(2 * a) * ws, HC.z + P.pelvis[2]);
    const pelvisRoll = 0.07 * Math.sin(a) * ws + 0.012 * Math.sin(a) * W.seated;
    rotXZ(P.pelvisPitch, pelvisRoll, rotP);

    // feet ride the pedals; hips must reach them (drop the pelvis if a leg would over-straighten)
    let drop = 0;
    for (const L of sides) {
      const ang = a + L.phase;
      L.pedal.set(L.sign * R.pedalX, BB.y + Math.cos(ang) * R.crank, BB.z + Math.sin(ang) * R.crank).applyMatrix4(mBike);
      // ankling; out of the saddle the heel lifts through the bottom of the stroke (toes point down)
      const toe = 0.1 + 0.18 * Math.sin(ang) + ws * 0.32 * (0.5 - 0.5 * Math.cos(ang));
      rotFoot.makeRotationAxis(X, toe - (0.1 + 0.18 * Math.sin(L.restAngle))).premultiply(mBike);
      L.ankle.copy(L.ankleFromPedal).applyMatrix4(rotFoot).add(L.pedal);
      place(L.bones.foot, L.ankle, rotFoot);
      L.hip.copy(J['HIP' + L.s]).sub(HC).applyMatrix4(rotP).add(hc);
      const d = t1.subVectors(L.ankle, L.hip);
      const max = LEG * 0.985, horiz = d.x * d.x + d.z * d.z;
      if (d.lengthSq() > max * max && horiz < max * max) drop = Math.max(drop, -Math.sqrt(max * max - horiz) - d.y);
    }
    if (drop > 0) hc.y -= drop;
    mTmp.copy(rotP).setPosition(hc); setBone(B.pelvis, mTmp);

    for (const L of sides) {
      L.hip.copy(J['HIP' + L.s]).sub(HC).applyMatrix4(rotP).add(hc);
      // knee bends forward, pulled in toward the top tube in the tuck
      n1.set(-L.sign * P.kneeIn * 0.5, 0, 1).applyQuaternion(qBike);
      solve2(L.hip, L.ankle, R.thigh, R.shin, n1, L.knee);
      t2.subVectors(L.ankle, L.hip).cross(n1).normalize();
      place(L.bones.thigh, L.hip, limbRotation(L.thighT, t1.subVectors(L.knee, L.hip), t2, mRot));
      place(L.bones.shin, L.knee, limbRotation(L.shinT, t1.subVectors(L.ankle, L.knee), t2, mRot));
    }

    // chest pivots at the lumbar; the head keeps looking up the road
    lb.copy(LB).sub(HC).applyMatrix4(rotP).add(hc);
    rotXZ(P.chestPitch + breathe, -0.035 * Math.sin(a) * ws, rotC);
    place(B.chest, lb, rotC);
    nb.copy(NB).sub(LB).applyMatrix4(rotC).add(lb);
    rotXZ(P.headPitch, 0.01 * Math.sin(a) * ws, rotH);
    place(B.head, nb, rotH);

    // hands on the hoods (or the drops); arms reach from the shoulders
    rotHand.makeRotationAxis(X, P.handPitch).premultiply(mBike);
    for (const L of sides) {
      L.grip.copy(J['G' + L.s]).lerp(J['D' + L.s], P.grip).applyMatrix4(mBike);
      L.wrist.copy(L.wristFromGrip).applyMatrix4(rotHand).add(L.grip);
      place(L.bones.hand, L.wrist, rotHand);
      L.sh.copy(J['SH' + L.s]).sub(LB).applyMatrix4(rotC).add(lb);
      n1.copy(L.armPole); n1.y -= P.elbowDown; n1.x *= 1 - 0.4 * P.elbowDown; n1.normalize();
      solve2(L.sh, L.wrist, R.upperArm, R.forearm, n1, L.elbow);
      t2.subVectors(L.wrist, L.sh).cross(n1).normalize();
      place(L.bones.upper, L.sh, limbRotation(L.upperT, t1.subVectors(L.elbow, L.sh), t2, mRot));
      place(L.bones.fore, L.elbow, limbRotation(L.foreT, t1.subVectors(L.wrist, L.elbow), t2, mRot));
    }
  }

  update(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, 0, 0);
  return {
    group, mesh, update,
    triangles: data.mesh.tris,
    /** Force a posture ('seated' | 'standing' | 'tuck'), or null to let grade + effort decide. */
    setPosture(p) { st.forced = p && POSTURES[p] ? p : null; st.since = 99; },
    get posture() { return st.posture; },
    get blend() { return { ...st.w }; },
  };
}
