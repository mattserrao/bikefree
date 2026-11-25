// PGH's other landmarks (user, 21 Nov: "work through them all"): the ones the Pittsburgh map never modelled, each
// from its real form — the downtown towers and theatres, the courthouse, the North Side's museums, Oakland's
// halls, the monuments — on its OSM outline (tools/pgh_heroes.mjs) with the city's own materials (the towers' windowed
// walls, the solid details, the night glows). Plus the closed stadium bowls (city/bridges.js buildStadiums), Phipps
// as a closed glasshouse, both inclines, Grandview's overlooks and the subway's street entrances.
//
//   buildPghLandmarks(host, data) → { tick(time), count }      (host: the CityScene stand-in of js/world/graph-heroes.js)
import * as THREE from '../../../../vendor/three.module.min.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { V, TAU, centroid, scaleRing, orient, prism, cap, block, chamfer, frameOf, makeFrame, lathe, disc, gable } from './hero-geom.js';
import { buildStadiums } from './bridges.js';
import { glasshouseFrame } from '../structures/glasshouse.js';
import { cnyLandmarkModels, canalWaterMaterial } from './cny-landmarks.js';
import { skanLandmarkModels } from './skan-landmarks.js';
import { nycLandmarkModels, nycPark } from './nyc-landmarks.js';
import { qcOn, qcProbe } from './qc-probe.js';   // (a QC run: tools/qc_map.mjs)   // (NYC's: Central Park — Bethesda, Bow Bridge, Belvedere…, the wall and its gates)   // (SKAN's: Clift Park's pier and gazebo, the Sherwood Inn, mansions…)   // (CNY's: the aqueduct, Sims' Store, the Octagon House…)

