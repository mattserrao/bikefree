// Building kit: geometry. Turns a recipe (recipe.js) into faces for the facade shader: walls in zones
// (plinth, body, timber upper storey, gable), roofs as thick slabs (gable, half-hip, hip, shed, flat, crow-
// stepped gables), and the parts that change a building's outline: wings, balconies and galleries, dormers,
// chimneys, lean-tos, garages, outside stairs, génoise, bell towers, solar panels, sundials. Small things
// (canopies, steps, gutters, awnings) go to a second writer for the near detail mesh.
//
// Every face carries the attributes facade-material.js reads; nothing here draws a pattern itself.
import * as THREE from '../../../../../vendor/three.module.min.js';
import { S, W } from './presets.js';
import { F, FRAMES } from './facade-material.js';
import { bays } from './recipe.js';

// colours stay in sRGB here (the shader linearises them): no colour-space conversion
const SRGB = new Map();
const srgb = (hex) => { let c = SRGB.get(hex); if (!c) SRGB.set(hex, c = new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace)); return c.clone(); };
const toU8 = (c) => [Math.round(Math.max(0, Math.min(1, c.r)) * 255), Math.round(Math.max(0, Math.min(1, c.g)) * 255), Math.round(Math.max(0, Math.min(1, c.b)) * 255)];
const FRAME_C = FRAMES.map((h) => new THREE.Color(h));
function frameIndex(hex) {
  const c = new THREE.Color(hex); let best = 0, bd = Infinity;
  FRAME_C.forEach((f, i) => { const d = (f.r - c.r) ** 2 + (f.g - c.g) ** 2 + (f.b - c.b) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

/** Indexed geometry with the kit's attributes, in growable typed arrays. */
export class Writer {
  constructor(cap = 4096) {
    this.n = 0; this.ni = 0; this._alloc(cap, cap * 2);
    this.st = { col: [200, 200, 200], code: 0, win: [0, 0, 0, 0], b: [0, 0], trim: [100, 100, 100, 0], acc: [230, 230, 230, 0], L: 1 };
  }
  _alloc(nv, ni) {
    const grow = (old, T, size) => { const a = new T(size); if (old) a.set(old.subarray(0, Math.min(old.length, size))); return a; };
    this.cap = nv; this.capI = ni;
    this.pos = grow(this.pos, Float32Array, nv * 3); this.nor = grow(this.nor, Int8Array, nv * 3); this.col = grow(this.col, Uint8Array, nv * 3);
    this.surf = grow(this.surf, Float32Array, nv * 4); this.win = grow(this.win, Float32Array, nv * 4); this.bb = grow(this.bb, Float32Array, nv * 2);
    this.trim = grow(this.trim, Uint8Array, nv * 4); this.acc = grow(this.acc, Uint8Array, nv * 4);
    this.idx = grow(this.idx, Uint32Array, ni);
  }
  _room(v, i) { if (this.n + v > this.cap || this.ni + i > this.capI) this._alloc(Math.max(this.cap * 2, this.n + v + 1024), Math.max(this.capI * 2, this.ni + i + 2048)); }
  /** Set the state the next faces take: { col, code, win, b, trim, acc }. */
  set(o) { const st = this.st; for (const k in o) st[k] = o[k]; return this; }
  vert(x, y, z, nx, ny, nz, u, v) {
    const i = this.n++, s = this.st;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = Math.round(nx * 127); this.nor[i * 3 + 1] = Math.round(ny * 127); this.nor[i * 3 + 2] = Math.round(nz * 127);
    this.col[i * 3] = s.col[0]; this.col[i * 3 + 1] = s.col[1]; this.col[i * 3 + 2] = s.col[2];
    const i4 = i * 4, wn = s.win, tr = s.trim, ac = s.acc;
    this.surf[i4] = u; this.surf[i4 + 1] = v; this.surf[i4 + 2] = s.L; this.surf[i4 + 3] = s.code;
    this.win[i4] = wn[0]; this.win[i4 + 1] = wn[1]; this.win[i4 + 2] = wn[2]; this.win[i4 + 3] = wn[3];
    this.bb[i * 2] = s.b[0]; this.bb[i * 2 + 1] = s.b[1];
    this.trim[i4] = tr[0]; this.trim[i4 + 1] = tr[1]; this.trim[i4 + 2] = tr[2]; this.trim[i4 + 3] = tr[3];
    this.acc[i4] = ac[0]; this.acc[i4 + 1] = ac[1]; this.acc[i4 + 2] = ac[2]; this.acc[i4 + 3] = ac[3];
    return i;
  }
  /** A planar polygon (convex, counter-clockwise from the outside), with (u, v) per point. */
  poly(P, UV) {
    if (P.length < 3) return;
    this._room(P.length, (P.length - 2) * 3);
    const [a, b, c] = [P[0], P[1], P[2]];
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    // a degenerate first corner: use Newell's normal
    if (Math.hypot(nx, ny, nz) < 1e-6) { nx = ny = nz = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); } }
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const first = this.n;
    for (let i = 0; i < P.length; i++) this.vert(P[i][0], P[i][1], P[i][2], nx, ny, nz, UV[i][0], UV[i][1]);
    for (let i = 1; i < P.length - 1; i++) { this.idx[this.ni++] = first; this.idx[this.ni++] = first + i; this.idx[this.ni++] = first + i + 1; }
  }
  /** A vertical wall from p to q (left → right seen from outside), y0 → y1; u from u0, v measured from vRef. */
  wall(p, q, y0, y1, u0 = 0, vRef = y0) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < .01 || y1 - y0 < .01) return;
    this.poly([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]],
      [[u0, y0 - vRef], [u0 + len, y0 - vRef], [u0 + len, y1 - vRef], [u0, y1 - vRef]]);
  }
  /** A box in a frame f (centre, axes): a along u, b along v, from y0 to y1; bottom face left off unless asked. */
  box(f, a0, a1, b0, b1, y0, y1, opts = {}) {
    const P = (a, b) => [f.cx + f.ux * a + f.vx * b, f.cz + f.uz * a + f.vz * b];
    const k = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)];
    // walls, each left → right seen from outside (the corners run counter-clockwise seen from above when
    // the frame is right-handed; check against the centre to be sure)
    const cx = (k[0][0] + k[2][0]) / 2, cz = (k[0][1] + k[2][1]) / 2;
    for (let i = 0; i < 4; i++) {
      let p = k[i], q = k[(i + 1) % 4];
      if (!outward(p, q, cx, cz)) [p, q] = [q, p];
      if (opts.sides && !opts.sides[i]) continue;
      if (opts.sideState) this.set(opts.sideState(i));
      this.set({ L: Math.hypot(q[0] - p[0], q[1] - p[1]) });
      this.wall(p, q, y0, y1, 0, opts.vRef ?? y0);
    }
    if (opts.topState) this.set(opts.topState);
    if (opts.top !== false) {
      const T = [k[0], k[1], k[2], k[3]].map((p) => [p[0], y1, p[1]]);
      if (!ccwUp(T)) T.reverse();
      this.set({ L: Math.abs(a1 - a0) });
      this.poly(T, T.map((p) => [(p[0] - f.cx) * f.ux + (p[2] - f.cz) * f.uz, (p[0] - f.cx) * f.vx + (p[2] - f.cz) * f.vz]));
    }
    if (opts.bottom) {
      const B = [k[0], k[1], k[2], k[3]].map((p) => [p[0], y0, p[1]]);
      if (ccwUp(B)) B.reverse();
      this.poly(B, B.map(() => [0, 0]));
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry(), n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3, true));
    g.setAttribute('aSurf', new THREE.BufferAttribute(this.surf.slice(0, n * 4), 4));
    g.setAttribute('aWin', new THREE.BufferAttribute(this.win.slice(0, n * 4), 4));
    g.setAttribute('aB', new THREE.BufferAttribute(this.bb.slice(0, n * 2), 2));
    g.setAttribute('aTrim', new THREE.BufferAttribute(this.trim.slice(0, n * 4), 4, true));
    g.setAttribute('aAcc', new THREE.BufferAttribute(this.acc.slice(0, n * 4), 4, true));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  get triangles() { return this.ni / 3; }
}

