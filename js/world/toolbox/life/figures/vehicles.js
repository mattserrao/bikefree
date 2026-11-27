// Toolbox figures: vehicles in the soft cartoon style, shared by city life, traffic and race day. Rounded
// bodies with smooth shading, glass you can see from the chase camera (windscreen, side and rear windows), round
// wheels that turn with the distance driven, bumpers, lights that glow at night and brake lights. Motorbikes
// and the Red Jammers carry posed figures from the people kit.
//
// One indexed geometry per kind (+Z forward, ground at y = 0). Per vertex aVeh: (part, wheel, axle y, axle z);
// part 0 is paint (tinted by the instance's iPaint), 1 fixed colour, 2 glass, 10 headlight, 11 tail / brake
// light, 12 lit sign or interior. Per instance: iPaint (linear RGB), iMove (distance driven in metres, braking 0–1).
import * as THREE from '../../../../../vendor/three.js';
import { posedFigure, CLIP, randomLook, FIT } from './people.js';
import { nightGlowShader } from '../../materials/night-glow.js';
import { anchor } from '../../core/shader-patch.js';   // [review 27 Nov] T8: a missing shader anchor throws

export const VEHICLE_KINDS = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'taxi', 'bus', 'rv', 'camper', 'moto', 'jammer'];
// length in metres (traffic spacing) and default paint, where a kind has one
export const VEHICLE_INFO = {
  sedan: { len: 4.5 }, hatch: { len: 3.95 }, suv: { len: 4.75 }, pickup: { len: 5.3 }, van: { len: 5.0 }, taxi: { len: 4.5, paint: '#f4c430' },
  bus: { len: 12, paint: '#f2f2f2' }, rv: { len: 8.4, paint: '#f6f3ec' }, camper: { len: 4.7 }, moto: { len: 2.2 }, jammer: { len: 7.6, paint: '#b5231c' },
};
export const PAINTS = ['#b23a2e', '#1f3a5f', '#e9ecee', '#2b2b2b', '#7f8c8d', '#c5c9cc', '#28543c', '#d9c38a', '#5b2c6f', '#8a3c12', '#ffffff', '#4f6475', '#9db4c8', '#c9c2b0', '#3a7ca5', '#e07a2f'];
export const PART = { PAINT: 0, FIXED: 1, GLASS: 2, HEAD: 10, TAIL: 11, GLOW: 12 };
const GLASS = '#2a3742', TYRE = '#1b1b1d', HUB = '#b9bec4', TRIM = '#3a3d42', CHROME = '#d9dde0';

