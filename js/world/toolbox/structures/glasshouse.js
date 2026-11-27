// Toolbox structures: the glasshouse kit — a Victorian conservatory ridden through (Phipps Conservatory in
// Schenley Park first, at about five times its real size). A scene lists `glasshouses`; each is laid out in its
// own frame (u along its front, v back from it, metres from `origin`, the u axis `yawDeg` from east towards
// north) as glass rooms — barrel-vaulted ranges and a domed palm court — joined wall to wall, with glass
// partitions between themed rooms. The route rides through it (tools/build_city.py `detours`): every wall the
// route crosses gets a door, and the floor of each room follows the path's own height (a sunken garden is a room
// whose path dips). Ground: `makeGlasshousePads` levels it under the footprint and eases it back outside
// (js/world/toolbox/city/landscape.js), and `sheltered(x, z)` tells the city kit (lamps) and the weather (rain)
// that a spot is under glass. Map buildings, streets, trees and furniture under it are cleared at build time
// (`clearAreas` in the city config).
//
// Planting is instanced (one draw per plant kind; flower colours per instance), beds come right up to the path's
// walk strip, and every bed is in peak summer bloom. Glass is one transparent, depth-write-free draw with a
// fresnel edge; its white frames, the stone plinth, benches and beds are one opaque draw (not in the light bake:
// the sun shines in through the glass). Hanging glass art is generic abstract forms (teardrops, spires, discs,
// coils) in bright colours. Budget (Phipps): ~20 draws and well under 1 M triangles in any view.
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { Builder, M, cyl, cone, blob, box, withSmooth } from '../core/model-builder.js';
import { randomSequence, smoothstep, vnoise } from '../core/random.js';
import { nightGlowShader, withNightGlow } from '../materials/night-glow.js';   // [review 27 Nov] the shared night glow
import { ghostMask } from '../../ghost.js';
import { drain, due } from '../core/jobs.js';
import { figureMaterial, staticCrowdMesh, randomLook, CLIP } from '../life/figures/people.js';

const R_ = 6371008.8 * Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- frames and footprints (pure)
/** A glasshouse's frame: uv (its own metres) ↔ the scene's local x/z, and its rooms and footprint. */
export function glasshouseFrame(spec, proj) {
  const lat0 = spec.origin.lat, lon0 = spec.origin.lon, yaw = (spec.yawDeg || 0) * Math.PI / 180;
  const ux = Math.cos(yaw), uy = Math.sin(yaw), vx = uy, vy = -ux;   // v: to the right of u (east-north metres)
  const ll = (u, v) => { const e = u * ux + v * vx, n = u * uy + v * vy; return [lat0 + n / R_, lon0 + e / (R_ * Math.cos(lat0 * Math.PI / 180))]; };
  const o = proj.toLocal(...ll(0, 0)), pu = proj.toLocal(...ll(100, 0)), pv = proj.toLocal(...ll(0, 100));
  const ax = (pu.x - o.x) / 100, az = (pu.z - o.z) / 100, bx = (pv.x - o.x) / 100, bz = (pv.z - o.z) / 100;
  const det = ax * bz - az * bx;
  const toXZ = (u, v) => ({ x: o.x + u * ax + v * bx, z: o.z + u * az + v * bz });
  const toUV = (x, z) => { const dx = x - o.x, dz = z - o.z; return { u: (dx * bz - dz * bx) / det, v: (ax * dz - az * dx) / det }; };
  const rooms = (spec.rooms || []).map((r, k) => ({ ...r, k, u0: r.rect[0], u1: r.rect[1], v0: r.rect[2], v1: r.rect[3] }));
  const foot = spec.footprint || [];
  let bb = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [u, v] of foot) { const p = toXZ(u, v); bb = [Math.min(bb[0], p.x), Math.max(bb[1], p.x), Math.min(bb[2], p.z), Math.max(bb[3], p.z)]; }
  return { spec, toXZ, toUV, ll, rooms, foot, bb, yaw: Math.atan2(-az, ax) };
}

const inRing = (ring, u, v) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, bi] = ring[i], [aj, bj] = ring[j];
    if ((bi > v) !== (bj > v) && u < ((aj - ai) * (v - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
};
const segDist = (u, v, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / l2));
  return Math.hypot(a[0] + dx * t - u, a[1] + dy * t - v);
};
const ringDist = (ring, u, v) => { let d = Infinity; for (let i = 0; i < ring.length; i++) d = Math.min(d, segDist(u, v, ring[i], ring[(i + 1) % ring.length])); return d; };
const inRect = (r, u, v, pad = 0) => u > r.u0 - pad && u < r.u1 + pad && v > r.v0 - pad && v < r.v1 + pad;

