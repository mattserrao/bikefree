// [7.7] Landmark heroes outside downtown, hand-made in the downtown towers' style (city/heroes.js) and placed at
// their real spots (the OSM outlines: centre, size and axis in the scene's `heroes` entries):
//   Oakland's icons: the Cathedral of Learning (from the map's own stepped tower parts, ribbed in stone, with
//   its pinnacled crown), Heinz Memorial Chapel, the Carnegie Institute (museum, Music Hall, library, the
//   Scaife wing) with Dippy on the Forbes Avenue lawn, and Soldiers & Sailors Memorial Hall;
//   the churches on the routes (one parametric church: nave, transepts, apse, towers with spires, onion
//   domes, cupolas or pinnacles, a crossing dome, lancets and a rose window lit at night);
//   the Homestead steel heritage: the Pump House, the Waterfront's row of smokestacks and Carrie Furnaces 6 & 7.
// Each replaces the map footprints under it, and a plan that would reach a street, the route or water is
// shifted and shrunk until it is clear (`out.heroFits` records the fit).
import * as THREE from '../../../../vendor/three.module.min.js';
import { ROAD_WIDTH } from '../../pose.js';
import { V, TAU, centroid, orient, scaleRing, lerp2, inPoly, prism, cap, block, makeFrame, lathe, disc, gable } from './hero-geom.js';

/** Unit {x, z} for a compass bearing (local x east, z south). */
const dirOf = (deg) => { const r = deg * Math.PI / 180; return { x: Math.sin(r), z: -Math.cos(r) }; };
const dot = (a, b) => a.x * b.x + a.z * b.z;

// ---------------------------------------------------------------- the churches' looks
// (heights in metres over the lowest ground of the plan; colours: walls, roof, the towers' tops)
const CHURCH = {
  // Heinz Memorial Chapel: French Gothic in Indiana limestone, steep slate roofs, tall transept windows, the
  // front tower's spire at ~77 m
  heinz: { wall: '#cbbd9e', roof: '#4d5359', top: '#4d5359', eaves: 15, ridge: 28, towers: 'front', towerS: 8.5, towerM: 46, crown: 'spire', crownM: 31, transept: { at: -.08, len: 1.3, w: .55 }, lancets: true, buttress: true },
  // East Liberty Presbyterian, the "Cathedral of Hope": Gothic, cruciform, the 91 m crossing tower with pinnacles
  elpc: { wall: '#bcab8a', roof: '#4b5157', top: '#4b5157', eaves: 17, ridge: 31, towers: 'crossing', towerS: 15, towerM: 66, crown: 'pinnacles', crownM: 25, transept: { at: -.05, len: 1, w: .32 }, apse: true, lancets: true, buttress: true, rose: true },
  // Immaculate Heart of Mary, Polish Hill: yellow brick, twin towers with green onion domes, a green crossing dome
  ihm: { wall: '#c9a978', roof: '#7e6650', top: '#5f9a80', eaves: 14, ridge: 20, towers: 'twin', towerS: 7.5, towerM: 31, crown: 'onion', crownM: 13, transept: { at: -.15, len: 1, w: .28 }, dome: { r: 7.5, drum: 25 }, apse: true, rose: true },
  // Saint Anthony's Chapel, Troy Hill: a small Romanesque chapel with twin towers
  anthony: { wall: '#a07c62', roof: '#5a4b42', top: '#4e4a46', eaves: 10, ridge: 16, towers: 'twin', towerS: 4.6, towerM: 20, crown: 'spire', crownM: 8, apse: true, rose: true },
  // Most Holy Name of Jesus, Troy Hill: brick, one tall front tower and spire
  holyname: { wall: '#8e5c47', roof: '#4d4744', top: '#55504c', eaves: 12, ridge: 19, towers: 'front', towerS: 7, towerM: 36, crown: 'spire', crownM: 22, apse: true, lancets: true },
  // Saint Stanislaus Kostka, the Strip: red brick, twin towers with copper cupolas, a rose window
  stanislaus: { wall: '#9e6249', roof: '#5b4a40', top: '#4f8270', eaves: 14, ridge: 21, towers: 'twin', towerS: 6.4, towerM: 30, crown: 'cupola', crownM: 11, apse: true, rose: true },
  // Saint Mary of the Mount, Grandview Avenue: brick, a front tower and spire over the bluff
  smm: { wall: '#9b6a52', roof: '#4f4a46', top: '#6f8e7e', eaves: 13, ridge: 20, towers: 'front', towerS: 7.5, towerM: 33, crown: 'spire', crownM: 21, transept: { at: -.2, len: 1.15, w: .3 }, apse: true, lancets: true },
};

