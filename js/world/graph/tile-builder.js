// A graph world's tile jobs (js/world/graph-world.js): each streaming tile's roads (ribbons, junctions, paint, sides,
// decks), its ground (cut to the roads, the river bed), the ways' spill, the dressed places and the river banks, as
// time-sliced jobs (generators: they yield when the frame's slice is used up). [review 27 Nov] W14: the methods moved
// here verbatim; they are still GraphWorld's (installTileJobs puts them on its prototype) and work on its state
// (tiles, mats, cut, ground, shore, dressing, city…) through `this` — the class split over two files, not yet a
// builder with its own interface.
import * as THREE from '../../../vendor/three.js';
import { ROAD_LIFT } from '../toolbox/core/road-frame.js';   // [review 27 Nov] the toolbox's road frame (pose.js re-exports it)
import { canalAt } from '../toolbox/city/cny-landmarks.js';
import { due } from '../toolbox/core/jobs.js';
import { deckSpans } from './curves.js';
import { Mesher } from './mesh.js';
import { TILE, WATER_ABOVE, BANK_CAP, BANK_SLOPE } from './constants.js';

const UP = new THREE.Vector3(0, 1, 0);   // (read only: the dressing's tree crowns turn round it)
const GROUND_CELL = 12.8;           // m: the ground mesh's spacing (TILE / 31.25)
const PIER_STEP = 7;                // samples (70 m) between a deck's piers
const PROM_M = 6;                   // m of granite paving along the top of a river wall
const SURF_CODE = { asphalt: 0, brick: 1, sett: 2, concrete: 3, paving: 4, gravel: 5, dirt: 6, wood: 7 };   // ([review 27 Nov] a stray comment for a constant long gone dropped here)

const COLORS = {
  primary: '#4c4e52', secondary: '#4c4e52', tertiary: '#4c4e52', residential: '#4c4e52', alley: '#57554f',
  path: '#5f5d59', plaza: '#8e8a83', side: '#7d7a5e', deck: '#8a8780', rail: '#a29e95', under: '#57544f',
};

/** A natural bank's height s metres in from the water's edge (− out in the river): under the water to the edge, then
 *  ≥ 1.5 m up within 5 m (no mud ramp), easing to the bank's top by BANK_SLOPE. */
export function bankProfile(s, top, waterY, pool) {
  const T = Math.max(top, waterY + 1.6), y5 = waterY + Math.max(1.5, 0.5 * (T - waterY));
  if (s <= -4) return pool - 2;
  if (s <= 0) return pool - 2 + ((waterY - 0.05 - (pool - 2)) * (s + 4)) / 4;
  if (s <= 5) return waterY - 0.05 + ((y5 - waterY + 0.05) * s) / 5;
  if (s <= BANK_SLOPE) { const u = (s - 5) / (BANK_SLOPE - 5); return y5 + (T - y5) * u * u * (3 - 2 * u); }
  return T;
}

export class GraphTileBuilder {
  /** How a way is painted: centre line, lane lines, edge lines (one-ways and lanes from the city data). */
  _paintOf(e) {
    const ow = this.city?.edgeInfo(e).ow || 0, lanes = this.city?.edgeInfo(e).lanes || 0;
    if (this.profile.pathPaint === false && (e.kind === 'path' || e.kind === 'bridle')) return { centre: null, edges: false, lanes: 0 };   // (NYC: the park's paths are unpainted)
    if (e.kind === 'drive' && this.profile.drivePaint === 'park') return { centre: null, edges: true, lanes: 0, bikeLane: true };   // (Central Park's drives: edge lines and a painted bike lane)
    if (e.kind === 'path') {
      // (a gravel or dirt trail has no paint: CNY's stone-dust towpath)
      const loose = this.city && ['gravel', 'dirt'].includes(this.city.edgeInfo(e).surf(e.n >> 1));
      return { centre: !e._rw && !loose && (e._w || 3) >= 3.4 ? 'dash-yellow' : null, edges: false, lanes: 0 };
    }
    if (e.kind === 'plaza' || e.kind === 'alley') return { centre: null, edges: false, lanes: 0 };
    if (ow) return { centre: null, edges: e.kind !== 'residential', lanes: Math.max(1, lanes), oneway: true };
    if (e.kind === 'primary' || e.kind === 'secondary') return { centre: 'double', edges: true, lanes: 0 };
    if (e.kind === 'tertiary') return { centre: 'dash-yellow', edges: false, lanes: 0 };
    return { centre: null, edges: false, lanes: 0 };
  }