/** The route's real (not ghost) samples near a frame, in uv, with heights and metres. */
function routeInFrame(F, route, index, margin = 60) {
  const ghost = ghostMask(route), end = route.turnIdx || route.dist.length - 1, out = [];
  for (let i = 0; i <= end; i++) {
    if (ghost?.[i]) continue;
    const x = index.xs[i], z = index.zs[i];
    if (x < F.bb[0] - margin || x > F.bb[1] + margin || z < F.bb[2] - margin || z > F.bb[3] + margin) continue;
    const { u, v } = F.toUV(x, z);
    out.push({ i, u, v, y: route.ele[i], s: route.dist[i] });
  }
  return out;
}
/** Runs of consecutive samples (polylines) from routeInFrame. */
const runsOf = (pts) => { const runs = []; let cur = []; for (const p of pts) { if (cur.length && p.i !== cur[cur.length - 1].i + 1) { runs.push(cur); cur = []; } cur.push(p); } if (cur.length) runs.push(cur); return runs; };
/** Nearest-sample lookup on a 10 m grid (uv). */
function sampleGrid(pts) {
  const g = new Map(), key = (a, b) => `${a},${b}`;
  for (const p of pts) { const k = key(Math.floor(p.u / 10), Math.floor(p.v / 10)); if (!g.has(k)) g.set(k, []); g.get(k).push(p); }
  return (u, v, reach = 2) => {
    let best = null, bd = Infinity;
    const cu = Math.floor(u / 10), cv = Math.floor(v / 10);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (const p of g.get(key(cu + a, cv + b)) || []) {
      const d = (p.u - u) ** 2 + (p.v - v) ** 2; if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
}
/** Distance from (u, v) to the route's polyline (segments of the runs), on a 10 m grid. */
function routeDistField(runs) {
  const g = new Map(), key = (a, b) => `${a},${b}`;
  for (const run of runs) for (let k = 1; k < run.length; k++) {
    const a = run[k - 1], b = run[k];
    for (let cu = Math.floor(Math.min(a.u, b.u) / 10) - 1; cu <= Math.floor(Math.max(a.u, b.u) / 10) + 1; cu++)
      for (let cv = Math.floor(Math.min(a.v, b.v) / 10) - 1; cv <= Math.floor(Math.max(a.v, b.v) / 10) + 1; cv++) {
        const kk = key(cu, cv); if (!g.has(kk)) g.set(kk, []); g.get(kk).push([a, b]);
      }
  }
  return (u, v) => {
    let d = Infinity, at = null;
    for (const [a, b] of g.get(key(Math.floor(u / 10), Math.floor(v / 10))) || []) {
      const dd = segDist(u, v, [a.u, a.v], [b.u, b.v]); if (dd < d) { d = dd; at = a; }
    }
    return { d, at };
  };
}

/**
 * Ground under the scene's glasshouses, for the city landscape: `at(x, z)` → { y, w } (the floor height there and
 * how much it rules: 1 inside the footprint, easing to 0 `padM` outside) or null; `sheltered(x, z)`: under glass.
 * The floor follows the path inside (each spot takes the height of the nearest path sample inside the footprint,
 * less `floorDropM`), so the ground is level where the path is and dips with it.
 */
export function makeGlasshousePads(scene, proj, route, index) {
  const specs = scene?.glasshouses || [];
  if (!specs.length) return null;
  const pads = specs.map((spec) => {
    const F = glasshouseFrame(spec, proj), pts = routeInFrame(F, route, index, 20).filter((p) => inRing(F.foot, p.u, p.v));
    const nearest = sampleGrid(pts), padM = spec.padM ?? 14, drop = spec.floorDropM ?? .45;
    const fallback = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 0;
    return { F, nearest, padM, drop, fallback, bb: [F.bb[0] - padM, F.bb[1] + padM, F.bb[2] - padM, F.bb[3] + padM] };
  });
  const at = (x, z) => {
    for (const P of pads) {
      if (!(x >= P.bb[0] && x <= P.bb[1] && z >= P.bb[2] && z <= P.bb[3])) continue;   // (NaN too)
      const { u, v } = P.F.toUV(x, z), inside = inRing(P.F.foot, u, v);
      const d = inside ? 0 : ringDist(P.F.foot, u, v);
      if (d >= P.padM) continue;
      // outside: the floor height at the nearest point of the footprint's edge (where the plinth stands)
      let qu = u, qv = v;
      if (!inside) [qu, qv] = closestOnRing(P.F.foot, u, v);
      const n = P.nearest(qu, qv, 6);
      return { y: (n ? n.y : P.fallback) - P.drop, w: 1 - smoothstep(0, P.padM, d) };
    }
    return null;
  };
  const sheltered = (x, z, pad = 0) => pads.some((P) => {
    if (!(x >= P.bb[0] && x <= P.bb[1] && z >= P.bb[2] && z <= P.bb[3])) return false;
    const { u, v } = P.F.toUV(x, z);
    return inRing(P.F.foot, u, v) || (pad > 0 && ringDist(P.F.foot, u, v) < pad);
  });
  return { at, sheltered, frames: pads.map((p) => p.F) };
}
function closestOnRing(ring, u, v) {
  let best = ring[0], bd = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / l2)), p = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(p[0] - u, p[1] - v); if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------- plant models (Builder: vertex colours; part 1 = tinted per instance)
const LEAF = '#4f8a3a', LEAF_D = '#3c6e2e', LEAF_L = '#7fae4a', TRUNK = '#7a5a3c', BLOOM = '#ffffff';
function fronds(B, n, len, droop, y, color, rand, width = .9) {
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + rand() * .3, segs = 4, pts = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, r = t * len, h = y + Math.sin(t * Math.PI * .6) * len * .25 - t * t * droop;
      pts.push(V(Math.cos(a) * r, h, Math.sin(a) * r));
    }
    for (let s = 0; s < segs; s++) {
      const w0 = width * Math.sin((s / segs) * Math.PI * .9 + .25), w1 = width * Math.sin(((s + 1) / segs) * Math.PI * .9 + .25);
      const side = V(-Math.sin(a), 0, Math.cos(a));
      const a0 = pts[s].clone().addScaledVector(side, w0), b0 = pts[s].clone().addScaledVector(side, -w0);
      const a1 = pts[s + 1].clone().addScaledVector(side, w1), b1 = pts[s + 1].clone().addScaledVector(side, -w1);
      const g = new THREE.BufferGeometry().setFromPoints([a0, b0, b1, a0, b1, a1, a0, b1, b0, a0, a1, b1]);
      B.add(g, new THREE.Matrix4(), color);
    }
  }
}
function plantModels() {
  const rand = randomSequence(77), out = {};
  withSmooth(true, () => {
    // palm: ringed trunk, a crown of drooping fronds, a few nuts (height 1 → scaled per instance)
    { const B = new Builder(); B.add(cyl(.028, .045, .92, 7), M(), TRUNK);
      for (let k = 1; k < 6; k++) B.add(cyl(.036, .036, .012, 7), M(0, k * .16, 0), '#5f4630');
      B.as(1); fronds(B, 11, .42, .3, .92, LEAF, rand, .05); B.as(0);
      for (let k = 0; k < 4; k++) B.add(blob(0), M(Math.cos(k * 1.6) * .03, .88, Math.sin(k * 1.6) * .03, .022, .022, .022), '#8a6a2a');
      out.palm = B.build(); }
    // tree fern: shaggy trunk, a flat rosette of long fronds
    { const B = new Builder(); B.add(cyl(.05, .07, .8, 6), M(), '#5a4632');
      B.as(1); fronds(B, 12, .5, .18, .8, LEAF_L, rand, .07); B.as(0); out.treefern = B.build(); }
    // banana / heliconia: a clump of stems with big paddle leaves (and a red bract)
    { const B = new Builder();
      for (let k = 0; k < 3; k++) { const a = k * 2.1, r = .08; B.add(cyl(.035, .05, .55, 6), M(Math.cos(a) * r, 0, Math.sin(a) * r), '#6f8f3a'); }
      B.as(1); fronds(B, 7, .55, .25, .5, '#5d9a3c', rand, .14); B.as(0);
      B.add(cone(.05, .18, 5), M(.05, .38, 0, 1, 1, 1, 0, 0, Math.PI), '#d8402a');
      out.banana = B.build(); }
    // a broadleaf rain-forest tree: trunk with buttresses and three crowns
    { const B = new Builder(); B.add(cyl(.04, .07, .6, 7), M(), '#6b5440');
      B.as(1); B.add(blob(1), M(0, .68, 0, .34, .2, .34), LEAF_D); B.add(blob(1), M(.18, .6, .1, .22, .15, .22), LEAF);
      B.add(blob(1), M(-.15, .62, -.12, .24, .16, .24), LEAF_L); B.as(0); out.rainTree = B.build(); }
    // monstera / elephant ears: big leaves on a low clump
    { const B = new Builder(); B.as(1); fronds(B, 8, .9, .3, .25, '#2f7a3a', rand, .32); B.as(0); out.bigLeaf = B.build(); }
    // fern clump
    { const B = new Builder(); B.as(1); fronds(B, 9, .8, .45, .15, LEAF_L, rand, .14); B.as(0); out.fern = B.build(); }
    // saguaro cactus with arms
    { const B = new Builder(); const c = '#5e8f4a';
      B.add(cyl(.07, .075, .92, 8), M(), c); B.add(blob(1), M(0, .92, 0, .07, .06, .07), c);
      for (const [s, h, l] of [[1, .42, .25], [-1, .55, .2]]) { B.add(cyl(.05, .05, .12, 7), M(s * .1, h, 0, 1, 1, 1, 0, 0, s * Math.PI / 2), c);
        B.add(cyl(.05, .05, l, 7), M(s * .16, h, 0), c); B.add(blob(1), M(s * .16, h + l, 0, .05, .045, .05), c); }
      B.as(1); B.add(blob(0), M(0, .99, 0, .03, .02, .03), BLOOM); B.as(0); out.saguaro = B.build(); }
    // barrel cactus with a crown of flowers
    { const B = new Builder(); B.add(blob(1), M(0, .45, 0, .5, .5, .5), '#6a9a48'); B.as(1);
      for (let k = 0; k < 6; k++) B.add(blob(0), M(Math.cos(k) * .14, .93, Math.sin(k) * .14, .09, .06, .09), BLOOM); B.as(0); out.barrel = B.build(); }
    // agave rosette (blue-grey spikes) with a tall flower spike sometimes (part 1)
    { const B = new Builder();
      for (let k = 0; k < 14; k++) { const a = k * 2.4, t = .6 + (k % 3) * .2; B.add(cone(.07, .9 * t, 4), M(Math.cos(a) * .12, 0, Math.sin(a) * .12, 1, 1, 1, 0, Math.sin(a) * .9, -Math.cos(a) * .9), '#7aa0a0'); }
      B.as(1); B.add(cyl(.02, .03, 1.6, 5), M(0, 0, 0), '#9a8a50'); B.add(blob(0), M(0, 1.6, 0, .12, .2, .12), BLOOM); B.as(0); out.agave = B.build(); }
    // orchid: a few arching stems carrying blooms (tinted)
    { const B = new Builder(); B.add(blob(0), M(0, .06, 0, .18, .08, .18), '#3f6a35');
      for (let k = 0; k < 3; k++) { const a = k * 2.2; B.add(cyl(.008, .01, .5, 4), M(Math.cos(a) * .05, .05, Math.sin(a) * .05, 1, 1, 1, 0, Math.sin(a) * .35, -Math.cos(a) * .35), '#4d7a35');
        B.as(1); for (let j = 0; j < 4; j++) { const t = .25 + j * .07; B.add(blob(0), M(Math.cos(a) * (.05 + t * .35), .05 + t * .95, Math.sin(a) * (.05 + t * .35), .05, .04, .05), BLOOM); } B.as(0); }
      out.orchid = B.build(); }
    // flower clump: a leafy mound with bloom heads (tinted per instance)
    { const B = new Builder(); B.add(blob(0), M(0, .12, 0, .42, .2, .42), LEAF);
      B.as(1); for (let k = 0; k < 7; k++) { const a = k * 2.4, r = k ? .26 : 0; B.add(new THREE.OctahedronGeometry(.1, 0), M(Math.cos(a) * r, .3 + (k % 3) * .05, Math.sin(a) * r, 1.1, .7, 1.1), BLOOM); } B.as(0);
      out.flowers = B.build(); }
    // tall flower spikes (foxglove / delphinium / canna) for the back of a border
    { const B = new Builder(); B.add(blob(0), M(0, .1, 0, .3, .15, .3), LEAF_D);
      B.as(1); for (let k = 0; k < 4; k++) { const a = k * 1.7, r = .14; B.add(cone(.07, .55, 5), M(Math.cos(a) * r, .25, Math.sin(a) * r), BLOOM); } B.as(0);
      out.spikes = B.build(); }
    // topiary (cone and ball)
    { const B = new Builder(); B.add(cyl(.05, .05, .15, 5), M(), TRUNK); B.as(1); B.add(cone(.32, .85, 8), M(0, .15, 0), LEAF_D); B.as(0); out.topiaryCone = B.build(); }
    { const B = new Builder(); B.add(cyl(.04, .04, .45, 5), M(), TRUNK); B.as(1); B.add(blob(1), M(0, .7, 0, .3, .3, .3), LEAF_D); B.as(0); out.topiaryBall = B.build(); }
    // shrub
    { const B = new Builder(); B.as(1); B.add(blob(1), M(0, .45, 0, .6, .45, .6), LEAF); B.add(blob(0), M(.3, .3, .2, .35, .3, .35), LEAF_D); B.as(0); out.shrub = B.build(); }
    // desert rock
    { const B = new Builder(); B.add(blob(0), M(0, .3, 0, .6, .45, .5), '#b88d64'); B.add(blob(0), M(.4, .2, .2, .35, .3, .35), '#a37a55'); out.rock = B.build(); }
  });
  // each model at its typical size in metres, so instances scale by ~1 (QC tests the chase camera against them with
  // a sphere in the model's own space)
  for (const [k, g] of Object.entries(out)) {
    g.computeBoundingBox();
    const f = (TYPICAL_H[k] || 1) / Math.max(.01, g.boundingBox.max.y);
    g.scale(f, f, f); g.computeBoundingBox(); g.computeBoundingSphere();
  }
  return out;
}

