// Red-rock geometry and its material (Out West, 26 Nov 2026 — "Moody landscapes and detailed hero structures"):
// sandstone hoodoos, arches, buttes and mesas on talus skirts, and a bored tunnel with galleries — each a smooth,
// indexed mesh displaced by a value noise (no flat facets), coloured per vertex by its rock (the Navajo's orange, the
// Claron's pink and white, Monument Valley's de Chelly red), and drawn with one shared material that adds the
// strata, desert-varnish streaks down the cliffs and a fine bump, all from world position (no textures, no UVs).
//
//   const R = new RockBuilder();  R.hoodoo(...); R.arch(...); R.butte(...); R.tunnel(...)
//   const mesh = R.mesh(redRockMaterial())            (one draw; null if nothing was added)
import * as THREE from '../../../../vendor/three.js';
import { litMaterial } from '../materials/lit.js';

const TAU = Math.PI * 2;
// a smooth 3D value noise in [0, 1] (the same hash as the shaders')
const fract = (x) => x - Math.floor(x);
const h3 = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
const sm = (t) => t * t * (3 - 2 * t);
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = sm(x - i), v = sm(y - j), w = sm(z - k);
  const L = (a, b, c) => h3(i + a, j + b, k + c);
  const x00 = L(0, 0, 0) + (L(1, 0, 0) - L(0, 0, 0)) * u, x10 = L(0, 1, 0) + (L(1, 1, 0) - L(0, 1, 0)) * u;
  const x01 = L(0, 0, 1) + (L(1, 0, 1) - L(0, 0, 1)) * u, x11 = L(0, 1, 1) + (L(1, 1, 1) - L(0, 1, 1)) * u;
  return (x00 + (x10 - x00) * v) + ((x01 + (x11 - x01) * v) - (x00 + (x10 - x00) * v)) * w;
}
const fbm = (x, y, z, o = 3) => { let s = 0, a = .5, f = 1; for (let k = 0; k < o; k++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= .5; } return s / (1 - Math.pow(.5, o)); };
const rand = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const C = (hex) => new THREE.Color(hex);
export const ROCK = {
  navajo: [C('#c0623a'), C('#d07a48'), C('#b0532f')],      // orange-red sandstone (the arches, the tunnel's fin)
  claron: [C('#d9824e'), C('#e8a273'), C('#efe0c8')],      // Bryce: orange, pink, the white caprock
  chelly: [C('#a9492a'), C('#bb5a33'), C('#c98458')],      // Monument Valley: deep red cliffs, lighter talus
  slick: [C('#d29a6a'), C('#c98a5c'), C('#e2b98f')],       // slickrock benches
};

