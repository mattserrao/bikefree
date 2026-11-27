// Toolbox figures: people, cyclists, dogs and strollers in the soft cartoon style, shared by every kit that shows
// people (city life, visitors, race day, traffic). One skinned, vertex-coloured mesh per kind and detail level;
// the motion comes from baked clips (rig.js → clips.js) played in the vertex shader from a float texture, so a
// crowd costs one draw call per mesh and no per-frame CPU work beyond placing it.
//
// Per instance: iA shirt, iB trousers / skirt / cap, iC skin (linear RGB); iAnim (clip, phase 0–1, loops per
// second, –); iLook (height scale, girth, outfit bits, hair colour). Kids are a height under ~0.85: their heads
// grow back toward adult size, so they read as children rather than small adults.
//
//   const crowd = new Crowd(parent, { uTime, name: 'Visitors', capacity: 60, dogs: 6, strollers: 4 });
//   crowd.begin(camera.position); crowd.add(look, x, y, z, yaw, CLIP.walk, phase, walkRate(1.3, look)); crowd.end();
import * as THREE from '../../../../../vendor/three.js';
import { FRAMES, BONES, CLIP_META, CLIP_DATA } from './clips.js';
import { PERSON, BIKE, HOLD, FISH_HAND } from './rig.js';
import { anchor } from '../../core/shader-patch.js';   // [review 27 Nov] T8: a missing shader anchor throws

export const CLIP = Object.fromEntries(CLIP_META.map((c, i) => [c.name, i]));
export { CLIP_META };
// outfit bits (iLook.z)
export const FIT = { SLEEVES: 1, LONG_PANTS: 2, SKIRT: 4, LONG_HAIR: 8, CAP: 16, PACK: 32, PROP: 64, HELMET: 128,
  JACKET: 256, HOOD: 512, BEANIE: 1024, ROD: 2048, STYLE: 4096 };
// hair styles (three bits at FIT.STYLE: look.bits += style × FIT.STYLE); long hair stays its own bit
const HAIR_STYLE = { SHORT: 0, PONYTAIL: 1, BUN: 2, CURLY: 3, BUZZ: 4 };
// vertex selectors (aSkin.w): what a vertex belongs to, for the outfit
const SEL = { ALWAYS: 0, FOREARM: 1, SHIN: 2, SKIRT: 3, THIGH: 4, LONG_HAIR: 5, CAP: 6, PACK: 7, PROP: 8, HELMET: 9, HAIR: 10,
  PONYTAIL: 11, BUN: 12, CURLY: 13, JACKET: 14, HOOD: 15, BEANIE: 16, ROD: 17 };
/** Whether a part (sel) is left out for an outfit (bits) — the CPU twin of the shader's test (GLSL_HIDE). */
function selHidden(sel, bits) {
  const helmet = bits & FIT.HELMET, style = (bits / FIT.STYLE | 0) & 7, hat = bits & (FIT.CAP | FIT.BEANIE);
  return (sel === SEL.SKIRT && !(bits & FIT.SKIRT)) || (sel === SEL.LONG_HAIR && (!(bits & FIT.LONG_HAIR) || helmet)) ||
    (sel === SEL.CAP && (!(bits & FIT.CAP) || helmet)) || (sel === SEL.PACK && !(bits & FIT.PACK)) || (sel === SEL.PROP && !(bits & FIT.PROP)) ||
    (sel === SEL.HELMET && !helmet) || (sel === SEL.HAIR && helmet) ||
    (sel === SEL.PONYTAIL && (style !== HAIR_STYLE.PONYTAIL || helmet || (bits & FIT.LONG_HAIR))) ||
    (sel === SEL.BUN && (style !== HAIR_STYLE.BUN || helmet || hat)) || (sel === SEL.CURLY && (style !== HAIR_STYLE.CURLY || helmet || hat)) ||
    (sel === SEL.JACKET && !(bits & FIT.JACKET)) || (sel === SEL.HOOD && (!(bits & FIT.HOOD) || (bits & FIT.PACK))) ||
    (sel === SEL.BEANIE && (!(bits & FIT.BEANIE) || helmet || (bits & FIT.CAP))) || (sel === SEL.ROD && !(bits & FIT.ROD));
}
const HAIR = ['#1f1a16', '#3a2417', '#6a4126', '#8f3e1e', '#cfa862', '#a8a39b', '#e2ddd3'];   // + 7 = bald (skin)
export const PALETTES = {
  shirts: ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#ecf0f1', '#34495e', '#8e44ad', '#e67e22', '#16a085', '#d35400', '#1b1b1b', '#f5b7b1', '#5d6d7e', '#e84393', '#7fb3d5', '#a3c585'],
  pants: ['#2c3e50', '#1c2833', '#5d4e37', '#34495e', '#7f8c8d', '#283747', '#b9a27e', '#3b5ba5', '#4a4a4a'],
  shorts: ['#2c3e50', '#b9a27e', '#3b5ba5', '#7f8c8d', '#1c2833', '#c0392b', '#6b8e5a'],
  skirts: ['#2c3e50', '#8e44ad', '#c0392b', '#3b5ba5', '#d4a373', '#1b1b1b', '#16a085'],
  skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0673a', '#5c3a21'],
  dogs: [['#c8a165', '#f1e3c8'], ['#2a2420', '#d8cfc0'], ['#f4f0e6', '#c9bba4'], ['#8a5a32', '#e9d7bd'], ['#6f6a64', '#eceae6'], ['#d9b37a', '#d9b37a']],
  strollers: ['#2c3e50', '#7f8c8d', '#3b5ba5', '#8e44ad', '#1b1b1b', '#c0392b'],
};

