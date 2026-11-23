// Upstate New York country-road edges (CNY, SKAN): the cross-section a town highway crew leaves behind, and what
// grows and stands in it.
//
//   road edge ─ sandy lip ─ mowed shoulder ─ foreslope ─ ditch bottom ─ backslope ─ berm ─ brush ─ fence line
//      0          .2            .9             1.9          2.5           3.1        3.8   4–6       5.5   (m from the edge)
//
// The ditch is its own strip mesh laid over the ground (the ground mesh's 12.8 m cells can't carry a 2 m swale): its
// bottom sits just on the ground and the berm rises above it, so the swale reads by its shape and shading wherever
// the ground beside the road is a shelf under the road (not on an embankment). Driveways cross it on a culvert.
//
// Brush (goldenrod, Queen Anne's lace, chicory, tall grass, cattails in the wet bottoms) and the utility poles go
// into a MeshBuilder; sumac thickets come from the tree engine (graph-city's _ruralTrees).
import * as THREE from '../../../../vendor/three.module.min.js';
import { hash } from '../core/mesh-builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ the cross-section
/** The profile's stations: [m from the road edge, colour]; heights from profileY. */
export const DITCH = [
  [.2, '#9a9479'],    // sandy lip: winter sand and gravel swept off the road
  [.9, '#7a9d44'],    // mowed shoulder
  [1.9, '#6f9240'],   // foreslope
  [2.5, '#5a783a'],   // the bottom: damp, darker
  [3.1, '#6b8c3e'],   // backslope
  [3.8, '#82944a'],   // the berm: rougher, unmowed
  [4.8, '#7ea045'],   // back down into the field
];
/** Height at d m from the edge, given the road's surface rY and the ground's surface base. */
export function profileY(d, rY, base) {
  const bottom = base + .02, lip = rY - .05, shoulder = rY - .15, berm = base + .42;
  const P = [[.2, lip], [.9, shoulder], [1.9, bottom + (shoulder - bottom) * .38], [2.5, bottom], [3.1, bottom + .12], [3.8, berm], [4.8, base - .06]];
  if (d <= P[0][0]) return lip;
  for (let k = 1; k < P.length; k++) if (d <= P[k][0]) { const [d0, y0] = P[k - 1], [d1, y1] = P[k], t = (d - d0) / (d1 - d0); return y0 + (y1 - y0) * (t * t * (3 - 2 * t)); }
  return base;
}
/** Whether a ditch can be cut here: the ground a shelf under the road (not an embankment, not up at the road). */
export function ditchFits(rY, base) { const drop = rY - base; return drop > .22 && drop < 1.25; }

/**
 * The ditch strips: runs of stations along one side of a road. rows: [{ x, z, nx, nz, rY, base }] (nx, nz: outward);
 * consecutive rows join. Returns a BufferGeometry (vertex colours, smooth across the profile) or null.
 */
