// The house engine, part 2: geometry. Turns a house plan (house-plan.js) into faces for the building kit's facade
// shader (facade-material.js), into three writers:
//   w  main (always drawn): foundations, walls in storey bands with their windows and doors placed exactly (the shader
//      paints sash, picture, tall and low windows, doors, shutters), gables with attic windows, roofs (the kit's own
//      slabs, fascia and soffits), dormers, chimneys, porches' decks, posts and roofs, porticos, stoops, garage doors,
//      the Greek Revival frieze and pediment, a cupola
//   d  the kit's near detail (to ~550 m): ridge caps (from the kit's roofs), steps
//   n  the house engine's close detail (to ~160 m): window casings, sills and heads (Greek entablatures, Italianate
//      hoods), corner boards and pilasters, eave brackets, porch rails and pickets, door surrounds, chimney caps,
//      gutters and downpipes
// Close detail is what a house shows as you ride past it; beyond ~160 m the main mesh alone reads the same.
import * as THREE from '../../../../../vendor/three.module.min.js';
import { S, W } from '../buildings/presets.js';
import { F } from '../buildings/facade-material.js';
import { kitRoof, srgb, toU8, frameIndex } from '../buildings/assemble.js';
import { at } from './house-plan.js';

const KIND_WS = { win: W.SASH, tall: W.TALL, pic: W.PICTURE, low: W.LOW, door: W.SASH };
// the painted window's half size and sill height by set (as the shader draws them)
const WIN_DIM = { [W.SASH]: [.45, .72, .8], [W.TALL]: [.4, 1, .62], [W.PICTURE]: [1.15, .72, .8], [W.LOW]: [.55, .3, 1.55], [W.FARM]: [.33, .42, 1] };
const WALL_CODE = { lap: S.LAP, brick: S.BRICK, shingle: S.WSHINGLE, concrete: S.CONCRETE, stone: S.RUBBLE };
const BRICKS = ['#8c4b3b', '#9a5643', '#7d4436', '#a0624c', '#86503f'];
const WHITE = '#f3f1ea';

/**
 * Build house plan P (on recipe R) into w (main), d (near detail), n (close detail). L: the landscape (heightAt).
 * Returns { lo, gv, top } like the kit's assemble, and the door point for the dressing.
 */
