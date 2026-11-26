// Toolbox figures: the shared parked-car kit (every map). Realistic, rounded cars built as lofts: the lower body is
// a run of rounded cross-sections along the car (so it has a nose, a tail, a tumblehome and real wheel arches cut
// into its sill), the glasshouse a second loft on top (windscreen, side glass, rear window; the roof and the B/C
// pillars in paint). On top: lights, grille, bumpers with a dark lower part, plates, mirrors, wheel wells, wheels
// (tyre, rim, hub). Kinds: hatch, sedan, wagon, suv, pickup, van, and the farm truck (an older square pickup with
// chrome bumpers and a stake bed). Any kind can carry a roof rack ({ rack: true }).
//
// Paint and wear: the paint is per instance (instanceColor; the kit's palettes by region, below); dirt and rust are
// worked out in the shader from the car's wear class (aCar.y: 0 kept, 1 lived-in, 2 a farm truck), the material's
// region (dirt / rust uniforms: rural roads are dirtier) and a hash of where the car stands (no two alike). Dirt
// splashes up from the sills and behind the wheels; rust bubbles round the arches and the sills, more on the farm
// truck. Parked only: nothing moves (user, 23 Nov: "cars should be stationary only").
//
// LODs: 'hi' (≈ 700–900 triangles), 'lo' (≈ 250), 'far' (≈ 60: the two lofts at their coarsest, wheels as blocks).
// +Z is the front, the ground y = 0. Per vertex aCar: (part, wear class); parts as vehicles.js (0 paint, 1 fixed
// colour, 2 glass, 10 headlight, 11 tail light).
import * as THREE from '../../../../../vendor/three.js';
import { VehBuilder, PART } from './vehicles.js';

export const CAR_KINDS = ['hatch', 'sedan', 'wagon', 'suv', 'pickup', 'van', 'farmtruck'];
export const CAR_INFO = {
  hatch: { len: 4.0, w: 1.76 }, sedan: { len: 4.6, w: 1.8 }, wagon: { len: 4.7, w: 1.8 }, suv: { len: 4.7, w: 1.9 },
  pickup: { len: 5.5, w: 2.0 }, van: { len: 5.1, w: 2.0 }, farmtruck: { len: 5.3, w: 1.95 },
};
const GLASS = '#2a3a46', TYRE = '#1a1a1c', RIM = '#aeb4ba', TRIM = '#26282b', DARK = '#121314', CHROME = '#d7dbde', PLATE = '#e9e6da';

// ---------------------------------------------------------------- palettes (sRGB hex; weights)
/** Regional paint: city streets lean grey/silver/black/white; country roads more trucks, reds, maroons, greens. */
export const PALETTES = {
  city: [['#d8d9d6', 5], ['#a7abae', 5], ['#5d6266', 4], ['#1d1e20', 5], ['#f1f1ee', 4], ['#7d1c1f', 2], ['#1f3557', 2], ['#3a4e66', 1], ['#6c7a5a', 1], ['#a8915f', 1], ['#c43c2c', 1]],
  rural: [['#efefeb', 5], ['#8e1c1c', 4], ['#5c1a22', 2], ['#1e2a40', 3], ['#2f4a35', 2], ['#a3a7a9', 3], ['#575b5e', 2], ['#1c1c1e', 3], ['#7a6a4c', 2], ['#b6a37a', 1], ['#3c5c7a', 1], ['#c8c0a8', 1]],
  farm: [['#8e2a20', 3], ['#f0eee6', 3], ['#2b4a7a', 2], ['#3f5a3a', 2], ['#6a6e70', 1], ['#b08a3a', 1], ['#5a3a28', 1]],
};
function pickWeighted(list, r) { let s = 0; for (const [, w] of list) s += w; let t = r * s; for (const [c, w] of list) { if ((t -= w) <= 0) return c; } return list[0][0]; }

/**
 * A car for a place. region 'city' | 'rural'; setting 'street' | 'lot' | 'driveway' | 'farm'.
 * Returns { kind, paint, rack }. rand: a () => [0, 1) source.
 */
export function pickCar(rand, region = 'city', setting = 'street') {
  const r = rand(), rural = region === 'rural';
  let kind;
  if (setting === 'farm') kind = r < 0.55 ? 'farmtruck' : r < 0.85 ? 'pickup' : 'suv';
  else if (rural) kind = r < 0.22 ? 'pickup' : r < 0.42 ? 'suv' : r < 0.55 ? 'wagon' : r < 0.78 ? 'sedan' : r < 0.9 ? 'hatch' : r < 0.96 ? 'van' : 'farmtruck';
  else kind = r < 0.32 ? 'sedan' : r < 0.52 ? 'hatch' : r < 0.74 ? 'suv' : r < 0.84 ? 'wagon' : r < 0.92 ? 'pickup' : 'van';
  const paint = pickWeighted(kind === 'farmtruck' ? PALETTES.farm : PALETTES[rural ? 'rural' : 'city'], rand());
  const rack = (kind === 'suv' || kind === 'wagon' || kind === 'hatch') && rand() < (rural ? 0.3 : 0.12);
  return { kind, paint, rack };
}

