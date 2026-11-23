// Toolbox figures: farm animals (CNY, SKAN; user, 23 Nov 2026: "Animal models - farmland"). Chose: dairy cows
// (Holsteins, some Jerseys), horses in paddocks (some in turnout blankets), sheep and goats, chickens, a barn cat,
// geese and ducks on the ponds; kept at a medium distance from the road; minimal animation (grazing head bob, tail
// swish, a few walking slowly); no reaction to the rider; the style of the realistic people (soft shapes, muted
// natural colours, no outlines).
//
// One small geometry per breed / coat (+Z forward, ground y = 0), built from soft blobs (ellipsoids, rods). Per
// vertex aAnim: (part, pivot y, pivot z, amplitude): part 0 body, 1 head and neck (pitched down to graze about
// the neck's root), 2 tail (swishes about its root), 3–6 the legs (FL, FR, BL, BR: swing about the hip when
// walking), 8 a soft contact shadow under the animal (drawn dark), 9 a Holstein coat (black patches from a noise
// in the shader). Per instance (instanceColor, as data): r phase 0–1, g walking 0/1, b walking circle radius / 20.
// A walker goes slowly round a small circle about its spot (a pond bird drifts round it); the rest stand grazing.
// Animation is all in the vertex shader (uTime): no per-frame CPU work.
import * as THREE from '../../../../../vendor/three.module.min.js';
import { VehBuilder } from './vehicles.js';

export const PART_ANIM = { BODY: 0, HEAD: 1, TAIL: 2, FL: 3, FR: 4, BL: 5, BR: 6, SHADOW: 8, PATCH: 10 };   // (PATCH: + a part, a Holstein's coat)
const P = PART_ANIM;

class AnimalBuilder extends VehBuilder {
  constructor() { super(false); }
  /** colour and part; pivot (y, z) and amplitude for the moving parts */
  paint(color, part = P.BODY, py = 0, pz = 0, amp = 0) { this.set(color, part); this.st.wheel = [py, pz, amp]; return this; }
  /** an ellipsoid pitched by `pitch` (radians, nose down positive) about its centre */
  blob(c, r, pitch = 0, lat = 5, lon = 8) {
    const base = this.p.length / 3;
    this.ellipsoid(c, r, lat, lon);
    if (pitch) {
      const cs = Math.cos(pitch), sn = Math.sin(pitch);
      for (let k = base; k < this.p.length / 3; k++) {
        const y = this.p[k * 3 + 1] - c[1], z = this.p[k * 3 + 2] - c[2], ny = this.n[k * 3 + 1], nz = this.n[k * 3 + 2];
        this.p[k * 3 + 1] = c[1] + y * cs - z * sn; this.p[k * 3 + 2] = c[2] + y * sn + z * cs;
        this.n[k * 3 + 1] = ny * cs - nz * sn; this.n[k * 3 + 2] = ny * sn + nz * cs;
      }
    }
    return this;
  }
  /** the soft contact shadow: a flat dark ellipse just above the ground */
  shadow(rx, rz, z = 0) {
    this.paint('#2b2f22', P.SHADOW); rx *= 0.8; rz *= 0.85;
    const seg = 10, base = this.v(0, 0.025, z, 0, 1, 0);
    for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2; this.v(Math.cos(a) * rx, 0.025, z + Math.sin(a) * rz, 0, 1, 0); }
    for (let k = 0; k < seg; k++) this.tri(base, base + 2 + k, base + 1 + k);
    return this;
  }
  /** four legs: hips at (±x, hipY, zF / zB), down to the ground; hooves (or feet) in `hoof` */
  legs(x, hipY, zF, zB, r, col, hoof, amp = 0.32, seg = 5) {
    const parts = [[x, zF, P.FL], [-x, zF, P.FR], [x, zB, P.BL], [-x, zB, P.BR]];
    for (const [lx, lz, part] of parts) {
      this.paint(col, part, hipY, lz, amp).rod([lx, hipY, lz], [lx, 0.12, lz + 0.02], r, seg);
      this.paint(hoof, part, hipY, lz, amp).rod([lx, 0.12, lz + 0.02], [lx, 0.0, lz + 0.03], r * 0.95, seg);
    }
    return this;
  }
  geometry() {
    const g = super.geometry();
    g.setAttribute('aAnim', g.attributes.aVeh); g.deleteAttribute('aVeh');
    return g;
  }
}