export class VehBuilder {
  constructor(lite = false) { this.lite = lite; this._init(); }
  _init() { this.p = []; this.n = []; this.c = []; this.a = []; this.i = []; this.st = { color: [1, 1, 1], part: 0, wheel: [0, 0, 0] }; }
  set(color, part = PART.FIXED) { const c = new THREE.Color(color); this.st = { color: [c.r, c.g, c.b], part, wheel: [0, 0, 0] }; return this; }
  paint() { return this.set('#ffffff', PART.PAINT); }
  v(x, y, z, nx, ny, nz) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z); this.n.push(nx / l, ny / l, nz / l); this.c.push(...this.st.color); this.a.push(this.st.part, ...this.st.wheel);
    return this.p.length / 3 - 1;
  }
  /**
   * Rounded box: centre, size [w, h, l], corner radius. o.taper (top width share), o.rakeF / o.rakeR (how far the
   * top's front / back edge leans in, metres), o.bulge — enough to make a car's glasshouse from a box.
   */
  rbox([cx, cy, cz], [w, h, l], r = .1, o = {}) {
    if (this.lite) return this.bevel([cx, cy, cz], [w, h, l], r, o);
    const hs = [w / 2, h / 2, l / 2], rr = Math.min(r, ...hs.map((x) => x * .95)), sharp = rr < .045;
    // small radii: a plain box (one quad a face, flat normals)
    const g = (k) => { const e = rr / hs[k]; return sharp ? [-1, 1] : [-1, -1 + e, 1 - e, 1]; };
    const faces = [[0, 1, 2, 1], [0, 2, 1, -1], [1, 2, 0, 1], [1, 0, 2, -1], [2, 0, 1, 1], [2, 1, 0, -1]];
    for (const [ax, ua, va, sgn] of faces) {
      const base = this.p.length / 3, U = g(ua), Vv = g(va);
      for (const u of U) for (const vv of Vv) {
        const q = [0, 0, 0]; q[ax] = sgn * hs[ax]; q[ua] = u * hs[ua]; q[va] = vv * hs[va];
        const inner = q.map((x, k) => Math.max(-(hs[k] - rr), Math.min(hs[k] - rr, x)));
        let n = q.map((x, k) => x - inner[k]); const nl = Math.hypot(...n) || 1; n = n.map((x) => x / nl);
        if (sharp) { n = [0, 0, 0]; n[ax] = sgn; }
        let [x, y, z] = sharp ? q : inner.map((v2, k) => v2 + n[k] * rr);
        const t = (y + hs[1]) / (2 * hs[1]);
        if (o.taper) x *= 1 + (o.taper - 1) * t;
        if (o.rakeF && z > 0) z -= o.rakeF * t * (z / hs[2]);
        if (o.rakeR && z < 0) z += o.rakeR * t * (-z / hs[2]);
        let [nx, ny, nz] = n;
        if (o.rakeF && z > 0 && nz > .3) ny += o.rakeF / h * nz;
        if (o.rakeR && z < 0 && nz < -.3) ny += o.rakeR / h * -nz;
        this.v(cx + x, cy + y, cz + z, nx, ny, nz);
      }
      // with this face's u × v along its outward normal, (u, v) → (u+1, v) → (u+1, v+1) is counter-clockwise
      const flip = (() => { const a = [0, 0, 0], b = [0, 0, 0]; a[ua] = 1; b[va] = 1; const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; return c[ax] * sgn < 0; })();
      const S = U.length;
      for (let iu = 0; iu < S - 1; iu++) for (let iv = 0; iv < S - 1; iv++) {
        const k = base + iu * S + iv, k1 = k + S;
        if (!flip) { this.tri(k, k1, k1 + 1); this.tri(k, k1 + 1, k + 1); } else { this.tri(k, k1 + 1, k1); this.tri(k, k + 1, k1 + 1); }
      }
    }
    return this;
  }
  /**
   * The light version of rbox: a bevelled box (6 faces, 12 bevels, 8 corners: 44 triangles) whose face normals
   * blend across the bevels, so it still shades soft. Same options.
   */
  bevel([cx, cy, cz], [w, h, l], r = .1, o = {}) {
    const hs = [w / 2, h / 2, l / 2], flat = r < .045, rr = flat ? 0 : Math.min(r, ...hs.map((x) => x * .45));
    const map = new Map(), P = (ax, sgn, s) => {
      const key = `${ax}${sgn}${s.join()}`; if (map.has(key)) return map.get(key);
      const q = s.map((sv, k) => k === ax ? sgn * hs[k] : sv * (hs[k] - rr));
      let [x, y, z] = q; const t = (y + hs[1]) / (2 * hs[1]);
      if (o.taper) x *= 1 + (o.taper - 1) * t;
      if (o.rakeF && z > 0) z -= o.rakeF * t * (z / hs[2]);
      if (o.rakeR && z < 0) z += o.rakeR * t * (-z / hs[2]);
      const n = [0, 0, 0]; n[ax] = sgn;
      if (o.rakeF && ax === 2 && sgn > 0) n[1] += o.rakeF / h;
      if (o.rakeR && ax === 2 && sgn < 0) n[1] += o.rakeR / h;
      const id = this.v(cx + x, cy + y, cz + z, ...n); map.set(key, id); return id;
    };
    const pos = (id) => this.p.slice(id * 3, id * 3 + 3);
    const face = (ids, out) => {   // a polygon (3 or 4 ids), wound to face `out`
      const [a, b, c] = ids.map(pos), u = b.map((v, k) => v - a[k]), v2 = c.map((v, k) => v - a[k]);
      const n = [u[1] * v2[2] - u[2] * v2[1], u[2] * v2[0] - u[0] * v2[2], u[0] * v2[1] - u[1] * v2[0]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) ids = [...ids].reverse();
      this.tri(ids[0], ids[1], ids[2]); if (ids.length > 3) this.tri(ids[0], ids[2], ids[3]);
    };
    const S = [-1, 1];
    for (let ax = 0; ax < 3; ax++) for (const sg of S) {
      const [u, v] = [0, 1, 2].filter((k) => k !== ax), pt = (su, sv) => { const s3 = [0, 0, 0]; s3[ax] = sg; s3[u] = su; s3[v] = sv; return P(ax, sg, s3); };
      const out = [0, 0, 0]; out[ax] = sg; face([pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)], out);
    }
    if (flat) return this;   // a small radius: just the six faces
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (const sa of S) for (const sb of S) {
      const c = 3 - a - b, vtx = (ax, sc) => { const s3 = [0, 0, 0]; s3[a] = sa; s3[b] = sb; s3[c] = sc; return P(ax, ax === a ? sa : sb, s3); };
      const out = [0, 0, 0]; out[a] = sa; out[b] = sb; face([vtx(a, -1), vtx(a, 1), vtx(b, 1), vtx(b, -1)], out);
    }
    for (const sx of S) for (const sy of S) for (const sz of S) { const s3 = [sx, sy, sz]; face([P(0, sx, s3), P(1, sy, s3), P(2, sz, s3)], s3); }
    return this;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  ellipsoid([cx, cy, cz], [rx, ry, rz], lat = 4, lon = 8) {
    const base = this.p.length / 3;
    for (let a = 0; a <= lat; a++) {
      const th = a / lat * Math.PI, sy = Math.cos(th), sr = Math.sin(th);
      for (let b = 0; b <= lon; b++) { const ph = b / lon * Math.PI * 2, x = Math.sin(ph) * sr, z = Math.cos(ph) * sr; this.v(cx + x * rx, cy + sy * ry, cz + z * rz, x / rx, sy / ry, z / rz); }
    }
    for (let a = 0; a < lat; a++) for (let b = 0; b < lon; b++) {
      const k = base + a * (lon + 1) + b, k2 = k + lon + 1;
      if (a > 0) this.tri(k, k2, k + 1);
      if (a < lat - 1) this.tri(k + 1, k2, k2 + 1);
    }
    return this;
  }
  /** Rod from a to b (radius r), open ends. */
  rod(a, b, r, seg = 6) {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A).normalize();
    const s = Math.abs(d.y) < .9 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0).cross(d).normalize(), t = d.clone().cross(s);
    const base = this.p.length / 3;
    for (const P of [A, Bv]) for (let k = 0; k <= seg; k++) { const ph = k / seg * Math.PI * 2, n = s.clone().multiplyScalar(Math.cos(ph)).addScaledVector(t, Math.sin(ph)); this.v(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r, n.x, n.y, n.z); }
    for (let k = 0; k < seg; k++) this.tri(base + k, base + k + 1, base + seg + 2 + k), this.tri(base + k, base + seg + 2 + k, base + seg + 1 + k);
    return this;
  }
  /** A wheel turning about X: tyre (rounded cylinder), hub cap on the outside. side: +1 left (+X) / −1 right. */
  wheel(x, cy, cz, r, w, side, seg = 10) {
    const save = this.st;
    if (this.lite) seg = Math.min(seg, 8);
    const ring = (rad, xx, nx, nr) => { const ids = []; for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2, y = Math.cos(a), z = Math.sin(a); ids.push(this.v(xx, cy + y * rad, cz + z * rad, nx, y * nr, z * nr)); } return ids; };
    const strip = (A, Bv) => { for (let k = 0; k < seg; k++) side > 0 ? (this.tri(A[k], A[k + 1], Bv[k + 1]), this.tri(A[k], Bv[k + 1], Bv[k])) : (this.tri(A[k], Bv[k + 1], A[k + 1]), this.tri(A[k], Bv[k], Bv[k + 1])); };
    this.set(TYRE); this.st.wheel = [1, cy, cz];
    const xi = x - side * w / 2, xo = x + side * w / 2;
    const r1 = ring(r, xi, -side * .3, 1), r2 = ring(r, xo - side * w * .15, side * .3, 1);
    strip(r1, r2);
    if (!this.lite) strip(r2, ring(r * .8, xo, side, .2));
    // hub cap (a shallow dome), with 5 dark slots so the turning shows
    this.set(HUB); this.st.wheel = [1, cy, cz];
    const c = this.v(xo + side * .015, cy, cz, side, 0, 0), h = ring(r * .62, xo, side, .35);
    for (let k = 0; k < seg; k++) side > 0 ? this.tri(c, h[k], h[k + 1]) : this.tri(c, h[k + 1], h[k]);
    if (this.lite) { this.st = save; return this; }
    this.set(TRIM); this.st.wheel = [1, cy, cz];
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2, y = cy + Math.cos(a) * r * .36, z = cz + Math.sin(a) * r * .36, d = r * .1, xx = xo + side * .018;
      const ids = [[-d, -d], [d, -d], [d, d], [-d, d]].map(([u, v]) => this.v(xx, y + u, z + v, side, 0, 0));
      side > 0 ? (this.tri(ids[0], ids[1], ids[2]), this.tri(ids[0], ids[2], ids[3])) : (this.tri(ids[0], ids[2], ids[1]), this.tri(ids[0], ids[3], ids[2]));
    }
    this.st = save;
    return this;
  }
  box([cx, cy, cz], [w, h, l]) { return this.rbox([cx, cy, cz], [w, h, l], .002); }
  /** Merge a plain coloured geometry (a posed figure), transformed. */
  merge(g, matrix, part = PART.FIXED) {
    const base = this.p.length / 3, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, v = new THREE.Vector3(), n = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let k = 0; k < P.count; k++) {
      v.fromBufferAttribute(P, k).applyMatrix4(matrix); n.fromBufferAttribute(N, k).applyMatrix3(nm);
      this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z); this.c.push(C.getX(k), C.getY(k), C.getZ(k)); this.a.push(part, 0, 0, 0);
    }
    for (const k of g.index.array) this.i.push(base + k);
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aVeh', new THREE.Float32BufferAttribute(this.a, 4));
    g.setIndex(this.i); g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------- the kinds