const TYPICAL_H = { palm: 26, treefern: 8, banana: 6.5, rainTree: 18, bigLeaf: 2.7, fern: 1.7, saguaro: 8, barrel: .85, agave: 1.7,
  orchid: 1.5, flowers: .9, spikes: 1.8, topiaryCone: 3.7, topiaryBall: 2.6, shrub: 2, rock: 1.9 };

// ---------------------------------------------------------------- themes: what grows where
// layers: model, grid spacing (m), path distance band [min, max] (null max: the whole bed), scale [h0, h1] (height m),
// palette (instance tints: blooms for flowers, leaf tints otherwise), share (chance a grid spot takes it)
const BLOOMS = {
  summer: ['#e8384f', '#ff8a1e', '#ffd23a', '#f45bb4', '#9b59d6', '#ffffff', '#ff5a36', '#e9e05a', '#d63d8f', '#5a7cf0'],
  warm: ['#ff5a36', '#ff8a1e', '#ffd23a', '#e8384f', '#d63d8f'],
  orchid: ['#f2a6d8', '#d655b8', '#a05ae0', '#ffffff', '#ffe066', '#ff8fb1', '#c43c8a'],
  desert: ['#ff6aa0', '#ffd23a', '#ff8a1e', '#ffffff', '#e8384f'],
  leaf: ['#ffffff', '#e8f5d8', '#d8ecc8', '#f2ffe6'],
};
const THEMES = {
  palm: { soil: '#4e3d2c', layers: [
    { model: 'flowers', spacing: 1.7, band: [6.2, 10], h: [.7, 1.1], pal: 'summer' },
    { model: 'palm', spacing: 10, band: [10, null], h: [18, 34], pal: 'leaf', share: .85 },
    { model: 'treefern', spacing: 7, band: [10, null], h: [6, 10], pal: 'leaf', share: .5 },
    { model: 'bigLeaf', spacing: 4, band: [9, null], h: [2, 3.2], pal: 'leaf', share: .55 },
    { model: 'fern', spacing: 3, band: [10, null], h: [1.2, 2], pal: 'leaf', share: .4 } ] },
  tropical: { soil: '#463423', layers: [
    { model: 'flowers', spacing: 1.6, band: [6.2, 9.5], h: [.7, 1.1], pal: 'warm' },
    { model: 'banana', spacing: 5, band: [9, null], h: [5, 8], pal: 'leaf', share: .55 },
    { model: 'rainTree', spacing: 10, band: [9.5, null], h: [13, 20], pal: 'leaf', share: .8 },
    { model: 'treefern', spacing: 6, band: [10, null], h: [6, 9], pal: 'leaf', share: .45 },
    { model: 'bigLeaf', spacing: 3.5, band: [8.5, null], h: [2, 3.5], pal: 'leaf', share: .6 },
    { model: 'fern', spacing: 2.6, band: [9, null], h: [1.2, 2], pal: 'leaf', share: .5 } ] },
  desert: { soil: '#d6be92', layers: [
    { model: 'barrel', spacing: 2.2, band: [6.4, 10], h: [.6, 1.1], pal: 'desert', share: .55 },
    { model: 'agave', spacing: 3.2, band: [7, null], h: [1.2, 2.2], pal: 'desert', share: .5 },
    { model: 'saguaro', spacing: 7, band: [10, null], h: [6, 11], pal: 'desert', share: .6 },
    { model: 'rock', spacing: 6, band: [8, null], h: [1.2, 2.6], pal: 'leaf', share: .35 } ] },
  orchid: { soil: '#3f5530', layers: [
    { model: 'orchid', spacing: 1.4, band: [6.2, 11], h: [1.2, 1.8], pal: 'orchid' },
    { model: 'fern', spacing: 2.4, band: [10, null], h: [1.3, 2.2], pal: 'leaf', share: .6 },
    { model: 'treefern', spacing: 7, band: [12, null], h: [5, 8], pal: 'leaf', share: .5 },
    { model: 'orchid', spacing: 2.2, band: [11, null], h: [1.4, 2.2], pal: 'orchid', share: .5 } ] },
  sunken: { soil: '#5a4632', parterre: true, layers: [
    { model: 'flowers', spacing: 1.35, band: [6.2, null], h: [.75, 1.15], pal: 'summer', share: 1 },
    { model: 'topiaryCone', spacing: 9, band: [8, null], h: [3, 4.5], pal: 'leaf', share: .9, grid: true } ] },
  outdoor: { soil: '#5a4632', layers: [
    { model: 'flowers', spacing: 1.6, band: [6.2, 9.5], h: [.6, 1], pal: 'summer' },
    { model: 'spikes', spacing: 1.9, band: [9.5, 12], h: [1.4, 2.2], pal: 'summer', share: .85 },
    { model: 'topiaryBall', spacing: 11, band: [12.5, 14], h: [2.2, 3], pal: 'leaf', share: .8 } ] },
};

