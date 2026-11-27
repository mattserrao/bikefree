// CNY's landmarks (user, 22 Nov: "Generate a list of landmarks in CNY. Then, work through improving these"), each from
// its real form on its OSM outline (tools/cny_heroes.py → routes/cities/cny-heroes.json): built by
// js/world/toolbox/city/pgh-landmarks.js with the other landmark models (the same builders, materials and night glows).
//
//   aqueduct     the Nine Mile Creek Aqueduct (1841): four 30 ft Roman arches of stone on piers, 144 ft, the timber trunk
//                carrying the canal over the creek (restored 2009), the 12 ft towpath along its side with a rail
//   canalstore   Sims' Store Museum: a two-and-a-half storey clapboard canal store, a porch along its front
//   enginehouse  the park's steam engine house: brick, a tall stack
//   octagon      the Wilcox Octagon House (1856): two storeys of eight faces, a low eight-sided roof, a cupola
//   canalboat    the tour boat at the park's dock
//   railbridge   the Finger Lakes Railway over Genesee Street: two steel plate girders on stone abutments
//   library      the Maxwell Memorial Library: one storey of brick, a gabled entrance
//   firehouse    the Warners Volunteer Fire Department: the apparatus bays and a hose tower
import * as THREE from '../../../../vendor/three.js';
import { SKY_REFLECT } from '../atmosphere/sky-dome.js';
import { V, centroid, scaleRing, orient, prism, cap, block, frameOf, makeFrame, lathe, gable, faceOut } from './hero-geom.js';
import { HASH_GLSL } from '../materials/glsl-noise.js';   // [review 27 Nov] the shared sin-free hash and value noise

/**
 * The canal's channel, for the planters (graph-city: no tree, house or brush in it; scrub on its banks): its samples
 * every 4 m with the water's width each side and the room to the nearest way (the towpath); the creeks' channels
 * too (`creek`: no room measured, no canal scrub). canalAt(x, z, pad): the
 * sample it's in (within pad of the water), or null.
 */
export const CANAL = { samples: [], grid: new Map() };
const CG = 24, cgKey = (i, j) => i * 100003 + j;
export function canalAt(x, z, pad = 0) {
  const i0 = Math.floor(x / CG), j0 = Math.floor(z / CG);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const p of CANAL.grid.get(cgKey(i, j)) || []) {
    const ex = x - p.x, ez = z - p.z, along = ex * p.dx + ez * p.dz;
    if (Math.abs(along) > 2.6) continue;
    const o = ex * p.nx + ez * p.nz;
    if (o <= p.w1 + pad && o >= -p.w2 - pad) return p;
  }
  return null;
}
/** Forget the last map's canals (a new graph world: CNY and SKAN share this module, in different frames). */
export function resetCanal() { CANAL.samples.length = 0; CANAL.grid.clear(); }
function registerCanal(S2, wOf, gap, trailSide, creek = false) {
  for (const p of S2) {
    const q = { x: p.x, z: p.z, y: p.y, nx: p.nx, nz: p.nz, dx: p.dx, dz: p.dz, w1: wOf(p, 1), w2: wOf(p, -1), trail: trailSide, creek };
    if (!creek) { q.g1 = gap(p, 1, q.w1); q.g2 = gap(p, -1, q.w2); }
    CANAL.samples.push(q);
    const k = cgKey(Math.floor(q.x / CG), Math.floor(q.z / CG)); let a = CANAL.grid.get(k); if (!a) CANAL.grid.set(k, (a = [])); a.push(q);
  }
}

// the canal's docks: OSM's pier at the park (by Sims' Store) and its canoe launches (lat, lon, the big one)
const CANAL_DOCKS = [[43.0524797, -76.3033467, true], [43.0527185, -76.3041786, false], [43.0586097, -76.2871116, false], [43.0410047, -76.3066247, false], [43.0695503, -76.2734663, false], [43.0776320, -76.2634238, false]];
/**
 * The canal's still water (user, 24 Nov — Zwift parity: "a canal reflection that stays inky"): its own dark colour,
 * and on top a Fresnel reflection of the sky — little looking down, more toward the far bank — with the trees'
 * dark band along the banks, slow ripples breaking it up, and the low sun's glint.
 */