// ---------------------------------------------------------------- the loft builder
class CarBuilder extends VehBuilder {
  constructor(lod, wear) { super(lod !== 'hi'); this.lod = lod; this.wear = wear; }
  // the small parts: bevelled boxes (44 triangles) near, plain boxes (12) beyond
  rbox(c, s, r = 0.1, o = {}) { return this.bevel(c, s, this.lod === 'hi' && r >= 0.06 ? r : 0.002, o); }
  geometry() {
    // aCar: (part, wear class) from vehicles.js's aVeh (part, wheel, axle y, axle z)
    const g = super.geometry(), A = g.attributes.aVeh, out = new Float32Array(A.count * 2);
    for (let k = 0; k < A.count; k++) { out[k * 2] = A.getX(k); out[k * 2 + 1] = this.wear; }
    g.deleteAttribute('aVeh'); g.setAttribute('aCar', new THREE.BufferAttribute(out, 2));
    return g;
  }
  /**
   * A loft: rings[i] is a list of [x, y] half-ring points (x ≥ 0, bottom centre to top centre) at zs[i]; mirrored
   * to a closed ring. part(i, j) gives the quad between stations i, i+1 and ring points j, j+1 its part (and colour).
   * capF / capR close the ends with a fan.
   */
  loft(zs, rings, part, { capF = false, capR = false } = {}) {
    const n = zs.length, h = rings[0].length;
    // full rings (right side bottom → top, then left side top → bottom)
    const full = rings.map((R) => [...R.map(([x, y]) => [x, y]), ...R.slice(0, -1).reverse().slice(0, -1).map(([x, y]) => [-x, y])]);
    const m = full[0].length;
    const P = full.map((R, i) => R.map(([x, y]) => new THREE.Vector3(x, y, zs[i])));
    const ctr = P.map((R) => R.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / R.length));
    const N = P.map((R, i) => R.map((p, j) => {
      const a = R[(j + 1) % m].clone().sub(R[(j - 1 + m) % m]);
      const b = P[Math.min(i + 1, n - 1)][j].clone().sub(P[Math.max(i - 1, 0)][j]);
      let nn = a.clone().cross(b);
      if (nn.lengthSq() < 1e-10) nn = p.clone().sub(ctr[i]);
      if (nn.dot(p.clone().sub(ctr[i])) < 0) nn.negate();
      // the ends: lean the normals out along the car (a rounded nose and tail)
      if (capF && i === n - 1) nn.normalize().add(new THREE.Vector3(0, 0, 1.2));
      if (capR && i === 0) nn.normalize().add(new THREE.Vector3(0, 0, -1.2));
      return nn.normalize();
    }));
    const save = this.st;
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < m; j++) {
      const jj = (j + 1) % m, seg = j < h - 1 ? j : m - 1 - j;   // (the mirrored half: the right half's segment)
      const [col, prt] = part(i, seg, j >= h - 1);
      this.set(col, prt);
      const ids = [[i, j], [i + 1, j], [i + 1, jj], [i, jj]].map(([a, b]) => this.v(P[a][b].x, P[a][b].y, P[a][b].z, N[a][b].x, N[a][b].y, N[a][b].z));
      // outward winding
      const e1 = P[i + 1][j].clone().sub(P[i][j]), e2 = P[i][jj].clone().sub(P[i][j]), fn = e1.clone().cross(e2), out = P[i][j].clone().sub(ctr[i]);
      if (fn.dot(out) > 0) { this.tri(ids[0], ids[1], ids[2]); this.tri(ids[0], ids[2], ids[3]); } else { this.tri(ids[0], ids[2], ids[1]); this.tri(ids[0], ids[3], ids[2]); }
    }
    const cap = (i, dir, col, prt) => {
      this.set(col, prt);
      const c = this.v(ctr[i].x, ctr[i].y, ctr[i].z + dir * 0.015, 0, 0, dir);
      const ids = P[i].map((p, j) => this.v(p.x, p.y, p.z, ...N[i][j].toArray()));
      for (let j = 0; j < m; j++) { const a = ids[j], b = ids[(j + 1) % m]; const e1 = P[i][j].clone().sub(ctr[i]), e2 = P[i][(j + 1) % m].clone().sub(ctr[i]); (e1.cross(e2).z * dir > 0) ? this.tri(c, a, b) : this.tri(c, b, a); }
    };
    if (capF) cap(n - 1, 1, ...part(n - 2, 0, false, 'cap'));
    if (capR) cap(0, -1, ...part(0, 0, false, 'cap'));
    this.st = save;
    return this;
  }
}