function lights(M, W, yH, zF, yT, zR, round = true) {
  if (M.lite) return;
  M.set('#fff6dc', PART.HEAD); for (const s of [1, -1]) M.ellipsoid([s * (W / 2 - .28), yH, zF], [.15, .075, .035], 3, 6);
  M.set('#b0201a', PART.TAIL); for (const s of [1, -1]) M.ellipsoid([s * (W / 2 - .2), yT, zR], [.13, .07, .03], 3, 6);
}
function bumpers(M, W, zF, zR, y = .42) { if (M.lite) return; M.set(TRIM); M.rbox([0, y, zF], [W + .02, .22, .2], .04); M.rbox([0, y + .02, zR], [W + .02, .22, .2], .04); }
function pillars(M, pts, r = .045) { if (M.lite) return; M.paint(); for (const [a, b] of pts) for (const s of [1, -1]) M.rod([s * a[0], a[1], a[2]], [s * b[0], b[1], b[2]], r, 4); }
function wheels(M, W, zs, r = .33, w = .23, inset = .1) { for (const z of zs) for (const s of [1, -1]) M.wheel(s * (W / 2 - inset), r, z, r, w, s); }
function mirrors(M, W, y, z) { if (M.lite) return; M.paint(); for (const s of [1, -1]) M.ellipsoid([s * (W / 2 + .08), y, z], [.07, .05, .04], 2, 5); }