// ---------------------------------------------------------------- clip texture (shared)
let CLIP_FLOATS = null, CLIP_TEXTURE = null;
function clipFloats() {
  if (CLIP_FLOATS) return CLIP_FLOATS;
  const bin = typeof atob === 'function' ? Uint8Array.from(atob(CLIP_DATA), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(CLIP_DATA, 'base64'));
  const q = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2), f = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) f[i] = (i % 7) < 4 ? q[i] / 32767 : q[i] / 1000;
  return (CLIP_FLOATS = f);
}
/** The clips as a float texture: row = clip × FRAMES + frame, two texels per bone (quaternion, translation). */
function clipTexture() {
  if (CLIP_TEXTURE) return CLIP_TEXTURE;
  const f = clipFloats(), rows = CLIP_META.length * FRAMES, data = new Float32Array(rows * BONES * 2 * 4);
  for (let r = 0; r < rows; r++) for (let b = 0; b < BONES; b++) {
    const s = (r * BONES + b) * 7, d = (r * BONES * 2 + b * 2) * 4;
    data.set([f[s], f[s + 1], f[s + 2], f[s + 3], f[s + 4], f[s + 5], f[s + 6], 0], d);
  }
  const t = new THREE.DataTexture(data, BONES * 2, rows, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return (CLIP_TEXTURE = t);
}

// ---------------------------------------------------------------- geometry builder (indexed, skinned)
class FigBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; this.s = []; this.m = []; this.i = []; this.st = { color: [1, 1, 1], mask: [0, 0, 0, 0], b0: 0, b1: 0, w: 1, sel: 0 }; }
  set(o) { if (o.color) { const c = new THREE.Color(o.color); o = { ...o, color: [c.r, c.g, c.b] }; } Object.assign(this.st, o); return this; }
  v(x, y, z, nx, ny, nz, st = this.st) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z); this.n.push(nx / l, ny / l, nz / l); this.c.push(...st.color); this.s.push(st.b0, st.b1, st.w, st.sel); this.m.push(...st.mask);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  /** Ellipsoid (lat rings × lon segments), smooth normals. */
  ellipsoid([cx, cy, cz], [rx, ry, rz], lat = 6, lon = 8, rot = null) {
    const base = this.p.length / 3, v3 = new THREE.Vector3(), n3 = new THREE.Vector3();
    for (let a = 0; a <= lat; a++) {
      const th = a / lat * Math.PI, sy = Math.cos(th), sr = Math.sin(th);
      for (let b = 0; b <= lon; b++) {
        const ph = b / lon * Math.PI * 2, x = Math.sin(ph) * sr, z = Math.cos(ph) * sr;
        v3.set(x * rx, sy * ry, z * rz); n3.set(x / rx, sy / ry, z / rz);
        if (rot) { v3.applyQuaternion(rot); n3.applyQuaternion(rot); }
        this.v(cx + v3.x, cy + v3.y, cz + v3.z, n3.x, n3.y, n3.z);
      }
    }
    for (let a = 0; a < lat; a++) for (let b = 0; b < lon; b++) {
      const k = base + a * (lon + 1) + b, k2 = k + lon + 1;
      if (a > 0) this.tri(k, k2, k + 1);
      if (a < lat - 1) this.tri(k + 1, k2, k2 + 1);
    }
    return this;
  }
  /** A vertical tube through rings {y, x, z, rx, rz, st?}; caps close the ends (dome = a rounded cap). */
  tube(rings, seg = 8, { capBottom = false, capTop = false } = {}) {
    const ids = [];
    for (const r of rings) {
      const st = { ...this.st, ...(r.st || {}) }; if (r.st?.color) { const c = new THREE.Color(r.st.color); st.color = [c.r, c.g, c.b]; }
      const row = [];
      for (let b = 0; b <= seg; b++) {
        const ph = b / seg * Math.PI * 2, x = Math.sin(ph), z = Math.cos(ph);
        row.push(this.v((r.x || 0) + x * r.rx, r.y, (r.z || 0) + z * r.rz, x / r.rx, r.ny || 0, z / r.rz, st));
      }
      ids.push(row);
    }
    for (let k = 0; k + 1 < ids.length; k++) {
      if (rings[k + 1].brk) continue;   // a hard colour line: the next ring starts a new strip
      const A = ids[k], B = ids[k + 1], up = rings[k + 1].y > rings[k].y;
      for (let b = 0; b < seg; b++) up ? (this.tri(A[b], A[b + 1], B[b + 1]), this.tri(A[b], B[b + 1], B[b])) : (this.tri(A[b], B[b + 1], A[b + 1]), this.tri(A[b], B[b], B[b + 1]));
    }
    const cap = (row, r, down) => {
      const c = this.v(r.x || 0, r.y + (down ? -1 : 1) * Math.min(r.rx, r.rz) * .35, r.z || 0, 0, down ? -1 : 1, 0, { ...this.st, ...(r.st || {}), color: this.c.slice(row[0] * 3, row[0] * 3 + 3) });
      for (let b = 0; b < seg; b++) down ? this.tri(c, row[b + 1], row[b]) : this.tri(c, row[b], row[b + 1]);
    };
    if (capBottom) cap(ids[0], rings[0], rings[1].y > rings[0].y);
    if (capTop) cap(ids.at(-1), rings.at(-1), rings.at(-1).y < rings.at(-2).y);
    return this;
  }
  /** A round rod from a to b (radius r, or [r0, r1]). */
  rod(a, b, r, seg = 6) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length(); if (len < 1e-5) return this;
    d.normalize();
    const s = Math.abs(d.y) < .9 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0).cross(d).normalize(), t = d.clone().cross(s);
    const [r0, r1] = Array.isArray(r) ? r : [r, r], base = this.p.length / 3;
    for (const [P, rr] of [[A, r0], [B, r1]]) for (let k = 0; k <= seg; k++) {
      const ph = k / seg * Math.PI * 2, n = s.clone().multiplyScalar(Math.cos(ph)).addScaledVector(t, Math.sin(ph));
      this.v(P.x + n.x * rr, P.y + n.y * rr, P.z + n.z * rr, n.x, n.y, n.z);
    }
    for (let k = 0; k < seg; k++) this.tri(base + k, base + k + 1, base + seg + 2 + k), this.tri(base + k, base + seg + 2 + k, base + seg + 1 + k);
    return this;
  }
  /** Box (flat shaded), centre c, size, optional rotation. */
  box([cx, cy, cz], [w, h, l], rot = null) {
    const F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    const hs = [w / 2, h / 2, l / 2];
    for (const [n, u, v] of F) {
      const base = this.p.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const P = new THREE.Vector3(...n.map((x, k) => x * hs[k] + u[k] * su * hs[k] + v[k] * sv * hs[k])), N = new THREE.Vector3(...n);
        if (rot) { P.applyQuaternion(rot); N.applyQuaternion(rot); }
        this.v(cx + P.x, cy + P.y, cz + P.z, N.x, N.y, N.z);
      }
      this.tri(base, base + 1, base + 2); this.tri(base, base + 2, base + 3);
    }
    return this;
  }
  /** A wheel in the YZ plane: a tyre (tube around the rim), hub, spokes. */
  wheel([cx, cy, cz], R, t, seg = 16, cross = 3, spokes = 4) {
    const base = this.p.length / 3;
    for (let a = 0; a <= seg; a++) {
      const ph = a / seg * Math.PI * 2, oy = Math.cos(ph), oz = Math.sin(ph);
      for (let b = 0; b <= cross; b++) {
        const ps = b / cross * Math.PI * 2, rr = R + Math.cos(ps) * t, x = Math.sin(ps) * t;
        this.v(cx + x, cy + oy * rr, cz + oz * rr, Math.sin(ps), oy * Math.cos(ps), oz * Math.cos(ps));
      }
    }
    for (let a = 0; a < seg; a++) for (let b = 0; b < cross; b++) {
      const k = base + a * (cross + 1) + b, k2 = k + cross + 1;
      this.tri(k, k + 1, k2 + 1); this.tri(k, k2 + 1, k2);
    }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSkin', new THREE.Float32BufferAttribute(this.s, 4));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.m, 4));
    // baked occlusion (1 open … darker in the folds): set by bakeFigureAO for people, open everywhere else
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(Array.from({ length: this.p.length / 3 }, (_, k) => this.ao?.[k] ?? 1), 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const SHIRT = [1, 0, 0, 0], PANTS = [0, 1, 0, 0], SKIN = [0, 0, 1, 0], HAIRM = [0, 0, 0, 1], FIXED = [0, 0, 0, 0];
const B = { ...Object.fromEntries(Object.entries({ ROOT: 0, PELVIS: 1, CHEST: 2, HEAD: 3, L_UPPER: 4, L_FORE: 5, R_UPPER: 6, R_FORE: 7, L_THIGH: 8, L_SHIN: 9, L_FOOT: 10, R_THIGH: 11, R_SHIN: 12, R_FOOT: 13 })) };

/**
 * The person in the rig's rest pose. lod: 'hi' (near the camera: about 520 triangles as seen, 680 with every
 * outfit part), 'lo' (mid distance: about 170 seen) or 'far' (a crowd far off: about 64). cyclist: a helmet
 * instead of caps and long hair.
 */
function buildPerson(M, lod = 'hi', cyclist = false) {
  // (draft, 23 Nov — user: "more realistic proportions, more detail and variety": about 7½ heads tall instead of
  //  6¼; a smaller head with a jaw, ears, brows and a proper nose; a neck; shoulders, chest, waist and hips shaped;
  //  tapered limbs with elbows, knees and calves; hands with a thumb; shoes with a toe and a heel. Same rig, same joints.)
  const hi = lod === 'hi', far = lod === 'far';
  const sg = hi ? 10 : far ? 4 : 7, lim = hi ? 7 : far ? 3 : 5;
  const one = (b, mask, sel = 0, color = '#ffffff') => M.set({ b0: b, b1: b, w: 1, mask, sel, color });
  // ---- head: cranium, jaw and chin, ears; the face close up
  const HY = 1.64;   // the head's centre
  one(B.HEAD, SKIN).ellipsoid([0, HY, .0], [.082, .106, .098], hi ? 6 : far ? 2 : 4, hi ? 10 : far ? 5 : 7);
  if (!far) one(B.HEAD, SKIN).ellipsoid([0, HY - .055, .012], [.064, .05, .07], hi ? 3 : 2, hi ? 8 : 5);   // jaw, chin
  if (hi) {
    one(B.HEAD, SKIN);
    M.ellipsoid([0, HY - .014, .096], [.013, .024, .016], 2, 5);                      // nose
    for (const s of [1, -1]) M.ellipsoid([s * .083, HY - .005, -.005], [.012, .026, .018], 2, 4);   // ears
    one(B.HEAD, FIXED, 0, '#1c1a1d');
    for (const s of [1, -1]) M.ellipsoid([s * .031, HY + .014, .087], [.011, .008, .006], 2, 4);   // eyes
    one(B.HEAD, HAIRM, SEL.HAIR);
    for (const s of [1, -1]) M.ellipsoid([s * .032, HY + .031, .088], [.019, .005, .007], 2, 3);   // brows
    one(B.HEAD, FIXED, 0, '#8a4a44').ellipsoid([0, HY - .05, .077], [.021, .005, .008], 2, 4);     // mouth
  }
  // hair: a close cap over the cranium (and the back of the head); long hair down the back; caps, the helmet
  one(B.HEAD, HAIRM, SEL.HAIR).ellipsoid([0, HY + .022, -.02], [.092, .102, .104], hi ? 4 : far ? 2 : 3, hi ? 9 : far ? 4 : 6);
  if (cyclist) one(B.HEAD, SHIRT, SEL.HELMET).ellipsoid([0, HY + .045, -.01], [.098, .078, .12], hi ? 3 : 2, hi ? 9 : 6);
  else if (!far) {
    one(B.HEAD, HAIRM, SEL.LONG_HAIR).ellipsoid([0, HY - .07, -.07], [.082, .14, .045], hi ? 3 : 2, hi ? 7 : 4);
    one(B.HEAD, PANTS, SEL.CAP).ellipsoid([0, HY + .05, -.004], [.088, .06, .098], hi ? 3 : 2, hi ? 10 : 6);
    M.ellipsoid([0, HY + .05, .09], [.07, .01, .06], 2, hi ? 6 : 4);   // the bill
  }
  // ---- neck and torso: hips, waist, ribcage, chest, the shoulders' line (the collar)
  if (!far) M.set({ b0: B.HEAD, b1: B.CHEST, w: .5, mask: SKIN, sel: 0, color: '#ffffff' })
    .tube([{ y: 1.43, rx: .052, rz: .05, st: { b0: B.CHEST, b1: B.CHEST, w: 1 } }, { y: 1.56, rx: .043, rz: .045, z: -.008, st: { b0: B.HEAD, b1: B.HEAD, w: 1 } }], hi ? 8 : 5);
  const sh = (b0, b1, w) => ({ b0, b1, w, mask: SHIRT }), pa = (b0, b1, w) => ({ b0, b1, w, mask: PANTS });
  M.set({ sel: 0, color: '#ffffff' }).tube([
    ...(hi ? [{ y: .80, rx: .128, rz: .098, st: pa(B.PELVIS, B.PELVIS, 1) }] : []),
    { y: .88, rx: .162, rz: .112, z: -.006, st: pa(B.PELVIS, B.PELVIS, 1) },           // the seat, the hips
    { y: .985, rx: .148, rz: .1, st: pa(B.PELVIS, B.PELVIS, 1) },                       // the waistband
    { y: .985, rx: .148, rz: .1, st: sh(B.PELVIS, B.PELVIS, 1), brk: true },
    ...(far ? [] : [{ y: 1.07, rx: .14, rz: .094, st: sh(B.CHEST, B.PELVIS, .6) }]),     // the waist
    ...(hi ? [{ y: 1.18, rx: .152, rz: .1, z: .004, st: sh(B.CHEST, B.PELVIS, .85) }] : []),
    ...(far ? [] : [{ y: 1.29, rx: .17, rz: .112, z: .01, st: sh(B.CHEST, B.CHEST, 1) }]),   // the chest
    ...(hi ? [{ y: 1.37, rx: .188, rz: .108, z: .004, st: sh(B.CHEST, B.CHEST, 1) }] : []),
    { y: 1.425, rx: far ? .18 : .185, rz: far ? .1 : .092, st: sh(B.CHEST, B.CHEST, 1) },   // the shoulders' line
    ...(far ? [] : [{ y: 1.46, rx: .075, rz: .062, st: sh(B.CHEST, B.CHEST, 1) }]),          // the collar
  ], sg, { capBottom: true, capTop: far });
  // ---- arms: a rounded shoulder (deltoid), the upper arm tapering to the elbow, the forearm (fuller below the
  // elbow) to a slim wrist; a hand with a thumb
  for (const s of [1, -1]) {
    const up = s > 0 ? B.L_UPPER : B.R_UPPER, fo = s > 0 ? B.L_FORE : B.R_FORE;
    if (!far) one(up, SHIRT).ellipsoid([s * .186, 1.398, 0], [.058, .056, .06], hi ? 3 : 2, hi ? 7 : 5);   // the shoulder
    M.set({ sel: 0, color: '#ffffff' }).tube(far ? [
      { y: 1.42, x: s * .19, rx: .06, rz: .06, st: { b0: up, b1: B.CHEST, w: .8, mask: SHIRT } },
      { y: .86, x: s * .218, rx: .045, rz: .045, st: { b0: fo, b1: up, w: .7, mask: SKIN } },
    ] : [
      { y: 1.40, x: s * .193, rx: .058, rz: .06, st: { b0: up, b1: B.CHEST, w: .85, mask: SHIRT } },
      ...(hi ? [{ y: 1.29, x: s * .2, rx: .055, rz: .058, st: { b0: up, b1: up, w: 1, mask: SHIRT } }] : []),
      { y: 1.14, x: s * .205, rx: .043, rz: .045, st: { b0: up, b1: fo, w: .5, mask: SHIRT } },   // the elbow
      { y: 1.14, x: s * .205, rx: .043, rz: .045, st: { b0: up, b1: fo, w: .5, mask: SHIRT, sel: SEL.FOREARM }, brk: true },
      ...(hi ? [{ y: 1.06, x: s * .21, rx: .047, rz: .044, st: { b0: fo, b1: fo, w: 1, mask: SHIRT, sel: SEL.FOREARM } }] : []),
      { y: .895, x: s * .216, rx: .028, rz: .024, st: { b0: fo, b1: fo, w: 1, mask: SHIRT, sel: SEL.FOREARM } },   // the wrist
    ], lim, { capBottom: !hi && !far });
    if (!far) {
      one(fo, SKIN).ellipsoid([s * .218, .835, .006], [.024, .058, .04], hi ? 3 : 2, hi ? 6 : 4);   // the hand
      if (hi) M.ellipsoid([s * .212, .86, .042], [.012, .028, .012], 2, 4);                     // the thumb
    }
  }
  // ---- legs: the thigh tapering to the knee, the calf's swell behind, a slim ankle; a shoe with a toe and a heel
  for (const s of [1, -1]) {
    const th = s > 0 ? B.L_THIGH : B.R_THIGH, sn = s > 0 ? B.L_SHIN : B.R_SHIN, ft = s > 0 ? B.L_FOOT : B.R_FOOT;
    M.set({ sel: 0, color: '#ffffff' }).tube(far ? [
      { y: .93, x: s * .088, rx: .08, rz: .085, st: { b0: th, b1: B.PELVIS, w: .5, mask: PANTS } },
      { y: .52, x: s * .10, rx: .058, rz: .061, st: { b0: th, b1: sn, w: .5, mask: PANTS, sel: SEL.SHIN } },
      { y: .02, x: s * .10, rx: .045, rz: .07, st: { b0: ft, b1: sn, w: .7, mask: FIXED, color: '#2a2522' } },
    ] : [
      { y: .92, x: s * .085, rx: .088, rz: .094, st: { b0: th, b1: B.PELVIS, w: .5, mask: PANTS, sel: SEL.THIGH } },
      ...(hi ? [{ y: .77, x: s * .092, rx: .078, rz: .082, st: { b0: th, b1: th, w: 1, mask: PANTS, sel: SEL.THIGH } }] : []),
      { y: .53, x: s * .098, rx: .05, rz: .054, st: { b0: th, b1: sn, w: .5, mask: PANTS, sel: SEL.THIGH } },   // the knee
      { y: .53, x: s * .098, rx: .05, rz: .054, st: { b0: th, b1: sn, w: .5, mask: PANTS, sel: SEL.SHIN }, brk: true },
      ...(hi ? [{ y: .40, x: s * .1, rx: .055, rz: .062, z: -.014, st: { b0: sn, b1: sn, w: 1, mask: PANTS, sel: SEL.SHIN } }] : []),   // the calf
      { y: .14, x: s * .1, rx: .03, rz: .033, st: { b0: sn, b1: ft, w: .8, mask: PANTS, sel: SEL.SHIN } },   // the ankle
    ], lim);
    if (!far) {
      one(ft, FIXED, 0, '#2a2522');
      M.ellipsoid([s * .1, .052, .04], [.043, .05, .118], hi ? 3 : 2, hi ? 8 : 5);                 // the shoe
      if (hi) one(ft, FIXED, 0, '#d9d4c8').ellipsoid([s * .1, .012, .04], [.045, .012, .118], 2, 6);   // heel; the sole
    }
  }
  if (far || cyclist) return M;
  // ---- hair styles (each shown by its bits: selHidden), hats, outerwear, the fishing rod
  one(B.HEAD, HAIRM, SEL.PONYTAIL).ellipsoid([0, HY - .055, -.118], [.03, .085, .032], hi ? 3 : 2, hi ? 6 : 4);
  M.ellipsoid([0, HY + .005, -.1], [.024, .02, .022], 2, 4);                                            // (its tie)
  one(B.HEAD, HAIRM, SEL.BUN).ellipsoid([0, HY + .085, -.07], [.046, .04, .046], hi ? 3 : 2, hi ? 7 : 5);
  one(B.HEAD, HAIRM, SEL.CURLY).ellipsoid([0, HY + .035, -.016], [.112, .112, .12], hi ? 4 : 3, hi ? 9 : 6);
  one(B.HEAD, PANTS, SEL.BEANIE).ellipsoid([0, HY + .052, -.012], [.097, .078, .108], hi ? 3 : 2, hi ? 9 : 6);
  // a jacket: a longer hem over the hips, a raised collar (the shirt's colour; sleeves forced long)
  M.set({ b0: B.PELVIS, b1: B.CHEST, w: .5, mask: SHIRT, sel: SEL.JACKET, color: '#ffffff' })
    .tube([{ y: .82, rx: .172, rz: .122, st: { b0: B.PELVIS, b1: B.PELVIS, w: 1 } }, { y: 1.02, rx: .158, rz: .108, st: { b0: B.CHEST, b1: B.PELVIS, w: .5 } }], hi ? 10 : 6, { capBottom: false });
  M.set({ b0: B.CHEST, b1: B.CHEST, w: 1, mask: SHIRT, sel: SEL.JACKET }).tube([{ y: 1.43, rx: .092, rz: .08 }, { y: 1.5, rx: .078, rz: .07, z: -.008 }], hi ? 8 : 5);
  // a hoodie's hood, lying on the back of the shoulders
  one(B.CHEST, SHIRT, SEL.HOOD).ellipsoid([0, 1.45, -.1], [.105, .07, .065], hi ? 3 : 2, hi ? 7 : 5);
  // the rod: from the hands (FISH_HAND, chest frame) out and up 2.4 m, tapering; a reel under the grip
  one(B.CHEST, FIXED, SEL.ROD, '#2b2622').rod([FISH_HAND[0], FISH_HAND[1] - .25, FISH_HAND[2] - .3], [FISH_HAND[0] - .05, FISH_HAND[1] + .95, FISH_HAND[2] + 2.1], [.012, .004], 4);
  M.set({ color: '#9aa0a6' }).ellipsoid([FISH_HAND[0], FISH_HAND[1] - .07, FISH_HAND[2] - .06], [.025, .035, .03], 2, 5);
  // a skirt (pelvis), a day pack (chest), a phone in the right hand
  M.set({ b0: B.PELVIS, b1: B.PELVIS, w: 1, mask: PANTS, sel: SEL.SKIRT, color: '#ffffff' })
    .tube([{ y: .995, rx: .152, rz: .106 }, { y: .58, rx: .225, rz: .195 }], hi ? 12 : 6);
  one(B.CHEST, FIXED, SEL.PACK, '#2b3b46').ellipsoid([0, 1.21, -.15], [.125, .165, .065], hi ? 3 : 2, hi ? 7 : 4);
  if (hi) one(B.R_FORE, FIXED, SEL.PROP, '#222428').box([-.222, .80, .052], [.07, .135, .012]);
  return M;
}
/**
 * Ambient occlusion baked into the vertices (free at draw time — the colour is scaled in the vertex shader): the
 * folds and the shade a body casts on itself — under the chin, the armpits and the torso's sides by the arms, between
 * the thighs, the crotch, the inside of the arms — and a light top-to-toe falloff (the ground's bounce is weaker
 * than the sky's). Read off the rest pose.
 */
function bakeFigureAO(M) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const bell = (x, c, w) => 1 - ss(0, w, Math.abs(x - c));
  const n = M.p.length / 3, ao = new Array(n);
  for (let k = 0; k < n; k++) {
    const x = M.p[3 * k], y = M.p[3 * k + 1], z = M.p[3 * k + 2], ax = Math.abs(x), nx = M.n[3 * k] * Math.sign(x || 1), ny = M.n[3 * k + 1];
    let o = .84 + .16 * ss(0, 1.6, y);                                                     // top to toe
    o *= 1 - .3 * bell(y, 1.47, .06) * (ax < .07 ? 1 : 0) * ss(-.2, .4, -ny);             // under the chin, the neck
    o *= 1 - .28 * bell(y, 1.3, .14) * ss(.1, .2, ax) * (ax < .16 ? 1 : 0);                // the torso's sides by the arms
    o *= 1 - .26 * bell(y, 1.28, .14) * (ax > .15 && ax < .26 ? ss(0, .8, -nx) : 0);       // the inside of the arms
    o *= 1 - .3 * bell(y, .8, .16) * (ax < .14 && y < .95 ? ss(0, .8, -nx) : 0);           // between the thighs
    o *= 1 - .22 * bell(y, .9, .05) * (ax < .05 ? 1 : 0);                                  // the crotch
    o *= 1 - .18 * bell(y, 1.0, .03) * ss(-.3, .5, -ny);                                   // under the shirt's hem
    ao[k] = o;
  }
  M.ao = ao;
  return M;
}
export function personGeometry(lod = 'hi') { return bakeFigureAO(buildPerson(new FigBuilder(), lod)).geometry(); }

/** A road cyclist on a bike: the person (helmet, jersey) plus frame, wheels and cranks on their own bones. */
export function cyclistGeometry(lod = 'hi') {
  const M = bakeFigureAO(buildPerson(new FigBuilder(), lod, true)), hi = lod === 'hi';
  const [, bby, bbz] = BIKE.bb, R = BIKE.wheelR;
  const fixed = (b, color, mask = FIXED) => M.set({ b0: b, b1: b, w: 1, mask, sel: 0, color });
  fixed(0, '#ffffff', SHIRT);   // frame in the jersey's colour (team kit)
  const st = [0, .86, -.27], ht = [0, .86, .36], hb = [0, .72, .40], bb = [0, bby, bbz];
  const r = hi ? 5 : 4;
  M.rod(bb, st, .018, r).rod(st, ht, .017, r).rod(hb, bb, .02, r).rod(bb, BIKE.rear, .012, r).rod(st, BIKE.rear, .011, r).rod(hb, ht, .022, r);
  fixed(0, '#2b2b2b').rod(hb, BIKE.front, .013, r).rod([0, .86, -.27], [0, .93, -.31], .012, 4).rod([0, .90, .37], [0, .975, .42], .014, 4);
  M.rod([-BIKE.bars[0] - .01, .98, .42], [BIKE.bars[0] + .01, .98, .42], .013, 4);
  for (const s of [1, -1]) M.rod([s * BIKE.bars[0], .98, .42], [s * BIKE.bars[0], .88, .47], .012, 4);
  M.box([0, .945, -.31], [.07, .035, .24]);
  // wheels: tyre, rim, spokes
  for (const [w, c] of [[14, BIKE.front], [15, BIKE.rear]]) {
    fixed(w, '#1a1a1a').wheel(c, R - .012, .016, hi ? 18 : 12, 3);
    fixed(w, '#9aa0a6');
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI; M.rod([0, c[1] + Math.cos(a) * (R - .03), c[2] + Math.sin(a) * (R - .03)], [0, c[1] - Math.cos(a) * (R - .03), c[2] - Math.sin(a) * (R - .03)], .004, 3); }
    M.rod([-.03, c[1], c[2]], [.03, c[1], c[2]], .02, 6);
  }
  // cranks and pedals (bone 16)
  fixed(16, '#3a3a3a');
  for (const s of [1, -1]) {
    const y = bby + s * BIKE.crank;
    M.rod([-s * .08, bby, bbz], [-s * .08, y, bbz], .012, 4).box([-s * .12, y, bbz], [.08, .016, .06]);
  }
  M.ellipsoid([-.06, bby, bbz], [.006, .1, .1], 1, hi ? 10 : 8);
  return M.geometry();
}