// a smooth value from key points [[z, v], ...] (z ascending): cosine-eased between keys
function curve(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let k = 0; k + 1 < keys.length; k++) {
      const [z0, v0] = keys[k], [z1, v1] = keys[k + 1];
      if (z <= z1) { const t = (z - z0) / (z1 - z0), e = (1 - Math.cos(t * Math.PI)) / 2; return v0 + (v1 - v0) * e; }
    }
    return keys[keys.length - 1][1];
  };
}

/**
 * The body from a spec:
 *   L, W; axles [zF, zR]; r (wheel radius); clear (sill height); arch (gap over the tyre);
 *   top: [[z, y], ...] the beltline / bonnet / boot line; hw: [[z, half width], ...] (optional; W/2 with a nose);
 *   glass: { zA, zA2, zC2, zC, roof: [[z, y]...] } the glasshouse from its base at the windscreen (zA) to its base
 *          at the back (zC), the roof's front / back edges zA2 / zC2; pillars: [[z0, z1], ...] side spans in paint;
 *   lights { yH, yT } headlight / tail light heights; square (older, boxy).
 */
function body(M, S) {
  const { L, W, r, lod } = { ...S, lod: M.lod };
  const zF = S.axles[0], zR = S.axles[1], ar = r + (S.arch ?? 0.07), clear = S.clear ?? 0.2;
  const top = curve(S.top), hwC = S.hw ? curve(S.hw) : (() => { const e = Math.min(0.35, L * 0.08); return curve([[-L / 2, W / 2 - 0.12], [-L / 2 + e, W / 2], [L / 2 - e, W / 2], [L / 2, W / 2 - 0.14]]); })();
  const bottom = (z) => {
    let y = clear;
    if (lod === 'far') return clear + 0.15;
    for (const za of [zF, zR]) { const d = Math.abs(z - za); if (d < ar) y = Math.max(y, r + Math.sqrt(ar * ar - d * d) * 0.98); }
    // the ends tuck up (approach and departure angles)
    const e = Math.max(0, Math.abs(z) - (L / 2 - 0.35)) / 0.35;
    return y + e * e * 0.12;
  };
  // stations: even spacing, plus the arches' edges and crowns
  const step = lod === 'hi' ? 0.45 : lod === 'lo' ? 0.95 : L / 3;
  const zs = new Set();
  for (let z = -L / 2; z <= L / 2 + 1e-6; z += (L / Math.max(2, Math.round(L / step)))) zs.add(+z.toFixed(4));
  zs.add(-L / 2); zs.add(L / 2);
  if (lod !== 'far') for (const za of [zF, zR]) for (const f of (lod === 'hi' ? [-1, -0.6, 0, 0.6, 1] : [-1, 0, 1])) zs.add(+(za + f * ar * 1.001).toFixed(4));
  // (stations too close to an arch station are dropped)
  let Z = [...zs].filter((z) => z >= -L / 2 - 1e-6 && z <= L / 2 + 1e-6).sort((a, b) => a - b);
  const keep = new Set(lod === 'far' ? [] : [zF, zR].flatMap((za) => [...zs].filter((z) => Math.abs(z - za) <= ar * 1.002)));
  Z = Z.filter((z, i) => i === 0 || i === Z.length - 1 || keep.has(z) || ![...keep].some((k) => Math.abs(k - z) < step * 0.35));
  // the ends pulled in a little (a rounded nose / tail)
  const ring = (z) => {
    const yb = bottom(z), yt = top(z), hw = hwC(z), hgt = yt - yb, sq = S.square ? 0.6 : 1;
    if (lod === 'far') return [[0, yb], [hw, yb], [hw * 0.92, yt], [0, yt + 0.02]];
    if (lod === 'lo') return [[0, yb], [hw, yb + Math.min(0.05, hgt * 0.2)], [hw * (1 - 0.04 * sq), yt - Math.min(0.06, hgt * 0.25)], [hw * (1 - 0.18 * sq), yt], [0, yt + 0.025]];
    return [[0, yb], [hw * 0.92, yb], [hw, yb + hgt * 0.4], [hw * (1 - 0.025 * sq), yt - Math.min(0.09, hgt * 0.3)], [hw * (1 - 0.08 * sq), yt - 0.015], [hw * (1 - 0.2 * sq), yt], [0, yt + 0.03 * sq]];
  };
  const rings = Z.map(ring);
  M.loft(Z, rings, () => ['#ffffff', PART.PAINT], { capF: true, capR: true });
  // the glasshouse
  if (S.glass) {
    const G = S.glass, roof = curve(G.roof), gz = new Set([G.zA, G.zA2, G.zC2, G.zC]);
    const gs = lod === 'hi' ? 0.45 : lod === 'lo' ? 1.0 : 10;
    for (let z = G.zC; z <= G.zA; z += (G.zA - G.zC) / Math.max(1, Math.round((G.zA - G.zC) / gs))) gz.add(+z.toFixed(4));
    if (lod !== 'far') for (const [a, b] of G.pillars || []) { gz.add(a); gz.add(b); }
    const GZ = [...gz].filter((z) => z >= G.zC - 1e-6 && z <= G.zA + 1e-6).sort((a, b) => a - b);
    const yAt = (z) => {   // the glass's top: the windscreen / rear window rising from the belt to the roof
      const yb = top(z) - 0.01, yr = roof(z);
      if (z > G.zA2) return yb + (yr - yb) * Math.max(0, (G.zA - z) / (G.zA - G.zA2));
      if (z < G.zC2) return yb + (yr - yb) * Math.max(0, (z - G.zC) / (G.zC2 - G.zC));
      return yr;
    };
    const tumble = G.tumble ?? 0.8;
    const gring = (z) => {
      const yb = top(z) - 0.01, yt = Math.max(yb + 0.002, yAt(z)), hb = hwC(z) * (S.square ? 0.95 : 0.9), ht = hb * tumble, hh = yt - yb;
      if (lod === 'far') return [[hb, yb], [ht, yt], [0, yt]];
      if (lod === 'lo') return [[hb, yb], [ht + (hb - ht) * 0.1, yt - Math.min(0.06, hh * 0.25)], [ht * 0.86, yt], [0, yt + 0.01]];
      return [[hb, yb], [hb - (hb - ht) * 0.08, yb + Math.min(0.04, hh * 0.3)], [ht + (hb - ht) * 0.1, yt - Math.min(0.06, hh * 0.25)], [ht * 0.86, yt], [0, yt + 0.01]];
    };
    // as a closed ring: add the bottom centre (inside the body)
    const grings = GZ.map((z) => { const R = gring(z); return [[0, R[0][1] - 0.05], ...R]; });
    const inSpan = (z0, z1, spans) => (spans || []).some(([a, b]) => z0 >= a - 1e-4 && z1 <= b + 1e-4);
    const nTop = grings[0].length - 1;   // index of the top centre
    M.loft(GZ, grings, (i, j) => {
      const z0 = GZ[i], z1 = GZ[i + 1], zm = (z0 + z1) / 2, roofSpan = zm < G.zA2 && zm > G.zC2;
      if (j === 0) return [DARK, PART.FIXED];                           // (inside the body)
      if (lod === 'far') return j >= nTop - 1 && roofSpan ? ['#ffffff', PART.PAINT] : [GLASS, PART.GLASS];
      if (lod === 'lo') return j >= 2 && roofSpan ? ['#ffffff', PART.PAINT] : j === 1 && inSpan(z0, z1, G.pillars) ? [G.blackPillars ? DARK : '#ffffff', G.blackPillars ? PART.FIXED : PART.PAINT] : [GLASS, PART.GLASS];
      if (j === 1) return [S.chrome ? CHROME : TRIM, PART.FIXED];       // the window sill trim
      if (j >= nTop - 2 && roofSpan) return ['#ffffff', PART.PAINT];    // the roof
      if (j === 2 && inSpan(z0, z1, G.pillars)) return [G.blackPillars ? DARK : '#ffffff', G.blackPillars ? PART.FIXED : PART.PAINT];
      return [GLASS, PART.GLASS];
    });
    // the A pillars: along the windscreen's edges (paint)
    if (lod !== 'far') {
      M.paint();
      const yb = top(G.zA) - 0.01, hbA = hwC(G.zA) * (S.square ? 0.95 : 0.9), htA2 = hwC(G.zA2) * (S.square ? 0.95 : 0.9) * tumble;
      for (const s of [1, -1]) M.rod([s * hbA * 0.98, yb, G.zA], [s * htA2 * 0.97, roof(G.zA2) - 0.02, G.zA2], lod === 'hi' ? 0.045 : 0.05, lod === 'hi' ? 5 : 3);
      if (G.rearPillar) { const ybC = top(G.zC) - 0.01, hbC = hwC(G.zC) * (S.square ? 0.95 : 0.9), htC = hwC(G.zC2) * (S.square ? 0.95 : 0.9) * tumble; for (const s of [1, -1]) M.rod([s * hbC * 0.98, ybC, G.zC], [s * htC * 0.97, roof(G.zC2) - 0.02, G.zC2], 0.05, lod === 'hi' ? 5 : 3); }
    }
  }
  return { top, hw: hwC, bottom };
}