/** A writer that keeps nothing (to build only the main or only the detail half of a building). */
export class NullWriter {
  constructor() { this.n = 0; this.ni = 0; this.st = {}; }
  set() { return this; } vert() { return 0; } poly() {} wall() {} box() {}
  get triangles() { return 0; }
}

/** Is p → q (seen from outside) running left to right, i.e. its outward normal points away from (cx, cz)? */
function outward(p, q, cx, cz) {
  const tx = q[0] - p[0], tz = q[1] - p[1];
  const nx = -tz, nz = tx;   // outward normal of a wall running along t (see facade-material.js)
  return nx * ((p[0] + q[0]) / 2 - cx) + nz * ((p[1] + q[1]) / 2 - cz) > 0;
}
/** Does a horizontal polygon (x, y, z points) face up when wound this way? */
function ccwUp(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[2] - b[0] * a[2]; } return s < 0; }

// -------------------------------------------------------------------------------------------------
/**
 * Build one building into `w` (main) and `d` (near detail). `L` is the landscape (heightAt). Returns the
 * building's world box and where its door is (for the dressing).
 */
export function assemble(R, w, d, L) {
  const style = R.style, sc = R.scheme;
  // colours: the scheme, jittered a little per building, and greyed by weather
  const wall = srgb(sc.wall); wall.offsetHSL(((R.seed * 31.7) % 1 - .5) * .03, ((R.seed * 17.3) % 1 - .5) * .1, ((R.seed * 11.9) % 1 - .5) * .1);
  const stone = srgb(style.stone || '#b3ab9c').offsetHSL(0, 0, ((R.seed * 5.3) % 1 - .5) * .08);
  const wood = srgb(R.age > .5 ? '#7d6a58' : '#8a5a36').offsetHSL(0, 0, ((R.seed * 7.1) % 1 - .5) * .1);
  const roofC = srgb(R.roofColor).offsetHSL(0, ((R.seed * 3.7) % 1 - .5) * .06, ((R.seed * 23.1) % 1 - .5) * .08);
  const trim = toU8(srgb(sc.trim)), acc = toU8(srgb(sc.accent || '#ece6da'));
  const st = {
    trim: [...trim, frameIndex(sc.frame || '#efebe2')], acc: [...acc, 0], b: [R.seed, R.wear],
  };
  const C = (c) => toU8(c);
  // painted siding (lap, shingles) takes the scheme's wall colour; bare boards and logs are wood
  const codeColor = (code) => code === S.RUBBLE || code === S.ASHLAR ? stone : code === S.BOARDS || code === S.LOGS ? wood
    : code === S.METAL ? srgb('#8f9294') : code === S.CONCRETE ? srgb('#bdb8ae') : wall;
  w.set({ ...st }); d.set({ ...st });

  if (!R.rects.length) return outlineBuilding(R, w, L, wall, roofC, st);

  const main = R.rects[0];
  // the ground: the wall foot below the lowest corner, the ground floor at the door side
  const corner = (r, a, b) => [r.cx + r.ux * a + r.vx * b, r.cz + r.uz * a + r.vz * b];
  let lo = Infinity, hi = -Infinity;
  for (const r of R.rects) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) { const p = corner(r, a * r.hu, b * r.hv); const h = L.heightAt(p[0], p[1]); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const fm = frontMid(main, R.front);
  const gFront = L.heightAt(fm[0], fm[1]);
  lo -= .4;
  const gv = Math.min(hi + .15, Math.max(lo + .55, gFront + .15));
  const knee = ['block', 'works', 'church', 'chapel', 'shed'].includes(R.archetype) ? .2 : .5;
  const top = gv + R.floors * R.floorH + knee;
  const ctx = { R, w, d, L, lo, gv, top, wall, stone, wood, roofC, st, C, codeColor, main, corner };

  for (const r of R.rects) { r.wk = r.hv * .38; r.halfHipOk = r.wk - R.rake > .45 && r.hu > r.hv * .8; }
  if (R.archetype === 'tent') { tent(ctx); return { lo, gv, top }; }
  R.rects.forEach((r, k) => body(ctx, r, k));
  R.rects.forEach((r, k) => roof(ctx, r, k));
  parts(ctx);
  return { lo, gv, top };
}

/** The middle of wall i of a rect, a little outside. */
function frontMid(r, i, out = .3) {
  const [a, b] = [[0, -r.hv - out], [r.hu + out, 0], [0, r.hv + out], [-r.hu - out, 0]][i];
  return [r.cx + r.ux * a + r.vx * b, r.cz + r.uz * a + r.vz * b];
}

/** The walls of rect r (k = 0: the main block). */
function body(ctx, r, k) {
  const { R, w, lo, gv, top, C, codeColor, corner } = ctx;
  const K = [corner(r, -r.hu, -r.hv), corner(r, r.hu, -r.hv), corner(r, r.hu, r.hv), corner(r, -r.hu, r.hv)];
  const set = R.windows, fh = R.floorH;
  const gableEnds = !['flat', 'hip'].includes(R.form);
  for (let i = 0; i < 4; i++) {
    let p = K[i], q = K[(i + 1) % 4];
    if (!outward(p, q, r.cx, r.cz)) [p, q] = [q, p];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const isFront = k === 0 && i === R.front;
    const isBack = k === 0 && i === (R.front + 2) % 4;
    // a farmhouse's long walls are cut into the house end and the barn end
    const segs = wallSegments(R, r, k, i, p, q, corner);
    const endIsBarn = k === 0 && R.barnEnd && i % 2 === 1 && ((i === 1) === (R.barnEnd > 0));
    for (const sg of segs) {
      const barn = sg.barn || endIsBarn;
      const sl = Math.hypot(sg.q[0] - sg.p[0], sg.q[1] - sg.p[1]);
      const ws = barn ? W.BARN : set;
      const bb = bays(sl, ws, ws === set ? R.bayM : 0);
      // the door: the middle bay of the front (village houses: any bay), barns: the middle
      const doorBay = doorBayOf(R, bb.n, barn, isFront, i);
      let flags = 0;
      if (R.shutters && !barn) flags |= F.SHUTTERS;
      if (R.surrounds && !barn) flags |= F.SURROUNDS;
      if (R.quoins && !barn) flags |= F.QUOINS;
      if (R.flowerBoxes && !barn && (isFront || i % 2 === R.front % 2)) flags |= F.FLOWERS;
      if (R.shop && isFront && !barn) flags |= F.SHOP;
      if (barn) flags |= F.BARN;
      if (isBack || (!isFront && i % 2 === 1 && R.archetype !== 'chalet')) flags |= F.SPARSE;
      if (R.ivy && (R.seed * 13.7 % 1) < .5 + (i === 2 ? .3 : 0) && i === Math.floor(R.seed * 4)) flags |= F.IVY;
      if ((R.plinth > 1 && R.archetype !== 'chalet') || R.archetype === 'mazot') flags |= F.NOGROUND;
      if (R.parts.stair && isFront && !barn) flags |= F.UPPERDOOR;
      if (R.lintels && !barn) flags |= F.LINTELS;
      const party = k === 0 && R.party?.[i];   // against a neighbour: a blank wall
      if (party) flags &= ~(F.QUOINS | F.IVY);
      const winOn = !party && !(R.archetype === 'works' && !isFront) && R.archetype !== 'ruin';
      const packed = ws + 16 * (R.parts.stair && isFront && !barn ? bb.n - 1 : doorBay) + 256 * flags;
      const win = winOn ? [fh, bb.w, gv - lo, packed] : [0, 0, gv - lo, 0];
      w.set({ win, L: sl });
      // zones up the wall: plinth, body, timber upper storeys
      const bodyCode = barn ? (R.barnWall === S.BOARDS ? S.RUBBLE : R.barnWall) : R.wall;
      const upperCode = barn ? (R.barnWall || S.BOARDS) : R.upper;
      const upperY = barn ? gv + fh : gv + (R.upperFrom || 1) * fh - .05;
      const plinthY = R.plinth && !barn ? gv + R.plinth - .55 : lo;
      const zones = [];
      if (plinthY > lo + .05) zones.push([lo, Math.min(plinthY, top), R.archetype === 'mazot' || R.archetype === 'chalet' ? S.RUBBLE : S.RUBBLE]);
      const b0 = Math.max(lo, plinthY);
      if (upperCode && upperY < top - .3 && upperY > b0) { zones.push([b0, upperY, bodyCode]); zones.push([upperY, top, upperCode]); }
      else zones.push([b0, top, bodyCode]);
      for (const [y0, y1, code] of zones) {
        if (y1 - y0 < .02) continue;
        w.set({ code, col: C(codeColor(code)) });
        w.wall(sg.p, sg.q, y0, y1, Math.hypot(sg.p[0] - p[0], sg.p[1] - p[1]) * 0, lo);
      }
      // génoise under the eaves of the long walls
      if (R.genoise && i % 2 === 0 && !barn) {
        const n = [-(sg.q[1] - sg.p[1]) / sl, (sg.q[0] - sg.p[0]) / sl];
        const o = .2, P2 = [sg.p[0] + n[0] * o, sg.p[1] + n[1] * o], Q2 = [sg.q[0] + n[0] * o, sg.q[1] + n[1] * o];
        w.set({ code: S.GENOISE, col: C(ctx.roofC), win: [0, 0, 0, 0], L: sl });
        w.wall(P2, Q2, top - .32, top + .02, 0, top - .32);
        w.poly([[sg.p[0], top - .32, sg.p[1]], [P2[0], top - .32, P2[1]], [Q2[0], top - .32, Q2[1]], [sg.q[0], top - .32, sg.q[1]]].reverse(), [[0, 0], [0, 0], [0, 0], [0, 0]]);
      }
    }
    // the gable triangle (or trapezoid under a half-hip) on the end walls
    if (i % 2 === 1 && gableEnds && R.form !== 'shed') gable(ctx, r, p, q, len, k, i);
    if (R.form === 'shed' && i % 2 === 1) {
      // a mono-pitch roof: the end walls rise from the low side (−v) to the high side (+v)
      const rise = 2 * r.hv * Math.tan(R.pitch);
      const hiSide = (pt) => ((pt[0] - r.cx) * r.vx + (pt[1] - r.cz) * r.vz) > 0;
      const code = R.gable ?? R.wall;
      w.set({ code, col: C(codeColor(code)), win: [0, 0, 0, 0], L: len });
      w.poly([[p[0], top, p[1]], [q[0], top, q[1]], [q[0], top + (hiSide(q) ? rise : 0), q[1]], [p[0], top + (hiSide(p) ? rise : 0), p[1]]].filter((pt, j) => j < 2 || pt[1] > top + .01),
        [[0, top - lo], [len, top - lo], [len, top - lo + (hiSide(q) ? rise : 0)], [0, top - lo + (hiSide(p) ? rise : 0)]].filter((uv, j) => j < 2 || uv[1] > top - lo + .01));
    }
  }
}