// ---------------------------------------------------------------- the animals
function cow(M, { coat = '#f2f0ea', patches = true, nose = '#d9a59a', jersey = false } = {}) {
  const body = patches ? P.PATCH + P.BODY : P.BODY, dark = jersey ? '#3a2a20' : '#1d1c1c';
  M.shadow(0.55, 1.15);
  M.paint(coat, body).blob([0, 1.02, -0.05], [0.36, 0.38, 0.95], 0, 6, 10);           // barrel
  M.paint(coat, body).blob([0, 0.86, 0.0], [0.33, 0.3, 0.7], 0, 4, 8);               // belly
  M.paint(coat, body).blob([0, 1.12, -0.72], [0.34, 0.3, 0.35], 0, 4, 8);            // hips
  M.paint('#e8b9ae').blob([0, 0.66, -0.55], [0.17, 0.12, 0.17], 0, 3, 6);             // udder
  // neck and head: pitched down to graze about the neck's root (0, 1.18, 0.78)
  const H = [P.HEAD, 1.18, 0.78, 0.95];
  M.paint(coat, patches ? P.PATCH + P.HEAD : P.HEAD, ...H.slice(1)).blob([0, 1.14, 1.0], [0.2, 0.26, 0.34], -0.35, 4, 8);
  M.paint(jersey ? '#8a6040' : dark, P.HEAD, ...H.slice(1)).blob([0, 1.12, 1.42], [0.15, 0.17, 0.27], 0.55, 4, 8);
  M.paint(jersey ? '#2c2420' : nose, P.HEAD, ...H.slice(1)).blob([0, 0.98, 1.62], [0.11, 0.09, 0.08], 0.3, 3, 6);
  M.paint(dark, P.HEAD, ...H.slice(1)); for (const s of [1, -1]) M.blob([s * 0.17, 1.28, 1.28], [0.1, 0.04, 0.06], 0, 2, 5);
  // tail
  M.paint(coat, P.TAIL, 1.3, -1.0, 0.45).rod([0, 1.3, -1.0], [0, 0.62, -1.08], 0.035, 4);
  M.paint(dark, P.TAIL, 1.3, -1.0, 0.45).blob([0, 0.56, -1.08], [0.05, 0.11, 0.05], 0, 2, 5);
  M.legs(0.2, 0.85, 0.62, -0.68, 0.075, coat, '#2b2622');
}
function horse(M, { coat = '#6b3e22', mane = '#1e1612', socks = null, blanket = null } = {}) {
  M.shadow(0.5, 1.05);
  M.paint(coat).blob([0, 1.28, -0.05], [0.3, 0.33, 0.82], 0, 6, 10);
  M.paint(coat).blob([0, 1.33, -0.62], [0.3, 0.3, 0.33], 0, 4, 8);
  M.paint(coat).blob([0, 1.33, 0.55], [0.29, 0.31, 0.32], 0, 4, 8);
  if (blanket) {   // a turnout blanket over the back and barrel, a band round the chest
    M.paint(blanket).blob([0, 1.36, -0.05], [0.335, 0.31, 0.86], 0, 5, 10);
    M.paint('#d8d2c2').blob([0, 1.12, -0.05], [0.338, 0.05, 0.8], 0, 2, 10);
  }
  const H = [1.55, 0.78, 1.15];
  M.paint(coat, P.HEAD, ...H).blob([0, 1.7, 0.96], [0.12, 0.34, 0.17], -0.62, 4, 8);   // the neck, raised
  M.paint(coat, P.HEAD, ...H).blob([0, 1.92, 1.26], [0.095, 0.115, 0.3], 0.85, 4, 8);   // the head
  M.paint('#2a2220', P.HEAD, ...H).blob([0, 1.72, 1.48], [0.09, 0.09, 0.1], 0.6, 3, 6);
  M.paint(mane, P.HEAD, ...H).blob([0, 1.86, 0.92], [0.05, 0.3, 0.2], -0.62, 3, 6);
  M.paint(coat, P.HEAD, ...H); for (const s of [1, -1]) M.blob([s * 0.07, 2.12, 1.14], [0.03, 0.08, 0.03], 0, 2, 4);
  M.paint(mane, P.TAIL, 1.45, -0.92, 0.4).blob([0, 1.0, -1.02], [0.07, 0.45, 0.08], -0.2, 3, 6);
  const sock = socks || coat;
  for (const [lx, lz, part] of [[0.17, 0.55, P.FL], [-0.17, 0.55, P.FR], [0.17, -0.6, P.BL], [-0.17, -0.6, P.BR]]) {
    M.paint(coat, part, 1.05, lz, 0.3).rod([lx, 1.05, lz], [lx, 0.35, lz + 0.02], 0.065, 5);
    M.paint(sock, part, 1.05, lz, 0.3).rod([lx, 0.35, lz + 0.02], [lx, 0.06, lz + 0.03], 0.05, 5);
    M.paint('#2a2420', part, 1.05, lz, 0.3).rod([lx, 0.06, lz + 0.03], [lx, 0.0, lz + 0.04], 0.06, 5);
  }
}
function sheep(M, { wool = '#e6dfcd', face = '#efe9dc' } = {}) {
  M.shadow(0.36, 0.6);
  M.paint(wool).blob([0, 0.68, 0], [0.3, 0.3, 0.52], 0, 5, 9);
  M.paint(wool).blob([0, 0.74, -0.25], [0.28, 0.27, 0.3], 0, 4, 8);
  const H = [0.78, 0.42, 0.75];
  M.paint(wool, P.HEAD, ...H).blob([0, 0.82, 0.5], [0.17, 0.2, 0.17], 0, 4, 7);
  M.paint(face, P.HEAD, ...H).blob([0, 0.84, 0.7], [0.09, 0.11, 0.17], 0.55, 4, 7);
  M.paint(face, P.HEAD, ...H); for (const s of [1, -1]) M.blob([s * 0.13, 0.9, 0.62], [0.07, 0.025, 0.04], 0, 2, 4);
  M.paint(wool, P.TAIL, 0.75, -0.5, 0.35).blob([0, 0.62, -0.56], [0.06, 0.11, 0.05], 0, 2, 5);
  M.legs(0.13, 0.5, 0.3, -0.32, 0.035, face === '#1f1b18' ? '#1f1b18' : '#d8cfbd', '#2a2420', 0.35, 4);
}
function goat(M, { coat = '#ece8de', horn = '#8c8070' } = {}) {
  M.shadow(0.3, 0.55);
  M.paint(coat).blob([0, 0.7, 0], [0.21, 0.24, 0.48], 0, 5, 9);
  const H = [0.82, 0.4, 0.8];
  M.paint(coat, P.HEAD, ...H).blob([0, 0.92, 0.48], [0.09, 0.19, 0.12], -0.5, 3, 6);
  M.paint(coat, P.HEAD, ...H).blob([0, 1.05, 0.64], [0.08, 0.09, 0.17], 0.5, 3, 6);
  M.paint(horn, P.HEAD, ...H); for (const s of [1, -1]) M.rod([s * 0.04, 1.12, 0.6], [s * 0.07, 1.24, 0.5], 0.018, 3);
  M.paint(coat, P.HEAD, ...H); for (const s of [1, -1]) M.blob([s * 0.11, 1.08, 0.58], [0.07, 0.025, 0.035], 0, 2, 4);
  M.paint(coat, P.TAIL, 0.82, -0.46, 0.5).rod([0, 0.82, -0.46], [0, 0.95, -0.52], 0.025, 3);
  M.legs(0.12, 0.55, 0.3, -0.3, 0.035, coat, '#3a3028', 0.35, 4);
}
function chicken(M, { plumage = '#f2efe6' } = {}) {
  M.shadow(0.12, 0.15);
  M.paint(plumage).blob([0, 0.26, 0], [0.1, 0.11, 0.15], -0.2, 4, 7);
  M.paint(plumage, P.TAIL, 0.3, -0.12, 0.3).blob([0, 0.34, -0.15], [0.03, 0.09, 0.06], 0.4, 2, 5);
  const H = [0.3, 0.08, 0.9];
  M.paint(plumage, P.HEAD, ...H).blob([0, 0.4, 0.12], [0.05, 0.07, 0.05], 0, 3, 6);
  M.paint('#c8231b', P.HEAD, ...H).blob([0, 0.47, 0.13], [0.012, 0.03, 0.035], 0, 2, 4);
  M.paint('#d89a2a', P.HEAD, ...H).blob([0, 0.39, 0.18], [0.015, 0.012, 0.025], 0, 2, 4);
  for (const [s, part] of [[1, P.FL], [-1, P.FR]]) M.paint('#d6a43a', part, 0.18, 0, 0.5).rod([s * 0.04, 0.18, 0], [s * 0.04, 0.0, 0.02], 0.01, 3);
}
function cat(M, { fur = '#4a4038' } = {}) {   // sitting, upright, by the barn
  M.shadow(0.12, 0.18);
  M.paint(fur).blob([0, 0.14, -0.02], [0.1, 0.14, 0.13], 0, 4, 7);
  M.paint(fur).blob([0, 0.2, 0.06], [0.07, 0.13, 0.06], -0.3, 3, 6);
  const H = [0.26, 0.07, 0.25];
  M.paint(fur, P.HEAD, ...H).blob([0, 0.33, 0.08], [0.06, 0.055, 0.055], 0, 3, 6);
  M.paint(fur, P.HEAD, ...H); for (const s of [1, -1]) M.rod([s * 0.03, 0.37, 0.08], [s * 0.04, 0.41, 0.08], 0.014, 3);
  M.paint(fur, P.TAIL, 0.04, -0.14, 0.6).rod([0, 0.04, -0.14], [0.1, 0.02, -0.02], 0.016, 3).rod([0.1, 0.02, -0.02], [0.14, 0.02, 0.1], 0.015, 3);
}
function goose(M, { plumage = '#f1efe8', bill = '#e08a2a', swim = true } = {}) {
  if (!swim) M.shadow(0.18, 0.3);
  const y = swim ? 0.06 : 0.38;
  M.paint(plumage).blob([0, y + 0.05, 0], [0.15, 0.13, 0.3], -0.1, 4, 8);
  M.paint(plumage, P.TAIL, y + 0.12, -0.28, 0.2).blob([0, y + 0.13, -0.3], [0.07, 0.04, 0.08], 0.4, 2, 5);
  const H = [y + 0.15, 0.2, swim ? 0.25 : 0.8];
  M.paint(plumage, P.HEAD, ...H).rod([0, y + 0.12, 0.2], [0, y + 0.42, 0.27], 0.04, 4);
  M.paint(plumage, P.HEAD, ...H).blob([0, y + 0.45, 0.3], [0.045, 0.05, 0.07], 0, 3, 6);
  M.paint(bill, P.HEAD, ...H).blob([0, y + 0.43, 0.39], [0.02, 0.018, 0.05], 0, 2, 4);
  if (!swim) for (const [s, part] of [[1, P.FL], [-1, P.FR]]) M.paint(bill, part, y - 0.05, 0, 0.4).rod([s * 0.06, y - 0.05, 0], [s * 0.06, 0.0, 0.03], 0.015, 3);
}
function duck(M, { body = '#f3efe2', head = null, bill = '#e9a43a' } = {}) {
  const y = 0.04;
  M.paint(body).blob([0, y + 0.04, 0], [0.1, 0.08, 0.19], -0.1, 4, 7);
  M.paint(body, P.TAIL, y + 0.08, -0.17, 0.25).blob([0, y + 0.1, -0.19], [0.04, 0.03, 0.05], 0.5, 2, 4);
  const H = [y + 0.1, 0.12, 0.3];
  M.paint(head || body, P.HEAD, ...H).blob([0, y + 0.19, 0.15], [0.045, 0.05, 0.055], 0, 3, 6);
  M.paint(bill, P.HEAD, ...H).blob([0, y + 0.17, 0.22], [0.02, 0.012, 0.04], 0, 2, 4);
}