/** Wheels and their wells; lights, grille, bumpers, plates, mirrors. */
function running(M, S, B) {
  const { L, W, r } = S, lod = M.lod, zF = S.axles[0], zR = S.axles[1], tw = S.tyreW ?? 0.22;
  const inset = S.inset ?? 0.12;
  // wheel wells (dark, inside the arches)
  if (lod === 'far') {   // wheels as blocks (an axle's pair: one block)
    M.set(TYRE); for (const za of [zF, zR]) M.rbox([0, r * 0.95, za], [W - 2 * inset + tw, r * 1.9, r * 1.9], 0.002);
    return;
  }
  M.set(DARK);
  if (lod === 'hi') for (const za of [zF, zR]) M.rbox([0, r + 0.2, za], [W - 0.18, 0.42, 2 * (r + 0.07) * 0.95], 0.002);
  for (const za of [zF, zR]) for (const s of [1, -1]) M.wheel(s * (W / 2 - inset), r, za, r, tw, s, lod === 'hi' ? 10 : 6);
  if (false) {   // the rims: a ring of spokes' shadow (the vehicles.js hub is the centre cap)
    M.set(RIM);
    for (const za of [zF, zR]) for (const s of [1, -1]) {
      const x = s * (W / 2 - inset + tw / 2 + 0.004), seg = 10, ids = [];
      for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2; ids.push(M.v(x, r + Math.cos(a) * r * 0.72, za + Math.sin(a) * r * 0.72, s, 0, 0), M.v(x - s * 0.01, r + Math.cos(a) * r * 0.62, za + Math.sin(a) * r * 0.62, s, 0, 0)); }
      for (let k = 0; k < seg; k++) { const a = ids[k * 2], b = ids[k * 2 + 1], c = ids[k * 2 + 2], d = ids[k * 2 + 3]; s > 0 ? (M.tri(a, c, d), M.tri(a, d, b)) : (M.tri(a, d, c), M.tri(a, b, d)); }
    }
  }
  const zf = L / 2, zr = -L / 2, yH = S.lights?.yH ?? B.top(zf - 0.2) - 0.12, yT = S.lights?.yT ?? B.top(zr + 0.2) - 0.12;
  const hwF = B.hw(zf - 0.15), hwR = B.hw(zr + 0.15);
  // bumpers: body colour with a dark lower lip (modern) or chrome bars (square / old)
  if (S.square) {
    M.set(CHROME); M.rbox([0, 0.42, zf + 0.04], [W * 0.98, 0.16, 0.12], 0.03); M.rbox([0, 0.45, zr - 0.04], [W * 0.98, 0.16, 0.12], 0.03);
  } else {
    M.paint(); M.rbox([0, 0.48, zf - 0.08], [hwF * 2 - 0.04, 0.28, 0.24], lod === 'hi' ? 0.09 : 0.06);
    M.rbox([0, 0.5, zr + 0.08], [hwR * 2 - 0.04, 0.3, 0.24], lod === 'hi' ? 0.09 : 0.06);
    if (lod === 'hi') { M.set(TRIM); M.rbox([0, 0.3, zf - 0.06], [hwF * 2 - 0.18, 0.1, 0.22], 0.03); M.rbox([0, 0.32, zr + 0.06], [hwR * 2 - 0.18, 0.1, 0.22], 0.03); }
  }
  // grille and plates
  if (lod === 'hi' || S.square) M.set(S.square ? CHROME : DARK), M.rbox([0, yH - 0.02, zf - 0.02], [Math.min(0.9, hwF * 0.9), S.square ? 0.28 : 0.16, 0.06], 0.02);
  if (lod === 'hi') { M.set(PLATE); M.rbox([0, 0.42, zf + (S.square ? 0.1 : 0.04)], [0.52, 0.12, 0.02], 0.004); M.rbox([0, yT - 0.24, zr - 0.035], [0.52, 0.12, 0.02], 0.004); }
  // lights
  M.set('#f4efe0', PART.HEAD);
  for (const s of [1, -1]) S.square ? M.ellipsoid([s * (hwF - 0.3), yH, zf - 0.01], [0.13, 0.13, 0.04], 3, 8) : M.rbox([s * (hwF - 0.26), yH + 0.02, zf - 0.05], [0.34, 0.1, 0.12], 0.04);
  M.set('#a8161a', PART.TAIL);
  for (const s of [1, -1]) M.rbox([s * (B.hw(zr + 0.1) - (S.square ? 0.12 : 0.2)), yT, zr + 0.025], S.square ? [0.12, 0.28, 0.08] : [0.3, 0.12, 0.08], 0.03);
  // mirrors
  if (S.glass && lod === 'hi') {
    const z = S.glass.zA - 0.12, y = B.top(z) + 0.1;
    M.paint(); for (const s of [1, -1]) M.rbox([s * (B.hw(z) + 0.08), y, z], [0.14, 0.12, 0.08], lod === 'hi' ? 0.03 : 0.002);
  }
  // door shut lines and handles (near only)
  if (lod === 'hi' && S.doors) {
    M.set(DARK);
    for (const z of S.doors) for (const s of [1, -1]) M.rbox([s * (B.hw(z) + 0.002), (B.bottom(z) + B.top(z)) / 2 + 0.03, z], [0.006, (B.top(z) - B.bottom(z)) * 0.75, 0.012], 0.002);
    M.set(TRIM); for (const z of S.doors) for (const s of [1, -1]) M.rbox([s * (B.hw(z - 0.25) + 0.012), B.top(z - 0.25) - 0.1, z - 0.25], [0.025, 0.035, 0.16], 0.01);
  }
}

