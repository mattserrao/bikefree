// SKAN's landmarks (user, 22 Nov: "rework Skaneateles and Marcellus villages by adding landmarks and more real-world
// copies … Skaneateles has sidewalks, a long pier etc. … examples of the mansions, golf course and other landmarks"),
// each on its OSM outline or line (tools/skan_heroes.py → routes/cities/skan-heroes.json), built with the other
// landmark models (js/world/toolbox/city/pgh-landmarks.js):
//
//   pier        Clift Park's long pier into Skaneateles Lake: a plank deck on piles, a railing each side, lamp posts
//               and benches along it
//   gazebo      Clift Park's white gazebo on the lawn by the water: eight posts on a raised floor, a railing, a bell roof
//   sherwood    the Sherwood Inn (1807): three storeys of blue clapboard, white trim, a two-storey porch along the front
//               facing the lake, dormers, chimneys
//   mansion     lakefront mansions, examples by the kinds the lakeshore has: 'queenanne' (a round corner tower, a
//               wraparound porch, painted in three colours), 'shingle' (brown shingles on a ground floor of boulders, a
//               big gambrel, a porte-cochère), 'classical' (white, a two-storey portico of columns under a pediment,
//               a hip roof with a balustrade), 'secondempire' (a mansard with dormers, a square tower, a bracketed cornice)
//   clubhouse   the Skaneateles Country Club: a long white clubhouse, its porches and deck toward the lake
//   dock        the club's docks: plank decks on piles over the water, boats tied up
//   golfpins    a flag on every green (its hole's end)
//   mill        the old Crown Mill at Marcellus Falls: four storeys of stone, rows of windows, a belfry, a stack
import { V, centroid, orient, prism, cap, block, frameOf, makeFrame, lathe, gable, faceOut } from './hero-geom.js';