/** A wall of rect r cut into the house and barn ends (farmhouses' long walls), each left → right from outside. */
export function wallSegments(R, r, k, i, p, q, corner) {
  if (!(k === 0 && R.barnEnd && i % 2 === 0)) return [{ p, q, barn: false }];
  const t = R.barnSplit;   // the house's share of the length
  const along = (s) => [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s];
  const barnPt = corner(r, R.barnEnd * r.hu, 0);
  const pNearBarn = Math.hypot(p[0] - barnPt[0], p[1] - barnPt[1]) < Math.hypot(q[0] - barnPt[0], q[1] - barnPt[1]);
  const M = along(pNearBarn ? 1 - t : t);
  return pNearBarn ? [{ p, q: M, barn: true }, { p: M, q, barn: false }] : [{ p, q: M, barn: false }, { p: M, q, barn: true }];
}

/** Which bay of a wall segment has the door (15: none). */
export function doorBayOf(R, n, barn, isFront, i) {
  if (barn) return Math.floor(n / 2);
  if (R.archetype === 'shed' && i === R.front) return Math.floor(n / 2);
  if (!isFront) return 15;
  if (R.shop) return Math.floor(n / 2);
  return R.archetype === 'village' ? Math.floor(R.seed * 97 % 1 * n) : Math.floor(n / 2);
}

/** The front wall of the main block, oriented, and its house segment. */
export function frontSegment(R) {
  const r = R.rects[0]; if (!r) return null;
  const corner = (rr, a, b) => [rr.cx + rr.ux * a + rr.vx * b, rr.cz + rr.uz * a + rr.vz * b];
  const K = [corner(r, -r.hu, -r.hv), corner(r, r.hu, -r.hv), corner(r, r.hu, r.hv), corner(r, -r.hu, r.hv)];
  const i = R.front;
  let p = K[i], q = K[(i + 1) % 4];
  if (!outward(p, q, r.cx, r.cz)) [p, q] = [q, p];
  const segs = wallSegments(R, r, 0, i, p, q, corner);
  const sg = segs.find((x) => !x.barn) || segs[0];
  const len = Math.hypot(sg.q[0] - sg.p[0], sg.q[1] - sg.p[1]);
  const t = [(sg.q[0] - sg.p[0]) / len, (sg.q[1] - sg.p[1]) / len];
  return { p: sg.p, q: sg.q, len, t, n: [-t[1], t[0]], bays: bays(len, R.windows, R.bayM) };
}

function gable(ctx, r, p, q, len, k, i) {
  const { R, w, lo, top, C, codeColor } = ctx;
  const tan = Math.tan(R.pitch);
  const rise = r.hv * tan;
  const code = (k === 0 && R.barnEnd && ((i === 1) === (R.barnEnd > 0))) ? (R.barnWall || S.BOARDS) : R.gable ?? R.upper ?? R.wall;
  const barnEnd = code === R.barnWall && R.barnEnd && k === 0;
  const flags = F.GABLE | (barnEnd || R.archetype === 'barn' ? F.BARN : 0) | (R.shutters ? F.SHUTTERS : 0);
  const ws = barnEnd || R.archetype === 'barn' || R.archetype === 'shed' ? W.BARN : R.archetype === 'church' ? W.CHURCH : W.FARM;
  const blank = k === 0 && R.party?.[i];
  w.set({ code, col: C(codeColor(code)), win: [0, 0, top - lo, ws + 16 * 15 + 256 * (rise > 2.2 && R.form !== 'stepped' && !blank ? flags : 0)], L: len });
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (R.form === 'halfHip' && r.halfHipOk) {
    const yk = top + (r.hv - r.wk) * tan;
    const ext = R.rake * tan;   // up to the hip's underside
    const f2 = Math.max(0, (r.wk - R.rake) / r.hv);
    const A2 = [p[0] + (mid[0] - p[0]) * (1 - f2), p[1] + (mid[1] - p[1]) * (1 - f2)], B2 = [q[0] + (mid[0] - q[0]) * (1 - f2), q[1] + (mid[1] - q[1]) * (1 - f2)];
    const u = (pt) => Math.hypot(pt[0] - p[0], pt[1] - p[1]);
    w.poly([[p[0], top, p[1]], [q[0], top, q[1]], [B2[0], yk + ext, B2[1]], [A2[0], yk + ext, A2[1]]], [[0, 0 + top - lo], [len, top - lo], [u(B2), yk + ext - lo], [u(A2), yk + ext - lo]]);
  } else if (R.form !== 'stepped' || k > 0) {
    w.poly([[p[0], top, p[1]], [q[0], top, q[1]], [mid[0], top + rise, mid[1]]], [[0, top - lo], [len, top - lo], [len / 2, top + rise - lo]]);
  }
}