function rack(M, S, B) {
  if (!S.glass || M.lod === 'far') return;
  const G = S.glass, roofY = curve(G.roof), z0 = G.zC2 + 0.1, z1 = G.zA2 - 0.1, hw = B.hw((z0 + z1) / 2) * (S.square ? 0.95 : 0.9) * (G.tumble ?? 0.8) * 0.82;
  M.set('#1b1c1e');
  for (const s of [1, -1]) M.rod([s * hw, roofY(z0) + 0.06, z0], [s * hw, roofY(z1) + 0.06, z1], 0.022, 4);
  for (const z of [z0 + 0.3, z1 - 0.35]) M.rbox([0, roofY(z) + 0.08, z], [hw * 2 + 0.1, 0.035, 0.07], 0.01);
}

// ---------------------------------------------------------------- the kinds
const SPECS = {
  hatch: { L: 4.0, W: 1.76, r: 0.31, axles: [1.3, -1.25], top: [[-2, 0.82], [-1.7, 0.9], [-1.2, 0.93], [1.0, 0.92], [1.6, 0.84], [2, 0.66]],
    glass: { zA: 1.05, zA2: 0.2, zC2: -1.55, zC: -1.85, roof: [[-1.6, 1.44], [0, 1.47], [0.3, 1.46]], pillars: [[-0.55, -0.42], [-1.85, -1.3]], tumble: 0.8 }, doors: [0.98, -0.5] },
  sedan: { L: 4.6, W: 1.8, r: 0.32, axles: [1.42, -1.38], top: [[-2.3, 0.86], [-2.0, 0.93], [-1.3, 0.94], [1.1, 0.9], [1.9, 0.82], [2.3, 0.66]],
    glass: { zA: 1.05, zA2: 0.2, zC2: -0.95, zC: -1.6, roof: [[-1, 1.42], [-0.2, 1.45], [0.25, 1.44]], pillars: [[-0.5, -0.38]], tumble: 0.8 }, doors: [0.98, -0.42, -1.25] },
  wagon: { L: 4.7, W: 1.8, r: 0.32, axles: [1.45, -1.4], top: [[-2.35, 0.88], [-2.1, 0.95], [-1.3, 0.96], [1.1, 0.92], [1.95, 0.83], [2.35, 0.67]],
    glass: { zA: 1.08, zA2: 0.22, zC2: -2.05, zC: -2.25, roof: [[-2.05, 1.44], [-0.5, 1.46], [0.25, 1.46]], pillars: [[-0.5, -0.38], [-1.4, -1.28], [-2.25, -1.95]], tumble: 0.82, blackPillars: true }, doors: [1.0, -0.44, -1.3] },
  suv: { L: 4.7, W: 1.9, r: 0.37, arch: 0.08, clear: 0.28, axles: [1.45, -1.42], top: [[-2.35, 0.98], [-2.1, 1.08], [-1.3, 1.1], [1.1, 1.06], [1.9, 0.98], [2.35, 0.8]],
    glass: { zA: 1.15, zA2: 0.35, zC2: -2.05, zC: -2.25, roof: [[-2.05, 1.74], [-0.5, 1.76], [0.35, 1.75]], pillars: [[-0.48, -0.34], [-1.55, -1.4], [-2.25, -1.85]], tumble: 0.84 }, doors: [1.05, -0.4, -1.38], tyreW: 0.25 },
  pickup: { L: 5.5, W: 2.0, r: 0.39, arch: 0.09, clear: 0.3, axles: [1.75, -1.75], top: [[-2.75, 1.08], [-2.65, 1.12], [2.0, 1.1], [2.5, 1.03], [2.75, 0.9]],
    glass: { zA: 1.35, zA2: 0.6, zC2: -0.45, zC: -0.55, roof: [[-0.45, 1.86], [0.6, 1.86]], pillars: [[-0.55, -0.38]], tumble: 0.86, rearPillar: true }, doors: [1.3, -0.4], tyreW: 0.27, bed: [-0.62, -2.72] },
  van: { L: 5.1, W: 2.0, r: 0.34, clear: 0.24, axles: [1.75, -1.65], top: [[-2.55, 1.0], [-2.4, 1.04], [1.7, 1.02], [2.25, 0.96], [2.55, 0.78]],
    glass: { zA: 1.85, zA2: 0.95, zC2: -2.42, zC: -2.55, roof: [[-2.42, 2.0], [0.95, 2.0]], pillars: [[0.25, 0.4], [-0.4, -2.0]], tumble: 0.9, blackPillars: false, panel: true }, doors: [1.7, 0.3], tyreW: 0.24 },
  farmtruck: { L: 5.3, W: 1.95, r: 0.38, arch: 0.12, clear: 0.34, square: true, axles: [1.62, -1.65], top: [[-2.65, 1.05], [2.0, 1.05], [2.35, 1.02], [2.65, 0.98]], hw: [[-2.65, 0.96], [-2.55, 0.975], [2.55, 0.975], [2.65, 0.95]],
    glass: { zA: 1.2, zA2: 0.85, zC2: -0.3, zC: -0.36, roof: [[-0.3, 1.86], [0.85, 1.86]], pillars: [], tumble: 0.88, rearPillar: true }, lights: { yH: 0.86, yT: 0.85 }, doors: [1.15, -0.3], tyreW: 0.25, bed: [-0.45, -2.62], stakes: true, chrome: true },
};