/** A medium dog on a lead (the lead ends at the walker's hand, HOLD.leash). iA coat, iB patches. */
export function dogGeometry() {
  const M = new FigBuilder();
  const coat = (b) => M.set({ b0: b, b1: b, w: 1, mask: SHIRT, sel: 0, color: '#ffffff' });
  const patch = (b) => M.set({ b0: b, b1: b, w: 1, mask: PANTS, sel: 0, color: '#ffffff' });
  const fix = (b, c) => M.set({ b0: b, b1: b, w: 1, mask: FIXED, sel: 0, color: c });
  coat(1).ellipsoid([0, .43, -.03], [.105, .115, .25], 4, 8);
  patch(1).ellipsoid([0, .40, .12], [.095, .1, .12], 3, 6);
  coat(2).ellipsoid([0, .58, .33], [.078, .082, .095], 4, 7);
  patch(2).ellipsoid([0, .553, .415], [.045, .04, .06], 2, 5);
  fix(2, '#1d1b1a').ellipsoid([0, .57, .475], [.018, .015, .012], 1, 4);
  for (const s of [1, -1]) {
    fix(2, '#1d1b1a').ellipsoid([s * .036, .605, .41], [.011, .013, .008], 1, 4);
    patch(2).ellipsoid([s * .06, .625, .30], [.025, .06, .035], 2, 4, new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, 0, s * .5)));
  }
  coat(3).rod([0, .49, -.27], [0, .62, -.42], [.026, .012], 5);
  for (const [b, x, z] of [[4, .075, .19], [5, -.075, .19], [6, .075, -.19], [7, -.075, -.19]]) {
    coat(b).rod([x, .40, z], [x, .05, z + .01], [.036, .028], 5);
    patch(b).ellipsoid([x, .03, z + .03], [.032, .03, .045], 2, 4);
  }
  fix(1, '#c0392b').tube([{ y: .505, z: .26, rx: .072, rz: .066 }, { y: .535, z: .27, rx: .072, rz: .066 }], 8);
  // the lead, sagging between the collar and the walker's hand (rest of the dog's root, not animated)
  const hand = HOLD.leash.hand.map((v, k) => v - HOLD.leash.dog[k]), a = [0, .52, .30];
  fix(0, '#7a2a24');
  let prev = a;
  for (let k = 1; k <= 6; k++) {
    const t = k / 6, p = [a[0] + (hand[0] - a[0]) * t, a[1] + (hand[1] - a[1]) * t - Math.sin(Math.PI * t) * .12, a[2] + (hand[2] - a[2]) * t];
    M.rod(prev, p, .006, 3); prev = p;
  }
  return M.geometry();
}