/** Breeds and coats: the builder, and how it lives (graze: head-down share; walkSpeed m/s; legs: walking swings them). */
export const ANIMALS = {
  holstein: { build: (M) => cow(M), walk: 0.45 },
  jersey: { build: (M) => cow(M, { coat: '#b98552', patches: false, jersey: true }), walk: 0.45 },
  horseBay: { build: (M) => horse(M, { coat: '#6a3a20', mane: '#1b1310', socks: '#1b1310' }), walk: 0.7 },
  horseChestnut: { build: (M) => horse(M, { coat: '#9a5228', mane: '#7a3e1c', socks: '#e8e0d0' }), walk: 0.7 },
  horseGrey: { build: (M) => horse(M, { coat: '#bdb8ae', mane: '#8c877e' }), walk: 0.7 },
  horseBlanket: { build: (M) => horse(M, { coat: '#4a2c1c', mane: '#16100c', blanket: '#24415f' }), walk: 0.7 },
  horseBlanketGreen: { build: (M) => horse(M, { coat: '#7a4424', mane: '#2a1810', blanket: '#2f4a33' }), walk: 0.7 },
  sheep: { build: (M) => sheep(M), walk: 0.4 },
  sheepSuffolk: { build: (M) => sheep(M, { face: '#1f1b18' }), walk: 0.4 },
  goatWhite: { build: (M) => goat(M), walk: 0.4 },
  goatBrown: { build: (M) => goat(M, { coat: '#6b4a30', horn: '#5a5048' }), walk: 0.4 },
  chickenWhite: { build: (M) => chicken(M), walk: 0.25, peck: true },
  chickenRed: { build: (M) => chicken(M, { plumage: '#8a3e1e' }), walk: 0.25, peck: true },
  cat: { build: (M) => cat(M), walk: 0 },
  goose: { build: (M) => goose(M), walk: 0.18, swim: true },
  gooseGrey: { build: (M) => goose(M, { plumage: '#8f8a80', bill: '#d27a2a' }), walk: 0.18, swim: true },
  gooseShore: { build: (M) => goose(M, { swim: false }), walk: 0.3, peck: true },
  duckPekin: { build: (M) => duck(M), walk: 0.15, swim: true },
  duckMallard: { build: (M) => duck(M, { body: '#8a7a64', head: '#1f5a3a', bill: '#d8c040' }), walk: 0.15, swim: true },
};