function build(kind, lod, opt) {
  const S = SPECS[kind] || SPECS.sedan;
  const M = new CarBuilder(lod, opt.wear ?? (kind === 'farmtruck' ? 2 : 0));
  const B = body(M, S);
  // a van's side panels: the glass behind the cab painted over (a work van) — the loft's pillar span covers it
  if (S.bed) {   // the pickup bed: floor, sides (body colour), tailgate; the farm truck's stake sides
    const [z0, z1] = S.bed, len = z0 - z1, zc = (z0 + z1) / 2, yTop = B.top(zc) + 0.02, hw = S.W / 2 - 0.02;
    M.set('#2a2b2c'); M.rbox([0, yTop - 0.02, zc], [S.W - 0.2, 0.04, len - 0.1], 0.002);
    if (M.lod !== 'far') { M.paint(); for (const s of [1, -1]) M.rbox([s * (hw - 0.04), yTop + 0.17, zc], [0.08, 0.36, len], M.lod === 'hi' ? 0.03 : 0.002); M.rbox([0, yTop + 0.17, z1 + 0.04], [S.W - 0.04, 0.36, 0.08], 0.02); M.rbox([0, yTop + 0.17, z0 - 0.04], [S.W - 0.1, 0.36, 0.08], 0.02); }
    if (S.stakes && M.lod !== 'far') {
      M.set('#6d5a40');
      for (const s of [1, -1]) for (let k = 0; k < 4; k++) M.rbox([s * (hw - 0.04), yTop + 0.6, z0 - 0.15 - k * (len - 0.3) / 3], [0.07, 0.5, 0.07], 0.002);
      for (const s of [1, -1]) for (const dy of [0.5, 0.78]) M.rbox([s * (hw - 0.04), yTop + dy, zc], [0.05, 0.1, len - 0.1], 0.002);
    }
  }
  running(M, S, B);
  if (opt.rack) rack(M, S, B);
  return M.geometry();
}