/** A stroller pushed by a walker (rest frame of the walker: the handle at HOLD.stroller.handle). iA fabric. */
function strollerGeometry() {
  const M = new FigBuilder(), [, hy, hz] = HOLD.stroller.handle;
  const fab = () => M.set({ b0: 0, b1: 0, w: 1, mask: SHIRT, sel: 0, color: '#ffffff' });
  const fix = (c) => M.set({ b0: 0, b1: 0, w: 1, mask: FIXED, sel: 0, color: c });
  fix('#2a2a2a').rod([-.22, hy, hz], [.22, hy, hz], .016, 5);
  for (const s of [1, -1]) M.rod([s * .2, hy, hz], [s * .19, .2, .78], .012, 4).rod([s * .19, .2, .78], [s * .18, .1, 1.05], .012, 4).rod([s * .19, .2, .78], [s * .19, .1, .62], .012, 4);
  fab().ellipsoid([0, .62, .86], [.2, .14, .3], 3, 8);
  M.ellipsoid([0, .74, .7], [.205, .17, .14], 3, 8);
  fix('#2a2a2a'); for (const s of [1, -1]) M.rod([s * .17, .5, .62], [s * .17, .5, 1.08], .012, 4);
  fix('#1a1a1a');
  for (const [x, z] of [[.19, .62], [-.19, .62], [.18, 1.05], [-.18, 1.05]]) M.ellipsoid([x, .1, z], [.025, .1, .1], 4, 8);
  return M.geometry();
}