export function buildHouse(R, P, w, d, n, L) {
  const sc = R.scheme, rs = rnd(R.seed * 7919);
  const old = ['greek', 'greekfarm', 'italianate', 'upright', 'gablefront', 'ihouse'].includes(P.type);
  // colours (sRGB: the shader linearises): the scheme's siding, white trim on the old houses and most others
  let wallHex = sc.wall;
  if ((P.type === 'greek' || P.type === 'greekfarm') && rs() < .65) wallHex = WHITE;
  const wall = srgb(wallHex); wall.offsetHSL(0, 0, (rs() - .5) * .05);
  const brick = srgb(BRICKS[Math.floor(rs() * BRICKS.length)]);
  const trimC = srgb(old || rs() < .7 ? WHITE : sc.accent || WHITE), shutterC = srgb(sc.trim);
  const found = srgb(old ? '#8f8a7f' : '#aaa59b'), foundCode = old ? S.RUBBLE : S.CONCRETE;
  const roofC = srgb(R.roofColor);
  const wood = srgb('#7d6a58'), C = (c) => toU8(c);
  const st = { trim: [...toU8(shutterC), frameIndex(sc.frame || WHITE)], acc: [...toU8(trimC), 0], b: [R.seed, R.wear * .6] };
  for (const x of [w, d, n]) x.set({ ...st, win: [0, 0, 0, 0] });
  const codeCol = (name) => name === 'brick' ? brick : name === 'concrete' ? found : wall;

  // ground: the lowest and highest corner of every volume; the ground floor sits a little over the front
  let lo = Infinity, hi = -Infinity;
  for (const v of P.vols) for (const [s, t] of [[v.s0, v.t0], [v.s1, v.t0], [v.s1, v.t1], [v.s0, v.t1]]) { const p = at(P, s, t); const h = L.heightAt(p[0], p[1]); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const body = P.vols[0], fm = at(P, (body.s0 + body.s1) / 2, body.t0 - 1), gF = L.heightAt(fm[0], fm[1]);
  lo -= .4;
  const gv = Math.min(hi + .25, Math.max(lo + .75, gF + .45));
  const ctx = { R, P, w, d, n, L, lo, gv, wall, brick, trimC, shutterC, found, foundCode, roofC, wood, C, codeCol, windows: [], rs };
  let topMax = gv;
  for (const v of P.vols) { v.floor = gv + v.lift; v.top = v.floor + v.floors * v.fh; topMax = Math.max(topMax, v.top); }
  for (const v of P.vols) volume(ctx, v);
  for (const v of P.vols) volumeRoof(ctx, v);
  parts(ctx);
  closeDetail(ctx);
  const door = doorOf(ctx);
  return { lo, gv, top: topMax, door };
}

// ------------------------------------------------------------------ walls
/** The four walls of a volume, each left → right seen from outside: [name, p, q, axis]. */
function wallsOf(P, v) {
  const FL = at(P, v.s0, v.t0), FR = at(P, v.s1, v.t0), BR = at(P, v.s1, v.t1), BL = at(P, v.s0, v.t1);
  return [['front', FL, FR], ['right', FR, BR], ['back', BR, BL], ['left', BL, FL]];
}
const len2 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Cut a wall into segments: an opening's own bay, blank wall between. Returns [{ u0, u1, o }]. */
function segments(len, opens) {
  const list = (opens || []).filter((o) => o.at - o.w / 2 > .15 && o.at + o.w / 2 < len - .15).sort((a, b) => a.at - b.at);
  const out = []; let u = 0;
  for (const o of list) {
    const a = Math.max(u, o.at - o.w / 2), b = o.at + o.w / 2;
    if (a > u + .02) out.push({ u0: u, u1: a, o: null });
    if (b > a + .3) out.push({ u0: a, u1: b, o }); u = Math.max(u, b);
  }
  if (u < len - .02) out.push({ u0: u, u1: len, o: null });
  return out;
}

function volume(ctx, v) {
  const { R, P, w, lo, C, codeCol } = ctx;
  const ridgeS = v.roof.ridge === 's';
  const hip = v.roof.form === 'hip';
  const shut = P.parts.shutters ? F.SHUTTERS | F.OPEN : 0;
  for (const [name, p, q] of wallsOf(P, v)) {
    const L = len2(p, q);
    // foundation: from below the ground to the floor (a raised ranch's lower level and a split's lower storey are
    // walls of their own: their foundation stops under them)
    const fTop = v.lower?.all ? v.floor - v.lower.h : v.floor;
    if (fTop > lo + .05) { w.set({ code: ctx.foundCode, col: C(ctx.found), win: [0, 0, 0, 0], L }); w.wall(p, q, lo, fTop, 0, lo); }
    // a raised ranch's lower level: brick or block, its own short windows and the garage door
    if (v.lower?.all) {
      const y0 = v.floor - v.lower.h, y1 = v.floor;
      for (const sg of segments(L, v.lowOpen?.[name])) band(ctx, p, q, L, sg, y0, y1, [[y0, y1, WALL_CODE[v.lower.code] ?? S.BRICK, codeCol(v.lower.code)]], shut, 0);
    }
    // the storeys, each its own band (its windows; the door on the ground floor only)
    for (let k = 0; k < v.floors; k++) {
      const y0 = v.floor + k * v.fh, y1 = y0 + v.fh;
      const opens = k > 0 && v.upOpen?.[name] ? v.upOpen[name] : (v.open?.[name] || []).map((o) => k > 0 ? upper(o) : o).filter(Boolean);
      // zones up the band: a brick wainscot (ranch front), a split's lower storey in brick
      const zones = [];
      const code = WALL_CODE[v.wall] ?? S.LAP, col = codeCol(v.wall);
      if (v.lower && !v.lower.all && k === 0 && (!v.lower.front || name === 'front')) {
        const yb = Math.min(y1, y0 + v.lower.h);
        zones.push([y0, yb, WALL_CODE[v.lower.code] ?? S.BRICK, codeCol(v.lower.code)]); if (yb < y1) zones.push([yb, y1, code, col]);
      } else zones.push([y0, y1, code, col]);
      for (const sg of segments(L, opens)) band(ctx, p, q, L, sg, y0, y1, zones, shut, k);
    }
    // the gable end over the top storey
    const gableHere = !hip && v.roof.form !== 'shed' && (ridgeS ? (name === 'left' || name === 'right') : (name === 'front' || name === 'back'));
    if (gableHere) {
      const rise = (ridgeS ? (v.t1 - v.t0) : (v.s1 - v.s0)) / 2 * Math.tan(v.roof.pitch * Math.PI / 180), mid = lerp2(p, q, .5);
      const gw = (name === 'front' || name === 'right') ? v.gableWin?.[0] : v.gableWin?.[1];
      const flags = rise > 2 && (gw ?? (v.floors === 1 && rise > 2.6)) ? F.GABLE | (P.parts.shutters ? F.SHUTTERS | F.OPEN : 0) : 0;
      w.set({ code: WALL_CODE[v.wall] ?? S.LAP, col: C(codeCol(v.wall)), win: flags ? [3, L, v.top - lo + (v.gableFloors === 2 ? .35 : 0), W.SASH + 16 * 15 + 256 * flags] : [0, 0, 0, 0], L });
      w.poly([[p[0], v.top, p[1]], [q[0], v.top, q[1]], [mid[0], v.top + rise, mid[1]]], [[0, v.top - lo], [L, v.top - lo], [L / 2, v.top + rise - lo]]);
      if (flags) { const ws = W.SASH, [hx, hy, y0] = [.32, .38, .55]; ctx.windows.push({ p, q, L, u: L / 2, y: v.top + (v.gableFloors === 2 ? .35 : 0) + y0, hx, hy, ws, gable: true }); }
    }
    // the garage door: a panelled door on the wall
    for (const o of v.open?.[name] || []) if (o.kind === 'garage') garageDoor(ctx, p, q, L, o.at, Math.min(o.w, v.garage ? (o.w > 5 ? 4.9 : 2.7) : 2.8), v.floor + .02);
    for (const o of v.lowOpen?.[name] || []) if (o.kind === 'garage') garageDoor(ctx, p, q, L, o.at, 4.9, v.floor - v.lower.h + .02);
  }
}
/** What an opening becomes on an upper storey. */
function upper(o) {
  if (o.kind === 'door' || o.kind === 'pic') return { ...o, kind: 'win', w: 1.3 };
  if (o.kind === 'garage') return o.w > 4 ? null : { ...o, kind: 'win', w: 1.3 };
  return o;
}
/** One segment of one storey band: its vertical zones, each face carrying the segment's window (or none). */
function band(ctx, p, q, L, sg, y0, y1, zones, shut, k) {
  const { w, lo, C } = ctx;
  const a = lerp2(p, q, sg.u0 / L), b = lerp2(p, q, sg.u1 / L), sl = sg.u1 - sg.u0;
  let win = [0, 0, 0, 0];
  const o = sg.o;
  if (o && o.kind !== 'blank' && o.kind !== 'garage') {
    const ws = KIND_WS[o.kind] ?? W.SASH, door = o.kind === 'door' && k === 0;
    win = [Math.max(2.4, y1 - y0), sl, y0 - lo, ws + 16 * (door ? 0 : 15) + 256 * (door || o.kind === 'pic' && !shut ? 0 : shut)];
    if (!door) { const [hx, hy, s0] = WIN_DIM[ws]; ctx.windows.push({ p, q, L, u: (sg.u0 + sg.u1) / 2, y: y0 + s0, hx, hy, ws }); }
    else ctx.doors = [...(ctx.doors || []), { p, q, L, u: (sg.u0 + sg.u1) / 2, y: y0 }];
  }
  for (const [z0, z1, code, col] of zones) {
    if (z1 - z0 < .02) continue;
    w.set({ code, col: C(col), win, L: sl });
    w.wall(a, b, z0, z1, 0, lo);
  }
}
function garageDoor(ctx, p, q, L, u, gw, y) {
  const { w, C } = ctx;
  const t = [(q[0] - p[0]) / L, (q[1] - p[1]) / L], nn = [-t[1], t[0]];   // outward (the kit's convention)
  const a = [p[0] + t[0] * (u - gw / 2) + nn[0] * .04, p[1] + t[1] * (u - gw / 2) + nn[1] * .04], b = [p[0] + t[0] * (u + gw / 2) + nn[0] * .04, p[1] + t[1] * (u + gw / 2) + nn[1] * .04];
  w.set({ code: S.GARAGE, col: C(srgb('#eeece6')), win: [0, 0, 0, 0], L: gw });
  w.wall(a, b, y, y + 2.15, 0, y);
  ctx.n.set({ code: S.PLAIN, col: C(ctx.trimC), win: [0, 0, 0, 0] });
  boxOnWall(ctx.n, p, q, L, u - gw / 2 - .12, u + gw / 2 + .12, y + 2.15, y + 2.3, 0, .06);
}

// ------------------------------------------------------------------ roofs
function volumeRoof(ctx, v) {
  const { R, P } = ctx;
  let ridgeS = v.roof.ridge === 's';
  if (v.roof.form === 'hip') ridgeS = (v.s1 - v.s0) >= (v.t1 - v.t0);
  const sc = (v.s0 + v.s1) / 2, tc = (v.t0 + v.t1) / 2, c = at(P, sc, tc);
  const u = ridgeS ? P.a : P.b, hu = ridgeS ? (v.s1 - v.s0) / 2 : (v.t1 - v.t0) / 2, hv = ridgeS ? (v.t1 - v.t0) / 2 : (v.s1 - v.s0) / 2;
  const r = { cx: c[0], cz: c[1], ux: u[0], uz: u[1], vx: -u[1], vz: u[0], hu, hv };
  roofOn(ctx, r, v.top, v.roof.form, v.roof.pitch, v.roof.eave, v.roof.rake);
  v.ridgeY = v.top + hv * Math.tan(v.roof.pitch * Math.PI / 180);
}
/** The kit's roof (slab, soffit, fascia, ridge cap) on rect r over wall top `top`. */
function roofOn(ctx, r, top, form, pitchDeg, eave, rake) {
  const { R } = ctx;
  const Rv = Object.create(R);
  Object.assign(Rv, { form, pitch: pitchDeg * Math.PI / 180, eave, rake, full: true, archetype: 'cottage' });
  const corner = (rr, a, b) => [rr.cx + rr.ux * a + rr.vx * b, rr.cz + rr.uz * a + rr.vz * b];
  kitRoof({ R: Rv, top, corner, w: ctx.w, d: ctx.d, roofC: ctx.roofC, C: ctx.C, wood: ctx.wood, wall: ctx.trimC, main: r }, r, 0);
}

// ------------------------------------------------------------------ parts
function parts(ctx) {
  const { P, w, n, C, gv, lo, R } = ctx;
  const body = P.vols[0], pp = P.parts;
  const tanB = Math.tan(body.roof.pitch * Math.PI / 180);
  const frame = (s, t, along = P.a) => { const c = at(P, s, t); return { cx: c[0], cz: c[1], ux: along[0], uz: along[1], vx: -along[1], vz: along[0] }; };
  // the house's own frame: u along the front (a), v back (b) — the kit's box(f, a0, a1, b0, b1, y0, y1)
  const F0 = { cx: P.o[0], cz: P.o[1], ux: P.a[0], uz: P.a[1], vx: P.b[0], vz: P.b[1] };
  // chimneys: brick, up past the ridge; an exterior one stands against the gable end from the ground
  for (const ch of pp.chimneys || []) {
    const v = P.vols.find((vv) => ch.s >= vv.s0 - 1 && ch.s <= vv.s1 + 1 && ch.t >= vv.t0 && ch.t <= vv.t1) || body;
    const yTop = (v.ridgeY ?? v.top + 2) + .7, y0 = ch.exterior ? lo : v.top - .5;
    w.set({ code: S.BRICK, col: C(ctx.brick), win: [0, 0, 0, 0] });
    w.box(F0, ch.s - ch.w / 2, ch.s + ch.w / 2, ch.t - ch.d / 2, ch.t + ch.d / 2, y0, yTop);
    if (ch.exterior) w.box(F0, ch.s - ch.w / 2 - .12, ch.s + ch.w / 2 + .12, ch.t - ch.d / 2 - .1, ch.t + ch.d / 2 + .1, lo, v.top - .4);   // the wider base up to the eaves
    n.set({ code: S.CONCRETE, col: C(srgb('#77736c')), win: [0, 0, 0, 0] });
    n.box(F0, ch.s - ch.w / 2 - .07, ch.s + ch.w / 2 + .07, ch.t - ch.d / 2 - .07, ch.t + ch.d / 2 + .07, yTop, yTop + .1);
  }
  // dormers on the front slope (a Cape): small gabled boxes, a window each
  if (pp.dormers) {
    const v = body, td = v.t0 + .95, yb = v.top + (td - v.t0) * tanB, yt = yb + 1.55, tBack = v.t0 + (yt - v.top) / tanB + .15;
    for (const dm of pp.dormers.list) {
      const s0 = dm.s - dm.w / 2, s1 = dm.s + dm.w / 2;
      const FL = at(P, s0, td), FR = at(P, s1, td), BL = at(P, s0, tBack), BR = at(P, s1, tBack);
      w.set({ code: WALL_CODE[v.wall] ?? S.LAP, col: C(ctx.codeCol(v.wall)), win: [2.4, dm.w, yb - .78 - lo, W.FARM + 16 * 15 + 256 * (pp.shutters ? 0 : 0)], L: dm.w });
      w.wall(FL, FR, yb - .3, yt, 0, lo);
      ctx.windows.push({ p: FL, q: FR, L: dm.w, u: dm.w / 2, y: yb - .78 + 1, hx: .33, hy: .42, ws: W.FARM });
      w.set({ win: [0, 0, 0, 0], L: tBack - td });
      both(w, [[FR[0], yb - .3, FR[1]], [BR[0], yt, BR[1]], [FR[0], yt, FR[1]]]);
      both(w, [[FL[0], yb - .3, FL[1]], [FL[0], yt, FL[1]], [BL[0], yt, BL[1]]]);
      const c = at(P, dm.s, (td + tBack) / 2);
      roofOn(ctx, { cx: c[0], cz: c[1], ux: P.b[0], uz: P.b[1], vx: -P.b[1], vz: P.b[0], hu: (tBack - td) / 2, hv: dm.w / 2 }, yt, 'gable', 45, .15, .15);
      // its gable
      const mid = lerp2(FL, FR, .5), rise = dm.w / 2;
      w.set({ code: WALL_CODE[v.wall] ?? S.LAP, col: C(ctx.codeCol(v.wall)), win: [0, 0, 0, 0], L: dm.w });
      w.poly([[FL[0], yt, FL[1]], [FR[0], yt, FR[1]], [mid[0], yt + rise, mid[1]]], [[0, yt - lo], [dm.w, yt - lo], [dm.w / 2, yt + rise - lo]]);
    }
  }
  // a shed dormer across the back slope
  if (pp.shedDormer) {
    const v = body, td = v.t1 - 1, yb = v.top + (v.t1 - td) * tanB, yt = yb + 1.7, tIn = v.t1 - (yt - v.top) / tanB + .3;
    const { s0, s1 } = pp.shedDormer, Lw = s1 - s0;
    const BL = at(P, s1, td), BR = at(P, s0, td), IL = at(P, s1, tIn), IR = at(P, s0, tIn);
    w.set({ code: WALL_CODE[v.wall] ?? S.LAP, col: C(ctx.codeCol(v.wall)), win: [2.4, Lw / 3, yb - .65 - lo, W.SASH + 16 * 15], L: Lw });
    w.wall(BL, BR, yb - .3, yt, 0, lo);
    w.set({ win: [0, 0, 0, 0], L: td - tIn });
    for (const [A, B] of [[BL, IL], [BR, IR]]) both(w, [[A[0], yb - .3, A[1]], [A[0], yt, A[1]], [B[0], yt, B[1]]]);
    const c = at(P, (s0 + s1) / 2, (td + tIn) / 2);
    roofOn(ctx, { cx: c[0], cz: c[1], ux: P.a[0], uz: P.a[1], vx: -P.b[0], vz: -P.b[1], hu: Lw / 2, hv: (td - tIn) / 2 }, yt, 'shed', 8, .25, .2);
  }
  // porch: deck, posts, a shed roof against the wall; rails, pickets, steps close up
  if (pp.porch) porch(ctx, pp.porch);
  if (pp.portico) portico(ctx, pp.portico);
  if (pp.stoop) stoop(ctx, pp.stoop);
  if (pp.foyer) {
    // the split foyer's door between the levels, with a window over it
    const v = body, s = pp.foyer.s, p = at(P, s - .55, v.t0), q = at(P, s + .55, v.t0);
    const nOut = [-P.b[0] * .04, -P.b[1] * .04], y = gv + .45;
    w.set({ code: S.DOOR, col: C(ctx.shutterC.clone().multiplyScalar(.85)), win: [0, 0, 0, 0], L: 1.1 });
    w.wall([p[0] + nOut[0], p[1] + nOut[1]], [q[0] + nOut[0], q[1] + nOut[1]], y, y + 2.1, 0, y);
    ctx.doors = [...(ctx.doors || []), { p, q, L: 1.1, u: .55, y, raw: true }];
  }
  // Greek Revival: the frieze under the eaves all round, the pediment's cornice closing the front gable
  for (const v of P.vols) if (v.frieze) {
    for (const [name, p, q] of wallsOf(P, v)) {
      const L = len2(p, q);
      ctx.w.set({ code: S.PLAIN, col: C(ctx.trimC), win: [0, 0, 0, 0] });
      boxOnWall(ctx.w, p, q, L, -.06, L + .06, v.top - v.frieze, v.top, 0, .05);
    }
  }
  if (pp.pediment) {
    const v = body, [p, q] = [at(P, v.s0, v.t0), at(P, v.s1, v.t0)];
    ctx.w.set({ code: S.PLAIN, col: C(ctx.trimC), win: [0, 0, 0, 0] });
    boxOnWall(ctx.w, p, q, len2(p, q), -.25, len2(p, q) + .25, v.top - .05, v.top + .22, 0, .35);
  }
  if (pp.cupola) {
    const c = at(P, pp.cupola.s, pp.cupola.t), y = body.ridgeY - .3;
    const f = { cx: c[0], cz: c[1], ux: P.a[0], uz: P.a[1], vx: P.b[0], vz: P.b[1] };
    w.set({ code: S.LAP, col: C(ctx.wall), win: [1.2, .9, y + .2 - lo, W.FARM + 16 * 15], L: 1.8 });
    w.box(f, -.9, .9, -.9, .9, y, y + 1.3);
    roofOn(ctx, { cx: c[0], cz: c[1], ux: P.a[0], uz: P.a[1], vx: -P.a[1], vz: P.a[0], hu: .9, hv: .9 }, y + 1.3, 'hip', 25, .35, .35);
  }
}

/** A porch along a wall: deck on a skirt, posts, a shed roof from the wall; rails and steps in the close detail. */
function porch(ctx, o) {
  const { P, w, n, C, lo } = ctx;
  const v = P.vols.find((vv) => o.t == null ? vv === P.vols[0] : Math.abs(vv.t0 - o.t) < .01 && o.s0 >= vv.s0 - .5 && o.s1 <= vv.s1 + .5) || P.vols[0];
  const t0 = o.t ?? v.t0, s0 = o.s0, s1 = o.s1, dd = o.d, floor = v.floor - .12;
  const F0 = { cx: P.o[0], cz: P.o[1], ux: P.a[0], uz: P.a[1], vx: P.b[0], vz: P.b[1] };
  // deck and skirt
  w.set({ code: S.WOOD, col: C(srgb('#9b9488')), win: [0, 0, 0, 0] });
  w.box(F0, s0, s1, t0 - dd, t0, lo, floor);
  // posts
  const beam = floor + Math.min(2.55, v.fh * (v.floors > 1 ? .86 : .82));
  const np = o.posts || 4, pw = o.columns ? .26 : .16;
  w.set({ code: S.PLAIN, col: C(ctx.trimC) });
  for (let k = 0; k < np; k++) { const s = s0 + .15 + (s1 - s0 - .3) * (k / (np - 1)); w.box(F0, s - pw / 2, s + pw / 2, t0 - dd + .12, t0 - dd + .12 + pw, floor, beam); }
  // the beam
  w.box(F0, s0, s1, t0 - dd + .05, t0 - dd + .3, beam, beam + .22);
  // roof: a shed from the wall down to the beam
  const c = at(P, (s0 + s1) / 2, t0 - dd / 2);
  const pitch = Math.max(8, Math.min(16, Math.atan2(Math.max(.25, (v.floors > 1 ? floor + v.fh + .45 : v.top - .1) - beam - .2), dd) * 180 / Math.PI));
  roofOn(ctx, { cx: c[0], cz: c[1], ux: -P.a[0], uz: -P.a[1], vx: P.b[0], vz: P.b[1], hu: (s1 - s0) / 2, hv: dd / 2 }, beam + .2, 'shed', pitch, .25, .12);
  // close detail: rails and pickets between the posts (leaving a gap at the steps), steps, post brackets
  n.set({ code: S.PLAIN, col: C(ctx.trimC), win: [0, 0, 0, 0] });
  const mid = (s0 + s1) / 2;
  if (o.rail) for (let k = 0; k < np - 1; k++) {
    const a = s0 + .15 + (s1 - s0 - .3) * (k / (np - 1)) + pw / 2, b = s0 + .15 + (s1 - s0 - .3) * ((k + 1) / (np - 1)) - pw / 2;
    if (a < mid && b > mid) continue;   // the steps' bay
    const tR = t0 - dd + .12 + pw / 2;
    n.box(F0, a, b, tR - .04, tR + .04, floor + .82, floor + .9);
    n.box(F0, a, b, tR - .03, tR + .03, floor + .1, floor + .16);
    for (let s = a + .12; s < b - .05; s += .24) n.box(F0, s - .02, s + .02, tR - .02, tR + .02, floor + .16, floor + .82);
  }
  if (o.brackets) for (let k = 0; k < np; k++) { const s = s0 + .15 + (s1 - s0 - .3) * (k / (np - 1)); for (const sg of [-1, 1]) n.box(F0, s + sg * .08, s + sg * .32, t0 - dd + .14, t0 - dd + .24, beam - .3, beam); }
  steps(ctx, F0, mid, t0 - dd, floor, 1.6);
  // porch furniture (close detail): a pair of rocking chairs, or chairs and a porch swing, in one paint
  const hs = (k) => { const x = Math.sin((ctx.R.seed || 1) * 91.7 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  if (dd >= 1.6 && s1 - s0 >= 3.2 && hs(1) < .75) {
    const paint = ['#f1efe8', '#2f4a3c', '#6b4a32', '#8a2f28', '#2f3c4a'][Math.floor(hs(2) * 5)];
    n.set({ code: S.PLAIN, col: C(srgb(paint)), win: [0, 0, 0, 0] });
    const tc = t0 - dd * .45, chair = (sc) => {
      n.box(F0, sc - .27, sc + .27, tc - .25, tc + .25, floor + .38, floor + .44);   // (the seat)
      n.box(F0, sc - .27, sc + .27, tc + .2, tc + .26, floor + .44, floor + 1.02);   // (the back, against the wall)
      for (const a of [-.25, .25]) n.box(F0, sc + a - .03, sc + a + .03, tc - .25, tc + .25, floor + .58, floor + .62);   // (arms)
      for (const a of [-.24, .24]) n.box(F0, sc + a - .025, sc + a + .025, tc - .3, tc + .3, floor, floor + .06);   // (rockers)
    };
    chair(s0 + .75); if (hs(3) < .7) chair(s0 + 1.45);
    if (hs(4) < .35 && s1 - s0 > 5) {
      // a porch swing at the far end: a bench hung from the beam on two chains
      const sm = s1 - 1.2;
      n.box(F0, sm - .7, sm + .7, tc - .2, tc + .2, floor + .45, floor + .5); n.box(F0, sm - .7, sm + .7, tc + .16, tc + .2, floor + .5, floor + .95);
      n.set({ code: S.PLAIN, col: C(srgb('#3a3a3a')), win: [0, 0, 0, 0] });
      for (const a of [-.65, .65]) n.box(F0, sm + a - .01, sm + a + .01, tc - .01, tc + .01, floor + .5, beam);
    }
  }
}
function portico(ctx, o) {
  const { P, w, C, lo } = ctx;
  const v = P.vols[0], s = o.s, t0 = v.t0, dd = o.d, floor = v.floor - .12;
  const F0 = { cx: P.o[0], cz: P.o[1], ux: P.a[0], uz: P.a[1], vx: P.b[0], vz: P.b[1] };
  w.set({ code: S.CONCRETE, col: C(srgb('#bab5aa')), win: [0, 0, 0, 0] });
  w.box(F0, s - o.w / 2, s + o.w / 2, t0 - dd, t0, lo, floor);
  const beam = floor + 2.75;
  w.set({ code: S.PLAIN, col: C(ctx.trimC) });
  for (const sg of [-1, 1]) w.box(F0, s + sg * (o.w / 2 - .25) - .12, s + sg * (o.w / 2 - .25) + .12, t0 - dd + .1, t0 - dd + .34, floor, beam);
  w.box(F0, s - o.w / 2, s + o.w / 2, t0 - dd + .05, t0, beam, beam + .25);
  const c = at(P, s, t0 - dd / 2);
  // a pediment (a gable to the street) or a flat-topped hood
  roofOn(ctx, { cx: c[0], cz: c[1], ux: P.b[0], uz: P.b[1], vx: -P.b[1], vz: P.b[0], hu: dd / 2, hv: o.w / 2 }, beam + .25, o.pediment ? 'gable' : 'hip', o.pediment ? 32 : 14, .15, .15);
  if (o.pediment) {
    const p = at(P, s - o.w / 2, t0 - dd), q = at(P, s + o.w / 2, t0 - dd), m = lerp2(p, q, .5), y = beam + .25;
    w.set({ code: S.PLAIN, col: C(ctx.trimC), L: o.w });
    w.poly([[p[0], y, p[1]], [q[0], y, q[1]], [m[0], y + o.w / 2 * Math.tan(32 * Math.PI / 180), m[1]]], [[0, 0], [1, 0], [.5, 1]]);
  }
  steps(ctx, F0, s, t0 - dd, floor, Math.min(1.8, o.w - .4));
}
function stoop(ctx, o) {
  const { P, w, C, lo } = ctx;
  const v = P.vols.find((vv) => o.s >= vv.s0 && o.s <= vv.s1 && !vv.garage) || P.vols[0], s = o.s, t0 = v.t0;
  const F0 = { cx: P.o[0], cz: P.o[1], ux: P.a[0], uz: P.a[1], vx: P.b[0], vz: P.b[1] };
  const floor = o.high ? ctx.gv + .45 : v.floor - .1;
  w.set({ code: S.CONCRETE, col: C(srgb('#b4afa4')), win: [0, 0, 0, 0] });
  w.box(F0, s - o.w / 2, s + o.w / 2, t0 - o.d, t0, lo, floor);
  if (o.roof) {
    const y = floor + 2.45, c = at(P, s, t0 - o.d / 2);
    roofOn(ctx, { cx: c[0], cz: c[1], ux: P.b[0], uz: P.b[1], vx: -P.b[1], vz: P.b[0], hu: o.d / 2, hv: o.w / 2 + .1 }, y, 'gable', 30, .1, .12);
    const p = at(P, s - o.w / 2 - .1, t0 - o.d), q = at(P, s + o.w / 2 + .1, t0 - o.d), m = lerp2(p, q, .5);
    w.set({ code: S.PLAIN, col: C(ctx.trimC), L: o.w });
    w.poly([[p[0], y, p[1]], [q[0], y, q[1]], [m[0], y + (o.w / 2 + .1) * Math.tan(30 * Math.PI / 180), m[1]]], [[0, 0], [1, 0], [.5, 1]]);
    ctx.n.set({ code: S.PLAIN, col: C(ctx.trimC) });
    for (const sg of [-1, 1]) ctx.n.box(F0, s + sg * (o.w / 2 - .05) - .06, s + sg * (o.w / 2 - .05) + .06, t0 - o.d + .02, t0 - o.d + .14, floor, y);
  }
  steps(ctx, F0, s, t0 - o.d, floor, Math.min(1.6, o.w - .2));
  if (o.high) {
    // the iron railing up a raised ranch's steps
    ctx.n.set({ code: S.STEEL, col: C(srgb('#2c2c2a')) });
    for (const sg of [-1, 1]) ctx.n.box(F0, s + sg * .75 - .02, s + sg * .75 + .02, t0 - o.d - 1.2, t0 - o.d, floor + .85, floor + .9);
  }
}
/** Steps down from a deck at (s, t) (t: its front edge) to the ground, in the house's frame. */
function steps(ctx, F0, s, t, floor, sw) {
  const { P, L, n, C } = ctx;
  const p = at(P, s, t - .6), g = L.heightAt(p[0], p[1]);
  const rise = floor - g; if (rise < .15) return;
  const k = Math.min(7, Math.ceil(rise / .18)), run = .28;
  ctx.w.set({ code: S.CONCRETE, col: C(srgb('#b9b4a9')), win: [0, 0, 0, 0] });
  for (let i = 0; i < k; i++) ctx.w.box(F0, s - sw / 2, s + sw / 2, t - run * (k - i), t, g - .3, g + rise * (i + 1) / k);
}

// ------------------------------------------------------------------ close detail
function closeDetail(ctx) {
  const { P, n, C } = ctx, pp = P.parts;
  // window casings: side boards, a head (an entablature on the Greek houses, a hood on the Italianate), a sill
  n.set({ code: S.PLAIN, col: C(ctx.trimC), win: [0, 0, 0, 0] });
  for (const wd of ctx.windows) {
    const { p, q, L, u, y, hx, hy } = wd, b = .09, pr = .045;
    const x0 = u - hx - .07, x1 = u + hx + .07, y0 = y - .07, y1 = y + 2 * hy + .07;
    boxOnWall(n, p, q, L, x0 - b, x0, y0, y1, 0, pr);
    boxOnWall(n, p, q, L, x1, x1 + b, y0, y1, 0, pr);
    const greek = (P.type === 'greek' || P.type === 'greekfarm') && !wd.gable;
    if (pp.hoods && !wd.gable) { boxOnWall(n, p, q, L, x0 - .16, x1 + .16, y1, y1 + .26, 0, .09); boxOnWall(n, p, q, L, x0 - .2, x1 + .2, y1 + .26, y1 + .32, 0, .14); }
    else if (greek) { boxOnWall(n, p, q, L, x0 - b - .04, x1 + b + .04, y1, y1 + .24, 0, .06); boxOnWall(n, p, q, L, x0 - b - .08, x1 + b + .08, y1 + .24, y1 + .29, 0, .1); }
    else boxOnWall(n, p, q, L, x0 - b, x1 + b, y1, y1 + .13, 0, pr + .01);
    boxOnWall(n, p, q, L, x0 - b - .04, x1 + b + .04, y0 - .07, y0, 0, .08);
  }
  // door surrounds: pilasters and a head; sidelights on the Greek side-hall door
  for (const dr of ctx.doors || []) {
    const { p, q, L, u, y } = dr, hw = dr.raw ? .55 : .55, top = y + 2.25;
    const wide = pp.doorSurround?.sidelights ? .5 : 0;
    boxOnWall(n, p, q, L, u - hw - wide - .2, u - hw - wide - .02, y, top + .05, 0, .06);
    boxOnWall(n, p, q, L, u + hw + wide + .02, u + hw + wide + .2, y, top + .05, 0, .06);
    boxOnWall(n, p, q, L, u - hw - wide - .28, u + hw + wide + .28, top + .05, top + (P.type.startsWith('greek') ? .42 : .22), 0, .09);
    if (wide) {
      n.set({ code: S.GLASS, col: C(srgb('#3a4650')) });
      for (const sg of [-1, 1]) boxOnWall(n, p, q, L, sg < 0 ? u - hw - wide : u + hw + .05, sg < 0 ? u - hw - .05 : u + hw + wide, y + .5, top, 0, .02);
      n.set({ code: S.PLAIN, col: C(ctx.trimC) });
    }
  }
  // corner boards (pilasters on the Greek houses), eave brackets (Italianate), gutters
  for (const v of P.vols) {
    const ws = wallsOf(P, v);
    for (const [name, p, q] of ws) {
      const L = len2(p, q);
      if (pp.cornerBoards || pp.pilasters || pp.brackets) {
        const wdt = pp.pilasters ? .3 : .13, y0 = v.lower?.all ? v.floor - v.lower.h : v.floor - .1;
        n.set({ code: S.PLAIN, col: C(ctx.trimC) });
        boxOnWall(n, p, q, L, -.02, wdt, y0, v.top, 0, pp.pilasters ? .06 : .03);
        boxOnWall(n, p, q, L, L - wdt, L + .02, y0, v.top, 0, pp.pilasters ? .06 : .03);
      }
      const eaveWall = v.roof.form === 'hip' || (v.roof.ridge === 's' ? name === 'front' || name === 'back' : name === 'left' || name === 'right');
      if (pp.brackets && eaveWall) {
        n.set({ code: S.PLAIN, col: C(ctx.trimC) });
        // paired brackets under the eave: from the wall out to near the fascia, their tops under the slab
        const out = Math.min(.72, v.roof.eave - .08), yTop = v.top - out * Math.tan(v.roof.pitch * Math.PI / 180) - .19;
        for (let s = .5; s < L - .3; s += 1.4) for (const ds of [0, .3]) boxOnWall(n, p, q, L, s + ds - .05, s + ds + .05, yTop - .45, yTop, 0, out);
      }
      if (eaveWall) {
        // a gutter along the eave, a downpipe at the far corner
        const e = v.roof.eave, yE = v.top - e * Math.tan(v.roof.pitch * Math.PI / 180) - .12;
        n.set({ code: S.STEEL, col: C(srgb('#e9e7e1')) });
        boxOnWall(n, p, q, L, -e * (v.roof.form === 'hip' ? 1 : 0) - .1, L + .1, yE - .12, yE, e - .06, e + .08);
        if (name === 'front' || name === 'back') boxOnWall(n, p, q, L, L - .25, L - .15, ctx.lo + .4, yE, .02, .12);
      }
    }
  }
}

/** A box on a wall p → q (left → right from outside): u0..u1 along it, y0..y1, out0..out1 metres out from its face. */
function boxOnWall(x, p, q, L, u0, u1, y0, y1, out0, out1) {
  const t = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  const nrm = [-t[1], t[0]];   // outward for a wall wound left → right from outside (the kit's convention: n = (−tz, tx))
  const c = [p[0] + t[0] * (u0 + u1) / 2, p[1] + t[1] * (u0 + u1) / 2];
  const f = { cx: c[0], cz: c[1], ux: t[0], uz: t[1], vx: nrm[0], vz: nrm[1] };
  x.box(f, -(u1 - u0) / 2, (u1 - u0) / 2, out0, out1, y0, y1);
}

/** A small polygon both ways round (dormer cheeks: seen from either side). */
function both(x, P) { const uv = P.map((p) => [p[0] * .7 + p[2] * .7, p[1]]); x.poly(P, uv); x.poly(P.slice().reverse(), uv.slice().reverse()); }

/** Where the front door is (for the dressing and the drive): the first door on a front wall. */
function doorOf(ctx) {
  const dr = (ctx.doors || [])[0]; if (!dr) return null;
  const t = [(dr.q[0] - dr.p[0]) / dr.L, (dr.q[1] - dr.p[1]) / dr.L];
  return { x: dr.p[0] + t[0] * dr.u, z: dr.p[1] + t[1] * dr.u, n: [-t[1], t[0]], t, gv: dr.y };
}
function rnd(seed) { let s = Math.floor(seed) | 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