const CACHE = new Map();
/** A breed's geometry (shared; disposeAnimalGeometries()). */
export function animalGeometry(kind) {
  if (!CACHE.has(kind)) { const M = new AnimalBuilder(); (ANIMALS[kind] || ANIMALS.holstein).build(M); CACHE.set(kind, M.geometry()); }
  return CACHE.get(kind);
}
export function disposeAnimalGeometries() { for (const g of CACHE.values()) g.dispose(); CACHE.clear(); }
export function animalStats() { return Object.fromEntries(Object.keys(ANIMALS).map((k) => [k, animalGeometry(k).index.count / 3])); }

// the vertex animation, shared by the colour and the shadow-depth materials
const VERT_HEAD = `
  attribute vec4 aAnim; uniform float uTime; uniform float uWalk; uniform float uPeck; uniform float uSwim;
  varying vec3 vAnimP; varying float vAnimPart;
  vec3 aRotX(vec3 p, float py, float pz, float a) { float c = cos(a), s = sin(a), y = p.y - py, z = p.z - pz; return vec3(p.x, py + y * c - z * s, pz + y * s + z * c); }
  vec3 aRotY(vec3 p, float pz, float a) { float c = cos(a), s = sin(a), z = p.z - pz; return vec3(p.x * c + z * s, p.y, pz - p.x * s + z * c); }
  vec3 animate(vec3 p, inout vec3 n) {
    #ifdef USE_INSTANCING_COLOR
      vec3 inst = instanceColor;
    #else
      vec3 inst = vec3(0.);
    #endif
    float ph = inst.r, walking = step(.5, inst.g), R = max(inst.b * 20., .5);
    float t = uTime + ph * 97.;
    float part = mod(aAnim.x, 10.);
    if (part > .5 && part < 1.5) {
      // head: grazing — down most of the time (a slow rhythm), a small chew; pecking birds bob quickly; up when walking
      float down = clamp(sin(t * .21) * 1.8 + .9, 0., 1.);
      if (uPeck > .5) down = step(.55, fract(t * .7)) * (.6 + .4 * sin(t * 9.));
      down = mix(down, .15, walking * (1. - uPeck));
      float a = aAnim.w * (down + sin(t * 2.3) * .03 * down);
      p = aRotX(p, aAnim.y, aAnim.z, a); n = aRotX(n, 0., 0., a);
    } else if (part > 1.5 && part < 2.5) {
      // tail: a swish now and then
      float a = sin(t * 2.6) * aAnim.w * smoothstep(.2, .8, sin(t * .37 + ph * 5.));
      p = aRotY(p, aAnim.z, a); n = aRotY(n, 0., a);
    } else if (part > 2.5 && part < 6.5) {
      // legs: diagonal pairs (FL with BR, FR with BL) when walking
      float side = (part < 3.5 || part > 5.5) ? 0. : 3.1416;
      float a = sin(t * (uWalk / .35) * 3.1416 + side) * aAnim.w * walking;
      p = aRotX(p, aAnim.y, aAnim.z, a); n = aRotX(n, 0., 0., a);
    }
    if (uSwim > .5) p.y += sin(t * 1.3) * .012;
    // walking: round a circle of radius R about the spot, facing along it
    if (walking > .5 && uWalk > 0.) {
      float th = t * uWalk / R + ph * 6.2832, c = cos(-th), s = sin(-th);
      p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + vec3(R * cos(th), 0., R * sin(th));
      n = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
    }
    return p;
  }`;