// ---------------------------------------------------------------- material
const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const GLSL_COMMON = `
  uniform float uTime; uniform highp sampler2D uClips; uniform vec4 uNear; uniform float uMid;
  attribute vec4 aSkin; attribute vec4 aMask; attribute float aAO; attribute vec3 iA; attribute vec3 iB; attribute vec3 iC; attribute vec4 iAnim; attribute vec4 iLook;
  vec3 figP; vec3 figN; float figHide;
  const vec3 FIG_HAIR[7] = vec3[7](${HAIR.map(lin).join(', ')});
  vec3 figRot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  void figBone(int b, int r0, int r1, float a, out vec4 q, out vec3 t) {
    vec4 q0 = texelFetch(uClips, ivec2(b * 2, r0), 0), q1 = texelFetch(uClips, ivec2(b * 2, r1), 0);
    if (dot(q0, q1) < 0.) q1 = -q1;
    q = normalize(mix(q0, q1, a));
    t = mix(texelFetch(uClips, ivec2(b * 2 + 1, r0), 0).xyz, texelFetch(uClips, ivec2(b * 2 + 1, r1), 0).xyz, a);
  }
  void figSkin(vec3 p, vec3 n) {
    float fr = fract(uTime * iAnim.z + iAnim.y) * ${FRAMES}.0, f0 = floor(fr), a = fr - f0;
    int clip = int(iAnim.x + .5), r0 = clip * ${FRAMES} + int(f0), r1 = clip * ${FRAMES} + int(mod(f0 + 1., ${FRAMES}.0));
    int b0 = int(aSkin.x + .5), b1 = int(aSkin.y + .5);
    vec4 q; vec3 t; figBone(b0, r0, r1, a, q, t);
    vec3 P = figRot(q, p) + t, N = figRot(q, n);
    if (aSkin.z < .999) { vec4 q2; vec3 t2; figBone(b1, r0, r1, a, q2, t2); P = mix(figRot(q2, p) + t2, P, aSkin.z); N = mix(figRot(q2, n), N, aSkin.z); }
    float h = iLook.x, g = iLook.y, kid = clamp((.93 - h) / .33, 0., 1.);
    if (b0 == 3 && kid > 0.) { vec3 neck = figRot(q, vec3(0., ${PERSON.pivot[3][1].toFixed(3)}, 0.)) + t; P = neck + (P - neck) * (1. + .5 * kid); }
    float gz = mix(1., g, .6);
    figP = vec3(P.x * g, P.y * h, P.z * gz); figN = normalize(vec3(N.x / g, N.y / h, N.z / gz));
    int bits = int(iLook.z + .5), sel = int(aSkin.w + .5);
    bool helmet = (bits & ${FIT.HELMET}) != 0; int style = (bits / ${FIT.STYLE}) & 7; bool hat = (bits & ${FIT.CAP | FIT.BEANIE}) != 0;
    figHide = 0.;
    if ((sel == ${SEL.SKIRT} && (bits & ${FIT.SKIRT}) == 0) || (sel == ${SEL.LONG_HAIR} && ((bits & ${FIT.LONG_HAIR}) == 0 || helmet)) ||
        (sel == ${SEL.CAP} && ((bits & ${FIT.CAP}) == 0 || helmet)) || (sel == ${SEL.PACK} && (bits & ${FIT.PACK}) == 0) ||
        (sel == ${SEL.PROP} && (bits & ${FIT.PROP}) == 0) || (sel == ${SEL.HELMET} && !helmet) || (sel == ${SEL.HAIR} && helmet) ||
        (sel == ${SEL.PONYTAIL} && (style != ${HAIR_STYLE.PONYTAIL} || helmet || (bits & ${FIT.LONG_HAIR}) != 0)) ||
        (sel == ${SEL.BUN} && (style != ${HAIR_STYLE.BUN} || helmet || hat)) || (sel == ${SEL.CURLY} && (style != ${HAIR_STYLE.CURLY} || helmet || hat)) ||
        (sel == ${SEL.JACKET} && (bits & ${FIT.JACKET}) == 0) || (sel == ${SEL.HOOD} && ((bits & ${FIT.HOOD}) == 0 || (bits & ${FIT.PACK}) != 0)) ||
        (sel == ${SEL.BEANIE} && ((bits & ${FIT.BEANIE}) == 0 || helmet || (bits & ${FIT.CAP}) != 0)) || (sel == ${SEL.ROD} && (bits & ${FIT.ROD}) == 0)) figHide = 1.;
  #ifdef FIG_NEAR
    vec3 wo = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
    float nd = distance(wo, uNear.xyz);
    #if FIG_NEAR == 1
      if (nd < uNear.w || nd >= uMid) figHide = 1.;   // the middle band
    #else
      if (nd < uMid) figHide = 1.;                    // the far band
    #endif
  #endif
  }`;