const BUILD = {
  sedan(M, o = {}) {
    const W = 1.8, L = 4.5;
    M.paint().rbox([0, .62, 0], [W, .64, L], .17);
    M.set(GLASS, PART.GLASS).rbox([0, 1.165, -.22], [W - .16, .48, 2.35], .13, { taper: .84, rakeF: .42, rakeR: .36 });
    M.paint().rbox([0, 1.42, -.24], [W - .38, .07, 1.5], .035);
    pillars(M, [[[.79, .94, .92], [.66, 1.40, .5]], [[.79, .94, -1.38], [.66, 1.40, -.98]], [[.78, .94, -.24], [.7, 1.40, -.24]]]);
    if (!M.lite) M.set(TRIM).rbox([0, .62, L / 2 + .01], [.72, .14, .04], .02);
    bumpers(M, W, L / 2 + .02, -L / 2 - .02); lights(M, W, .72, L / 2 + .01, .76, -L / 2 - .01); mirrors(M, W, 1.0, .62);
    wheels(M, W, [1.38, -1.38]);
    if (o.taxi) { M.set('#fff3c4', PART.GLOW).rbox([0, 1.52, -.2], [.62, .17, .24], .05); M.set('#1b1b1b').rbox([0, .82, 0], [W + .015, .08, 1.6], .02); }
  },
  hatch(M) {
    const W = 1.74, L = 3.95;
    M.paint().rbox([0, .62, 0], [W, .64, L], .18);
    M.set(GLASS, PART.GLASS).rbox([0, 1.165, -.32], [W - .16, .5, 2.4], .13, { taper: .85, rakeF: .44, rakeR: .1 });
    M.paint().rbox([0, 1.43, -.4], [W - .36, .07, 1.75], .035);
    pillars(M, [[[.77, .94, .86], [.64, 1.41, .44]], [[.77, .94, -1.5], [.66, 1.41, -1.36]]]);
    bumpers(M, W, L / 2 + .02, -L / 2 - .02); lights(M, W, .72, L / 2 + .01, .9, -L / 2 - .01); mirrors(M, W, 1.0, .5);
    wheels(M, W, [1.22, -1.22], .31);
  },
  suv(M) {
    const W = 1.92, L = 4.75;
    M.paint().rbox([0, .74, 0], [W, .8, L], .18);
    M.set(GLASS, PART.GLASS).rbox([0, 1.415, -.25], [W - .14, .58, 3.05], .12, { taper: .9, rakeF: .4, rakeR: .1 });
    M.paint().rbox([0, 1.72, -.32], [W - .26, .07, 2.4], .035);
    pillars(M, [[[.85, 1.12, 1.02], [.76, 1.69, .62]], [[.85, 1.12, -1.75], [.8, 1.69, -1.65]], [[.85, 1.12, -.3], [.8, 1.69, -.3]]], .05);
    if (!M.lite) {
      M.set(TRIM).rbox([0, .5, 0], [W + .03, .2, L - 1.6], .06);
    }
    bumpers(M, W, L / 2 + .02, -L / 2 - .02, .48); lights(M, W, .86, L / 2 + .01, .96, -L / 2 - .01); mirrors(M, W, 1.2, .72);
    wheels(M, W, [1.48, -1.45], .37, .26);
  },
  pickup(M) {
    const W = 1.94, L = 5.3;
    M.paint().rbox([0, .73, 0], [W, .78, L], .15);
    M.set(GLASS, PART.GLASS).rbox([0, 1.39, .62], [W - .16, .56, 1.65], .12, { taper: .9, rakeF: .36, rakeR: .02 });
    M.paint().rbox([0, 1.69, .58], [W - .3, .07, 1.25], .035);
    pillars(M, [[[.86, 1.1, 1.42], [.76, 1.67, 1.08]], [[.86, 1.1, -.18], [.8, 1.67, -.15]]], .05);
    M.set('#2a2a2a').rbox([0, 1.125, -1.42], [W - .2, .03, 2.25], .01);   // the bed floor
    M.paint(); for (const s of [1, -1]) M.rbox([s * (W / 2 - .05), 1.2, -1.42], [.1, .17, 2.35], .04);
    M.rbox([0, 1.2, -L / 2 + .06], [W, .17, .1], .04);
    bumpers(M, W, L / 2 + .02, -L / 2 - .02, .5); lights(M, W, .86, L / 2 + .01, .98, -L / 2 - .01); mirrors(M, W, 1.22, 1.1);
    wheels(M, W, [1.66, -1.62], .38, .27);
  },
  van(M) {
    const W = 1.98, L = 5.0;
    M.paint().rbox([0, .78, 0], [W, .96, L], .2);
    M.set(GLASS, PART.GLASS).rbox([0, 1.47, -.05], [W - .1, .52, L - .5], .14, { taper: .96, rakeF: .55, rakeR: .03 });
    M.paint().rbox([0, 1.86, -.2], [W - .12, .3, L - 1.2], .14);
    pillars(M, [[[.91, 1.25, 1.72], [.86, 1.73, 1.2]], [[.93, 1.25, .3], [.9, 1.73, .3]], [[.93, 1.25, -1.0], [.9, 1.73, -1.0]], [[.93, 1.25, -2.2], [.9, 1.73, -2.2]]], .055);
    bumpers(M, W, L / 2 + .02, -L / 2 - .02, .45); lights(M, W, .82, L / 2 + .01, .95, -L / 2 - .01); mirrors(M, W, 1.3, 1.45);
    wheels(M, W, [1.7, -1.62], .34);
  },
  taxi(M) { BUILD.sedan(M, { taxi: true }); },
  bus(M) {
    const W = 2.55, L = 12;
    M.paint().rbox([0, 1.65, 0], [W, 2.7, L], .28);
    M.set(GLASS, PART.GLASS).rbox([0, 2.08, -.2], [W + .03, .95, L - 1.4], .12);
    M.rbox([0, 1.75, L / 2 - .02], [W - .25, 1.8, .1], .08);
    M.rbox([0, 2.15, -L / 2 + .02], [W - .5, .8, .1], .06);
    M.set('#2a5aa5').rbox([0, .98, 0], [W + .035, .26, L - .2], .06);
    M.set('#1e2a33').rbox([W / 2 + .005, 1.25, L / 2 - 1.6], [.03, 2.0, 1.15], .02);   // the door
    M.set('#fff3c4', PART.GLOW).rbox([0, 2.82, L / 2 - .02], [1.7, .22, .08], .03);
    bumpers(M, W, L / 2 + .04, -L / 2 - .04, .45);
    lights(M, W, .7, L / 2 + .02, .8, -L / 2 - .02);
    M.set(TRIM); for (const s of [1, -1]) M.rod([s * (W / 2 - .1), 2.4, L / 2 + .02], [s * (W / 2 + .2), 2.1, L / 2 + .25], .025, 4);
    wheels(M, W, [3.9, -3.4], .5, .3, .16);
  },
  rv(M) {
    const W = 2.4, L = 8.4;
    M.paint().rbox([0, .82, 3.05], [W - .14, 1.0, 2.3], .22);
    M.set(GLASS, PART.GLASS).rbox([0, 1.55, 3.0], [W - .22, .62, 1.9], .14, { taper: .94, rakeF: .4 });
    M.paint().rbox([0, 2.05, -.75], [W, 3.1, L - 1.85], .26);
    M.rbox([0, 2.55, 2.65], [W - .05, .85, 1.7], .3);
    M.set('#7a5a3a').rbox([0, 1.3, -.75], [W + .02, .16, L - 2.0], .04);
    M.set('#c58c4a').rbox([0, 1.5, -.75], [W + .02, .07, L - 2.0], .02);
    M.set(GLASS, PART.GLASS); for (const z of [-2.8, .2]) for (const s of [1, -1]) M.rbox([s * W / 2, 2.15, z], [.04, .6, 1.2], .05);
    M.set('#1e2a33').rbox([W / 2 + .005, 1.55, 1.0], [.03, 1.75, .75], .02);
    bumpers(M, W - .1, L / 2 + .05, -L / 2 + .05, .45); lights(M, W - .1, .85, L / 2 + .03, 1.0, -L / 2 + .08);
    wheels(M, W - .1, [3.0, -2.2], .4, .28, .14);
  },
  camper(M) {
    const W = 1.86, L = 4.7;
    M.paint().rbox([0, .84, 0], [W, 1.08, L], .32);
    M.set('#f2efe6').rbox([0, 1.66, -.05], [W - .04, .7, L - .2], .32);
    M.set(GLASS, PART.GLASS).rbox([0, 1.6, 0], [W + .015, .42, L - .5], .16, { rakeF: .1 });
    M.set('#f2efe6').ellipsoid([0, 1.0, L / 2 + .01], [.16, .16, .03], 2, 10);
    bumpers(M, W, L / 2 + .03, -L / 2 - .03, .42);
    M.set('#fff6dc', PART.HEAD); for (const s of [1, -1]) M.ellipsoid([s * .62, .85, L / 2 - .02], [.1, .1, .05], 2, 8);
    M.set('#b0201a', PART.TAIL); for (const s of [1, -1]) M.ellipsoid([s * .7, .9, -L / 2 + .02], [.06, .11, .04], 2, 6);
    wheels(M, W, [1.45, -1.45], .34);
  },
  moto(M, o = {}) {
    const r = .31;
    for (const z of [.7, -.68]) { M.wheel(0, r, z, r, .13, 1, 12); }
    M.set('#4a4d52').rbox([0, .55, -.02], [.3, .32, .55], .08);
    M.paint().rbox([0, .88, .12], [.32, .24, .56], .12);
    M.set('#1d1d1f').rbox([0, .84, -.38], [.28, .1, .62], .05);
    M.paint().rbox([0, .68, -.78], [.2, .08, .45], .04);
    M.set(CHROME).rod([0, 1.0, .5], [0, r, .7], .03, 5).rod([-.36, 1.02, .38], [.36, 1.02, .38], .02, 5).rod([.16, .35, -.1], [.2, .45, -.85], .045, 6);
    M.set('#fff6dc', PART.HEAD).ellipsoid([0, .95, .64], [.09, .09, .05], 2, 8);
    M.set('#b0201a', PART.TAIL).ellipsoid([0, .76, -1.0], [.07, .04, .03], 2, 6);
    // the rider, in the moto pose with a helmet
    const rand = o.rand || Math.random;
    const look = { ...randomLook(rand, { kids: 0, helmet: true, shirts: ['#2b2b2b', '#1f3a5f', '#5a3a22', '#7f1d1d', '#3b3b3b'] }) };
    look.pants = new THREE.Color('#25282c'); look.bits |= FIT.LONG_PANTS | FIT.SLEEVES;
    M.merge(posedFigure(look, CLIP.moto, { lod: 'hi' }), new THREE.Matrix4());
  },
  jammer(M, o = {}) {
    // 1930s tour bus: long hood, rounded fenders, four rows of bench seats under an open top, the canvas rolled back
    const W = 2.15, L = 7.6;
    M.paint().rbox([0, 1.0, -.9], [W, 1.05, L - 2.6], .14);
    M.rbox([0, .98, L / 2 - 1.15], [1.35, .82, 2.1], .26);
    M.set(CHROME).rbox([0, 1.0, L / 2 - .07], [1.15, .74, .1], .08);
    M.set('#1a1a1a'); for (const s of [1, -1]) M.ellipsoid([s * .82, .62, L / 2 - 1.05], [.24, .34, .66], 3, 8);
    for (const s of [1, -1]) M.ellipsoid([s * (W / 2 - .02), .62, -L / 2 + 1.25], [.22, .34, .7], 3, 8);
    M.set('#2c2019'); for (let r = 0; r < 4; r++) { M.rbox([0, 1.86, 1.08 - r * 1.2], [W - .22, .5, .14], .05); M.rbox([0, 1.6, 1.3 - r * 1.2], [W - .22, .1, .45], .04); }
    M.set('#cdbb8f').rbox([0, 1.9, -L / 2 + .55], [W - .1, .55, .8], .22);
    M.set(CHROME).rod([-W / 2 + .1, 1.55, L / 2 - 2.25], [-W / 2 + .1, 2.05, L / 2 - 2.25], .025, 4).rod([W / 2 - .1, 1.55, L / 2 - 2.25], [W / 2 - .1, 2.05, L / 2 - 2.25], .025, 4).rod([-W / 2 + .1, 2.05, L / 2 - 2.25], [W / 2 - .1, 2.05, L / 2 - 2.25], .025, 4);
    M.set(GLASS, PART.GLASS).rbox([0, 1.8, L / 2 - 2.25], [W - .25, .45, .03], .01);
    M.set('#fff6dc', PART.HEAD); for (const s of [1, -1]) M.ellipsoid([s * .8, 1.12, L / 2 - .5], [.13, .13, .1], 3, 8);
    M.set('#b0201a', PART.TAIL); for (const s of [1, -1]) M.ellipsoid([s * (W / 2 - .2), .8, -L / 2 + .44], [.08, .06, .03], 2, 6);
    for (const z of [L / 2 - 1.05]) for (const s of [1, -1]) M.wheel(s * .82, .4, z, .4, .2, s);
    for (const s of [1, -1]) M.wheel(s * (W / 2 - .1), .4, -L / 2 + 1.25, .4, .22, s);
    // passengers on the benches (2–3 a row), posed sitting and looking around
    const rand = o.rand || Math.random;
    for (let r = 0; r < 4; r++) for (const x of [-.6, 0, .6]) {
      if (rand() < .35) continue;
      const look = randomLook(rand, { kids: .1, caps: .25 });
      const m = new THREE.Matrix4().makeRotationY((rand() - .5) * .5).setPosition(x, 1.1, 1.0 - r * 1.2);
      M.merge(posedFigure(look, CLIP.ride, { frame: Math.floor(rand() * 24) }), m);
    }
  },
};