const CACHE = new Map();
/** One kind's geometry (cached and shared: don't dispose; disposeCarGeometries()). lod 'hi' | 'lo' | 'far'. */
export function carGeometry(kind, lod = 'hi', { rack = false } = {}) {
  if (!SPECS[kind]) kind = 'sedan';
  const key = `${kind}|${lod}|${rack ? 1 : 0}`;
  if (!CACHE.has(key)) CACHE.set(key, build(kind, lod, { rack }));
  return CACHE.get(key);
}
export function disposeCarGeometries() { for (const g of CACHE.values()) g.dispose(); CACHE.clear(); STATIC.forEach((g) => g.dispose()); STATIC.clear(); }
export function carStats(lod = 'hi') { return Object.fromEntries(CAR_KINDS.map((k) => [k, carGeometry(k, lod).index.count / 3])); }

/**
 * The cars' material: paint from instanceColor (the paint parts only), glass glossy, lights faintly lit, dirt and
 * rust from the wear class, the region and the car's spot. region: { dirt 0–1, rust 0–1 } (city ≈ .1 / 0; rural
 * ≈ .35 / .15). night: a { value } uniform (lights glow at dusk).
 */
export function carMaterial({ dirt = 0.1, rust = 0, night = { value: 0 } } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 });
  m.userData.uniforms = { uDirt: { value: dirt }, uRust: { value: rust }, uNight: night };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aCar; varying float vPart; varying vec3 vCarP; varying vec2 vWear;
        uniform float uDirt; uniform float uRust;
        float carHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vPart = aCar.x; vCarP = position;
        #ifdef USE_INSTANCING
          vec2 at = instanceMatrix[3].xz;
        #else
          vec2 at = vec2(0.);
        #endif
        float h1 = carHash(at), h2 = carHash(at + 17.3);
        // dirt: the region's, more on a lived-in car, most on a farm truck; rust: old cars only, the farm truck always
        vWear = vec2(clamp(uDirt * (.4 + 1.2 * h1) + aCar.y * .28, 0., 1.), clamp(uRust * step(.72, h2) * h2 + (aCar.y > 1.5 ? .35 + .4 * h2 : 0.), 0., 1.));
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = color.rgb * (aCar.x < .5 ? instanceColor.rgb : vec3(1.));
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying float vPart; varying vec3 vCarP; varying vec2 vWear;
        float cN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          float n = dot(i, vec3(1., 57., 113.));
          vec4 a = fract(sin(vec4(n, n + 1., n + 57., n + 58.)) * 43758.5453), b = fract(sin(vec4(n + 113., n + 114., n + 170., n + 171.)) * 43758.5453);
          vec4 m = mix(a, b, f.z); vec2 m2 = mix(m.xy, m.zw, f.y); return mix(m2.x, m2.y, f.x); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float glassP = step(1.5, vPart) * step(vPart, 2.5);
        // dirt: up from the ground, splashed behind the wheels (noisy edge); a film on the glass's lower edge
        float dn = cN(vCarP * vec3(3., 6., 3.)) * .5 + cN(vCarP * 13.) * .25;
        float dirtH = 1. - smoothstep(.15, .95, vCarP.y + dn * .35 - vWear.x * .35);
        float dirtA = clamp(vWear.x * dirtH * 1.4, 0., .85) * (1. - glassP * .6);
        // rust: paint only, low on the body (sills, arches, tailgate), in blotches
        float rn = cN(vCarP * 7.) * .65 + cN(vCarP * 21.) * .35;
        float rustA = step(vPart, .5) * smoothstep(.0, .1, vWear.y * (1.1 - smoothstep(.25, .8, vCarP.y)) - rn * .62);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.33, .16, .08) * (.7 + rn * .6), rustA);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.36, .31, .24), dirtA);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (vPart > 1.5 && vPart < 2.5) roughnessFactor = .12;
        else if (vPart > .5) roughnessFactor = .7;
        roughnessFactor = mix(roughnessFactor, .95, max(dirtA, rustA));`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = vPart < .5 ? mix(.18, 0., max(dirtA, rustA)) : vPart > 1.5 && vPart < 2.5 ? .3 : .05;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vPart > 9.5 && vPart < 10.5) totalEmissiveRadiance += vec3(1., .94, .8) * (.05 + uNight * .3);
        if (vPart > 10.5 && vPart < 11.5) totalEmissiveRadiance += vec3(.9, .08, .05) * (.12 + uNight * .3);`);
  };
  m.customProgramCacheKey = () => 'bf-cars-1';
  return m;
}