const GLSL_COLOR = `
    {
      int bits = int(iLook.z + .5), sel = int(aSkin.w + .5);
      vec4 mk = aMask;
      if ((sel == ${SEL.FOREARM} && (bits & ${FIT.SLEEVES}) == 0) || (sel == ${SEL.SHIN} && (bits & ${FIT.LONG_PANTS}) == 0) || (sel == ${SEL.THIGH} && (bits & ${FIT.SKIRT}) != 0)) mk = vec4(0., 0., 1., 0.);
      int hi = int(iLook.w + .5);
      vec3 hair = hi >= 7 ? iC * .92 : FIG_HAIR[hi];
      vColor.rgb = (color * clamp(1. - mk.x - mk.y - mk.z - mk.w, 0., 1.) + iA * mk.x + iB * mk.y + iC * mk.z + hair * mk.w) * aAO;
    }`;

function patch(shader, uniforms, depth) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace(anchor('#include <common>'), `#include <common>\n${GLSL_COMMON}`);
  if (depth) {
    shader.vertexShader = shader.vertexShader.replace(anchor('#include <begin_vertex>'), `figSkin(position, vec3(0., 1., 0.));\nvec3 transformed = figHide > .5 ? vec3(0.) : figP;`);
  } else {
    shader.vertexShader = shader.vertexShader
      .replace(anchor('#include <beginnormal_vertex>'), 'figSkin(position, normal);\nvec3 objectNormal = figN;')
      .replace(anchor('#include <begin_vertex>'), 'vec3 transformed = figHide > .5 ? vec3(0.) : figP;')
      .replace(anchor('#include <color_vertex>'), `#include <color_vertex>\n${GLSL_COLOR}`);
    // a soft rim of sky light on the edges turned from the camera: reads the shape (shoulders, head, limbs) against
    // the background at no geometry cost — a few instructions a fragment
    shader.fragmentShader = shader.fragmentShader.replace(anchor('#include <emissivemap_fragment>'), `#include <emissivemap_fragment>
      { float rim = 1. - max(dot(normalize(normal), normalize(vViewPosition)), 0.); totalEmissiveRadiance += diffuseColor.rgb * .35 * rim * rim; }`);
  }
}

/**
 * The figures' material (and its shadow-depth twin). For static crowds drawn in bands around the camera:
 * near { value: Vector4(x, y, z, nearRadius) } and mid { value: midRadius }, shared with the Crowd that draws the
 * near band; nearMode 1 shows only instances between the two radii, 2 only those past the middle one.
 */
export function figureMaterial(uTime, { near = null, mid = null, nearMode = 0 } = {}) {
  const uniforms = { uTime, uClips: { value: clipTexture() }, uNear: near || { value: new THREE.Vector4(0, 0, 0, 0) }, uMid: mid || { value: 1e9 } };
  // (gap 12: cloth that catches the light at its edges — a soft sheen — instead of flat matte plastic)
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: .78, sheen: .55, sheenRoughness: .7, sheenColor: new THREE.Color(.85, .85, .85) });
  if (nearMode) m.defines = { FIG_NEAR: nearMode };
  m.onBeforeCompile = (s) => patch(s, uniforms, false);
  m.customProgramCacheKey = () => `bf-figures-3-${nearMode}`;
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  if (nearMode) d.defines = { FIG_NEAR: nearMode };
  d.onBeforeCompile = (s) => patch(s, uniforms, true);
  d.customProgramCacheKey = () => `bf-figures-depth-1-${nearMode}`;
  m.userData.depth = d;
  return m;
}

/** An instanced mesh of figures with the per-instance attributes set up (count starts at 0). */
function figureMesh(geometry, material, capacity, name, { shadows = true } = {}) {
  const g = geometry.clone();
  for (const [k, n] of [['iA', 3], ['iB', 3], ['iC', 3], ['iAnim', 4], ['iLook', 4]]) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a);
  }
  const im = new THREE.InstancedMesh(g, material, Math.max(1, capacity));
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false; im.castShadow = shadows; im.receiveShadow = true; im.name = name; im.count = 0;
  im.customDepthMaterial = material.userData.depth;
  im.userData.dynamic = true;   // animated: never baked
  return im;
}

// ---------------------------------------------------------------- looks
const col = (hex) => new THREE.Color(hex);
const pick = (rand, a) => a[Math.floor(rand() * a.length) % a.length];
/**
 * A random person. opts: kids (share), skirts, packs, caps, sporty (a jogger: shorts, tee), shirts / pants
 * palettes, shirt (force a colour), helmet (cyclist).
 */