// -------------------------------------------------------------------------------------------------
/** A roof slab from top polygons: each { P: points, eave: [dx, dz] (along the eaves), y0 (eave height) }. */
function slab(ctx, polys, edges, th = .17, centre = null) {
  const { w, roofC, R, C } = ctx;
  const cen = centre || [ctx.main.cx, ctx.main.cz];
  w.set({ code: R.roof, col: C(roofC), win: [0, 0, 0, 0] });
  for (const pl of polys) {
    const s = Math.sin(R.pitch) || 1;
    const uv = pl.P.map((pt) => [pt[0] * pl.eave[0] + pt[2] * pl.eave[1], pl.flat ? pt[0] * pl.eave[1] - pt[2] * pl.eave[0] : (pt[1] - pl.y0) / s + .5]);
    let mn = Infinity; for (const t of uv) mn = Math.min(mn, t[0]); for (const t of uv) t[0] -= mn;
    w.set({ L: 10 });
    w.poly(pl.P, uv);
  }
  // the underside (soffit) and the edges (fascia boards): near the ride only (far off the slab reads the same)
  if (!R.full) return;
  const soff = ctx.wood.clone().multiplyScalar(.75);
  w.set({ code: S.SOFFIT, col: C(soff) });
  for (const pl of polys) {
    const B = pl.P.map((pt) => [pt[0], pt[1] - th, pt[2]]).reverse();
    w.poly(B, B.map((pt) => [pt[0] * pl.eave[0] + pt[2] * pl.eave[1], pt[0] * pl.eave[1] - pt[2] * pl.eave[0]]));
  }
  const fascia = R.archetype === 'chalet' || R.style.eaveM > .7 ? ctx.wood : ctx.roofC.clone().lerp(ctx.wall, .5).multiplyScalar(.85);
  w.set({ code: S.WOOD, col: C(fascia) });
  for (const [a, b] of edges) {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    w.set({ L: len });
    const Q = [[a[0], a[1] - th, a[2]], [b[0], b[1] - th, b[2]], [b[0], b[1], b[2]], [a[0], a[1], a[2]]];
    const n = crossN([Q[0], Q[1], Q[2]]);
    if (n[0] * ((a[0] + b[0]) / 2 - cen[0]) + n[2] * ((a[2] + b[2]) / 2 - cen[1]) < 0) Q.reverse();
    w.poly(Q, [[0, 0], [len, 0], [len, th], [0, th]]);
  }
}

function roof(ctx, r, k) {
  const { R, top, corner } = ctx;
  const tan = Math.tan(R.pitch);
  const e = k === 0 ? R.eave : R.eave * .8, rk = R.rake;
  const P3 = (a, b, y) => { const p = corner(r, a, b); return [p[0], y, p[1]]; };
  const yE = top - e * tan, yR = top + r.hv * tan;
  const eaveU = [r.ux, r.uz], eaveV = [r.vx, r.vz], back = [-r.ux, -r.uz];
  const cen = [r.cx, r.cz];
  let form = R.form;
  if (form === 'stepped' && k > 0) form = 'gable';
  if (form === 'halfHip' && !r.halfHipOk) form = 'gable';
  const go = (polys, edges) => { for (const s of polys) fixWinding(s); slab(ctx, polys, edges, .17, cen); };
  if (form === 'gable' || form === 'stepped') {
    const A = r.hu + (form === 'stepped' ? 0 : rk);
    const e0 = P3(-A, -r.hv - e, yE), e1 = P3(A, -r.hv - e, yE), e2 = P3(A, r.hv + e, yE), e3 = P3(-A, r.hv + e, yE), r0 = P3(-A, 0, yR), r1 = P3(A, 0, yR);
    go([{ P: [e0, e1, r1, r0], eave: eaveU, y0: yE }, { P: [e2, e3, r0, r1], eave: back, y0: yE }],
      [[e0, e1], [e2, e3], [e1, r1], [r0, e0], [e2, r1], [r0, e3]]);
    ridge(ctx, r0, r1);
    if (form === 'stepped') stepped(ctx, r, tan);
  } else if (form === 'halfHip') {
    const A = r.hu + rk, wk = r.wk, yk = top + (r.hv - wk) * tan, RU = A - wk;
    const e0 = P3(-A, -r.hv - e, yE), e1 = P3(A, -r.hv - e, yE), e2 = P3(A, r.hv + e, yE), e3 = P3(-A, r.hv + e, yE);
    const q0 = P3(-A, -wk, yk), q1 = P3(A, -wk, yk), q2 = P3(A, wk, yk), q3 = P3(-A, wk, yk), r0 = P3(-RU, 0, yR), r1 = P3(RU, 0, yR);
    go([{ P: [e0, e1, q1, r1, r0, q0], eave: eaveU, y0: yE }, { P: [e2, e3, q3, r0, r1, q2], eave: back, y0: yE },
      { P: [q3, q0, r0], eave: [-eaveV[0], -eaveV[1]], y0: yk }, { P: [q1, q2, r1], eave: eaveV, y0: yk }],
    [[e0, e1], [e2, e3], [e1, q1], [q0, e0], [e2, q2], [q3, e3], [q0, q3], [q1, q2]]);
    ridge(ctx, r0, r1);
  } else if (form === 'hip') {
    const RU = Math.max(0, r.hu - r.hv), A = r.hu + e, B = r.hv + e;
    const e0 = P3(-A, -B, yE), e1 = P3(A, -B, yE), e2 = P3(A, B, yE), e3 = P3(-A, B, yE), r0 = P3(-RU, 0, yR), r1 = P3(RU, 0, yR);
    const pyramid = RU < .05;
    go([{ P: pyramid ? [e0, e1, r0] : [e0, e1, r1, r0], eave: eaveU, y0: yE }, { P: pyramid ? [e2, e3, r0] : [e2, e3, r0, r1], eave: back, y0: yE },
      { P: [e3, e0, r0], eave: [-eaveV[0], -eaveV[1]], y0: yE }, { P: [e1, e2, pyramid ? r0 : r1], eave: eaveV, y0: yE }],
    [[e0, e1], [e1, e2], [e2, e3], [e3, e0]]);
    if (!pyramid) ridge(ctx, r0, r1);
  } else if (form === 'shed') {
    const rise = 2 * r.hv * tan, A = r.hu + rk, y0 = top - e * tan, y1 = top + rise + .2 * tan;
    const a = P3(-A, -r.hv - e, y0), b = P3(A, -r.hv - e, y0), c = P3(A, r.hv + .2, y1), dd = P3(-A, r.hv + .2, y1);
    go([{ P: [a, b, c, dd], eave: eaveU, y0 }], [[a, b], [b, c], [c, dd], [dd, a]]);
  } else {
    flat(ctx, r, k);
  }
}

/** Make a roof polygon face up (and outward). */
function fixWinding(s) {
  const P = s.P;
  let ny = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; ny += (a[2] - b[2]) * (a[0] + b[0]); }
  if (ny < 0) P.reverse();
}

function ridge(ctx, a, b) {
  const { d, R, roofC, C } = ctx;
  if ([S.R_SEAM, S.R_CORR, S.R_FLAT].includes(R.roof)) return;
  const f = { cx: (a[0] + b[0]) / 2, cz: (a[2] + b[2]) / 2 };
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]); if (len < .3) return;
  f.ux = (b[0] - a[0]) / len; f.uz = (b[2] - a[2]) / len; f.vx = -f.uz; f.vz = f.ux;
  d.set({ code: R.roof === S.R_LAUZE ? S.R_LAUZE : S.PLAIN, col: C(roofC.clone().multiplyScalar(.8)), win: [0, 0, 0, 0] });
  d.box(f, -len / 2, len / 2, -.14, .14, a[1] - .05, a[1] + .11);
}