export function landmarkModels(ctx) {
  const { city, L, W, S, N, glows, beacons, out, claim, clearUnder, ground, wall } = ctx;
  const fits = (out.heroFits ||= []);
  // the ground each hero stands on, kept clear of the city's trees and other planting (`out.covers`)
  const zones = (out.zones ||= []);
  const zoneRect = (F, hl = F.hl, hw = F.hw) => zones.push({ F, hl, hw, r: Math.hypot(hl, hw) });
  const zoneCircle = (q, r) => zones.push({ c: q, r });
  const P = (q, y) => V(q.x, y, q.z);

  // ---------------------------------------------------------------- placing a plan
  /** The hero's frame from its scene entry: centre, the long axis (axisDeg), the front end (frontDeg, else toward the route). */
  function frameFor(p, o) {
    const u = dirOf(o.axisDeg || 0);
    let F = makeFrame(p, u, undefined, (o.lengthM || 30) / 2, (o.widthM || 20) / 2);
    let front = o.frontDeg != null ? dirOf(o.frontDeg) : null;
    if (!front) {
      const r = city.index.nearest(p.x, p.z, 3000);
      front = r ? { x: city.index.xs[r.i] - p.x, z: city.index.zs[r.i] - p.z } : u;
    }
    if (dot(F.u, front) < 0) F = F.flipped();
    return F;
  }
  /** Clear of the route's road and verge, the streets and their sidewalks, and water. */
  const clearAt = (x, z, pad) => {
    const r = L.routeDist(x, z);
    if (r && r.d < ROAD_WIDTH / 2 + pad) return false;
    if (L.onStreet(x, z, Math.max(0, pad - 2.6))) return false;
    return L.waterAt(x, z) < .2;
  };
  const rectClear = (F, hl, hw, pad) => {
    const n = Math.max(2, Math.ceil(2 * hl / 2.5)), m = Math.max(2, Math.ceil(2 * hw / 2.5));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      if (i && j && i < n && j < m && (i % 3 || j % 3)) continue;   // the outline every 2.5 m, the inside every 7.5 m
      const q = F.at(-hl + 2 * hl * i / n, -hw + 2 * hw * j / m);
      if (!clearAt(q.x, q.z, pad)) return false;
    }
    return true;
  };
  /**
   * Fit a plan clear of the route, streets and water: shifted up to `maxShift` m and shrunk to `minScale` if it
   * has to be (the largest clear plan nearest its real spot wins). Returns the fitted frame (hl, hw scaled).
   */
  function fit(F, name, { pad = 1.5, maxShift = 10, minScale = .7 } = {}) {
    const shifts = [];
    for (let a = -maxShift; a <= maxShift; a += 2) for (let b = -maxShift; b <= maxShift; b += 2) shifts.push([a, b]);
    shifts.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
    for (let s = 1; s >= minScale - 1e-6; s -= .05) {
      for (const [a, b] of shifts) {
        const G = makeFrame(F.at(a, b), F.u, F.v, F.hl * s, F.hw * s);
        if (rectClear(G, G.hl, G.hw, pad)) { fits.push({ name, scale: +s.toFixed(2), shift: [a, b], ok: true }); return G; }
      }
    }
    fits.push({ name, scale: 1, shift: [0, 0], ok: false });
    return F;
  }
  /** Hide the map footprints under a plan (and any whose centroid is within `r` of the anchor). */
  const take = (F, p, r = 8) => { claim(p, r); clearUnder(F.rect(-F.hl * 1.04, F.hl * 1.04, -F.hw * 1.04, F.hw * 1.04)); };

  // ---------------------------------------------------------------- parts
  const crossOn = (B, x, y, z, h = 2.4, yaw = 0) => { B.box(x, y, z, .28, h, .28, yaw); B.box(x, y + h * .62, z, .28, .26, h * .55, yaw); };
  /** A pointed lancet (or round-headed) window on a wall facing `n` ({x, z}), lit at night (N). */
  function lancet(q, n, y, w, h, { pointed = true, glow = [1, .72, .38] } = {}) {
    const yaw = Math.atan2(n.x, n.z) + Math.PI / 2;   // (box length along the wall)
    const x = q.x + n.x * .12, z = q.z + n.z * .12;
    N.color('#2a2d36').set({ aGlow: glow });
    N.box(x, y, z, .2, h, w, yaw);
    if (pointed) N.pyramid(x, y + h, z, .2, w * .7, w, yaw);
  }
  /** A square tower at frame point (a, b), side s, from y0 to yT, crowned by `crown`. */
  function tower(F, a, b, s, y0, yT, look) {
    const c = F.at(a, b), sq = F.sub(a, b).rect(-s / 2, s / 2, -s / 2, s / 2);
    S.color(look.wall); block(S, sq, y0 - 1, yT);
    // string courses and a cornice
    S.color(shade(look.wall, .86));
    for (const f of [.42, .72]) prism(S, scaleRing(sq, 1.035, c), y0 + (yT - y0) * f, y0 + (yT - y0) * f + .45);
    block(S, scaleRing(sq, 1.07, c), yT - .2, yT + .5);
    // the belfry: two tall openings on each face
    for (const [n, off] of [[F.u, s / 2], [{ x: -F.u.x, z: -F.u.z }, s / 2], [F.v, s / 2], [{ x: -F.v.x, z: -F.v.z }, s / 2]]) {
      const t = { x: -n.z, z: n.x };
      for (const k of [-1, 1]) {
        const q = { x: c.x + n.x * off + t.x * k * s * .2, z: c.z + n.z * off + t.z * k * s * .2 };
        S.color('#1d1b1a'); S.box(q.x + n.x * .1, yT - s * .95, q.z + n.z * .1, .2, s * .62, s * .22, Math.atan2(n.x, n.z) + Math.PI / 2);
      }
    }
    if (look.buttress) {   // corner buttresses, stepping in
      S.color(shade(look.wall, .95));
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = F.at(a + i * s / 2, b + j * s / 2);
        S.box(q.x, y0 - 1, q.z, 1.3, (yT - y0) * .55 + 1, 1.3, F.yawU); S.box(q.x, y0 + (yT - y0) * .55, q.z, .9, (yT - y0) * .45, .9, F.yawU);
      }
    }
    crown(F, c, s, yT + .5, look);
  }
  function crown(F, c, s, y, look) {
    const H = look.crownM;
    S.color(look.top);
    if (look.crown === 'spire') {
      lathe(S, c.x, y, c.z, [[s * .47, 0], [s * .4, H * .08], [0, H]], 8);
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = { x: c.x + (F.u.x * i + F.v.x * j) * s * .42, z: c.z + (F.u.z * i + F.v.z * j) * s * .42 }; S.color(look.wall); S.box(q.x, y, q.z, .9, 1.4, .9, F.yawU); S.color(look.top); S.pyramid(q.x, y + 1.4, q.z, .9, H * .16, .9, F.yawU); }
      S.color('#c9a64a'); crossOn(S, c.x, y + H, c.z, 2, F.yawU);
    } else if (look.crown === 'onion') {
      S.color(look.wall); S.cylinder(c.x, y, c.z, s * .36, 2.6, 12);
      S.color(look.top); lathe(S, c.x, y + 2.6, c.z, [[s * .38, 0], [s * .5, H * .2], [s * .46, H * .4], [s * .24, H * .6], [s * .07, H * .74], [s * .1, H * .8], [0, H * .84]], 12);
      S.color('#c9a64a'); S.cylinder(c.x, y + 2.6 + H * .84, c.z, .12, H * .1, 6); crossOn(S, c.x, y + 2.6 + H * .92, c.z, 1.8, F.yawU);
    } else if (look.crown === 'cupola') {
      S.color(look.wall); lathe(S, c.x, y, c.z, [[s * .4, 0], [s * .4, H * .38], [s * .45, H * .4], [s * .45, H * .44]], 8);
      S.color(look.top); lathe(S, c.x, y + H * .44, c.z, [[s * .42, 0], [s * .38, H * .2], [s * .24, H * .36], [0, H * .46]], 10);
      S.cylinder(c.x, y + H * .9, c.z, s * .1, H * .1, 6, 0);
      S.color('#c9a64a'); crossOn(S, c.x, y + H, c.z, 1.6, F.yawU);
    } else if (look.crown === 'pinnacles') {
      // a pierced parapet, four tall corner pinnacles and four small ones between, a short lead spire
      S.color(look.wall);
      const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: c.x + (F.u.x * i + F.v.x * j) * s / 2, z: c.z + (F.u.z * i + F.v.z * j) * s / 2 }));
      prism(S, ring, y, y + 2.2);
      ring.forEach((q, k) => {
        const m = lerp2(q, ring[(k + 1) % 4], .5);
        S.color(look.wall); S.box(q.x, y - 6, q.z, 1.8, 6 + H * .3, 1.8, F.yawU); S.color(look.top); S.pyramid(q.x, y + H * .3, q.z, 1.8, H * .38, 1.8, F.yawU);
        S.color(look.wall); S.box(m.x, y, m.z, 1, 3.5, 1, F.yawU); S.color(look.top); S.pyramid(m.x, y + 3.5, m.z, 1, 4.5, 1, F.yawU);
      });
      S.color(look.top); lathe(S, c.x, y, c.z, [[s * .3, 0], [0, H]], 8);
      S.color('#c9a64a'); crossOn(S, c.x, y + H, c.z, 2.2, F.yawU);
    }
  }
  /** A drum and dome at frame point (a, 0). */
  function dome(F, a, g, look) {
    const c = F.at(a, 0), r = look.dome.r, y = g + look.dome.drum;
    S.color(look.wall); S.cylinder(c.x, g + look.ridge - 2, c.z, r * 1.02, y - (g + look.ridge - 2), 12);
    S.color(shade(look.wall, .86)); S.cylinder(c.x, y, c.z, r * 1.1, .6, 12);
    S.color(look.top); lathe(S, c.x, y + .6, c.z, [[r, 0], [r * .96, r * .28], [r * .85, r * .53], [r * .66, r * .75], [r * .4, r * .92], [r * .16, r], [0, r * 1.02]], 12);
    S.color(look.wall); S.cylinder(c.x, y + .6 + r, c.z, r * .16, 2.4, 8);
    S.color(look.top); S.cylinder(c.x, y + 3 + r, c.z, r * .2, 1.4, 8, 0);
    S.color('#c9a64a'); crossOn(S, c.x, y + 4.4 + r, c.z, 1.8, F.yawU);
  }
  /** A walled, gabled range along frame F from a0 to a1, `hw` either side. */
  function range(F, a0, a1, hw, g, eaves, ridge, look) {
    S.color(look.wall); prism(S, F.rect(a0, a1, -hw, hw), g - 1, eaves);
    S.color(look.roof); gable(S, F, a0, a1, hw, eaves, ridge, { over: .5, endColor: look.wall });
  }

  // ---------------------------------------------------------------- a church
  function church(p, o) {
    const look = { ...CHURCH[o.look || 'holyname'], ...(o.style || {}) };
    let F = fit(frameFor(p, o), o.name || o.look);
    take(F, p); zoneRect(F);
    const { hl, hw } = F, g = ground(F.rect(-hl, hl, -hw, hw)), yE = g + look.eaves, yR = g + look.ridge;
    const ts = Math.min(look.towerS, hw * .9);
    // the nave between the front (towers) and the apse
    const front = look.towers === 'front' ? hl - ts * .85 : hl, back = look.apse ? -hl + hw * .62 : -hl;
    const nhw = look.transept ? hw * (look.transept.w ? Math.min(1, look.transept.w * 2 + .2) : .62) : hw;
    const navHW = look.towers === 'twin' ? Math.min(nhw, hw - ts * .55) : nhw;
    range(F, back, front, navHW, g, yE, yR, look);
    // side aisles: lower lean-to ranges where the nave is narrower than the plan
    if (hw - navHW > 2.5 && look.towers !== 'twin') {
      for (const s of [-1, 1]) {
        S.color(look.wall); prism(S, F.rect(back + 1, front - 1, s > 0 ? navHW : -hw, s > 0 ? hw : -navHW), g - 1, g + look.eaves * .55);
        S.color(look.roof); cap(S, F.rect(back + 1, front - 1, s > 0 ? navHW : -hw, s > 0 ? hw : -navHW), g + look.eaves * .55);
      }
    }
    // transepts across the full width
    let aT = back + (front - back) * .3;
    if (look.transept) {
      aT = (back + front) / 2 + look.transept.at * (front - back);
      const tw = Math.max(4, (front - back) * look.transept.w * .5), Ft = F.sub(aT, 0, true);
      range(Ft, -hw * look.transept.len, hw * look.transept.len, tw, g, yE, yR - .6, look);
      if (look.lancets) for (const s of [-1, 1]) {
        const n = { x: F.v.x * s, z: F.v.z * s }, q = F.at(aT, s * hw * look.transept.len);
        lancet(q, n, g + 3, Math.min(tw * 1.1, 6), look.eaves * .78);
        if (look.rose || look.ridge > 24) disc(N.color('#2a2d36').set({ aGlow: [1, .62, .32] }), V(q.x + n.x * .15, yE + (yR - yE) * .3, q.z + n.z * .15), n, tw * .4, 12);
      }
    }
    // the apse
    if (look.apse) {
      const c = F.at(back, 0), r = navHW * .98;
      S.color(look.wall); S.cylinder(c.x, g - 1, c.z, r, yE - g + 1, 8);
      S.color(look.roof); lathe(S, c.x, yE, c.z, [[r + .4, 0], [0, (yR - yE) * .85]], 8);
    }
    // windows down the sides and buttresses between them
    const bays = Math.max(3, Math.round((front - back) / 5.5));
    for (let k = 0; k < bays; k++) {
      const a = back + (front - back) * (k + .5) / bays;
      if (look.transept && Math.abs(a - aT) < (front - back) * look.transept.w * .5 + 1) continue;
      for (const s of [-1, 1]) {
        const side = hw - navHW > 2.5 && look.towers !== 'twin' ? hw : navHW, n = { x: F.v.x * s, z: F.v.z * s };
        lancet(F.at(a, s * side), n, g + 2.6, 1.6, (side === hw ? look.eaves * .55 : look.eaves) - 4.5, { pointed: !!look.lancets });
        if (look.buttress) { const q = F.at(a + (front - back) / bays / 2, s * (side + .5)); S.color(shade(look.wall, .94)); S.box(q.x, g - 1, q.z, 1.2, (side === hw ? look.eaves * .55 : look.eaves) + 1, 1, F.yawU); }
      }
    }
    // the front: towers, the portal, a rose window
    const fn = F.u, fq = F.at(front, 0);
    if (look.towers === 'twin') for (const s of [-1, 1]) tower(F, hl - ts / 2, s * (hw - ts / 2), ts, g, g + look.towerM, look);
    else if (look.towers === 'front') tower(F, hl - ts / 2, 0, ts, g, g + look.towerM, look);
    else if (look.towers === 'crossing') tower(F, aT, 0, Math.min(ts, navHW * 2 * .95), g, g + look.towerM, look);
    if (look.dome) dome(F, aT, g, look);
    const portal = look.towers === 'front' ? F.at(hl, 0) : fq;
    S.color('#3a2b22'); S.box(portal.x + fn.x * .12, g, portal.z + fn.z * .12, Math.min(3.6, navHW), 4.6, .25, F.yawU);
    S.color(shade(look.wall, .82)); S.box(portal.x + fn.x * .3, g, portal.z + fn.z * .3, Math.min(5, navHW * 1.3), 5.6, .3, F.yawU);
    if (look.rose && look.towers !== 'front') disc(N.color('#2a2d36').set({ aGlow: [1, .62, .32] }), V(fq.x + fn.x * .15, yE - 1, fq.z + fn.z * .15), fn, Math.min(navHW * .45, 3.6), 14);
    else if (look.towers !== 'front') lancet(fq, fn, g + 6.5, 2.4, look.eaves - 8);
    // a cross on the ridge at the front
    S.color('#c9a64a'); if (look.towers === 'crossing' || look.towers === 'twin') crossOn(S, fq.x, yR - .3, fq.z, 2.2, F.yawU);
    glows.push({ x: portal.x + fn.x * 2.5, y: g + 5.5, z: portal.z + fn.z * 2.5, size: 5, color: '#ffd9a0' });
  }

  // ---------------------------------------------------------------- the Cathedral of Learning
  /**
   * 42 storeys, 163 m: the map's own stepped parts (the 15 m base, the 54/89/116/140 m setbacks and the 163 m
   * core) drawn in pale stone with continuous Gothic ribs up every face, pinnacles where each stops, and the
   * crown. Falls back to a stepped tower of its own if the parts aren't in the area's data.
   */
  function cathedral(p, o) {
    const F = frameFor(p, o), outline = F.rect(-F.hl * 1.05, F.hl * 1.05, -F.hw * 1.05, F.hw * 1.05);
    let parts = city.buildings.filter((b) => !b.hidden && inPoly(outline, ...Object.values(centroid(b.ring))));
    if (!parts.some((b) => b.h > 100)) {
      const c = F.at(o.coreA ?? 9, o.coreB ?? 9);
      const sq = (s, h) => ({ ring: makeFrame(c, F.u, F.v).rect(-s / 2, s / 2, -s / 2, s / 2), h });
      parts = [{ ring: F.rect(-F.hl, F.hl, -F.hw, F.hw), h: 15.5 }, sq(46, 54), sq(34, 89), sq(27, 116), sq(17.4, 163)];
    }
    for (const b of parts) b.hero = true;
    zoneRect(F);
    clearUnder(scaleRing(outline, .98));
    const g = ground(outline.map((q) => lerp2(q, F.c, .3)));
    const stone = o.color || '#c4b79c';
    parts.sort((a, b) => a.h - b.h);
    const top = parts[parts.length - 1];
    for (const b of parts) {
      const ring = orient(b.ring), c = centroid(ring), H = g + b.h;
      if (b.h < 40) {   // the base: Gothic halls in courses of windows
        wall(11, .41, g, 0, shade(stone, .96)); prism(W, ring, g - 1.5, H);
        wall(11, .41, g, 1, '#8d8a82'); cap(W, ring, H);
        S.color(shade(stone, .9)); prism(S, scaleRing(ring, 1.012, c), H - .9, H + .4);
        continue;
      }
      wall(4, .37 + b.h * .001, g, 0, stone); prism(W, ring, g - 1, H);
      wall(4, .37, g, 1, '#9b968c'); cap(W, ring, H);
      // ribs: slim piers proud of every face, a little pinnacle where each stops
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q.x - a.x, q.z - a.z);
        if (len < 2.5) continue;
        let nx = (q.z - a.z) / len, nz = -(q.x - a.x) / len;
        const m = lerp2(a, q, .5); if ((m.x - c.x) * nx + (m.z - c.z) * nz < 0) { nx = -nx; nz = -nz; }
        const n = Math.max(1, Math.round(len / 3.1)), yaw = Math.atan2(q.x - a.x, q.z - a.z);
        for (let j = 0; j <= n; j++) {
          const r = lerp2(a, q, j / n), corner = j === 0 || j === n, w = corner ? 1.3 : .62;
          S.color(shade(stone, corner ? 1.03 : 1.06)); S.box(r.x + nx * .3, g + (corner ? 0 : 12), r.z + nz * .3, w, b.h + (corner ? 1.4 : -11.2), w, yaw);
          if (j < n || corner) { S.color(shade(stone, .97)); S.pyramid(r.x + nx * .3, H + (corner ? 1.4 : .2), r.z + nz * .3, w, corner ? 4.5 : 1.8, w, yaw); }
        }
      }
      S.color(shade(stone, .9)); prism(S, scaleRing(ring, 1.015, c), H - 1.2, H + .3);
      if (b === top) {   // the crown: a lantern stage and tall corner pinnacles
        const r2 = scaleRing(ring, .7, c);
        S.color(stone); block(S, r2, H, H + 5.5);
        S.color('#2e2c2a'); for (let i = 0; i < r2.length; i++) { const m = lerp2(r2[i], r2[(i + 1) % r2.length], .5); S.box(m.x, H + 1.2, m.z, 2, 3.2, 2); }
        S.color(shade(stone, 1.04)); for (const q of ring) { S.box(q.x, H, q.z, 1.6, 4.5, 1.6); S.pyramid(q.x, H + 4.5, q.z, 1.6, 6.5, 1.6); }
        beacons.push({ x: c.x, y: H + 7, z: c.z });
        glows.push({ x: c.x, y: H + 3, z: c.z, size: 10, color: '#ffe3b0' });
      }
    }
  }

  // ---------------------------------------------------------------- the Carnegie Institute and Dippy
  /**
   * The museum, Music Hall, library and art museum: the map's footprints of each part (a part's rect if none),
   * in grey sandstone with a heavy cornice and rusticated base; a colonnade along the Natural History museum's
   * Forbes front, the Music Hall's low copper dome and the Scaife wing in dark granite.
   */
  function carnegie(p, o) {
    for (const part of o.parts || []) {
      const q = ctx.local(part.lat, part.lon), F = frameFor(q, part), rect = F.rect(-F.hl, F.hl, -F.hw, F.hw);
      let rings = city.buildings.filter((b) => !b.hero && !b.hidden && inPoly(scaleRing(rect, 1.02), ...Object.values(centroid(b.ring))));
      for (const b of rings) b.hero = true;
      zoneRect(F, F.hl + 3, F.hw + 3);
      rings = rings.length ? rings.map((b) => b.ring) : [rect];
      const g = ground(rect.map((r) => lerp2(r, F.c, .2))), H = g + part.h;
      const col = part.kind === 'art' ? '#8b8a85' : '#b8ad98';
      for (const ring0 of rings) {
        const ring = orient(ring0), c = centroid(ring);
        // plain dressed stone (no office window grid): pilasters and tall round-headed windows on every face
        S.color(col); prism(S, ring, g - 1.5, H);
        S.color(part.kind === 'art' ? '#6f6e6a' : '#7b8a7f'); cap(S, ring, H);
        S.color(shade(col, .88)); prism(S, scaleRing(ring, 1.012, c), H - 1.3, H + .2);   // cornice
        if (part.kind !== 'art') { S.color(shade(col, .8)); prism(S, scaleRing(ring, 1.008, c), g - 1, g + 2.2); }   // rusticated base
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q.x - a.x, q.z - a.z);
          if (len < 7) continue;
          let n = { x: (q.z - a.z) / len, z: -(q.x - a.x) / len }; const m = lerp2(a, q, .5);
          if ((m.x - c.x) * n.x + (m.z - c.z) * n.z < 0) n = { x: -n.x, z: -n.z };
          const bays = Math.floor(len / 6.5), yaw = Math.atan2(q.x - a.x, q.z - a.z);
          for (let k = 0; k < bays; k++) {
            const w = lerp2(a, q, (k + .5) / bays), e = lerp2(a, q, k / bays);
            if (part.kind === 'art') { lancet(w, n, g + 3, 4.2, part.h - 7, { pointed: false, glow: [.8, .8, .75] }); continue; }
            lancet(w, n, g + 4, 2.2, part.h * .45, { pointed: false });
            if (k) { S.color(shade(col, 1.06)); S.box(e.x + n.x * .3, g + 2.2, e.z + n.z * .3, .6, part.h - 3.5, .9, yaw); }
          }
        }
      }
      if (part.colonnadeDeg != null) {   // a colonnade along the face toward colonnadeDeg (the Forbes Avenue front)
        const n = dirOf(part.colonnadeDeg), alongU = Math.abs(dot(F.v, n)) >= Math.abs(dot(F.u, n));
        const G = alongU ? F : F.sub(0, 0, true), side = dot(G.v, n) > 0 ? 1 : -1;
        const hl = alongU ? F.hl : F.hw, hw = alongU ? F.hw : F.hl, cols = Math.max(4, Math.floor(hl * 1.6 / 4.2));
        S.color('#c7bca7');
        for (let k = 0; k <= cols; k++) { const r = G.at(-hl * .8 + hl * 1.6 * k / cols, side * (hw + 1.4)); S.cylinder(r.x, g + 2.2, r.z, .55, part.h - 5.4, 8); }
        S.color(shade(col, .92)); block(S, G.rect(-hl * .82, hl * .82, side > 0 ? hw - .2 : -hw - 2.3, side > 0 ? hw + 2.3 : -hw + .2), H - 3.2, H - 1.2);
        S.color(shade(col, .85)); block(S, G.rect(-hl * .82, hl * .82, side > 0 ? hw - .2 : -hw - 2.3, side > 0 ? hw + 2.3 : -hw + .2), g - 1, g + 2.2);
      }
      if (part.kind === 'hall') { const c = F.c; S.color('#6f9584'); lathe(S, c.x, H, c.z, [[F.hw * .55, 0], [F.hw * .45, 3.5], [F.hw * .2, 6], [0, 6.6]], 12); }
    }
  }
  /** Dippy: the life-size bronze Diplodocus carnegii (26 m) on the lawn by Forbes Avenue, on a low stone plinth. */
  function dippy(p, o) {
    const u = dirOf(o.headingDeg ?? 250), v = { x: -u.z, z: u.x }, at = (a, b) => ({ x: p.x + u.x * a + v.x * b, z: p.z + u.z * a + v.z * b });
    const g = ground([at(-13, -2), at(13, -2), at(13, 2), at(-13, 2)]) + .9;
    zoneCircle(p, 16);
    S.color('#9b9486'); block(S, [at(-6, -2.6), at(7, -2.6), at(7, 2.6), at(-6, 2.6)], g - 1.5, g);
    S.color('#5e4b33');
    // the spine: tail tip → hips → shoulders → neck → head (along, height, beam width, beam height)
    const spine = [[-14, .9, .18, .18], [-11, 1.6, .35, .4], [-8, 2.6, .6, .7], [-5, 3.6, 1.1, 1.3], [-2, 4.1, 2, 2.4], [2, 3.9, 2.1, 2.4], [4.5, 3.9, 1.3, 1.5], [7, 4.7, .8, .9], [9.5, 5.8, .6, .65], [11.5, 6.6, .45, .5], [12.6, 6.7, .55, .45]];
    for (let k = 1; k < spine.length; k++) {
      const [a0, y0, w0, h0] = spine[k - 1], [a1, y1, w1, h1] = spine[k], A = at(a0, 0), B = at(a1, 0);
      S.beam(V(A.x, g + y0, A.z), V(B.x, g + y1, B.z), (w0 + w1) / 2, (h0 + h1) / 2);
    }
    for (const [a, s, lift] of [[-1.4, -1, .3], [-1.4, 1, -.2], [3, -1, -.3], [3, 1, .3]]) {   // legs, in a stride
      const top = at(a, s * .75), foot = at(a + lift * 2, s * .95);
      S.beam(V(top.x, g + 3.4, top.z), V(foot.x, g, foot.z), .55, .55);
    }
  }

  // ---------------------------------------------------------------- Soldiers & Sailors Memorial Hall
  /** Beaux-Arts after the Mausoleum at Halicarnassus: a podium, a colonnaded block, an attic and a stepped pyramid. */
  function memorial(p, o) {
    const F = fit(frameFor(p, o), o.name || 'memorial', { minScale: .85 });
    take(F, p, 20); zoneRect(F, F.hl + 5, F.hw);
    const { hl, hw } = F, g = ground(F.rect(-hl * .7, hl * .7, -hw * .7, hw * .7)), stone = '#d2c8b3';
    S.color(shade(stone, .86)); block(S, F.rect(-hl, hl, -hw, hw), g - 1.5, g + 3);
    wall(11, .71, g, 0, stone); prism(W, F.rect(-hl * .9, hl * .9, -hw * .9, hw * .9), g + 3, g + 21);
    wall(11, .71, g, 1, '#a39d92'); cap(W, F.rect(-hl * .9, hl * .9, -hw * .9, hw * .9), g + 21);
    // engaged columns round every face
    S.color(shade(stone, 1.05));
    for (const [n, half, len] of [[1, hl, hw], [-1, hl, hw]]) for (let k = -6; k <= 6; k++) { const q = F.at(n * (half * .9 + .7), k / 6 * len * .82); S.cylinder(q.x, g + 6, q.z, .55, 13, 8); }
    for (const [n, half, len] of [[1, hw, hl], [-1, hw, hl]]) for (let k = -7; k <= 7; k++) { const q = F.at(k / 7 * len * .82, n * (half * .9 + .7)); S.cylinder(q.x, g + 6, q.z, .55, 13, 8); }
    S.color(shade(stone, .92)); block(S, F.rect(-hl * .9 - 1.4, hl * .9 + 1.4, -hw * .9 - 1.4, hw * .9 + 1.4), g + 19, g + 21.5);
    S.color(stone); block(S, F.rect(-hl * .82, hl * .82, -hw * .82, hw * .82), g + 21.5, g + 25);
    for (let k = 0; k < 4; k++) { const f = .7 - k * .12; S.color(shade(stone, k % 2 ? .95 : 1)); block(S, F.rect(-hl * f, hl * f, -hw * f, hw * f), g + 25 + k * 2.2, g + 27.2 + k * 2.2); }
    S.color(shade(stone, .9)); block(S, F.rect(-hl * .22, hl * .22, -hw * .22, hw * .22), g + 33.8, g + 36);
    // the grand stair to the front
    for (let k = 0; k < 4; k++) { const a0 = hl + k * 1.1, q = F.at(a0 + .55, 0); S.color(shade(stone, .9 - k * .02)); S.box(q.x, g - 1, q.z, hw * 1.1 - k * 1.5, 3.8 - k * .9, 1.1, F.yawU); }
    const fq = F.at(hl * .9, 0);
    S.color('#3a3029'); S.box(fq.x + F.u.x * .12, g + 3, fq.z + F.u.z * .12, 4.5, 7, .25, F.yawU);
    for (const s of [-1, 1]) { const q = F.at(hl + 4, s * hw * .62); glows.push({ x: q.x, y: g + 5, z: q.z, size: 6, color: '#ffe0a8' }); }
  }

  // ---------------------------------------------------------------- Homestead
  /** The Homestead Works Pump House (1892): brick, a slate gable with a ridge monitor, tall round-headed windows. */
  function pumphouse(p, o) {
    const F = fit(frameFor(p, o), o.name || 'pumphouse', { pad: 1 });
    take(F, p); zoneRect(F);
    const { hl, hw } = F, g = ground(F.rect(-hl, hl, -hw, hw)), look = { wall: '#8b4a36', roof: '#4c4b4c' };
    S.color('#7d6d5d'); block(S, F.rect(-hl - .3, hl + .3, -hw - .3, hw + .3), g - 1, g + .8);
    range(F, -hl, hl, hw, g + .8, g + 7.5, g + 11.5, look);
    S.color('#4c4b4c'); gable(S, F, -hl * .7, hl * .7, 1.8, g + 11.2, g + 12.9, { over: .3, endColor: '#7a4231' });
    S.color('#7a4231'); prism(S, F.rect(-hl * .7, hl * .7, -1.6, 1.6), g + 10.6, g + 11.3);
    const bays = Math.max(3, Math.round(hl * 2 / 3.6));
    for (let k = 0; k < bays; k++) for (const s of [-1, 1]) lancet(F.at(-hl + hl * 2 * (k + .5) / bays, s * hw), { x: F.v.x * s, z: F.v.z * s }, g + 1.8, 1.4, 4.4, { pointed: false, glow: [.6, .5, .35] });
    for (const s of [-1, 1]) lancet(F.at(s * hl, 0), { x: F.u.x * s, z: F.u.z * s }, g + 1.6, 2.2, 5, { pointed: true, glow: [.6, .5, .35] });
  }
  /** The Waterfront's row of brick smokestacks, kept from the Homestead Works (OSM chimneys). */
  function stacks(p, o) {
    const H = o.heightM || 38;
    for (const [la, lo] of o.points || []) {
      const q = ctx.local(la, lo);
      if (!clearAt(q.x, q.z, .5)) { fits.push({ name: 'stack', ok: false, at: [la, lo] }); continue; }
      claim(q, 3); zoneCircle(q, 4);
      const g = ground([q, { x: q.x + 2, z: q.z }, { x: q.x, z: q.z + 2 }, { x: q.x - 2, z: q.z }, { x: q.x, z: q.z - 2 }]);
      S.color('#9b9284'); S.cylinder(q.x, g - 1, q.z, 2.6, 2.4, 8);
      S.color('#8a4936'); lathe(S, q.x, g + 1.4, q.z, [[2.05, 0], [1.75, H * .6], [1.5, H - 2.4]], 10);
      S.color('#5c3328'); lathe(S, q.x, g + 1.4 + H - 2.4, q.z, [[1.5, 0], [1.72, .6], [1.72, 1.8], [1.35, 1.8]], 10);
      S.color('#6e3a2c'); S.cylinder(q.x, g + 1.4 + H * .5, q.z, 1.86, .7, 10);
    }
  }
  /**
   * Carrie Blast Furnaces 6 & 7 (1907), across the Monongahela: two furnace shells with their bustle pipes, the
   * tall gas uptakes and downcomers to a dust catcher, the hot-blast stoves (the map's tanks) and the cast house,
   * in rust and soot — a silhouette from the Homestead side.
   */
  function carrie(p, o) {
    const rust = '#6b4a3a', soot = '#3b3532';
    for (const st of o.stoves || []) {
      const q = ctx.local(st[0], st[1]), r = st[2] || 3.4, g = ground([q]);
      claim(q, 4); zoneCircle(q, r + 1.5);
      S.color(soot); S.cylinder(q.x, g - 1, q.z, r, 28, 10);
      lathe(S, q.x, g + 27, q.z, [[r, 0], [r * .8, r * .55], [r * .4, r * .85], [0, r * .95]], 10);
    }
    for (const f of o.furnaces || []) {
      const q = ctx.local(f[0], f[1]), g = ground([q]), u = dirOf(o.axisDeg ?? 0);
      claim(q, 8); zoneCircle(q, 10);
      S.color('#5a5049'); S.cylinder(q.x, g - 1, q.z, 7.5, 9, 10);                                   // the hearth and cast-house floor
      S.color(rust); lathe(S, q.x, g + 8, q.z, [[5.2, 0], [6.4, 5], [6.4, 7], [5, 22], [3.4, 24], [3.4, 27]], 12);   // the shell
      S.color(soot); S.cylinder(q.x, g + 13, q.z, 7.3, 1.4, 12);                                       // the bustle pipe
      // the top: platform, four uptakes rising into two bleeders, the downcomer to the dust catcher
      S.color('#4a403a'); S.cylinder(q.x, g + 35, q.z, 4.5, 1, 8);
      for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + .4, x = q.x + Math.cos(a) * 2.6, z = q.z + Math.sin(a) * 2.6; S.beam(V(x, g + 34, z), V(q.x + Math.cos(a) * 1.4, g + 47, q.z + Math.sin(a) * 1.4), 1.1, 1.1); }
      S.color(soot); S.cylinder(q.x, g + 47, q.z, 1.2, 6, 6);
      const d = { x: q.x - u.x * 20, z: q.z - u.z * 20 }, gd = ground([d]);
      S.color(rust); S.beam(V(q.x, g + 44, q.z), V(d.x, gd + 26, d.z), 1.5, 1.5);
      S.cylinder(d.x, gd - 1, d.z, 4, 21, 10); lathe(S, d.x, gd + 20, d.z, [[4, 0], [1.2, 6]], 10);
      // the skip incline up to the top
      const sk = { x: q.x + u.x * 34, z: q.z + u.z * 34 }, gs = ground([sk]);
      S.color(soot); S.beam(V(sk.x, gs, sk.z), V(q.x + u.x * 3, g + 35, q.z + u.z * 3), 2.6, 1.2);
      // the cast house beside it
      const ch = { x: q.x - u.z * 18, z: q.z + u.x * 18 };
      S.color('#5b4d44'); S.box(ch.x, ground([ch]) - 1, ch.z, 16, 15, 34, Math.atan2(u.x, u.z) + Math.PI / 2);
      S.color(soot); S.pyramid(ch.x, ground([ch]) + 14, ch.z, 16.5, 5, 34.5, Math.atan2(u.x, u.z) + Math.PI / 2);
    }
  }

  return { church, cathedral, carnegie, dippy, memorial, pumphouse, stacks, carrie };
}

/** A colour lightened (f > 1) or darkened. */
function shade(hex, f) { return '#' + new THREE.Color(hex).multiplyScalar(f).getHexString(); }