export function randomLook(rand, opts = {}) {
  const kid = rand() < (opts.kids ?? .12);
  const h = kid ? .6 + rand() * .22 : .93 + rand() * .13;
  const g = kid ? .9 + rand() * .1 : rand() < .12 ? 1.15 + rand() * .18 : .86 + rand() * rand() * .42;   // (a few heavier builds)
  let bits = 0;
  const sporty = !!opts.sporty, cyclist = !!opts.helmet;
  if (!sporty && !cyclist && rand() < (opts.sleeves ?? .45)) bits |= FIT.SLEEVES;
  const r = rand(), skirt = !sporty && !cyclist && r < (opts.skirts ?? .16);
  if (skirt) bits |= FIT.SKIRT; else if (!sporty && !cyclist && r < .72) bits |= FIT.LONG_PANTS;
  const longHair = rand() < (opts.longHair ?? (skirt ? .75 : .3));
  if (longHair) bits |= FIT.LONG_HAIR;
  if (!cyclist && rand() < (opts.caps ?? .14)) bits |= FIT.CAP;
  if (!cyclist && rand() < (opts.packs ?? .1)) bits |= FIT.PACK;
  if (cyclist) bits |= FIT.HELMET;
  // outerwear (it's September upstate: a few jackets and hoodies), hats; the hair's style
  if (!sporty && !cyclist) {
    const o = rand();
    if (o < (opts.jackets ?? .14)) bits |= FIT.JACKET | FIT.SLEEVES | FIT.LONG_PANTS;
    else if (o < (opts.jackets ?? .14) + (opts.hoodies ?? .1)) bits |= FIT.HOOD | FIT.SLEEVES;
    if (!(bits & FIT.CAP) && rand() < (opts.beanies ?? .05)) bits |= FIT.BEANIE;
  }
  if (bits & FIT.JACKET && bits & FIT.SKIRT) bits &= ~FIT.JACKET;
  if (opts.rod) bits |= FIT.ROD;
  {
    const r2 = rand();
    const style = longHair ? (r2 < .3 ? HAIR_STYLE.BUN : HAIR_STYLE.SHORT) : r2 < .16 ? HAIR_STYLE.PONYTAIL : r2 < .26 ? HAIR_STYLE.CURLY : r2 < .36 ? HAIR_STYLE.BUZZ : r2 < .42 ? HAIR_STYLE.BUN : HAIR_STYLE.SHORT;
    // (a bun with long hair: the long hair put up — the long part goes)
    if (longHair && style === HAIR_STYLE.BUN) bits &= ~FIT.LONG_HAIR;
    bits += style * FIT.STYLE;
  }
  const grey = !kid && rand() < .12, bald = !kid && !longHair && rand() < .06;
  const hair = bald ? 7 : grey ? 5 + Math.floor(rand() * 2) : Math.floor(rand() * 5);
  const shirts = opts.shirts || PALETTES.shirts;
  const lower = skirt ? PALETTES.skirts : (bits & FIT.LONG_PANTS) ? (opts.pants || PALETTES.pants) : PALETTES.shorts;
  return {
    h, g, bits, hair, kid,
    shirt: col(opts.shirt || pick(rand, shirts)), pants: col(cyclist ? '#1b1b1b' : pick(rand, lower)), skin: col(pick(rand, opts.skin || PALETTES.skin)),
  };
}
export function dogLook(rand) { const [a, b] = pick(rand, PALETTES.dogs); return { coat: col(a), patch: col(b) }; }

/** Loops per second for a locomotion clip at a ground speed (taller people take longer strides). */
export function clipRate(clip, speed = 0, look = null) {
  const m = CLIP_META[clip];
  if (!m.stride || !speed) return 1 / m.seconds;
  return speed / (m.stride * (look ? Math.min(1.05, Math.max(.62, look.h)) : 1));
}

// ---------------------------------------------------------------- crowds
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _o = new THREE.Vector3();
const _qr = new THREE.Quaternion(), _fz = new THREE.Vector3(0, 0, 1);   // [7.5] a cyclist's lean (roll about its forward axis)
function writeFig(im, i, look, clip, phase, rate) {
  const at = im.geometry.attributes;
  at.iA.setXYZ(i, look.shirt.r, look.shirt.g, look.shirt.b); at.iB.setXYZ(i, look.pants.r, look.pants.g, look.pants.b); at.iC.setXYZ(i, look.skin.r, look.skin.g, look.skin.b);
  at.iAnim.setXYZW(i, clip, phase, rate, 0); at.iLook.setXYZW(i, look.h, look.g, look.bits, look.hair);
}
const DOG_LOOK = { h: 1, g: 1, bits: 0, hair: 0 };

/**
 * People near the camera, rebuilt every frame: the nearest in the detailed mesh, the rest in the light one.
 * Walkers can bring a dog on a lead (look.dog = dogLook(), clip leash) or push a stroller (look.stroller = Color,
 * clip push). opts: capacity, nearM (detail radius), nearCapacity, dogs, strollers, geometry ('person' | 'cyclist').
 */
export class Crowd {
  constructor(parent, { uTime, name = 'People', capacity = 64, nearM = 40, farM = Infinity, nearCapacity = null, dogs = 0, strollers = 0, kind = 'person', shadows = true } = {}) {
    this.name = name; this.nearM = nearM; this.farM = farM;
    this.mat = figureMaterial(uTime);
    const geo = kind === 'cyclist' ? cyclistGeometry : personGeometry;
    this.geos = [geo('hi'), geo('lo')];
    const nc = nearCapacity ?? capacity;
    this.hi = figureMesh(this.geos[0], this.mat, nc, name, { shadows });
    this.lo = nearM < Infinity ? figureMesh(this.geos[1], this.mat, capacity, `${name} (mid)`, { shadows }) : null;
    this.far = farM < Infinity && kind === 'person' ? figureMesh((this.farGeo = personGeometry('far')), this.mat, capacity, `${name} (far)`, { shadows }) : null;
    this.dogs = dogs ? figureMesh((this.dogGeo = dogGeometry()), this.mat, dogs, 'Dogs', { shadows }) : null;
    this.strollers = strollers ? figureMesh((this.strollerGeo = strollerGeometry()), this.mat, strollers, 'Strollers', { shadows }) : null;
    for (const m of this.meshes) parent.add(m);
    this.cam = new THREE.Vector3();
  }
  begin(cam) { this.cam.copy(cam); this.n = [0, 0, 0, 0, 0]; return this; }
  /**
   * Place one figure: position, heading (radians, 0 = +Z), clip, phase (0–1), rate (loops per second), and roll
   * (radians, + leaning to its right: a cyclist leaning into a turn, PLAN 7.5) about its forward axis at the ground.
   */
  add(look, x, y, z, yaw, clip, phase = 0, rate = null, roll = 0) {
    rate ??= clipRate(clip);
    const d = Math.hypot(x - this.cam.x, y - this.cam.y, z - this.cam.z);
    const useHi = !this.lo || d < this.nearM, useFar = !useHi && this.far && d >= this.farM;
    let im = useHi ? this.hi : useFar ? this.far : this.lo, k = useHi ? 0 : useFar ? 4 : 1;
    if (this.n[k] >= im.instanceMatrix.count) { if (k === 0 && this.lo) { im = this.lo; k = 1; } if (this.n[k] >= im.instanceMatrix.count) return -1; }
    const i = this.n[k]++;
    _q.setFromAxisAngle(_up, yaw);
    if (roll) _q.multiply(_qr.setFromAxisAngle(_fz, roll));
    im.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s));
    if (roll) _q.setFromAxisAngle(_up, yaw);   // (a dog or a stroller stays upright)
    writeFig(im, i, look, clip, phase, rate);
    if (look.dog && this.dogs && this.n[2] < this.dogs.instanceMatrix.count) {
      const j = this.n[2]++, off = _o.set(...HOLD.leash.dog).multiplyScalar(look.h).applyQuaternion(_q);
      this.dogs.setMatrixAt(j, _m.compose(_p.set(x + off.x, y, z + off.z), _q, _s));
      const speed = CLIP_META[clip].stride ? rate * CLIP_META[clip].stride : 0;
      writeFig(this.dogs, j, { ...DOG_LOOK, shirt: look.dog.coat, pants: look.dog.patch, skin: look.dog.patch }, speed ? CLIP['dog-walk'] : CLIP['dog-idle'], phase, speed ? speed / CLIP_META[CLIP['dog-walk']].stride : .25);
    }
    if (look.stroller && this.strollers && this.n[3] < this.strollers.instanceMatrix.count) {
      const j = this.n[3]++;
      this.strollers.setMatrixAt(j, _m.compose(_p.set(x, y, z), _q, _s));
      writeFig(this.strollers, j, { ...DOG_LOOK, shirt: look.stroller, pants: look.stroller, skin: look.stroller }, 0, 0, 0);
    }
    return i;
  }
  end() {
    [this.hi, this.lo, this.dogs, this.strollers, this.far].forEach((m, k) => {
      if (!m) return;
      m.count = this.n[k]; m.instanceMatrix.needsUpdate = true;
      for (const a of ['iA', 'iB', 'iC', 'iAnim', 'iLook']) m.geometry.attributes[a].needsUpdate = true;
    });
  }
  get meshes() { return [this.hi, this.lo, this.dogs, this.strollers, this.far].filter(Boolean); }
  dispose() {
    for (const m of this.meshes) { m.removeFromParent(); m.geometry.dispose(); m.dispose(); }
    for (const g of [...this.geos, this.farGeo, this.dogGeo, this.strollerGeo]) g?.dispose();
    this.mat.userData.depth.dispose(); this.mat.dispose();
  }
}