function inject(shader, uniforms, depth) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>' + VERT_HEAD)
    .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normal; vec3 animN = normal; vec3 animP = animate(position, animN); objectNormal = animN;`)
    .replace('#include <begin_vertex>', `vec3 transformed = animP; vAnimP = position; vAnimPart = aAnim.x;`);
  if (depth) {
    // (the depth material has no normals: run animate() for the position)
    shader.vertexShader = shader.vertexShader.replace('vec3 transformed = animP;', 'vec3 dn = vec3(0., 1., 0.); vec3 transformed = animate(position, dn);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAnimPart;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vAnimPart > 7.5 && vAnimPart < 8.5) discard;');
  }
}

/**
 * The animals' material for one breed: { uTime } shared clock; the breed sets walking speed, pecking and swimming.
 * Holstein patches and the contact shadow in the fragment shader. Also gives .customDepthMaterial (the shadows walk too).
 */
export function animalMaterial(kind, uTime) {
  const info = ANIMALS[kind] || ANIMALS.holstein;
  const uniforms = { uTime, uWalk: { value: info.walk || 0 }, uPeck: { value: info.peck ? 1 : 0 }, uSwim: { value: info.swim ? 1 : 0 } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    inject(shader, uniforms, false);
    // the instance colour is data, not a tint
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `vColor = vec4(1.0);
      #ifdef USE_COLOR
        vColor.rgb *= color;
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vAnimP; varying float vAnimPart;
        float aN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          float n = dot(i, vec3(1., 57., 113.));
          vec4 a = fract(sin(vec4(n, n + 1., n + 57., n + 58.)) * 43758.5453), b = fract(sin(vec4(n + 113., n + 114., n + 170., n + 171.)) * 43758.5453);
          vec4 mm = mix(a, b, f.z); vec2 m2 = mix(mm.xy, mm.zw, f.y); return mix(m2.x, m2.y, f.x); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float ap = mod(vAnimPart, 10.);
        if (vAnimPart > 9.5) {   // a Holstein's coat: black patches, the legs' lower half and the belly mostly white
          float nz = aN(vAnimP * 2.6) * .7 + aN(vAnimP * 6.) * .3;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.07, .065, .065), smoothstep(.5, .54, nz));
        }
        if (ap > 7.5 && ap < 8.5) { diffuseColor.rgb = vec3(.2, .22, .14); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (ap > 7.5 && ap < 8.5) { totalEmissiveRadiance = vec3(0.); }`);
  };
  m.customProgramCacheKey = () => 'bf-animals-1';
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.onBeforeCompile = (shader) => inject(shader, uniforms, true);
  d.customProgramCacheKey = () => 'bf-animals-depth-1';
  m.userData.depth = d; m.userData.uniforms = uniforms;
  return m;
}

/**
 * Animals for a tile: add() each (kind, x, y, z, yaw, { walk, radius }), then meshes(materials) gives one
 * InstancedMesh per kind (materials: a Map kind → material, filled on demand with animalMaterial(kind, uTime)).
 */
export class Herds {
  constructor() { this.list = []; }
  add(kind, x, y, z, yaw, { walk = false, radius = 4, phase = Math.random() } = {}) { this.list.push({ kind, x, y, z, yaw, walk, radius, phase }); return this; }
  get count() { return this.list.length; }
  meshes(materials, uTime, name = 'Animals') {
    const by = new Map();
    for (const a of this.list) { if (!by.has(a.kind)) by.set(a.kind, []); by.get(a.kind).push(a); }
    const out = [], m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (const [kind, list] of by) {
      if (!materials.has(kind)) materials.set(kind, animalMaterial(kind, uTime));
      const mat = materials.get(kind);
      const im = new THREE.InstancedMesh(animalGeometry(kind), mat, list.length);
      im.customDepthMaterial = mat.userData.depth;
      list.forEach((a, i) => { im.setMatrixAt(i, m4.makeRotationY(a.yaw).setPosition(a.x, a.y, a.z)); im.setColorAt(i, col.setRGB(a.phase, a.walk ? 1 : 0, Math.min(1, a.radius / 20))); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      // (walkers leave the spot by their circle's radius)
      im.boundingSphere.radius += 12;
      im.userData.shared = true; im.castShadow = true; im.receiveShadow = true; im.name = `${name} ${kind}`;
      out.push(im);
    }
    return out;
  }
}