export class RockBuilder {
  constructor() { this.pos = []; this.col = []; this.idx = []; this.n = 0; this.tris = 0; }
  /** A grid of rows × cols vertices (rows of a closed ring when `wrap`): fn(i, j) → [x, y, z, color]. */
  grid(rows, cols, fn, wrap = true, flip = false) {
    const base = this.n;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const [x, y, z, c] = fn(i, j);
      this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.n++;
    }
    const cw = wrap ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cw; j++) {
      const a = base + i * cols + j, b = base + i * cols + (j + 1) % cols, c = a + cols, d = b + cols;
      if (flip) this.idx.push(a, b, c, b, d, c); else this.idx.push(a, c, b, b, c, d);
      this.tris += 2;
    }
    return base;
  }
  /** A fan closing a ring of vertices (first..first+n-1) round a centre point. */
  fan(first, n, x, y, z, c, flip = false) {
    const k = this.n; this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.n++;
    for (let j = 0; j < n; j++) { const a = first + j, b = first + (j + 1) % n; if (flip) this.idx.push(k, b, a); else this.idx.push(k, a, b); this.tris++; }
  }

  /** A body of revolution with a noisy radius: profile [[radius, y], …] bottom to top (y relative to g); r(θ) shapes it. */
  lathe(cx, g, cz, profile, seg, { seed = 1, rough = .18, freq = .25, colorAt, rOf = () => 1, ground = null, sink = 2 } = {}) {
    const rows = profile.length;
    const first = this.grid(rows, seg, (i, j) => {
      const a = j / seg * TAU, [r0, y0] = profile[i], ca = Math.cos(a), sa = Math.sin(a);
      const rr = r0 * rOf(a, i / (rows - 1));
      let x = cx + ca * rr, z = cz + sa * rr, y = g + y0;
      // displaced along the normal-ish (out from the axis), more on the big shapes
      const nz = fbm(x * freq + seed, y * freq * 1.6, z * freq - seed, 3) - .5;
      x += ca * nz * rough * Math.max(1, rr * .35); z += sa * nz * rough * Math.max(1, rr * .35);
      if (i === 0 && ground) y = ground(x, z) - sink;   // (the foot: into the ground wherever it stands)
      return [x, y, z, colorAt(i / (rows - 1), y, a)];
    });
    const [rt, yt] = profile[rows - 1];
    if (rt > .01) this.fan(first + (rows - 1) * seg, seg, cx, g + yt + rt * .05, cz, colorAt(1, g + yt, 0));
    return first;
  }

  /** A Bryce hoodoo: a spire of stacked, waisted beads under a hard white caprock (h tall, r at the foot). */
  hoodoo(x, g, z, h, r, seed, ground) {
    const R = rand(seed * 7919 + 17), beads = 1.5 + R() * 2.5, ph = R() * 6, lean = (R() - .5) * .08, amp = .06 + R() * .14, capT = .84 + R() * .06;
    const prof = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // tapering, softly waisted where the softer beds wear back (each hoodoo its own rhythm), ledges where the hard
      // ones stand out; the neck under the cap thinnest; the cap a wide, flat, broken stone
      const ledge = Math.pow(Math.max(0, Math.sin(t * 23 + ph * 3)), 8) * .1;
      let rr = r * (1 - .5 * t) * (1 - amp + amp * Math.sin(t * beads * TAU + ph) + ledge);
      if (t > capT) rr = r * (t < capT + .03 ? .36 : t < .985 ? .66 + R() * .08 : .5);
      prof.push([Math.max(.2, rr), h * t]);
    }
    prof.unshift([r * 1.6, -1.5]);   // (a skirt of its own debris)
    const pal = ROCK.claron;
    const tmp = new THREE.Color();
    this.lathe(x, g, z, prof, 11, {
      seed, rough: .34, freq: .6, ground, sink: 1.5,
      rOf: (a) => 1 + .16 * Math.cos(a * 2 + ph) + .08 * Math.cos(a * 3 + ph * 2),
      colorAt: (t, y) => {
        const b = .5 + .5 * Math.sin(y * 1.3 + ph);
        if (t > capT) return tmp.copy(pal[2]).multiplyScalar(.97 + .06 * b).clone();
        return tmp.copy(pal[0]).lerp(pal[1], b * .7 + t * .2).lerp(pal[2], Math.max(0, t - .65) * 1.2).clone();
      },
    });
    // the lean: shear the spire a little (its vertices from the base up)
    if (lean) { const base = this.n - (prof.length * 11 + 1); for (let k = base; k < this.n; k++) { const y = this.pos[3 * k + 1] - g; this.pos[3 * k] += y * lean; } }
  }

  /**
   * An arch: a sandstone band swept from one foot over to the other. F: { o: {x, z}, u: {x, z} } (the span along u);
   * span, height (to the top of the opening), thick (the band, radially) and deep (across) at the crown, foot × at
   * the feet. kind 'delicate' | 'window' | 'landscape' shapes it.
   */
  arch(F, ground, { span, height, thick, deep, foot = 1.8, seed = 3, pal = ROCK.navajo, pedestal = true } = {}) {
    const N = 64, M = 14, gA = ground(F.o.x - F.u.x * span / 2, F.o.z - F.u.z * span / 2), gB = ground(F.o.x + F.u.x * span / 2, F.o.z + F.u.z * span / 2);
    const vx = -F.u.z, vz = F.u.x, tmp = new THREE.Color();
    this.grid(N + 1, M, (i, j) => {
      const s = i / N, th = Math.PI * (1 - s);
      const footK = 1 + (foot - 1) * Math.pow(Math.abs(Math.cos(th)), 2.2);
      const T = thick * footK, D = deep * (1 + (foot - 1) * .6 * Math.pow(Math.abs(Math.cos(th)), 2));
      // the centreline: a superellipse, the legs nearly upright; each foot on its own ground
      const cxA = Math.cos(th) * (span / 2 + T * .5), base = gA + (gB - gA) * s - 1.5;
      const cy = base + (height + T * .5) * Math.pow(Math.sin(th), .55);
      // the band's cross-section: a rounded rectangle (radial T × across D), its radial axis out from the arch's middle
      const rx = Math.cos(th), ry = Math.sin(th) * .9 + .1, rl = Math.hypot(rx, ry), nx = rx / rl, ny = ry / rl;
      const a = j / M * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const sq = (c) => Math.sign(c) * Math.pow(Math.abs(c), .55);
      let lr = sq(ca) * T / 2, la = sq(sa) * D / 2;
      const px = F.o.x + F.u.x * (cxA + nx * lr) + vx * la, pz = F.o.z + F.u.z * (cxA + nx * lr) + vz * la, py = cy + ny * lr;
      const nz = fbm(px * .3 + seed, py * .5, pz * .3, 3) - .5;
      const k = 1 + nz * .5;
      const qx = F.o.x + F.u.x * (cxA + nx * lr * k) + vx * la * k, qz = F.o.z + F.u.z * (cxA + nx * lr * k) + vz * la * k, qy = cy + ny * lr * k;
      const b = .5 + .5 * Math.sin(qy * .9 + seed);
      return [qx, i === 0 || i === N ? Math.min(qy, (i ? gB : gA) - 2) : qy, qz, tmp.copy(pal[0]).lerp(pal[1], b * .6).lerp(pal[2], (1 - Math.sin(th)) * .4).clone()];
    }, true);
    // each foot's pedestal: a low swelling of slickrock
    if (pedestal) for (const s of [-1, 1]) {
      const fx = F.o.x + F.u.x * s * span / 2, fz = F.o.z + F.u.z * s * span / 2, gg = ground(fx, fz);
      this.lathe(fx, gg, fz, [[thick * foot * 1.5, -1], [thick * foot * 1.15, thick * .35], [thick * foot * .75, thick * .8], [thick * foot * .45, thick]], 14,
        { seed: seed + s, rough: .3, freq: .2, ground, colorAt: (t) => tmp.copy(pal[0]).lerp(ROCK.slick[1], .4 - t * .3).clone() });
    }
  }

  /** A fin: a long, narrow sandstone wall (the window arches' host, the Arch Garden's backdrop). */
  fin(F, ground, { len, h, w, seed = 5, pal = ROCK.navajo, hole = null } = {}) {
    const N = 40, M = 16, vx = -F.u.z, vz = F.u.x, tmp = new THREE.Color();
    this.grid(N + 1, M, (i, j) => {
      const s = i / N - .5, a = j / M * TAU;
      const end = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(s * 2), 6)));   // (rounded ends)
      const ca = Math.cos(a), sa = Math.sin(a);
      const up = (sa * .5 + .5);   // 0 at the foot, 1 at the top
      const y0 = ground(F.o.x + F.u.x * s * len, F.o.z + F.u.z * s * len) - 2;
      const top = h * end * (.85 + .15 * fbm(s * 3 + seed, 0, seed, 2));
      let lat = Math.sign(ca) * Math.pow(Math.abs(ca), .4) * w / 2 * (1 - .35 * up);
      const px0 = F.o.x + F.u.x * s * len + vx * lat, pz0 = F.o.z + F.u.z * s * len + vz * lat, py = y0 + (top + 2) * up;
      const nz = fbm(px0 * .25 + seed, py * .35, pz0 * .25, 3) - .5;
      const px = px0 + vx * nz * w * .4, pz = pz0 + vz * nz * w * .4;
      const b = .5 + .5 * Math.sin(py * .8 + seed);
      return [px, py, pz, tmp.copy(pal[0]).lerp(pal[1], b * .6).lerp(pal[2], up * .25).clone()];
    }, true);
  }

  /**
   * A butte or mesa: vertical cliffs of a noisy outline (R across, elongated by `aspect` along `yaw`) on a talus skirt,
   * a slightly proud caprock; H tall. kind 'mitten' adds the thumb spire beside it.
   */
  butte(cx, cz, ground, { R, H, aspect = 1.35, yaw = 0, seed = 11, pal = ROCK.chelly, seg = 120 } = {}) {
    const tmp = new THREE.Color(), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const g = ground(cx, cz);
    // the profile (radius × R, height × H): the talus out at 2.3 R on the ground, steepening, the cliff from .38 H
    const prof = [[2.4, -.02], [2.0, .03], [1.65, .1], [1.38, .2], [1.18, .3], [1.06, .37], [1.02, .4], [1.0, .5], [.99, .6], [.985, .7], [.98, .8], [.985, .88],
      [1.02, .9], [1.03, .93], [1.0, .95], [.97, .985], [.9, 1], [.6, 1.005], [.2, 1.01]];
    const shape = (a) => {
      // the outline: an ellipse, lobed and notched by noise (the buttresses and alcoves of a real butte)
      const e = 1 / Math.hypot(Math.cos(a) / aspect, Math.sin(a));
      return e * (1 + .16 * (fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2, seed, 3) - .5) + .07 * (fbm(Math.cos(a) * 7 + seed, Math.sin(a) * 7, 3, 2) - .5));
    };
    const rows = prof.length;
    const first = this.grid(rows, seg, (i, j) => {
      const a = j / seg * TAU, [rk, yk] = prof[i], cliff = i >= 6 && i <= 16;
      const rr = R * rk * shape(a) * (i < 6 ? 1 + .12 * (fbm(a * 3, i, seed, 2) - .5) : 1);
      const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
      let x = cx + lx * cy - lz * sy, z = cz + lx * sy + lz * cy;
      let y = g + yk * H;
      if (i === 0) y = ground(x, z) - 3;
      else if (i < 6) y = Math.max(y, ground(x, z) + .5) + (fbm(x * .02, y * .05, z * .02, 3) - .5) * H * .05;
      // vertical fluting down the cliffs (the joints), the caprock's ledge
      if (cliff) { const fl = fbm(a * 40 + seed, yk * 3, seed, 3) - .5; x += Math.cos(a) * fl * R * .05; z += Math.sin(a) * fl * R * .05; }
      const band = .5 + .5 * Math.sin(yk * H * .35 + seed);
      const c = i < 6 ? tmp.copy(pal[2]).lerp(pal[1], .3 + band * .2) : i >= 12 && i <= 15 ? tmp.copy(pal[2]).lerp(pal[1], .35) : tmp.copy(pal[0]).lerp(pal[1], band * .55);
      return [x, y, z, c.clone()];
    });
    this.fan(first + (rows - 1) * seg, seg, cx, g + H * 1.012, cz, pal[2].clone().multiplyScalar(.95));
    return g;
  }

  /** A freestanding spire: Monument Valley's Totem Pole (a thin, fluted column on its own talus cone). */
  spire(x, z, ground, { r, h, seed = 21, pal = ROCK.chelly } = {}) {
    const g = ground(x, z), tmp = new THREE.Color();
    const prof = [[r * 5, -1], [r * 3.4, h * .08], [r * 2.1, h * .17], [r * 1.25, h * .25], [r * 1.05, h * .32]];
    for (let k = 1; k <= 14; k++) { const t = k / 14; prof.push([r * (1.02 - .35 * t) * (.92 + .1 * Math.sin(t * 17 + seed)), h * (.32 + .68 * t)]); }
    prof.push([r * .3, h * 1.01]);
    this.lathe(x, g, z, prof, 14, { seed, rough: .3, freq: .3, ground, sink: 2, colorAt: (t, y) => tmp.copy(t < .22 ? pal[2] : pal[0]).lerp(pal[1], .5 + .5 * Math.sin(y * .4 + seed) * .5).clone() });
  }

  /**
   * The tunnel: a sandstone fin swept along the road's centreline (pts: [{x, z}…] every few metres, y from yAt) with a
   * 12 m bore; hill (±1) the side the fin rises toward; galleries: fractions along where the downhill wall is open.
   * The profile in (across, up) metres from the road's centre: the bore's arch, the fin's flank and summit, the thin
   * downhill wall and its gallery band — three sweeps, the gallery band left out at each window.
   */
  tunnel(pts, yAt, ground, { hill = 1, half = 6.4, crown = 8.2, galleries = [], galleryM = 7, seed = 31, pal = ROCK.navajo } = {}) {
    const n = pts.length, tmp = new THREE.Color();
    if (n < 4) return;
    // frames along the path
    const fr = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      return { x: p.x, z: p.z, y: yAt(p.x, p.z), tx: dx / l, tz: dz / l, nx: -dz / l * hill, nz: dx / l * hill };   // n: toward the hill
    });
    let S = 0; const sAt = fr.map((f, i) => (S += i ? Math.hypot(f.x - fr[i - 1].x, f.z - fr[i - 1].z) : 0));
    const total = S;
    const inGallery = (s) => galleries.some((q) => Math.abs(s - q * total) < galleryM / 2);
    // the portal taper: the fin's flank shrinks toward each end so it meets the hillside, the bore stays full
    const taper = (s) => Math.min(1, Math.min(s, total - s) / 26);
    const wallT = 2.6;   // (the downhill wall's thickness)
    const at = (f, d, u, s, rough = 0) => {
      // d across (+ toward the hill), u up from the road
      let x = f.x + f.nx * d, z = f.z + f.nz * d, y = f.y + u;
      if (rough) { const nz = fbm(x * .18 + seed, y * .22, z * .18, 3) - .5; x += f.nx * nz * rough; z += f.nz * nz * rough; y += nz * rough * .5; }
      return [x, y, z];
    };
    const col = (u, kind) => {
      const b = .5 + .5 * Math.sin(u * .7 + seed);
      if (kind === 'in') return tmp.copy(pal[0]).multiplyScalar(.42 + .08 * b).clone();   // (the bore: dark, its own shade baked in)
      return tmp.copy(pal[0]).lerp(pal[1], b * .6).lerp(pal[2], Math.max(0, u - 20) / 30).clone();
    };
    // 1. the bore's arch and the fin (continuous): from the downhill spring of the arch over the crown, down the hill
    //    side wall, out across the fin's flank, up over its summit and down to the shoulder above the galleries
    const prof = [];
    const arcN = 14;
    for (let k = 0; k <= arcN; k++) { const a = k / arcN * Math.PI; prof.push({ d: -Math.cos(a) * half, u: Math.min(crown, 4.6 + Math.sin(a) * (crown - 4.6)) * (k === 0 ? 1 : 1), kind: 'in' }); }
    // (prof[0]: downhill spring at u 4.6 → crown → uphill spring; then down the uphill wall to the floor)
    prof.push({ d: half, u: 0, kind: 'in' }, { d: half + .3, u: -.5, kind: 'out' });
    // the flank and summit (relative; scaled by taper), back to the downhill shoulder
    const flank = [[14, -1.5], [22, 6], [26, 16], [20, 26], [10, 31], [0, 30], [-half - wallT + .4, 19], [-half - wallT, 11], [-half - wallT, 4.6]];
    for (const [d, u] of flank) prof.push({ d, u, kind: 'out', flank: true });
    const P = prof.length;
    const ring = (f, s, p) => {
      const t = p.flank ? taper(s) : 1;
      let d = p.d, u = p.u;
      if (p.flank && t < 1) { d = half + .3 + (d - half - .3) * t; u = Math.max(-.5, u * t); if (p.d < 0) { d = Math.min(-half - .2, p.d * (.6 + .4 * t)); u = Math.max(4.6, p.u * t); } }
      const [x, y, z] = at(f, d, u, s, p.kind === 'out' ? 1.6 * Math.max(.4, t) : .12);
      return [x, y, z, col(u, p.kind)];
    };
    this.grid(n, P, (i, j) => ring(fr[i], sAt[i], prof[j]), true, true);
    // the portal faces: each end's ring closed (a fan from the bore's crown so the opening stays open: the fan covers
    // only the rock between the arch and the outer profile — triangulated as a strip between the two)
    for (const i of [0, n - 1]) {
      const f = fr[i], s = sAt[i];
      const inner = [], outer = [];
      for (let j = 0; j <= arcN + 1; j++) inner.push(ring(f, s, prof[j]));
      for (let j = P - 1; j > arcN + 1; j--) outer.push(ring(f, s, prof[j]));
      // pair them up (resampled to the same count)
      const m = Math.max(inner.length, outer.length), L = (arr, k) => arr[Math.min(arr.length - 1, Math.round(k / (m - 1) * (arr.length - 1)))];
      this.grid(2, m, (r, k) => (r ? L(outer, k) : L(inner, k)), false, i !== 0);
    }
    // 2. the downhill wall under the galleries' band (continuous) and 3. the band itself, cut at each window
    const lowWall = [{ d: -half, u: 0 }, { d: -half, u: 1.4 }, { d: -half - wallT, u: 1.4 }, { d: -half - wallT, u: -2 }];
    this.grid(n, 4, (i, j) => { const [x, y, z] = at(fr[i], lowWall[j].d, lowWall[j].u, sAt[i], j > 1 ? .8 : .1); return [x, y, z, col(lowWall[j].u, j < 2 ? 'in' : 'out')]; }, true, true);
    const band = [{ d: -half, u: 1.4 }, { d: -half, u: 4.6 }, { d: -half - wallT, u: 4.6 }, { d: -half - wallT, u: 1.4 }];
    let run = [];
    const flush = () => {
      if (run.length >= 2) this.grid(run.length, 4, (i, j) => { const [x, y, z] = at(fr[run[i]], band[j].d, band[j].u, sAt[run[i]], j > 1 ? .8 : .1); return [x, y, z, col(band[j].u, j < 2 ? 'in' : 'out')]; }, true, true);
      // the window's jambs: a cap across the band's end
      run = [];
    };
    for (let i = 0; i < n; i++) { if (inGallery(sAt[i])) { if (run.length) { run.push(i); flush(); } } else run.push(i); }
    flush();
    return { total, frames: fr };
  }

  /** The built mesh (one draw), or null. */
  mesh(material, name = 'red rock') {
    if (!this.idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
    const m = new THREE.Mesh(geo, material); m.name = name; m.castShadow = true; m.receiveShadow = true;
    m.userData.tris = this.tris;
    return m;
  }
}