/**
 * Parked cars as instanced meshes: add() each car, then meshes() gives one InstancedMesh per kind (and rack) for a
 * LOD, paint in instanceColor. The geometries are the kit's (shared: the meshes are flagged userData.shared).
 */
export class ParkedCars {
  constructor() { this.list = []; }
  add(x, y, z, yaw, spec) { this.list.push({ x, y, z, yaw, ...spec }); return this; }
  get count() { return this.list.length; }
  /** InstancedMeshes for one LOD ('hi' | 'lo' | 'far'), named `${name} ${kind}`. */
  meshes(material, lod, name = 'Parked cars') {
    const by = new Map();
    for (const c of this.list) { const k = `${c.kind}|${c.rack && lod !== 'far' ? 1 : 0}`; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
    const out = [], m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (const [key, list] of by) {
      const [kind, rk] = key.split('|');
      const im = new THREE.InstancedMesh(carGeometry(kind, lod, { rack: rk === '1' }), material, list.length);
      list.forEach((c, i) => { im.setMatrixAt(i, m4.makeRotationY(c.yaw).setPosition(c.x, c.y, c.z)); im.setColorAt(i, col.set(c.paint)); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.userData.shared = true; im.castShadow = lod !== 'far'; im.receiveShadow = true; im.name = `${name} ${kind}${rk === '1' ? ' rack' : ''}`;
      out.push(im);
    }
    return out;
  }
}

const STATIC = new Map();
/** A car with its paint baked into the vertex colours (scenery merged into a mesh: street kits, race-day lots). */
export function staticCar(kind, paint, lod = 'lo', { rack = false } = {}) {
  const key = `${kind}|${paint}|${lod}|${rack ? 1 : 0}`;
  if (STATIC.has(key)) return STATIC.get(key);
  const src = carGeometry(kind, lod, { rack }), C = src.attributes.color, A = src.attributes.aCar, out = new Float32Array(C.count * 3), p = new THREE.Color(paint || '#ffffff');
  for (let k = 0; k < C.count; k++) { const t = A.getX(k) < 0.5; out.set([C.getX(k) * (t ? p.r : 1), C.getY(k) * (t ? p.g : 1), C.getZ(k) * (t ? p.b : 1)], k * 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone()); g.setAttribute('normal', src.attributes.normal.clone()); g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  g.setIndex(src.index.clone()); g.computeBoundingSphere();
  STATIC.set(key, g);
  return g;
}