// ---------------------------------------------------------------- materials
function plantMaterial(night) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    nightGlowShader(sh, night, 'vColor.rgb * vec3(1., .86, .62) * .16 * uNight');   // [F116] the house's own lamps on the beds after dark
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTree;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = color.xyz * mix(vec3(1.), instanceColor.xyz, aTree);
        #endif`);
  };
  m.customProgramCacheKey = () => 'glasshouse-plant-2';
  return m;
}
function glassMaterial(night) {
  const m = new THREE.MeshStandardMaterial({ color: '#d4ece8', transparent: true, opacity: .16, roughness: .55, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = night;
    // [F116] after dark the glass glows warm, lit from inside: a lantern seen from the park (brighter at the edges)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <opaque_fragment>', `
      float bfFres = pow(1. - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.);
      diffuseColor.a = clamp(diffuseColor.a + bfFres * .42 + uNight * (.1 + bfFres * .12), 0., .7);
      outgoingLight += vec3(.10, .13, .13) * bfFres * (1. - uNight);
      outgoingLight += vec3(1., .74, .42) * (.26 + bfFres * .3) * uNight;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'glasshouse-glass-2';
  m.userData.noBake = true;
  return m;
}
function artMaterial(night) {
  // (the glass art and the path lamps' globes: a little glow by day, lit up after dark [F116])
  return withNightGlow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .18, metalness: .05, side: THREE.DoubleSide }),
    night, 'vColor.rgb * (.38 + uNight * 1.25)', 'glasshouse-art-2');
}
function frameMaterial(night) {
  return withNightGlow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: .05, side: THREE.DoubleSide }),
    night, 'vColor.rgb * vec3(1., .82, .58) * .2 * uNight', 'glasshouse-frames-1');   // the white frames lit from inside
}
function waterMaterial(uTime) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .12, metalness: .1, transparent: true, opacity: .88, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFlow;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvFlow = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec2 vFlow;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float bfFall = step(.5, vFlow.x);
        float bfS = bfFall > .5 ? fract(vFlow.y * .35 - uTime * 1.6 + sin(vFlow.x * 37.) * .3) : .5 + .5 * sin(vFlow.y * .9 + uTime * 1.3) * sin(vFlow.x * 1.1 - uTime);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.92, .97, 1.), bfFall > .5 ? smoothstep(.55, .95, bfS) * .8 : smoothstep(.7, 1., bfS) * .35);`);
  };
  m.customProgramCacheKey = () => 'glasshouse-water-1';
  return m;
}

// ---------------------------------------------------------------- the build
/** Build every glasshouse in the city's scene: meshes into city.group; returns { frames, meshes }. */
export function buildGlasshouses(city) { return drain(buildGlasshousesJob(city)); }
/** buildGlasshouses as a job (PLAN F30: an area builds in frame slices on the ride). */
export function* buildGlasshousesJob(city) {
  const scene = city.route.scene || {}, specs = scene.glasshouses || [];
  if (!specs.length) return null;
  const out = { frames: [], meshes: [] };
  const uTime = city.uniforms?.uTime || { value: 0 };
  for (const spec of specs) out.frames.push(yield* buildOneJob(city, spec, out, uTime));
  const domes = out.frames.flatMap((f) => f.domes || []);
  /** [F111] How far (m) the chase camera looks up at (x, z): up into a dome when the rider is under it. */
  out.lookUp = (x, z) => domeLookUp(domes, x, z);
  return out;
}

/**
 * [F111] Under a dome the chase camera looks up a little, into it: `lookUpM` (default 3 m at the look point, ~10°)
 * at the dome's centre, easing to nothing at its rim. domes: [{x, z, r, m}] (scene metres).
 */
export function domeLookUp(domes, x, z) {
  let up = 0;
  for (const d of domes) {
    const t = 1 - Math.hypot(x - d.x, z - d.z) / d.r;
    if (t > 0) up = Math.max(up, d.m * smoothstep(0, .55, t));
  }
  return up;
}

function* buildOneJob(city, spec, out, uTime) {
  const L = city.landscape, F = glasshouseFrame(spec, city.D.proj);
  const rand = randomSequence(spec.seed ?? 1871);
  const night = city.night || { value: 0 };   // [F116] the city's night (0 day, 1 night)
  const pts = routeInFrame(F, city.route, city.index, 80), runs = runsOf(pts), rdist = routeDistField(runs);
  const inside = pts.filter((p) => inRing(F.foot, p.u, p.v));
  // the garden walk: only the stretch of route the glasshouse owns (`pathM`) gets borders outside the glass
  const own = spec.pathM ? pts.filter((p) => p.s >= spec.pathM[0] && p.s <= spec.pathM[1]) : pts;
  const pdist = routeDistField(runsOf(own));
  const P = (u, v, y) => { const q = F.toXZ(u, v); return V(q.x, y, q.z); };
  const ground = (u, v) => { const q = F.toXZ(u, v); return L.heightAt(q.x, q.z); };
  const doorW = spec.doorM?.[0] ?? 14, doorH = spec.doorM?.[1] ?? 11;
  // each room's base (its walls stand on it): the highest path sample in it, less the floor drop
  for (const R of F.rooms) {
    const ys = inside.filter((p) => inRect(R, p.u, p.v)).map((p) => p.y);
    R.base = (ys.length ? Math.max(...ys) : ground((R.u0 + R.u1) / 2, (R.v0 + R.v1) / 2)) - (spec.floorDropM ?? .45);
    R.top = R.base + R.wallM;
  }
  const roomAt = (u, v, not) => F.rooms.find((R) => R !== not && inRect(R, u, v, .01));
  /** Where the route crosses the segment a→b (uv): params t along it. */
  const crossings = (a, b) => {
    const ts = [];
    for (const run of runs) for (let k = 1; k < run.length; k++) {
      const p = run[k - 1], q = run[k];
      const d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = q.u - p.u, d2y = q.v - p.v, den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p.u - a[0]) * d2y - (p.v - a[1]) * d2x) / den, s = ((p.u - a[0]) * d1y - (p.v - a[1]) * d1x) / den;
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) ts.push(t);
    }
    return ts;
  };

  const G = new MeshBuilder();                 // glass
  const S = new MeshBuilder();                 // frames, plinth, benches, rocks (opaque)
  const Bd = new MeshBuilder();                // bed soil: a decal on the ground (no depth write: plants stand in it)
  const A = new MeshBuilder();                 // hanging glass art
  const W = new MeshBuilder();                 // water
  const WHITE = '#f3f1ea', STONE = '#b8ab92', GREEN = '#5f7f6d';
  /** A still pool (uv.x 0: ripples). */
  const disc = (Wb, u, v, y, r) => {
    Wb.color('#3f8f96');
    const c = P(u, v, y), k0 = Wb.vertex(c.x, y, c.z, 0, 1, 0, 0, 0), n = 24;
    const ks = [];
    for (let k = 0; k < n; k++) { const a = k / n * TAU, q = P(u + Math.cos(a) * r, v + Math.sin(a) * r, y); ks.push(Wb.vertex(q.x, y, q.z, 0, 1, 0, 0, r)); }
    for (let k = 0; k < n; k++) Wb.tri(k0, ks[(k + 1) % n], ks[k]);
  };
  /** A jet of falling water (uv.x 1: running stripes) from a to b, arched by `arc` metres. */
  const jet = (Wb, u0, v0, y0, u1, v1, y1, arc) => {
    Wb.color('#cfeef2');
    let prev = null;
    for (let j = 0; j <= 8; j++) {
      const t = j / 8, q = P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * arc);
      if (prev) { const a = Wb.count; Wb.beam(prev, q, .22, .22); for (let i = a; i < Wb.count; i++) { Wb.uv[i * 2] = 1; Wb.uv[i * 2 + 1] = t * 6; } }
      prev = q;
    }
  };
  const frameW = spec.frameM ?? .32;
  const gquad = (a, b, c, d) => G.quad(a, b, c, d);

  // ---- walls: every room edge, cut where it meets a neighbour (drawn only above the neighbour's walls) and at doors
  const wallPanels = (a, b, base, heightAt, R, opts = {}) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < .5) return;
    const nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;   // (outward for the rooms' clockwise-in-uv edges)
    const step = spec.panelM ?? 4.5, cuts = new Set([0, len]);
    for (let s = step; s < len - .5; s += step) cuts.add(s);
    const doors = crossings(a, b).map((t) => t * len);
    for (const d of doors) for (const e of [d - doorW / 2, d + doorW / 2]) if (e > 0 && e < len) cuts.add(e);
    const cs = [...cuts].sort((x, y) => x - y);
    const at = (s) => [a[0] + (b[0] - a[0]) * s / len, a[1] + (b[1] - a[1]) * s / len];
    for (let k = 1; k < cs.length; k++) {
      const s0 = cs[k - 1], s1 = cs[k], m = (s0 + s1) / 2, pm = at(m);
      if (s1 - s0 < .05) continue;
      let y0 = base;
      if (!opts.partition) {
        const nb = roomAt(pm[0] + nx * .6, pm[1] + ny * .6, R) || roomAt(pm[0] - nx * .6, pm[1] - ny * .6, R);
        if (nb) y0 = Math.max(y0, nb.top);
      }
      const inDoor = doors.some((d) => m > d - doorW / 2 && m < d + doorW / 2);
      if (inDoor) y0 = Math.max(y0, base + doorH);
      const p0 = at(s0), p1 = at(s1), h0 = heightAt(s0), h1 = heightAt(s1);
      if (h0 - y0 < .1 && h1 - y0 < .1) continue;
      const lo0 = Math.min(y0, h0), lo1 = Math.min(y0, h1);
      gquad(P(p0[0], p0[1], lo0), P(p1[0], p1[1], lo1), P(p1[0], p1[1], h1), P(p0[0], p0[1], h0));
      // frames: a mullion at each panel edge, transoms every 5 m, and the plinth along the foot
      S.color(WHITE);
      S.beam(P(p0[0], p0[1], lo0), P(p0[0], p0[1], h0), frameW, frameW);
      for (let y = Math.ceil((lo0 + .1 - base) / 5) * 5 + base; y < Math.min(h0, h1) - .5; y += 5) S.beam(P(p0[0], p0[1], y), P(p1[0], p1[1], y), frameW * .7, frameW * .7);
      if (y0 === base && !inDoor) {
        const g0 = Math.min(ground(p0[0] + nx * 1.5, p0[1] + ny * 1.5), ground(p0[0] - nx * 1.5, p0[1] - ny * 1.5), base) - .4;
        const g1 = Math.min(ground(p1[0] + nx * 1.5, p1[1] + ny * 1.5), ground(p1[0] - nx * 1.5, p1[1] - ny * 1.5), base) - .4;
        S.color(STONE);
        const q0 = P(p0[0] + nx * .35, p0[1] + ny * .35, 0), q1 = P(p1[0] + nx * .35, p1[1] + ny * .35, 0), r0 = P(p0[0] - nx * .35, p0[1] - ny * .35, 0), r1 = P(p1[0] - nx * .35, p1[1] - ny * .35, 0);
        const top = base + (opts.plinthM ?? 1.1);
        S.quad(V(q0.x, Math.min(g0, base), q0.z), V(q1.x, Math.min(g1, base), q1.z), V(q1.x, top, q1.z), V(q0.x, top, q0.z));
        S.quad(V(r1.x, Math.min(g1, base), r1.z), V(r0.x, Math.min(g0, base), r0.z), V(r0.x, top, r0.z), V(r1.x, top, r1.z));
        S.quad(V(q0.x, top, q0.z), V(q1.x, top, q1.z), V(r1.x, top, r1.z), V(r0.x, top, r0.z));
      }
    }
    // the last mullion, the eaves beam, and door arches
    const pe = at(len); S.color(WHITE); S.beam(P(pe[0], pe[1], base), P(pe[0], pe[1], heightAt(len)), frameW, frameW);
    if (!opts.gable) S.beam(P(a[0], a[1], heightAt(0)), P(b[0], b[1], heightAt(len)), frameW * 1.6, frameW * 1.2);
    for (const d of doors) {
      const c = at(d), r = doorW / 2, spring = base + doorH - r;
      let prev = null;
      for (let k = 0; k <= 12; k++) {
        const t = Math.PI * k / 12, s = d - Math.cos(t) * r, pp = at(Math.max(0, Math.min(len, s)));
        const q = P(pp[0], pp[1], spring + Math.sin(t) * r);
        if (prev) S.beam(prev, q, frameW * 2, frameW * 2);
        prev = q;
      }
      for (const s of [d - r, d + r]) { const pp = at(Math.max(0, Math.min(len, s))); S.beam(P(pp[0], pp[1], base), P(pp[0], pp[1], spring), frameW * 2.2, frameW * 2.2); }
      void c;
    }
  };

  for (const R of F.rooms) {
    const vault = R.roof === 'vault', alongU = (R.axis || 'u') === 'u', rise = R.riseM ?? 14;
    const corners = [[R.u0, R.v0], [R.u1, R.v0], [R.u1, R.v1], [R.u0, R.v1]];
    // edges, clockwise in (u, v): front (v0), east end (u1), back (v1), west end (u0)
    for (let e = 0; e < 4; e++) {
      const a = corners[e], b = corners[(e + 1) % 4], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const gable = vault && (alongU ? e % 2 === 1 : e % 2 === 0);
      const heightAt = gable ? (s) => {
        const half = len / 2, t = (s - half) / half;
        return R.top + rise * Math.sqrt(Math.max(0, 1 - t * t));
      } : () => R.top;
      wallPanels(a, b, R.base, heightAt, R, { gable });
      if (due()) yield;
    }
    if (vault) vaultRoof(R, rise, alongU);
    if (R.roof === 'dome') domeRoof(R);
    if (due()) yield;
  }
  for (const pt of spec.partitions || []) {
    const a = pt[0], b = pt[1], R = roomAt((a[0] + b[0]) / 2 + .3, (a[1] + b[1]) / 2 + .3) || F.rooms[0];
    const R2 = roomAt((a[0] + b[0]) / 2 - .3, (a[1] + b[1]) / 2 - .3) || R;
    const base = Math.max(R.base, R2.base), top = Math.min(R.top, R2.top);
    wallPanels(a, b, base, () => top, R, { partition: true, plinthM: 1.1 + Math.abs(R.base - R2.base) });
  }

  function vaultRoof(R, rise, alongU) {
    const [a0, a1, b0, b1] = alongU ? [R.u0, R.u1, R.v0, R.v1] : [R.v0, R.v1, R.u0, R.u1];
    const uvOf = (along, across) => (alongU ? [along, across] : [across, along]);
    const n = 12, ribs = Math.max(2, Math.round((a1 - a0) / (spec.ribM ?? 6)));
    const arc = (k) => { const t = -1 + 2 * k / n, across = (b0 + b1) / 2 + t * (b1 - b0) / 2; return [across, R.top + rise * Math.sqrt(Math.max(0, 1 - t * t))]; };
    for (let j = 0; j < ribs; j++) {
      const s0 = a0 + (a1 - a0) * j / ribs, s1 = a0 + (a1 - a0) * (j + 1) / ribs;
      for (let k = 0; k < n; k++) {
        const [c0, y0] = arc(k), [c1, y1] = arc(k + 1);
        const p00 = P(...uvOf(s0, c0), y0), p10 = P(...uvOf(s1, c0), y0), p11 = P(...uvOf(s1, c1), y1), p01 = P(...uvOf(s0, c1), y1);
        gquad(p00, p10, p11, p01);
      }
    }
    S.color(WHITE);
    for (let j = 0; j <= ribs; j++) {
      const s = a0 + (a1 - a0) * j / ribs;
      for (let k = 0; k < n; k++) { const [c0, y0] = arc(k), [c1, y1] = arc(k + 1); S.beam(P(...uvOf(s, c0), y0), P(...uvOf(s, c1), y1), frameW * 1.3, frameW * 1.3); }
    }
    for (let k = 1; k < n; k += 2) { const [c, y] = arc(k); S.beam(P(...uvOf(a0, c), y), P(...uvOf(a1, c), y), frameW * .8, frameW * .8); }
    const [cm, ym] = arc(n / 2); S.color(GREEN); S.beam(P(...uvOf(a0, cm), ym + .3), P(...uvOf(a1, cm), ym + .3), frameW * 2.4, frameW * 1.6);
  }

  function domeRoof(R) {
    const D = R.dome || {}, [cu, cv] = D.c || [(R.u0 + R.u1) / 2, (R.v0 + R.v1) / 2], r = D.r || Math.min(R.u1 - R.u0, R.v1 - R.v0) * .42;
    const hip = D.hipM ?? 6, drum = D.drumM ?? 14, rise = D.riseM ?? r * 1.05, segs = 32;
    const y1 = R.top + hip, y2 = y1 + drum;
    // a low glass hip from the walls' top to the drum
    const edgeAt = (ang) => {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const tx = dx > 0 ? (R.u1 - cu) / dx : dx < 0 ? (R.u0 - cu) / dx : Infinity, ty = dy > 0 ? (R.v1 - cv) / dy : dy < 0 ? (R.v0 - cv) / dy : Infinity;
      const t = Math.min(tx, ty); return [cu + dx * t, cv + dy * t];
    };
    const ring = (rr, y, k) => { const a = k / segs * TAU; return P(cu + Math.cos(a) * rr, cv + Math.sin(a) * rr, y); };
    for (let k = 0; k < segs * 2; k++) {
      const a0 = k / (segs * 2) * TAU, a1 = (k + 1) / (segs * 2) * TAU, e0 = edgeAt(a0), e1 = edgeAt(a1);
      const i0 = P(cu + Math.cos(a0) * r, cv + Math.sin(a0) * r, y1), i1 = P(cu + Math.cos(a1) * r, cv + Math.sin(a1) * r, y1);
      gquad(P(e0[0], e0[1], R.top), P(e1[0], e1[1], R.top), i1, i0);
      if (k % 4 === 0) { S.color(WHITE); S.beam(P(e0[0], e0[1], R.top), i0, frameW * 1.2, frameW * 1.2); }
    }
    // drum: glass between columns, a cornice ring
    for (let k = 0; k < segs; k++) {
      gquad(ring(r, y1, k), ring(r, y1, k + 1), ring(r, y2, k + 1), ring(r, y2, k));
      S.color(WHITE); S.beam(ring(r, y1, k), ring(r, y2, k), frameW * 1.6, frameW * 1.6);
      S.beam(ring(r + .2, y1, k), ring(r + .2, y1, k + 1), frameW * 2, frameW * 2);
      S.color(GREEN); S.beam(ring(r + .4, y2, k), ring(r + .4, y2, k + 1), frameW * 3, frameW * 2.5);
    }
    // the dome: rings of glass up to the lantern, white ribs
    const nr = 9, top = 80 * Math.PI / 180;
    const dp = (j, k) => { const e = top * j / nr, rr = r * Math.cos(e); return ring(rr, y2 + rise * Math.sin(e), k); };
    for (let j = 0; j < nr; j++) for (let k = 0; k < segs; k++) gquad(dp(j, k), dp(j, k + 1), dp(j + 1, k + 1), dp(j + 1, k));
    S.color(WHITE);
    for (let k = 0; k < segs; k += 2) for (let j = 0; j < nr; j++) S.beam(dp(j, k), dp(j + 1, k), frameW * 1.8, frameW * 1.8);
    for (let j = 2; j < nr; j += 2) for (let k = 0; k < segs; k++) S.beam(dp(j, k), dp(j, k + 1), frameW, frameW);
    // lantern, its cupola and a finial
    const lr = r * Math.cos(top), ly = y2 + rise * Math.sin(top), lh = D.lanternM ?? 8, ls = 16;
    for (let k = 0; k < ls; k++) {
      const a0 = k / ls * TAU, a1 = (k + 1) / ls * TAU, q = (rr, y, a) => P(cu + Math.cos(a) * rr, cv + Math.sin(a) * rr, y);
      gquad(q(lr, ly, a0), q(lr, ly, a1), q(lr, ly + lh, a1), q(lr, ly + lh, a0));
      S.color(WHITE); S.beam(q(lr, ly, a0), q(lr, ly + lh, a0), frameW * 1.4, frameW * 1.4);
      S.color(GREEN);
      for (let j = 0; j < 4; j++) {
        const e0 = j / 4 * Math.PI / 2, e1 = (j + 1) / 4 * Math.PI / 2;
        S.quad(q(lr * Math.cos(e0) + .3, ly + lh + lr * .7 * Math.sin(e0), a0), q(lr * Math.cos(e0) + .3, ly + lh + lr * .7 * Math.sin(e0), a1),
          q(lr * Math.cos(e1) + .3, ly + lh + lr * .7 * Math.sin(e1), a1), q(lr * Math.cos(e1) + .3, ly + lh + lr * .7 * Math.sin(e1), a0));
      }
    }
    const fy = ly + lh + lr * .7;
    S.color('#c9a646'); S.cylinder(P(cu, cv, 0).x, fy, P(cu, cv, 0).z, .6, 7, 6, .05);
    R.domeTop = fy + 7; R.domeC = [cu, cv]; R.domeR = r; R.domeY = y2;
  }

  // ---- beds: soil under the planting, everywhere but the walk strip along the path (and plazas)
  const zones = (spec.themes || []).map((z) => ({ ...z, u0: z.rect[0], u1: z.rect[1], v0: z.rect[2], v1: z.rect[3] }));
  const themeAt = (u, v) => { const z = zones.find((q) => inRect(q, u, v)); return z ? z.theme : null; };
  const plazas = (spec.plazas || []).map((p) => ({ u: p[0], v: p[1], r: p[2] }));
  const features = [];   // circles kept clear of planting: [u, v, r]
  const benchCells = new Map();   // benches (10 m cells): 2 m kept clear round each
  const walk = spec.walkM ?? 6;
  const cell = 2;
  const bedRegion = (u, v) => {
    const t = themeAt(u, v); if (!t) return null;
    const theme = THEMES[t]; if (!theme) return null;
    const inFoot = inRing(F.foot, u, v);
    if (inFoot && F.rooms.every((R) => !inRect(R, u, v, -2))) return null;   // a hair off the walls
    const d = rdist(u, v).d;
    if (d < walk || (!inFoot && pdist(u, v).d > (spec.gardenM ?? 14.5))) return null;
    if (plazas.some((p) => Math.hypot(p.u - u, p.v - v) < p.r) || features.some((f) => Math.hypot(f[0] - u, f[1] - v) < f[2])) return null;
    if (rectClears.some((r) => u > r[0] && u < r[1] && v > r[2] && v < r[3])) return null;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const bn of benchCells.get(`${Math.floor(u / 10) + a},${Math.floor(v / 10) + c}`) || []) if (Math.hypot(bn.bu - u, bn.bv - v) < 2) return null;
    if (!inFoot) {   // out in the gardens: clear of the city's own buildings, streets and paths (and their furniture)
      const q = F.toXZ(u, v);
      if (city.buildingNear?.(q.x, q.z, 2) || L.streetAt?.(q.x, q.z, 3)) return null;
    }
    return { t, theme, d };
  };

  // features: the palm court's fountain, the waterfall, pools
  const rectClears = [];
  for (const f of spec.features || []) {
    if (f.size) rectClears.push([f.at[0] - f.size[1] / 2 - 1.5, f.at[0] + f.size[1] / 2 + 1.5, f.at[1] - f.size[0] / 2 - 1.5, f.at[1] + f.size[0] / 2 + 1.5]);
    else features.push([f.at[0], f.at[1], f.clearM ?? f.r ?? 6]);
  }
  for (const a of spec.art || []) if (a.kind === 'spires') features.push([a.at[0], a.at[1], (a.r ?? 3) + 1.5]);
  const art = [];
  for (const f of spec.features || []) {
    const [fu, fv] = f.at, gy = ground(fu, fv);
    if (f.kind === 'fountain') {
      const r = f.r ?? 6;
      S.color(STONE);
      for (let k = 0; k < 24; k++) { const a0 = k / 24 * TAU, a1 = (k + 1) / 24 * TAU;
        S.beam(P(fu + Math.cos(a0) * r, fv + Math.sin(a0) * r, gy + .5), P(fu + Math.cos(a1) * r, fv + Math.sin(a1) * r, gy + .5), .6, 1.0); }
      S.cylinder(P(fu, fv, 0).x, gy, P(fu, fv, 0).z, 1.2, 3.2, 10, .8);
      S.cylinder(P(fu, fv, 0).x, gy + 3.2, P(fu, fv, 0).z, 2.6, .5, 12, 2.6);
      disc(W, fu, fv, gy + .7, r - .3);
      // jets: thin cones of falling water
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; jet(W, fu + Math.cos(a) * 1.8, fv + Math.sin(a) * 1.8, gy + 3.6, fu + Math.cos(a) * 4.2, fv + Math.sin(a) * 4.2, gy + .8, 5); }
      jet(W, fu, fv, gy + 3.7, fu, fv, gy + 9, 0);
    } else if (f.kind === 'waterfall') {
      // a rock cliff with water falling off its face into a pool (yawDeg: which way it faces)
      const yaw = (f.faceDeg ?? 0) * Math.PI / 180, cx = Math.cos(yaw), cy = Math.sin(yaw), h = f.heightM ?? 16, w = f.widthM ?? 9;
      const back = [fu - cx * (f.r ?? 6) - cx * 5, fv - cy * (f.r ?? 6) - cy * 5];
      S.color('#8e8574');
      for (const [o, s, hh] of [[0, 1, 1], [.45, .8, .75], [-.5, .75, .7], [.9, .55, .45], [-.95, .6, .5]]) {
        const q = P(back[0] - cy * o * w, back[1] + cx * o * w, 0);
        rockBlob(S, q.x, gy - 1, q.z, 7 * s, h * hh, 6 * s, rand);
      }
      const lip = [back[0] + cx * 4.2, back[1] + cy * 4.2], pool = [fu, fv];
      disc(W, pool[0], pool[1], gy + .25, f.r ?? 6);
      S.color(STONE);
      for (let k = 0; k < 24; k++) { const a0 = k / 24 * TAU, a1 = (k + 1) / 24 * TAU, r = (f.r ?? 6) + .3;
        S.beam(P(fu + Math.cos(a0) * r, fv + Math.sin(a0) * r, gy + .2), P(fu + Math.cos(a1) * r, fv + Math.sin(a1) * r, gy + .2), .7, .6); }
      // the falling sheet: a curved ribbon from the lip down to the pool
      const steps = 10;
      for (let j = 0; j < steps; j++) {
        const t0 = j / steps, t1 = (j + 1) / steps;
        const at = (t, side) => {
          const out_ = 1.2 + 2.6 * t * t, y = gy + h * .92 * (1 - t) + .3;
          return P(lip[0] + cx * out_ - cy * side * w * .45, lip[1] + cy * out_ + cx * side * w * .45, y);
        };
        W.color('#d8f2f6');
        const k0 = W.vertex(...at(t0, -1).toArray(), cx, 0, cy, 1, t0 * h), k1 = W.vertex(...at(t0, 1).toArray(), cx, 0, cy, 1, t0 * h);
        const k2 = W.vertex(...at(t1, 1).toArray(), cx, 0, cy, 1, t1 * h), k3 = W.vertex(...at(t1, -1).toArray(), cx, 0, cy, 1, t1 * h);
        W.tri(k0, k1, k2); W.tri(k0, k2, k3);
      }
    } else if (f.kind === 'pool') {
      const [w, l] = f.size || [10, 30];
      S.color(STONE);
      const c = [[fu - l / 2, fv - w / 2], [fu + l / 2, fv - w / 2], [fu + l / 2, fv + w / 2], [fu - l / 2, fv + w / 2]];
      for (let k = 0; k < 4; k++) S.beam(P(...c[k], gy + .25), P(...c[(k + 1) % 4], gy + .25), .6, .7);
      const y = gy + .35;
      W.color('#3f8f96');
      const q = c.map(([u, v]) => P(u, v, y)), k0 = q.map((p, k) => W.vertex(p.x, p.y, p.z, 0, 1, 0, 0, k < 2 ? 0 : w));
      W.tri(k0[0], k0[2], k0[1]); W.tri(k0[0], k0[3], k0[2]);
      // floating glass globes and lily discs on it
      for (let k = 0; k < (f.globes ?? 9); k++) art.push({ kind: 'globe', u: fu - l / 2 + 2 + rand() * (l - 4), v: fv - w / 2 + 1.5 + rand() * (w - 3), y: y + .25, s: .7 + rand() * .7 });
    }
  }

  // soil quads (a 2 m grid), per theme colour
  {
    const [bu0, bu1, bv0, bv1] = ringBox(F.foot, spec.gardenBox);
    for (let u = bu0; u < bu1; u += cell) for (let v = bv0; v < bv1; v += cell) {
      if (v === bv0 && due()) yield;
      const b = bedRegion(u + cell / 2, v + cell / 2); if (!b) continue;
      let col = b.theme.soil;
      if (b.theme.parterre) col = Math.floor((u + v) / 8) % 2 ? '#5a4632' : '#4c3a29';
      const ys = [[u, v], [u + cell, v], [u + cell, v + cell], [u, v + cell]].map(([a, c]) => ground(a, c) + .07);
      Bd.color(col);
      Bd.quad(P(u, v, ys[0]), P(u, v + cell, ys[3]), P(u + cell, v + cell, ys[2]), P(u + cell, v, ys[1]));
    }
  }

  // ---- benches along the walk strip, facing the path (placed before the planting: beds keep clear of them)
  const benches = [];
  for (const run of runs) for (let k = 4; k < run.length - 4; k += 5) {
    const p = run[k], q = run[k + 1];
    const du = q.u - p.u, dv = q.v - p.v, l = Math.hypot(du, dv) || 1, side = (k / 5) % 2 ? 1 : -1;
    const nu = -dv / l * side, nv = du / l * side, bu = p.u + nu * (walk + .5), bv = p.v + nv * (walk + .5);
    if (rdist(bu, bv).d < walk || !bedRegion(bu + nu * 1.5, bv + nv * 1.5)) continue;
    benches.push({ bu, bv, p, q, side });
  }
  for (const bn of benches) { const k = `${Math.floor(bn.bu / 10)},${Math.floor(bn.bv / 10)}`; if (!benchCells.has(k)) benchCells.set(k, []); benchCells.get(k).push(bn); }
  S.color('#7a5634');
  for (const bn of benches) {
    const { bu, bv, p, q } = bn;
    const gy = ground(bu, bv), c = P(bu, bv, 0), w0 = P(p.u, p.v, 0), w1 = P(q.u, q.v, 0), yaw = Math.atan2(w1.x - w0.x, w1.z - w0.z);
    // the back on the side away from the path (n: from the path to the bench, in the scene; F118: it was on the
    // path's side in this frame, so a bench faced the beds)
    let nx = c.x - w0.x, nz = c.z - w0.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const ax = Math.sin(yaw), az = Math.cos(yaw), d = nx * ax + nz * az;
    nx -= ax * d; nz -= az * d; const nl2 = Math.hypot(nx, nz) || 1; bn.nx = nx / nl2; bn.nz = nz / nl2;
    S.box(c.x, gy + .42, c.z, .55, .12, 2.2, yaw);
    S.box(c.x + bn.nx * .28, gy + .54, c.z + bn.nz * .28, .08, .45, 2.2, yaw);
    for (const o of [-.9, .9]) S.box(c.x + Math.sin(yaw) * o, gy, c.z + Math.cos(yaw) * o, .5, .42, .12, yaw);
  }

  // ---- planting
  const models = plantModels(), pmat = city.own(plantMaterial(night));
  const inst = {};   // model → [{u, v, y, h, yaw, tint}]
  const put = (model, u, v, h, tint, yaw = rand() * TAU, y = ground(u, v), d = Infinity) => { (inst[model] ||= []).push({ u, v, y, h, yaw, tint, d }); };
  for (const [name, th] of Object.entries(THEMES)) {
    for (const [li, ly] of th.layers.entries()) {
      const sp = ly.spacing, [bu0, bu1, bv0, bv1] = ringBox(F.foot, spec.gardenBox);
      for (let u = bu0 + sp / 2; u < bu1; u += sp) for (let v = bv0 + sp / 2; v < bv1; v += sp) {
        if (v === bv0 + sp / 2 && due()) yield;
        const ju = ly.grid ? u : u + (rand() - .5) * sp * .8, jv = ly.grid ? v : v + (rand() - .5) * sp * .8;
        const b = bedRegion(ju, jv); if (!b || b.t !== name) continue;
        if (b.d < ly.band[0] || (ly.band[1] != null && b.d > ly.band[1])) continue;
        if ((ly.share ?? 1) < 1 && rand() > ly.share) continue;
        // tall plants keep off the walls (their crowns) and off the path's airspace
        const R = F.rooms.find((q) => inRect(q, ju, jv));
        const h = ly.h[0] + rand() * (ly.h[1] - ly.h[0]);
        if (R && h > 4) { const wd = Math.min(ju - R.u0, R.u1 - ju, jv - R.v0, R.v1 - jv); if (wd < Math.min(10, h * .32)) continue; }
        if (h > 4 && b.d < h * .33 + 4) continue;
        let tint;
        const pal = BLOOMS[ly.pal] || BLOOMS.leaf;
        if (ly.pal === 'summer' && th.parterre) tint = pal[Math.floor((jv - bv0) / 4.5 + Math.floor((ju - bu0) / 14)) % pal.length];
        else if (ly.pal === 'summer' || ly.pal === 'warm') tint = pal[Math.floor(vnoise(ju * .12 + li, jv * .12) * pal.length * 1.6) % pal.length];
        else tint = pal[Math.floor(rand() * pal.length)];
        put(ly.model, ju, jv, h, tint, undefined, undefined, b.d);
      }
    }
  }
  const meshes = [];
  for (const [model, list] of Object.entries(inst)) {
    const geo = city.own(models[model]); geo.computeBoundingBox();
    const unitH = Math.max(.01, geo.boundingBox.max.y), bbx = geo.boundingBox;
    let rxz = .01;   // (the furthest leaf tip from the stem, any direction)
    { const pa = geo.attributes.position.array; for (let i = 0; i < pa.length; i += 3) rxz = Math.max(rxz, Math.hypot(pa[i], pa[i + 2])); }
    void bbx;
    const mesh = new THREE.InstancedMesh(geo, pmat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach((p, k) => {
      // low plants never spread over the walk strip (tall ones' crowns may, high overhead)
      let s = p.h / unitH;
      if (p.h < 12 && s * rxz * 1.12 > p.d - walk) s = Math.max(.05, (p.d - walk) / (rxz * 1.12));   // (×1.12: the instances' stretch)
      const at = P(p.u, p.v, p.y + .09);   // (on the bed's soil)
      q.setFromAxisAngle(V(0, 1, 0), p.yaw);
      m.compose(at, q, V(s * (.9 + (k % 5) * .05), s, s * (.9 + (k % 3) * .07)));
      mesh.setMatrixAt(k, m); mesh.setColorAt(k, c.set(p.tint));
    });
    mesh.name = `Glasshouse plants: ${model}`;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.computeBoundingSphere?.();
    meshes.push(mesh);
    if (due()) yield;
  }

  // ---- hanging glass art: chandeliers in the palm court, coils over the lanes, spires in the beds
  for (const a of spec.art || []) {
    if (a.kind === 'chandelier') {
      const [cu, cv] = a.at, y0 = ground(cu, cv) + (a.y ?? 40), n = a.n ?? 70;
      for (let k = 0; k < n; k++) {
        const ang = rand() * TAU, rr = Math.sqrt(rand()) * (a.r ?? 9), drop = rand() * (a.dropM ?? 16);
        art.push({ kind: 'drop', u: cu + Math.cos(ang) * rr, v: cv + Math.sin(ang) * rr, y: y0 - drop, s: 1.2 + rand() * 1.4 });
      }
      art.push({ kind: 'rod', u: cu, v: cv, y: y0, top: a.hangFrom != null ? ground(cu, cv) + a.hangFrom : y0 + 20 });
    } else if (a.kind === 'coils') {
      // clusters along a line high over the path
      const [p0, p1] = a.line, n = a.n ?? 6;
      for (let k = 0; k < n; k++) {
        const t = (k + .5) / n, cu = p0[0] + (p1[0] - p0[0]) * t, cv = p0[1] + (p1[1] - p0[1]) * t;
        const gy = ground(cu, cv), y = gy + (a.y ?? 20);
        for (let j = 0; j < 14; j++) art.push({ kind: j % 3 ? 'drop' : 'coil', u: cu + (rand() - .5) * 5, v: cv + (rand() - .5) * 5, y: y - rand() * 4, s: .8 + rand() * 1 });
        art.push({ kind: 'rod', u: cu, v: cv, y, top: a.hangFrom != null ? gy + a.hangFrom : y + 10 });
      }
    } else if (a.kind === 'spires') {
      const [cu, cv] = a.at, n = a.n ?? 9;
      for (let k = 0; k < n; k++) { const ang = rand() * TAU, rr = rand() * (a.r ?? 3); art.push({ kind: 'spire', u: cu + Math.cos(ang) * rr, v: cv + Math.sin(ang) * rr, y: ground(cu, cv), s: (a.h ?? 6) * (.6 + rand() * .6) }); }
    }
  }
  const ART = ['#ff4f6d', '#ffb32b', '#36c5f0', '#7a5cff', '#2ee6a6', '#ff7ad9', '#ffe14d', '#3a7bff', '#ff6a2b'];
  for (const a of art) {
    const c = ART[Math.floor(rand() * ART.length)], g = a.y != null ? a.y : 0, base = P(a.u, a.v, 0);
    const baseY = g;
    A.color(c);
    if (a.kind === 'drop') { A.cylinder(base.x, baseY - a.s * 1.6, base.z, a.s * .05, a.s * 1.6, 6, a.s * .45); A.cylinder(base.x, baseY - a.s * 2.4, base.z, a.s * .05, a.s * .8, 6, a.s * .45); }
    else if (a.kind === 'coil') { for (let j = 0; j < 8; j++) { const t0 = j / 8 * TAU * 1.5, t1 = (j + 1) / 8 * TAU * 1.5; A.beam(V(base.x + Math.cos(t0) * a.s, baseY - j * .35 * a.s, base.z + Math.sin(t0) * a.s), V(base.x + Math.cos(t1) * a.s, baseY - (j + 1) * .35 * a.s, base.z + Math.sin(t1) * a.s), .28 * a.s, .28 * a.s); } }
    else if (a.kind === 'spire') A.cylinder(base.x, baseY, base.z, .35, a.s, 6, .02);
    else if (a.kind === 'globe') sphere(A, base.x, baseY, base.z, a.s * .5);
    else if (a.kind === 'rod') { A.color('#d8d8d8'); A.beam(V(base.x, a.y, base.z), V(base.x, a.top, base.z), .12, .12); }
  }

  // ---- [F116] path lamps: low lantern posts along the walk strip (glass globes, lit after dark), with glows and
  // pools of light on the path at night (the city's night-only lists)
  const lamps = [];
  {
    const every = spec.lampEveryM ?? 16, off = walk - .7;
    const wallClear = (u, v) => {
      if (!inRing(F.foot, u, v)) return ringDist(F.foot, u, v) > 3;
      if (ringDist(F.foot, u, v) < 3) return false;
      for (const R of F.rooms) if (inRect(R, u, v) && Math.min(u - R.u0, R.u1 - u, v - R.v0, R.v1 - v) < 3) return false;
      return (spec.partitions || []).every(([a, b]) => segDist(u, v, a, b) > 3);
    };
    let k = 0;
    for (const run of runsOf(own)) for (let j = 1; j < run.length - 1; j++) {
      const p = run[j];
      if (Math.floor(p.s / every) === Math.floor(run[j - 1].s / every)) continue;
      const a = run[j - 1], b = run[j + 1], du = b.u - a.u, dv = b.v - a.v, l = Math.hypot(du, dv) || 1, side = k++ % 2 ? 1 : -1;
      const u = p.u - dv / l * off * side, v = p.v + du / l * off * side;
      if (rdist(u, v).d < walk - 1.2 || !wallClear(u, v)) continue;
      if (benches.some((bn) => Math.hypot(bn.bu - u, bn.bv - v) < 2.6)) continue;
      if (features.some((f) => Math.hypot(f[0] - u, f[1] - v) < f[2] - 1)) continue;
      const gy = ground(u, v), q = P(u, v, gy);
      if ((city.lamps || []).some((l) => Math.abs(l.x - q.x) < 4 && Math.abs(l.z - q.z) < 4)) continue;   // (outside: the city's route lamps already stand there)
      lamps.push({ u, v, x: q.x, y: gy, z: q.z, path: P(p.u - dv / l * 1.4 * side, p.v + du / l * 1.4 * side, p.y) });
    }
    for (const lp of lamps) {
      S.color('#2f4a3c'); S.cylinder(lp.x, lp.y, lp.z, .11, .2, 6, .09); S.cylinder(lp.x, lp.y + .2, lp.z, .06, 1.05, 6, .05);
      S.cylinder(lp.x, lp.y + 1.25, lp.z, .14, .05, 6, .14);
      A.color('#fff1c8'); sphere(A, lp.x, lp.y + 1.48, lp.z, .2);
    }
  }
  if (lamps.length && city.addGlows) {
    city.addGlows(lamps.map((lp) => ({ x: lp.x, y: lp.y + 1.48, z: lp.z, size: 2.4, color: '#ffd9a0' })), 'Glasshouse lamp glows');
    if (city.poolMaterial) {
      const geo = city.own(new THREE.PlaneGeometry(1, 1)); geo.rotateX(-Math.PI / 2);
      const pools = new THREE.InstancedMesh(geo, city.poolMaterial, lamps.length), m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();
      lamps.forEach((lp, i) => pools.setMatrixAt(i, m4.compose(V(lp.path.x, lp.path.y + .12, lp.path.z), q0, V(9, 1, 9))));
      pools.instanceMatrix.needsUpdate = true; pools.computeBoundingSphere(); pools.name = 'Glasshouse lamp pools'; pools.renderOrder = 3;
      pools.visible = night.value > .01;
      (city.nightOnly ||= []).push(pools); meshes.push(pools);
    }
  }
  // the chandelier and the dome lit at night: big soft glows inside the glass
  if (city.addGlows) {
    const big = [];
    for (const a of spec.art || []) if (a.kind === 'chandelier') { const q = P(a.at[0], a.at[1], ground(a.at[0], a.at[1]) + (a.y ?? 40) - (a.dropM ?? 16) * .4); big.push({ x: q.x, y: q.y, z: q.z, size: (a.r ?? 9) * 4.5, color: '#ffe0b0' }); }
    for (const R of F.rooms) if (R.domeC) { const q = P(R.domeC[0], R.domeC[1], R.domeY + R.domeR * .5); big.push({ x: q.x, y: q.y, z: q.z, size: R.domeR * 2.6, color: '#ffcf96' }); }
    if (big.length) city.addGlows(big, 'Glasshouse night glow');
  }

  // ---- [F118] visitors: sitting on the benches, standing at the fountain, the pools and the glass art (one draw)
  const visitors = [];
  {
    const vr = randomSequence((spec.seed ?? 1871) + 7);
    for (const bn of benches) {
      const roll = vr(); if (roll > (spec.benchSitters ?? .85)) continue;
      const gy = ground(bn.bu, bn.bv), c = P(bn.bu, bn.bv, 0), w0 = P(bn.p.u, bn.p.v, 0), w1 = P(bn.q.u, bn.q.v, 0), yaw = Math.atan2(w1.x - w0.x, w1.z - w0.z);
      // the bench's back is away from the path (bn.n); a sitter faces the path
      const bx = bn.nx, bz = bn.nz, ax = Math.sin(yaw), az = Math.cos(yaw);
      const fy = Math.atan2(-bx, -bz), seats = roll < .25 ? [-.55, .55] : [(vr() - .5) * 1.2];
      for (const o of seats) visitors.push({ look: randomLook(vr, { kids: .12 }), x: c.x + ax * o - bx * .06, y: gy + .05, z: c.z + az * o - bz * .06, yaw: fy, clip: CLIP.sit, phase: vr(), rate: 1 / 7 });
    }
    // standing: round the features' rims, facing them (never on the path)
    const spots = [];
    for (const f of spec.features || []) {
      if (f.kind === 'pool') { const [w, l] = f.size || [10, 30]; for (let k = 0; k < 8; k++) spots.push({ u: f.at[0] - l / 2 + (k + .5) * l / 8, v: f.at[1] + (k % 2 ? 1 : -1) * (w / 2 + .9), fu: f.at[0] - l / 2 + (k + .5) * l / 8, fv: f.at[1] }); }
      else { const r = (f.r ?? 6) + 1.1; for (let k = 0; k < 14; k++) { const a = k / 14 * TAU; spots.push({ u: f.at[0] + Math.cos(a) * r, v: f.at[1] + Math.sin(a) * r, fu: f.at[0], fv: f.at[1] }); } }
    }
    for (const a of spec.art || []) if (a.kind === 'spires') { const r = (a.r ?? 3) + 1.3; for (let k = 0; k < 6; k++) { const t = k / 6 * TAU; spots.push({ u: a.at[0] + Math.cos(t) * r, v: a.at[1] + Math.sin(t) * r, fu: a.at[0], fv: a.at[1] }); } }
    const clips = [CLIP.look, CLIP.photo, CLIP.idle, CLIP.phone];
    for (const sp of spots) {
      if (vr() > (spec.standers ?? .45) || rdist(sp.u, sp.v).d < 4.6) continue;
      if (visitors.some((o) => Math.hypot(o.u - sp.u, o.v - sp.v) < .9)) continue;
      const q = P(sp.u, sp.v, 0), t = P(sp.fu, sp.fv, 0);
      visitors.push({ u: sp.u, v: sp.v, look: randomLook(vr, { kids: .15 }), x: q.x, y: ground(sp.u, sp.v), z: q.z, yaw: Math.atan2(t.x - q.x, t.z - q.z) + (vr() - .5) * .5, clip: clips[Math.floor(vr() * clips.length)], phase: vr(), rate: undefined });
    }
  }
  if (visitors.length) {
    const vm = city.own(figureMaterial(uTime));
    // (named as people: city life to the clipping QC — sitters sit on the benches, they don't stand in them)
    const crowd = staticCrowdMesh(visitors, vm, 'People · glasshouse visitors', 'hi');
    city.own(crowd.geometry); meshes.push(crowd);
  }

  // ---- meshes
  const add = (builder, mat, name, opts = {}) => {
    if (!builder.count) return null;
    const mesh = new THREE.Mesh(city.own(builder.geometry()), mat);
    mesh.name = name; Object.assign(mesh.userData, opts.userData || {});
    mesh.castShadow = !!opts.cast; mesh.receiveShadow = opts.receive !== false;
    if (opts.renderOrder != null) mesh.renderOrder = opts.renderOrder;
    meshes.push(mesh); return mesh;
  };
  add(S, city.own(frameMaterial(night)), 'Glasshouse frames', { userData: { bake: false } });
  add(Bd, city.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide })), 'Glasshouse beds', { renderOrder: 1, userData: { bake: false } });
  add(A, city.own(artMaterial(night)), 'Glasshouse glass art', { userData: { bake: false } });
  add(W, city.own(waterMaterial(uTime)), 'Glasshouse water', { userData: { bake: false } });
  add(G, city.own(glassMaterial(night)), 'Glasshouse glass', { renderOrder: 5, receive: false, userData: { bake: false } });
  const group = new THREE.Group(); group.name = `Glasshouse · ${spec.name || 'glasshouse'}`;
  for (const m of meshes) group.add(m);
  city.group.add(group);
  out.meshes.push(...meshes);
  const domes = F.rooms.filter((R) => R.domeC).map((R) => { const q = F.toXZ(...R.domeC); return { x: q.x, z: q.z, r: R.domeR, m: spec.lookUpM ?? 3 }; });
  return { F, group, rooms: F.rooms, domes, lamps: lamps.length, visitors: visitors.length, benches: benches.map((b) => [b.bu, b.bv]),
    instances: Object.fromEntries(Object.entries(inst).map(([k, v]) => [k, v.length])) };
}

/** A low-poly sphere (6 rings × 8) into a MeshBuilder. */
function sphere(B, x, y, z, r) {
  const n = 8, m = 6, at = (i, j) => { const t = Math.PI * j / m, a = TAU * i / n; return V(x + Math.sin(t) * Math.cos(a) * r, y + Math.cos(t) * r, z + Math.sin(t) * Math.sin(a) * r); };
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) B.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
}
function ringBox(ring, extra) {
  if (extra) return extra;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [u, v] of ring) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return [Math.floor(u0 - 20), Math.ceil(u1 + 20), Math.floor(v0 - 20), Math.ceil(v1 + 20)];
}
function rockBlob(S, x, y, z, w, h, d, rand) {
  // a faceted boulder: an 8-sided prism with a pinched top
  const n = 8, pts = [];
  for (let k = 0; k < n; k++) { const a = k / n * TAU, j = .8 + rand() * .35; pts.push([Math.cos(a) * w / 2 * j, Math.sin(a) * d / 2 * j]); }
  const top = y + h;
  for (let k = 0; k < n; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % n];
    S.quad(V(x + ax, y, z + az), V(x + bx, y, z + bz), V(x + bx * .55, top - h * .12 * ((k % 3) / 2), z + bz * .55), V(x + ax * .55, top - h * .12 * (((k + 2) % 3) / 2), z + az * .55));
    S.triangle(V(x + ax * .55, top - h * .12 * (((k + 2) % 3) / 2), z + az * .55), V(x + bx * .55, top - h * .12 * ((k % 3) / 2), z + bz * .55), V(x, top + h * .05, z));
  }
}