function flat(ctx, r, k = 0) {
  const { w, d, R, top, corner, C, wall } = ctx;
  const K = [corner(r, -r.hu, -r.hv), corner(r, r.hu, -r.hv), corner(r, r.hu, r.hv), corner(r, -r.hu, r.hv)].map((p) => [p[0], top, p[1]]);
  if (!ccwUp(K)) K.reverse();
  w.set({ code: S.R_FLAT, col: C(srgb('#8f8b84')), win: [0, 0, 0, 0], L: 2 * r.hu });
  w.poly(K, K.map((p) => [p[0], p[2]]));
  // parapet
  const f = { ...r };
  w.set({ code: R.wall, col: C(wall.clone().multiplyScalar(.95)), win: [0, 0, 0, 0] });
  for (const [a0, a1, b0, b1] of [[-r.hu, r.hu, -r.hv, -r.hv + .25], [-r.hu, r.hu, r.hv - .25, r.hv], [-r.hu, -r.hu + .25, -r.hv, r.hv], [r.hu - .25, r.hu, -r.hv, r.hv]])
    w.box(f, a0, a1, b0, b1, top - .05, top + .7);
  // a bracketed cornice along the front of a flat-roofed row house (Pittsburgh Italianate)
  if (k === 0 && (R.attached || R.lintels) && R.front % 2 === 0) {
    const s2 = R.front === 0 ? -1 : 1, trimC = srgb(R.scheme.trim);
    w.set({ code: S.WOOD, col: C(trimC.clone().lerp(srgb('#e8e2d4'), R.seed > .5 ? .6 : 0)) });
    w.box(f, -r.hu - .05, r.hu + .05, Math.min(s2 * r.hv, s2 * (r.hv + .5)), Math.max(s2 * r.hv, s2 * (r.hv + .5)), top - .15, top + .55, { bottom: true });
    w.set({ code: S.PLAIN, col: C(trimC.clone().multiplyScalar(.8)) });
    for (let a = -r.hu + .4; a < r.hu - .2; a += 1.1) w.box(f, a - .08, a + .08, Math.min(s2 * r.hv, s2 * (r.hv + .4)), Math.max(s2 * r.hv, s2 * (r.hv + .4)), top - .55, top - .15, { bottom: true });
  }
  // rooftop: a plant box or two on the big ones
  if (r.hu * r.hv > 60) { d.set({ code: S.METAL, col: C(srgb('#9a9c9e')) }); d.box(f, -r.hu * .3, -r.hu * .3 + 1.6, -.8, .8, top, top + 1.2); }
}

function stepped(ctx, r, tan) {
  const { w, R, top, C, codeColor, wall } = ctx;
  const n = Math.max(3, Math.round(r.hv / .75));
  const code = R.wall === S.RUBBLE ? S.RUBBLE : R.wall;
  for (const end of [-1, 1]) {
    const a = end * r.hu;
    for (let j = 0; j < n; j++) {
      // band from the wall edge inward: b from bo to bi on each side, plus the top one across the middle
      const bo = r.hv - j * r.hv / n, bi = r.hv - (j + 1) * r.hv / n;
      const y = top + (r.hv - bi) * tan + .35;
      for (const side of j === n - 1 ? [0] : [-1, 1]) {
        const b0 = side === 0 ? -bo : side * bi, b1 = side === 0 ? bo : side * bo;
        w.set({ code, col: C(codeColor(code)), win: [0, 0, 0, 0], topState: null });
        w.box(r, a - .22, a + .22, Math.min(b0, b1), Math.max(b0, b1), top - .2, y, { topState: { code: S.ASHLAR, col: C(ctx.stone.clone().lerp(wall, .2)) } });
      }
    }
  }
}

/** A tent-shaped church (Notre-Dame des Neiges, Alpe d'Huez): a steep roof almost to the ground, rising along it. */
function tent(ctx) {
  const { w, gv, lo, main: r, C, corner } = ctx;
  const base = gv + .6, apex0 = base + r.hv * 2.2, apex1 = apex0 + 4;
  const P = (a, b, y) => { const c = corner(r, a, b); return [c[0], y, c[1]]; };
  const e0 = P(-r.hu, -r.hv - .8, base), e1 = P(r.hu, -r.hv - .8, base), e2 = P(r.hu, r.hv + .8, base), e3 = P(-r.hu, r.hv + .8, base);
  const r0 = P(-r.hu, 0, apex0), r1 = P(r.hu * .7, 0, apex1);
  const s0 = { P: [e0, e1, r1, r0], eave: [r.ux, r.uz], y0: base }, s1 = { P: [e2, e3, r0, r1], eave: [-r.ux, -r.uz], y0: base };
  fixWinding(s0); fixWinding(s1);
  ctx.R.roof = S.R_SEAM;
  slab(ctx, [s0, s1], [[e0, e1], [e2, e3]], .25, [r.cx, r.cz]);
  // the ends: tall glazed gables
  w.set({ code: S.GLASS, col: C(srgb('#c9c4b8')), win: [0, 0, 0, 0] });
  for (const [a, b, c2] of [[e3, e0, r0], [e1, e2, r1]]) { const t = [a, b, c2]; const n = crossN(t); const mid = [(a[0] + b[0] + c2[0]) / 3, (a[2] + b[2] + c2[2]) / 3]; if (n[0] * (mid[0] - r.cx) + n[2] * (mid[1] - r.cz) < 0) t.reverse(); w.set({ L: 2 * r.hv }); w.poly(t, [[0, 0], [2 * r.hv, 0], [r.hv, apex0 - base]]); }
  w.set({ code: S.CONCRETE, col: C(srgb('#bdb8ae')) });
  w.box(r, -r.hu, r.hu, -r.hv - .8, r.hv + .8, lo, base + .05, { top: false });
}

