// Toolbox landscape: the farm kit — the rural maps' fields and roadsides close up (CNY, SKAN; user, 22 Nov 2026:
// "grass + farms need to improve"; chose grass near the rider, 3D crops near the road, fences + stone walls, and the
// roadside verge). Early fall: the corn tall and gone tan, soybeans gold, hay cut and baled.
//   crops       standing corn (and soybeans) as alpha-cut row cards along the field's own rows, built per tile and
//               shown near the camera; beyond, the ground shader's rows carry on
//   bales       round bales on the hay fields and the cut stubble — straw, or wrapped white
//   roadside    along the country roads, in runs: a wire or a board fence where the land beside is pasture or hay,
//               an old fieldstone wall by the woods and the crops; a verge of mown grass tufts and wildflowers
//               (chicory, Queen Anne's lace, goldenrod, asters); the odd farm stand with pumpkins by a farmhouse
// Everything is built once per tile (static), the small near things in a mesh shown only near the camera.
import * as THREE from '../../../../vendor/three.module.min.js';
import { due } from '../core/jobs.js';
import { hash } from '../core/mesh-builder.js';

// ------------------------------------------------------------------ the GLSL noise, in JS (to agree with the ground)
const fract = (x) => x - Math.floor(x);
const gwH = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function gwN(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = gwH(ix, iy), b = gwH(ix + 1, iy), c = gwH(ix, iy + 1), d = gwH(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}
/** SKAN's WorldCover cropland (code 10): which crop the ground shader draws at (x, z), and its rows' heading. */
export function skanCrop(x, z) {
  const ox = (gwN(x * .004, z * .004) - .5) * 90, oz = (gwN(x * .004 + 9, z * .004 + 9) - .5) * 90;
  const fx = Math.floor((x + ox) / 165), fz = Math.floor((z + oz) / 120);
  const f = gwH(fx + 7.3, fz + 7.3), g = gwH(fx - 2.7, fz - 2.7) >= .5 ? .5 : 0;
  return { crop: f < .3 ? 'corn' : f < .48 ? 'soy' : f < .62 ? 'hay' : f < .78 ? 'stubble' : 'plough', heading: g * Math.PI };
}

// ------------------------------------------------------------------ crops
/** The row card texture: left half corn (tall stalks, arching leaves, tassels, a few ears), right half soybeans. */
function cropTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  let s = 91; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // corn: early fall, gone tan with some green left
  for (let k = 0; k < 13; k++) {
    const x = 10 + k * 19 + r() * 6, top = 18 + r() * 18, tan = r();
    const col = (a) => `rgb(${Math.round(150 + tan * 50 - a * 30)},${Math.round(135 + tan * 35 - a * 25)},${Math.round(70 + tan * 20 - a * 15)})`;
    g.strokeStyle = col(.2); g.lineWidth = 3; g.beginPath(); g.moveTo(x, 256); g.lineTo(x + (r() - .5) * 4, top); g.stroke();
    for (let l = 0; l < 7; l++) {
      const y = 220 - l * 26 - r() * 8, d = r() < .5 ? -1 : 1, L = 26 + r() * 18;
      g.strokeStyle = col(r() * .6); g.lineWidth = 3 + r() * 2;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + d * L * .6, y - 16, x + d * L, y + 10 + r() * 10); g.stroke();
    }
    g.strokeStyle = col(.4); g.lineWidth = 2; for (let t = 0; t < 4; t++) { g.beginPath(); g.moveTo(x, top); g.lineTo(x + (t - 1.5) * 4, top - 12); g.stroke(); }
    if (r() < .8) { g.fillStyle = col(.5); g.beginPath(); g.ellipse(x + 4, 140 + r() * 30, 4, 14, .3, 0, 6.28); g.fill(); }
  }
  // soybeans: low, bushy, gold and tan, the pods brown
  for (let k = 0; k < 90; k++) {
    const x = 256 + r() * 256, y = 150 + r() * 100, gold = r();
    g.fillStyle = `rgb(${Math.round(190 + gold * 40)},${Math.round(160 + gold * 40)},${Math.round(60 + gold * 20)})`;
    g.beginPath(); g.ellipse(x, y, 8 + r() * 6, 5 + r() * 4, r() * 3, 0, 6.28); g.fill();
  }
  g.fillStyle = '#7a5a36'; for (let k = 0; k < 120; k++) { g.fillRect(256 + r() * 256, 175 + r() * 80, 2, 5); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** The crop cards' material: alpha-cut, two-sided, swaying a little at the top. */
export function cropMaterial(uTime) {
  const m = new THREE.MeshLambertMaterial({ map: cropTexture(), alphaTest: .5, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uv.y > .5) { vec3 wp = (modelMatrix * vec4(position, 1.)).xyz; transformed.xz += vec2(sin(uTime * 1.7 + wp.x * .3 + wp.z * .2), cos(uTime * 1.3 + wp.z * .25)) * .07 * (uv.y - .5); }`);
  };
  m.customProgramCacheKey = () => 'farm-kit-crops-1';
  return m;
}
/**
 * The tile's crop cards: rows `per` m apart along the field's heading, one card every ~4 m of row, within the tile
 * (x0, z0, size). crop(x, z) → { crop: 'corn' | 'soy' | …, heading (rad, the rows' direction), per } | null.
 */
/** cropCards as a job (yields between the 12 m grid's columns when the frame's slice is used up): out.geo. */
export function* cropCardsJob(x0, z0, size, crop, groundH, out) {
  const it = cropCardsGen(x0, z0, size, crop, groundH);
  let r = it.next(); while (!r.done) { if (due()) yield; r = it.next(); }
  out.geo = r.value;
}
export function cropCards(x0, z0, size, crop, groundH) { const it = cropCardsGen(x0, z0, size, crop, groundH); let r = it.next(); while (!r.done) r = it.next(); return r.value; }
function* cropCardsGen(x0, z0, size, crop, groundH) {
  const pos = [], uv = [], nrm = [];
  const seen = new Map();
  const quad = (ax, az, bx, bz, ya, yb, h, u0) => {
    const P = [[ax, ya, az], [bx, yb, bz], [bx, yb + h, bz], [ax, ya + h, az]], U = [[u0, 0], [u0 + .5, 0], [u0 + .5, 1], [u0, 1]];
    const nx = -(bz - az), nz = bx - ax, l = Math.hypot(nx, nz) || 1;
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[k]); uv.push(...U[k]); nrm.push(nx / l, .35, nz / l); }
  };
  // sample the tile on a 12 m grid for fields; each field's rows are laid on its own lattice
  for (let gx = x0; gx < x0 + size; gx += 12) for (let gz = z0; gz < z0 + size; gz += 12) {
    yield;   // (a 12 m cell: the job checks its slice here)
    const c = crop(gx + 6, gz + 6); if (!c || (c.crop !== 'corn' && c.crop !== 'soy')) continue;
    const ux = Math.cos(c.heading), uz = Math.sin(c.heading), vx = -uz, vz = ux, per = c.per || (c.crop === 'corn' ? .9 : .76);
    const corn = c.crop === 'corn', h = corn ? 2.5 : .75, seg = corn ? 4 : 3;
    // rows crossing this 12 m cell: in the field's frame
    const cu = (gx + 6) * ux + (gz + 6) * uz, cv0 = (gx + 6) * vx + (gz + 6) * vz;
    for (let rv = Math.ceil((cv0 - 8.5) / per) * per; rv < cv0 + 8.5; rv += per) {
      for (let ru = Math.floor((cu - 8.5) / seg) * seg; ru < cu + 8.5; ru += seg) {
        const key = `${Math.round(ru / seg)},${Math.round(rv / per)},${c.crop}`; if (seen.has(key)) continue;
        const mx = ru * ux + rv * vx + ux * seg / 2, mz = ru * uz + rv * vz + uz * seg / 2;
        if (mx < x0 || mx >= x0 + size || mz < z0 || mz >= z0 + size) continue;
        const cc = crop(mx, mz); if (!cc || cc.crop !== c.crop) continue;
        seen.set(key, 1);
        const j = (hash(mx * 1.7 + mz * .3) - .5) * .25, ax = ru * ux + rv * vx, az = ru * uz + rv * vz, bx = ax + ux * seg, bz = az + uz * seg;
        quad(ax + vx * j, az + vz * j, bx + vx * j, bz + vz * j, groundH(ax, az) - .05, groundH(bx, bz) - .05, h * (.9 + hash(mx + mz) * .2), corn ? 0 : .5);
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ bales, fences, walls, verge (into a MeshBuilder)
/** A round bale lying on its side: straw (rolled rings at the ends) or wrapped in white plastic. */
export function bale(M, x, y, z, yaw, wrapped, seed) {
  const c = Math.cos(yaw), s = Math.sin(yaw), r = .75, L = 1.2;
  const body = wrapped ? (seed < .5 ? '#eceeea' : '#dfe3e0') : seed < .5 ? '#c8a964' : '#b9995a', end = wrapped ? '#d4d8d5' : '#a8884c';
  const A = new THREE.Vector3(x - c * L / 2, y + r - .05, z + s * L / 2), B = new THREE.Vector3(x + c * L / 2, y + r - .05, z - s * L / 2);
  M.color(body).beam(A, B, r * 1.85, r * 1.85);
  M.color(end).beam(A.clone().lerp(B, -.01), A.clone().lerp(B, .04), r * 1.5, r * 1.5).beam(B.clone().lerp(A, .04), B.clone().lerp(A, -.01), r * 1.5, r * 1.5);
}
const FLOWERS = ['#6f8fd8', '#f1efe6', '#e2b931', '#9a7fc2', '#e8e4dc', '#d9a92c'];
/** A clump of roadside wildflowers (chicory blue, Queen Anne's lace white, goldenrod, asters), or a grass tuft. */
export function verge(M, x, y, z, seed, flower) {
  // grass: a tuft of thin blades (both faces), leaning out; a flower clump: stems with a head each
  const n = flower ? 4 : 7, V = THREE.Vector3;
  for (let k = 0; k < n; k++) {
    const a = k * 2.4 + seed * 6, d = .05 + hash(seed * 9 + k) * .14, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const h = flower ? .45 + hash(seed * 3 + k) * .5 : .2 + hash(seed * 5 + k) * .22, w = flower ? .02 : .035, lean = .12 + hash(seed + k) * .12;
    const ca = Math.cos(a + 1.57) * w, sa = Math.sin(a + 1.57) * w, tx = px + Math.cos(a) * lean, tz = pz + Math.sin(a) * lean;
    M.color(flower ? '#6f8650' : ['#5a7a3c', '#6a8644', '#7e8f4a', '#9a9a5a'][k % 4]);
    const A = new V(px - ca, y - .02, pz - sa), B = new V(px + ca, y - .02, pz + sa), C = new V(tx, y + h, tz);
    M.triangle(A, B, C); M.triangle(B, A, C);
    if (flower) M.color(FLOWERS[Math.floor(hash(seed * 7) * FLOWERS.length + (k % 2)) % FLOWERS.length]).pyramid(tx, y + h - .06, tz, .13, .06, .13, a);
  }
}
/** One fence or wall bay from a to b (ground heights ya, yb): 'wire' | 'board' | 'stone'. */
export function bay(M, kind, a, b, ya, yb, seed) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz); if (L < .3) return;
  const yaw = Math.atan2(dx, dz);
  if (kind === 'stone') {
    // an old fieldstone wall: grey stones piled ~0.8 m, lichen-pale and mossy, tumbling here and there
    const n = Math.max(2, Math.round(L / .55));
    for (let k = 0; k < n; k++) {
      const t = (k + .5) / n, x = a.x + dx * t, z = a.z + dz * t, y = ya + (yb - ya) * t, h0 = hash(seed * 31 + k);
      const tumble = hash(seed * 7 + Math.floor(k / 4)) < .12;
      M.color(['#8d8a82', '#9a968c', '#7e7b74', '#a29d90', '#86836f'][Math.floor(h0 * 5)]).box(x + (h0 - .5) * .1, y - .15, z, .55 + h0 * .25, tumble ? .3 : .45 + h0 * .2, .55 + h0 * .2, yaw + h0);
      if (!tumble && h0 > .35) M.color(h0 > .8 ? '#6f7a52' : '#999488').box(x, y + .3 + h0 * .1, z + (h0 - .5) * .1, .42, .3, .45, yaw - h0);
    }
    return;
  }
  const post = kind === 'board' ? '#ece9e0' : '#6b5a45';
  M.color(post).box(a.x, ya - .2, a.z, .12, kind === 'board' ? 1.55 : 1.45, .12, yaw);
  const rails = kind === 'board' ? [.5, .9, 1.25] : [.45, .8, 1.15];
  M.color(kind === 'board' ? '#ece9e0' : '#7d7f7a');
  for (const h of rails) {
    const A = new THREE.Vector3(a.x, ya + h, a.z), B = new THREE.Vector3(b.x, yb + h, b.z);
    if (kind === 'board') M.beam(A, B, .04, .14); else M.beam(A, B, .015, .015);
  }
}
/** A farm stand at a farmhouse's drive: a small roofed table, pumpkins and squash on it and in front, a sign. */
export function farmStand(M, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), at = (a, b) => [x + a * c + b * s, z - a * s + b * c];
  M.color('#8a6a48');
  for (const [a, b] of [[-1.2, -.5], [1.2, -.5], [-1.2, .5], [1.2, .5]]) { const [px, pz] = at(a, b); M.box(px, y - .2, pz, .1, 2.2, .1, yaw); }
  { const [px, pz] = at(0, 0); M.box(px, y + .75, pz, 2.6, .08, 1.2, yaw); M.color('#7a2a22').box(px, y + 1.95, pz, 2.9, .1, 1.6, yaw); }
  { const [px, pz] = at(0, -1.6); M.color('#f1ede2').box(px, y - .1, pz, 1.1, .7, .06, yaw); M.color('#6b5a45').box(px, y - .3, pz, .08, .5, .08, yaw); }
  for (let k = 0; k < 9; k++) {
    const h0 = hash(x * 3 + k), [px, pz] = at((h0 - .5) * 2.2, k < 4 ? 0 : -.9 - hash(z + k) * .5), on = k < 4 ? .83 : 0, r = .2 + hash(k + z) * .14;
    M.color(h0 < .7 ? '#d9772a' : h0 < .85 ? '#e9dcb2' : '#5b7a3a').cylinder(px, y + on, pz, r, r * 1.3, 8, r * .8);
  }
}
