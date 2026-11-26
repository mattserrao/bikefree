// NYC's landmarks: Central Park's (user, 25 Nov 2026: "a very detailed recreation of Central Park … Ensure high detailed
// landmarks are made and visible so the park is immediately familiar"; chose the heart of the park, the middle park, the
// south end, the north and the Reservoir). Each model stands on its OSM outline (tools/nyc_heroes.py →
// routes/cities/nyc-heroes.json), sized and turned from it, in the landmarks' shared builders (S: solid, N: lit, Wa:
// water — js/world/toolbox/city/pgh-landmarks.js puts them in the scene).
//
//   the heart     Bethesda Terrace (the arcade under the drive, the stairs, the balustrades) and the fountain with the
//                 Angel of the Waters; Bow Bridge; the Loeb Boathouse and its rowboats; the Bandshell; Cherry Hill
//   middle        Belvedere Castle on Vista Rock; the Delacorte Theater; Cleopatra's Needle; the Swedish Cottage
//   south         Gapstow Bridge; Wollman Rink; the Carousel; the Dairy; Strawberry Fields' Imagine mosaic; Columbus
//                 Circle's column and the USS Maine Monument; the Pulitzer Fountain
//   north         the Reservoir's iron fence; the Conservatory Garden and the Vanderbilt Gate; the Dana Center on the
//                 Harlem Meer; Blockhouse No. 1
//   the park      the low stone wall round it with its entrances closed by iron gates (user: "the player cannot freeplay
//                 navigate outside it"); the park's lampposts and benches along the drives and paths; people picnicking
//                 on Sheep Meadow and the Great Lawn; rowboats on the Lake, ducks on the ponds, squirrels on the lawns
//
//   Object.assign(M, nycLandmarkModels(ctx)); … nycPark(ctx, data.park) → { tick(time) }
import * as THREE from '../../../../vendor/three.js';
import { litMaterial } from '../materials/lit.js';
import { V, TAU, centroid, scaleRing, orient, inPoly, prism, cap, block, frameOf, makeFrame, lathe, gable } from './hero-geom.js';