  /** A tile's roads as a job: pauses between ways when its slice is used up (no stall on a phone). */
  *_roadsJob(t) {
    t.built = true; t.spills = []; t.endSpills = []; this._built.add(t);
    if (!t.pieces.length && !t.nodes.length) return;
    const R = new Mesher(true), P = new Mesher(), W = new Mesher(), P_ = P;
    const col = (k) => new THREE.Color(COLORS[k] || COLORS.residential);
    const side = col('side'), deckC = col('deck'), rail = col('rail'), under = col('under');
    const verge = new THREE.Color(this.profile.verge), gravelC = new THREE.Color('#a59b84'), walkC = new THREE.Color('#b4afa4'), curbC = new THREE.Color('#c3beb3'), walkSide = new THREE.Color('#9d988e');
    for (const { e, a, b } of t.pieces) {
      if (due()) yield;
      // (a hero area's singletrack has no ribbon of its own: its path is the area's floor worn through where the tires go
      //  — old-growth.js draws it — user, 24 Nov: "Start with the ground material and almost overlay wear from a bike
      //  passing over")
      if (e._cf && this.json?.oldGrowth) continue;
      const half = this.wOf(e) / 2, path = e.kind === 'path', walk = this.walkOf(e);
      const base = e._rw ? new THREE.Color('#a9a59c') : e._cf ? new THREE.Color('#6e553c') : col(e.kind), lift = e._cf ? 0.05 : ROAD_LIFT + (path ? -0.03 : 0);   // (a singletrack: packed, lighter earth, right on the floor)
      const deck = new Uint8Array(e.n + 1);
      for (const [p, q] of e.bridges) for (let i = p; i <= q; i++) deck[i] = 1;
      const bm = this.bridgeMask?.get(e.id) || this.modelDecks?.get(e.id);
      // the ribbon stops at a junction's mouth (_planJunctions), its end exactly on the mouth
      const tr = this.trim?.get(e.id) || [0, 0], f0 = tr[0] / 10, f1 = e.n - tr[1] / 10;
      if (f0 >= b || f1 <= a) continue;
      let C = this._curve(e, a, b);
      if (f0 > a || f1 < b) {
        const keep = C.filter((c) => c.i > f0 + 1e-6 && c.i < f1 - 1e-6);
        if (f0 > a) keep.unshift({ ...this._curvePoint(e, f0), i: f0 });
        if (f1 < b) keep.push({ ...this._curvePoint(e, f1), i: f1 });
        for (let k = 0; k < keep.length; k++) keep[k].s = k ? keep[k - 1].s + Math.hypot(keep[k].x - keep[k - 1].x, keep[k].z - keep[k - 1].z) : (C[0].s || 0);
        C = keep;
      }
      const n = C.length;
      if (n < 2) continue;
      // paint: clear of the junctions' mouths and their crosswalks
      const lenM = e.n * 10, r0 = tr[0] > 0 ? tr[0] + 3.4 : 0, r1 = tr[1] > 0 ? tr[1] + 3.4 : 0;
      const atS = (c) => c.i * 10;
      // [zwift-look] which of this way's lines the shader draws (bits: 1 edges, 2 bike lane, 4 double centre, 8 dashed
      // centre, 16 a path's dashes); the rest stay geometry below
      const P0 = this.roadLook?.paint ? this._paintOf(e) : null;
      const spaint = !P0 ? 0 : (P0.edges && !P0.oneway ? 1 : 0) | (P0.bikeLane ? 2 : 0) | (P0.centre === 'double' ? 4 : 0) | (P0.centre === 'dash-yellow' ? (path ? 24 : 8) : 0);
      const L = [], Rt = [], cols = [], ext = [];
      for (const c of C) {
        const y = c.y + lift;
        L.push([c.x + c.dz * half, y, c.z - c.dx * half]);
        Rt.push([c.x - c.dz * half, y, c.z + c.dx * half]);
        const si = Math.round(c.i), surf = SURF_CODE[e._surf?.[si] || (e._rw ? 'concrete' : 'asphalt')] ?? 0;
        cols.push(surf === 0 || surf === 5 || surf === 6 ? base : surf === 3 ? new THREE.Color('#a7a399') : surf === 4 ? new THREE.Color('#a49c8f') : base);
        ext.push(surf);
      }
      for (let k = 0; k + 1 < n; k++) {
        // ([zwift-look] the paint drawn in the road's own shader — roadLook effect: crisp at any distance, no geometry —
        //  its lines' code in the surface code, × 64, where the paint runs: clear of the junctions, not on brick or setts)
        const pc = spaint && atS(C[k]) >= r0 && atS(C[k + 1]) <= lenM - r1 && ext[k] !== 1 && ext[k] !== 2 ? spaint : 0;
        const uv = (c, x) => [ext[k] + pc * 64, x, c.s, half];
        R.quadX(L[k], Rt[k], Rt[k + 1], L[k + 1], cols[k], [uv(C[k], -half), uv(C[k], half), uv(C[k + 1], half), uv(C[k + 1], -half)]);
      }
      // a trail's gravel or dirt carried out onto the road where it meets one (its end at a junction's mouth)
      if (this.profile.roads === 'worn' && !e._cf) for (const [end, trimmed] of [[0, f0 > a], [n - 1, f1 < b]]) {
        const sf = ext[end]; if (!trimmed || (sf !== 5 && sf !== 6)) continue;
        const c = C[end], dir = end ? 1 : -1;
        t.endSpills.push({ x: c.x, y: c.y + lift, z: c.z, dx: c.dx * dir, dz: c.dz * dir, half, surf: sf, s: c.s });
      }
      // the sides: a deck's slab and parapets; on the ground a curb and sidewalk, or a shoulder down to the ground
      for (let k = 0; k + 1 < n; k++) {
        const c0 = C[k], c1 = C[k + 1], i0 = Math.floor(c0.i), i1 = Math.min(e.n, Math.ceil(c1.i));
        const br = deck[i0] && deck[i1];
        for (const [S, flip, sgn] of [[L, false, 1], [Rt, true, -1]]) {
          const p0 = S[k], p1 = S[k + 1];
          const o0 = [c0.dz * sgn, -c0.dx * sgn], o1 = [c1.dz * sgn, -c1.dx * sgn];   // outward
          const out = (p, o, d, dy) => [p[0] + o[0] * d, p[1] + dy, p[2] + o[1] * d];
          if (br) {
            if (bm && (bm[i0] & 4) && (bm[i1] & 4)) continue;   // (a landmark model's deck: it draws the sides)
            W.wall(p0, p1, -1.0, 0, deckC, flip);
            if (!(bm && (bm[i0] & 2) && (bm[i1] & 2))) W.wall(p0, p1, 0, 0.9, rail, flip);
            continue;
          }
          if (e._cf) {
            // a hero area's singletrack (user: "the bike trail is narrow throughout"): the tread's edge rolls down onto
            // the floor in its own dirt, a hand's width out — no shoulder, no verge, no spill
            const [i0, i1] = [out(p0, o0, 0, -0.01), out(p1, o1, 0, -0.01)], [e0, e1] = [out(p0, o0, 0.2, -0.05), out(p1, o1, 0.2, -0.05)];
            const x = (d) => -sgn * (half + d), u = (cc, d) => [ext[k], x(d), cc.s, half];
            if (sgn > 0) R.quadX(e0, i0, i1, e1, cols[k], [u(c0, .2), u(c0, 0), u(c1, 0), u(c1, .2)]);
            else R.quadX(i0, e0, e1, i1, cols[k], [u(c0, 0), u(c0, .2), u(c1, .2), u(c1, 0)]);
            continue;
          }
          if (walk) {
            W.wall(p0, p1, -0.05, 0.15, curbC, flip);                                                            // the curb's face
            W.quad(out(p0, o0, 0, 0.15), out(p1, o1, 0, 0.15), out(p1, o1, walk, 0.15), out(p0, o0, walk, 0.15), walkC, !flip);   // the sidewalk
            W.quad(out(p0, o0, walk, 0.15), out(p1, o1, walk, 0.15), out(p1, o1, walk, -1.4), out(p0, o0, walk, -1.4), walkSide, flip);
            continue;
          }
          // a shoulder: a gravel edge on a trail, then the verge sloping down to the ground, then a short face
          const band = path ? 0.35 : 0.2;
          // a raised trail (user, 24 Nov: "smooth the hard edge drop off"): a rounded embankment 3–5 m wide down to the
          // ground — its crest curving over, its foot easing in, its width wandering along the trail — in the trail's
          // own surface, the gravel thinning to ground cover down the slope (the shader: _bankJob's codes + 0.5 m)
          if (this.profile.roads === 'worn' && (ext[k] === 5 || ext[k] === 6) && this._trailBank(R, t, p0, p1, o0, o1, c0, c1, sgn, half, ext[k])) { W.wall(p0, p1, -0.6, -0.01, side, flip); continue; }
          if (ext[k] === 5 || ext[k] === 6) {
            // a gravel or dirt way (the towpath): its shoulder in the path's own surface — the same stone dust and
            // tone running down the side, not a green verge (user, 23 Nov: "the side of the towpath should carry the
            // same color and texture of the path")
            const ring = (d, dy) => [out(p0, o0, d, dy), out(p1, o1, d, dy)], x = (d) => -sgn * (half + d);
            const uvs = (d) => [[ext[k], x(d), c0.s, half], [ext[k], x(d), c1.s, half]];
            for (const [d0, y0, d1, y1] of [[0, -0.01, band, -0.06], [band, -0.06, 1.6, -0.9]]) {
              const [i0, i1] = ring(d0, y0), [e0, e1] = ring(d1, y1), [u0, u1] = uvs(d0), [v0, v1] = uvs(d1);
              if (sgn > 0) R.quadX(e0, i0, i1, e1, cols[k], [v0, u0, u1, v1]);
              else R.quadX(i0, e0, e1, i1, cols[k], [u0, v0, v1, u1]);
            }
          } else {
          if (this.profile.edgeFlush) {
            // (NYC: a park path's edge — a narrow stone edging, then the lawn at its level; the slope only where the
            //  ground falls away, under the lawn elsewhere)
            W.quad(out(p0, o0, 0, -0.01), out(p1, o1, 0, -0.01), out(p1, o1, 0.18, -0.02), out(p0, o0, 0.18, -0.02), curbC, !flip);
            W.quad(out(p0, o0, 0.18, -0.02), out(p1, o1, 0.18, -0.02), out(p1, o1, 1.6, -0.9), out(p0, o0, 1.6, -0.9), verge, !flip);
          } else {
          W.quad(out(p0, o0, 0, -0.01), out(p1, o1, 0, -0.01), out(p1, o1, band, -0.06), out(p0, o0, band, -0.06), path ? gravelC : verge, !flip);
          W.quad(out(p0, o0, band, -0.06), out(p1, o1, band, -0.06), out(p1, o1, 1.6, -0.9), out(p0, o0, 1.6, -0.9), verge, !flip);
          }
          }
          // on an embankment, the slope runs on down (1 : 1.5) to meet the ground, then a short face below it
          const toe = (p, o) => { const q = out(p, o, 1.6, -0.9), gy = this.ground ? this._groundH(q[0], q[2]) : q[1] - 2; const drop = Math.max(0, q[1] - 0.2 - gy); const d = Math.min(9, drop * 1.5); return [out(p, o, 1.6 + d, -0.9 - d / 1.5), gy]; };
          const [ta, ga] = toe(p0, o0), [tb, gb] = toe(p1, o1);
          // the spill beyond the shoulder's foot (user, 23 Nov: "texture blending … gravel dust blowing onto a road"):
          // drawn with the tile's ground (_spillJob), draped on it
          if (this.profile.roads === 'worn') t.spills.push({ a: ta, b: tb, o0, o1, s0: c0.s, s1: c1.s, half, sgn, surf: ext[k] === 5 || ext[k] === 6 ? ext[k] : 5 });
          // (over a pad — Bethesda's terrace, cut down below the drive — no embankment: the landmark's wall stands there)
          if (!(this.pads.length && (this._inPad(ta[0], ta[2]) || this._inPad(tb[0], tb[2])))) {
          W.quad(out(p0, o0, 1.6, -0.9), out(p1, o1, 1.6, -0.9), tb, ta, verge, !flip);
          W.quad(ta, tb, [tb[0], Math.min(tb[1], gb) - 1.5, tb[2]], [ta[0], Math.min(ta[1], ga) - 1.5, ta[2]], verge, flip);
          }
          W.wall(p0, p1, -0.6, -0.01, side, flip);
        }
        if (br && !(bm && (bm[i0] & 4) && (bm[i1] & 4))) W.quad([L[k][0], L[k][1] - 1, L[k][2]], [Rt[k][0], Rt[k][1] - 1, Rt[k][2]], [Rt[k + 1][0], Rt[k + 1][1] - 1, Rt[k + 1][2]], [L[k + 1][0], L[k + 1][1] - 1, L[k + 1][2]], under, true);
      }
      // paint, clear of the junctions
      const paint = this._paintOf(e), yellow = new THREE.Color('#e3b53a'), white = new THREE.Color('#f2efe6');
      const line = (off, w, dashM, gapM, color) => {
        for (let k = 0; k + 1 < n; k++) {
          const c0 = C[k], c1 = C[k + 1], s0 = atS(c0), s1 = atS(c1);
          if (s0 < r0 || s1 > lenM - r1) continue;
          if (ext[k] === 1 || ext[k] === 2) continue;   // (no paint on brick or setts)
          if (dashM && (c0.s % (dashM + gapM)) > dashM) continue;
          const A = { x: c0.x - c0.dz * off, y: c0.y + lift + 0.02, z: c0.z + c0.dx * off }, B = { x: c1.x - c1.dz * off, y: c1.y + lift + 0.02, z: c1.z + c1.dx * off };
          P.quad([A.x + c0.dz * w, A.y, A.z - c0.dx * w], [A.x - c0.dz * w, A.y, A.z + c0.dx * w], [B.x - c1.dz * w, B.y, B.z + c1.dx * w], [B.x + c1.dz * w, B.y, B.z - c1.dx * w], color);
        }
      };
      if (paint.centre === 'double' && !(spaint & 4)) { line(-0.18, 0.06, 0, 0, yellow); line(0.18, 0.06, 0, 0, yellow); }
      else if (paint.centre === 'dash-yellow' && !(spaint & 8)) line(0, path ? 0.05 : 0.07, path ? 3 : 3.3, path ? 6 : 6.7, yellow);
      if (paint.edges && !(spaint & 1)) { line(half - 0.35, 0.07, 0, 0, white); line(-(half - 0.35), 0.07, 0, 0, paint.oneway ? yellow : white); }
      if (paint.bikeLane && !(spaint & 2)) { line(-(half - 2.2), 0.1, 0, 0, white); line(-(half - 2.2) - 0.35, 0.1, 0, 0, white); }   // (the bike lane: a double white line 2 m in from the edge)
      if (paint.oneway && paint.lanes >= 2) for (let q = 1; q < paint.lanes; q++) line(-half + (2 * half) * q / paint.lanes, 0.06, 3, 9, white);
    }
    // junctions (_planJunctions): the surface — the mouths joined by the curb returns, a fan from the centre — the
    // sidewalks round the corners (the verges where neither way has one); a crosswalk across each arm just outside its
    // mouth where a main street meets two or more others among the buildings. Two ways meeting: a disc as wide as the
    // narrower, filling the bend's outside; a dead end: rounded.
    const white = new THREE.Color('#ece9de'), asphalt = col('residential');
    // a junction's look: its widest way's colour and surface (at its end there)
    const joinLook = (arms) => { let A = null; for (const a of arms) if (!A || this.wOf(a.e) > this.wOf(A.e)) A = a; if (!A) return null; const e = A.e, i = A.end ? e.n : 0, sf = SURF_CODE[e._surf?.[i] || 'asphalt'] ?? 0; return { color: e._rw ? new THREE.Color('#a9a59c') : sf === 3 ? new THREE.Color('#a7a399') : sf === 4 ? new THREE.Color('#a49c8f') : col(e.kind), surf: sf, path: e.kind === 'path' }; };
    const facing = (a, b, c, d, color, dx, dy, dz, M = W) => {   // a quad whose normal points along (dx, dy, dz)
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      M.quad(a, b, c, d, color, nx * dx + ny * dy + nz * dz < 0);
    };
    for (const nd of t.nodes) {
      if (due()) yield;
      const J = this.jn?.get(nd.id);
      if (!J) {
        const list = this.arms.get(nd.id) || [];
        // (a map that matches its joins — NYC: two ways meeting at a bend joined by a disc as wide as the wider, in its
        //  colour and surface, so the bend's outside has no wedge gap and a paved path no dark patch)
        // (and on any map, a real bend — over 20° — joined as wide as its wider way: the narrower disc left a wedge gap at
        //  the wider way's outside, the map QC's joinGap; PGH's path/primary and primary/residential bends, 25 Nov)
        let bend = false;
        if (list.length === 2) {
          const d = list.map(({ e, end }) => { const k = end ? Math.max(0, e.n - 1) : Math.min(e.n, 1), x0 = end ? e.x[e.n] : e.x[0], z0 = end ? e.z[e.n] : e.z[0], dx = e.x[k] - x0, dz = e.z[k] - z0, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; });
          bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, d[0][0] * d[1][0] + d[0][1] * d[1][1]))) > 0.35;
        }
        const r = list.length ? Math.max(0.5, (list.length >= 3 || bend || this.profile.junctionCurbs ? Math.max : Math.min)(...list.map(({ e }) => this.wOf(e) / 2))) : 3.5;
        const jc = this.profile.junctionCurbs ? joinLook(list) : null;
        if (jc) R.discX(nd.x, nd.y + ROAD_LIFT + (jc.path ? -0.03 : 0) + 0.004, nd.z, r, jc.color, 24, jc.surf);
        else R.discX(nd.x, nd.y + ROAD_LIFT + 0.004, nd.z, r, asphalt, 16);
        continue;
      }
      const jl = this.profile.junctionCurbs ? joinLook(J.arms) : null;
      const P = J.poly, cy = J.y + ROAD_LIFT, RD = [jl ? jl.surf : 0, 0, 0, 40], jcol = jl ? jl.color : asphalt;
      for (let k = 0; k < P.length; k++) {
        const p = P[k], q = P[(k + 1) % P.length];
        R._tri([J.x, cy, J.z], [q.x, q.y + ROAD_LIFT, q.z], [p.x, p.y + ROAD_LIFT, p.z], jcol, RD, RD, RD);
      }
      for (const c of J.corners) {
        const pts = c.curb; if (!pts || pts.length < 2 || c.gap < 0.3) continue;   // (a straight side too: the sidewalk runs on across the mouth of the way opposite)
        // each vertex's outward normal (away from the junction: the polygon is counter-clockwise, its inside on the left)
        const nrm = pts.map((p, k) => {
          let nx = 0, nz = 0;
          for (const [u, v] of [[pts[k - 1], p], [p, pts[k + 1]]]) { if (!u || !v) continue; const dx = v.x - u.x, dz = v.z - u.z, l = Math.hypot(dx, dz) || 1; nx += dz / l; nz += -dx / l; }
          const l = Math.hypot(nx, nz) || 1; return [nx / l, nz / l];
        });
        const wA = c.A.walk, wB = c.B.walk;
        for (let k = 0; k + 1 < pts.length; k++) {
          const p = pts[k], q = pts[k + 1], yp = p.y + ROAD_LIFT, yq = q.y + ROAD_LIFT, [nxp, nzp] = nrm[k], [nxq, nzq] = nrm[k + 1];
          const mdx = q.z - p.z, mdz = -(q.x - p.x);   // (this piece's outward direction)
          if (wA || wB) {
            const w0 = (wA || wB) + ((wB || wA) - (wA || wB)) * k / (pts.length - 1), w1 = (wA || wB) + ((wB || wA) - (wA || wB)) * (k + 1) / (pts.length - 1);
            const i0 = [p.x, yp + 0.15, p.z], i1 = [q.x, yq + 0.15, q.z], o0 = [p.x + nxp * w0, yp + 0.15, p.z + nzp * w0], o1 = [q.x + nxq * w1, yq + 0.15, q.z + nzq * w1];
            facing(i0, i1, o1, o0, walkC, 0, 1, 0);                                                                                         // the sidewalk
            facing([p.x, yp - 0.05, p.z], [q.x, yq - 0.05, q.z], i1, i0, curbC, -mdx, 0, -mdz);                                             // the curb's face
            facing(o0, o1, [o1[0], yq - 1.4, o1[2]], [o0[0], yp - 1.4, o0[2]], walkSide, mdx, 0, mdz);                                       // its outer side
          } else {
            const i0 = [p.x, yp - 0.01, p.z], i1 = [q.x, yq - 0.01, q.z], o0 = [p.x + nxp * 1.6, yp - 0.9, p.z + nzp * 1.6], o1 = [q.x + nxq * 1.6, yq - 0.9, q.z + nzq * 1.6];
            if (this.profile.edgeFlush) facing(i0, i1, [q.x + nxq * .18, yq - .02, q.z + nzq * .18], [p.x + nxp * .18, yp - .02, p.z + nzp * .18], curbC, 0, 1, 0);   // (the stone edging round the corner)
            facing(i0, i1, o1, o0, verge, 0, 1, 0);                                                                                          // the verge
            facing([p.x, yp - 0.6, p.z], [q.x, yq - 0.6, q.z], i1, i0, side, -mdx, 0, -mdz);
          }
        }
      }
      const main = J.arms.filter((A) => A.e.kind !== 'path' && A.e.kind !== 'plaza');
      if (main.length < 3 || !main.some((A) => A.e.kind === 'primary' || A.e.kind === 'secondary' || A.e.kind === 'tertiary') || !main.some((A) => A.walk)) continue;
      for (const A of main) {
        const ux = A.ud.x, uz = A.ud.z, half = A.h, cx = A.cut.x + ux * 1.6, cz = A.cut.z + uz * 1.6, yy = A.cut.y + ROAD_LIFT + 0.035;
        for (let v = -half + 0.4; v < half - 0.3; v += 1.1) {
          const px = cx - uz * v, pz = cz + ux * v, qx = px - uz * 0.55, qz = pz + ux * 0.55;
          facing([px - ux * 1.4, yy, pz - uz * 1.4], [px + ux * 1.4, yy, pz + uz * 1.4], [qx + ux * 1.4, yy, qz + uz * 1.4], [qx - ux * 1.4, yy, qz - uz * 1.4], white, 0, 1, 0, P_);
        }
      }
    }
    t.roadMesh = R.mesh(this.mats.roadSurface);
    if (t.roadMesh) this.group.add(t.roadMesh);
    t.paintMesh = P.mesh(this.mats.paint);
    if (t.paintMesh) this.group.add(t.paintMesh);
    const sm = W.mesh(this.mats.road);
    if (sm) { this.group.add(sm); (t.extraRoad ||= []).push(sm); }
  }

  /** A tile's ground, its river banks and the dressed places in it, as a job (row by row, a shore at a time). */
  *_groundJob(t) {
    const nx = Math.round(TILE / GROUND_CELL), x0 = t.i * TILE, z0 = t.j * TILE, cell = TILE / nx, n1 = nx + 1;
    const pos = new Float32Array(n1 * n1 * 3), color = new Float32Array(n1 * n1 * 3), landW = new Float32Array(n1 * n1);
    const grass = new THREE.Color('#89a868'), dry = new THREE.Color('#a7a27a'), bed = new THREE.Color('#6f6a58'), tmp = new THREE.Color();
    // (Out West's colours calibrated, 27 Nov 2026, against photos of Kanab and the Coral Pink dunes (tools/reference) and
    //  measured reflectance (tools/reference/measured.json): the sand was 2.3× too colourful and 25° too red, the rock 3×
    //  too colourful — sand now ~0.38 albedo, chroma ~24, hue ~65°; the red sandstone ~0.18, chroma ~30, hue ~48°)
    const desert = this.profile.ground === 'desert', sand = new THREE.Color('#d0a27c'), rockA = new THREE.Color('#a8644a'), rockB = new THREE.Color('#c4906a'), white = new THREE.Color('#ddcfb2');
    t.groundRows = true;   // [review 27 Nov] (until the mesh is in: _cutCanal restarts a job caught here)
    for (let j = 0, k = 0; j <= nx; j++) for (let i = 0; i <= nx; i++, k++) {
      if (i === 0 && due()) yield;
      const x = x0 + i * cell, z = z0 + j * cell, h = this._groundH(x, z), pool = this.poolAt(x, z);
      pos[3 * k] = x; pos[3 * k + 1] = h; pos[3 * k + 2] = z;
      const raw = this.ground.at(x, z), cutDepth = Math.max(0, raw - h);
      if (desert) {
        // [out-west] red-rock ground: sand on the flats, sandstone on the slopes, in strata bands by height (the
        // Vermilion, then the White Cliffs higher up), darker in the washes
        const sl = Math.min(1, Math.hypot(this._groundH(x + 6, z) - h, this._groundH(x, z + 6) - h) / 6);
        const band = Math.sin(h * .21 + Math.sin(x * .004 + z * .003) * 2.2) * .5 + .5, high = THREE.MathUtils.smoothstep(h, 1860, 2050);
        tmp.copy(sand).lerp(rockA, THREE.MathUtils.smoothstep(sl, .25, .7)).lerp(rockB, band * .45 * sl).lerp(white, high * (.25 + .35 * sl));   // (the White Cliffs: pale on the faces, the flats still sand)
      } else tmp.copy(h < pool ? bed : grass).lerp(dry, Math.min(1, cutDepth / 6));
      landW[k] = h < pool + 0.2 ? 0 : 1 - Math.min(1, cutDepth / 6) * 0.7;   // (the land cover's colour: not on the river bed, less on a cut)
      const v = 0.94 + 0.06 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(x * 0.007 - z * 0.011);
      color[3 * k] = tmp.r * v; color[3 * k + 1] = tmp.g * v; color[3 * k + 2] = tmp.b * v;
    }
    t.gridH = new Float32Array(n1 * n1); for (let k = 0; k < n1 * n1; k++) t.gridH[k] = pos[3 * k + 1];
    t.gridCell = cell;
    const idx = new Uint32Array(nx * nx * 6);
    for (let j = 0, q = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aLandW', new THREE.BufferAttribute(landW, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    t.groundMesh = new THREE.Mesh(g, this.mats.ground); t.groundRows = false;
    this.group.add(t.groundMesh);
    this._spillPending(t, !!(t.spills?.length || t.endSpills?.length));   // (built when the camera comes near: _stream)
    yield* this._bankJob(t);
    yield* this.effects.tileJob(t);
  }

  /**
   * The blend where a way's surface meets the ground (user, 23 Nov: "where two textures meet … a zone where the two
   * blend together"): a strip 1.5 m out from each shoulder's foot, draped on the ground, in the way's own surface
   * (a trail's gravel or dirt; a road's shoulder gravel) — the shader thins it to scattered grains, its width and
   * strength wandering along the edge (aRd.x + 20: the spill; across past half + 3 m: how far out).
   */
  *_spillJob(t) {
    if (!t.spills?.length && !t.endSpills?.length) return;
    const R = new Mesher(true), white = new THREE.Color(1, 1, 1), STEPS = 3, OUT = 1.5;
    for (let i = 0; i < (t.spills || []).length; i++) {
      if ((i & 63) === 0 && due()) yield;
      const S = t.spills[i], pt = (p, o, f) => { const x = p[0] + o[0] * OUT * f, z = p[2] + o[1] * OUT * f; return [x, Math.max(this.surfaceH(x, z), p[1] - .3) + .03, z]; };
      const rd = (s, f) => [S.surf + 20, -S.sgn * (S.half + 3 + f * OUT), s, S.half];
      for (let j = 0; j < STEPS; j++) {
        const f0 = j / STEPS, f1 = (j + 1) / STEPS;
        const a0 = pt(S.a, S.o0, f0), b0 = pt(S.b, S.o1, f0), a1 = pt(S.a, S.o0, f1), b1 = pt(S.b, S.o1, f1);
        if (S.sgn > 0) R.quadX(a1, a0, b0, b1, white, [rd(S.s0, f1), rd(S.s0, f0), rd(S.s1, f0), rd(S.s1, f1)]);
        else R.quadX(a0, a1, b1, b0, white, [rd(S.s0, f0), rd(S.s0, f1), rd(S.s1, f1), rd(S.s1, f0)]);
      }
    }
    // onto the road at a trail's end: 3 m out over the junction, as wide as the trail
    for (const E of t.endSpills || []) {
      const OUTE = 3, nx = E.dz, nz = -E.dx, p = (u, f) => [E.x + nx * u + E.dx * OUTE * f, E.y + .012, E.z + nz * u + E.dz * OUTE * f];
      const rd = (f) => [E.surf + 20, E.half + 3 + f * 1.5, E.s + f * OUTE, E.half];
      for (let j = 0; j < STEPS; j++) {
        const f0 = j / STEPS, f1 = (j + 1) / STEPS, w = E.half + .4;
        R.quadX(p(-w, f0), p(w, f0), p(w, f1), p(-w, f1), white, [rd(f0), rd(f0), rd(f1), rd(f1)]);
      }
    }
    const m = R.mesh(this.mats.spill);
    if (m) { t.spillMesh = m; this._spilled.add(t); this._spillDirty = true; }   // (drawn merged with the other near tiles': _mergeSpill)
  }

  /**
   * A raised trail's side as a rounded embankment (see the call): rings out from the trail's edge to a foot 3–5 m out
   * (wandering along the trail), each ring's height eased from the crest down to the ground there. Returns false where
   * the trail isn't above the ground beside it (it keeps its short shoulder), or the canal's at its side.
   */
  _trailBank(R, t, p0, p1, o0, o1, c0, c1, sgn, half, surf) {
    const width = (s) => 3 + 2 * (.5 + .5 * Math.sin(s * .043 + 1.3) * Math.cos(s * .017 + .4));
    const w0 = width(c0.s), w1 = width(c1.s);
    const at = (p, o, d) => [p[0] + o[0] * d, p[2] + o[1] * d];
    const gA = this._groundH(...at(p0, o0, w0)), gB = this._groundH(...at(p1, o1, w1));
    const dropA = p0[1] - gA, dropB = p1[1] - gB;
    if (Math.max(dropA, dropB) < .35) return false;
    for (const [p, o, w] of [[p0, o0, w0], [p1, o1, w1]]) { const [x, z] = at(p, o, w * .6); const c = canalAt(x, z, 1); if (c && !c.creek) return false; }
    // the ground cover at the foot: woods (litter, roots) or open grass — the colour the slope's lower part takes
    const lc = this.city?.landAt?.(...at(p0, o0, w0 + 1));
    const woods = lc === 2, cover = woods ? new THREE.Color('#54432e') : this.profile.ground === 'desert' ? new THREE.Color('#a8734c') : new THREE.Color('#5d7539');   // (desert: red sand, not grass)
    const RINGS = [0, .08, .2, .36, .55, .74, .9, 1];
    const ring = (p, o, w, g, f) => {
      // the profile: a smootherstep from the crest to the ground (convex at the top, concave at the foot)
      const e = f * f * f * (f * (f * 6 - 15) + 10), d = w * f, [x, z] = at(p, o, d);
      const y = Math.max(p[1] + (g - p[1]) * e, this._groundH(x, z) + .02 * (1 - f)) - (f === 0 ? .01 : 0);
      return [x, f === 1 ? Math.min(y, this._groundH(x, z) - .02) : y, z];
    };
    for (let j = 0; j + 1 < RINGS.length; j++) {
      const fa = RINGS[j], fb = RINGS[j + 1];
      const a0 = ring(p0, o0, w0, gA, fa), a1 = ring(p1, o1, w1, gB, fa), b0 = ring(p0, o0, w0, gA, fb), b1 = ring(p1, o1, w1, gB, fb);
      // aRd: the surface + .5 (a bank: the shader's code), across (m past the edge, signed as the trail's), along, half (+ 100 under woods)
      const rd = (c, f, w) => [surf + .5, -sgn * (half + f * w), c.s, half + (woods ? 100 : 0)];
      if (sgn > 0) R.quadX(b0, a0, a1, b1, cover, [rd(c0, fb, w0), rd(c0, fa, w0), rd(c1, fa, w1), rd(c1, fb, w1)]);
      else R.quadX(a0, b0, b1, a1, cover, [rd(c0, fa, w0), rd(c0, fb, w0), rd(c1, fb, w1), rd(c1, fa, w1)]);
    }
    return true;
  }

  /** The near tiles' spill strips as one mesh (one draw call, not one a tile), rebuilt when the set changes. */
  _mergeSpill() {
    this._spillDirty = false;
    const parts = [...this._spilled].map((t) => t.spillMesh?.geometry).filter(Boolean);
    if (this.spillAll) { this.group.remove(this.spillAll); this.spillAll.geometry.dispose(); this.spillAll = null; }
    if (!parts.length) return;
    const g = new THREE.BufferGeometry(), drop = function () { if (!globalThis.BF_KEEP_GEOMETRY) this.array = null; };
    for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aRd', 4]]) {
      const n = parts.reduce((a, p) => a + p.attributes[name].array.length, 0), out = new Float32Array(n);
      let o = 0; for (const p of parts) { out.set(p.attributes[name].array, o); o += p.attributes[name].array.length; }
      const attr = new THREE.BufferAttribute(out, size); attr.onUpload(drop); g.setAttribute(name, attr);
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, this.mats.spill); m.name = 'Spill'; m.receiveShadow = true; m.frustumCulled = false;
    this.spillAll = m; this.group.add(m);
  }

  /** The dressed places' ground in this tile (toolbox/materials/park-surfaces.js): lawns, beds, woods, plazas and walks
   *  draped on the ground; the fountain and pools; retaining walls and low walls in dressed stone; the trees. */
  *_dressingJob(t) {
    const D = this.dressing, key = `${t.i},${t.j}`;
    const areas = D.areas.get(key) || [], lines = D.lines.get(key) || [], trees = D.trees.get(key) || [];
    if (!areas.length && !lines.length && !trees.length) return;
    const by = new Map(), grey = new THREE.Color('#ffffff');
    const mesher = (k) => { if (!by.has(k)) by.set(k, new Mesher()); return by.get(k); };
    // the surface here: the ground, or a walled bank's promenade over it
    // the ground as its mesh draws it (surfaceH: the 12.8 m grid's triangles), so a drape lies on it everywhere
    // ([review 27 Nov] W15: was a private copy of surfaceH, line for line)
    const surf = (x, z) => { const h = Math.max(this._groundH(x, z), this.surfaceH(x, z)), sh = this.shore?.at(x, z); return sh && sh.walled && sh.s >= 0 && sh.s <= BANK_CAP ? Math.max(h, sh.top + 0.03) : h; };
    const under = (x, z, y) => Math.min(y, this.cut.cap(x, z) + 0.2);   // (never over a road: its surface is ≥ 0.35 m over its cut)
    const drape = (M, tri, lift) => {
      const split = (a, b, c, depth) => {
        const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), bc = Math.hypot(b[0] - c[0], b[1] - c[1]), ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const m = Math.max(ab, bc, ca);
        if (m <= 4 || depth > 9) { const v = (p) => [p[0], under(p[0], p[1], surf(p[0], p[1]) + lift), p[1]]; M._tri(v(a), v(c), v(b), grey); return; }
        if (m === ab) { const d = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; split(a, d, c, depth + 1); split(d, b, c, depth + 1); }
        else if (m === bc) { const d = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; split(a, b, d, depth + 1); split(a, d, c, depth + 1); }
        else { const d = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; split(a, b, d, depth + 1); split(d, b, c, depth + 1); }
      };
      split(tri[0], tri[1], tri[2], 0);
    };
    const LIFT = { park: 0.22, wood: 0.25, scrub: 0.25, lawn: 0.28, fairway: 0.3, green: 0.32, sand: 0.32, garden: 0.31, plaza: 0.34 };   // (over the 12.8 m ground mesh's facets)
    for (const A of areas) {
      if (due()) yield;
      if (A.kind === 'fountain' || A.kind === 'pool') {
        // a basin: water a little under its granite rim, the rim a low dressed-stone kerb round it
        const h = Math.max(...A.pts.map(([x, z]) => surf(x, z))) + 0.2;   // (over the lawns draped round it)
        for (const tri of A.tris) mesher('water')._tri(...tri.map((p) => [p[0], h + 0.25, p[1]]).reverse(), grey);
        const R = mesher('rim'), F = mesher('rimFace');
        for (let i = 0; i + 1 < A.pts.length; i++) {
          const [p, q] = [A.pts[i], A.pts[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * A.wind, nz = dx / l * A.wind;
          const yi = h + 0.55, o = (pt, s) => [pt[0] + nx * s, yi, pt[1] + nz * s];
          R.quad(o(p, 0), o(q, 0), o(q, 1.4), o(p, 1.4), grey);
          F.quad([p[0], h - 0.2, p[1]], [q[0], h - 0.2, q[1]], [q[0], yi, q[1]], [p[0], yi, p[1]], grey);
        }
        if (A.kind === 'fountain') {   // the Point's jet: up to ~45 m on a summer day
          const [cx, cz] = A.centre, sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.2, 40, 14, 1, true), this.mats.spray);
          sp.position.set(cx, h + 20, cz); (t.extra ||= []).push(sp); this.group.add(sp);
        }
        continue;
      }
      const mat = A.kind === 'park' ? 'lawn' : A.kind;
      for (const tri of A.tris) { drape(mesher(mat), tri, LIFT[A.kind] ?? 0.06); if (due()) yield; }
    }
    for (const Ln of lines) {
      if (due()) yield;
      const P = Ln.pts;
      if (Ln.kind === 'walk' || Ln.kind === 'steps') {
        const half = Ln.width / 2, M = mesher(Ln.kind === 'steps' ? 'granite' : 'walk');
        for (let i = 0; i + 1 < P.length; i++) {
          const [p, q] = [P[i], P[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * half, nz = dx / l * half;
          drape(M, [[p[0] + nx, p[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz]], 0.38);
          drape(M, [[p[0] + nx, p[1] + nz], [q[0] - nx, q[1] - nz], [p[0] - nx, p[1] - nz]], 0.38);
        }
      } else {
        // a retaining wall from the low side's ground to a 0.4 m parapet over the high side; a low wall 0.9 m
        const W = mesher('wall');
        for (let i = 0; i + 1 < P.length; i++) {
          const [p, q] = [P[i], P[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
          if (l < 0.3) continue;
          const nx = -dz / l, nz = dx / l, side = (pt, s) => surf(pt[0] + nx * s, pt[1] + nz * s);
          const lowP = Math.min(side(p, 2.5), side(p, -2.5)), lowQ = Math.min(side(q, 2.5), side(q, -2.5));
          const topP = Ln.kind === 'wall' ? surf(p[0], p[1]) + 0.9 : Math.max(side(p, 2.5), side(p, -2.5)) + 0.4;
          const topQ = Ln.kind === 'wall' ? surf(q[0], q[1]) + 0.9 : Math.max(side(q, 2.5), side(q, -2.5)) + 0.4;
          const th = 0.2;
          for (const s of [th, -th]) W.quad([p[0] + nx * s, lowP - 0.2, p[1] + nz * s], [q[0] + nx * s, lowQ - 0.2, q[1] + nz * s], [q[0] + nx * s, topQ, q[1] + nz * s], [p[0] + nx * s, topP, p[1] + nz * s], grey);
          W.quad([p[0] + nx * th, topP, p[1] + nz * th], [q[0] + nx * th, topQ, q[1] + nz * th], [q[0] - nx * th, topQ, q[1] - nz * th], [p[0] - nx * th, topP, p[1] - nz * th], grey);
        }
      }
    }
    const mats = { water: this.mats.fountainWater, rim: this.mats.park.granite, rimFace: this.mats.parkWall, wall: this.mats.parkWall };
    for (const [k, M] of by) {
      const m = M.mesh(mats[k] || this.mats.park[k]);
      if (!m) continue;
      if (this.mats.park[k] && k !== 'granite' || k === 'water') { const n = m.geometry.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); }   // (draped: lit as the flat ground it lies on, not facet by facet)
      (t.extra ||= []).push(m); this.group.add(m);
    }
    const forest = this.city?.forest, kitSp = forest?.kit?.species || this.city?.treeKit?.species;
    if (trees.length && forest && kitSp && (kitSp.plane || kitSp.redoak)) {
      // (user, 26 Nov — one tree look: the faceted ball trees beside the clumped crowns) the park's trees grown by the
      // tree engine like every other tree on the map: London planes, red oaks and lindens (basswood), by seed
      const pick = ['plane', 'redoak', 'basswood', 'plane'].filter((n) => kitSp[n]);
      const key = `park:${Math.round(trees[0][0])}:${Math.round(trees[0][1])}:${trees.length}`;
      forest.setTile(key, trees.map(([x, z]) => {
        const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1, sp = pick[Math.floor(r * pick.length) % pick.length];
        return { x, y: this._groundH(x, z) - .1, z, sp, v: Math.floor(r * 7) % (kitSp[sp].variants?.length || 1), s: .45 + r * .3, rot: r * 6.28 };
      }));
      const handle = new THREE.Object3D(); handle.name = 'Park trees (tree engine)'; handle.geometry = { dispose: () => forest.removeTile(key) };
      (t.extra ||= []).push(handle);
    } else if (trees.length) {
      // the park's trees: a trunk and a broad crown each (the Point's planes, oaks and lindens), sized and tinted by seed
      const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0), crownG = new THREE.IcosahedronGeometry(1, 1);
      const T1 = new THREE.InstancedMesh(trunkG, this.mats.trunk, trees.length), T2 = new THREE.InstancedMesh(crownG, this.mats.crown, trees.length);
      const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), c = new THREE.Color();
      trees.forEach(([x, z], k) => {
        const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1, h = this._groundH(x, z), H = 5 + r * 5, R = 3 + r * 2.5;
        m4.compose(new THREE.Vector3(x, h, z), q4, new THREE.Vector3(1, H * 0.55, 1)); T1.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(x, h + H * 0.55 + R * 0.7, z), q4.setFromAxisAngle(UP, r * 6), new THREE.Vector3(R, R * 0.85, R)); T2.setMatrixAt(k, m4);
        T2.setColorAt(k, c.set('#4f7a35').offsetHSL((r - 0.5) * 0.04, 0, (r - 0.5) * 0.12));
      });
      for (const m of [T1, T2]) { (t.extra ||= []).push(m); this.group.add(m); }
    }
  }

  /** The riverbank along the shore lines in this tile: a stone face and a promenade where walled, a firm slope elsewhere. */
  *_bankJob(t) {
    const x0 = t.i * TILE, z0 = t.j * TILE, M = new Mesher(), Face = new Mesher(), Prom = new Mesher(), Rail = M, iron = new THREE.Color('#202325');
    const grass = new THREE.Color('#89a868'), stone = new THREE.Color('#8f8a80'), bed = new THREE.Color('#6f6a58');
    const capY = (x, z, y) => Math.min(y, this.cut.cap(x, z) + 0.12);   // (under a road's cut: just over the ground there, under the road)
    for (const L of this.shore ? this.shore.lines : []) {
      const pool = L.pool, waterY = pool + WATER_ABOVE;
      for (let i = 0; i + 1 < L.n; i++) {
        if ((i & 63) === 0 && due()) yield;
        const mx = (L.x[i] + L.x[i + 1]) / 2, mz = (L.z[i] + L.z[i + 1]) / 2;
        if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue;
        const row = (k, s, y) => { const x = L.x[k] + L.nx[k] * s, z = L.z[k] + L.nz[k] * s; return [x, capY(x, z, y), z]; };
        if (L.walled[i] && L.walled[i + 1]) {
          const a = [L.x[i], pool - 4, L.z[i]], b = [L.x[i + 1], pool - 4, L.z[i + 1]];
          const ta = row(i, 0, L.top[i] + 0.03), tb = row(i + 1, 0, L.top[i + 1] + 0.03);
          Face.quad(a, b, tb, ta, stone);                                            // the wall's face (dressed stone)
          const pa = row(i, PROM_M, L.top[i] + 0.03), pb = row(i + 1, PROM_M, L.top[i + 1] + 0.03);
          Prom.quad(ta, tb, pb, pa, stone);                                          // the promenade's paving along the wall
          // the railing on the wall's edge: black iron, posts every 2.4 m, top and bottom rails, pickets
          {
            const ra = row(i, 0.25, L.top[i] + 0.03), rb = row(i + 1, 0.25, L.top[i + 1] + 0.03), seg = Math.hypot(rb[0] - ra[0], rb[2] - ra[2]);
            const at = (f, dy) => [ra[0] + (rb[0] - ra[0]) * f, ra[1] + (rb[1] - ra[1]) * f + dy, ra[2] + (rb[2] - ra[2]) * f];
            Rail.wall(at(0, 0), at(1, 0), 1.02, 1.1, iron, false); Rail.wall(at(0, 0), at(1, 0), 0.08, 0.14, iron, false);
            const np = Math.max(1, Math.round(seg / 0.32));
            for (let q = 0; q < np; q++) { const f0 = q / np, f1 = f0 + 0.04 / Math.max(seg, 0.1); Rail.quad(at(f0, 0.08), at(f1, 0.08), at(f1, 1.05), at(f0, 1.05), iron); }
            const nPost = Math.max(1, Math.round(seg / 2.4));
            for (let q = 0; q < nPost; q++) { const f0 = q / nPost, f1 = f0 + 0.09 / Math.max(seg, 0.1); Rail.quad(at(f0, 0), at(f1, 0), at(f1, 1.18), at(f0, 1.18), iron); }
          }
          if (!this.dressing?.inside(mx, mz)) M.quad(pa, pb, row(i + 1, BANK_CAP, L.top[i + 1] + 0.03), row(i, BANK_CAP, L.top[i] + 0.03), grass);   // then grass (a dressed place has its own)
        } else {
          const S = [-4, 0, 5, BANK_SLOPE];
          for (let q = 0; q + 1 < S.length; q++) {
            const y = (k, s) => bankProfile(s, L.top[k], waterY, pool) + 0.03;
            M.quad(row(i, S[q], y(i, S[q])), row(i + 1, S[q], y(i + 1, S[q])), row(i + 1, S[q + 1], y(i + 1, S[q + 1])), row(i, S[q + 1], y(i, S[q + 1])), q === 0 ? bed : grass);
          }
        }
      }
    }
    // bridge piers: under every deck that stands over a hollow or the water, one every PIER_M (not within 20 m of the
    // deck's ends — the abutments hold those), a slab as wide as the road, from the deck's underside to the ground
    const pier = new THREE.Color('#9a968c');
    for (const { e, a, b } of t.pieces) {
      if (!e.bridges.length) continue;
      const { deck, toEnd } = deckSpans(e);
      const half = this.wOf(e) / 2 - 0.4, pm = this.bridgeMask?.get(e.id) || this.modelDecks?.get(e.id);
      for (let i = Math.max(a, 1); i <= Math.min(b, e.n - 1); i++) {
        if (!deck[i] || toEnd[i] < 20 || i % PIER_STEP) continue;
        if (pm && pm[i] & 1) continue;   // a bridge model stands here (its own piers)
        const gy = this._groundH(e.x[i], e.z[i]), top = e.ele[i] - 1.0;
        if (top - gy < 3) continue;   // (low over the ground: the fill and the abutments are enough)
        let dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = -dz, nz = dx, t2 = 0.9, bot = Math.min(gy, this.poolAt(e.x[i], e.z[i]) - 1) - 0.5;
        const c = (u, v, y) => [e.x[i] + dx * u + nx * v, y, e.z[i] + dz * u + nz * v];
        for (const [u0, v0, u1, v1] of [[-t2, -half, t2, -half], [t2, -half, t2, half], [t2, half, -t2, half], [-t2, half, -t2, -half]])
          M.quad(c(u0, v0, bot), c(u1, v1, bot), c(u1, v1, top), c(u0, v0, top), pier);
      }
    }
    t.bankMesh = M.mesh(this.mats.road);
    if (t.bankMesh) this.group.add(t.bankMesh);
    t.extra = [Face.mesh(this.mats.riverWall), Prom.mesh(this.mats.promenade)].filter(Boolean);   // (the railings: in the bank's mesh, the same material)
    for (const m of t.extra) this.group.add(m);
    if (this.dressing) yield* this._dressingJob(t);
  }
}

/** Put the tile jobs on a world class's prototype (as its own methods: non-enumerable, like a class's). */
export function installTileJobs(World) {
  for (const k of Object.getOwnPropertyNames(GraphTileBuilder.prototype)) if (k !== 'constructor') Object.defineProperty(World.prototype, k, Object.getOwnPropertyDescriptor(GraphTileBuilder.prototype, k));
}