export function skanLandmarkModels({ S, N, glows, plan: plan0, ground, local, L, Wa = null }) {
  // a pile's wake: a ring of pale foam where it stands in the water (the lake moving past it)
  const wake = (x, z, r) => { const p = L.poolAt?.(x, z); if (p == null || !(L.heightAt(x, z) < p)) return; S.color('#c3d0cc'); S.cylinder(x, p + .38, z, r + .1, .012, 10); S.color('#90a8a5'); S.cylinder(x, p + .365, z, r + .28, .01, 10); };
  // (a lakefront footprint past the drawn shore: the floor stays a metre above the lake, its foundation down into it)
  //  and one standing in the water gets its stone sea wall and a lawn terrace round it
  const plan = (l, a, b) => {
    const r = plan0(l, a, b), p = L.poolAt?.(r.F.c.x, r.F.c.z);
    if (p == null) return r;
    r.g = Math.max(r.g, p + .9);
    const { F } = r, wet = [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].filter(([u, v]) => { const q = F.at(u * F.hl, v * F.hw); return L.waterAt?.(q.x, q.z); }).length;
    if (wet) {
      const m = 4;
      S.color('#8a8478'); block(S, F.rect(-F.hl - m, F.hl + m, -F.hw - m, F.hw + m), p - 2, r.g - .05);
      S.color('#5d7a3c'); cap(S, F.rect(-F.hl - m + .3, F.hl + m - .3, -F.hw - m + .3, F.hw + m - .3), r.g + .02);
      S.color('#9a9488'); prism(S, F.rect(-F.hl - m - .1, F.hl + m + .1, -F.hw - m - .1, F.hw + m + .1), r.g - .35, r.g - .05);   // (the coping)
    }
    return r;
  };
  const TRIM = '#f3f1ea';
  /** A window on the wall of frame F at (a, b) facing ±v (or the ±u end): white casing, dark glass, its night light. */
  const win = (F, a, b, y, w, h, onEnd = false, s = 1, frame = TRIM) => {
    const q = F.at(a, b), n = onEnd ? { x: F.u.x * s, z: F.u.z * s } : { x: F.v.x * s, z: F.v.z * s }, yaw = onEnd ? F.yawV : F.yawU;
    S.color(frame); S.box(q.x + n.x * .04, y - .1, q.z + n.z * .04, .1, h + .2, w + .2, yaw);
    S.color('#2b3138'); S.box(q.x + n.x * .1, y, q.z + n.z * .1, .08, h, w, yaw);
    N.color('#2b3138').set({ aGlow: [1, .8, .5] }); N.box(q.x + n.x * .14, y + .05, q.z + n.z * .14, .02, h - .1, w - .1, yaw);
  };
  /** Rows of windows along the ±v walls (and the ends) of a block hl × hw, storeys from y0 every fh. */
  const windows = (F, hl, hw, y0, floors, fh, { per = 3.2, w = 1, h = 1.6, ends = true, frame = TRIM, skip = null } = {}) => {
    for (let k = 0; k < floors; k++) {
      const y = y0 + k * fh + .9;
      const n = Math.max(1, Math.round(2 * hl / per));
      for (const s of [-1, 1]) for (let i = 0; i < n; i++) { const a = -hl + (i + .5) * 2 * hl / n; if (skip && skip(a, s, k)) continue; win(F, a, s * hw, y, w, h, false, s, frame); }
      if (ends) { const m = Math.max(1, Math.round(2 * hw / per)); for (const s of [-1, 1]) for (let i = 0; i < m; i++) win(F, s * hl, -hw + (i + .5) * 2 * hw / m, y, w, h, true, s, frame); }
    }
  };
  /** Clapboard: thin shadow lines up a block's walls. */
  const clap = (F, a0, a1, b0, b1, y0, y1, col) => { S.color(col); for (let y = y0 + .3; y < y1 - .1; y += .42) prism(S, F.rect(a0 - .02, a1 + .02, b0 - .02, b1 + .02), y, y + .045); };
  /** A porch along the +v side (s: ±1) of frame F from a0 to a1: deck, posts (or columns), roof, railing. */
  const porch = (F, a0, a1, b, s, g, { depth = 2.6, h = 2.8, posts = 6, deckCol = '#9a9284', roofCol = '#4d5257', col = TRIM, columns = false, rail = true, roofY = null } = {}) => {
    const b1 = b + s * depth;
    S.color(deckCol); block(S, F.rect(a0, a1, Math.min(b, b1), Math.max(b, b1)), g - .6, g + .55);
    S.color(col);
    for (let k = 0; k <= posts; k++) {
      const q = F.at(a0 + .2 + k * (a1 - a0 - .4) / posts, b1 - s * .25);
      if (columns) S.cylinder(q.x, g + .55, q.z, .2, h, 10, .17); else S.box(q.x, g + .55, q.z, .2, h, .2, F.yawU);
    }
    const P = (a, bb, y) => { const q = F.at(a, bb); return V(q.x, y, q.z); };
    const yTop = roofY ?? g + .55 + h;
    S.color(roofCol); faceOut(S, [P(a0 - .2, b, yTop + .5), P(a1 + .2, b, yTop + .5), P(a1 + .2, b1 + s * .3, yTop), P(a0 - .2, b1 + s * .3, yTop)], V(F.v.x * s, 1, F.v.z * s));
    S.color(col); { const q = F.at((a0 + a1) / 2, b1 - s * .25); S.box(q.x, yTop - .3, q.z, .25, .3, a1 - a0, F.yawU); }
    if (rail) for (let k = 0; k < posts; k++) {
      const aa = a0 + .2 + k * (a1 - a0 - .4) / posts, ab = a0 + .2 + (k + 1) * (a1 - a0 - .4) / posts;
      if (k === Math.floor(posts / 2)) continue;   // (the steps' bay)
      const q = F.at((aa + ab) / 2, b1 - s * .25); S.box(q.x, g + 1.4, q.z, .08, .08, ab - aa, F.yawU);
      for (let a = aa + .2; a < ab - .1; a += .3) { const p = F.at(a, b1 - s * .25); S.box(p.x, g + .55, p.z, .05, .85, .05, F.yawU); }
    }
  };
  /** A hip roof over hl × hw at eaves yE, rising `rise`, the eaves `over` past the walls. */
  const hip = (F, hl, hw, yE, rise, over = .5) => {
    const P = (a, b, y) => { const q = F.at(a, b); return V(q.x, y, q.z); };
    const r = Math.max(0, hl - hw), A = hl + over, B = hw + over, top = yE + rise;
    faceOut(S, [P(-A, -B, yE), P(A, -B, yE), P(r, 0, top), P(-r, 0, top)], V(-F.v.x, 1, -F.v.z));
    faceOut(S, [P(A, B, yE), P(-A, B, yE), P(-r, 0, top), P(r, 0, top)], V(F.v.x, 1, F.v.z));
    faceOut(S, [P(-A, B, yE), P(-A, -B, yE), P(-r, 0, top)], V(-F.u.x, 1, -F.u.z));
    faceOut(S, [P(A, -B, yE), P(A, B, yE), P(r, 0, top)], V(F.u.x, 1, F.u.z));
  };
  /** A mansard: the steep lower slope from the cornice at yC up `h1` (inset `inset`), then a low hip. */
  const mansard = (F, hl, hw, yC, h1, inset, col1, col2) => {
    const P = (a, b, y) => { const q = F.at(a, b); return V(q.x, y, q.z); };
    S.color(col1);
    const A = hl + .25, B = hw + .25, a = hl - inset, b = hw - inset, y2 = yC + h1;
    faceOut(S, [P(-A, -B, yC), P(A, -B, yC), P(a, -b, y2), P(-a, -b, y2)], V(-F.v.x, .4, -F.v.z));
    faceOut(S, [P(A, B, yC), P(-A, B, yC), P(-a, b, y2), P(a, b, y2)], V(F.v.x, .4, F.v.z));
    faceOut(S, [P(-A, B, yC), P(-A, -B, yC), P(-a, -b, y2), P(-a, b, y2)], V(-F.u.x, .4, -F.u.z));
    faceOut(S, [P(A, -B, yC), P(A, B, yC), P(a, b, y2), P(a, -b, y2)], V(F.u.x, .4, F.u.z));
    S.color(col2); hip(makeFrame(F.c, F.u, F.v), a, b, y2, Math.min(a, b) * .35, .05);
  };
  const chimney = (q, y0, y1, col = '#8a4b3b') => { S.color(col); S.box(q.x, y0, q.z, .9, y1 - y0, .7); S.color('#5f5a54'); S.box(q.x, y1, q.z, 1.05, .15, .85); };

  const hsh = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // ---- shared bits for the lake front: boats, dormers, lawn chairs, a private dock
  /** A boat on the water at q (yaw along its length): 'sail' (a moored sloop, mast and furled sail), 'run' (a runabout),
   *  'tour' (the two-deck tour boat, white with a dark band), 'canoe'. Its waterline at the lake's level. */
  const boat = (q, yaw, kind, seed = 0) => {
    const p = L.poolAt?.(q.x, q.z); if (p == null) return;
    const y = p + .35, c = Math.cos(yaw), sn = Math.sin(yaw), at = (a, b) => ({ x: q.x + sn * a + c * b, z: q.z + c * a - sn * b });
    if (kind === 'tour') {
      S.color('#f2f0ea'); S.box(q.x, y - .6, q.z, 5.2, 1.7, 22, yaw);
      S.color('#2f3e4c'); S.box(q.x, y + .75, q.z, 5.25, .35, 22.05, yaw);
      S.color('#f2f0ea'); S.box(q.x, y + 1.1, q.z, 4.6, 2.2, 17, yaw);
      S.color('#2c3238'); for (const sd of [-1, 1]) { const w2 = at(0, sd * 2.31); S.box(w2.x, y + 1.6, w2.z, .05, 1, 15, yaw); }
      S.color('#e9e5da'); S.box(q.x, y + 3.3, q.z, 4.8, .15, 18, yaw);   // (the upper deck)
      S.color('#f2f0ea'); { const b2 = at(-4, 0); S.box(b2.x, y + 3.45, b2.z, 3, 1.8, 4, yaw); }   // (the wheelhouse)
      S.color('#9a2f28'); { const f = at(9, 0); S.cylinder(f.x, y + 3.45, f.z, .05, 3, 5); S.box(f.x, y + 5.7, f.z, .03, .6, 1, yaw); }
      return;
    }
    if (kind === 'canoe') { S.color(['#b8402f', '#2f6b4f', '#d8b04a'][Math.floor(seed * 3)]); S.box(q.x, y - .25, q.z, .85, .4, 5, yaw); return; }
    const hull = ['#f2f0ea', '#24384f', '#f2f0ea', '#8a2f28'][Math.floor(seed * 4)];
    // the hull: a body with freeboard and a narrowing bow, a boot stripe at the waterline
    const L0 = kind === 'sail' ? 7 : 4.8, B0 = kind === 'sail' ? 2.6 : 2.2;
    S.color(hull); { const m = at(-.6, 0); S.box(m.x, y - .4, m.z, B0, 1.2, L0, yaw); }
    { const b = at(L0 / 2 - .6 + .8, 0); S.box(b.x, y - .3, b.z, B0 * .62, 1.1, 1.6, yaw); const b2 = at(L0 / 2 - .6 + 1.9, 0); S.box(b2.x, y - .1, b2.z, B0 * .25, .9, .8, yaw); }   // (the bow, narrowing)
    S.color('#2b2f33'); { const m = at(-.6, 0); S.box(m.x, y - .02, m.z, B0 + .02, .1, L0 + .02, yaw); }
    S.color('#e8e3d6'); { const m = at(-.9, 0); S.box(m.x, y + .8, m.z, kind === 'sail' ? 1.8 : 1.5, .45, kind === 'sail' ? 3 : 2, yaw); }   // (the cabin)
    if (kind === 'sail') {
      S.color('#d9d6cf'); S.cylinder(q.x, y + .8, q.z, .07, 11, 6, .04);
      S.color('#2b4a6b'); { const m = at(-1.5, 0); S.box(m.x, y + 2, m.z, .3, .3, 3.2, yaw); }   // (the furled main on its boom, in its blue cover)
    }
  };
  /** A shed dormer on a hip/gable slope of frame F: centre a along u, the wall at b (±hw), base y, w wide. */
  const dormer = (F, a, b, sd, yB, w, wallCol, roofCol) => {
    const q = F.at(a, b - sd * 1.6), yaw = F.yawU;
    S.color(wallCol); S.box(q.x, yB, q.z, 2.2, 1.6, w, yaw);
    S.color(roofCol); S.box(q.x, yB + 1.6, q.z, 2.6, .18, w + .4, yaw);
    win(F, a, b - sd * .48, yB + .3, Math.min(1, w - .6), 1, false, sd, '#ffffff');
  };
  /** An Adirondack chair at q facing yaw (toward the water), in one of the lake-house colours. */
  const adirondack = (q, yaw, seed) => {
    const y = ground([q]), c = Math.cos(yaw), sn = Math.sin(yaw), at = (a, b) => ({ x: q.x + sn * a + c * b, z: q.z + c * a - sn * b });
    S.color(['#f1efe8', '#2f5d8a', '#c2412f', '#3f6b45', '#e0b236'][Math.floor(seed * 5)]);
    S.box(q.x, y + .32, q.z, .7, .06, .8, yaw);
    { const b = at(-.45, 0); S.box(b.x, y + .35, b.z, .68, .9, .08, yaw); }
    for (const sd of [-1, 1]) { const a = at(0, sd * .38); S.box(a.x, y + .55, a.z, .12, .05, .85, yaw); S.box(a.x, y, a.z, .06, .55, .7, yaw); }
  };
  /** The nearest lake edge to c within r (a step out past it into the water, and the direction out), or null. */
  const shoreFrom = (c, r = 90) => {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 4; d < r; d += 2) { if (L.waterAt?.(c.x + dx * d, c.z + dz * d)) { if (!best || d < best.d) best = { d, x: c.x + dx * d, z: c.z + dz * d, dx, dz }; break; } }
    }
    return best;
  };
  /** A private dock from the shore at s straight out along (dx, dz), with a boat tied up; a boathouse on some. */
  const privateDock = (sh, seed) => {
    const p = L.poolAt?.(sh.x, sh.z); if (p == null) return;
    const len = 12 + seed * 10, y = p + .9, yaw = Math.atan2(sh.dx, sh.dz), m = { x: sh.x + sh.dx * (len / 2 - 1), z: sh.z + sh.dz * (len / 2 - 1) };
    S.color('#9d8a6e'); S.box(m.x, y - .25, m.z, 1.8, .25, len, yaw);
    S.color('#5d5346'); for (let a = -len / 2 + 1; a < len / 2; a += 3) for (const sd of [-1, 1]) { const q = { x: m.x + sh.dx * a + sh.dz * sd * .8, z: m.z + sh.dz * a - sh.dx * sd * .8 }; S.cylinder(q.x, y - 3.5, q.z, .12, 3.5, 6); wake(q.x, q.z, .12); }
    const end = { x: sh.x + sh.dx * (len - 3) + sh.dz * 2.2, z: sh.z + sh.dz * (len - 3) - sh.dx * 2.2 };
    boat(end, yaw, seed < .5 ? 'run' : 'sail', seed * 3 % 1);
    if (L.lifeSpots && seed > .35) { const q = { x: sh.x + sh.dx * (len - 1.4), z: sh.z + sh.dz * (len - 1.4) }; L.lifeSpots.push({ x: q.x, z: q.z, y, yaw, kind: 'fish' }); }
    if (seed > .6) {
      // a boathouse at the root: a little gable-roofed shed half over the water, the boat door to the lake
      const b = { x: sh.x + sh.dx * 1.5 - sh.dz * 5, z: sh.z + sh.dz * 1.5 + sh.dx * 5 };
      S.color(['#7a2f28', '#e9e4d6', '#3f5e47'][Math.floor(seed * 7) % 3]); S.box(b.x, p - .2, b.z, 4.5, 3.4, 7, yaw);
      S.color('#41464b'); S.box(b.x, p + 3.2, b.z, 5.1, .5, 7.6, yaw); S.box(b.x, p + 3.7, b.z, 2.6, .55, 7.6, yaw);
      S.color('#2a2c2e'); { const d2 = { x: b.x + sh.dx * 3.52, z: b.z + sh.dz * 3.52 }; S.box(d2.x, p + .3, d2.z, 3, 2, .06, yaw); }
    }
  };

  return {
    // ---------------------------------------------------------------- Clift Park
    pier(l) {
      const P = l.path.map(([a, o]) => local(a, o)), w = (l.widthM || 3.6) / 2;
      // the deck at the shore's level (and never under a metre above the lake), level out to its end
      const pool = L.poolAt ? L.poolAt(P[0].x, P[0].z) : -Infinity, y = Math.max(ground([P[0]]) + .4, pool + 1.4);
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), u = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
        const F = makeFrame({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, u, { x: -u.z, z: u.x }, len / 2, w);
        S.color('#a08c70'); block(S, F.rect(-len / 2, len / 2, -w, w), y - .3, y);
        // planks: thin dark seams across the deck
        S.color('#7f6c55'); for (let s = -len / 2 + .3; s < len / 2; s += .9) { const q = F.at(s, 0); S.box(q.x, y + .005, q.z, .04, .01, 2 * w - .1, F.yawV); }
        // piles every 3 m, both sides, down into the lake
        for (let s = -len / 2 + 1; s < len / 2; s += 3) for (const sd of [-1, 1]) { const q = F.at(s, sd * (w - .15)); S.color('#5d5346'); S.cylinder(q.x, y - 4.5, q.z, .16, 4.4, 6); wake(q.x, q.z, .16); }
        // the railings: posts, a top rail and a mid rail, white
        S.color(TRIM);
        for (const sd of [-1, 1]) {
          for (let s = -len / 2; s <= len / 2; s += 2.4) { const q = F.at(s, sd * (w - .08)); S.box(q.x, y, q.z, .1, 1.05, .1, F.yawU); }
          const q = F.at(0, sd * (w - .08)); S.box(q.x, y + 1, q.z, .09, .08, len, F.yawU); S.box(q.x, y + .55, q.z, .05, .06, len, F.yawU);
        }
        // lamp posts every ~15 m, alternating sides; benches between, facing out over the water
        for (let s = -len / 2 + 7, k = 0; s < len / 2; s += 15, k++) {
          const sd = k % 2 ? 1 : -1, q = F.at(s, sd * (w - .35));
          S.color('#222a24'); S.cylinder(q.x, y, q.z, .07, 3.4, 6); S.color('#f3efe0'); S.cylinder(q.x, y + 3.4, q.z, .22, .45, 8, .12);
          glows.push({ x: q.x, y: y + 3.6, z: q.z, size: 2.4, color: '#ffe2b0' });
          const bq = F.at(s + 7, -sd * (w - .6));
          S.color('#6b5137'); S.box(bq.x, y + .42, bq.z, .45, .06, 1.6, F.yawU); S.box(bq.x - F.v.x * sd * .2, y + .48, bq.z - F.v.z * sd * .2, .06, .45, 1.6, F.yawU);
        }
      }
      // people fishing off the pier's outer two thirds, at the rail, facing out over the water (graph-life's locals)
      if (L.lifeSpots) { const A = P[0], B = P[P.length - 1], len = Math.hypot(B.x - A.x, B.z - A.z), u = { x: (B.x - A.x) / len, z: (B.z - A.z) / len };
        for (let k = 0, s2 = len * .35; s2 < len - 2; s2 += 9 + hsh(k) * 8, k++) { const sd = k % 2 ? 1 : -1, n = { x: -u.z * sd, z: u.x * sd };
          if (hsh(k * 3.7) < .7) L.lifeSpots.push({ x: A.x + u.x * s2 + n.x * (w - .55), z: A.z + u.z * s2 + n.z * (w - .55), y, yaw: Math.atan2(n.x, n.z), kind: 'fish' }); }
        { const n = u; L.lifeSpots.push({ x: B.x - u.x * .8, z: B.z - u.z * .8, y, yaw: Math.atan2(n.x, n.z), kind: 'fish' }); } }
      // the boats: the tour boat tied up along the pier's outer half, and sloops moored off Clift Park either side
      { const A = P[0], B = P[P.length - 1], len = Math.hypot(B.x - A.x, B.z - A.z), u = { x: (B.x - A.x) / len, z: (B.z - A.z) / len }, n = { x: -u.z, z: u.x };
        const yaw = Math.atan2(u.x, u.z), t = { x: A.x + u.x * len * .7 + n.x * (w + 3.3), z: A.z + u.z * len * .7 + n.z * (w + 3.3) };
        if (L.waterAt?.(t.x, t.z)) boat(t, yaw, 'tour');
        for (let k = 0; k < 9; k++) {
          const along = len * (.25 + .7 * hsh(k * 3.1 + 1)), side = (k % 2 ? 1 : -1) * (25 + 110 * hsh(k * 5.7 + 2));
          const q = { x: A.x + u.x * along + n.x * side, z: A.z + u.z * along + n.z * side };
          if (L.waterAt?.(q.x, q.z) && L.waterAt?.(q.x + 6, q.z) && L.waterAt?.(q.x - 6, q.z)) boat(q, hsh(k * 9.3) * 6.28, k % 3 === 2 ? 'run' : 'sail', hsh(k * 2.2));
        }
      }
    },
    gazebo(l) {
      const c = local(l.center[0], l.center[1]), g = ground([c]), R = 3.6, n = 8;
      S.color('#d9d4c8'); lathe(S, c.x, g - .5, c.z, [[R + .4, 0], [R + .4, 1.1], [0, 1.1]], n);   // (the raised floor)
      S.color(TRIM);
      for (let k = 0; k < n; k++) {
        const a = (k + .5) / n * Math.PI * 2, x = c.x + Math.cos(a) * R, z = c.z + Math.sin(a) * R;
        S.cylinder(x, g + .6, z, .13, 2.8, 8, .11);
        if (k !== 0) {   // railing between the posts (the steps on one side)
          const a2 = (k + 1.5) / n * Math.PI * 2, x2 = c.x + Math.cos(a2) * R, z2 = c.z + Math.sin(a2) * R;
          S.beam(V(x, g + 1.5, z), V(x2, g + 1.5, z2), .08, .08);
          for (let t = .15; t < .9; t += .14) S.box(x + (x2 - x) * t, g + .6, z + (z2 - z) * t, .05, .9, .05);
        }
        // a little bracket at each post's top
        S.box(x, g + 3.2, z, .3, .2, .3, a);
      }
      S.color(TRIM); lathe(S, c.x, g + 3.4, c.z, [[R + .5, 0], [R + .5, .35]], n);   // (the frieze)
      S.color('#5b6066'); lathe(S, c.x, g + 3.75, c.z, [[R + .7, 0], [R * .7, 1.3], [R * .35, 2.2], [.5, 2.7], [0, 2.75]], n);   // (the bell roof)
      S.color(TRIM); lathe(S, c.x, g + 6.45, c.z, [[.45, 0], [.45, .6], [0, 1.5]], n);   // (the finial)
      for (const k of [0, 4]) { const a = (k + .5) / n * Math.PI * 2; glows.push({ x: c.x + Math.cos(a) * R, y: g + 3, z: c.z + Math.sin(a) * R, size: 1.8, color: '#ffe0a8' }); }
    },
    // ---------------------------------------------------------------- the Sherwood Inn
    sherwood(l) {
      let { F, g } = plan(l, 18, 9);
      if (l.face) { const d = local(l.face[0], l.face[1]); if ((d.x - F.c.x) * F.v.x + (d.z - F.c.z) * F.v.z < 0) F = F.flipped(); }   // (the porch toward the lake)
      const hl = F.hl * .95, hw = F.hw * .9, fh = 3.3, yE = g + .8 + fh * 3, yR = yE + hw * .75;
      const BLUE = '#6b8aa6', SHADOW = '#5a7690';
      S.color('#8d8577'); block(S, F.rect(-hl, hl, -hw, hw), g - 1.5, g + .8);
      S.color(BLUE); prism(S, F.rect(-hl, hl, -hw, hw), g + .8, yE);
      clap(F, -hl, hl, -hw, hw, g + .8, yE, SHADOW);
      S.color(TRIM); prism(S, F.rect(-hl - .05, hl + .05, -hw - .05, hw + .05), yE - .6, yE);   // (the frieze board)
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = F.at(a * hl, b * hw); S.box(q.x, g + .8, q.z, .3, yE - g - .8, .3, F.yawU); }   // (corner boards)
      windows(F, hl, hw, g + .8, 3, fh, { per: 2.6, w: .95, h: 1.7 });
      S.color('#3c4147'); gable(S, F, -hl - .4, hl + .4, hw, yE, yR, { over: .6, endColor: BLUE });
      // dormers along the front slope
      for (let a = -hl + 3; a < hl - 2; a += 4.4) {
        const q = F.at(a, hw * .45), y = yE + hw * .55 * .75 - .4;
        S.color(BLUE); S.box(q.x, y, q.z, 1.6, 1.6, 1.8, F.yawU);
        S.color('#3c4147'); S.pyramid(q.x, y + 1.6, q.z, 1.9, .8, 2.1, F.yawU);
        win(F, a, hw * .45 + .9, y + .3, .8, 1, false, 1);
      }
      chimney(F.at(-hl * .55, 0), yR - 2, yR + 1.4); chimney(F.at(hl * .55, 0), yR - 2, yR + 1.4);
      // the porch: two storeys along the lake front, columns, a balustrade on the upper deck
      porch(F, -hl + 1, hl - 1, hw, 1, g + .3, { depth: 3, h: fh - .2, posts: 8, columns: true, roofCol: TRIM, roofY: g + .85 + fh });
      porch(F, -hl + 1, hl - 1, hw, 1, g + .3 + fh, { depth: 3, h: fh - .4, posts: 8, columns: true, deckCol: '#d8d3c8', roofCol: '#3c4147' });
      // the sign
      { const q = F.at(0, hw + 3.6); S.color('#2f4a64'); S.box(q.x, g + 3.9, q.z, .1, .8, 3.4, F.yawU); }
      glows.push({ x: F.at(0, hw + 2).x, y: g + 2.8, z: F.at(0, hw + 2).z, size: 6, color: '#ffd9a0' });
    },
    // ---------------------------------------------------------------- lakefront mansions (examples)
    mansion(l) {
      const { F, g } = plan(l, 12, 8), hl = F.hl * .9, hw = F.hw * .88, kind = l.kind || 'queenanne';
      const h = (k) => { const x = Math.sin((l.center[0] * 9301 + l.center[1] * 4973 + k) * 12.9898) * 43758.5453; return x - Math.floor(x); };
      if (kind === 'queenanne') {
        // a Queen Anne: two and a half storeys, steep roofs, a round tower on a front corner, a wraparound porch
        const PAINT = [['#7f8f6a', '#e8dcc0', '#7a2f2a', '#6c7a5a'], ['#c9b48a', '#f2ecdc', '#3d5a4a', '#b09c74'], ['#8c5a4a', '#ece2c8', '#2f4a5e', '#774b3e']][Math.floor(h(1) * 3)];
        const fh = 3.3, yE = g + .9 + fh * 2;
        S.color('#7d7468'); block(S, F.rect(-hl, hl, -hw, hw), g - 1.2, g + .9);
        S.color(PAINT[0]); prism(S, F.rect(-hl, hl, -hw, hw), g + .9, yE);
        clap(F, -hl, hl, -hw, hw, g + .9, g + .9 + fh, PAINT[3]);
        S.color(PAINT[1]); prism(S, F.rect(-hl - .03, hl + .03, -hw - .03, hw + .03), g + .9 + fh - .1, g + .9 + fh + .15);   // (the belt course)
        windows(F, hl, hw, g + .9, 2, fh, { per: 3, w: .9, h: 1.8, frame: PAINT[1] });
        S.color('#4a4448'); hip(F, hl, hw, yE, hw * 1.25, .6);
        // a front-facing gable over half the front
        S.color(PAINT[0]); { const P = (a, b, y) => { const q = F.at(a, b); return V(q.x, y, q.z); }; faceOut(S, [P(-hl * .1, hw + .3, yE), P(hl * .8, hw + .3, yE), P(hl * .35, hw + .3, yE + 3.6)], V(F.v.x, 0, F.v.z)); }
        // the tower: round, a storey taller, a conical roof
        const t = F.at(-hl, hw), R = 2.3;
        S.color(PAINT[0]); S.cylinder(t.x, g - .2, t.z, R, yE - g + 3.2, 12);
        S.color(PAINT[1]); S.cylinder(t.x, yE + 2.8, t.z, R + .15, .4, 12);
        S.color('#4a4448'); lathe(S, t.x, yE + 3.2, t.z, [[R + .35, 0], [R * .5, 3.2], [0, 5.6]], 12);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + .4; for (const y of [g + 1.8, g + 1.8 + fh, yE + .9]) { S.color('#2b3138'); S.box(t.x + Math.cos(a) * R, y, t.z + Math.sin(a) * R, .9, 1.5, .9, -a); } }
        porch(F, -hl + 1, hl, hw, 1, g + .35, { depth: 2.6, h: 2.6, posts: 6, col: PAINT[1], roofCol: '#4a4448' });
        porch(F.sub(0, 0, true), -hw, hw * .3, -hl, -1, g + .35, { depth: 2.4, h: 2.6, posts: 4, col: PAINT[1], roofCol: '#4a4448' });   // (round the side)
        chimney(F.at(hl * .4, -hw * .3), yE, yE + hw * 1.25 + 1);
      } else if (kind === 'shingle') {
        // Shingle style: a ground floor of rough boulders, brown shingle above, a big gambrel roof, a porte-cochère
        const fh = 3.4, yE = g + 1 + fh * 2;
        S.color('#7b7468'); block(S, F.rect(-hl, hl, -hw, hw), g - 1.2, g + 1 + fh);
        for (let k = 0; k < 40; k++) { const s = (h(k) - .5) * 2 * hl, sd = h(k + 50) < .5 ? -1 : 1, q = F.at(s, sd * (hw + .1)), r = .35 + h(k + 90) * .3; S.color(['#8a8478', '#6f6a60', '#9a9384'][k % 3]); S.box(q.x, g + h(k + 7) * fh * .8, q.z, r * 2, r * 1.6, .3, F.yawU + h(k)); }
        S.color('#7a5a40'); prism(S, F.rect(-hl, hl, -hw, hw), g + 1 + fh, yE);
        windows(F, hl, hw, g + 1, 2, fh, { per: 2.8, w: 1.1, h: 1.6, frame: '#f0e8d8' });
        // the gambrel: steep lower slopes, then a low ridge
        const P = (a, b, y) => { const q = F.at(a, b); return V(q.x, y, q.z); }, yK = yE + 2.6, yR = yK + 1.8;
        S.color('#5a5148');
        for (const s of [-1, 1]) {
          faceOut(S, [P(-hl - .5, s * (hw + .6), yE - .2), P(hl + .5, s * (hw + .6), yE - .2), P(hl + .5, s * hw * .55, yK), P(-hl - .5, s * hw * .55, yK)], V(F.v.x * s, .5, F.v.z * s));
          faceOut(S, [P(-hl - .5, s * hw * .55, yK), P(hl + .5, s * hw * .55, yK), P(hl + .5, 0, yR), P(-hl - .5, 0, yR)], V(F.v.x * s, 1, F.v.z * s));
        }
        S.color('#7a5a40'); for (const a of [-hl, hl]) { const n = V(F.u.x * Math.sign(a), 0, F.u.z * Math.sign(a)); faceOut(S, [P(a, -hw, yE), P(a, hw, yE), P(a, hw * .55, yK), P(a, -hw * .55, yK)], n); faceOut(S, [P(a, -hw * .55, yK), P(a, hw * .55, yK), P(a, 0, yR)], n); }
        // the porte-cochère: boulder piers and a hipped roof off one end
        const E = F.sub(hl + 2.5, hw * .2, false);
        S.color('#7b7468'); for (const [a, b] of [[-1.8, -2.2], [1.8, -2.2], [-1.8, 2.2], [1.8, 2.2]]) { const q = E.at(a, b); S.box(q.x, g - .3, q.z, .9, 3.6, .9, F.yawU); }
        S.color('#5a5148'); hip(makeFrame(E.c, F.u, F.v), 2.3, 2.6, g + 3.3, 1.4, .3);
        porch(F, -hl + 1, hl * .4, hw, 1, g + .4, { depth: 2.8, h: 2.7, posts: 4, col: '#7b7468', roofCol: '#5a5148', rail: false });
        chimney(F.at(-hl * .5, 0), yE, yR + 1.2, '#7b7468');
      } else if (kind === 'classical') {
        // Classical Revival: white, two and a half storeys, a full-height portico of columns under a pediment
        const fh = 3.6, yE = g + 1 + fh * 2;
        S.color('#8d8577'); block(S, F.rect(-hl, hl, -hw, hw), g - 1.2, g + 1);
        S.color('#f1eee6'); prism(S, F.rect(-hl, hl, -hw, hw), g + 1, yE);
        clap(F, -hl, hl, -hw, hw, g + 1, yE, '#dedad0');
        windows(F, hl, hw, g + 1, 2, fh, { per: 3, w: 1, h: 2, frame: '#ffffff' });
        S.color('#e6e2d8'); prism(S, F.rect(-hl - .15, hl + .15, -hw - .15, hw + .15), yE - .7, yE);   // (the entablature)
        S.color('#4f5458'); hip(F, hl, hw, yE, hw * .6, .5);
        // the balustrade round the roof's flat top
        { const P = F.rect(-hl * .45, hl * .45, -hw * .3, hw * .3); S.color('#f1eee6'); prism(S, P, yE + hw * .6 - .2, yE + hw * .6 + .5); }
        // the portico
        const pw = Math.min(hl * .55, 5.5), P2 = (a, b, y) => { const q = F.at(a, b); return V(q.x, y, q.z); };
        S.color('#e9e5dc'); block(S, F.rect(-pw, pw, hw, hw + 3.2), g - .4, g + 1);
        for (let k = 0; k < 4; k++) { const q = F.at(-pw + .5 + k * (2 * pw - 1) / 3, hw + 2.8); S.color('#f6f3ec'); S.cylinder(q.x, g + 1, q.z, .35, yE - g - 1.4, 12, .3); }
        S.color('#f1eee6'); block(S, F.rect(-pw - .2, pw + .2, hw, hw + 3.4), yE - .8, yE);
        S.color('#f1eee6'); faceOut(S, [P2(-pw - .2, hw + 3.4, yE), P2(pw + .2, hw + 3.4, yE), P2(0, hw + 3.4, yE + 2.4)], V(F.v.x, 0, F.v.z));
        S.color('#4f5458'); for (const s of [-1, 1]) faceOut(S, [P2(s * (pw + .3), hw, yE), P2(s * (pw + .3), hw + 3.5, yE), P2(0, hw + 3.5, yE + 2.4), P2(0, hw, yE + 2.4)], V(F.u.x * s, 1, F.u.z * s));
        chimney(F.at(-hl * .7, 0), yE, yE + hw * .6 + 1.5); chimney(F.at(hl * .7, 0), yE, yE + hw * .6 + 1.5);
      } else {
        // Second Empire: a mansard with dormers, a square central tower, a bracketed cornice
        const fh = 3.6, yC = g + 1 + fh * 2, COL = h(3) < .5 ? '#d8cdb4' : '#bcb7aa';
        S.color('#8d8577'); block(S, F.rect(-hl, hl, -hw, hw), g - 1.2, g + 1);
        S.color(COL); prism(S, F.rect(-hl, hl, -hw, hw), g + 1, yC);
        windows(F, hl, hw, g + 1, 2, fh, { per: 2.8, w: .9, h: 2.1, frame: '#f4f0e6' });
        S.color('#f4f0e6'); prism(S, F.rect(-hl - .3, hl + .3, -hw - .3, hw + .3), yC - .5, yC);
        for (let a = -hl; a <= hl; a += 1.2) for (const s of [-1, 1]) { const q = F.at(a, s * (hw + .15)); S.box(q.x, yC - .9, q.z, .3, .4, .14, F.yawU); }   // (brackets)
        mansard(F, hl, hw, yC, 3.2, 1, '#4b4f55', '#5a5f66');
        for (let a = -hl + 2; a < hl - 1; a += 3.4) for (const s of [-1, 1]) { const q = F.at(a, s * (hw - .2)); S.color('#f4f0e6'); S.box(q.x, yC + .5, q.z, 1.3, 1.9, 1.3, F.yawU); S.color('#2b3138'); S.box(q.x + F.v.x * s * .66, yC + .75, q.z + F.v.z * s * .66, .05, 1.3, .9, F.yawU); }   // (dormers)
        // the tower in the middle of the front, a storey above the roof, its own mansard
        const T = makeFrame(F.at(0, hw - 1.2), F.u, F.v, 2, 2);
        S.color(COL); prism(S, T.rect(-2, 2, -2, 2), g + 1, yC + 4);
        for (let k = 0; k < 3; k++) win(T, 0, 2, g + 1.9 + k * fh, .9, 1.9, false, 1, '#f4f0e6');
        mansard(T, 2, 2, yC + 4, 2.6, .7, '#4b4f55', '#5a5f66');
        porch(F, -hl + 1, hl - 1, hw, 1, g + .4, { depth: 2.6, h: 3, posts: 6, columns: true, col: '#f4f0e6', roofCol: '#4b4f55' });
        chimney(F.at(-hl * .6, 0), yC, yC + 4.8); chimney(F.at(hl * .6, 0), yC, yC + 4.8);
      }
      // the grounds down to the lake: Adirondack chairs on the lawn facing the water, a private dock (a boathouse on some)
      const sh = shoreFrom(F.c, 110);
      if (sh) {
        const yaw = Math.atan2(sh.dx, sh.dz), d = Math.max(4, sh.d - 7);
        for (let k = 0; k < 2 + Math.floor(h(31) * 2); k++) {
          const q = { x: F.c.x + sh.dx * d + sh.dz * (k - 1) * 1.3, z: F.c.z + sh.dz * d - sh.dx * (k - 1) * 1.3 };
          if (!L.waterAt?.(q.x, q.z)) adirondack(q, yaw, h(40 + k));
        }
        privateDock(sh, h(33));
      }
    },
    // ---------------------------------------------------------------- the country club
    clubhouse(l) {
      const { F, g } = plan(l, 25, 12), hl = Math.min(F.hl * .92, 30), hw = Math.min(F.hw * .85, 11), fh = 3.5, yE = g + .8 + fh * 1.6, yR = yE + Math.min(hw * .55, 5);
      S.color('#8d8577'); block(S, F.rect(-hl, hl, -hw, hw), g - 1.5, g + .8);
      S.color('#f1eee6'); prism(S, F.rect(-hl, hl, -hw, hw), g + .8, yE);
      clap(F, -hl, hl, -hw, hw, g + .8, yE, '#dcd7cc');
      windows(F, hl, hw, g + .8, 1, fh, { per: 2.4, w: 1.6, h: 2.2, frame: '#ffffff' });
      windows(F, hl, hw, g + .8 + fh, 1, fh, { per: 3.6, w: 1, h: 1.2, frame: '#ffffff', ends: false });
      S.color('#41584b'); hip(F, hl, hw, yE, Math.min(hw * .55, 5), .8);
      // the lake front's centre pavilion: a two-storey cross gable, out past the porch
      { const wet = (sd) => { const q = F.at(0, sd * (hw + 12)); return L.waterAt?.(q.x, q.z) ? 1 : 0; }, sd = wet(1) >= wet(-1) ? 1 : -1;
        const out = { x: F.v.x * sd, z: F.v.z * sd }, P2 = makeFrame(F.at(0, sd * hw), out, { x: -out.z, z: out.x }), yT = yE + 1.2;
        S.color('#f1eee6'); prism(S, P2.rect(-3, 4.6, -5.5, 5.5), g + .8, yT);
        S.color('#41584b'); gable(S, P2, -3, 5.1, 5.5, yT, yT + 3.6, { over: .6, endColor: '#f1eee6' });
        for (let k = -1; k <= 1; k++) win(P2, 4.6, k * 2.6, g + 1.4, 1.5, 2.4, true, 1, '#ffffff');
        for (let k = -1; k <= 1; k++) win(P2, 4.6, k * 2.6, g + .8 + fh + .7, 1.1, 1.6, true, 1, '#ffffff'); }
      for (const s of [-1, 1]) porch(F, -hl + 1.5, hl - 1.5, s * hw, s, g + .3, { depth: 4, h: 3, posts: 10, roofCol: '#41584b' });
      // dormers along both slopes (the long roof broken up), and the lake-side terrace: flagstones, tables under umbrellas
      for (const sd of [-1, 1]) for (let a = -hl + 4; a <= hl - 4; a += 6.5) if (Math.abs(a) > 6) dormer(F, a, sd * hw, sd, yE + .4, 2.2, '#f1eee6', '#41584b');
      { const wet = (sd) => { const q = F.at(0, sd * (hw + 12)); return L.waterAt?.(q.x, q.z) ? 1 : 0; }, sd = wet(1) >= wet(-1) ? 1 : -1;
        const T = makeFrame(F.at(0, sd * (hw + 4 + 6)), F.u, F.v, hl * .7, 5);
        S.color('#a59d8e'); block(S, T.rect(-hl * .7, hl * .7, -5, 5), g - .3, g + .35);
        for (let a = -hl * .7 + 3; a < hl * .7 - 2; a += 5.5) for (const b of [-2.2, 2.2]) {
          const q = T.at(a, b), k = hsh(a * 3 + b);
          S.color('#f1efe8'); S.cylinder(q.x, g + .35, q.z, .55, .75, 8);   // (a round table)
          S.color('#d8d4cc'); S.cylinder(q.x, g + .35, q.z, .04, 2.4, 5);
          S.color(k < .5 ? '#2f5d4a' : '#f1efe8'); S.cylinder(q.x, g + 2.3, q.z, 1.5, .55, 8, .08);   // (the umbrella)
        }
      }
      chimney(F.at(-hl * .5, 0), yR - 2, yR + 1.5, '#7b7468'); chimney(F.at(hl * .5, 0), yR - 2, yR + 1.5, '#7b7468');
      // a flagpole
      { const q = F.at(hl + 6, hw + 4); S.color('#f3f1ea'); S.cylinder(q.x, g, q.z, .08, 11, 6, .05); S.color('#a33a32'); S.box(q.x + .9, g + 9.6, q.z, 1.8, 1.1, .03); }
    },
    dock(l) {
      const ring = orient(l.ring.map(([a, o]) => local(a, o))), c = centroid(ring), y = ground([c]) + .5;
      S.color('#9d8a6e'); block(S, ring, y - .25, y);
      for (let i = 0; i < ring.length; i++) { const p = ring[i]; S.color('#5d5346'); S.cylinder(p.x, y - 3.5, p.z, .14, 3.6, 6); wake(p.x, p.z, .14); }
      // a couple of boats along it: a runabout and a sailboat
      const F = frameOf(ring);
      for (const [a, sd, kind] of [[-F.hl * .4, 1, 'run'], [F.hl * .3, -1, 'sail']]) {
        const q = F.at(a, sd * (F.hw + 1.4)), yaw = F.yawU;
        S.color(kind === 'run' ? '#8a4b2d' : '#f2f0ea'); S.box(q.x, y - .9, q.z, 1.8, .75, kind === 'run' ? 5.5 : 7, yaw);
        S.color('#ece6d6'); S.box(q.x, y - .2, q.z, 1.4, .12, kind === 'run' ? 2 : 3, yaw);
        if (kind === 'sail') { S.color('#d8d4cc'); S.cylinder(q.x, y - .2, q.z, .06, 9, 6); }
      }
    },
    golfpins(l) {
      for (const [a, o] of l.pts || []) {
        const q = local(a, o), g = ground([q]);
        S.color('#f4f2ec'); S.cylinder(q.x, g, q.z, .03, 2.3, 5);
        S.color('#d23a2e'); S.box(q.x + .25, g + 1.9, q.z, .5, .35, .02);
        S.color('#e9e6dc'); S.cylinder(q.x, g + .01, q.z, .12, .03, 8);
      }
    },
    // ---------------------------------------------------------------- the Crown Mill at Marcellus Falls
    mill(l) {
      const { F, g } = plan(l, 30, 10), hl = F.hl * .95, hw = Math.min(F.hw * .92, 11), fh = 3.4, yE = g + fh * 4, yR = yE + Math.min(hw * .45, 4.5);   // (a mill's low-pitched roof over a narrow block)
      const STONE = '#8f8474';
      S.color(STONE); block(S, F.rect(-hl, hl, -hw, hw), g - 2, yE);
      // coursed rubble: lighter and darker courses
      S.color('#9c9282'); for (let y = g + .4; y < yE - .2; y += .9) prism(S, F.rect(-hl - .02, hl + .02, -hw - .02, hw + .02), y, y + .08);
      windows(F, hl, hw, g, 4, fh, { per: 2.6, w: 1.1, h: 1.8, frame: '#d8d0c0' });
      S.color('#4a4e52'); gable(S, F, -hl - .3, hl + .3, hw, yE, yR, { over: .4, endColor: STONE });
      // the belfry on the ridge, the boiler house's stack at one end
      { const q = F.at(-hl * .3, 0); S.color('#ece6da'); S.box(q.x, yR - .6, q.z, 2.4, 3.2, 2.4, F.yawU); S.color('#4a4e52'); S.pyramid(q.x, yR + 2.6, q.z, 3, 2.4, 3, F.yawU); }
      { const q = F.at(hl + 3, hw - 2); S.color('#8e5a47'); S.cylinder(q.x, g, q.z, 1.2, 24, 10, .8); }
    },
  };
}