// -------------------------------------------------------------------------------------------------
function parts(ctx) {
  const { R, w, d, gv, top, lo, main: r, C, corner, L } = ctx;
  const P = R.parts, tan = Math.tan(R.pitch), fh = R.floorH;
  const frame = r;
  // the long side's outward sign for wall i (0: −v, 2: +v) and end sign (1: +u, 3: −u)
  const sideSign = (i) => (i === 0 || i === 3 ? -1 : 1);

  // balconies: a slab and a balustrade along a wall, on the upper floors
  if (P.balcony) {
    const i = P.balcony.side, s = sideSign(i);
    const along = i % 2 === 0 ? r.hu : r.hv, out = i % 2 === 0 ? r.hv : r.hu;
    const span = P.balcony.full ? along - .15 : Math.min(along - .2, Math.max(1.6, along * .55));
    const depth = R.archetype === 'block' ? 1.35 : 1.15;
    const floors = R.archetype === 'block' ? range(1, R.floors) : range(Math.max(1, R.upperFrom || 1), Math.min(R.floors, 3));
    const metal = R.archetype === 'block' && R.seed > .5;
    const rail = metal ? srgb('#d9d6cf') : ctx.wood;
    // a box from a0..a1 along the wall and b0..b1 out from the wall's line (both in the wall's own terms)
    const band = (a0, a1, b0, b1, y0, y1) => {
      const B0 = Math.min(s * b0, s * b1), B1 = Math.max(s * b0, s * b1);
      if (i % 2 === 0) w.box(frame, a0, a1, B0, B1, y0, y1, { bottom: true }); else w.box(frame, B0, B1, a0, a1, y0, y1, { bottom: true });
    };
    for (const fl of floors) {
      const y = gv + fl * fh - .12;
      w.set({ code: S.WOOD, col: C(metal ? srgb('#c8c3b8') : ctx.wood.clone().multiplyScalar(.9)), win: [0, 0, 0, 0] });
      band(-span, span, out, out + depth, y, y + .14);
      w.set({ code: metal ? S.PLAIN : S.BALUSTER, col: C(rail) });
      band(-span, span, out + depth - .06, out + depth, y + .14, y + 1.08);
      band(-span, -span + .06, out, out + depth - .06, y + .14, y + 1.08);
      band(span - .06, span, out, out + depth - .06, y + .14, y + 1.08);
    }
  }
  // a gallery under the eaves at a gable end
  if (P.gallery && R.form !== 'flat' && R.form !== 'hip') {
    const i = P.gallery.end, s = sideSign(i), y = top - .15, out = r.hu, depth = .95, span = r.hv * .8;
    w.set({ code: S.WOOD, col: C(ctx.wood) });
    w.box(frame, Math.min(s * out, s * (out + depth)), Math.max(s * out, s * (out + depth)), -span, span, y, y + .12, { bottom: true });
    w.set({ code: S.BALUSTER, col: C(ctx.wood) });
    w.box(frame, Math.min(s * (out + depth - .06), s * (out + depth)), Math.max(s * (out + depth - .06), s * (out + depth)), -span, span, y + .12, y + 1.05, { bottom: true });
  }
  // dormers on the front (or first long) slope
  if (P.dormers && ['gable', 'halfHip', 'stepped'].includes(R.form)) {
    const side = R.front % 2 === 0 ? sideSign(R.front) : -1;
    const n = P.dormers, wD = R.archetype === 'village' ? 1.1 : 1.35, hD = 1.45;
    for (let k = 0; k < n; k++) {
      const a = -r.hu + (k + .5) * (2 * r.hu / n) * .8 + r.hu * .1;
      const bIn = r.hv - .7;                 // its front, set back from the wall
      const yb = top + .7 * tan - .05;       // the roof there
      const yt = yb + hD;
      const back = (hD + .3) / tan;
      const code = R.gable ?? R.wall;
      w.set({ code, col: C(ctx.codeColor(code)), win: [0, 0, 0, W.FARM + 16 * 15 + 256 * (F.GABLE | (R.shutters ? F.SHUTTERS : 0))], L: wD });
      // front wall (single window) and the two cheeks
      const pa = corner(r, a - wD / 2, side * bIn), pb = corner(r, a + wD / 2, side * bIn);
      let p = pa, q = pb; if (!outward(p, q, r.cx, r.cz)) [p, q] = [q, p];
      w.set({ win: [0, 0, yb + .05 - (yb - .5), W.FARM + 16 * 15 + 256 * (F.GABLE)] });
      w.wall(p, q, yb, yt, 0, yb - .5);
      w.set({ win: [0, 0, 0, 0] });
      for (const ae of [a - wD / 2, a + wD / 2]) {
        const f0 = corner(r, ae, side * bIn), f1 = corner(r, ae, side * (bIn - back));
        const tri = [[f0[0], yb, f0[1]], [f0[0], yt, f0[1]], [f1[0], yt, f1[1]]];
        // face it outward along u
        const nx = (ae - a) * r.ux, nz = (ae - a) * r.uz;
        const cr = crossN(tri);
        if (cr[0] * nx + cr[2] * nz < 0) tri.reverse();
        w.set({ L: back });
        w.poly(tri, [[0, 0], [0, hD], [back, hD]]);
      }
      // its little gable roof
      const pd = .7, rise = (wD / 2 + .15) * Math.tan(pd), yr = yt + rise;
      const fr = side * (bIn + .2), bk = side * (bIn - back - rise / tan);
      const D = (aa, bb, y) => { const c = corner(r, aa, bb); return [c[0], y, c[1]]; };
      const xl = a - (wD / 2 + .15), xr = a + (wD / 2 + .15);
      const fl = D(xl, fr, yt - .05), bl = D(xl, bk, yt - .05), fm = D(a, fr, yr), bm = D(a, bk, yr), frr = D(xr, fr, yt - .05), brr = D(xr, bk, yt - .05);
      const s0 = { P: [fl, bl, bm, fm], eave: [r.vx * side, r.vz * side], y0: yt }, s1 = { P: [frr, brr, bm, fm], eave: [r.vx * side, r.vz * side], y0: yt };
      fixWinding(s0); fixWinding(s1);
      slab(ctx, [s0, s1], [[fl, fm], [frr, fm], [fl, bl], [frr, brr]], .1, corner(r, a, side * (bIn - back / 2)));
      // its gable
      const g0 = corner(r, a - wD / 2, side * bIn), g1 = corner(r, a + wD / 2, side * bIn), gm = corner(r, a, side * bIn);
      const tri = [[g0[0], yt, g0[1]], [g1[0], yt, g1[1]], [gm[0], yr - .05, gm[1]]];
      const cr = crossN(tri); if (cr[0] * r.vx * side + cr[2] * r.vz * side < 0) tri.reverse();
      w.set({ code: R.gable ?? S.BOARDS, col: C(ctx.codeColor(R.gable ?? S.BOARDS)), win: [0, 0, 0, 0], L: wD });
      w.poly(tri, [[0, 0], [wD, 0], [wD / 2, rise]]);
    }
  }
  // chimneys (near the ride; far off they are a few pixels)
  if (P.chimneys && R.full) {
    for (let k = 0; k < P.chimneys.n; k++) {
      const a = (k === 0 ? .45 : -.5) * r.hu * (R.seed > .5 ? 1 : -1), b = (R.seed * 7 % 1 - .5) * r.hv * .6;
      const yr = R.form === 'hip' || R.form === 'flat' ? top + 2.2 : top + (r.hv - Math.abs(b)) * tan;
      if (P.chimneys.kind === 'pipe') {
        w.set({ code: S.STEEL, col: C(srgb('#5a5c5e')), win: [0, 0, 0, 0] });
        w.box({ ...r, cx: corner(r, a, b)[0], cz: corner(r, a, b)[1] }, -.09, .09, -.09, .09, yr - 1, yr + 1.1);
        w.box({ ...r, cx: corner(r, a, b)[0], cz: corner(r, a, b)[1] }, -.2, .2, -.2, .2, yr + 1.1, yr + 1.18, { bottom: true });
      } else {
        const code = P.chimneys.kind === 'stone' ? S.RUBBLE : S.RENDER;
        const c = corner(r, a, b), f = { ...r, cx: c[0], cz: c[1] };
        w.set({ code, col: C(code === S.RUBBLE ? ctx.stone : ctx.wall.clone().multiplyScalar(.95)), win: [0, 0, 0, 0] });
        w.box(f, -.3, .3, -.3, .3, yr - 1.5, yr + 1.0);
        w.set({ code: S.PLAIN, col: C(srgb('#77736d')) });
        w.box(f, -.38, .38, -.38, .38, yr + 1.0, yr + 1.1, { bottom: true });
        w.box(f, -.08, .08, -.3, .3, yr + 1.1, yr + 1.32);
      }
    }
  }
  // solar panels on the slope that faces south (+z)
  if (P.solar && ['gable', 'halfHip', 'hip', 'stepped'].includes(R.form)) {
    const side = r.vz >= 0 ? 1 : -1;   // +v points south when vz > 0
    const len = Math.min(r.hu * 1.2, 6.5), b0 = r.hv * .2, b1 = r.hv * .85;
    const yA = top + (r.hv - b1) * tan, yB = top + (r.hv - b0) * tan;
    const off = .1 / Math.cos(R.pitch);
    const Q = [corner(r, -len / 2, side * b1), corner(r, len / 2, side * b1), corner(r, len / 2, side * b0), corner(r, -len / 2, side * b0)];
    const Pp = [[Q[0][0], yA + off, Q[0][1]], [Q[1][0], yA + off, Q[1][1]], [Q[2][0], yB + off, Q[2][1]], [Q[3][0], yB + off, Q[3][1]]];
    const s = { P: Pp }; fixWinding(s);
    w.set({ code: S.SOLAR, col: C(srgb('#202a40')), win: [0, 0, 0, 0], L: len });
    w.poly(s.P, s.P.map((p) => [p[0] * r.ux + p[2] * r.uz, p[1] / Math.sin(R.pitch)]));
  }
  // a front porch: a deck on posts across the front, a shed roof, a railing (Pittsburgh frame houses, US farmhouses)
  if (P.frontPorch) {
    const dp = doorPoint(R, gv);
    const fs = frontSegment(R);
    if (dp && fs) {
      const depth = P.frontPorch.depth, len = Math.min(fs.len - .3, Math.max(3.2, fs.len * .92));
      const mid = (fs.len - len) / 2;
      const f = { cx: fs.p[0] + fs.t[0] * (mid + len / 2), cz: fs.p[1] + fs.t[1] * (mid + len / 2), ux: fs.t[0], uz: fs.t[1], vx: fs.n[0], vz: fs.n[1] };
      const gnd = Math.min(L.heightAt(f.cx + f.vx * depth, f.cz + f.vz * depth), gv - .2);
      const deck = gv - .08, hl = len / 2;
      const woodC = srgb(R.scheme.accent || '#efebe2'), trimC = srgb(R.scheme.trim);
      // deck and its skirt (lattice look: boards), posts, railing, roof
      w.set({ code: S.WOOD, col: C(srgb('#8a7f72')), win: [0, 0, 0, 0] });
      w.box(f, -hl, hl, 0, depth, deck - .12, deck, { bottom: true });
      w.set({ code: S.BOARDS, col: C(trimC.clone().lerp(srgb('#5a5048'), .5)) });
      w.box(f, -hl, hl, depth - .06, depth, gnd - .2, deck - .12, { top: false });
      const roofY = gv + Math.min(2.85, R.floorH - .15);
      w.set({ code: S.PLAIN, col: C(woodC) });
      const posts = Math.max(2, Math.round(len / 2.6) + 1);
      for (let k = 0; k < posts; k++) { const a = -hl + .15 + k * (len - .3) / (posts - 1); w.box(f, a - .09, a + .09, depth - .25, depth - .07, deck, roofY); }
      w.set({ code: S.RAILING, col: C(woodC) });
      const doorU = (dp.x - f.cx) * f.ux + (dp.z - f.cz) * f.uz;
      for (const [a0, a1] of [[-hl + .1, doorU - .8], [doorU + .8, hl - .1]]) if (a1 - a0 > .5) w.box(f, a0, a1, depth - .2, depth - .14, deck, deck + .9, { bottom: false });
      if (P.frontPorch.roof) {
        const ov = .25, y0 = roofY + .05, y1 = roofY + .05 - (depth + ov) * .28;
        const pts = [[-hl - .1, .02, y0 + .2], [hl + .1, .02, y0 + .2], [hl + .1, depth + ov, y1], [-hl - .1, depth + ov, y1]].map(([a, b, y]) => [f.cx + f.ux * a + f.vx * b, y, f.cz + f.uz * a + f.vz * b]);
        const sl = { P: pts, eave: [f.ux, f.uz], y0: y1 };
        fixWinding(sl);
        slab(ctx, [sl], [[pts[2], pts[3]], [pts[1], pts[2]], [pts[3], pts[0]]], .14, [ctx.main.cx, ctx.main.cz]);
      }
      ctx.porch = { f, depth, gnd, deck };
    }
  }
  // lean-to or garage against an end wall
  for (const kind of ['leanTo', 'garage']) {
    const o = P[kind]; if (!o) continue;
    const s = sideSign(o.end), depth = kind === 'garage' ? 3.2 : 2.2 + (R.seed * 3.3 % 1) * 1.3;
    const half = kind === 'garage' ? Math.min(r.hv, 1.9) : Math.min(r.hv * .8, 3.2);
    const a0 = s * r.hu, a1 = s * (r.hu + depth);
    const g = Math.min(...[[a0, -half], [a1, -half], [a1, half], [a0, half]].map(([a, b]) => L.heightAt(...corner(r, a, b)))) - .3;
    const yIn = Math.max(gv + 2.9, g + 3), yOut = yIn - depth * .32;
    const code = kind === 'garage' ? R.wall : S.BOARDS;
    const f = r;
    w.set({ code, col: C(ctx.codeColor(code)), win: [0, 0, 0, 0] });
    // walls: two sides and the outer end (an open woodshed has no outer wall)
    const amin = Math.min(a0, a1), amax = Math.max(a0, a1);
    w.box(f, amin, amax, -half, half, g, yOut, { top: false, sides: [true, s > 0 ? !(o.open && kind === 'leanTo') : true, true, s < 0 ? !(o.open && kind === 'leanTo') : true] });
    // triangles up to the sloping roof on the two sides
    for (const b of [-half, half]) {
      const pIn = corner(r, a0, b), pOut = corner(r, a1, b);
      const tri = [[pIn[0], yOut, pIn[1]], [pOut[0], yOut, pOut[1]], [pIn[0], yIn, pIn[1]]];
      const cr = crossN(tri); if ((cr[0] * r.vx + cr[2] * r.vz) * b < 0) tri.reverse();
      w.set({ L: depth }); w.poly(tri, [[0, yOut - g], [depth, yOut - g], [0, yIn - g]]);
    }
    if (kind === 'garage') {
      const fs = R.front % 2 === 0 ? sideSign(R.front) : -1;
      const pa = corner(r, a0 + s * .4, fs * (half + .03)), pb = corner(r, a1 - s * .4, fs * (half + .03));
      let p = pa, q = pb; if (!outward(p, q, ...corner(r, (a0 + a1) / 2, 0))) [p, q] = [q, p];
      w.set({ code: S.GARAGE, col: C(srgb(R.scheme.trim).lerp(srgb('#d8d4cc'), .4)), L: depth - .8 });
      w.wall(p, q, g + .3, g + .3 + 2.2, 0, g + .3);
    }
    // the roof slab
    const ov = .3;
    const pts = [[a0, -half - ov, yIn], [a1 + s * ov, -half - ov, yOut - ov * .32], [a1 + s * ov, half + ov, yOut - ov * .32], [a0, half + ov, yIn]]
      .map(([a, b, y]) => { const c = corner(r, a, b); return [c[0], y, c[1]]; });
    const sl = { P: pts, eave: [r.vx, r.vz], y0: yOut }; fixWinding(sl);
    slab(ctx, [sl], [[pts[1], pts[2]], [pts[0], pts[1]], [pts[2], pts[3]]], .12);
    ctx.annex = { end: o.end, depth, half, open: o.open && kind === 'leanTo', kind };
  }
  // an outside stair up to the first floor along the front, to the upper door
  if (P.stair) {
    const dp = doorPoint(R, gv);
    const f = { cx: dp.x, cz: dp.z, ux: dp.t[0], uz: dp.t[1], vx: dp.n[0], vz: dp.n[1] };
    const steps = Math.round(fh / .2), run = .28, dir = -1;
    w.set({ code: S.RUBBLE, col: C(ctx.stone), win: [0, 0, 0, 0] });
    w.box(f, -.7, .7, 0, 1.2, lo + .3, gv + fh - .02);
    for (let k = 0; k < steps; k++) {
      const a = dir * (.7 + k * run), y = gv + fh - (k + 1) * (fh / steps);
      if (y < lo + .3) break;
      w.box(f, Math.min(a, a + dir * run), Math.max(a, a + dir * run), 0, 1.05, lo + .3, y);
    }
  }
  // a bell tower at one end of a church
  if (P.tower) {
    const s = sideSign(P.tower.end), sz = Math.min(2.8, r.hv * .62), a = s * (r.hu + sz * .55);
    const tt = top + 8 + (R.seed * 4);
    const f = { ...r, cx: corner(r, a, 0)[0], cz: corner(r, a, 0)[1] };
    w.set({ code: R.wall, col: C(ctx.wall.clone().multiplyScalar(.97)), win: [4.2, 2 * sz, tt - 3.6 - lo, W.CHURCH + 16 * 15], L: 2 * sz });
    w.box(f, -sz, sz, -sz, sz, lo, tt, { top: false, vRef: lo });
    const apex = [f.cx, tt + 7, f.cz];
    const q = [[-sz - .2, -sz - .2], [sz + .2, -sz - .2], [sz + .2, sz + .2], [-sz - .2, sz + .2]].map(([x, y]) => [f.cx + f.ux * x + f.vx * y, tt - .1, f.cz + f.uz * x + f.vz * y]);
    w.set({ code: R.roof === S.R_CANAL ? S.R_TILE : R.roof, col: C(ctx.roofC.clone().lerp(srgb('#55585c'), .5)), win: [0, 0, 0, 0] });
    for (let k = 0; k < 4; k++) { const tri = [q[k], q[(k + 1) % 4], apex]; const cr = crossN(tri); if (cr[1] < 0) tri.reverse(); w.poly(tri, [[0, 0], [2 * sz, 0], [sz, 7]]); }
  }
  // a painted sundial high on the front (or south) wall
  if (P.sundial) {
    const i = R.front, s = sideSign(i);
    const along = i % 2 === 0 ? r.hu : r.hv, out = (i % 2 === 0 ? r.hv : r.hu) + .04;
    const wS = 1.5, hS = 1.8, y0 = top - hS - .35;
    const c = R.seed * 9.1 % 1 > .5 ? .5 : -.5;   // between two windows
    const bw = bays(2 * along, R.windows, R.bayM).w;
    const a = Math.round(c) * bw * .5 + (Math.floor(bays(2 * along, R.windows, R.bayM).n / 2) % 2 ? bw * .5 : 0);
    const A = Math.max(-along + wS / 2 + .2, Math.min(along - wS / 2 - .2, a));
    const pa = i % 2 === 0 ? corner(r, A - wS / 2, s * out) : corner(r, s * out, A - wS / 2), pb = i % 2 === 0 ? corner(r, A + wS / 2, s * out) : corner(r, s * out, A + wS / 2);
    let p = pa, q = pb; if (!outward(p, q, r.cx, r.cz)) [p, q] = [q, p];
    w.set({ code: S.SUNDIAL, col: C(srgb('#efe6cf')), win: [hS, 0, 0, 0], L: wS });
    w.wall(p, q, y0, y0 + hS, 0, y0);
  }
  // near detail: a canopy over the door, gutters and downpipes
  door(ctx);
  if (R.full && !['flat', 'shed'].includes(R.form)) gutters(ctx);
}