/**
 * A static crowd (people who stay put, such as race-day spectators), far detail, with the near band handed to a
 * Crowd: instances inside near.value.w of near.value.xyz are hidden here. list: [{ look, x, y, z, yaw, clip, phase, rate }].
 */
export function staticCrowdMesh(list, material, name, lod = 'lo') {
  const im = figureMesh(personGeometry(lod), material, list.length, name);
  list.forEach((p, i) => {
    _q.setFromAxisAngle(_up, p.yaw); im.setMatrixAt(i, _m.compose(_p.set(p.x, p.y, p.z), _q, _s));
    writeFig(im, i, p.look, p.clip, p.phase, p.rate ?? clipRate(p.clip));
  });
  im.count = list.length; im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.frustumCulled = true;
  return im;
}

// ---------------------------------------------------------------- posed copies (static models)
/**
 * A figure frozen in one frame of a clip, with its colours baked in: for people built into other models
 * (passengers, motorbike riders, spectators on chairs). Returns a plain indexed geometry (position, normal, color).
 */
/** A look's hair colour (bald: the skin a shade darker), as the figures draw it. */
export const hairColor = (look) => (look.hair >= 7 ? look.skin.clone().multiplyScalar(.92) : col(HAIR[look.hair]));

/**
 * (opts.channels: instead of colours, the paint's weights for a crowd impostor atlas (life/impostors.js): aCh0 =
 * shirt, trousers, skin, hair; aCh1 = 0, shin, forearm, 0 — the shin and the forearm apart, so an impostor can show
 * long or short trousers and sleeves by its own look. Bake with FIT.SLEEVES | FIT.LONG_PANTS. Everything else
 * (shoes, eyes, props) weighs nothing: it draws dark.)
 */
export function posedFigure(look, clip, { frame = 0, lod = 'lo', geometry = null, channels = false } = {}) {
  const src = geometry || personGeometry(lod), f = clipFloats();
  const P = src.attributes.position, N = src.attributes.normal, C = src.attributes.color, S = src.attributes.aSkin, Mk = src.attributes.aMask;
  const pos = [], nor = [], colr = [], keep = new Int32Array(P.count).fill(-1);
  const row = clip * FRAMES + (frame % FRAMES), qv = new THREE.Quaternion(), tv = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const bone = (b, out) => { const o = (row * BONES + b) * 7; qv.set(f[o], f[o + 1], f[o + 2], f[o + 3]).normalize(); tv.set(f[o + 4], f[o + 5], f[o + 6]); return out; };
  const kid = Math.max(0, Math.min(1, (.93 - look.h) / .33)), gz = 1 + (look.g - 1) * .6;
  const hair = look.hair >= 7 ? look.skin.clone().multiplyScalar(.92) : col(HAIR[look.hair]);
  for (let i = 0; i < P.count; i++) {
    const sel = Math.round(S.getW(i)), bits = look.bits;
    if (selHidden(sel, bits)) continue;
    const b0 = Math.round(S.getX(i)), b1 = Math.round(S.getY(i)), w = S.getZ(i);
    v.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
    bone(b0); const p0 = v.clone().applyQuaternion(qv).add(tv), n0 = n.clone().applyQuaternion(qv);
    if (b0 === 3 && kid > 0) { const neck = new THREE.Vector3(0, PERSON.pivot[3][1], 0).applyQuaternion(qv).add(tv); p0.sub(neck).multiplyScalar(1 + .5 * kid).add(neck); }
    if (w < .999) { bone(b1); p0.lerp(v.clone().applyQuaternion(qv).add(tv), 1 - w); n0.lerp(n.clone().applyQuaternion(qv), 1 - w); }
    keep[i] = pos.length / 3;
    pos.push(p0.x * look.g, p0.y * look.h, p0.z * gz); n0.normalize(); nor.push(n0.x, n0.y, n0.z);
    let mk = [Mk.getX(i), Mk.getY(i), Mk.getZ(i), Mk.getW(i)];
    if ((sel === SEL.FOREARM && !(bits & FIT.SLEEVES)) || (sel === SEL.SHIN && !(bits & FIT.LONG_PANTS)) || (sel === SEL.THIGH && (bits & FIT.SKIRT))) mk = [0, 0, 1, 0];
    if (channels) {
      const fore = sel === SEL.FOREARM ? mk[0] : 0, shin = sel === SEL.SHIN ? mk[1] : 0;
      colr.push(sel === SEL.FOREARM ? 0 : mk[0], sel === SEL.SHIN ? 0 : mk[1], mk[2], mk[3], 0, shin, fore, 0);
      continue;
    }
    const k = Math.max(0, 1 - mk[0] - mk[1] - mk[2] - mk[3]);
    for (const [ch, base] of [['r', C.getX(i)], ['g', C.getY(i)], ['b', C.getZ(i)]]) colr.push(base * k + look.shirt[ch] * mk[0] + look.pants[ch] * mk[1] + look.skin[ch] * mk[2] + hair[ch] * mk[3]);
  }
  const idx = [], I = src.index.array;
  for (let t = 0; t < I.length; t += 3) { const a = keep[I[t]], b = keep[I[t + 1]], c = keep[I[t + 2]]; if (a >= 0 && b >= 0 && c >= 0) idx.push(a, b, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (channels) {
    const a0 = [], a1 = [];
    for (let i = 0; i < colr.length; i += 8) { a0.push(colr[i], colr[i + 1], colr[i + 2], colr[i + 3]); a1.push(colr[i + 4], colr[i + 5], colr[i + 6], colr[i + 7]); }
    g.setAttribute('aCh0', new THREE.Float32BufferAttribute(a0, 4)); g.setAttribute('aCh1', new THREE.Float32BufferAttribute(a1, 4));
  } else g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  if (!geometry) src.dispose();
  return g;
}

/** Triangles in each model (for the gallery and tests). */
export function figureStats() {
  const tris = (g) => { const n = g.index.count / 3; g.dispose(); return n; };
  return { personHi: tris(personGeometry('hi')), personLo: tris(personGeometry('lo')), personFar: tris(personGeometry('far')), cyclistHi: tris(cyclistGeometry('hi')), cyclistLo: tris(cyclistGeometry('lo')), dog: tris(dogGeometry()), stroller: tris(strollerGeometry()) };
}