export function ditchGeometry(runs) {
  const pos = [], nor = [], col = [], idx = [];
  const c = new THREE.Color();
  for (const rows of runs) {
    if (rows.length < 2) continue;
    const S = DITCH.length, v0 = pos.length / 3;
    for (const r of rows) {
      const ys = DITCH.map(([d]) => profileY(d, r.rY, r.base));
      for (let k = 0; k < S; k++) {
        const d = DITCH[k][0], y = ys[k];
        pos.push(r.x + r.nx * d, y, r.z + r.nz * d);
        // the profile's normal in the (out, up) plane, from its neighbours
        const ka = Math.max(0, k - 1), kb = Math.min(S - 1, k + 1), dd = DITCH[kb][0] - DITCH[ka][0], dy = ys[kb] - ys[ka], l = Math.hypot(dd, dy) || 1;
        const no = -dy / l, nu = dd / l;
        nor.push(r.nx * no, nu, r.nz * no);
        const h = hash(r.x * .37 + r.z * .91 + k * 3.1);
        c.set(DITCH[k][1]).multiplyScalar(.9 + h * .2);
        if (k === 3 && h < .3) c.lerp(new THREE.Color('#5d5a3e'), .5);   // a muddy stretch where the water stands
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k + 1 < S; k++) {
      const a = v0 + i * S + k, b = a + 1, d = a + S, e = d + 1;
      // wound to face up whichever side of the road (nx, nz outward)
      const flip = rows[i].side < 0;
      if (flip) idx.push(a, d, b, b, d, e); else idx.push(a, b, d, b, e, d);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

/** A corrugated steel culvert's end showing in the ditch beside a driveway: the pipe runs along the road (dir). */
export function culvertEnd(M, x, y, z, dx, dz, seed) {
  const r = .3 + seed * .1, L = .7;
  const a = V(x, y + r * .6, z), b = V(x + dx * L, y + r * .6, z + dz * L);
  M.color(seed < .5 ? '#8f9290' : '#7d7a70').beam(a, b, r * 1.9, r * 1.9);
  M.color('#2b2b28').beam(b.clone().addScaledVector(V(dx, 0, dz), -.05), b.clone().addScaledVector(V(dx, 0, dz), .02), r * 1.5, r * 1.5);   // the dark bore
}

// ------------------------------------------------------------------ brush (into a MeshBuilder)
const blade = (M, x, y, z, a, h, w, lean, colour) => {
  const ca = Math.cos(a + 1.57) * w, sa = Math.sin(a + 1.57) * w, tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
  M.color(colour);
  const A = V(x - ca, y - .03, z - sa), B = V(x + ca, y - .03, z + sa), C = V(tx, y + h, tz);
  M.triangle(A, B, C); M.triangle(B, A, C);
  return [tx, y + h, tz];
};
/** Goldenrod: a clump of stiff stems, each with an arching yellow plume (in bloom: it's September). */
export function goldenrod(M, x, y, z, seed) {
  const n = 7 + Math.floor(seed * 5);
  for (let k = 0; k < n; k++) {
    const a = k * 2.4 + seed * 9, d = hash(seed * 7 + k) * .45, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const h = .85 + hash(seed * 3 + k) * .55, [tx, ty, tz] = blade(M, px, y, pz, a, h, .025, .08 + hash(k + seed) * .12, k % 3 ? '#5f7238' : '#6d7a3e');
    // the plume: small yellow sprays arching out and over from the top of the stem (a few going over, browner)
    const going = hash(seed * 11 + k) < .2;
    for (let j = 0; j < 4; j++) {
      const t = j / 3, ax = tx + Math.cos(a) * (.04 + t * .16), az = tz + Math.sin(a) * (.04 + t * .16), ay = ty - .06 - t * t * .14;
      M.color(going ? '#a88f3e' : j % 2 ? '#e0c240' : '#cfae34').pyramid(ax, ay - .1, az, .11, .14, .11, a + j);
    }
  }
}
/** Queen Anne's lace (white, flat-topped umbels; some curled into brown bird's nests by now) and chicory (blue). */
export function laceAndChicory(M, x, y, z, seed) {
  const n = 3 + Math.floor(seed * 3);
  for (let k = 0; k < n; k++) {
    const a = k * 2.1 + seed * 7, d = hash(seed * 5 + k) * .35, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const chicory = hash(seed * 13 + k) < .35, h = (chicory ? .55 : .7) + hash(seed + k * 3) * .4;
    const [tx, ty, tz] = blade(M, px, y, pz, a, h, .018, .06, '#6a7d45');
    if (chicory) { M.color('#7b97d9'); for (let j = 0; j < 3; j++) M.pyramid(tx + Math.cos(a + j) * .04, ty - .1 - j * .14, tz + Math.sin(a + j) * .04, .07, .04, .07, a); }
    else { const nest = hash(seed * 17 + k) < .3; M.color(nest ? '#8b7552' : '#f0eee4').pyramid(tx, ty - .03, tz, .22, .05, .22, a); }
  }
}
/** Tall unmowed grass (orchard grass, timothy): blades past the knee, tan seed heads. */
export function tallGrass(M, x, y, z, seed) {
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = k * 2.4 + seed * 6, d = hash(seed * 9 + k) * .4;
    const h = .55 + hash(seed * 4 + k) * .5, tone = ['#7f9446', '#8e9a52', '#a8a064', '#6f8c40', '#b3a46c'][k % 5];
    const [tx, ty, tz] = blade(M, x + Math.cos(a) * d, y, z + Math.sin(a) * d, a, h, .045, .18 + hash(seed + k) * .15, tone);
    if (k % 3 === 0) M.color('#b5a676').pyramid(tx, ty - .14, tz, .04, .16, .04, a);
  }
}
/** Cattails in a wet ditch bottom: straps and a brown head or two. */
export function cattails(M, x, y, z, seed) {
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4 + seed * 5, d = hash(seed * 3 + k) * .2;
    const h = 1.1 + hash(seed * 7 + k) * .5, [tx, ty, tz] = blade(M, x + Math.cos(a) * d, y, z + Math.sin(a) * d, a, h, .03, .1, k % 2 ? '#6b7a3c' : '#7e8648');
    if (k === 0) M.color('#5a3e27').cylinder(tx, ty - .45, tz, .05, .22, 5);
  }
}

// ------------------------------------------------------------------ utility poles and wires
/** A wooden utility pole: weathered, a crossarm with three insulators, now and then a transformer can. */
export function utilityPole(M, x, y, z, yaw, seed) {
  const H = 10.5 + seed * 1.5, c = Math.cos(yaw), s = Math.sin(yaw);
  M.color(seed < .5 ? '#6e6152' : '#5f5446').cylinder(x, y - .5, z, .16, H + .5, 7, .11);
  const top = y + H, arm = (u) => [x + c * u, z - s * u];
  M.color('#6b5c49').box(x, top - .55, z, 2.4, .1, .1, yaw);
  for (const u of [-1.05, 0, 1.05]) { const [px, pz] = arm(u); M.color('#8c8e88').cylinder(px, u ? top - .5 : top - .1, pz, .05, .2, 5); }
  M.color('#4a4a46').box(x, top - 2.4, z, .06, .06, .3, yaw);   // the neutral's bracket
  if (seed > .72) { M.color('#8d9190').cylinder(x + s * .35, top - 2.1, z + c * .35, .24, .75, 8); }
  return { top, attach: [arm(-1.05), [x, z], arm(1.05)], neutral: [x, top - 2.4, z] };
}
/** The span between two poles: the primaries (three) and the neutral, each a sagging catenary of thin beams. */
export function wires(M, A, B) {
  M.color('#2a2a28');
  const span = (a, b, sag) => {
    const n = 6; let p = a;
    for (let k = 1; k <= n; k++) {
      const t = k / n, q = V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
      M.beam(p, q, .025, .025); p = q;
    }
  };
  for (let k = 0; k < 3; k++) span(V(A.attach[k][0], A.top - (k === 1 ? 0 : .38), A.attach[k][1]), V(B.attach[k][0], B.top - (k === 1 ? 0 : .38), B.attach[k][1]), .7);
  span(V(...A.neutral), V(...B.neutral), .9);
}

/** A low scrub clump on a canal bank (red osier dogwood, willow scrub, a sapling or two): a few leafy masses on
 *  thin stems, 0.6–1.6 m, greens with the first reds and yellows of September. */
export function scrubClump(M, x, y, z, seed) {
  const n = 3 + Math.floor(seed * 3), tones = ['#4f6b33', '#5a7538', '#62773a', '#7d2f24', '#8f7a35', '#45612f'];
  for (let k = 0; k < n; k++) {
    const a = k * 2.3 + seed * 7, d = .15 + hash(seed * 11 + k) * .45, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const h = .6 + hash(seed * 5 + k) * 1, w = .45 + hash(seed * 3 + k) * .4;
    M.color(hash(seed * 13 + k) < .5 ? '#7a3328' : '#5e4a36').beam(V(px, y - .05, pz), V(px + Math.cos(a) * .08, y + h * .55, pz + Math.sin(a) * .08), .03, .03);
    M.color(tones[Math.floor(hash(seed * 17 + k) * tones.length)]).pyramid(px, y + h * .35, pz, w, h * .7, w * .85, a);
    M.pyramid(px, y + h * .25, pz, w * .9, h * .45, w * .75, a + .8);   // (a second, lower mass: fuller)
  }
}