/** Where the door is: the foot of the front wall at the door bay, with the wall's outward normal and tangent. */
export function doorPoint(R, gv) {
  const f = frontSegment(R); if (!f) return null;
  const k = R.parts?.stair ? f.bays.n - 1 : doorBayOf(R, f.bays.n, false, true, R.front);
  const uD = (k + .5) * f.bays.w;
  return { x: f.p[0] + f.t[0] * uD, z: f.p[1] + f.t[1] * uD, n: f.n, t: f.t, gv, w: f.bays.w };
}

function door(ctx) {
  const { R, d, gv, C, L } = ctx;
  const dp = doorPoint(R, gv); if (!dp || R.archetype === 'church' || R.archetype === 'works') return;
  ctx.door = dp;
  if (R.parts.stair) return;
  const pd = R.parts.frontPorch ? R.parts.frontPorch.depth : 0;
  const f = { cx: dp.x + dp.n[0] * pd, cz: dp.z + dp.n[1] * pd, ux: dp.t[0], uz: dp.t[1], vx: dp.n[0], vz: dp.n[1] };
  const g = L.heightAt(f.cx + dp.n[0] * .8, f.cz + dp.n[1] * .8);
  // steps from the ground up to the door
  const rise = gv - g;
  if (rise > .12) {
    const n = Math.min(6, Math.ceil(rise / .18));
    d.set({ code: S.ASHLAR, col: C(ctx.stone.clone().multiplyScalar(1.05)), win: [0, 0, 0, 0] });
    for (let k = 0; k < n; k++) d.box(f, -.75, .75, 0, .32 * (n - k), g - .3, g + (k + 1) * rise / n);
  }
  // a canopy (marquise) over the door
  if (R.parts.porch && !R.shop && !pd) {
    const y = gv + 2.55;
    d.set({ code: R.roof, col: C(ctx.roofC), win: [0, 0, 0, 0] });
    const pts = [[-1, .02, y + .3], [1, .02, y + .3], [1, 1.05, y], [-1, 1.05, y]].map(([a, b, yy]) => [f.cx + f.ux * a + f.vx * b, yy, f.cz + f.uz * a + f.vz * b]);
    const s = { P: pts }; fixWinding(s);
    d.set({ L: 2 }); d.poly(s.P, s.P.map((p, j) => [j % 3 ? 2 : 0, j < 2 ? 1 : 0]));
    const B = pts.map((p) => [p[0], p[1] - .1, p[2]]); const sb = { P: B }; fixWinding(sb); sb.P.reverse();
    d.set({ code: S.WOOD, col: C(ctx.wood) }); d.poly(sb.P, sb.P.map(() => [0, 0]));
    for (const a of [-.9, .9]) d.box(f, a - .05, a + .05, .05, 1, y - .55, y - .45);
  }
  // shop awnings
  if (R.shop) {
    const along = R.front % 2 === 0 ? R.rects[0].hu : R.rects[0].hv;
    const y = gv + 2.7;
    const col = srgb(['#a7372f', '#2f5d7a', '#3f6b3a', '#b8862f'][Math.floor(R.seed * 4)]);
    d.set({ code: S.AWNING, col: C(col), win: [0, 0, 0, 0] });
    const pts = [[-along * .8, .05, y], [along * .8, .05, y], [along * .8, 1.1, y - .55], [-along * .8, 1.1, y - .55]].map(([a, b, yy]) => [f.cx + f.ux * (a - (dp.x - R.rects[0].cx) * f.ux - (dp.z - R.rects[0].cz) * f.uz) + f.vx * b, yy, f.cz + f.uz * (a - (dp.x - R.rects[0].cx) * f.ux - (dp.z - R.rects[0].cz) * f.uz) + f.vz * b]);
    const s = { P: pts }; fixWinding(s);
    d.set({ L: along * 1.6 }); d.poly(s.P, s.P.map((p) => [(p[0] - pts[0][0]) * f.ux + (p[2] - pts[0][2]) * f.uz, 0]));
    const sb = { P: s.P.map((p) => [p[0], p[1] - .02, p[2]]).reverse() }; d.poly(sb.P, sb.P.map(() => [0, 0]));
  }
}