export function canalWaterMaterial(uTime) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uHor: SKY_REFLECT.horizon, uZen: SKY_REFLECT.zenith, uSunC: SKY_REFLECT.sun, uSunD: SKY_REFLECT.sunDir, uTime });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWW; uniform vec3 uHor, uZen, uSunC, uSunD; uniform float uTime;
${HASH_GLSL}`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(cameraPosition - vWW);
          // ripples: a slow wobble in the surface's normal
          vec2 rp = vWW.xz * .9 + uTime * vec2(.25, .1);
          vec3 Nw = normalize(vec3((vn2(rp) - .5) * .06 + (vn2(rp * 2.7 + 5.) - .5) * .04, 1., (vn2(rp + 9.) - .5) * .06));
          float cosV = max(dot(V, Nw), 0.), fres = .02 + .98 * pow(1. - cosV, 5.);
          vec3 R = reflect(-V, Nw);
          // the sky it mirrors, and the dark band of the trees on the far bank (low in the reflection)
          vec3 sky = mix(uHor, uZen, smoothstep(0., .5, R.y));
          sky = mix(sky * .18, sky, smoothstep(.05, .22, R.y));
          float glint = pow(max(dot(R, uSunD), 0.), 400.) * 6. * (.5 + vn2(rp * 6.));
          outgoingLight = mix(outgoingLight, sky * .4, clamp(fres * .7, 0., .38)) + uSunC * glint;   // (inky: a dim mirror)
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'cny-canal-water-1';
  return m;
}

export function cnyLandmarkModels({ S, N, glows, plan, ground, local, L, Wa = null, Ca = null }) {
  const TRIM = '#f3f1ea';
  /** A window (dark glass, a white frame) on the wall of frame F at (a, b), facing out along n (±1 on v, or the u end). */
  const window = (F, a, b, y, w, h, onEnd = false, s = 1) => {
    const q = F.at(a, b), n = onEnd ? { x: F.u.x * s, z: F.u.z * s } : { x: F.v.x * s, z: F.v.z * s }, yaw = onEnd ? F.yawV : F.yawU;
    S.color(TRIM); S.box(q.x + n.x * .04, y - .08, q.z + n.z * .04, .1, h + .16, w + .16, yaw);
    S.color('#2c3238'); S.box(q.x + n.x * .1, y, q.z + n.z * .1, .08, h, w, yaw);
    N.color('#2c3238').set({ aGlow: [1, .78, .45] }); N.box(q.x + n.x * .14, y + .05, q.z + n.z * .14, .02, h - .1, w - .1, yaw);
  };

  // the aqueduct's trunk, for the canal's water to meet it (set by aqueduct(), built before the ribbons: cny_heroes.py
  // lists it first)
  const shared = { aq: null };
  const hsh = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  /**
   * The canal set in its cut (user, 22 Nov: "Yes! Perfect idea" — the water below the towpath): a grass bank rising
   * 0.85 m from the water's edge on either side (lower where a way runs close: the trail keeps its level); on the side
   * without the trail the berm path, gravel on the bank's top (scenery, not ridden), its benches; lily pads by the
   * edges. Every other sample (8 m): a light mesh.
   */
  // the room from the water's edge (w from the line) to the nearest way's edge on side sd, up to 14 m (a way at a
  // slant: the least over a few steps out)
  const GAP = (p, sd, w) => {
    if (!L.wayDist) { for (let d = .3; d < 9; d += .5) if (L.wayNear(p.x + p.nx * sd * (w + d), p.z + p.nz * sd * (w + d), .15)) return d; return 9; }
    let g = 14; for (const d of [0, 3, 6, 9, 12]) g = Math.min(g, d + L.wayDist(p.x + p.nx * sd * (w + d), p.z + p.nz * sd * (w + d), 12));
    return Math.max(0, Math.min(14, g));
  };
  /** Which side of the canal the trail runs on, and each sample's water out to 1.5 m from it on that side (user, 22 Nov:
   *  "the canal wider" — the water, not a wide grass slope, fills the gap to the towpath); 16 m from the line at most. */
  const canalSides = (P, hw) => {
    let near = 0; for (let i = 0; i < P.length; i += 2) { const p = P[i]; near += GAP(p, 1, hw) < 12 ? 1 : 0; near -= GAP(p, -1, hw) < 12 ? 1 : 0; }
    const ts = near >= 0 ? 1 : -1;
    // (the water's edge follows the towpath, 1.1 m off it, up to 16 m from OSM's line; the whole canal at most 19 m —
    // where the towpath is far, OSM's line is off the canal's middle and the far edge comes in)
    for (const p of P) { if (p.w != null) continue; const g = GAP(p, ts, hw), t = Math.max(hw, Math.min(16, hw + g - 1.1)); p.ws = { [ts]: t, [-ts]: Math.max(3.5, Math.min(hw, 19 - t)) }; }
    // (no jumps along it)
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i + 1 < P.length; i++) if (P[i].ws && P[i - 1].ws && P[i + 1].ws) {
      P[i].ws[ts] = Math.min(P[i].ws[ts], (P[i - 1].ws[ts] + P[i].ws[ts] * 2 + P[i + 1].ws[ts]) / 4 + .3);
      P[i].ws[-ts] = (P[i - 1].ws[-ts] + P[i].ws[-ts] * 2 + P[i + 1].ws[-ts]) / 4;
    }
    return ts;
  };
  const canalBanks = (P, wOf, trailSide) => {
    const GRAVEL = '#a99e86', H = .85, gap = GAP;
    const BANK = ['#5a6c3a', '#64733f', '#6e7745', '#5f6b3d', '#77774a', '#566638'];
    const Q = P.filter((_, i) => i % 2 === 0 || i === P.length - 1);
    for (const sd of [1, -1]) {
      const berm = sd !== trailSide;
      // each sample's cross-section: [offset from the centre line, height] outward from the water's edge
      const prof = Q.map((p) => {
        // (user, 22 Nov: the bank "should be 1m, steeper"): up 0.85 m over 1 m from the water's edge
        const w = wOf(p, sd), g = gap(p, sd, w), y = p.y, at = (o) => L.heightAt(p.x + p.nx * sd * o, p.z + p.nz * sd * o);
        if (!berm || g < 6) {
          const top = Math.min(H, Math.max(.12, (g - .2) * .6)), run = Math.min(1, Math.max(.3, g - .3));
          if (g <= 2.6) return [[w - .2, y - .05], [w + run, y + top], [w + Math.max(run + .15, g - .1), Math.min(y + top, at(w + g) + .02)]];
          // (no way near: the bank, a little top, then down to the ground)
          if (g >= 13) return [[w - .2, y - .05], [w + 1, y + top], [w + 1.6, y + top], [w + 3.2, Math.min(y + top, at(w + 3.2) - .15)]];
          // (the towpath farther than the water reaches: the bank's top runs level to it, then 1 m down to the trail)
          return [[w - .2, y - .05], [w + 1, y + top], [w + g - 1.1, y + top], [w + g - .1, Math.min(y + top, at(w + g) + .02)]];
        }
        return [[w - .2, y - .05], [w + 1, y + H], [w + 1.3, y + H + .02], [w + 3.5, y + H + .02], [w + 3.8, y + H], [w + 5.3, Math.min(y + H, at(w + 5.3) - .15)]];
      });
      for (let i = 0; i + 1 < Q.length; i++) {
        const a = Q[i], b = Q[i + 1], A = prof[i], B = prof[i + 1], m = Math.min(A.length, B.length);
        for (let k = 0; k + 1 < m; k++) {
          // (user, 23 Nov: "the green embankment … a bit jarring"): no per-strip banding — the grass's tone drifts slowly
          // along the bank (a low-frequency mix of a few muted autumn greens and straw), the water's-edge face darker and
          // muddier, the top a little drier
          const drift = (hsh(Math.floor(i / 7) * 3 + sd) * .6 + hsh(Math.floor(i / 17) * 5 + sd + 1) * .4);
          const tone = BANK[Math.floor(drift * BANK.length) % BANK.length], next = BANK[(Math.floor(drift * BANK.length) + 1) % BANK.length];
          const col = new THREE.Color(tone).lerp(new THREE.Color(next), (drift * BANK.length) % 1);
          if (k === 0) col.lerp(new THREE.Color('#4a4d33'), .55);
          else if (k === 1) col.lerp(new THREE.Color('#8f8a5c'), .12 + hsh(i * 3 + sd) * .1);
          S.color(berm && k === 2 && A.length > 4 && B.length > 4 ? GRAVEL : col);
          const pt = (p, o, y) => V(p.x + p.nx * sd * o, y, p.z + p.nz * sd * o);
          faceOut(S, [pt(a, A[k][0], A[k][1]), pt(b, B[k][0], B[k][1]), pt(b, B[k + 1][0], B[k + 1][1]), pt(a, A[k + 1][0], A[k + 1][1])], up0);
        }
        // tufts of longer grass and the odd straw-coloured clump along the bank's top edge (breaks its clean line)
        if (A.length > 2 && hsh(i * 11 + sd * 3) < .55) {
          const o = A[1][0] + (hsh(i * 5 + sd) - .5) * .5, y = A[1][1], cx = a.x + a.nx * sd * o, cz = a.z + a.nz * sd * o;
          const tc = hsh(i * 7 + sd) < .3 ? '#9a9260' : hsh(i * 9 + sd) < .5 ? '#6f7a44' : '#5e6c3a';
          S.color(tc);
          for (let q = 0; q < 5; q++) {
            const an = q * 1.3 + hsh(i + q) * 2, len = .35 + hsh(i * 3 + q) * .4, bx = cx + Math.cos(an) * .12, bz = cz + Math.sin(an) * .12;
            S.triangle(V(bx - .04, y - .02, bz), V(bx + .04, y - .02, bz), V(bx + Math.cos(an) * .18, y + len, bz + Math.sin(an) * .18));
            S.triangle(V(bx + .04, y - .02, bz), V(bx - .04, y - .02, bz), V(bx + Math.cos(an) * .18, y + len, bz + Math.sin(an) * .18));
          }
        }
        // a bench on the berm every ~300 m, facing the water
        if (berm && A.length > 4 && B.length > 4 && hsh(i * 13 + 5) < .028) {
          const p = a, o = wOf(p, sd) + 2.4, y = p.y + H + .02, cx = p.x + p.nx * sd * o, cz = p.z + p.nz * sd * o, yaw = Math.atan2(p.dx, p.dz);
          S.color('#6b5137'); S.box(cx, y + .42, cz, .42, .06, 1.6, yaw); S.box(cx + p.nx * sd * .2, y + .48, cz + p.nz * sd * .2, .06, .45, 1.6, yaw);
          S.color('#3f3a34'); for (const e of [-.65, .65]) S.box(cx + p.dx * e, y, cz + p.dz * e, .4, .42, .08, yaw);
        }
      }
    }
    // lily pads: clusters by the edges, every 50 m or so
    for (let i = 0; i < P.length; i += 3) {
      if (hsh(i * 7 + 1) > .22) continue;
      const p = P[i], sd = hsh(i) < .5 ? 1 : -1, w = wOf(p, sd), n = 4 + Math.floor(hsh(i + 9) * 6);
      S.color(hsh(i + 2) < .5 ? '#34482a' : '#3b5030');
      for (let k = 0; k < n; k++) {
        const o = w - .6 - hsh(i * 3 + k) * 2.2, al = (hsh(i * 5 + k) - .5) * 5;
        S.cylinder(p.x + p.nx * sd * o + p.dx * al, p.y + .01, p.z + p.nz * sd * o + p.dz * al, .16 + hsh(k + i) * .16, .015, 9);   // (smaller, rounder: the big hexagons read as slabs)
      }
      if (hsh(i + 4) < .3) { S.color('#efe6d8'); S.cylinder(p.x + p.nx * sd * (w - 1.2), p.y + .03, p.z + p.nz * sd * (w - 1.2), .09, .08, 5, .03); }   // a flower
    }
  };
  const nearestOn = (l, S2) => { const q = local(l.center[0], l.center[1]); let d = 1e9; for (const p of S2) d = Math.min(d, Math.hypot(p.x - q.x, p.z - q.z)); return d; };
  const mooredBoat = (l, S2, wOf) => {
    const q = local(l.center[0], l.center[1]);
    let bi = -1, bd = 30; S2.forEach((p, i) => { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) return false;
    const p0 = S2[bi], sd = ((q.x - p0.x) * p0.nx + (q.z - p0.z) * p0.nz) >= 0 ? 1 : -1;
    // just past the dock along the canal (the dock 3 m wide, the hull 18 m), the way with more channel
    const at = (i) => S2[Math.max(0, Math.min(S2.length - 1, i))], HALF = 9, BEAM = 2.1, CLEAR = 1.4;
    const room = (c) => { let w = 1e9; for (let k = -3; k <= 3; k++) w = Math.min(w, wOf(at(c + k), sd)); return w; };
    const ci = [3, -3, 4, -4, 2, -2].map((k) => bi + k).filter((i) => i > 2 && i < S2.length - 3).sort((a, b) => room(b) - room(a))[0] ?? bi;
    const p = S2[ci], a = S2[Math.max(0, ci - 2)], b = S2[Math.min(S2.length - 1, ci + 2)];
    const ul = Math.hypot(b.x - a.x, b.z - a.z) || 1, u = { x: (b.x - a.x) / ul, z: (b.z - a.z) / ul };
    // across: against the bank on the dock's side, the far side kept in the water too (each sample along the hull)
    let o = 1e9, lo = -1e9;
    for (let k = -3; k <= 3; k++) { const s = at(ci + k); o = Math.min(o, wOf(s, sd) - BEAM - CLEAR); lo = Math.max(lo, -wOf(s, -sd) + BEAM + CLEAR); }
    if (o < lo) o = (o + lo) / 2;
    const c = { x: p.x + p.nx * sd * o, z: p.z + p.nz * sd * o }, g = p.y - .32;   // (the waterline .4 m up the hull: a little under the deck's red band)
    const F = makeFrame(c, u, undefined, HALF, BEAM);
    const hull = [F.at(-9, -1.6), F.at(7.5, -2.1), F.at(9, 0), F.at(7.5, 2.1), F.at(-9, 1.6)];
    S.color('#2f4a3a'); block(S, hull, g - .5, g + .7);
    S.color('#b33a2e'); prism(S, scaleRing(hull, 1.01, c), g + .45, g + .7);
    S.color(TRIM); block(S, F.rect(-6.5, 4.5, -1.5, 1.5), g + .7, g + 2.6);
    S.color('#2c3238'); for (let k = 0; k < 6; k++) for (const s of [-1, 1]) { const w = F.at(-5.8 + k * 1.8, s * 1.52); S.box(w.x, g + 1.5, w.z, .06, .7, 1.1, F.yawU); }
    S.color('#6b2f28'); block(S, F.rect(-6.8, 4.8, -1.75, 1.75), g + 2.6, g + 2.8);
    // two mooring lines to the bank
    S.color('#d8cfb8'); for (const e of [-7, 6]) { const h = F.at(e, sd * 0), bk = { x: h.x + p.nx * sd * (wOf(p, sd) - o + .6), z: h.z + p.nz * sd * (wOf(p, sd) - o + .6) }; S.beam(V(h.x + p.nx * sd * BEAM, g + .7, h.z + p.nz * sd * BEAM), V(bk.x, p.y + .75, bk.z), .03, .03); }
    return true;
  };
  const up0 = V(0, 1, 0);
  return {
    // the canal's water: a ribbon along OSM's line, just over the ground across its width (the land cover's 6 m cells
    // gave it stepped edges and the ground's grid hid it where the grid stands higher)
    canal(l) {
      const P = l.path.map(([a, o]) => local(a, o)), hw = l.creek ? (l.widthM || 4) / 2 : 7.5;   // (the canal: 15 m, wider toward the towpath; the real one 21 m)
      // resample every 4 m
      const pts = [];
      for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 4)); for (let k = 0; k < n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); }
      pts.push(P[P.length - 1]);
      const S2 = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / d, nz = (b.x - a.x) / d;
        const y = Math.max(L.heightAt(p.x, p.z), L.heightAt(p.x + nx * hw, p.z + nz * hw), L.heightAt(p.x - nx * hw, p.z - nz * hw)) + .12;
        return { x: p.x, z: p.z, nx, nz, dx: nz, dz: -nx, y };
      });
      // a gentle smoothing of the level along it (no steps)
      for (let pass = 0; pass < 3; pass++) for (let i = 1; i + 1 < S2.length; i++) S2[i].y = Math.max(S2[i].y - .3, (S2[i - 1].y + S2[i].y * 2 + S2[i + 1].y) / 4);
      // at the aqueduct (user, 22 Nov: "the aqueduct water is not attached on both sides"): the ribbon runs on into the
      // trunk's end at the trunk's water level and width, and keeps that level for 25 m before it eases back to the
      // ground's; where that holds it over the ground, earth banks down to it
      for (const W of [0, 1].map((k) => shared.aq?.ends[k])) {
        if (!W) continue;
        const iEnd = Math.hypot(S2[0].x - W.x, S2[0].z - W.z) < Math.hypot(S2[S2.length - 1].x - W.x, S2[S2.length - 1].z - W.z) ? 0 : S2.length - 1;
        const E = S2[iEnd]; if (Math.hypot(E.x - W.x, E.z - W.z) > 30) continue;
        const pt = { x: W.x, z: W.z, nx: E.nx, nz: E.nz, dx: E.dx, dz: E.dz, y: shared.aq.y, w: shared.aq.w / 2 };
        if (iEnd === 0) S2.unshift(pt); else S2.push(pt);
        let acc = 0;
        const order = iEnd === 0 ? S2.map((_, i) => i) : S2.map((_, i) => S2.length - 1 - i);
        for (let k = 0; k < order.length; k++) {
          const q = S2[order[k]];
          if (k) { const pq = S2[order[k - 1]]; acc += Math.hypot(q.x - pq.x, q.z - pq.z); }
          const f = acc < 25 ? 0 : acc > 70 ? 1 : (acc - 25) / 45;
          q.y = shared.aq.y + (q.y - shared.aq.y) * f * f * (3 - 2 * f);
          if (acc < 10) q.w = shared.aq.w / 2 + (hw - shared.aq.w / 2) * acc / 10;
        }
      }
      // the water: a creek blue-brown; the canal still and green with duckweed (user, 22 Nov: "green duckweed - no
      // reflections, keep render cost low"): flat quads in a few greens, patchy
      // (user, 22 Nov: "too green. A murky blue green black would appear better"): dark murky greens, a little scum
      // (user, 23 Nov: "Water in the canal should be an inky blue / black. The green was too much")
      const MURK = ['#121c2e', '#142033', '#101827', '#162236', '#131d30'];
      const up = V(0, 1, 0), wOf = (p, sd = 1) => p.ws?.[sd] ?? p.w ?? hw;
      const trailSide = l.creek ? 1 : canalSides(S2, hw);
      // the level over the water's real width (widened toward the towpath, where the ground rises to the trail's fill:
      // it hid the near part of the water), smoothed again; the aqueduct's held level stays
      if (!l.creek) {
        for (const p of S2) if (p.ws) for (const sd of [1, -1]) { const o = wOf(p, sd) - .4; p.y = Math.max(p.y, L.heightAt(p.x + p.nx * sd * o, p.z + p.nz * sd * o) + .08); }
        for (let pass = 0; pass < 2; pass++) for (let i = 1; i + 1 < S2.length; i++) if (S2[i].ws) S2[i].y = Math.max(S2[i].y - .2, (S2[i - 1].y + S2[i].y * 2 + S2[i + 1].y) / 4);
        // the water keeps its towpath's height below it (traditionally about a metre; tools/towpath_lift.mjs raised the
        // towpath where the ground had it under the canal): the trail's fill no longer lifts the water to the trail
        if (L.pathY) for (const p of S2) { if (!p.ws) continue; const o = wOf(p, trailSide) + 4, ty = L.pathY(p.x + p.nx * trailSide * o, p.z + p.nz * trailSide * o, 14); if (ty != null) p.y = Math.min(p.y, ty - .9); }
      }
      // a creek's water: the world's water material when there is one (its ripples and glints: the "water" effect)
      const WB = l.creek && Wa ? Wa : l.creek ? S : (Ca || S);   // (the canal: its own still inky water, canalWaterMaterial)
      if (l.creek) WB.color('#4b6f6c');
      for (let i = 0; i + 1 < S2.length; i++) {
        const a = S2[i], b = S2[i + 1], wa = wOf(a, 1), wb = wOf(b, 1), va = wOf(a, -1), vb = wOf(b, -1);
        // (no scum patches: user, 23 Nov — the lighter-green slabs read as flat boards floating on the canal)
        if (!l.creek) WB.color(MURK[((i * 7919) ^ (i >> 2) * 31) % MURK.length]);
        faceOut(WB, [V(a.x + a.nx * wa, a.y, a.z + a.nz * wa), V(b.x + b.nx * wb, b.y, b.z + b.nz * wb), V(b.x - b.nx * vb, b.y, b.z - b.nz * vb), V(a.x - a.nx * va, a.y, a.z - a.nz * va)], up);
      }
      // open dark water along the edges, where the duckweed thins
      if (!l.creek) {
        S.color('#0a0f19');
        for (let i = 0; i + 1 < S2.length; i++) {
          const a = S2[i], b = S2[i + 1];
          for (const sd of [1, -1]) {
            const wa = wOf(a, sd), wb = wOf(b, sd);
            const ea = Math.min(1, wa * .2), eb = Math.min(1, wb * .2), P = (p, o) => V(p.x + p.nx * sd * o, p.y + .015, p.z + p.nz * sd * o);
            faceOut(S, [P(a, wa - ea), P(b, wb - eb), P(b, wb), P(a, wa)], up);
          }
        }
        canalBanks(S2, wOf, trailSide);
        registerCanal(S2, wOf, GAP, trailSide);   // (the channel, for the planters)
        (shared.canals ||= []).push([S2, wOf]);
        if (shared.boats) shared.boats = shared.boats.filter((b) => !mooredBoat(b, S2, wOf));   // (the tour boat, on its canal)
        // the docks (OSM's pier and canoe launches on the canal — Camillus Erie Canal Park by Sims' Store, the aqueduct,
        // Munro Park and the launches east): a plank dock out from the bank, posts, a ladder, a bench at the root;
        // people fishing off them (graph-life's locals; user, 23 Nov: "locations where people should be fishing from")
        for (const [la, lo, big] of CANAL_DOCKS) {
          const q = local(la, lo); let best = null, bd = 25;
          for (const p of S2) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d < bd) { bd = d; best = p; } }
          if (!best) continue;
          const sd = ((q.x - best.x) * best.nx + (q.z - best.z) * best.nz) >= 0 ? 1 : -1, w = wOf(best, sd), n = { x: best.nx * sd, z: best.nz * sd }, t = { x: best.dx, z: best.dz };
          const L0 = big ? 4.5 : 3, W0 = big ? 3 : 2, yD = best.y + .45, yaw = Math.atan2(-n.x, -n.z);
          const at = (a, b) => ({ x: best.x + n.x * (w + .6 - a) + t.x * b, z: best.z + n.z * (w + .6 - a) + t.z * b });   // a: out from the bank over the water
          const c = at(L0 / 2, 0);
          S.color('#9b8668'); S.box(c.x, yD - .18, c.z, W0, .18, L0 + .6, yaw);
          S.color('#7f6c55'); for (let a = -.1; a < L0; a += .55) { const p = at(a, 0); S.box(p.x, yD + .002, p.z, W0 - .05, .01, .04, yaw); }
          S.color('#5d5346'); for (const a of [.2, L0 - .2]) for (const b of [-W0 / 2 + .1, W0 / 2 - .1]) { const p = at(a, b); S.cylinder(p.x, best.y - 1.6, p.z, .1, 2.1, 6); }
          { const p = at(L0 - .1, W0 / 2 - .3); S.color('#9aa0a6'); for (const b of [-.2, .2]) { const r = at(L0 - .1, W0 / 2 - .3 + b); S.box(r.x, best.y - .6, r.z, .04, 1.25, .04, yaw); } for (let h = 0; h < 3; h++) S.box(p.x, best.y - .4 + h * .3, p.z, .44, .03, .03, yaw); }
          if (big) { const p = at(-.9, 0); S.color('#6b5137'); S.box(p.x, yD + .38, p.z, 1.6, .06, .45, yaw); }
          if (L.lifeSpots) for (let k = 0; k < (big ? 2 : 1); k++) { const p = at(L0 - .55, (k - (big ? .5 : 0)) * 1.1); L.lifeSpots.push({ x: p.x, z: p.z, y: yD, yaw: Math.atan2(-n.x, -n.z), kind: 'fish' }); }
        }
      }
      // white water where a creek drops (a dam, a falls, a riffle over a ledge: Marcellus Falls, Skaneateles Falls):
      // a pale cascade face down the step and a churned patch at its foot
      let lastFoam = -99;
      if (l.creek) for (let i = 0; i + 1 < S2.length; i++) {
        const a = S2[i], b = S2[i + 1], drop = a.y - b.y;
        if (Math.abs(drop) < .9 || i - lastFoam < 4) continue;   // (a real step, not the stepped bed of a steep run)
        lastFoam = i;
        const [hi, lo] = drop > 0 ? [a, b] : [b, a], wh = wOf(hi, 1) + .3, wl = wOf(lo, 1) + .3, vh = wOf(hi, -1) + .3, vl = wOf(lo, -1) + .3;
        S.color('#e6eeeb');
        faceOut(S, [V(hi.x + hi.nx * wh, hi.y + .03, hi.z + hi.nz * wh), V(lo.x + lo.nx * wl, lo.y + .05, lo.z + lo.nz * wl), V(lo.x - lo.nx * vl, lo.y + .05, lo.z - lo.nz * vl), V(hi.x - hi.nx * vh, hi.y + .03, hi.z - hi.nz * vh)], up);
        // the foam at its foot: a few metres on down the creek, thinning
        const k = S2.indexOf(lo), dir = lo === b ? 1 : -1;
        for (let q = 0; q < 3; q++) {
          const p = S2[k + dir * q], p2 = S2[k + dir * (q + 1)]; if (!p || !p2) break;
          S.color(q === 0 ? '#d9e4e1' : q === 1 ? '#b8cbc8' : '#93aba8');
          const w1 = wOf(p, 1) * (.9 - q * .2), w2 = wOf(p2, 1) * (.9 - q * .2), v1 = wOf(p, -1) * (.9 - q * .2), v2 = wOf(p2, -1) * (.9 - q * .2);
          faceOut(S, [V(p.x + p.nx * w1, p.y + .04, p.z + p.nz * w1), V(p2.x + p2.nx * w2, p2.y + .04, p2.z + p2.nz * w2), V(p2.x - p2.nx * v2, p2.y + .04, p2.z - p2.nz * v2), V(p.x - p.nx * v1, p.y + .04, p.z - p.nz * v1)], up);
        }
      }
      // a creek's channel too, for the planters: no tree or house in its water (user, 23 Nov: "trees spawning in canal
      // water is still an issue" — they stood in Nine Mile Creek, drawn as the canal is); no canal scrub along it
      if (l.creek) registerCanal(S2, wOf, null, 0, true);
      // the banks where the water stands over the ground (its level held at the aqueduct)
      S.color('#7b7255');
      for (let i = 0; i + 1 < S2.length; i++) {
        const a = S2[i], b = S2[i + 1];
        for (const sd of [1, -1]) {
          const wa = wOf(a, sd) + .3, wb = wOf(b, sd) + .3;
          const pa = { x: a.x + a.nx * wa * sd, z: a.z + a.nz * wa * sd }, pb = { x: b.x + b.nx * wb * sd, z: b.z + b.nz * wb * sd };
          const ga = L.heightAt(pa.x, pa.z), gb = L.heightAt(pb.x, pb.z);
          if (a.y - ga < .25 && b.y - gb < .25) continue;
          const out = V(a.nx * sd, 0, a.nz * sd), sp = 1.6;   // (a sloped bank, 1.6 m out at its foot)
          faceOut(S, [V(pa.x, a.y + .05, pa.z), V(pb.x, b.y + .05, pb.z), V(pb.x + b.nx * sd * sp, Math.min(gb, b.y) - .4, pb.z + b.nz * sd * sp), V(pa.x + a.nx * sd * sp, Math.min(ga, a.y) - .4, pa.z + a.nz * sd * sp)], out);
          faceOut(S, [V(pa.x - a.nx * sd * .3, a.y + .05, pa.z - a.nz * sd * .3), V(pb.x - b.nx * sd * .3, b.y + .05, pb.z - b.nz * sd * .3), V(pb.x, b.y + .05, pb.z), V(pa.x, a.y + .05, pa.z)], up);
        }
      }
    },

    aqueduct(l) {
      const ring = orient(l.ring.map(([a, o]) => local(a, o))), F0 = frameOf(ring);
      // the canal runs along the aqueduct: its frame's long axis along the canal's way
      const cp = l.path.map(([a, o]) => local(a, o)), cu = { x: cp[1].x - cp[0].x, z: cp[1].z - cp[0].z }, cl = Math.hypot(cu.x, cu.z) || 1;
      const u = { x: cu.x / cl, z: cu.z / cl }; let F = makeFrame(F0.c, u, undefined, Math.max(22, F0.hl), Math.max(7, F0.hw));
      const hl = F.hl, hw = F.hw;
      // the canal's water: the banks' height at either end, less half a metre
      const bank = Math.min(L.heightAt(F.at(-hl - 6, 0).x, F.at(-hl - 6, 0).z), L.heightAt(F.at(hl + 6, 0).x, F.at(hl + 6, 0).z));
      const bed = (a) => Math.min(L.heightAt(F.at(a, -hw).x, F.at(a, -hw).z), L.heightAt(F.at(a, hw).x, F.at(a, hw).z)) - .5;
      // the creek's bed under the middle, and the arches fitted between it and the trunk: a half circle (30 ft spans,
      // radius 15 ft) where there's room, flatter (segmental, the same span) where the ground's grid is shallower
      let bedMin = Infinity; for (let a = -hl * .8; a <= hl * .8; a += 2) bedMin = Math.min(bedMin, bed(a));
      // the towpath is the trail's own deck where the world draws one (the Erie Canalway Trail): the water just under it
      const tow = L.deckNear?.(F.c.x, F.c.z, Math.max(hl, 30));
      const towSide = tow ? ((tow.x - F.c.x) * F.v.x + (tow.z - F.c.z) * F.v.z < 0 ? -1 : 1) : -1;
      const yW = tow ? tow.y - .45 : Math.max(bank - .5, bedMin + 5.5), deck = yW - 1.9, R = 4.57;
      const spring = bedMin + .9, rise = Math.max(1.2, Math.min(R, deck - .7 - .6 - spring));
      const rr = (R * R + rise * rise) / (2 * rise), cy = spring + rise - rr;   // (the arch's circle: radius rr, centre height cy)
      const yS = spring;
      const STONE = '#a59c8a', STONE2 = '#8f8778';
      const span = 2 * R, pier = (2 * hl - 4 * span) / 5;   // (two abutments and three piers share what's left)
      let a = -hl;
      for (let k = 0; k <= 4; k++) {
        // a pier (or an abutment at either end) across the full width, down to the creek bed
        const a0 = a, a1 = a + pier, g = Math.min(bed(a0), bed(a1), yS - .5);
        S.color(STONE); block(S, F.rect(a0, a1, -hw, hw), g - 1, deck - .7);
        S.color(STONE2); block(S, F.rect(a0 - .25, a1 + .25, -hw - .25, hw + .25), g - 1, g + .8);   // (the footing)
        a = a1;
        if (k === 4) break;
        // the arch: its stone over the opening, the underside a half circle (in slices), full width
        const n = 10;
        for (let j = 0; j < n; j++) {
          const s0 = a + span * j / n, s1 = a + span * (j + 1) / n, sm = (s0 + s1) / 2 - (a + R);
          const under = Math.max(yS, cy + Math.sqrt(Math.max(0, rr * rr - sm * sm)));
          S.color(j % 2 ? STONE : STONE2); block(S, F.rect(s0, s1, -hw, hw), under, deck - .7);
        }
        a += span;
      }
      // the stone deck, a coping course along both faces
      S.color(STONE2); block(S, F.rect(-hl, hl, -hw - .2, hw + .2), deck - .7, deck);
      // the timber trunk: its floor, its two walls, the water in it; the towpath (12 ft) on the trail's side (−v here)
      if (towSide > 0) F = F.flipped();
      const tw = 3.7, t0 = -hw + tw, t1 = hw - .4;
      S.color('#6b5137'); block(S, F.rect(-hl - .5, hl + .5, t0 - .35, t1 + .35), deck, deck + .3);
      for (const b of [t0 - .35, t1]) { S.color('#7a5c3e'); block(S, F.rect(-hl - .5, hl + .5, b, b + .35), deck + .3, yW + .55); }
      // the posts along the trunk's walls (the restored timber frame)
      S.color('#5d4630'); for (let x = -hl; x <= hl; x += 2.4) for (const b of [t0 - .45, t1 + .35]) S.box(F.at(x, b).x, deck, F.at(x, b).z, .3, yW + .75 - deck, .3, F.yawU);
      S.color('#131b25'); prism(S, F.rect(-hl - .5, hl + .5, t0, t1), yW - .02, yW); cap(S, F.rect(-hl - .5, hl + .5, t0, t1), yW);   // (murky, as the canal)
      { const m = (t0 + t1) / 2; shared.aq = { ends: [F.at(-hl - .5, m), F.at(hl + .5, m)], y: yW, w: t1 - t0 }; }
      // the towpath: gravel on the stone (where the world draws no trail deck), a wooden rail on its outer edge
      if (!tow) { S.color('#b9ad94'); block(S, F.rect(-hl - 1, hl + 1, -hw, t0 - .35), deck, deck + .35); }
      S.color('#6b5137');
      for (let x = -hl; x <= hl + .01; x += 2.5) { const q = F.at(x, -hw + .15); S.box(q.x, deck + .35, q.z, .14, 1.05, .14, F.yawU); }
      for (const y of [deck + 1.3, deck + .85]) { const p0 = F.at(-hl, -hw + .15), p1 = F.at(hl, -hw + .15); S.beam(V(p0.x, y, p0.z), V(p1.x, y, p1.z), .1, .14); }
    },

    canalstore(l) {
      let { F, g } = plan(l, 9, 7);
      if (l.face) { const d = local(l.face[0], l.face[1]); if ((d.x - F.c.x) * F.v.x + (d.z - F.c.z) * F.v.z < 0) F = F.flipped(); }   // (the porch toward the canal)
      const hl = F.hl * .95, hw = F.hw * .92, yE = g + 6.4, yR = g + 10.2;
      const WALL = '#e6dcc4', GREEN = '#3e5a46';
      S.color('#8d8577'); block(S, F.rect(-hl, hl, -hw, hw), g - 1, g + .5);   // (stone foundation)
      S.color(WALL); prism(S, F.rect(-hl, hl, -hw, hw), g + .5, yE);
      // clapboard: thin shadow lines every 0.3 m
      S.color('#d2c7ad'); for (let y = g + .8; y < yE - .2; y += .45) prism(S, F.rect(-hl - .02, hl + .02, -hw - .02, hw + .02), y, y + .05);
      S.color('#4a4f4a'); gable(S, F, -hl - .4, hl + .4, hw, yE, yR, { over: .5, endColor: WALL });
      // the front: the long side toward the canal (the +v side), a porch the length of it
      for (const [s, n] of [[1, 3], [-1, 3]]) for (let k = 0; k < n; k++) {
        const a = -hl + (k + .5) * 2 * hl / n;
        if (!(s > 0 && k === 1)) window(F, a, s * hw, g + 1.4, 1, 1.6, false, s);
        window(F, a, s * hw, g + 4.1, .9, 1.4, false, s);
      }
      for (const s of [-1, 1]) window(F, s * hl, 0, g + 7.2, .8, 1.1, true, s);   // (the half storey: a window in each gable)
      S.color('#5a3d2b'); { const q = F.at(0, hw); S.box(q.x + F.v.x * .1, g + .5, q.z + F.v.z * .1, .12, 2.3, 1.3, F.yawU); }   // (the door)
      S.color(GREEN); { const q = F.at(0, hw); S.box(q.x + F.v.x * .15, g + 3.05, q.z + F.v.z * .15, .1, .7, hl * 1.3, F.yawU); }   // (the sign board)
      // the porch: a deck, posts, a shed roof
      S.color('#8a7a62'); block(S, F.rect(-hl, hl, hw, hw + 2.6), g, g + .45);
      S.color(TRIM); for (let k = 0; k <= 4; k++) { const q = F.at(-hl + .2 + k * (2 * hl - .4) / 4, hw + 2.4); S.box(q.x, g + .45, q.z, .16, 2.65, .16, F.yawU); }
      S.color('#4a4f4a'); { const P0 = (a, b, y) => V(F.at(a, b).x, y, F.at(a, b).z); S.quad(P0(-hl - .2, hw, g + 3.4), P0(hl + .2, hw, g + 3.4), P0(hl + .2, hw + 2.9, g + 3.0), P0(-hl - .2, hw + 2.9, g + 3.0)); }
      S.color('#7a5c45'); { const q = F.at(hl * .4, 0); S.box(q.x, yR - 1.4, q.z, .7, 2.6, .7, F.yawU); }   // (a chimney)
      glows.push({ x: F.at(0, hw + 2.2).x, y: g + 3.1, z: F.at(0, hw + 2.2).z, size: 4, color: '#ffd9a0' });
    },

    enginehouse(l) {
      const { F, g } = plan(l, 6, 4);
      const hl = F.hl * .95, hw = F.hw * .92, yE = g + 4.8, yR = g + 7;
      S.color('#8e4f3c'); block(S, F.rect(-hl, hl, -hw, hw), g - 1, yE);
      S.color('#43484a'); gable(S, F, -hl - .3, hl + .3, hw, yE, yR, { over: .35, endColor: '#8e4f3c' });
      for (const s of [-1, 1]) for (let k = 0; k < 2; k++) window(F, -hl + (k + .5) * hl, s * hw, g + 1.6, 1.2, 2.2, false, s);
      const q = F.at(-hl - 1.4, 0); S.color('#7d4535'); S.cylinder(q.x, g - 1, q.z, 1, 15, 10, .7);   // (the stack)
      S.color('#5d3428'); S.cylinder(q.x, g + 13.4, q.z, .85, .6, 10, .85);
    },

    octagon(l) {
      const ring = orient(l.ring.map(([a, o]) => local(a, o))), c = centroid(ring), g = ground(ring);
      const r8 = ring.length === 8 ? ring : Array.from({ length: 8 }, (_, k) => ({ x: c.x + Math.cos(k * Math.PI / 4) * 8.5, z: c.z + Math.sin(k * Math.PI / 4) * 8.5 }));
      const yE = g + 7.6, WALL = '#ddd2bb';
      S.color('#8d8577'); block(S, scaleRing(r8, 1.02, c), g - 1, g + .6);
      S.color(WALL); prism(S, r8, g + .6, yE);
      S.color(TRIM); prism(S, scaleRing(r8, 1.015, c), g + 4, g + 4.2); prism(S, scaleRing(r8, 1.02, c), yE - .35, yE);   // (the floor band, the frieze)
      // a window on each face, each floor
      for (let k = 0; k < 8; k++) {
        const p = r8[k], q = r8[(k + 1) % 8], m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }, len = Math.hypot(q.x - p.x, q.z - p.z);
        const u = { x: (q.x - p.x) / len, z: (q.z - p.z) / len }, n = { x: m.x - c.x, z: m.z - c.z }, nl = Math.hypot(n.x, n.z);
        const Ff = makeFrame(m, u, { x: n.x / nl, z: n.z / nl });
        for (const y of [g + 1.5, g + 4.9]) window(Ff, 0, 0, y, 1, 1.75, false, 1);
      }
      // the low eight-sided roof, the cupola with its windows, its cap
      const R = Math.hypot(r8[0].x - c.x, r8[0].z - c.z), rot = Math.atan2(r8[0].z - c.z, r8[0].x - c.x);
      const oct = (rr, y0, y1) => { const rg = Array.from({ length: 8 }, (_, k) => ({ x: c.x + Math.cos(rot + k * Math.PI / 4) * rr, z: c.z + Math.sin(rot + k * Math.PI / 4) * rr })); return rg; };
      S.color('#5b5f5c');
      const top = oct(R * .3), eave = oct(R * 1.08);
      for (let k = 0; k < 8; k++) { const a = eave[k], b = eave[(k + 1) % 8], p = top[k], q = top[(k + 1) % 8]; S.quad(V(a.x, yE - .25, a.z), V(b.x, yE - .25, b.z), V(q.x, yE + 2.4, q.z), V(p.x, yE + 2.4, p.z)); }
      cap(S, orient(top), yE + 2.4);   // (the roof's flat top under the cupola — QC, 25 Nov: a ring of open roof showed round it)
      const cup = oct(R * .26);
      S.color(WALL); prism(S, cup, yE + 2.4, yE + 4.2);
      S.color('#2c3238'); prism(S, scaleRing(cup, 1.01, c), yE + 2.8, yE + 3.8);
      S.color('#5b5f5c'); lathe(S, c.x, yE + 4.2, c.z, [[R * .32, 0], [R * .05, 1.3]], 8);
      // a porch on the face toward the street (the south: West Genesee Street)
      const f = r8.reduce((best, p, k) => { const q = r8[(k + 1) % 8], m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }; return !best || m.z > best.m.z ? { m, p, q } : best; }, null);
      const fu = { x: f.q.x - f.p.x, z: f.q.z - f.p.z }, fl = Math.hypot(fu.x, fu.z), fn = { x: f.m.x - c.x, z: f.m.z - c.z }, fnl = Math.hypot(fn.x, fn.z);
      const Fp = makeFrame(f.m, { x: fu.x / fl, z: fu.z / fl }, { x: fn.x / fnl, z: fn.z / fnl });
      S.color('#8a7a62'); block(S, Fp.rect(-fl / 2 - .5, fl / 2 + .5, 0, 2.4), g, g + .5);
      S.color(TRIM); for (const a of [-fl / 2 - .3, 0, fl / 2 + .3]) { const q = Fp.at(a, 2.2); S.cylinder(q.x, g + .5, q.z, .12, 2.8, 8); }
      S.color('#5b5f5c'); block(S, Fp.rect(-fl / 2 - .7, fl / 2 + .7, -.1, 2.7), g + 3.3, g + 3.5);
    },

    // the tour boat at the park's dock: moored in the canal's water (user, 23 Nov: "ensure the riverboat on the canal
    // doesn't clip into land") — set on the canal's samples once its ribbon is built (before or after the canals, whichever
    // are built first): along the channel, against the dock's bank just past the dock, its hull inside the water's edge all along
    canalboat(l) {
      const best = (shared.canals || []).map((C) => [nearestOn(l, C[0]), C]).sort((a, b) => a[0] - b[0])[0];
      if (!best || !mooredBoat(l, best[1][0], best[1][1])) (shared.boats ||= []).push(l);
    },

    railbridge(l) {
      const p0 = local(l.path[0][0], l.path[0][1]), p1 = local(l.path[l.path.length - 1][0], l.path[l.path.length - 1][1]);
      const c = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 }, len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 20;
      const u = { x: (p1.x - p0.x) / len, z: (p1.z - p0.z) / len }, hl = Math.max(11, len / 2 + 2), F = makeFrame(c, u, undefined, hl, 2.6);
      const road = L.heightAt(c.x, c.z), top = Math.max(road + 6.6, L.heightAt(F.at(-hl, 0).x, F.at(-hl, 0).z), L.heightAt(F.at(hl, 0).x, F.at(hl, 0).z));
      const STEEL = '#2e3236';
      // the stone abutments at either end, down to the ground
      for (const s of [-1, 1]) { const a0 = s * (hl - 3.2), a1 = s * (hl + 1.5), g = Math.min(L.heightAt(F.at(a0, 0).x, F.at(a0, 0).z), road) - 1; S.color('#9d9586'); block(S, F.rect(Math.min(a0, a1), Math.max(a0, a1), -3.4, 3.4), g, top - 1.9); }
      // two plate girders (1.8 m deep) with stiffeners, the deck of ties, the rails
      for (const b of [-2.2, 2.2]) {
        S.color(STEEL); block(S, F.rect(-hl, hl, b - .2, b + .2), top - 1.9, top - .1);
        S.color('#25292c'); for (let a = -hl + 1; a < hl; a += 1.6) { const q = F.at(a, b + Math.sign(b) * .22); S.box(q.x, top - 1.9, q.z, .06, 1.8, .14, F.yawU); }
      }
      S.color('#4a3a2c'); for (let a = -hl; a <= hl; a += .6) { const q = F.at(a, 0); S.box(q.x, top - .1, q.z, 2.6, .18, .22, F.yawU); }
      S.color('#6b6e70'); for (const b of [-.72, .72]) { const a0 = F.at(-hl, b), a1 = F.at(hl, b); S.beam(V(a0.x, top + .12, a0.z), V(a1.x, top + .12, a1.z), .08, .14); }
      // the approaches (user, 22 Nov: "a railroad bridge with nothing attached"; chose short approaches): the line runs
      // on from each abutment along the bridge's axis — l.approachM [south-west, north-east] — on a grassed
      // embankment with a ballast top, ties and rails, easing down at a railway's ~1.2 % to sit just above the
      // ground, and ending in the trees (graph-city plants a stand round each end; nothing else stands on it)
      const [A0, A1] = l.approachM || [150, 60];
      const railY = (a) => { const q = F.at(a, 0), g = L.heightAt(q.x, q.z); return Math.min(top, Math.max(g + .9, top - .012 * (Math.abs(a) - hl))); };
      const TOP = 2.4, SLOPE = 1.5;
      for (const [s, A] of [[-1, A0], [1, A1]]) {
        if (!(A > 4)) continue;
        const STEP = 4;
        for (let d = hl - 1; d < hl + A; d += STEP) {
          const a0 = s * d, a1 = s * Math.min(hl + A, d + STEP);
          const y0 = railY(a0), y1 = railY(a1), fade = Math.max(0, (d - (hl + A - 25)) / 25);   // the last 25 m sink into the ground
          const yb0 = y0 - .35 - fade * .6, yb1 = y1 - .35 - fade * .6;
          for (const side of [-1, 1]) {
            // the bank: from the ballast shoulder down at 1 : 1.5 to the ground (and a little below it)
            const toe = (a, yb) => { const q0 = F.at(a, side * TOP); const g = L.heightAt(q0.x, q0.z); const w = TOP + Math.max(.4, (yb - g) * SLOPE); const q = F.at(a, side * w); return V(q.x, L.heightAt(q.x, q.z) - .25, q.z); };
            const p0 = F.at(a0, side * TOP), p1 = F.at(a1, side * TOP);
            const A_ = V(p0.x, yb0, p0.z), B_ = V(p1.x, yb1, p1.z), C_ = toe(a1, yb1), D_ = toe(a0, yb0);
            S.color(hsh(d * 3.1 + side) < .5 ? '#647d43' : '#6d8448');
            S.quad(A_, D_, C_, B_); S.quad(A_, B_, C_, D_);   // (both faces: the bank's seen from either side)
          }
          // the ballast top
          const q0l = F.at(a0, -TOP), q0r = F.at(a0, TOP), q1l = F.at(a1, -TOP), q1r = F.at(a1, TOP);
          S.color('#8d877c');
          if (s > 0) S.quad(V(q0l.x, yb0, q0l.z), V(q0r.x, yb0, q0r.z), V(q1r.x, yb1, q1r.z), V(q1l.x, yb1, q1l.z));
          else S.quad(V(q0r.x, yb0, q0r.z), V(q0l.x, yb0, q0l.z), V(q1l.x, yb1, q1l.z), V(q1r.x, yb1, q1r.z));
          // ties every 0.6 m, and the rails (spiked down; weathered brown)
          S.color('#4a3a2c');
          for (let k = 0; k < STEP / .6; k++) { const f = k * .6 / STEP, a = a0 + (a1 - a0) * f, q = F.at(a, 0); S.box(q.x, yb0 + (yb1 - yb0) * f + .1, q.z, 2.6, .16, .22, F.yawU); }
          S.color('#6b5e52');
          for (const b of [-.72, .72]) { const r0 = F.at(a0, b), r1 = F.at(a1, b); S.beam(V(r0.x, yb0 + .38, r0.z), V(r1.x, yb1 + .38, r1.z), .08, .14); }
        }
      }
    },

    library(l) {
      const { F, g } = plan(l, 12, 8);
      const hl = F.hl * .96, hw = F.hw * .94, yE = g + 4.6, yR = g + 7.4, BRICK = '#8f5845';
      S.color(BRICK); block(S, F.rect(-hl, hl, -hw, hw), g - 1, yE);
      S.color('#474c50'); gable(S, F, -hl - .3, hl + .3, hw, yE, yR, { over: .4, endColor: BRICK });
      const n = Math.max(2, Math.round(hl / 2.6));
      for (const s of [-1, 1]) for (let k = 0; k < n; k++) window(F, -hl + (k + .5) * 2 * hl / n, s * hw, g + 1.2, 1.1, 2, false, s);
      // the entrance: a white gable on columns at the front
      const q = F.at(hl, 0), e = { x: F.u.x, z: F.u.z };
      const Fe = makeFrame(F.at(hl + 1.4, 0), { x: F.v.x, z: F.v.z }, { x: e.x, z: e.z }, 2.4, 1.4);
      S.color(TRIM); for (const b of [-2.1, 2.1]) { const p = Fe.at(b, 1.1); S.cylinder(p.x, g, p.z, .2, 3.6, 10); }
      S.color('#474c50'); gable(S, makeFrame(F.at(hl + 1.4, 0), e, { x: -F.v.x, z: -F.v.z }), -1.6, 1.6, 2.6, g + 3.6, g + 5.2, { over: .2, endColor: TRIM });
      void q;
    },

    firehouse(l) {
      const { F, g } = plan(l, 16, 10);
      const hl = F.hl * .96, hw = F.hw * .94, yE = g + 6.2, BRICK = '#7f4a3a';
      S.color(BRICK); block(S, F.rect(-hl, hl, -hw, hw), g - 1, yE);
      S.color('#5a5e60'); block(S, F.rect(-hl - .2, hl + .2, -hw - .2, hw + .2), yE, yE + .4);
      // the apparatus bays on the front (+u end): three tall doors
      for (let k = 0; k < 3; k++) {
        const b = -hw + (k + .5) * 2 * hw / 3, q = F.at(hl, b);
        S.color('#e9e7e0'); S.box(q.x + F.u.x * .08, g, q.z + F.u.z * .08, .1, 4.3, 3.6, F.yawV);
        S.color('#2c3238'); for (let r = 0; r < 4; r++) S.box(q.x + F.u.x * .14, g + .6 + r * 1, q.z + F.u.z * .14, .04, .08, 3.4, F.yawV);
      }
      // the hose tower at the back corner
      const t = F.at(-hl + 1.8, hw - 1.8); S.color(BRICK); S.box(t.x, g - 1, t.z, 3.6, 13, 3.6, F.yawU);
      S.color('#5a5e60'); S.pyramid(t.x, g + 12, t.z, 4, 1.6, 4, F.yawU);
      glows.push({ x: F.at(hl + .4, 0).x, y: g + 4.8, z: F.at(hl + .4, 0).z, size: 5, color: '#ffe0b0' });
    },
  };
}