const SCHIST = '#7c7870', SANDSTONE = '#c8b48d', LIMESTONE = '#d8ccb2', BRONZE = '#5d7a68', IRON = '#2c3a33', GILT = '#d2a634', BRICK = '#8c5a45';
const hsh = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function nycLandmarkModels({ S, N, glows, plan, ground, local, L, Wa = null }) {
  const H = (x, z) => L.heightAt(x, z);
  const QC = (L.qc ||= { basins: [], benches: [], bridges: [], views: [] });   // (what tools/qc-map.js checks)
  /** A bronze figure (a standing person, roughly) on a plinth at q. */
  const figure = (q, g, { plinth = 2, h = 2.2, color = BRONZE, stone = LIMESTONE, wings = false, yaw = 0 } = {}) => {
    S.color(stone); S.box(q.x, g, q.z, 1.8, .4, 1.8, yaw); S.box(q.x, g + .4, q.z, 1.3, plinth, 1.3, yaw);
    const y = g + .4 + plinth;
    S.color(color); S.cylinder(q.x, y, q.z, .38, h * .55, 8, .24); S.cylinder(q.x, y + h * .55, q.z, .26, h * .28, 8, .2); S.cylinder(q.x, y + h * .83, q.z, .16, h * .17, 8, .12);
    if (wings) for (const s of [-1, 1]) S.beam(V(q.x, y + h * .75, q.z), V(q.x + Math.cos(yaw) * s * 1.3, y + h * 1.05, q.z - Math.sin(yaw) * s * 1.3), .08, .9);
  };
  /** A balustrade from a to b (Vector3s at the walk's level): a rail on little turned balusters. */
  const balustrade = (a, b, color = SANDSTONE, h = 1) => {
    S.color(color); S.beam(V(a.x, a.y + h, a.z), V(b.x, b.y + h, b.z), .3, .14); S.beam(V(a.x, a.y + .05, a.z), V(b.x, b.y + .05, b.z), .34, .12);
    const n = Math.max(1, Math.round(a.distanceTo(b) / .45));
    for (let k = 1; k < n; k++) { const t = k / n; S.cylinder(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + .17, a.z + (b.z - a.z) * t, .08, h - .17, 5, .06); }
  };
  /** A basin of water (a fountain's): a stone rim r round q, water a little below its lip. */
  const basin = (q, y, r, rim = .6, color = SANDSTONE, name = 'basin') => {
    QC.basins.push({ x: q.x, z: q.z, name, water: !!Wa });
    S.color(color); lathe(S, q.x, y, q.z, [[r + .35, 0], [r + .35, rim], [r, rim], [r, .1], [0, .1]], 28);
    if (Wa) { Wa.color('#4f7f8c'); lathe(Wa, q.x, y + rim - .15, q.z, [[r - .02, 0], [0, 0.001]], 28); }
  };
  /** The Lake's direction from a point (toward its pool's middle) — the terrace and the boathouse face it. */
  const lakewardOf = (q, re = /Lake/) => {
    // toward the nearest point of the named pool's shore (its outline; else its box's middle)
    let best = null;
    for (const p of L.pools || []) {
      if (!re.test(p.name || '')) continue;
      for (const r of p.ring || [{ x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2 }]) { const d = Math.hypot(r.x - q.x, r.z - q.z); if (!best || d < best.d) best = { d, x: r.x - q.x, z: r.z - q.z }; }
    }
    if (!best) return { x: 0, z: -1 };
    const l = Math.hypot(best.x, best.z) || 1; return { x: best.x / l, z: best.z / l };
  };
  const lakeward = (q) => lakewardOf(q);
  /** The way's own bridge deck nearest the landmark (within r m): its line every ~2 m, at the road's surface, with
   *  its normal — a bridge model is built on it and the world draws no deck of its own there (profile.modelBridges). */
  const deckOf = (l, r) => {
    const c = local(l.center[0], l.center[1]);
    let best = null;
    for (const e of L.edges || []) for (const [a, b] of e.bridges || []) for (let i = a; i <= b; i++) { const d = Math.hypot(e.x[i] - c.x, e.z[i] - c.z); if (d < r && (!best || d < best.d)) best = { d, e, a, b }; }
    if (!best) return null;
    const { e, a, b } = best, pts = [];
    let s0 = 0;
    for (let i = a; i < b; i++) for (let k = 0; k < 5; k++) {
      const f = k / 5, x = e.x[i] + (e.x[i + 1] - e.x[i]) * f, z = e.z[i] + (e.z[i + 1] - e.z[i]) * f, y = e.ele[i] + (e.ele[i + 1] - e.ele[i]) * f + .12;
      if (pts.length) s0 += Math.hypot(x - pts[pts.length - 1].x, z - pts[pts.length - 1].z);
      pts.push({ x, y, z, s: s0 });
    }
    { const x = e.x[b], z = e.z[b]; s0 += Math.hypot(x - pts[pts.length - 1].x, z - pts[pts.length - 1].z); pts.push({ x, y: e.ele[b] + .12, z, s: s0 }); }
    for (let k = 0; k < pts.length; k++) { const p = pts[Math.max(0, k - 1)], q = pts[Math.min(pts.length - 1, k + 1)], dx = q.x - p.x, dz = q.z - p.z, dl = Math.hypot(dx, dz) || 1; Object.assign(pts[k], { dx: dx / dl, dz: dz / dl, nx: -dz / dl, nz: dx / dl }); }
    return { e, pts, half: (L.wOf ? L.wOf(e) : 3.4) / 2 };
  };

  return {
    // Bethesda Terrace and Fountain (1873): the lower terrace round the fountain by the Lake — the Angel of the Waters
    // on two basins in a broad pool; the arcade under the drive (seven arches, the Minton tile ceiling in shadow) and the
    // Bethesda Terrace and Fountain (1873): the lower terrace, a level pad cut into the slope below Terrace Drive (the
    // world grades the ground to it: the map's pads); the arcade under the drive at its far edge — seven arches in the
    // face, the drive running over it; the grand stairs down either side of the arcade from the drive's level; sandstone
    // walls and balustrades round the cut; the fountain — the Angel of the Waters on two basins, water in both, falling
    // all round into the pool — by the Lake
    bethesda(l) {
      const ring = orient(l.ring.map(([a, o]) => local(a, o))), c = centroid(ring);
      let R = 0; for (const p of ring) R = Math.max(R, Math.hypot(p.x - c.x, p.z - c.z));
      R = Math.max(8, Math.min(16, R));
      const T = l.terrace;
      const g = T ? T.y : H(c.x, c.z);
      // the terrace frame: u from the drive toward the fountain
      let u = lakeward(c), Dr = null;
      if (T) { const d = local(T.drive[0], T.drive[1]), dx = c.x - d.x, dz = c.z - d.z, dl = Math.hypot(dx, dz) || 1; u = { x: dx / dl, z: dz / dl }; Dr = { ...d, y: T.drive[2], hw: T.drive[3], dist: dl }; }
      const F = makeFrame(c, u), v = F.v;
      // the terrace: paving over the pad, its joints, sandstone walls up the cut round its three landward sides
      if (T) {
        const P = T.ring.map(([a, o]) => local(a, o));
        S.color('#bfae8e'); block(S, P, g - .4, g + .05);
        S.color('#a89878'); for (let k = 1; k < 12; k++) { const t = k / 12, a = { x: P[0].x + (P[1].x - P[0].x) * t, z: P[0].z + (P[1].z - P[0].z) * t }, b = { x: P[3].x + (P[2].x - P[3].x) * t, z: P[3].z + (P[2].z - P[3].z) * t }; S.beam(V(a.x, g + .055, a.z), V(b.x, g + .055, b.z), .12, .01); }
        // walls where the ground stands above the terrace: up the cut, a balustrade on top
        for (let i = 0; i < P.length; i++) {
          const A = P[i], B = P[(i + 1) % P.length], len = Math.hypot(B.x - A.x, B.z - A.z), nx = (B.z - A.z) / len, nz = -(B.x - A.x) / len;
          const out = inPoly(P, (A.x + B.x) / 2 + nx * 2, (A.z + B.z) / 2 + nz * 2) ? -1 : 1;
          for (let t = 0; t < len; t += 4) {
            const t1 = Math.min(len, t + 4), a = { x: A.x + (B.x - A.x) * t / len, z: A.z + (B.z - A.z) * t / len }, b = { x: A.x + (B.x - A.x) * t1 / len, z: A.z + (B.z - A.z) * t1 / len };
            const m = { x: (a.x + b.x) / 2 + nx * out * 11.5, z: (a.z + b.z) / 2 + nz * out * 11.5 }, top = H(m.x, m.z);   // (past the cut the map grades behind the wall)
            if (i === 1 && Math.abs(t + 2 - len / 2) > 6) balustrade(V(a.x, g + .05, a.z), V(b.x, g + .05, b.z));   // (the lakeward edge: a balustrade, open at the middle to the water)
            if (top - g < .5 || L.poolAt?.(m.x, m.z) > -1e3) continue;
            S.color(SANDSTONE); S.beam(V(a.x, (g + top) / 2 - .2, a.z), V(b.x, (g + top) / 2 - .2, b.z), .7, top - g + .4);
            balustrade(V(a.x, top, a.z), V(b.x, top, b.z), SANDSTONE, .9);
          }
        }
      } else { S.color('#bfae8e'); block(S, F.rect(-R - 10, R + 4, -R - 12, R + 12), g - .4, g + .05); }
      // the fountain: the pool, the lower basin on its pedestal, the upper basin, the Angel — water in every basin
      basin(c, g + .05, R, .65, SANDSTONE, 'Bethesda pool');
      S.color(SANDSTONE); lathe(S, c.x, g + .5, c.z, [[2.6, 0], [2.2, .8], [1.4, 1.2], [1.2, 2.6], [0, 2.62]], 16);
      S.color(BRONZE); lathe(S, c.x, g + 3.1, c.z, [[.9, 0], [3.4, .55], [3.5, .8], [3.1, .85], [.6, .6]], 20);
      if (Wa) { Wa.color('#5c8c96'); lathe(Wa, c.x, g + 3.8, c.z, [[3.35, 0], [0, .001]], 20); }
      lathe(S, c.x, g + 3.7, c.z, [[.5, 0], [.4, 1.6], [1.9, 2.1], [2, 2.35], [.4, 2.2], [0, 2.21]], 16);
      if (Wa) { Wa.color('#5c8c96'); lathe(Wa, c.x, g + 5.95, c.z, [[1.9, 0], [0, .001]], 16); }
      QC.basins.push({ x: c.x + .01, z: c.z, name: 'Bethesda upper basin', water: !!Wa });
      // falling water: a sheet all the way round each basin's lip, down to the next
      S.color('#d7e6e8'); lathe(S, c.x, g + 3.95, c.z, [[3.55, 0], [3.62, -.8], [3.7, -3.2], [3.6, -3.25]].map(([r, y]) => [r, y + 0]), 28);
      lathe(S, c.x, g + 6.05, c.z, [[2.05, 0], [2.12, -.5], [2.3, -2.05]], 20);
      // the Angel: robed, wings up, one hand blessing the water
      const y = g + 5.9;
      S.color(BRONZE); S.cylinder(c.x, y, c.z, .55, 1.6, 10, .32); S.cylinder(c.x, y + 1.6, c.z, .3, .65, 10, .22); S.cylinder(c.x, y + 2.25, c.z, .18, .32, 8, .14);
      for (const s of [-1, 1]) {
        const w = V(v.x * s, 0, v.z * s);
        S.beam(V(c.x, y + 1.9, c.z), V(c.x + w.x * 1.6 - u.x * .4, y + 3.2, c.z + w.z * 1.6 - u.z * .4), .1, .85);
        S.beam(V(c.x + w.x * .3, y + 1.8, c.z + w.z * .3), V(c.x + w.x * 1.2 - u.x * .3, y + 2.4, c.z + w.z * 1.2 - u.z * .3), .08, .7);
      }
      S.beam(V(c.x, y + 1.9, c.z), V(c.x + u.x * .9, y + 2.3, c.z + u.z * .9), .14, .14);
      // the arcade under the drive: its face on the terrace's far edge, its mass under the road (the drive is its roof)
      if (Dr) {
        const face = Dr.hw + 1, top = Dr.y - .18, A = F.at(-(Dr.dist - face), 0), depth = Dr.hw * 2 + 2;
        if (top - g > 2.5) {
          S.color(SANDSTONE); S.box(A.x - u.x * depth / 2, g - .4, A.z - u.z * depth / 2, depth, top - g + .4, 30, F.yawV);
          S.color('#b39f7c'); S.box(A.x + u.x * .25, top - .55, A.z + u.z * .25, .5, .5, 30.4, F.yawV);   // the cornice
          const archH = Math.min(4.6, top - g - 1.2);
          S.color('#2b2622'); for (let k = -3; k <= 3; k++) { const q = F.at(-(Dr.dist - face) + .03, k * 3.8); S.box(q.x, g + .05, q.z, .08, archH, 2.5, F.yawV); }
          S.color('#c9b58f'); for (let k = -4; k <= 3; k++) { const q = F.at(-(Dr.dist - face) + .2, k * 3.8 + 1.9); S.box(q.x, g + .05, q.z, .4, archH + .3, .8, F.yawV); }
          // the grand stairs: down from the drive's level beside the arcade to the terrace, toward the fountain
          const rise = top - g, run = rise * 2, steps = Math.max(6, Math.round(rise / .17));
          for (const sd of [-1, 1]) {
            const lat = sd * 20;
            S.color('#bba886');
            for (let k = 0; k < steps; k++) { const a = -(Dr.dist - face) + k * run / steps, q = F.at(a + run / steps / 2, lat), h = rise * (1 - (k + 1) / steps); S.box(q.x, g - .1, q.z, run / steps + .02, h + .1 + .17, 6.5, F.yawU); }
            for (const e of [-3.6, 3.6]) {
              const a0 = -(Dr.dist - face), q0 = F.at(a0, lat + e), q1 = F.at(a0 + run, lat + e);
              S.color(SANDSTONE); S.beam(V(q0.x, g + rise / 2, q0.z), V(q1.x, g + .1, q1.z), .6, rise);   // the stair's cheek walls
              balustrade(V(q0.x, top, q0.z), V(q1.x, g + .05, q1.z));
            }
            S.color(SANDSTONE); S.box(F.at(-(Dr.dist - face) + run, lat).x, g, F.at(-(Dr.dist - face) + run, lat).z, 1.2, 1.6, 1.2, F.yawU);
          }
        }
      }
      // lamps round the fountain
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU, q = { x: c.x + Math.cos(a) * (R + 6), z: c.z + Math.sin(a) * (R + 6) }; S.color(IRON); S.cylinder(q.x, g, q.z, .1, 3.6, 6, .07); glows.push({ x: q.x, y: g + 3.8, z: q.z, size: 1.4, color: '#ffe2b0' }); }
      L.lifeSpots?.push(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = k / 8 * TAU + .2; return { x: c.x + Math.cos(a) * (R + .2), z: c.z + Math.sin(a) * (R + .2), y: g + .7, yaw: a + Math.PI, kind: k % 3 ? 'sit' : 'stand' }; }).filter((q) => (L.wayDist?.(q.x, q.z, 3) ?? 3) > 1.2));
    },

    // Bow Bridge (1862): a low cast-iron arch, cream, its railing a run of interlaced circles, planting urns at the ends
    // and the crown — built on the path's own deck (its line and height), which then draws no deck of its own
    bowbridge(l) {
      const D = deckOf(l, 30);
      if (!D) return;
      const { pts, half } = D, n = pts.length - 1, span = pts[n].s, water = (L.poolAt?.(pts[n >> 1].x, pts[n >> 1].z) ?? pts[0].y - 3) + .35;
      (QC.onWay ||= []).push(l.label);
      const CREAM = '#e8e0cb', RAIL = '#f2ecdc';
      for (let k = 0; k < n; k++) {
        const p = pts[k], q = pts[k + 1], t0 = p.s / span, t1 = q.s / span;
        S.color('#cfc4a8'); S.beam(V(p.x, p.y - .085, p.z), V(q.x, q.y - .085, q.z), half * 2 + .3, .14);   // the deck, over the path's
        for (const sd of [-1, 1]) {
          const o = (r, d, dy) => V(r.x + r.nx * sd * d, r.y + dy, r.z + r.nz * sd * d);
          S.color(RAIL); S.beam(o(p, half + .05, 1.05), o(q, half + .05, 1.05), .1, .1); S.beam(o(p, half + .05, .12), o(q, half + .05, .12), .08, .08);
          // the interlaced circles: a hoop every 0.75 m (four bars round it)
          for (let u = 0; u < q.s - p.s; u += .75) {
            const f = u / (q.s - p.s), c = V(p.x + (q.x - p.x) * f + p.nx * sd * (half + .05), p.y + (q.y - p.y) * f + .58, p.z + (q.z - p.z) * f + p.nz * sd * (half + .05)), dx = q.x - p.x, dz = q.z - p.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl * .34, uz = dz / dl * .34;
            S.beam(V(c.x - ux, c.y, c.z - uz), V(c.x, c.y + .34, c.z), .035, .035); S.beam(V(c.x, c.y + .34, c.z), V(c.x + ux, c.y, c.z + uz), .035, .035);
            S.beam(V(c.x + ux, c.y, c.z + uz), V(c.x, c.y - .34, c.z), .035, .035); S.beam(V(c.x, c.y - .34, c.z), V(c.x - ux, c.y, c.z - uz), .035, .035);
          }
          // the arch's ribs: springing low at the banks, rising to the deck at the crown
          const drop = (t) => Math.max(.3, 1.6 * (1 - Math.sin(Math.PI * Math.min(1, Math.max(0, t))))), y0 = p.y - .2 - drop(t0) / 2, y1 = q.y - .2 - drop(t1) / 2;
          S.color(CREAM); S.beam(o(p, half - .1, 0).setY(Math.max(water, y0)), o(q, half - .1, 0).setY(Math.max(water, y1)), .3, Math.max(.3, Math.min(drop(t0), p.y - water)));
        }
      }
      // urns: at the four ends and the crown (0.6 m, on the rail's posts)
      const urn = (r, sd) => { const x = r.x + r.nx * sd * (half + .05), z = r.z + r.nz * sd * (half + .05), y = r.y + 1.1; S.color(CREAM); S.cylinder(x, r.y, z, .09, 1.1, 6); lathe(S, x, y, z, [[.12, 0], [.2, .14], [.26, .32], [.2, .42], [0, .44]], 10); S.color('#7a3b2a'); S.cylinder(x, y + .42, z, .18, .14, 8, .06); };
      for (const r of [pts[0], pts[n >> 1], pts[n]]) for (const sd of [-1, 1]) urn(r, sd);
      // the abutments: schist into the banks at each end
      S.color(SCHIST); for (const r of [pts[0], pts[n]]) { const g = Math.min(H(r.x, r.z), water - .3); S.box(r.x, g - .5, r.z, half * 2 + 1.4, r.y - g + .38, 2.4, Math.atan2(r.dx, r.dz)); }
    },
    // the Loeb Boathouse (1954): long and low, buff brick, a deep flat roof over the lakeside terrace, the rowboat dock
    boathouse(l) {
      const { ring, F, g } = plan(l, 30, 12);
      const u = lakeward(F.c), dot = F.v.x * u.x + F.v.z * u.z, side = dot >= 0 ? 1 : -1;
      S.color('#a98a6c'); prism(S, ring, g - .5, g + 4.6);
      S.color('#4c5b49'); block(S, scaleRing(ring, 1.08, F.c), g + 4.6, g + 5.1);    // the roof, overhanging
      S.color('#2e3438'); for (let a = -F.hl + 3; a < F.hl - 2; a += 3.2) { const q = F.at(a, side * (F.hw + .02)); S.box(q.x, g + .8, q.z, .1, 2.8, 2.2, F.yawU); }   // the windows on the Lake
      // the terrace and its awnings, and the dock
      S.color('#9d8c74'); block(S, F.rect(-F.hl, F.hl, side * F.hw, side * (F.hw + 7)).map((p) => p), g - .3, g + .05);
      S.color('#2f4f41'); for (let a = -F.hl + 4; a < F.hl - 3; a += 8) { const q = F.at(a, side * (F.hw + 3.5)); S.box(q.x, g + 2.6, q.z, 7.2, .15, 6.4, F.yawU); S.color(IRON); for (const d of [-3.4, 3.4]) { const p = F.at(a + d, side * (F.hw + 6.6)); S.cylinder(p.x, g, p.z, .05, 2.6, 5); } S.color('#2f4f41'); }
      const pool = L.poolAt?.(F.c.x, F.c.z) ?? g - 1;
      S.color('#7a6550'); const d0 = F.at(-F.hl * .6, side * (F.hw + 7)), d1 = F.at(-F.hl * .6, side * (F.hw + 22));
      S.beam(V(d0.x, pool + .55, d0.z), V(d1.x, pool + .55, d1.z), 3, .25);
      S.color('#5d4c3c'); for (let t = 0; t <= 1; t += .25) for (const s of [-1.3, 1.3]) { const q = V(d0.x + (d1.x - d0.x) * t + F.u.x * s, 0, d0.z + (d1.z - d0.z) * t + F.u.z * s); S.cylinder(q.x, pool - 1, q.z, .12, 1.7, 5); }
    },

    // Belvedere Castle (1869): a folly of grey schist on Vista Rock — a square tower with a crenellated top and a round
    // turret, a pavilion with a pointed roof, battlemented terraces; the weather station's mast
    belvedere(l) {
      const { ring, F, g } = plan(l, 12, 8);
      // Vista Rock: the outcrop the castle grows out of, falling away to Turtle Pond
      S.color('#6f6b64'); block(S, scaleRing(ring, 1.5, F.c), g - 9, g + .2);
      S.color('#77736b'); block(S, scaleRing(ring, 1.18, F.c), g + .2, g + 2.2);
      const crenels = (rg, y, h = .7) => { for (let i = 0; i < rg.length; i++) { const a = rg[i], b = rg[(i + 1) % rg.length], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.floor(len / 1.4)); for (let k = 0; k < n; k += 2) { const t = (k + .5) / n, q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; S.box(q.x, y, q.z, .7, h, len / n * .9, Math.atan2(b.x - a.x, b.z - a.z)); } } };
      S.color(SCHIST); crenels(scaleRing(ring, 1.18, F.c), g + 2.2);
      // the main block, two storeys
      S.color('#837e76'); prism(S, ring, g + 2.2, g + 8.5); cap(S, ring, g + 8.5); crenels(ring, g + 8.5);
      // the tower at the north end, with its turret
      const T = F.at(F.hl * .6, -F.hw * .3), tw = Math.min(5.5, F.hw * 1.1);
      S.color('#7a756d'); S.box(T.x, g + 2.2, T.z, tw, 17, tw, F.yawU); S.color(SCHIST); crenels(makeFrame(T, F.u, F.v, tw / 2, tw / 2).rect(-tw / 2, tw / 2, -tw / 2, tw / 2), g + 19.2, .9);
      const tu = F.at(F.hl * .6 + tw * .55, -F.hw * .3 + tw * .55);
      S.color('#7d786f'); S.cylinder(tu.x, g + 5, tu.z, 1.25, 15, 12); S.color('#3c3a38'); lathe(S, tu.x, g + 20, tu.z, [[1.45, 0], [0, 3.2]], 12);
      S.color('#2c2a28'); for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + F.yawU; S.box(T.x + Math.cos(a) * tw / 2, g + 13, T.z + Math.sin(a) * tw / 2, .7, 1.8, .2, a); }   // the tower's windows
      // the wooden pavilion on the terrace (a pointed roof, in Vaux's colours)
      const Pv = F.at(-F.hl * .55, F.hw * .2);
      S.color('#5b4a3a'); for (const [a, b] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]]) { const q = { x: Pv.x + F.u.x * a + F.v.x * b, z: Pv.z + F.u.z * a + F.v.z * b }; S.cylinder(q.x, g + 8.5, q.z, .14, 3, 6); }
      S.color('#7a3c2c'); S.pyramid(Pv.x, g + 11.5, Pv.z, 4.6, 3.2, 4.6, F.yawU);
      S.color(IRON); S.cylinder(T.x, g + 19.2, T.z, .06, 6, 4);   // the weather mast
      S.color('#3a5a8a'); S.box(T.x + F.v.x * .9, g + 23.6, T.z + F.v.z * .9, .05, 1, 1.6, F.yawV);   // the flag
    },

    // the Delacorte Theater (1962): Shakespeare in the Park — a horseshoe of wooden stands round a stage on Turtle Pond
    delacorte(l) {
      const { F, g } = plan(l, 30, 30), c = F.c;
      // the stands fill the theatre's outline but keep off the paths round it (the ride passes close by)
      const R = Math.max(12, Math.min(26, (F.hl + F.hw) / 2, (L.wayDist?.(c.x, c.z, 40) ?? 40) - 2));
      // a horseshoe of stands rising outward, open toward Turtle Pond (the stage's backdrop)
      const open = lakewardOf(c, /Turtle/), a0 = Math.atan2(open.z, open.x) + .9, n = 20, tiers = 7, step = Math.min(1.1, R * .6 / tiers);
      for (let k = 0; k < tiers; k++) for (let i = 0; i < n; i++) {
        const t0 = a0 + (TAU - 1.8) * i / n, t1 = a0 + (TAU - 1.8) * (i + 1) / n, r = R * .4 + k * step, y = g + k * .5;
        S.color((k + i) % 2 ? '#6b5845' : '#5c4b3b');
        S.beam(V(c.x + Math.cos(t0) * r, y + .25, c.z + Math.sin(t0) * r), V(c.x + Math.cos(t1) * r, y + .25, c.z + Math.sin(t1) * r), step + .05, .5 + k * .5);
      }
      S.color('#4c4038'); prism(S, makeFrame(c, F.u, F.v).rect(-R * .22, R * .22, -R * .16, R * .16), g, g + 1); cap(S, makeFrame(c, F.u, F.v).rect(-R * .22, R * .22, -R * .16, R * .16), g + 1);
      S.color(IRON); for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + .4, q = { x: c.x + Math.cos(a) * (R + 1), z: c.z + Math.sin(a) * (R + 1) }; S.cylinder(q.x, g, q.z, .22, 14, 6); S.box(q.x, g + 14, q.z, 2.4, 1.2, .6, a); }
    },

    // Cleopatra's Needle: red granite, 21 m on its pedestal, the four bronze crabs at its corners
    obelisk(l) {
      const c = local(l.center[0], l.center[1]), g = H(c.x, c.z), yaw = .4;
      S.color('#9a958c'); S.box(c.x, g, c.z, 6, .5, 6, yaw); S.box(c.x, g + .5, c.z, 4.6, .5, 4.6, yaw);
      S.color('#8d8478'); S.box(c.x, g + 1, c.z, 3.2, 2.2, 3.2, yaw);
      S.color('#6b5236'); for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) S.box(c.x + Math.cos(yaw) * a * 1.25 + Math.sin(yaw) * b * 1.25, g + 3.2, c.z - Math.sin(yaw) * a * 1.25 + Math.cos(yaw) * b * 1.25, .8, .5, .8, yaw);
      S.color('#a47864'); S.cylinder(c.x, g + 3.7, c.z, 1.55, 19.5, 4, 1.05);
      S.color('#9a6d58'); S.pyramid(c.x, g + 23.2, c.z, 1.45, 1.6, 1.45, Math.PI / 4);
    },

    // Gapstow Bridge (1896): a rough Manhattan-schist arch over the Pond's neck — on the path's own deck
    gapstow(l) {
      const D = deckOf(l, 30);
      if (!D) return;
      (QC.onWay ||= []).push(l.label);
      const { pts, half } = D, n = pts.length - 1, span = pts[n].s, water = (L.poolAt?.(pts[n >> 1].x, pts[n >> 1].z) ?? pts[0].y - 3) + .35;
      for (let k = 0; k < n; k++) {
        const p = pts[k], q = pts[k + 1];
        // the arch's underside: from the water at the ends (or the bank) up under the crown
        const soffit = (r) => Math.min(r.y - .9, water + .4 + Math.max(0, r.y - 1.1 - water - .4) * Math.sin(Math.PI * Math.min(1, Math.max(0, r.s / span))));
        S.color(k % 3 ? '#968f83' : '#a39b8e');   // (schist in sun: lighter — it read heavy)
        for (const sd of [-1, 1]) {
          // the spandrel and parapet: a wall face per piece, from the arch's curve up to the parapet's top (no steps)
          const o = (r, d) => ({ x: r.x + r.nx * sd * d, z: r.z + r.nz * sd * d });
          for (const d of [half, half + .6]) {
            const a = o(p, d), b = o(q, d), ya = soffit(p), yb = soffit(q), ta = p.y + .85, tb = q.y + .85;
            const A = V(a.x, ya, a.z), B = V(b.x, yb, b.z), C = V(b.x, tb, b.z), D = V(a.x, ta, a.z);
            S.quad(A, B, C, D); S.quad(A, D, C, B);
          }
          const a = o(p, half + .3), b = o(q, half + .3);
          S.beam(V(a.x, p.y + .9, a.z), V(b.x, q.y + .9, b.z), .7, .12);   // the coping
        }
        S.color('#5f5b54'); S.beam(V(p.x, soffit(p) - .15, p.z), V(q.x, soffit(q) - .15, q.z), half * 2 + .6, .3);   // the barrel's underside
        for (const sd of [-1, 1]) { const o = (r) => ({ x: r.x + r.nx * sd * (half + .62), z: r.z + r.nz * sd * (half + .62) }), a2 = o(p), b2 = o(q); S.color('#b3ab9c'); S.beam(V(a2.x, soffit(p) + .3, a2.z), V(b2.x, soffit(q) + .3, b2.z), .06, .6); }   // the arch ring's dressed voussoirs
        S.color('#8b857a'); S.beam(V(p.x, p.y - .065, p.z), V(q.x, q.y - .065, q.z), half * 2 + .05, .1);   // the walk (stone flags)
      }
    },
    // Wollman Rink: the ice (white under the late sun), its boards, the rink house; skaters round it
    wollman(l) {
      const { ring, F, g } = plan(l, 50, 30), g0 = g;
      S.color('#9fa6a8'); block(S, ring, g0 - 1.5, g0 + .1);
      S.color('#eef4f6'); block(S, scaleRing(ring, .96, F.c), g0 + .1, g0 + .16);
      S.color('#f4f4f0'); { const r = scaleRing(ring, .965, F.c); for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; S.beam(V(a.x, g0 + .7, a.z), V(b.x, g0 + .7, b.z), .12, 1.1); } }
      S.color('#5f5a54'); const hq = F.at(0, F.hw + 6); S.box(hq.x, g0, hq.z, F.hl * 1.4, 5, 9, F.yawU);
      S.color('#2f3438'); S.box(hq.x, g0 + 5, hq.z, F.hl * 1.45, .4, 10, F.yawU);
      L.lifeSpots?.push(...Array.from({ length: 14 }, (_, k) => { const q = F.at((hsh(k) - .5) * F.hl * 1.6, (hsh(k + 9) - .5) * F.hw * 1.6); return { x: q.x, z: q.z, y: g0 + .16, yaw: hsh(k * 3) * TAU, kind: k % 4 ? 'stand' : 'chat' }; }));
    },

    // the Friedsam Memorial Carousel (1951): an octagonal red-brick house, its tent roof and cupola
    carousel(l) {
      const { F, g } = plan(l, 12, 12), c = F.c, R = Math.max(9, Math.min(14, (F.hl + F.hw) / 2));
      S.color(BRICK); lathe(S, c.x, g - .3, c.z, [[R, 0], [R, 4.2], [R + .6, 4.4], [R + .6, 4.6]], 8);
      S.color('#2d3a35'); for (let k = 0; k < 8; k++) { const a = (k + .5) / 8 * TAU, q = { x: c.x + Math.cos(a) * (R + .02), z: c.z + Math.sin(a) * (R + .02) }; S.box(q.x, g + .3, q.z, 3.6, 2.6, .2, -a + Math.PI / 2); }
      S.color('#6a3b2c'); lathe(S, c.x, g + 4.6, c.z, [[R + .8, 0], [R * .55, 2.6], [R * .35, 3.6], [0, 4.2]], 8);
      S.color('#e7dcc4'); S.cylinder(c.x, g + 8.2, c.z, 1.1, 1.4, 8); S.color('#6a3b2c'); lathe(S, c.x, g + 9.6, c.z, [[1.3, 0], [0, 1.4]], 8);
      S.color(GILT); S.cylinder(c.x, g + 11, c.z, .05, 1.2, 4);
    },

    // Strawberry Fields: the Imagine mosaic — a circle of black and white stone in rays round the word — and its benches
    imagine(l) {
      const c = local(l.center[0], l.center[1]), g = H(c.x, c.z) + .03, R = 4.2, n = 48;
      for (let k = 0; k < n; k++) {
        const a0 = k / n * TAU, a1 = (k + 1) / n * TAU;
        S.color(k % 2 ? '#f0ece2' : '#2e2c2a');
        S.triangle(V(c.x + Math.cos(a0) * 1.1, g, c.z + Math.sin(a0) * 1.1), V(c.x + Math.cos(a1) * R, g, c.z + Math.sin(a1) * R), V(c.x + Math.cos(a0) * R, g, c.z + Math.sin(a0) * R));
        S.triangle(V(c.x + Math.cos(a0) * 1.1, g, c.z + Math.sin(a0) * 1.1), V(c.x + Math.cos(a1) * 1.1, g, c.z + Math.sin(a1) * 1.1), V(c.x + Math.cos(a1) * R, g, c.z + Math.sin(a1) * R));
      }
      S.color('#f0ece2'); lathe(S, c.x, g, c.z, [[1.1, 0], [0, .005]], 24); S.color('#2e2c2a'); S.box(c.x, g + .006, c.z, 1.5, .004, .22, 0);
      S.color('#9b9488'); lathe(S, c.x, g - .03, c.z, [[R + 1.6, 0], [R + 1.6, .02], [R, .02]], 32);
      for (let k = 0; k < 10; k++) { const a = k / 10 * TAU, q = { x: c.x + Math.cos(a) * (R + 3), z: c.z + Math.sin(a) * (R + 3) }, g = H(q.x, q.z); S.color('#6a4a32'); S.box(q.x, g + .42, q.z, 1.9, .08, .5, -a); S.box(q.x + Math.cos(a) * .25, g + .5, q.z + Math.sin(a) * .25, 1.9, .5, .08, -a); S.color(IRON); S.box(q.x, g, q.z, 1.7, .42, .4, -a);
        if (k % 3 === 0) L.lifeSpots?.push({ x: q.x, z: q.z, y: g + .45, yaw: a + Math.PI, kind: 'sit' }); }
      L.lifeSpots?.push({ x: c.x + R + 1, z: c.z, y: g, yaw: Math.PI, kind: 'stand' }, { x: c.x - R - 1, z: c.z + 1, y: g, yaw: 0, kind: 'stand' });
    },

    // the Naumburg Bandshell (1923): a limestone half-dome on a stage at the head of the Mall
    bandshell(l) {
      const { F, g } = plan(l, 12, 8), c = F.c, R = Math.max(7, Math.min(11, F.hl));
      S.color(LIMESTONE); block(S, F.rect(-F.hl, F.hl, -F.hw, F.hw), g, g + 1.3);
      const n = 12, m = 6, back = F.v;
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const a0 = Math.PI * i / n, a1 = Math.PI * (i + 1) / n, e0 = Math.PI / 2 * j / m, e1 = Math.PI / 2 * (j + 1) / m;
        const p = (a, e) => V(c.x + (F.u.x * Math.cos(a) - back.x * Math.sin(a)) * R * Math.cos(e), g + 1.3 + R * Math.sin(e), c.z + (F.u.z * Math.cos(a) - back.z * Math.sin(a)) * R * Math.cos(e));
        S.color(j % 2 ? '#d8cdb4' : '#cfc3a8'); S.quad(p(a0, e0), p(a1, e0), p(a1, e1), p(a0, e1)); S.quad(p(a0, e0), p(a0, e1), p(a1, e1), p(a1, e0));
      }
    },

    // the Dairy (1870): a Victorian Gothic cottage of grey stone, a steep roof, the painted wooden loggia
    dairy(l) {
      const { ring, F, g } = plan(l, 10, 6);
      S.color('#8b857a'); prism(S, ring, g - .3, g + 5);
      S.color('#4a3f3a'); gable(S, F, -F.hl - .5, F.hl + .5, F.hw + .4, g + 5, g + 5 + F.hw * 1.2, { endColor: '#8b857a' });
      S.color('#b54b37'); for (let a = -F.hl; a <= F.hl; a += 2.4) { const q = F.at(a, F.hw + 2.2); S.cylinder(q.x, g, q.z, .14, 3.2, 6); }
      S.color('#3c5b4a'); S.box(F.at(0, F.hw + 2.2).x, g + 3.2, F.at(0, F.hw + 2.2).z, 3, .3, F.hl * 2 + .6, F.yawU);
      S.color('#5a4a40'); S.pyramid(F.at(F.hl * .6, 0).x, g + 5 + F.hw * 1.2, F.at(F.hl * .6, 0).z, 1.1, 2.4, 1.1, F.yawU);
    },
    // the Swedish Cottage (1876): a log schoolhouse with a steep roof
    cottage(l) {
      const { ring, F, g } = plan(l, 9, 6);
      S.color('#6e4a30'); prism(S, ring, g - .3, g + 4.2);
      S.color('#3f3a36'); gable(S, F, -F.hl - .4, F.hl + .4, F.hw + .5, g + 4.2, g + 4.2 + F.hw * 1.1, { endColor: '#6e4a30' });
      S.color('#e8e0cc'); for (let a = -F.hl + 1.5; a < F.hl - 1; a += 2.5) for (const s of [-1, 1]) { const q = F.at(a, s * (F.hw + .03)); S.box(q.x, g + 1.2, q.z, .1, 1.5, 1.1, F.yawU); }
    },
    // the Dana Discovery Center (1993): a Victorian boathouse of brick and slate on the Harlem Meer
    dana(l) {
      const { ring, F, g } = plan(l, 14, 8);
      S.color('#9a6a52'); prism(S, ring, g - .3, g + 6);
      S.color('#4a5258'); gable(S, F, -F.hl - .5, F.hl + .5, F.hw + .5, g + 6, g + 6 + F.hw * .9, { endColor: '#9a6a52' });
      S.color('#d8d0c0'); S.box(F.c.x, g + 6 + F.hw * .9, F.c.z, 1.6, 2.4, 1.6, F.yawU); S.color('#4a5258'); S.pyramid(F.c.x, g + 8.4 + F.hw * .9, F.c.z, 2, 2, 2, F.yawU);
    },
    // Blockhouse No. 1 (1814): a roofless stone fort with slit windows, on its rock
    blockhouse(l) {
      const { ring, F, g } = plan(l, 6, 6);
      S.color('#6d6961'); block(S, scaleRing(ring, 1.4, F.c), g - 3, g + .4);
      S.color('#77736a'); prism(S, ring, g + .4, g + 4.4); prism(S, scaleRing(ring, .78, F.c), g + .4, g + 4.3);
      S.color('#2a2826'); for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + F.yawU, q = { x: F.c.x + Math.cos(a) * F.hw, z: F.c.z + Math.sin(a) * F.hw }; S.box(q.x, g + 2.4, q.z, .3, .9, .2, a); }
    },

    // the Conservatory Garden: formal parterres — clipped yew and boxwood hedges round lawns, the wisteria pergola
    // over its stairs, the Untermyer Fountain's three dancing maidens, beds of chrysanthemums in fall
    conservatory(l) {
      const { ring, F, g } = plan(l, 120, 60);
      const hedge = (a0, a1, b0, b1, h = 1.1, color = '#2f4a2c') => { S.color(color); for (const [p, q] of [[[a0, b0], [a1, b0]], [[a1, b0], [a1, b1]], [[a1, b1], [a0, b1]], [[a0, b1], [a0, b0]]]) { const A = F.at(...p), B = F.at(...q), yA = H(A.x, A.z), yB = H(B.x, B.z); S.beam(V(A.x, yA + h / 2, A.z), V(B.x, yB + h / 2, B.z), .8, h); } };
      const third = F.hl / 1.5;
      // the north (French) garden: concentric hedges and the fountain
      for (const r of [.85, .6, .35]) hedge(third * .2, third * .2 + F.hw * 1.6 * r, -F.hw * r, F.hw * r, .9);
      const fq = F.at(third * .2 + F.hw * .8, 0), fg = H(fq.x, fq.z);
      basin(fq, fg, 4.5, .5); S.color(BRONZE); for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; figure({ x: fq.x + Math.cos(a) * .9, z: fq.z + Math.sin(a) * .9 }, fg + .2, { plinth: .3, h: 1.7, stone: SANDSTONE }); }
      // the central (Italian) garden: the lawn panel, yew hedges and the crabapple allées, the pergola at its end
      hedge(-third * .7, third * .1, -F.hw * .8, F.hw * .8, 1.2, '#2b4529');
      for (const s of [-1, 1]) for (let a = -third * .65; a < third * .05; a += 7) { const q = F.at(a, s * F.hw * .65), y = H(q.x, q.z); S.color('#4a3a2e'); S.cylinder(q.x, y, q.z, .16, 2.2, 6); S.color(hsh(a) < .5 ? '#b8562c' : '#c66a2e'); lathe(S, q.x, y + 2, q.z, [[1.6, 0], [2, .8], [1.4, 1.8], [0, 2.2]], 8); }
      const pg = F.at(-third * .7 - 6, 0), py = H(pg.x, pg.z);
      S.color('#2e3330'); for (let b = -9; b <= 9; b += 3) for (const a of [-2.5, 2.5]) { const q = { x: pg.x + F.u.x * a + F.v.x * b, z: pg.z + F.u.z * a + F.v.z * b }; S.cylinder(q.x, py, q.z, .12, 3.4, 6); }
      S.color('#7a6a8e'); S.box(pg.x, py + 3.4, pg.z, 6.4, .5, 20, F.yawV);   // wisteria over the pergola (gone russet, a few lilac ghosts)
      // the south (English) garden: beds of chrysanthemums round the Burnett Fountain's pool
      const sq = F.at(-third * 1.2, 0), sy = H(sq.x, sq.z);
      basin(sq, sy, 3.2, .4); figure(sq, sy + .4, { plinth: .4, h: 1.4, stone: SANDSTONE });
      for (let k = 0; k < 14; k++) { const a = k / 14 * TAU, q = { x: sq.x + Math.cos(a) * 9, z: sq.z + Math.sin(a) * 9 }; S.color(['#d9a23a', '#c4492d', '#e8d3a0', '#a83a5a'][k % 4]); S.box(q.x, H(q.x, q.z), q.z, 3.2, .5, 1.4, -a); }
    },
    // the Vanderbilt Gate (1894): wrought iron from Paris between two stone piers, gilded tips — open by day
    gate(l) {
      const c = local(l.center[0], l.center[1]), g = H(c.x, c.z), yaw = 1.05;
      const p = (d) => ({ x: c.x + Math.cos(yaw) * d, z: c.z - Math.sin(yaw) * d });
      S.color(LIMESTONE); for (const d of [-4.5, 4.5]) { const q = p(d); S.box(q.x, g, q.z, 1.3, 4.2, 1.3, yaw); S.box(q.x, g + 4.2, q.z, 1.6, .4, 1.6, yaw); }
      S.color(IRON); for (let d = -3.8; d <= 3.8; d += .35) { const q = p(d), h = 3.6 + 1.2 * Math.cos(d / 3.8 * Math.PI / 2); S.cylinder(q.x, g, q.z, .03, h, 4); }
      for (const y of [.6, 2.6]) S.beam(V(p(-3.8).x, g + y, p(-3.8).z), V(p(3.8).x, g + y, p(3.8).z), .07, .07);
      S.color(GILT); for (let d = -3.8; d <= 3.8; d += .7) { const q = p(d), h = 3.6 + 1.2 * Math.cos(d / 3.8 * Math.PI / 2); S.pyramid(q.x, g + h, q.z, .1, .25, .1); }
    },

    // the Reservoir: its low iron fence along the running track, round the whole water
    reservoir(l) {
      const ring = l.ring.map(([a, o]) => local(a, o)), c = centroid(ring);
      // out from the water's edge 2.5 m
      // (1.2 m out from the water's edge along the shore's own normal — the review: radially from the middle it wandered
      //  onto the track and into the water)
      const out = ring.map((p, i) => { const q0 = ring[(i - 1 + ring.length) % ring.length], q1 = ring[(i + 1) % ring.length], dx = q1.x - q0.x, dz = q1.z - q0.z, d = Math.hypot(dx, dz) || 1; let nx = dz / d, nz = -dx / d; if (inPoly(ring, p.x + nx * 2, p.z + nz * 2)) { nx = -nx; nz = -nz; } return { x: p.x + nx * 1.2, z: p.z + nz * 1.2 }; });
      S.color(IRON);
      for (let i = 0; i < out.length; i++) {
        const a = out[i], b = out[(i + 1) % out.length], len = Math.hypot(b.x - a.x, b.z - a.z), ya = H(a.x, a.z), yb = H(b.x, b.z);
        S.beam(V(a.x, ya + 1.15, a.z), V(b.x, yb + 1.15, b.z), .05, .05); S.beam(V(a.x, ya + .2, a.z), V(b.x, yb + .2, b.z), .04, .04);
        for (let t = 0; t < len; t += 2.6) { const q = { x: a.x + (b.x - a.x) * t / len, z: a.z + (b.z - a.z) * t / len }; S.cylinder(q.x, H(q.x, q.z), q.z, .04, 1.25, 4); }
      }
      // the gatehouses at the north and south ends
      let n = ring[0], s = ring[0]; for (const p of ring) { if (p.z < n.z) n = p; if (p.z > s.z) s = p; }
      for (const q of [n, s]) { const dx = q.x - c.x, dz = q.z - c.z, d = Math.hypot(dx, dz) || 1, p = { x: q.x + dx / d * 8, z: q.z + dz / d * 8 }, y = H(p.x, p.z); S.color('#8a8274'); S.box(p.x, y - .3, p.z, 7, 5.5, 9, Math.atan2(dx, dz)); S.color('#4f5458'); S.pyramid(p.x, y + 5.2, p.z, 8, 2.2, 10, Math.atan2(dx, dz)); }
    },

    // Columbus Circle: the granite rostral column (1892) with Columbus on top, on its fountain
    columbus(l) {
      const c = local(l.center[0], l.center[1]), g = H(c.x, c.z);
      basin(c, g, 9, .5, '#a39d92');
      S.color('#bdb5a6'); S.box(c.x, g, c.z, 5, 3.5, 5, 0); S.cylinder(c.x, g + 3.5, c.z, 1.3, 16, 16, 1.1);
      S.color(BRONZE); for (let k = 0; k < 3; k++) { const y = g + 6 + k * 4; for (const s of [-1, 1]) S.box(c.x + s * 1.5, y, c.z, .6, .8, .5, 0); }   // the ships' prows
      S.color('#b8b0a2'); S.box(c.x, g + 19.5, c.z, 2.4, .6, 2.4, 0);
      S.color('#c9c2b4'); S.cylinder(c.x, g + 20.1, c.z, .45, 2.2, 8, .3); S.cylinder(c.x, g + 22.3, c.z, .22, .45, 8, .18);
    },
    // the USS Maine Monument (1913): a pylon of pink granite with Columbia Triumphant in gilded bronze on her seashell
    maine(l) {
      const { F, g } = plan(l, 8, 6);
      S.color('#c9b3a3'); S.box(F.c.x, g, F.c.z, 7, 1.2, 9, F.yawU); S.box(F.c.x, g + 1.2, F.c.z, 4.2, 12, 5.4, F.yawU); S.box(F.c.x, g + 13.2, F.c.z, 5, .8, 6.2, F.yawU);
      S.color(GILT); S.box(F.c.x, g + 14, F.c.z, 2.6, 1.2, 3.2, F.yawU); figure(F.c, g + 15.2, { plinth: .1, h: 2.4, color: GILT, stone: GILT, wings: false });
      S.color(BRONZE); for (const s of [-1, 1]) { const q = F.at(s * 4.2, 0); figure(q, g + 1.2, { plinth: .2, h: 1.9 }); }
      basin(F.at(-6.5, 0), g, 3.4, .5, '#c9b3a3');
    },
    // the Pulitzer Fountain (1916): five tiers of basins and Pomona on top, in Grand Army Plaza
    pulitzer(l) {
      const c = local(l.center[0], l.center[1]), g = H(c.x, c.z);
      basin(c, g, 9, .55, '#c3bcae');
      S.color('#c3bcae'); lathe(S, c.x, g + .5, c.z, [[3.2, 0], [2.6, 1.5], [4.2, 2], [4.2, 2.3], [1.8, 2.4], [1.6, 3.6], [2.6, 4], [2.6, 4.2], [1, 4.3]], 20);
      figure(c, g + 4.3, { plinth: .9, h: 2.2, stone: '#c3bcae' });
    },
    // the Cherry Hill fountain (1860): a gilded Victorian lamp-fountain on its circle by the Lake
    cherryhill(l) {
      const c = local(l.center[0], l.center[1]), g = H(c.x, c.z);
      basin(c, g, 3.8, .45, '#b8ad98');
      S.color('#6f8a7c'); lathe(S, c.x, g + .4, c.z, [[.7, 0], [.4, 1.2], [1.5, 1.6], [.3, 1.8], [.25, 3.4], [.6, 3.6], [0, 4.2]], 10);
      S.color(GILT); lathe(S, c.x, g + 4.2, c.z, [[.3, 0], [.4, .4], [0, .9]], 8);
    },
    // the lawns: Sheep Meadow and the Great Lawn — people picnicking on blankets, in twos and threes
    lawn(l) {
      const ring = orient(l.ring.map(([a, o]) => local(a, o))), F = frameOf(ring), c = F.c;
      const pip = (x, z) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) ins = !ins; } return ins; };
      const groups = Math.round(Math.min(60, F.hl * F.hw / 900));
      for (let k = 0; k < groups; k++) {
        const q = F.at((hsh(k * 1.7 + l.label.length) - .5) * F.hl * 1.7, (hsh(k * 2.3 + 5) - .5) * F.hw * 1.7);
        if (!pip(q.x, q.z)) continue;
        const y = H(q.x, q.z), yaw = hsh(k * 4.1) * TAU;
        S.color(['#c94b3a', '#3d6fa6', '#e3c44e', '#e9e4d6', '#5c9a6a', '#8c4a8a'][k % 6]); S.box(q.x, y + .02, q.z, 1.8, .02, 2.2, yaw);   // the blanket
        const n = 1 + Math.floor(hsh(k * 7.7) * 3);
        for (let m = 0; m < n; m++) { const a = yaw + m * 2.1; L.lifeSpots?.push({ x: q.x + Math.cos(a) * .6, z: q.z + Math.sin(a) * .6, y: y + .02, yaw: a + Math.PI, kind: m === 2 ? 'chat' : 'sit' }); }
      }
      // the Great Lawn's ball fields: the backstops
      if (/Great Lawn/.test(l.label)) for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
        const q = F.at((k / 3 - .5) * F.hl * 1.4, s * F.hw * .8), y = H(q.x, q.z), yaw = s > 0 ? F.yawV : F.yawV + Math.PI;
        S.color('#55595c'); for (let m = -2; m <= 2; m++) { const p = { x: q.x + Math.cos(yaw) * m * 2.2, z: q.z - Math.sin(yaw) * m * 2.2 }; S.cylinder(p.x, y, p.z, .06, 4, 5); }
        S.color('#7c8285'); S.box(q.x, y + .1, q.z, 9, 3.8, .04, yaw);
      }
    },
    // a bronze statue on its granite base (Alice on her mushroom; Hans Christian Andersen with the duckling)
    statue(l) {
      const c = local(l.center[0], l.center[1]), g = H(c.x, c.z);
      if (/Alice/.test(l.label)) {
        S.color(BRONZE); lathe(S, c.x, g, c.z, [[1.2, 0], [1, 1.2], [3.2, 1.8], [3.4, 2.1], [2.4, 2.6], [0, 2.8]], 14);   // the mushroom
        figure({ x: c.x, z: c.z }, g + 2.6, { plinth: .05, h: 1.6, stone: BRONZE });
        for (const [dx, dz, h] of [[2.2, 1, 1.1], [-2, 1.4, .9], [1.6, -2, .8]]) figure({ x: c.x + dx, z: c.z + dz }, g, { plinth: .05, h, stone: BRONZE });
      } else figure(c, g, { plinth: .6, h: 2.1, stone: '#9e978a' });
    },
  };
}