function gutters(ctx) {
  const { R, d, top, main: r, C, lo } = ctx;
  const tan = Math.tan(R.pitch), e = R.eave, yE = top - e * tan - .2;
  const col = R.wear > .5 ? srgb('#8b8f90') : srgb(R.archetype === 'chalet' ? '#7a5a3a' : '#9aa0a3');
  d.set({ code: S.STEEL, col: C(col), win: [0, 0, 0, 0] });
  const A = r.hu + (R.form === 'hip' ? e : R.rake);
  for (const s of [-1, 1]) {
    d.box(r, -A, A, s > 0 ? r.hv + e - .12 : -r.hv - e, s > 0 ? r.hv + e : -r.hv - e + .12, yE - .1, yE + .02);
    // a downpipe at one corner
    const a = (R.seed > .5 ? 1 : -1) * (r.hu - .2) * s;
    d.box(r, a - .05, a + .05, s > 0 ? r.hv + .02 : -r.hv - .12, s > 0 ? r.hv + .12 : -r.hv - .02, lo + .3, yE);
  }
}

// -------------------------------------------------------------------------------------------------
/** A footprint too ragged to cut into rectangles: its outline extruded, with windows, and a low cap. */
function outlineBuilding(R, w, L, wall, roofC, st) {
  const pts = R.pts;
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of pts) { const h = L.heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  lo -= .4;
  const gv = Math.min(hi + .15, lo + 1.2);
  const top = gv + R.floors * R.floorH + .3;
  let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
  for (let i = 0; i < pts.length; i++) {
    let p = pts[i], q = pts[(i + 1) % pts.length];
    if (!outward(p, q, cx, cz)) [p, q] = [q, p];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const bb = bays(len, R.windows, R.bayM);
    w.set({ code: R.wall, col: toU8(wall), win: len > 2 ? [R.floorH, bb.w, gv - lo, R.windows + 16 * 15 + 256 * ((R.shutters ? F.SHUTTERS : 0) | F.SPARSE)] : [0, 0, 0, 0], L: len });
    w.wall(p, q, lo, top, 0, lo);
  }
  // cap: low (15°) to the centre, with an overhang
  const area = R.area, flatRoof = area > 260;
  const apex = [cx, top + (flatRoof ? .25 : Math.min(3.5, Math.sqrt(area) * .22)), cz];
  w.set({ code: flatRoof ? S.R_FLAT : R.roof, col: toU8(roofC), win: [0, 0, 0, 0], L: 10 });
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ex = (p) => { const dx = p[0] - cx, dz = p[1] - cz, Lr = Math.hypot(dx, dz) || 1; return [p[0] + dx / Lr * .4, p[1] + dz / Lr * .4]; };
    const A = ex(a), B = ex(b);
    const tri = [[A[0], top - .1, A[1]], [B[0], top - .1, B[1]], apex];
    const cr = crossN(tri); if (cr[1] < 0) tri.reverse();
    w.poly(tri, [[0, 0], [Math.hypot(B[0] - A[0], B[1] - A[1]), 0], [0, 3]]);
  }
  return { lo, gv, top };
}

const crossN = (t) => { const [a, b, c] = t; return [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]; };
const range = (a, b) => { const o = []; for (let i = a; i < b; i++) o.push(i); return o; };