const CACHE = new Map();
/**
 * The geometry of one vehicle kind (shared; don't dispose it, call disposeVehicleGeometries()). lod 'hi' for
 * traffic (about 600 triangles a car), 'lo' for parked ones (under 200: bevelled boxes, plain wheels, no lights).
 */
export function vehicleGeometry(kind, lod = 'hi') {
  if (!BUILD[kind]) kind = 'sedan';
  const key = `${kind}|${lod}`;
  if (!CACHE.has(key)) {
    let seed = 4242 + kind.length * 97; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const M = new VehBuilder(lod === 'lo'); BUILD[kind](M, { rand }); CACHE.set(key, M.geometry());
  }
  return CACHE.get(key);
}
export function disposeVehicleGeometries() { for (const g of [...CACHE.values(), ...PARKED.values()]) g.dispose(); CACHE.clear(); PARKED.clear(); }

/** The vehicles' material: paint per instance, turning wheels, headlights and tail lights (brighter when braking). */
export function vehicleMaterial(night = { value: 0 }) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .08 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(anchor('#include <common>'), `#include <common>
        attribute vec4 aVeh; attribute vec3 iPaint; attribute vec2 iMove; varying float vPart; varying float vBrake;
        vec3 vehSpin(vec3 p, float a) { float c = cos(a), s = sin(a), y = p.y - aVeh.z, z = p.z - aVeh.w; return vec3(p.x, aVeh.z + y * c - z * s, aVeh.w + y * s + z * c); }
        vec3 vehSpinN(vec3 n, float a) { float c = cos(a), s = sin(a); return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c); }`)
      .replace(anchor('#include <beginnormal_vertex>'), `vec3 objectNormal = normal;
        float vehA = aVeh.y > .5 ? iMove.x / max(aVeh.z, .1) : 0.;
        if (aVeh.y > .5) objectNormal = vehSpinN(objectNormal, vehA);`)
      .replace(anchor('#include <begin_vertex>'), 'vec3 transformed = aVeh.y > .5 ? vehSpin(position, vehA) : position;')
      .replace(anchor('#include <color_vertex>'), `#include <color_vertex>
        if (aVeh.x < .5) vColor.rgb *= iPaint;
        vPart = aVeh.x; vBrake = iMove.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(anchor('#include <common>'), '#include <common>\nvarying float vPart; varying float vBrake;')
      .replace(anchor('#include <roughnessmap_fragment>'), `#include <roughnessmap_fragment>
        if (vPart > 1.5 && vPart < 2.5) roughnessFactor = .18;`);
    nightGlowShader(shader, night, `
        if (vPart > 9.5 && vPart < 10.5) totalEmissiveRadiance += vec3(1., .93, .78) * (.15 + uNight * 4.);
        if (vPart > 10.5 && vPart < 11.5) totalEmissiveRadiance += vec3(1., .1, .06) * (.2 + uNight * 2.2 + vBrake * 2.2);
        if (vPart > 11.5 && vPart < 12.5) totalEmissiveRadiance += vec3(1., .86, .6) * (.1 + uNight * 1.2);`);   // [review 27 Nov] the shared night glow
  };
  m.customProgramCacheKey = () => 'bf-vehicles-1';
  return m;
}

/** An instanced mesh of one vehicle kind with iPaint / iMove set up (count starts at 0). */
export function vehicleMesh(kind, material, capacity, name, { shadows = true } = {}) {
  const g = vehicleGeometry(kind).clone(), n = Math.max(1, capacity);
  const paint = new Float32Array(n * 3).fill(1), move = new Float32Array(n * 2);
  g.setAttribute('iPaint', new THREE.InstancedBufferAttribute(paint, 3)); g.setAttribute('iMove', new THREE.InstancedBufferAttribute(move, 2));
  g.attributes.iMove.setUsage(THREE.DynamicDrawUsage);
  const im = new THREE.InstancedMesh(g, material, n);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false; im.castShadow = shadows; im.receiveShadow = true; im.name = name; im.count = 0;
  im.userData.dynamic = true; im.userData.kind = kind;
  const def = VEHICLE_INFO[kind]?.paint;
  if (def) for (let i = 0; i < n; i++) setPaint(im, i, def);
  return im;
}
const _c = new THREE.Color();
export function setPaint(im, i, hex) { _c.set(hex); im.geometry.attributes.iPaint.setXYZ(i, _c.r, _c.g, _c.b); im.geometry.attributes.iPaint.needsUpdate = true; }
export function setMove(im, i, dist, brake = 0) { im.geometry.attributes.iMove.setXY(i, dist, brake); }

/** A vehicle with its paint baked in, as plain coloured geometry (parked models merged into scenery). */
export function staticVehicle(kind, paint, lod = 'lo') {
  const src = vehicleGeometry(kind, lod), g = new THREE.BufferGeometry(), C = src.attributes.color, A = src.attributes.aVeh, out = new Float32Array(C.count * 3), p = new THREE.Color(paint || VEHICLE_INFO[kind]?.paint || '#ffffff');
  for (let k = 0; k < C.count; k++) { const t = A.getX(k) < .5; out.set([C.getX(k) * (t ? p.r : 1), C.getY(k) * (t ? p.g : 1), C.getZ(k) * (t ? p.b : 1)], k * 3); }
  g.setAttribute('position', src.attributes.position.clone()); g.setAttribute('normal', src.attributes.normal.clone()); g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  g.setIndex(src.index.clone()); g.computeBoundingSphere();
  return g;
}

/** Append an indexed coloured geometry, transformed, to a model-builder Builder (non-indexed, flat lists). */
export function appendToBuilder(builder, g, matrix) {
  const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, I = g.index.array, v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (const k of I) {
    v.fromBufferAttribute(P, k).applyMatrix4(matrix); n.fromBufferAttribute(N, k).applyMatrix3(nm).normalize();
    builder.pos.push(v.x, v.y, v.z); builder.nor.push(n.x, n.y, n.z); builder.col.push(C.getX(k), C.getY(k), C.getZ(k)); builder.prt.push(builder.part);
  }
  return builder;
}

/** Append an indexed coloured geometry, transformed, to a MeshBuilder (the city kit's builders). */
export function appendToMeshBuilder(M, g, matrix) {
  const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix), base = M.count, save = M.cur.color;
  for (let k = 0; k < P.count; k++) {
    v.fromBufferAttribute(P, k).applyMatrix4(matrix); n.fromBufferAttribute(N, k).applyMatrix3(nm).normalize();
    M.cur.color = [C.getX(k), C.getY(k), C.getZ(k)];
    M.vertex(v.x, v.y, v.z, n.x, n.y, n.z);
  }
  M.cur.color = save;
  const I = g.index.array;
  for (let t = 0; t < I.length; t += 3) M.tri(base + I[t], base + I[t + 1], base + I[t + 2]);
  return M;
}
const PARKED = new Map();
/** A parked car (paint baked in), cached by kind and paint. */
export function parkedVehicle(kind, paint) {
  const key = `${kind}|${paint}`;
  if (!PARKED.has(key)) PARKED.set(key, staticVehicle(kind, paint));
  return PARKED.get(key);
}

export function vehicleStats(lod = 'hi') { return Object.fromEntries(VEHICLE_KINDS.map((k) => [k, vehicleGeometry(k, lod).index.count / 3])); }