/**
 * The red rock's material: the vertex colours, then from world position — strata (thin bands, wavy, some darker, the
 * odd white one), desert varnish (dark streaks down the steep faces from the ledges), a fine grain and a bump in two
 * scales. Rough and non-metal; lit as the rest of the world (the sky's light, the baked sun).
 */
let shared = null;
export function redRockMaterial() {
  if (shared) return shared;
  const m = litMaterial({ vertexColors: true, roughness: .93, side: THREE.DoubleSide }, 'ground');
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.)).xyz; vRN = normalize(mat3(modelMatrix) * objectNormal);');
    const GL = `
varying vec3 vRW; varying vec3 vRN;
float rrH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float rrN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(rrH(i), rrH(i + vec3(1, 0, 0)), f.x), mix(rrH(i + vec3(0, 1, 0)), rrH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rrH(i + vec3(0, 0, 1)), rrH(i + vec3(1, 0, 1)), f.x), mix(rrH(i + vec3(0, 1, 1)), rrH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float rrBump(vec3 p) { return rrN(p * .7) * .7 + rrN(vec3(p.x * 2.2, p.y * .8, p.z * 2.2)) * .3; }
`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GL)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float steep = 1. - abs(vRN.y);
        float wob = rrN(vRW * .03) * 4. + rrN(vRW * .11) * .8;
        float s1 = sin(vRW.y * 2.1 + wob), s2 = sin(vRW.y * .43 + wob * .5);
        float strata = .5 + .5 * s1;
        diffuseColor.rgb *= .9 + .14 * strata * (.6 + .4 * steep);
        diffuseColor.rgb *= mix(1., .82, smoothstep(.75, .95, s2) * steep);                    // a darker bed now and then
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.86, .8, .7), smoothstep(.93, .99, sin(vRW.y * .19 + wob * .3)) * .35 * steep);   // a pale one
        // desert varnish: dark streaks down the cliffs, long in y, narrow across, under the ledges
        float sx = rrN(vec3(vRW.x * .35 + vRW.z * .35, vRW.y * .015, (vRW.z - vRW.x) * .35));
        diffuseColor.rgb *= 1. - .42 * smoothstep(.55, .8, sx) * smoothstep(.55, .85, steep);
        // grain; flats catch the dust (paler, sandier)
        diffuseColor.rgb *= .92 + .16 * rrN(vRW * 2.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.78, .58, .42), (1. - steep) * .25);
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        // a bump from world position (perturbNormalArb, as three's bump map): the grain and the bedding's ledges
        float bh = rrBump(vRW) + .35 * smoothstep(.2, .8, .5 + .5 * sin(vRW.y * 2.1 + rrN(vRW * .03) * 4.));
        vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
        float dhx = dFdx(bh), dhy = dFdy(bh);
        vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
        normal = normalize(abs(det) * normal - grad * .55);
      }`);
  };
  m.customProgramCacheKey = () => 'bf-redrock-1';
  return (shared = m);
}
export function disposeRedRock() { shared?.dispose(); shared = null; }
