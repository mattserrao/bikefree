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
import { V, centroid, scaleRing, orient, prism, cap, block, frameOf, makeFrame, lathe, gable, faceOut } from './hero-geom.js';

export function cnyLandmarkModels({ S, N, glows, plan, ground, local, L }) {
  const TRIM = '#f3f1ea';
  /** A window (dark glass, a white frame) on the wall of frame F at (a, b), facing out along n (±1 on v, or the u end). */
  const window = (F, a, b, y, w, h, onEnd = false, s = 1) => {
    const q = F.at(a, b), n = onEnd ? { x: F.u.x * s, z: F.u.z * s } : { x: F.v.x * s, z: F.v.z * s }, yaw = onEnd ? F.yawV : F.yawU;
    S.color(TRIM); S.box(q.x + n.x * .04, y - .08, q.z + n.z * .04, .1, h + .16, w + .16, yaw);
    S.color('#2c3238'); S.box(q.x + n.x * .1, y, q.z + n.z * .1, .08, h, w, yaw);
    N.color('#2c3238').set({ aGlow: [1, .78, .45] }); N.box(q.x + n.x * .14, y + .05, q.z + n.z * .14, .02, h - .1, w - .1, yaw);
  };

  return {
    // the canal's water: a ribbon along OSM's line, just over the ground across its width (the land cover's 6 m cells
    // gave it stepped edges and the ground's grid hid it where the grid stands higher)
    canal(l) {
      const P = l.path.map(([a, o]) => local(a, o)), hw = (l.widthM || 12) / 2;
      // resample every 4 m
      const pts = [];
      for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 4)); for (let k = 0; k < n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); }
      pts.push(P[P.length - 1]);
      const S2 = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / d, nz = (b.x - a.x) / d;
        const y = Math.max(L.heightAt(p.x, p.z), L.heightAt(p.x + nx * hw, p.z + nz * hw), L.heightAt(p.x - nx * hw, p.z - nz * hw)) + .12;
        return { x: p.x, z: p.z, nx, nz, y };
      });
      // a gentle smoothing of the level along it (no steps)
      for (let pass = 0; pass < 3; pass++) for (let i = 1; i + 1 < S2.length; i++) S2[i].y = Math.max(S2[i].y - .3, (S2[i - 1].y + S2[i].y * 2 + S2[i + 1].y) / 4);
      S.color('#3d6b7c');
      const up = V(0, 1, 0);
      for (let i = 0; i + 1 < S2.length; i++) {
        const a = S2[i], b = S2[i + 1];
        faceOut(S, [V(a.x + a.nx * hw, a.y, a.z + a.nz * hw), V(b.x + b.nx * hw, b.y, b.z + b.nz * hw), V(b.x - b.nx * hw, b.y, b.z - b.nz * hw), V(a.x - a.nx * hw, a.y, a.z - a.nz * hw)], up);
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
      S.color('#3d6b7c'); prism(S, F.rect(-hl - .5, hl + .5, t0, t1), yW - .02, yW); cap(S, F.rect(-hl - .5, hl + .5, t0, t1), yW);
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

    canalboat(l) {
      const c = local(l.center[0], l.center[1]), g = L.heightAt(c.x, c.z), deg = l.axisDeg ?? 312, r = deg * Math.PI / 180;
      const F = makeFrame(c, { x: Math.sin(r), z: -Math.cos(r) }, undefined, 9, 2.1);
      const hull = [F.at(-9, -1.6), F.at(7.5, -2.1), F.at(9, 0), F.at(7.5, 2.1), F.at(-9, 1.6)];
      S.color('#2f4a3a'); block(S, hull, g - .5, g + .7);
      S.color('#b33a2e'); prism(S, scaleRing(hull, 1.01, c), g + .45, g + .7);
      S.color(TRIM); block(S, F.rect(-6.5, 4.5, -1.5, 1.5), g + .7, g + 2.6);
      S.color('#2c3238'); for (let k = 0; k < 6; k++) for (const s of [-1, 1]) { const q = F.at(-5.8 + k * 1.8, s * 1.52); S.box(q.x, g + 1.5, q.z, .06, .7, 1.1, F.yawU); }
      S.color('#6b2f28'); block(S, F.rect(-6.8, 4.8, -1.75, 1.75), g + 2.6, g + 2.8);
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