/**
 * The park round the landmarks: the wall and its closed gates, the lampposts and benches along the ways, the boats,
 * ducks and squirrels. → { count, tick(time) }
 */
export function nycPark({ S, N, glows, local, L, host }, park) {
  const H = (x, z) => L.heightAt(x, z);
  const QC = (L.qc ||= { basins: [], benches: [], bridges: [], views: [] });
  if (QC.prims) QC.prims.cur = 'the park';
  let made = 0;
  // the wall: Manhattan schist and brownstone coping, knee high, round the park's outline; at each entrance two piers
  // and a closed iron gate between them (the gates are closed: the ride stays in the park)
  const ring = park.outline.map(([a, o]) => local(a, o)), gates = (park.gates || []).map((q) => ({ ...local(q.at[0], q.at[1]), kind: q.kind }));
  const gateAt = (x, z) => gates.find((q) => Math.hypot(q.x - x, q.z - z) < (q.kind === 'drive' ? 6 : 3.2));
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 4));
    for (let k = 0; k < n; k++) {
      const p = { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }, q = { x: a.x + (b.x - a.x) * (k + 1) / n, z: a.z + (b.z - a.z) * (k + 1) / n };
      if (gateAt((p.x + q.x) / 2, (p.z + q.z) / 2)) continue;
      const yp = H(p.x, p.z), yq = H(q.x, q.z);
      S.color(k % 2 ? '#6f6a62' : '#76716a'); S.beam(V(p.x, Math.min(yp, yq) - .4 + .55, p.z), V(q.x, Math.min(yp, yq) - .4 + .55, q.z), .6, 1.1 + Math.abs(yp - yq));
      S.color('#8a6a55'); S.beam(V(p.x, Math.max(yp, yq) + .72, p.z), V(q.x, Math.max(yp, yq) + .72, q.z), .72, .1);
    }
  }
  for (const q of gates) {
    // the gate's line: along the wall here
    let best = null; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2)), d = Math.hypot(a.x + dx * t - q.x, a.z + dz * t - q.z); if (!best || d < best.d) best = { d, ux: dx / Math.sqrt(l2), uz: dz / Math.sqrt(l2) }; }
    const w = q.kind === 'drive' ? 5.5 : 2.8, y = H(q.x, q.z);
    S.color('#7d776e'); for (const s of [-1, 1]) { const p = { x: q.x + best.ux * w * s, z: q.z + best.uz * w * s }; S.box(p.x, y - .2, p.z, .9, 2, .9, Math.atan2(best.ux, best.uz)); S.color('#8a6a55'); S.box(p.x, y + 1.8, p.z, 1.1, .2, 1.1, Math.atan2(best.ux, best.uz)); S.color('#7d776e'); }
    S.color(IRON); const A = { x: q.x - best.ux * (w - .45), z: q.z - best.uz * (w - .45) }, B = { x: q.x + best.ux * (w - .45), z: q.z + best.uz * (w - .45) };
    for (const yy of [.25, 1.5]) S.beam(V(A.x, y + yy, A.z), V(B.x, y + yy, B.z), .06, .06);
    const n = Math.round((w - .45) * 2 / .14); for (let k = 0; k <= n; k++) { const t = k / n; S.cylinder(A.x + (B.x - A.x) * t, y, A.z + (B.z - A.z) * t, .022, 1.75, 4); }
    made++;
  }
  // the lampposts (Henry Bacon's 1911 cast-iron post, the acorn globe) and the benches (the 1939 World's Fair settee),
  // along the drives and paths, kept off the way's edge
  let lampN = 0, benchN = 0;
  for (const e of L.edges || []) {
    if (!['drive', 'path', 'bridle'].includes(e.kind) || e.n < 4) continue;
    const half = (L.wOf ? L.wOf(e) : 4) / 2, lamp = e.kind === 'drive' ? 4 : e.kind === 'path' ? 3 : 0, bench = e.kind === 'path' ? 5 : 0;
    for (let i = 2; i < e.n - 1; i++) {
      const h = hsh(e.x[i] * .37 + e.z[i] * .91), dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      if (lamp && i % lamp === 0) {
        const s = (i / lamp) % 2 ? 1 : -1, x = e.x[i] + nx * s * (half + .9), z = e.z[i] + nz * s * (half + .9);
        if ((L.wayDist?.(x, z, 2) ?? 2) < .6) continue;
        const y = H(x, z);
        S.color('#25332c'); S.cylinder(x, y, z, .16, .6, 8, .1); S.cylinder(x, y + .6, z, .08, 3, 6, .06); S.cylinder(x, y + 3.6, z, .14, .12, 8);
        S.color('#e8e2cf'); lathe(S, x, y + 3.72, z, [[.12, 0], [.24, .25], [.2, .55], [0, .62]], 8);
        S.color('#25332c'); lathe(S, x, y + 4.3, z, [[.1, 0], [0, .25]], 6);
        glows.push({ x, y: y + 4, z, size: .9, color: '#ffe3b5' });
        lampN++;
      }
      if (bench && i % bench === 2 && h < .55) {
        // (set back off the edge — the review: benches overlapped the paths' edges — clear of every other way, and not
        //  within 12 m of a junction)
        const s = h < .27 ? 1 : -1, x = e.x[i] + nx * s * (half + 1.15), z = e.z[i] + nz * s * (half + 1.15);
        if ((L.wayDist?.(x, z, 3) ?? 3) < .85 || i < 2 || i > e.n - 2) continue;
        const y = H(x, z), yaw = Math.atan2(dx, dz);
        S.color('#203029'); S.box(x, y, z, .5, .42, 1.9, yaw);
        S.color('#7a5a3a'); S.box(x + nx * s * .05, y + .42, z + nz * s * .05, .5, .06, 1.9, yaw);
        S.box(x + nx * s * .3, y + .5, z + nz * s * .3, .06, .45, 1.9, yaw);
        QC.benches.push({ x, z, kind: e.kind, facing: true });
        if (h < .09) L.lifeSpots?.push({ x: x - nx * s * .05, z: z - nz * s * .05, y: y + .45, yaw: Math.atan2(-nx * s, -nz * s), kind: 'sit' });
        benchN++;
      }
    }
  }
  made += lampN + benchN;

  // the moving things: rowboats on the Lake (a rower each, drifting and pulling), ducks on the ponds, squirrels on the lawns
  const movers = [];
  const pools = (L.pools || []).filter((p) => p.ring);
  const inside = (r, x, z) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) ins = !ins; } return ins; };
  const boatGeo = (() => {
    const B = new THREE.BufferGeometry(), parts = [];
    const add = (g, color) => { const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(g.toNonIndexed ? g.toNonIndexed() : g); };
    const hull = new THREE.CylinderGeometry(.75, .45, 4, 8, 1, false); hull.rotateZ(Math.PI / 2); hull.scale(1, .5, 1); hull.rotateY(Math.PI / 2); hull.translate(0, .15, 0); add(hull, '#2e5a7a');
    const rim = new THREE.BoxGeometry(1.3, .08, 3.6); rim.translate(0, .52, 0); add(rim, '#e9e2cf');
    const body = new THREE.CylinderGeometry(.22, .28, .75, 6); body.translate(0, .9, .2); add(body, '#c94b3a');
    const head = new THREE.SphereGeometry(.14, 6, 4); head.translate(0, 1.42, .2); add(head, '#d8a888');
    const oar = new THREE.BoxGeometry(3.2, .04, .1); oar.translate(0, .75, .45); add(oar, '#8a6a4a');
    for (const p of parts) p.deleteAttribute?.('uv');
    const pos = [], col = [], nrm = [];
    for (const p of parts) { pos.push(...p.attributes.position.array); col.push(...p.attributes.color.array); nrm.push(...p.attributes.normal.array); }
    B.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); B.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); B.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return B;
  })();
  const lake = pools.find((p) => /Lake/.test(p.name || ''));
  const meshOf = (geo, n, color = null) => {
    const m = new THREE.InstancedMesh(host.own(geo), host.own(litMaterial(color ? { color } : { vertexColors: true })), n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; host.group.add(m); return m;
  };
  if (lake) {
    const boats = meshOf(boatGeo, 14), list = [];
    for (let k = 0; k < 14; k++) {
      let x = 0, z = 0; for (let t = 0; t < 40; t++) { x = lake.x0 + (lake.x1 - lake.x0) * hsh(k * 3.1 + t * 7.7); z = lake.z0 + (lake.z1 - lake.z0) * hsh(k * 5.3 + t * 2.9); if (inside(lake.ring, x, z)) break; }
      list.push({ x, z, yaw: hsh(k * 9.9) * TAU, sp: .25 + hsh(k) * .35, turn: (hsh(k * 2) - .5) * .05 });
    }
    boats.name = 'Rowboats';
    movers.push((time, dt) => {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      list.forEach((b, k) => {
        const nx = b.x + Math.sin(b.yaw) * b.sp * dt, nz = b.z + Math.cos(b.yaw) * b.sp * dt;
        if (inside(lake.ring, nx + Math.sin(b.yaw) * 6, nz + Math.cos(b.yaw) * 6)) { b.x = nx; b.z = nz; b.yaw += b.turn * dt; } else b.yaw += 1.2 * dt;
        p.set(b.x, lake.level + .38 + Math.sin(time * 1.3 + k) * .03, b.z); e.set(Math.sin(time * 1.1 + k) * .03, b.yaw, Math.sin(time * .9 + k * 2) * .04); q.setFromEuler(e);
        boats.setMatrixAt(k, m.compose(p, q, s));
      });
      boats.instanceMatrix.needsUpdate = true;
    });
    made++;
  }
  // ducks: mallards in little flotillas on every pond
  const duck = new THREE.BufferGeometry();
  { const g1 = new THREE.SphereGeometry(.22, 6, 4); g1.scale(1, .7, 1.6); g1.translate(0, .1, 0); const g2 = new THREE.SphereGeometry(.1, 6, 4); g2.translate(0, .3, .28);
    const pos = [...g1.toNonIndexed().attributes.position.array, ...g2.toNonIndexed().attributes.position.array], nrm = [...g1.toNonIndexed().attributes.normal.array, ...g2.toNonIndexed().attributes.normal.array];
    const col = []; const n1 = g1.toNonIndexed().attributes.position.count; for (let i = 0; i < pos.length / 3; i++) { const c = new THREE.Color(i < n1 ? '#7a6248' : '#2f6b3e'); col.push(c.r, c.g, c.b); }
    duck.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); duck.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); duck.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); }
  const flock = [];
  for (const p of pools) { const n = Math.min(12, Math.max(3, Math.round((p.x1 - p.x0) * (p.z1 - p.z0) / 4000))); for (let k = 0; k < n; k++) { let x = 0, z = 0; for (let t = 0; t < 30; t++) { x = p.x0 + (p.x1 - p.x0) * hsh(k * 1.3 + t * 3.3 + p.level); z = p.z0 + (p.z1 - p.z0) * hsh(k * 2.7 + t * 1.9 + p.level); if (inside(p.ring, x, z)) break; } flock.push({ p, x, z, yaw: hsh(k) * TAU, k }); } }
  if (flock.length) {
    const ducks = meshOf(duck, flock.length); ducks.name = 'Ducks';
    movers.push((time, dt) => {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
      flock.forEach((d, k) => {
        d.yaw += Math.sin(time * .3 + k) * .3 * dt;
        const nx = d.x + Math.sin(d.yaw) * .35 * dt, nz = d.z + Math.cos(d.yaw) * .35 * dt;
        if (inside(d.p.ring, nx + Math.sin(d.yaw) * 2, nz + Math.cos(d.yaw) * 2)) { d.x = nx; d.z = nz; } else d.yaw += 2 * dt;
        p.set(d.x, d.p.level + .36 + Math.sin(time * 2 + k) * .015, d.z); q.setFromAxisAngle(up, d.yaw); ducks.setMatrixAt(k, m.compose(p, q, s));
      });
      ducks.instanceMatrix.needsUpdate = true;
    });
  }
  // squirrels: grey, on the lawns by the paths, hopping in short dashes and stopping to look round
  const sq = new THREE.SphereGeometry(.12, 6, 4); sq.scale(1, .9, 1.7); sq.translate(0, .12, 0);
  const tail = new THREE.SphereGeometry(.1, 5, 4); tail.scale(.8, 1.8, .8); tail.translate(0, .25, -.2);
  const sqG = new THREE.BufferGeometry(); sqG.setAttribute('position', new THREE.Float32BufferAttribute([...sq.toNonIndexed().attributes.position.array, ...tail.toNonIndexed().attributes.position.array], 3)); sqG.computeVertexNormals();
  const spots = [];
  for (const e of L.edges || []) if (e.kind === 'path') for (let i = 3; i < e.n - 1; i += 23) { const s = hsh(e.x[i] + e.z[i]) < .5 ? 1 : -1, dx = e.x[i + 1] - e.x[i], dz = e.z[i + 1] - e.z[i], l = Math.hypot(dx, dz) || 1; spots.push({ x0: e.x[i] - dz / l * s * 5, z0: e.z[i] + dx / l * s * 5, k: spots.length }); if (spots.length >= 120) break; }
  if (spots.length) {
    const sqm = meshOf(sqG, spots.length, '#7d7a74'); sqm.name = 'Squirrels';
    for (const s of spots) s.y = H(s.x0, s.z0);
    movers.push((time) => {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
      spots.forEach((s, k) => {
        const t = time * .25 + hsh(k) * 9, cyc = t % 1, leg = Math.floor(t), a = hsh(leg * 3.7 + k) * TAU, r = 1.5 + hsh(leg + k * 1.3) * 2.5;
        const dash = Math.min(1, cyc * 4), hop = cyc < .25 ? Math.abs(Math.sin(cyc * 4 * Math.PI * 3)) * .12 : 0;
        p.set(s.x0 + Math.cos(a) * r * dash, s.y + hop, s.z0 + Math.sin(a) * r * dash); q.setFromAxisAngle(up, Math.PI / 2 - a);
        sqm.setMatrixAt(k, m.compose(p, q, sc));
      });
      sqm.instanceMatrix.needsUpdate = true;
    });
  }
  let last = null;
  return { count: made, lamps: lampN, benches: benchN, tick(time) { const dt = last == null ? 0 : Math.min(.1, Math.max(0, time - last)); last = time; for (const f of movers) f(time, dt); } };
}