export function buildPghLandmarks(host, data) {
  const L = host.landscape, proj = host.D.proj;
  const W = new MeshBuilder({ aBld: 4 }), S = new MeshBuilder(), N = new MeshBuilder({ aGlow: 3 }), Wa = new MeshBuilder(), Ca = new MeshBuilder();   // (Wa: water surfaces, in the world's water material; Ca: the canal's)
  const glows = [], beacons = [];
  const local = (la, lo) => proj.toLocal(la, lo);
  const ground = (ring) => { let g = Infinity; for (const p of ring) g = Math.min(g, L.heightAt(p.x, p.z)); return g; };
  const wall = (kind, seed, g, roof = 0, color = null) => { if (color) W.color(color); return W.set({ aBld: [kind, seed * 100, g, roof] }); };
  const P = (q, y) => V(q.x, y, q.z);
  const rectRing = (c, hl, hw, deg = 0) => { const r = deg * Math.PI / 180; return makeFrame(c, { x: Math.sin(r), z: -Math.cos(r) }, undefined, hl, hw).rect(-hl, hl, -hw, hw); };
  let made = 0;
  /** A landmark's outline (local) and frame: its OSM outline, else a rectangle of the given size round its centre. */
  const plan = (l, hl = 15, hw = 10, deg = 0) => {
    const c = local(l.center[0], l.center[1]);
    const ring = l.ring && l.ring.length >= 4 ? orient(l.ring.map(([a, o]) => local(a, o))) : rectRing(c, hl, hw, deg);
    const F = frameOf(ring);
    return { ring, F, c: l.ring ? centroid(ring) : c, g: ground(ring) };
  };
  const statue = (q, g, { plinth = 2.4, w = 1.8, fig = 2.2, color = '#4f5a52', stone = '#b9b2a4', yaw = 0 } = {}) => {
    S.color(stone); S.box(q.x, g, q.z, w + 1, .5, w + 1, yaw); S.box(q.x, g + .5, q.z, w, plinth, w, yaw);
    S.color(color); S.cylinder(q.x, g + .5 + plinth, q.z, .34, fig * .55, 8, .28); S.cylinder(q.x, g + .5 + plinth + fig * .55, q.z, .3, fig * .3, 8, .22);
    S.cylinder(q.x, g + .5 + plinth + fig * .85, q.z, .17, fig * .2, 8, .15);
  };
  /** A row of columns along frame F's u at b, from a0 to a1. */
  const colonnade = (F, a0, a1, b, n, y0, h, r = .45, color = '#d8d0c0') => { S.color(color); for (let k = 0; k < n; k++) { const q = F.at(a0 + (a1 - a0) * k / Math.max(1, n - 1), b); S.cylinder(q.x, y0, q.z, r, h, 10, r * .9); } };

  const M = {
    // Koppers Tower (1929): 145 m Art Deco, grey granite and limestone, setbacks, a copper-sheathed chateau roof
    // (verdigris), floodlit at night
    koppers(l) {
      const { ring, F, c, g } = plan(l, 22, 18), H = 145;
      wall(11, .41, g, 0, '#a9a397'); prism(W, ring, g - 1, g + H * .62);
      wall(11, .41, g, 1); cap(W, ring, g + H * .62);
      const r2 = scaleRing(ring, .84, c), r3 = scaleRing(ring, .7, c);
      wall(11, .42, g); block(W, r2, g + H * .62, g + H * .82);
      wall(11, .43, g); block(W, r3, g + H * .82, g + H * .9);
      S.color('#5f9a84'); S.pyramid(c.x, g + H * .9, c.z, F.hl * 1.15, 14, F.hw * 1.15, F.yawU);   // the copper roof
      S.color('#6aa58d'); S.cylinder(c.x, g + H * .9 + 13, c.z, .5, 6, 6, .1);
      N.color('#cfc8b6').set({ aGlow: [1, .85, .55] }); prism(N, scaleRing(r3, 1.01, c), g + H * .86, g + H * .9);
      beacons.push({ x: c.x, y: g + H + 4, z: c.z });
    },
    // Frick Building (1902): 101 m, a Beaux-Arts slab of granite, a heavy base, a deep cornice
    frick(l) {
      const { ring, c, g } = plan(l, 30, 14), H = 101;
      S.color('#7d7a73'); block(S, scaleRing(ring, 1.01, c), g - 1, g + 9);
      wall(5, .62, g, 0, '#a7a196'); prism(W, ring, g + 9, g + H - 6);
      S.color('#9b958a'); block(S, scaleRing(ring, 1.04, c), g + H - 6, g + H - 4); S.color('#8a857c'); block(S, ring, g + H - 4, g + H);
    },
    // Mellon National Bank (1924): four storeys of granite behind a colonnade of tall Ionic columns
    mellonbank(l) {
      const { ring, F, c, g } = plan(l, 30, 22), H = 26;
      S.color('#cfc6b4'); block(S, scaleRing(ring, .92, c), g - 1, g + H);
      S.color('#d9d0be'); block(S, scaleRing(ring, .96, c), g + H, g + H + 2.2);
      colonnade(F, -F.hl * .85, F.hl * .85, F.hw * .97, 10, g + 2, H - 4, .75);
      colonnade(F, -F.hl * .85, F.hl * .85, -F.hw * .97, 10, g + 2, H - 4, .75);
      S.color('#bdb4a2'); block(S, ring, g, g + 2);
    },
    // The Tower at PNC Plaza (2015): 166 m of glass, a double skin, the "solar chimney" crown open to the sky
    pncplaza(l) {
      const { ring, c, g } = plan(l, 28, 20), H = 166;
      wall(9, .73, g, 0, '#6f8794'); prism(W, chamfer(ring, .08), g - 1, g + H - 14);
      wall(9, .73, g, 1); cap(W, chamfer(ring, .08), g + H - 14);
      S.color('#8fa6b2'); prism(S, scaleRing(chamfer(ring, .08), 1.02, c), g + H - 14, g + H);   // the open crown's glass fins
      S.color('#5a6b73'); block(S, scaleRing(ring, .6, c), g + H - 14, g + H - 4);
      beacons.push({ x: c.x, y: g + H + 2, z: c.z });
    },
    // EQT Plaza (1987): 131 m, pink-grey granite and glass bands, a stepped top
    eqt(l) {
      const { ring, c, g } = plan(l, 30, 25), H = 131;
      wall(5, .35, g, 0, '#b7a39c'); prism(W, ring, g - 1, g + H - 10);
      wall(5, .35, g, 1); cap(W, ring, g + H - 10);
      wall(5, .36, g); block(W, scaleRing(ring, .86, c), g + H - 10, g + H - 4);
      S.color('#9c8a84'); block(S, scaleRing(ring, .7, c), g + H - 4, g + H);
      beacons.push({ x: c.x, y: g + H + 2, z: c.z });
    },
    // Heinz Hall (1927): the old Loew's Penn, cream terracotta, tall arched windows over the marquee
    heinzhall(l) {
      const { ring, F, c, g } = plan(l, 40, 20, 30), H = 22;
      S.color('#d9cdb2'); block(S, ring, g - 1, g + H);
      S.color('#c9bc9f'); block(S, scaleRing(ring, 1.02, c), g + H, g + H + 1.4);
      for (let k = -3; k <= 3; k++) { const q = F.at(k * F.hl / 4.2, F.hw + .05); S.color('#5f6b74'); S.box(q.x, g + 7, q.z, 3, 9, .3, F.yawU); S.color('#e8dcc2'); S.cylinder(q.x, g + 16, q.z, 1.5, .4, 8, 1.5); }
      N.color('#f3e3b0').set({ aGlow: [1, .82, .45] }); { const q = F.at(0, F.hw + 2.5); N.box(q.x, g + 4.2, q.z, 22, 1.4, 5, F.yawU); }   // the marquee
      glows.push({ ...P(F.at(0, F.hw + 3.5), g + 5), size: 6, color: '#ffd27a' });
    },
    // The Benedum Center (1928): the Stanley Theatre, buff brick and terracotta, a vertical blade sign
    benedum(l) {
      const { ring, F, c, g } = plan(l, 40, 30), H = 28;
      wall(2, .52, g, 0, '#b28c6c'); block(W, ring, g - 1, g + H);
      S.color('#d6c6a6'); prism(S, scaleRing(ring, 1.01, c), g + H - 2, g + H);
      const q = F.at(F.hl * .6, F.hw + .8);
      N.color('#c23a2b').set({ aGlow: [1, .35, .25] }); N.box(q.x, g + 8, q.z, .6, 16, 2.2, F.yawU);   // BENEDUM, the blade sign
      N.color('#f1e3b5').set({ aGlow: [1, .85, .5] }); { const m = F.at(F.hl * .6, F.hw + 2.6); N.box(m.x, g + 4.5, m.z, 12, 1.2, 4, F.yawU); }
    },
    // Allegheny County Courthouse & Jail (1888, H. H. Richardson): rough grey granite, round arches, the 76 m tower;
    // the jail behind it across Ross Street, linked by the "Bridge of Sighs"
    courthouse(l) {
      const { ring, F, c, g } = plan(l, 62, 40), H = 24;
      S.color('#8c8579'); block(S, ring, g - 1, g + H);
      S.color('#5a514b'); gable(S, F, -F.hl, F.hl, F.hw * .5, g + H, g + H + 9, { endColor: '#8c8579' });
      const t = F.at(F.hl * .45, 0); S.color('#8a8377'); S.box(t.x, g, t.z, 13, 62, 13, F.yawU); S.color('#5a514b'); S.pyramid(t.x, g + 62, t.z, 14, 14, 14, F.yawU);
      for (const s of [-1, 1]) { const q = F.at(F.hl * .45 + s * 4.5, F.hw * .0); S.color('#7f786d'); S.cylinder(q.x, g + 62, q.z, 1.1, 6, 8, .2); }
      for (let k = -4; k <= 4; k++) { const q = F.at(k * F.hl / 5, F.hw + .05); S.color('#3d3a36'); S.box(q.x, g + 1.5, q.z, 3.6, 5.5, .25, F.yawU); }   // round-arched openings (dark bays)
      // the jail, across Ross Street, with its round turrets, and the bridge between
      const j = F.sub(-F.hl - 30, 0); S.color('#7b756b'); S.box(j.c.x, g, j.c.z, 46, 18, 38, F.yawU);
      for (const [a, b] of [[-23, -19], [23, -19], [-23, 19], [23, 19]]) { const q = j.at(a, b); S.cylinder(q.x, g, q.z, 3.2, 22, 12); S.color('#5a514b'); S.cylinder(q.x, g + 22, q.z, 3.4, 4, 12, 0); S.color('#7b756b'); }
      { const a = F.at(-F.hl, 0), b = j.at(23, 0); S.color('#837c71'); S.beam(V(a.x, g + 10, a.z), V(b.x, g + 10, b.z), 4, 5); }
    },
    // Engine Company No. 1: a brick firehouse with arched engine doors and a hose-drying tower
    engine1(l) {
      const { ring, F, c, g } = plan(l, 14, 10), H = 14;
      wall(0, .44, g, 0, '#93533c'); block(W, ring, g - 1, g + H);
      for (const s of [-1, 1]) { const q = F.at(s * F.hl * .4, F.hw + .05); S.color('#7a1f1a'); S.box(q.x, g, q.z, 4.5, 5, .25, F.yawU); }
      const t = F.at(-F.hl * .75, -F.hw * .5); S.color('#8a4c37'); S.box(t.x, g, t.z, 4, 24, 4, F.yawU); S.color('#4e4a46'); S.pyramid(t.x, g + 24, t.z, 5, 3, 5, F.yawU);
    },
    // The P&LE terminal at Station Square (1901): five storeys of brick and terracotta, the Grand Concourse's barrel vault
    pleterminal(l) {
      const { ring, F, c, g } = plan(l, 45, 18), H = 22;
      wall(2, .66, g, 0, '#a5644b'); block(W, ring, g - 1, g + H);
      S.color('#d2c3a2'); prism(S, scaleRing(ring, 1.02, c), g + H - 1.5, g + H);
      S.color('#4d6d73'); for (let k = 0; k < 12; k++) { const a0 = Math.PI * k / 12, a1 = Math.PI * (k + 1) / 12, r = F.hw * .7; const y0 = g + H + Math.sin(a0) * 6, y1 = g + H + Math.sin(a1) * 6;
        const p0 = F.at(-F.hl * .8, -Math.cos(a0) * r), p1 = F.at(F.hl * .8, -Math.cos(a0) * r), p2 = F.at(F.hl * .8, -Math.cos(a1) * r), p3 = F.at(-F.hl * .8, -Math.cos(a1) * r);
        S.quad(V(p0.x, y0, p0.z), V(p1.x, y0, p1.z), V(p2.x, y1, p2.z), V(p3.x, y1, p3.z)); }
    },
    // Carnegie Library of Allegheny (1890): Romanesque, rough granite, a clock tower over Federal Street
    carnegielib(l) {
      const { ring, F, c, g } = plan(l, 30, 18, 0), H = 16;
      S.color('#8f877a'); block(S, ring, g - 1, g + H);
      S.color('#57504a'); gable(S, F, -F.hl, F.hl, F.hw, g + H, g + H + 7, { endColor: '#8f877a' });
      const t = F.at(F.hl * .7, F.hw * .3); S.color('#8a8275'); S.box(t.x, g, t.z, 7, 36, 7, F.yawU); S.color('#4f4842'); S.pyramid(t.x, g + 36, t.z, 7.6, 7, 7.6, F.yawU);
      S.color('#e8e2d4'); for (const [a, b] of [[0, 3.55], [3.55, 0], [0, -3.55], [-3.55, 0]]) { const q = { x: t.x + F.u.x * a + F.v.x * b, z: t.z + F.u.z * a + F.v.z * b }; disc(S, V(q.x, g + 30, q.z), { x: F.u.x * a + F.v.x * b, z: F.u.z * a + F.v.z * b }, 1.6, 14); }
    },
    // The Buhl Planetarium (1939, the Children's Museum): Art Deco limestone, a flat front and the planetarium's dome
    buhl(l) {
      const { ring, F, c, g } = plan(l, 35, 25), H = 14;
      S.color('#d6cfbf'); block(S, ring, g - 1, g + H);
      S.color('#b3aa98'); S.cylinder(c.x, g + H, c.z, 11, 3, 24); lathe(S, c.x, g + H + 3, c.z, [[11, 0], [10.3, 3], [8.2, 6], [5, 8.4], [0, 9.6]], 24);
      for (let k = -2; k <= 2; k++) { const q = F.at(k * 3, F.hw + .1); S.color('#cfc7b6'); S.box(q.x, g, q.z, 1, H - 2, 1, F.yawU); }
    },
    // The Andy Warhol Museum: a seven-storey terracotta-and-brick warehouse (1911)
    warhol(l) {
      const { ring, c, g } = plan(l, 30, 22), H = 31;
      wall(2, .27, g, 0, '#b7907a'); block(W, ring, g - 1, g + H);
      S.color('#d4c2a8'); prism(S, scaleRing(ring, 1.015, c), g + H - 1.2, g + H);
    },
    // The Mattress Factory: a six-storey brick warehouse (the old Stearns & Foster factory)
    mattress(l) {
      const { ring, c, g } = plan(l, 25, 15), H = 24;
      wall(0, .58, g, 0, '#8e5440'); block(W, ring, g - 1, g + H);
    },
    // A Civil War column with a figure on top (Allegheny Commons)
    column(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#a59f92'); S.box(q.x, g, q.z, 6, 1, 6); S.box(q.x, g + 1, q.z, 4, 3.5, 4);
      S.color('#b8b1a3'); S.cylinder(q.x, g + 4.5, q.z, .9, 14, 14, .75); S.box(q.x, g + 18.5, q.z, 2.2, .8, 2.2);
      statue(q, g + 19.3, { plinth: .2, w: .8, fig: 2.6, stone: '#b8b1a3' });
    },
    // Korean War Veterans Memorial, North Shore: a ring of granite slabs round a plaza
    korean(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#c8c3b8'); S.cylinder(q.x, g, q.z, 13, .25, 32);
      S.color('#8d8984'); for (let k = 0; k < 10; k++) { const a = k / 10 * TAU, x = q.x + Math.cos(a) * 10, z = q.z + Math.sin(a) * 10; if (L.wayNear?.(x, z, 1.8)) continue; S.box(x, L.heightAt(x, z), z, 2.2, 2.8, .45, -a + Math.PI / 2); }
    },
    // "Point of View": George Washington and Guyasuta face each other across a fire, on a granite base, Mount Washington
    pointofview(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#a59f92'); S.box(q.x, g, q.z, 7, 1.2, 4);
      for (const s of [-1, 1]) statue({ x: q.x + s * 1.9, z: q.z }, g + 1.2, { plinth: .1, w: .9, fig: 2.4, color: '#5a4e3f' });
    },
    // A figure on a stone pedestal (the Doughboy, the Hiker, Bigelow, Washington)
    statue(l) { const q = local(l.center[0], l.center[1]); statue(q, L.heightAt(q.x, q.z), { plinth: 2.8, w: 2, fig: 2.6 }); },
    // Troy Hill's WWI monument: a granite obelisk on a stepped base
    obelisk(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#b3ada0'); S.box(q.x, g, q.z, 4, .5, 4); S.box(q.x, g + .5, q.z, 3, .6, 3); S.box(q.x, g + 1.1, q.z, 1.8, 6, 1.8); S.pyramid(q.x, g + 7.1, q.z, 1.8, 1.2, 1.8);
    },
    // Vietnam Veterans Memorial, North Shore: a ring of stainless-steel canopy on columns over the figures
    vietnam(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#c9c4b9'); S.cylinder(q.x, g, q.z, 10, .3, 32);
      S.color('#d7dde2'); for (let k = 0; k < 24; k++) { const a0 = k / 24 * TAU, a1 = (k + 1) / 24 * TAU; S.beam(V(q.x + Math.cos(a0) * 7.5, g + 5.2, q.z + Math.sin(a0) * 7.5), V(q.x + Math.cos(a1) * 7.5, g + 5.2, q.z + Math.sin(a1) * 7.5), 2.2, .5); }
      S.color('#9aa3a9'); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; S.cylinder(q.x + Math.cos(a) * 7.5, g, q.z + Math.sin(a) * 7.5, .2, 5, 8); }
      statue(q, g + .3, { plinth: .6, w: 1.4, fig: 2.2 });
    },
    // The Steelworkers Monument, Homestead: a steel ladle and figures on a brick plinth
    steelworkers(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#8b4b38'); S.box(q.x, g, q.z, 5, 1.5, 5);
      S.color('#3e3d3b'); lathe(S, q.x, g + 1.5, q.z, [[1.2, 0], [1.8, .4], [2.1, 1.8], [2.2, 3], [0, 3]], 16);
      statue({ x: q.x + 3, z: q.z }, g, { plinth: .4, w: .8, fig: 2.2, color: '#3e3d3b' });
    },
    // Columbus, Schenley Park: a tall granite pedestal with a globe and the navigator on top
    columbus(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#bdb6a8'); S.box(q.x, g, q.z, 8, .6, 8); S.box(q.x, g + .6, q.z, 5, 1, 5); S.box(q.x, g + 1.6, q.z, 3.2, 5.5, 3.2);
      S.color('#4e5a50'); lathe(S, q.x + 1.6, g + 1.6, q.z, [[0, 0], [.7, .3], [.9, .9], [.7, 1.5], [0, 1.8]], 12);
      statue(q, g + 7.1, { plinth: .2, w: 1.2, fig: 3.2 });
    },
    // The Millennium Panther, Pitt: a bronze panther on a granite base
    panther(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z);
      S.color('#aaa396'); S.box(q.x, g, q.z, 3.5, 1.4, 2);
      S.color('#2f2c29'); S.box(q.x, g + 1.4, q.z, .9, .9, 2.4); S.box(q.x, g + 2, q.z - 1.3, .6, .6, .7); S.box(q.x, g + 1.4, q.z + 1.2, .25, .25, 1.4);
    },
    // The Senator John Heinz History Center: the 1898 Chautauqua Lake Ice warehouse, seven storeys of brick, the
    // painted ice-company sign and the big Heinz ketchup bottle on the corner
    history(l) {
      const { ring, F, c, g } = plan(l, 45, 25), H = 30;
      wall(0, .76, g, 0, '#93533e'); block(W, ring, g - 1, g + H);
      const b = F.at(F.hl * .9, F.hw * .9); S.color('#b3241f'); lathe(S, b.x, g + H, b.z, [[1.6, 0], [1.7, 4], [1.4, 6], [.6, 7.5], [.55, 9], [0, 9]], 12);
      S.color('#ffffff'); S.cylinder(b.x, g + H + 2, b.z, 1.72, 1.6, 12);
    },
    // The Produce Terminal (1926): a third of a mile of one-storey brick sheds under long gables, a loading dock
    produce(l) {
      const { F, g } = plan(l, 260, 15);
      wall(0, .39, g, 0, '#9a5a42'); block(W, F.rect(-F.hl, F.hl, -F.hw * .9, F.hw * .9), g - 1, g + 7);
      S.color('#56504a'); gable(S, F, -F.hl, F.hl, F.hw * .9, g + 7, g + 10.5, { endColor: '#9a5a42' });
      S.color('#8d8a84'); S.box(F.c.x + F.v.x * (F.hw + 1.5), g, F.c.z + F.v.z * (F.hw + 1.5), F.hl * 2, 1.2, 3, F.yawU);
    },
    // Penn Brewery (the old Eberhardt & Ober brewery, 1848–): brick halls, a tower with a pyramid roof
    brewery(l) {
      const { ring, F, c, g } = plan(l, 25, 15), H = 14;
      wall(0, .29, g, 0, '#8f5039'); block(W, ring, g - 1, g + H);
      const t = F.at(-F.hl * .6, 0); S.color('#8a4b35'); S.box(t.x, g, t.z, 7, 24, 7, F.yawU); S.color('#4f4a46'); S.pyramid(t.x, g + 24, t.z, 8, 5, 8, F.yawU);
    },
    // Hamerschlag Hall, CMU (1912): Beaux-Arts buff brick on the ravine's rim, the round rotunda with its colonnade
    // and dome, and the power plant's smokestack behind
    hamerschlag(l) {
      const { ring, F, c, g } = plan(l, 40, 18), H = 16;
      wall(2, .48, g, 0, '#c8aa84'); block(W, ring, g - 1, g + H);
      const r = F.at(0, F.hw); S.color('#cdb18c'); S.cylinder(r.x, g, r.z, 9, H + 6, 24);
      S.color('#e1d6c1'); for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; S.cylinder(r.x + Math.cos(a) * 9.6, g + H - 2, r.z + Math.sin(a) * 9.6, .45, 8, 8); }
      S.color('#8c8f8a'); lathe(S, r.x, g + H + 6, r.z, [[9, 0], [7.5, 3], [4, 5], [0, 5.6]], 20);
      const s = F.at(-F.hl * .8, -F.hw * .6); S.color('#8f5a43'); S.cylinder(s.x, g, s.z, 1.8, 42, 12, 1.3);
    },
    // The Forbes Field wall: a run of the old ballpark's brick outfield wall, ivy and the 457 ft marker, a flagpole
    forbes(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z), F = makeFrame(q, { x: Math.sin(.6), z: -Math.cos(.6) });
      S.color('#8f4a37'); S.box(q.x, g, q.z, .6, 3.8, 36, F.yawU); S.color('#3f5b31'); S.box(q.x, g + 1, q.z, .75, 2.4, 30, F.yawU);
      S.color('#9aa0a5'); const f = F.at(20, 2); S.cylinder(f.x, g, f.z, .15, 18, 6, .1);
    },
    // Stephen Foster Memorial (1937): Gothic limestone to match the Cathedral, a hall and a tower
    foster(l) {
      const { ring, F, c, g } = plan(l, 30, 20), H = 15;
      S.color('#c9bc9f'); block(S, ring, g - 1, g + H);
      S.color('#4b5157'); gable(S, F, -F.hl * .9, F.hl * .9, F.hw * .6, g + H, g + H + 8, { endColor: '#c9bc9f' });
      const t = F.at(F.hl * .85, 0); S.color('#c4b799'); S.box(t.x, g, t.z, 8, 28, 8, F.yawU);
      for (const [a, b] of [[-3.6, -3.6], [3.6, -3.6], [3.6, 3.6], [-3.6, 3.6]]) { const p = { x: t.x + F.u.x * a + F.v.x * b, z: t.z + F.u.z * a + F.v.z * b }; S.pyramid(p.x, g + 28, p.z, 1.2, 5, 1.2); }
    },
    // The Mellon Institute (1937): a limestone block ringed by 62 monolithic Ionic columns, a copper roof
    melloninst(l) {
      const { F, c, g } = plan(l, 50, 40), H = 32, R = F.rect(-F.hl * .92, F.hl * .92, -F.hw * .92, F.hw * .92);
      S.color('#d4ccb9'); block(S, R, g - 1, g + H);
      S.color('#cfc7b4'); block(S, F.rect(-F.hl, F.hl, -F.hw, F.hw), g - 1, g + 3);   // (the podium the colonnade stands on — QC, 25 Nov: the columns hung 3 m up)
      for (const b of [-F.hw, F.hw]) colonnade(F, -F.hl * .95, F.hl * .95, b, 18, g + 3, 13, .7, '#ddd5c3');
      for (const a of [-F.hl, F.hl]) colonnade(makeFrame(F.at(a, 0), F.v), -F.hw * .9, F.hw * .9, 0, 13, g + 3, 13, .7, '#ddd5c3');
      S.color('#d9d1be'); block(S, F.rect(-F.hl, F.hl, -F.hw, F.hw), g + 16, g + 18.5);
      S.color('#6f8f80'); block(S, scaleRing(R, .9, c), g + H, g + H + 2);
    },
    // The Frick Fine Arts Building (1965): an Italian Renaissance villa in limestone, a red tile roof, an arcade
    frickarts(l) {
      const { ring, F, c, g } = plan(l, 40, 20), H = 11;
      S.color('#d7ccb4'); block(S, ring, g - 1, g + H);
      S.color('#a4553d'); gable(S, F, -F.hl, F.hl, F.hw * .8, g + H, g + H + 4, { endColor: '#d7ccb4' });
      colonnade(F, -F.hl * .7, F.hl * .7, F.hw + .1, 9, g, 6, .35, '#e3dac6');
    },
    // Station Square: the Freight House shops along the river, and the "STATION SQUARE" sign
    stationsquare(l) {
      const { F, g } = plan(l, 120, 14);
      wall(0, .57, g, 0, '#9a5d45'); block(W, F.rect(-F.hl * .9, F.hl * .9, -9, 9), g - 1, g + 10);
      S.color('#55504a'); gable(S, F, -F.hl * .9, F.hl * .9, 9, g + 10, g + 13, { endColor: '#9a5d45' });
      const s = F.at(0, -16); N.color('#e03a2b').set({ aGlow: [1, .3, .2] }); N.box(s.x, g + 14, s.z, 30, 3, .5, F.yawU);
    },
    // Highland Park's reservoir: open water behind its stone coping (Reservoir No. 1)
    reservoir(l) {
      const ring = orient(l.ring.map(([a, o]) => local(a, o))), c = centroid(ring), g = ground(ring);
      S.color('#a8a294'); prism(S, scaleRing(ring, 1.01, c), g - 1.5, g + .4);
      const w = new THREE.Mesh(host.own(new THREE.ShapeGeometry(new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z))))), host.own(new THREE.MeshLambertMaterial({ color: '#4f8aa3' })));
      w.rotation.x = -Math.PI / 2; w.position.y = g - .2; host.group.add(w);
    },
    // Randyland: a three-storey corner house painted every colour there is
    randyland(l) {
      const { F, g } = plan(l, 8, 6), cols = ['#f2c12e', '#e8432f', '#3aa1d9', '#7bc142', '#c04fb3', '#ff8b2a'];
      for (let k = 0; k < 6; k++) { S.color(cols[k]); const a0 = -F.hl + k * F.hl / 3; block(S, F.rect(a0, a0 + F.hl / 3, -F.hw, F.hw), g - 1, g + 9 + (k % 2)); }
      S.color('#3aa1d9'); gable(S, F, -F.hl, F.hl, F.hw, g + 9, g + 12, { endColor: '#f2c12e' });
    },
    // The National Aviary: low brick and glass halls, the Tropical Rainforest's glass pyramid roof
    aviary(l) {
      const { ring, F, c, g } = plan(l, 40, 30), H = 8;
      S.color('#a77c62'); block(S, ring, g - 1, g + H);
      S.color('#b8d2da'); S.pyramid(c.x, g + H, c.z, F.hw * 1.1, 9, F.hw * 1.1, F.yawU);
      const d = F.at(F.hl * .5, 0); S.color('#c4dbe1'); lathe(S, d.x, g + H, d.z, [[8, 0], [7, 3], [4, 5.5], [0, 6.3]], 16);
    },
    // The Allegheny Observatory (1912): neoclassical buff brick, three copper telescope domes
    observatory(l) {
      const { ring, F, c, g } = plan(l, 30, 14), H = 9;
      S.color('#cdb898'); block(S, ring, g - 1, g + H);
      colonnade(F, -4, 4, F.hw + 1, 4, g, 7, .4, '#e2d8c4');
      for (const [a, r] of [[0, 6], [-F.hl * .75, 4.2], [F.hl * .75, 4.2]]) { const q = F.at(a, 0); S.color('#c9b391'); S.cylinder(q.x, g + H, q.z, r, 2.5, 20); S.color('#6e9384'); lathe(S, q.x, g + H + 2.5, q.z, [[r, 0], [r * .9, r * .45], [r * .6, r * .8], [0, r]], 20); }
    },
    // The Pittsburgh Zoo's entrance: a gateway arch with the name panel and two pylons
    zoo(l) {
      const q = local(l.center[0], l.center[1]), g = L.heightAt(q.x, q.z), F = makeFrame(q, { x: 1, z: 0 });
      for (const s of [-1, 1]) { const p = F.at(s * 9, 0); S.color('#8c6e52'); S.box(p.x, g, p.z, 2.4, 9, 2.4, F.yawU); }
      S.color('#6b8f3c'); S.box(q.x, g + 9, q.z, 21, 2.4, 1.2, F.yawU);
    },
    // Sandcastle waterpark: slide towers and the slides' coloured tubes down to the river
    sandcastle(l) {
      const ring = orient(l.ring.map(([a, o]) => local(a, o))), c = centroid(ring), g = ground([c]);
      const cols = ['#e8432f', '#f2c12e', '#3aa1d9', '#7bc142'];
      for (let k = 0; k < 3; k++) {
        const t = { x: c.x + (k - 1) * 18, z: c.z - 10 }; S.color('#c9b48f'); S.box(t.x, g, t.z, 5, 14 + k * 3, 5);
        for (let j = 0; j < 2; j++) { S.color(cols[(k + j) % 4]); S.beam(V(t.x + 2, g + 13 + k * 3, t.z + j * 2), V(t.x + 14 + j * 6, g + .6, t.z + 40 + j * 8), 1.4, 1.4); }
      }
      S.color('#61c3d9'); S.box(c.x, g, c.z + 20, 30, .4, 16);
    },
  };

  if (qcOn()) qcProbe(S, (L.qc ||= { basins: [], benches: [], bridges: [], views: [] }));
  Object.assign(M, cnyLandmarkModels({ S, N, glows, plan, ground, local, L, Wa, Ca }));
  Object.assign(M, skanLandmarkModels({ S, N, glows, plan, ground, local, L, Wa }));
  for (const [k, f] of Object.entries(nycLandmarkModels({ S, N, glows, plan, ground, local, L, Wa }))) M[`nyc_${k}`] = f;   // (prefixed: PGH has its own obelisk, statue, reservoir…)
  for (const l of data.landmarks || []) {
    const f = M[l.model];
    if (!f) continue;
    if (L.qc?.prims) L.qc.prims.cur = l.label;
    try { f(l); made++; if (L.qc && !/lawn|reservoir|view|conservatory/.test(l.model) && l.center) { const c = local(l.center[0], l.center[1]); L.qc.views.push({ x: c.x, z: c.z, name: l.label }); if (/bowbridge|gapstow/.test(l.model)) L.qc.bridges.push({ x: c.x, z: c.z, name: l.label, onWay: !!L.qc.onWay?.includes(l.label) }); } } catch (err) { console.warn(`PGH landmark ${l.label}: ${err.message}`); }
  }

  // the stadiums, closed (user, 21 Nov): the map's bowl builder, on their OSM outlines
  host.landscape.data = { stadiums: (data.stadiums || []).filter((s) => s.ring && s.ring.length >= 4).map((s) => ({ ...s })) };
  host.landscape.baseHeight = L.heightAt;
  host.D.local = (a, o) => proj.toLocal(a, o);
  host.route.scene.stadiumShapes = {};
  try { if (buildStadiums(host)) made += host.landscape.data.stadiums.length; } catch (err) { console.warn(`PGH stadiums: ${err.message}`); }

  // Phipps Conservatory, closed: its rooms as glass houses with domed and gabled roofs on a brick base
  if (data.phipps) {
    const p = data.phipps, GF = glasshouseFrame(p, proj);
    const F = { rect: (a0, a1, b0, b1) => [GF.toXZ(a0, b0), GF.toXZ(a1, b0), GF.toXZ(a1, b1), GF.toXZ(a0, b1)] };
    const pu = GF.toXZ(1, 0), p0 = GF.toXZ(0, 0); F.u = { x: pu.x - p0.x, z: pu.z - p0.z }; F.v = { x: -F.u.z, z: F.u.x };
    const G = new MeshBuilder();
    for (const r of p.rooms || []) {
      const [a0, a1, b0, b1] = r.rect, ring = orient(F.rect(a0, a1, b0, b1)), g = ground(ring), h = r.wallM || 8;
      S.color('#a77860'); block(S, ring, g - 1, g + 1.2);
      G.color('#dfeaee'); prism(G, ring, g + 1.2, g + h);
      const c = centroid(ring), hl = Math.abs(a1 - a0) / 2, hw = Math.abs(b1 - b0) / 2;
      if (r.roof === 'dome') { const R = Math.min(hl, hw), d = r.dome || {}, rise = d.riseM || R; G.cylinder(c.x, g + h, c.z, R * .9, d.drumM || 6, 24); lathe(G, c.x, g + h + (d.drumM || 6), c.z, [[R * .9, 0], [R * .78, rise * .45], [R * .45, rise * .85], [R * .12, rise]], 24); G.cylinder(c.x, g + h + (d.drumM || 6) + rise, c.z, R * .12, d.lanternM || 6, 12, R * .04); }
      else { const n = (q) => { const l = Math.hypot(q.x, q.z); return { x: q.x / l, z: q.z / l }; }; gable(G, makeFrame(c, n(hl >= hw ? F.u : F.v)), -Math.max(hl, hw), Math.max(hl, hw), Math.min(hl, hw), g + h, g + h + (r.riseM || Math.min(hl, hw) * .6), { endColor: '#dfeaee' }); }
    }
    const glass = host.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .15, metalness: .2, transparent: true, opacity: .55 }));
    const m = new THREE.Mesh(host.own(G.geometry()), glass); m.name = 'Phipps glass'; host.group.add(m);
    made++;
  }

  // the inclines: tracks on trestles from the river to the bluff, the stations, the two cars (they run)
  const cars = [];
  for (const inc of data.inclines || []) {
    const pts = inc.path.map(([a, o]) => local(a, o));
    let lo = pts[0], hi = pts[0];
    for (const q of pts) { q.g = L.heightAt(q.x, q.z); if (q.g < lo.g) lo = q; if (q.g > hi.g) hi = q; }
    if (hi.g - lo.g < 20) continue;
    const a = V(lo.x, lo.g + 1.5, lo.z), b = V(hi.x, hi.g + 1.5, hi.z), dir = b.clone().sub(a), len = dir.length(); dir.normalize();
    const right = V(-dir.z, 0, dir.x).normalize();
    S.color('#3d3a36'); for (const s of [-1.7, 1.7]) for (const e of [-.55, .55]) S.beam(a.clone().addScaledVector(right, s + e), b.clone().addScaledVector(right, s + e), .16, .2);
    for (let s = 0; s < len; s += 5) {
      const q = a.clone().addScaledVector(dir, s), g = L.heightAt(q.x, q.z);
      S.color('#5e554b'); S.beam(q.clone().addScaledVector(right, -2.6).setY(q.y - .25), q.clone().addScaledVector(right, 2.6).setY(q.y - .25), .3, .3);
      if (q.y - g > 1) for (const sd of [-2.2, 2.2]) S.beam(q.clone().addScaledVector(right, sd).setY(g - .5), q.clone().addScaledVector(right, sd).setY(q.y - .3), .28, .28);
    }
    const yaw = Math.atan2(dir.x, dir.z);
    S.color('#8a5a3c'); S.box(a.x - dir.x * 7, a.y - 1.5, a.z - dir.z * 7, 9, 6, 10, yaw); S.color('#6b3d26'); S.pyramid(a.x - dir.x * 7, a.y + 4.5, a.z - dir.z * 7, 10, 2.5, 11, yaw);
    S.color('#8a5a3c'); S.box(b.x + dir.x * 6, b.y - 1.5, b.z + dir.z * 6, 10, 7, 11, yaw); S.color('#6b3d26'); S.pyramid(b.x + dir.x * 6, b.y + 5.5, b.z + dir.z * 6, 11, 2.5, 12, yaw);
    for (const side of [-1.7, 1.7]) {
      const car = new THREE.Mesh(host.own(new THREE.BoxGeometry(3, 3, 6)), host.own(new THREE.MeshLambertMaterial({ color: /Mon/.test(inc.name) ? '#c9b02e' : '#a2372b' })));
      host.group.add(car); cars.push({ car, a: a.clone().addScaledVector(right, side), dir, len, phase: side > 0 ? 0 : .5, pitch: Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)), yaw });
    }
    made++;
  }

  // Grandview's overlooks: concrete half-moon decks cantilevered over the bluff, railings, a lamp
  for (const ov of data.overlooks || []) {
    const q = local(ov.p[0], ov.p[1]), g = L.heightAt(q.x, q.z);
    // out toward the drop: the lowest ground 20 m round
    let best = null; for (let k = 0; k < 16; k++) { const a = k / 16 * TAU, x = q.x + Math.cos(a) * 20, z = q.z + Math.sin(a) * 20, h = L.heightAt(x, z); if (!best || h < best.h) best = { h, a }; }
    if (!best || g - best.h < 6) continue;
    const ux = Math.cos(best.a), uz = Math.sin(best.a), F = makeFrame(q, { x: ux, z: uz });
    S.color('#b9b3a6'); for (let k = 0; k < 10; k++) { const a0 = -Math.PI / 2 + k / 10 * Math.PI, a1 = -Math.PI / 2 + (k + 1) / 10 * Math.PI;
      const p0 = F.at(Math.cos(a0) * 6, Math.sin(a0) * 6), p1 = F.at(Math.cos(a1) * 6, Math.sin(a1) * 6);
      S.triangle(V(q.x, g + .05, q.z), V(p1.x, g + .05, p1.z), V(p0.x, g + .05, p0.z)); S.color('#3e4245'); S.beam(V(p0.x, g + 1.1, p0.z), V(p1.x, g + 1.1, p1.z), .08, .08); S.color('#b9b3a6'); }
    S.color('#8d877b'); S.beam(V(F.at(3, 0).x, g - .3, F.at(3, 0).z), V(F.at(1, 0).x, g - 5, F.at(1, 0).z), .4, .4);
    S.color('#2f3336'); S.cylinder(q.x, g, q.z, .08, 4, 6); glows.push({ x: q.x, y: g + 4.2, z: q.z, size: 3, color: '#ffe2b0' });
    made++;
  }

  // the subway's street entrances: glass-and-steel headhouses over the stairs
  for (const st of data.stations || []) {
    for (const e of st.entrances) {
      const q = local(e[0], e[1]), g = L.heightAt(q.x, q.z);
      S.color('#5b6770'); S.box(q.x, g, q.z, 4, .3, 7); for (const [a, b] of [[-1.8, -3.3], [1.8, -3.3], [-1.8, 3.3], [1.8, 3.3]]) S.box(q.x + a, g, q.z + b, .2, 3.2, .2);
      S.color('#a9c3cf'); S.box(q.x, g + 3.2, q.z, 4.4, .25, 7.6);
      N.color('#2a5ea8').set({ aGlow: [.4, .7, 1] }); N.box(q.x, g + 3.45, q.z + 3.4, 3.2, .7, .15);
    }
    made++;
  }

  let park = null;
  if (data.park) { try { park = nycPark({ S, N, glows, local, L, host }, data.park); made += park.count; } catch (err) { console.warn(`park: ${err.message}`); } }
  // into the scene, as the heroes are
  const add = (B, mat, name) => { if (!B.count) return; const m = new THREE.Mesh(host.own(B.geometry()), mat); m.name = name; host.group.add(m); };
  add(W, host.buildingMaterial, 'PGH landmark towers');
  add(S, host.solidMaterial, 'PGH landmarks');
  if (Wa.count) add(Wa, host.waterMaterial || host.solidMaterial, 'Landmark water');
  if (Ca.count) add(Ca, host.own(canalWaterMaterial(host.waterTime || { value: 0 })), 'Canal water');
  if (N.count) { const nm = host.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5 })); nm.onBeforeCompile = (shader) => { shader.uniforms.uNight = host.night; shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aGlow; varying vec3 vGlow;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvGlow = aGlow;'); shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uNight * 2.;'); }; nm.customProgramCacheKey = () => 'pgh-landmark-neon'; add(N, nm, 'PGH landmark lights'); }
  host.addGlows(glows, 'PGH landmark lamps');
  host.addGlows(beacons.map((b) => ({ ...b, size: 6, color: '#ff3b2e' })), 'PGH tower beacons');
  return {
    count: made, qc: L.qc || null,
    tick(time) {
      park?.tick(time);
      for (const c of cars) {
        const t = (Math.sin((time / 90 + c.phase) * TAU) + 1) / 2;   // up and down, a trip every 45 s
        const p = c.a.clone().addScaledVector(c.dir, t * c.len);
        c.car.position.set(p.x, p.y + 1.6, p.z); c.car.rotation.set(0, c.yaw, 0); c.car.rotateX(-c.pitch);
      }
    },
  };
}
