// PGH's bridges, each in its own structure (user, 21 Nov: "work on all bridge models; ensure the 3 sister bridges are
// high quality"). tools/pgh_bridges.mjs lists them (name, structure, paint, OSM centreline); this builds them in the graph
// world:
//   - a bridge PGH rides (the Three Sisters, West End, Birmingham, 40th Street, Glenwood, Homestead Grays, the Hot
//     Metal trail span…) is built round the ridden deck: the road is the world's, the model is everything else —
//     girders, sidewalks, railings, the structure, the piers;
//   - the others (Smithfield, Fort Pitt, Fort Duquesne, Liberty, 10th Street, McCullough, Veterans…: PGH rides none of
//     their roadways, at most a walkway beside one) are scenery, whole, on their OSM line, at the height of any
//     ridden deck beside them, else clear of the river.
// The world then leaves out its own plain slab piers (and the parapets of the ridden roadways) where a model stands.
//
// The Three Sisters (Sixth, Seventh, Ninth Street; 1926–28) are modelled from their real form: self-anchored eyebar
// suspension bridges of three spans (68.5 + 131 + 68.5 m on the Clemente) — the eyebar chains, pinned at every panel
// point, run from the girder ends over the four towers; vertical eyebar hangers; the deep riveted stiffening
// girders that take the chains' pull, with their web stiffeners; floor beams and lateral bracing under the deck;
// sidewalks cantilevered outside the girders on brackets, with lattice railings and lamp standards; the towers with
// their banded shafts, chain saddles and finials; dressed-stone river piers with cutwaters and granite copings;
// all in Aztec Gold.
//
//   const b = buildGraphBridges(world, json) → { group, glows: [{x, y, z, size, color}], mask: Map(edgeId → Uint8Array), count }
//   mask bits: 1 = no generic piers, 2 = no parapet (the model has the railings).
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder, resample, makePath } from './toolbox/core/mesh-builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STONE = '#b7ab95', STONE_DARK = '#7f776b', GRANITE = '#cdc5b4', CONCRETE = '#a8a397', ASPHALT = '#4a4a4d', WALK = '#b9b3a7', BRONZE = '#6b5a3c';
const shade = (c, f) => new THREE.Color(c).multiplyScalar(f);

export function buildGraphBridges(world, json) {
  const M = new MeshBuilder();
  const glows = [], mask = new Map(), proj = world.proj;
  const G = world.G, edges = G.edges;
  const groundH = (x, z) => world._groundH(x, z), pool = (x, z) => world.poolAt(x, z);

  // every graph sample on a 20 m grid (for: ridden decks to take heights from; ways a pier must keep off; clearance)
  const grid = new Map(), gk = (x, z) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
  for (const e of edges) {
    const deck = new Uint8Array(e.n + 1);
    for (const [a, b] of e.bridges) for (let i = a + 1; i < b; i++) deck[i] = 1;
    e._deck = deck;
    for (let i = 0; i <= e.n; i++) { const k = gk(e.x[i], e.z[i]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push({ e, i }); }
  }
  const near = (x, z, r) => {
    const out = [];
    for (let i = Math.floor((x - r) / 20); i <= Math.floor((x + r) / 20); i++) for (let j = Math.floor((z - r) / 20); j <= Math.floor((z + r) / 20); j++) {
      for (const s of grid.get(`${i},${j}`) || []) if (Math.hypot(s.e.x[s.i] - x, s.e.z[s.i] - z) < r) out.push(s);
    }
    return out;
  };
  const halfOf = (e) => (world.widths[e.kind] || 7) / 2;
  /** Is a way (not the bridge's own deck: `own` edges) within r of (x, z) at the ground there (a pier would stand on it)? */
  const wayAt = (x, z, r, own, yTop) => near(x, z, r + 6).some(({ e, i }) => !own.has(e.id) && e.ele[i] < yTop - 3 && Math.hypot(e.x[i] - x, e.z[i] - z) < r + halfOf(e) + 1);
  const markMask = (e, i, bits) => { let m = mask.get(e.id); if (!m) mask.set(e.id, (m = new Uint8Array(e.n + 1))); m[i] |= bits; };


  function build(b) {
    const names = new Set([b.name, ...(b.alias || [])]);
    // the spine: the ridden deck where PGH rides this bridge's roadway (or the whole of a footbridge), else OSM's line
    const ownRuns = [];
    for (const e of edges) if (names.has(e.name) && e.bridges.length) for (const [a, z] of e.bridges) ownRuns.push({ e, a, z, L: (z - a) * 10 });
    ownRuns.sort((p, q) => q.L - p.L);
    const osm = b.path.map(([la, lo]) => proj.toLocal(la, lo));
    let pts, ridden = null, own = new Set();
    const riddenRoad = ownRuns.find((r) => r.e.kind !== 'path' || b.width <= 6);
    if (riddenRoad && osm.length >= 2) {
      // the run nearest OSM's line (40th Street: the river run, not its rail viaduct)
      const mid = osm[Math.floor(osm.length / 2)];
      let best = null;
      for (const r of ownRuns.filter((q) => q.e.kind === riddenRoad.e.kind)) { const m = (r.a + r.z) >> 1, d = Math.hypot(r.e.x[m] - mid.x, r.e.z[m] - mid.z); if (!best || d < best.d) best = { r, d }; }
      ridden = best.r;
      pts = []; for (let i = ridden.a; i <= ridden.z; i++) pts.push({ x: ridden.e.x[i], y: ridden.e.ele[i], z: ridden.e.z[i] });
      own.add(ridden.e.id);
    } else {
      pts = osm.map((q) => ({ x: q.x, y: NaN, z: q.z }));
    }
    for (const r of ownRuns) own.add(r.e.id);
    let path = makePath(resample(pts, 4));
    const N = Math.max(2, Math.round(path.length / 4));
    const S = Array.from({ length: N + 1 }, (_, k) => k / N * path.length);
    const at = (s) => { const p = path.at(s); const f = V(p.dx, 0, p.dz).normalize(); return { p: V(p.x, p.y, p.z), f, r: V(-f.z, 0, f.x) }; };

    // scenery: heights from any ridden deck beside it (a walkway on it), else from its ends' ground and clear of the river
    const beside = [];
    if (!ridden) {
      const ys = S.map((s) => {
        const { p, r } = at(s);
        let best = null;
        for (const { e, i } of near(p.x, p.z, 26)) {
          if (!e._deck[i]) continue;
          const dx = e.x[i] - p.x, dz = e.z[i] - p.z, v = dx * r.x + dz * r.z, u = dx * r.z * 0 + (dx * -r.z + dz * r.x);
          if (Math.abs(u) > 6) continue;
          // along the spine (not crossing under it)
          const i0 = Math.max(0, i - 1), i1 = Math.min(e.n, i + 1), ex = e.x[i1] - e.x[i0], ez = e.z[i1] - e.z[i0], el = Math.hypot(ex, ez) || 1;
          if (Math.abs((ex * r.z * -1 + ez * r.x) / el) < 0.85) continue;
          if (!best || Math.abs(v) < Math.abs(best.v)) best = { v, y: e.ele[i], e };
        }
        if (best) { beside.push(best); own.add(best.e.id); }
        return best ? best.y : NaN;
      });
      const g0 = groundH(path.pts[0].x, path.pts[0].z), g1 = groundH(path.pts.at(-1).x, path.pts.at(-1).z);
      const clear = b.rail ? 14 : 12;
      for (let k = 0; k <= N; k++) {
        if (!Number.isNaN(ys[k])) continue;
        // between the nearest known heights, else the ends' ground
        let a = k, z = k; while (a >= 0 && Number.isNaN(ys[a])) a--; while (z <= N && Number.isNaN(ys[z])) z++;
        const ya = a >= 0 ? ys[a] : g0, yz = z <= N ? ys[z] : g1, sa = a >= 0 ? S[a] : 0, sz = z <= N ? S[z] : path.length;
        let y = ya + (yz - ya) * (S[k] - sa) / ((sz - sa) || 1);
        const { p } = at(S[k]);
        if (pool(p.x, p.z) > groundH(p.x, p.z)) y = Math.max(y, pool(p.x, p.z) + clear);
        ys[k] = y;
      }
      // clear of the ways under it (not its own walkway)
      for (let k = 0; k <= N; k++) {
        const { p } = at(S[k]);
        for (const { e, i } of near(p.x, p.z, b.width / 2 + 4)) if (!own.has(e.id) && !e._deck[i] && e.ele[i] > ys[k] - 9 && e.ele[i] < ys[k] + 1) ys[k] = Math.max(ys[k], e.ele[i] + 6.5);
      }
      // a smooth profile (a vertical curve, not steps)
      for (let pass = 0; pass < 6; pass++) for (let k = 1; k < N; k++) ys[k] = (ys[k - 1] + 2 * ys[k] + ys[k + 1]) / 4;
      path = makePath(S.map((s, k) => { const p = path.at(s); return { x: p.x, y: ys[k], z: p.z }; }));
    }
    const len = path.length;

    // the river under it: the longest wet stretch (gaps under 12 m bridged); a ravine: where it stands over 10 m up
    let w0 = null, w1 = null;
    {
      let run = null, best = null, gap = 0;
      for (let s = 0; s <= len; s += 4) {
        const { p } = at(s), wet = pool(p.x, p.z) - groundH(p.x, p.z) > 0.5;
        if (wet) { if (!run) run = [s, s]; run[1] = s; gap = 0; }
        else if (run && (gap += 4) > 12) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; gap = 0; }
      }
      if (run && (!best || run[1] - run[0] > best[1] - best[0])) best = run;
      if (best && best[1] - best[0] > 30) [w0, w1] = best;
      else {
        for (let s = 0; s <= len; s += 4) { const { p } = at(s); if (p.y - groundH(p.x, p.z) > 10) { if (w0 === null) w0 = s; w1 = s; } }
        if (w0 === null) { w0 = len * 0.2; w1 = len * 0.8; }
      }
    }
    const bedAt = (p) => Math.min(groundH(p.x, p.z), pool(p.x, p.z) - 5);

    // the roadway's half width: the world's road for a ridden one, else the bridge's own
    const hw = ridden ? halfOf(ridden.e) : b.width / 2;
    const ctx = { b, at, len, w0, w1, hw, ridden, own, beside, bedAt, path };
    // the structure's planes either side: outside the roadway, and not through a ridden walkway beside it
    ctx.plane = (want) => {
      let L = want, R = want;
      for (const sd of beside) {
        const half = halfOf(sd.e), inner = Math.abs(sd.v) - half - 0.9, outer = Math.abs(sd.v) + half + 1.0;
        const pick = inner >= hw + 0.4 ? inner : outer;
        if (sd.v > 0) R = Math.abs(sd.v) - half < want + 0.8 ? pick : R; else L = Math.abs(sd.v) - half < want + 0.8 ? pick : L;
      }
      return { L: -L, R };
    };

    const S0 = STYLES[b.style] || STYLES.girder;
    const extent = S0(ctx);
    // the world leaves out its plain piers (and a ridden road's parapets) where the model stands
    const [e0, e1] = extent || [0, len];
    for (const id of own) {
      const e = G.byId.get(id); if (!e) continue;
      for (let i = 0; i <= e.n; i++) {
        if (!e._deck[i] && !(ridden && e === ridden.e && i >= ridden.a && i <= ridden.z)) continue;
        // where along the spine is this sample?
        let bestS = -1, bd = Infinity;
        for (let k = 0; k <= N; k += 2) { const p = path.at(S[k]); const d = Math.hypot(p.x - e.x[i], p.z - e.z[i]); if (d < bd) { bd = d; bestS = S[k]; } }
        if (bd > b.width / 2 + 20 || bestS < e0 - 12 || bestS > e1 + 12) continue;
        markMask(e, i, 1 | (ridden && e === ridden.e && e.kind !== 'path' ? 2 : 0));
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- the sweep: a cross-section along the spine
  /**
   * Extrude a closed cross-section along the spine from s0 to s1. prof(s) → [[v, dy], …] counter-clockwise seen looking
   * along the spine (v to the right, dy up from the road). color: one, or (k) → colour per face. caps: close the ends.
   */
  function sweep(c, s0, s1, prof, color, { step = 4, caps = true, open = false } = {}) {
    if (s1 - s0 < 0.2) return;
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    let prev = null, first = null;
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n, { p, r } = c.at(s);
      const sec = prof(s).map(([v, dy]) => p.clone().addScaledVector(r, v).setY(p.y + dy));
      if (prev) {
        const m = sec.length;
        for (let j = 0; j < (open ? m - 1 : m); j++) {
          const j1 = (j + 1) % m;
          M.color(typeof color === 'function' ? color(j) : color);
          M.quad(prev[j], sec[j], sec[j1], prev[j1]);
        }
      } else first = sec;
      prev = sec;
    }
    if (caps && !open) {
      M.color(typeof color === 'function' ? color(0) : color);
      for (const [sec, flip] of [[first, true], [prev, false]]) for (let j = 1; j + 1 < sec.length; j++) flip ? M.triangle(sec[0], sec[j + 1], sec[j]) : M.triangle(sec[0], sec[j], sec[j + 1]);
    }
  }
  const rect = (v0, v1, y0, y1) => () => [[v0, y0], [v1, y0], [v1, y1], [v0, y1]];
  /** A point on the spine at s, v to the right, dy up from the road there. */
  const P = (c, s, v, dy = 0) => { const { p, r } = c.at(s); return p.addScaledVector(r, v).setY(p.y + dy); };
  /** A box standing at (s, v): `al` along the spine, `ac` across, from dy0 to dy1. */
  const post = (c, s, v, al, ac, dy0, dy1, color) => {
    const { p, r, f } = c.at(s), q = p.clone().addScaledVector(r, v);
    M.color(color); M.box(q.x, p.y + dy0, q.z, ac, dy1 - dy0, al, Math.atan2(f.x, f.z));
  };
  /** A box standing at (s, v) from absolute y0 to y1. */
  const postAbs = (c, s, v, al, ac, y0, y1, color) => {
    const { p, r, f } = c.at(s), q = p.clone().addScaledVector(r, v);
    M.color(color); M.box(q.x, y0, q.z, ac, y1 - y0, al, Math.atan2(f.x, f.z));
  };
  const beam = (a, b, w, h, color) => { M.color(color); M.beam(a, b, w, h); };
  /** A tapered shaft at (s, v): along × across at the foot (y0) and at the head (y1), absolute heights. */
  const shaft = (c, s, v, y0, y1, al0, ac0, al1, ac1, color) => {
    const { p, r, f } = c.at(s), q = p.clone().addScaledVector(r, v);
    const corner = (al, ac, y, i, j) => V(q.x + f.x * al / 2 * i + r.x * ac / 2 * j, y, q.z + f.z * al / 2 * i + r.z * ac / 2 * j);
    const B = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => corner(al0, ac0, y0, i, j));
    const T = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => corner(al1, ac1, y1, i, j));
    M.color(color);
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; M.quad(B[k], B[k1], T[k1], T[k]); }
    M.quad(T[3], T[2], T[1], T[0]);
  };
  /** A river pier across the bridge at s: dressed stone (or concrete), cutwaters at both ends, a coping on top. */
  function pier(c, s, vL, vR, yTop, { al = 6, stone = true, cut = 3.5, coping = true } = {}) {
    const { p, r, f } = c.at(s), bed = c.bedAt(p), wet = pool(p.x, p.z) > groundH(p.x, p.z);
    if (yTop - bed < 1) return;
    const col = stone ? STONE : CONCRETE, yaw = Math.atan2(f.x, f.z), mid = (vL + vR) / 2, half = (vR - vL) / 2;
    const q = p.clone().addScaledVector(r, mid);
    M.color(col); M.box(q.x, bed, q.z, half * 2, yTop - bed, al, yaw);
    // cutwaters: pointed prisms at both ends (upstream and down), up to above the water
    if (wet) {
      const top = Math.min(yTop - 1, pool(p.x, p.z) + 3);
      for (const sd of [-1, 1]) {
        const base = p.clone().addScaledVector(r, mid + sd * half);
        const a = base.clone().addScaledVector(f, -al / 2), b2 = base.clone().addScaledVector(f, al / 2), tip = base.clone().addScaledVector(r, sd * cut);
        const y0 = bed, y1 = top;
        M.color(shade(col, 0.95));
        const A0 = a.clone().setY(y0), B0 = b2.clone().setY(y0), T0 = tip.clone().setY(y0), A1 = a.clone().setY(y1), B1 = b2.clone().setY(y1), T1 = tip.clone().setY(y1);
        M.quad(A0, T0, T1, A1); M.quad(T0, B0, B1, T1); M.triangle(A1, T1, B1);
        // the cutwater's cap: a little pyramid back to the pier face
        const apex = base.clone().setY(y1 + 1.6);
        M.triangle(A1, T1, apex); M.triangle(T1, B1, apex);
      }
      // the waterline: a darker band (wet stone)
      const w = pool(p.x, p.z);
      M.color(STONE_DARK); M.box(q.x, w - 0.6, q.z, half * 2 + 0.06, 1.1, al + 0.06, yaw);
    }
    if (coping) { M.color(GRANITE); M.box(q.x, yTop - 0.7, q.z, half * 2 + 0.6, 0.7, al + 0.6, yaw); }
    // stone courses: a few thin darker joints up the shaft
    if (stone) for (let y = bed + 2.4; y < yTop - 1; y += 2.4) { M.color(shade(col, 0.9)); M.box(q.x, y, q.z, half * 2 + 0.04, 0.12, al + 0.04, yaw); }
  }
  /** A concrete column pier (land or an approach): a column under each girder line and a cap beam. */
  function bent(c, s, vL, vR, yTop) {
    const { p, r, f } = c.at(s), g = groundH(p.x, p.z), wet = pool(p.x, p.z) > g;
    if (wet) return pier(c, s, vL, vR, yTop, { stone: false, al: 4 });
    if (yTop - g < 2.5) return;
    if (wayAt(p.x, p.z, (vR - vL) / 2 + 1, c.own, yTop)) {
      // straddle the way: columns at the edges only
      for (const v of [vL, vR]) { const q = p.clone().addScaledVector(r, v); if (!wayAt(q.x, q.z, 1.2, c.own, yTop)) { M.color(CONCRETE); M.box(q.x, g - 0.5, q.z, 1.4, yTop - g + 0.5, 1.4, Math.atan2(f.x, f.z)); } }
    } else {
      for (const v of [vL + 1.2, vR - 1.2]) { const q = p.clone().addScaledVector(r, v); M.color(CONCRETE); M.box(q.x, g - 0.5, q.z, 1.5, yTop - g + 0.5, 1.5, Math.atan2(f.x, f.z)); }
    }
    const q = p.clone().addScaledVector(r, (vL + vR) / 2);
    M.color(shade(CONCRETE, 1.05)); M.box(q.x, yTop - 1.4, q.z, vR - vL, 1.4, 2, Math.atan2(f.x, f.z));
  }
  /** A scenery roadway (PGH doesn't ride it): asphalt, kerbed sidewalks, a parapet, the slab under it. */
  function roadway(c, s0, s1, { rail = false, walk = 1.8, slab = 1.2 } = {}) {
    const hw = c.hw;
    sweep(c, s0, s1, rect(-hw, hw, -slab, 0), (j) => (j === 2 ? (rail ? '#6b6259' : ASPHALT) : shade(CONCRETE, 0.85)), { caps: false });
    if (rail) {
      for (const v of [-0.75, 0.75]) for (const g of [-0.72, 0.72]) sweep(c, s0, s1, rect(v + g - 0.04, v + g + 0.04, 0, 0.18), '#58534d', { step: 8, caps: false });
    } else {
      for (const sd of [-1, 1]) {
        const v0 = sd > 0 ? hw : -hw - walk, v1 = sd > 0 ? hw + walk : -hw;
        sweep(c, s0, s1, rect(v0, v1, -0.4, 0.2), WALK, { caps: false });
        const vb = sd > 0 ? hw + walk : -hw - walk;
        sweep(c, s0, s1, rect(vb - (sd > 0 ? 0.35 : 0), vb + (sd > 0 ? 0 : 0.35), 0.2, 1.15), shade(CONCRETE, 1.05), { step: 6, caps: false });
      }
    }
    // centre line on a road
    if (!rail) sweep(c, s0, s1, rect(-0.12, 0.12, 0.01, 0.02), '#d9b23a', { step: 6, caps: false });
  }
  /** Plain approach spans: a deck on girders and concrete bents (scenery), or bents under a ridden approach. */
  function approach(c, s0, s1, color, scenery) {
    if (s1 - s0 < 6) return;
    if (scenery) roadway(c, s0, s1);
    const hw = c.hw + (scenery ? 1.8 : 0);
    for (const sd of [-1, 1]) sweep(c, s0, s1, rect(sd * hw - 0.25, sd * hw + 0.25, -2.2, -0.3), color, { caps: false });
    const n = Math.max(1, Math.round((s1 - s0) / 36));
    for (let k = 1; k < n || (k === 1 && n === 1 && false); k++) { const s = s0 + (s1 - s0) * k / n; const { p } = c.at(s); bent(c, s, -hw, hw, p.y - 2.2); }
  }

  // ---------------------------------------------------------------- styles
  const STYLES = {
    // ============================================================ the Three Sisters
    sister(c) {
      const { b, len, w0, w1, hw } = c, gold = new THREE.Color(b.color), goldDark = shade(b.color, 0.82), goldLite = shade(b.color, 1.08);
      // three spans centred on the river: side + main + side (the bank piers stand at the shore)
      let L = Math.min(len - 4, Math.max(b.lengthM || 269, w1 - w0 + 30)), main = (b.mainM || 131) * L / (b.lengthM || 269);
      const cMid = Math.max(L / 2 + 2, Math.min(len - L / 2 - 2, (w0 + w1) / 2));
      const s0 = cMid - L / 2, s1 = cMid + L / 2, side = (L - main) / 2, tA = s0 + side, tB = s1 - side;
      const gV = hw + 0.45, gT = 1.15, gB = -2.6, wv0 = hw + 0.85, wv1 = hw + 4.05, H = 19.5;
      const scenery = !c.ridden;
      if (scenery) roadway(c, s0, s1, { walk: 0 });
      // the chains' panel points: side spans and the main span, each in equal panels (~6.5 m)
      const panels = [];
      const ns = Math.max(6, Math.round(side / 6.6)), nm = Math.max(12, 2 * Math.round(main / 13.2));
      for (let k = 0; k <= ns; k++) panels.push(s0 + side * k / ns);
      for (let k = 1; k <= nm; k++) panels.push(tA + main * k / nm);
      for (let k = 1; k <= ns; k++) panels.push(tB + side * k / ns);
      const chainY = (s) => {
        if (s <= tA) { const t = (s - s0) / side; return 1.6 + (H - 1.6) * t - 3.2 * 4 * t * (1 - t) * 0.5; }
        if (s >= tB) { const t = (s1 - s) / side; return 1.6 + (H - 1.6) * t - 3.2 * 4 * t * (1 - t) * 0.5; }
        const u = (s - tA) / main; return 1.55 + (H - 1.55) * (2 * u - 1) ** 2;
      };
      for (const sd of [-1, 1]) {
        const v = sd * gV;
        // the stiffening girder: a deep riveted plate girder, its top flange, web stiffeners both faces
        sweep(c, s0, s1, rect(v - 0.22, v + 0.22, gB, gT), gold);
        sweep(c, s0, s1, rect(v - 0.42, v + 0.42, gT, gT + 0.14), goldDark, { caps: true });
        sweep(c, s0, s1, rect(v - 0.42, v + 0.42, gB - 0.14, gB), goldDark, { caps: true });
        for (let s = s0 + 1.1; s < s1 - 0.5; s += 2.2) for (const face of [-1, 1]) post(c, s, v + face * 0.27, 0.16, 0.1, gB + 0.1, gT - 0.02, goldLite);
        // the eyebar chain: straight links between pins (two bars side by side), a pin housing at each panel point
        for (let k = 0; k + 1 < panels.length; k++) {
          const a = P(c, panels[k], v, chainY(panels[k])), z = P(c, panels[k + 1], v, chainY(panels[k + 1]));
          for (const off of [-0.16, 0.16]) { const { r } = c.at(panels[k]); beam(a.clone().addScaledVector(r, off), z.clone().addScaledVector(r, off), 0.18, 0.4, goldDark); }
        }
        for (const s of panels) {
          const y = chainY(s), q = P(c, s, v, y), { r } = c.at(s);
          beam(q.clone().addScaledVector(r, -0.36), q.clone().addScaledVector(r, 0.36), 0.62, 0.62, gold);   // the eyes round the pin
          beam(q.clone().addScaledVector(r, -0.46), q.clone().addScaledVector(r, 0.46), 0.22, 0.22, goldDark); // the pin's ends
          // the hanger: a pair of eyebars from the pin down to the girder's top flange
          if (y - gT > 0.9 && Math.abs(s - tA) > 1 && Math.abs(s - tB) > 1) for (const off of [-0.12, 0.12]) post(c, s, v + off, 0.26, 0.07, gT + 0.1, y - 0.25, goldDark);
        }
        // the anchorages: the chain into the girder's end, a housing over it
        for (const s of [s0, s1]) post(c, s + (s === s0 ? 1.4 : -1.4), v, 3.2, 1.0, gT - 0.2, 2.6, goldDark);
        // sidewalk, cantilevered outside the girder on brackets
        const w0v = sd > 0 ? wv0 : -wv1, w1v = sd > 0 ? wv1 : -wv0;
        sweep(c, s0, s1, rect(w0v, w1v, -0.3, 0.18), (j) => (j === 2 ? WALK : shade(WALK, 0.8)));
        for (let s = s0 + 3.3; s < s1 - 2; s += 6.6) {
          const a = P(c, s, sd * (gV + 0.22), gB + 0.6), z = P(c, s, sd * (wv1 - 0.3), -0.3);
          beam(a, z, 0.22, 0.4, gold); beam(P(c, s, sd * (gV + 0.22), -0.4), z, 0.2, 0.3, gold);
        }
        // the lattice railing along the sidewalk's outer edge: posts, top and bottom rails, the X lattice
        const rv = sd * (wv1 - 0.08);
        sweep(c, s0, s1, rect(rv - 0.07, rv + 0.07, 1.08, 1.2), gold, { step: 4 });
        sweep(c, s0, s1, rect(rv - 0.05, rv + 0.05, 0.28, 0.36), gold, { step: 4 });
        for (let s = s0, k = 0; s < s1; s += 2.4, k++) {
          post(c, s, rv, 0.14, 0.14, 0.18, 1.22, gold);
          const s2 = Math.min(s1, s + 2.4);
          beam(P(c, s, rv, 0.36), P(c, s2, rv, 1.08), 0.04, 0.06, goldDark); beam(P(c, s, rv, 1.08), P(c, s2, rv, 0.36), 0.04, 0.06, goldDark);
        }
        // lamp standards on the railing: a fluted pole, an arm over the walk, a lantern (lit at night)
        for (let s = s0 + 13.2; s < s1 - 6; s += 26.4) {
          if (Math.abs(s - tA) < 5 || Math.abs(s - tB) < 5) continue;
          const { p, r, f } = c.at(s), q = p.clone().addScaledVector(r, rv);
          M.color(goldDark); M.cylinder(q.x, p.y + 0.18, q.z, 0.2, 0.6, 8, 0.15); M.cylinder(q.x, p.y + 0.78, q.z, 0.1, 5.2, 8, 0.08);
          const head = q.clone().addScaledVector(r, -sd * 0.9).setY(p.y + 5.8);
          beam(q.clone().setY(p.y + 5.9), head, 0.08, 0.08, goldDark);
          M.color('#f3e7c4'); M.box(head.x, head.y - 0.55, head.z, 0.42, 0.55, 0.42, Math.atan2(f.x, f.z));
          M.color(goldDark); M.pyramid(head.x, head.y, head.z, 0.55, 0.35, 0.55, Math.atan2(f.x, f.z));
          glows.push({ x: head.x, y: head.y - 0.3, z: head.z, size: 2.6, color: '#fff0cc' });
        }
        // the towers: on the girder line over the river piers — a banded shaft, a collar at the deck, the chain saddle,
        // a cap and finial
        for (const t of [tA, tB]) {
          const { p } = c.at(t), y0 = p.y + gB, y1 = p.y + H - 0.4;
          shaft(c, t, v, y0, y1, 2.3, 1.0, 1.5, 0.8, gold);
          for (let y = p.y + 3.5; y < y1 - 1; y += 3.4) post(c, t, v, 2.3 - (y - y0) / (y1 - y0) * 0.8 + 0.12, 1.0 - (y - y0) / (y1 - y0) * 0.2 + 0.1, y - p.y, y - p.y + 0.28, goldDark);
          post(c, t, v, 2.8, 1.25, gT, gT + 1.6, goldDark);           // the collar where the girder meets it
          post(c, t, v, 2.4, 1.15, H - 0.6, H + 1.0, goldDark);      // the saddle housing the chain
          post(c, t, v, 1.9, 0.95, H + 1.0, H + 1.45, gold);
          const q = P(c, t, v, H + 1.45), { f } = c.at(t);
          M.color(goldDark); M.pyramid(q.x, q.y, q.z, 0.95, 1.5, 1.9, Math.atan2(f.x, f.z));
          M.color(gold); M.cylinder(q.x, q.y + 1.5, q.z, 0.16, 1.1, 8, 0.05);
          glows.push({ x: q.x, y: q.y + 2.8, z: q.z, size: 3.2, color: '#ffd98a' });
        }
      }
      // under the deck: floor beams at every panel point, lateral X bracing between them
      for (let k = 0; k < panels.length; k++) {
        const s = panels[k];
        beam(P(c, s, -gV, -1.4), P(c, s, gV, -1.4), 0.45, 1.5, goldDark);
        if (k + 1 < panels.length) { const z = panels[k + 1]; beam(P(c, s, -gV, -2.1), P(c, z, gV, -2.1), 0.12, 0.12, goldDark); beam(P(c, s, gV, -2.1), P(c, z, -gV, -2.1), 0.12, 0.12, goldDark); }
      }
      // the stone piers under the towers, and the abutments
      for (const t of [tA, tB]) pier(c, t, -(wv1 + 0.4), wv1 + 0.4, c.at(t).p.y + gB - 0.1, { al: 7.5, cut: 4 });
      for (const s of [s0, s1]) {
        const { p, r, f } = c.at(s), g = groundH(p.x, p.z), back = s === s0 ? -1 : 1, q = p.clone().addScaledVector(f, back * 3);
        M.color(STONE); M.box(q.x, Math.min(g, p.y - 4) - 1, q.z, 2 * (wv1 + 0.6), p.y - 0.35 - Math.min(g, p.y - 4) + 1, 6, Math.atan2(f.x, f.z));
        M.color(GRANITE); M.box(q.x, p.y - 0.5, q.z, 2 * (wv1 + 0.9), 0.3, 6.4, Math.atan2(f.x, f.z));
        // stone end posts at the four corners, with a lamp
        for (const sd of [-1, 1]) {
          const e = p.clone().addScaledVector(r, sd * (wv1 + 0.2)).addScaledVector(f, back * 0.9);
          M.color(STONE); M.box(e.x, p.y, e.z, 1.3, 2.6, 1.3, Math.atan2(f.x, f.z));
          M.color(GRANITE); M.box(e.x, p.y + 2.6, e.z, 1.55, 0.35, 1.55, Math.atan2(f.x, f.z));
          M.color('#f3e7c4'); M.box(e.x, p.y + 2.95, e.z, 0.5, 0.6, 0.5, 0);
          glows.push({ x: e.x, y: p.y + 3.3, z: e.z, size: 2.8, color: '#fff0cc' });
        }
      }
      if (scenery) { approach(c, 0, s0, b.color, true); approach(c, s1, len, b.color, true); }
      return [s0 - 4, s1 + 4];
    },

    // ============================================================ bowstring (tied) arch: Fort Duquesne, Fort Pitt, West End, Birmingham
    'tied-arch'(c) {
      const { b, len, w0, w1, hw } = c, col = b.color, dark = shade(col, 0.82);
      const span = Math.min(w1 - w0, b.spanM || 260), mid = (w0 + w1) / 2, a0 = mid - span / 2, a1 = mid + span / 2;
      const scenery = !c.ridden, { L: vl, R: vr } = c.plane(hw + (scenery ? 1.8 : 0) + 1.4);
      const rise = b.riseM || Math.max(24, span * 0.17), low = b.decks === 2 ? -8 : 0;
      if (scenery) { roadway(c, a0, a1); if (b.decks === 2) sweep(c, a0, a1, rect(-hw, hw, low - 1, low), (j) => (j === 2 ? ASPHALT : shade(CONCRETE, 0.8)), { caps: false }); }
      const n = Math.max(12, Math.round(span / 9));
      const archY = (u) => 1.6 + rise * 4 * u * (1 - u);
      for (const v of [vl, vr]) {
        // the tie: a deep box girder at the lower deck; the rib: a box arch, its pieces straight between hangers
        sweep(c, a0, a1, rect(v - 0.8, v + 0.8, low - 2.4, low + (low ? 0.6 : 1.6)), col);
        if (low) sweep(c, a0, a1, rect(v - 0.5, v + 0.5, -1.4, 1.1), dark);   // the upper deck's edge girder (open between the decks)
        for (let k = 0; k < n; k++) {
          const u0 = k / n, u1 = (k + 1) / n, s0 = a0 + span * u0, s1 = a0 + span * u1;
          beam(P(c, s0, v, archY(u0)), P(c, s1, v, archY(u1)), 1.5, 2.6, col);
          if (k > 0) {
            const top = archY(u0);
            if (top > 3) post(c, s0, v, 0.32, 0.5, low + 0.6, top - 0.6, dark);
          }
        }
      }
      // the bracing between the ribs where they stand high enough: struts and diagonals, portals at the ends
      for (let k = 1; k < n; k++) {
        const u = k / n, s = a0 + span * u, y = archY(u);
        if (y < 9.5) continue;
        beam(P(c, s, vl, y + 0.6), P(c, s, vr, y + 0.6), 0.7, 0.9, dark);
        if (k + 1 < n && archY((k + 1) / n) >= 9.5) { const s2 = a0 + span * (k + 1) / n, y2 = archY((k + 1) / n); beam(P(c, s, vl, y + 0.6), P(c, s2, vr, y2 + 0.6), 0.35, 0.35, dark); beam(P(c, s, vr, y + 0.6), P(c, s2, vl, y2 + 0.6), 0.35, 0.35, dark); }
      }
      // floor beams under the deck
      for (let k = 0; k <= n; k++) { const s = a0 + span * k / n; beam(P(c, s, vl, low - 1.2), P(c, s, vr, low - 1.2), 0.5, 1.6, dark); }
      for (const s of [a0, a1]) pier(c, s, vl - 1.5, vr + 1.5, c.at(s).p.y + low - 2.6, { stone: false, al: 9, cut: 4 });
      approachRun(c, 0, a0, col, scenery); approachRun(c, a1, len, col, scenery);
      return [a0 - 6, a1 + 6];
    },

    // ============================================================ through arch: McCullough (16th St), 31st St
    'through-arch'(c) {
      const { b, len, w0, w1, hw } = c, col = b.color, dark = shade(col, 0.82);
      const ws = w1 - w0, nArch = Math.max(1, Math.ceil(ws / 165)), span = ws / nArch;
      const scenery = !c.ridden, { L: vl, R: vr } = c.plane(hw + (scenery ? 1.8 : 0) + 1.2);
      if (scenery) roadway(c, w0, w1);
      for (let a = 0; a < nArch; a++) {
        const a0 = w0 + a * span, a1 = a0 + span, rise = Math.max(18, span * 0.2), n = Math.max(10, Math.round(span / 8));
        const archY = (u) => -6 + (rise + 6) * 4 * u * (1 - u);
        for (const v of [vl, vr]) {
          sweep(c, a0, a1, rect(v - 0.4, v + 0.4, -1.8, 0.9), dark, { caps: false });
          for (let k = 0; k < n; k++) {
            const u0 = k / n, u1 = (k + 1) / n;
            beam(P(c, a0 + span * u0, v, archY(u0)), P(c, a0 + span * u1, v, archY(u1)), 1.2, 2.2, col);
            if (k > 0 && archY(u0) > 1.5) post(c, a0 + span * u0, v, 0.26, 0.4, 0.9, archY(u0) - 0.5, dark);
          }
        }
        for (let k = 1; k < n; k++) { const u = k / n, y = archY(u); if (y > 9.5) beam(P(c, a0 + span * u, vl, y), P(c, a0 + span * u, vr, y), 0.55, 0.8, dark); }
      }
      for (let a = 0; a <= nArch; a++) { const s = w0 + a * span; pier(c, s, vl - 1, vr + 1, c.at(s).p.y - 6.5, { stone: true, al: 8 }); }
      // McCullough: four granite pylons at the river ends, armillary spheres in bronze on top
      if (b.pylons === 'sphere') for (const s of [w0 - 5, w1 + 5]) for (const v of [vl - 2.4, vr + 2.4]) {
        const { p } = c.at(s); postAbs(c, s, v, 3.2, 3.2, p.y - 6, p.y + 13, GRANITE); postAbs(c, s, v, 3.8, 3.8, p.y + 13, p.y + 14, STONE);
        const q = P(c, s, v, 16.6);
        for (let ring = 0; ring < 3; ring++) {
          const ax = ring === 0 ? V(1, 0, 0) : ring === 1 ? V(0, 0, 1) : V(0.7, 0, 0.7).normalize();
          let prev = null;
          for (let k = 0; k <= 16; k++) { const t = k / 16 * Math.PI * 2, pt = q.clone().addScaledVector(V(0, 1, 0), Math.sin(t) * 2.2).addScaledVector(ax, Math.cos(t) * 2.2); if (prev) beam(prev, pt, 0.18, 0.18, BRONZE); prev = pt; }
        }
        M.color(BRONZE); M.cylinder(q.x, q.y - 2.6, q.z, 0.5, 0.6, 10);
        glows.push({ x: q.x, y: q.y, z: q.z, size: 4, color: '#ffd98a' });
      }
      approachRun(c, 0, w0, col, scenery); approachRun(c, w1, len, col, scenery);
      return [w0 - 8, w1 + 8];
    },

    // ============================================================ open-spandrel deck arches: 40th Street (three), Liberty
    'deck-arch'(c) {
      const { b, len, w0, w1, hw } = c, col = b.color, dark = shade(col, 0.85);
      const n = b.arches || Math.max(1, Math.round((w1 - w0) / 110)), span = (w1 - w0) / n;
      const scenery = !c.ridden;
      if (scenery) roadway(c, w0, w1);
      const ribs = [-0.78, -0.26, 0.26, 0.78].map((f) => f * (hw + (scenery ? 1.8 : 0)));
      for (let a = 0; a < n; a++) {
        const a0 = w0 + a * span, a1 = a0 + span, { p: pm } = c.at((a0 + a1) / 2);
        const wet = pool(pm.x, pm.z) + 3, depth = Math.max(8, Math.min(span * 0.24, pm.y - wet));
        const ribY = (u) => -2.2 - depth + depth * 4 * u * (1 - u);
        const m = Math.max(8, Math.round(span / 6.5));
        for (const v of ribs) {
          for (let k = 0; k < m; k++) {
            const u0 = k / m, u1 = (k + 1) / m;
            beam(P(c, a0 + span * u0, v, ribY(u0)), P(c, a0 + span * u1, v, ribY(u1)), 0.7, 1.7, col);
          }
          // spandrel columns from the rib to the deck (and the braced spandrel of a cantilever arch)
          for (let k = 1; k < m; k++) {
            const u = k / m, s = a0 + span * u, y = ribY(u);
            if (-1.2 - y > 0.8) post(c, s, v, 0.5, 0.5, y + 0.5, -1.2, dark);
            if (b.cantilever && k + 1 < m) beam(P(c, s, v, y + 0.4), P(c, a0 + span * (k + 1) / m, v, -1.3), 0.25, 0.25, dark);
          }
        }
        // cross bracing between the ribs
        for (let k = 1; k < m; k += 2) { const u = k / m, s = a0 + span * u, y = ribY(u); beam(P(c, s, ribs[0], y + 0.3), P(c, s, ribs[3], y + 0.3), 0.3, 0.4, dark); }
      }
      // the deck's fascia girders
      for (const v of [ribs[0] - 0.9, ribs[3] + 0.9]) sweep(c, w0, w1, rect(v - 0.25, v + 0.25, -2.2, -0.2), col, { caps: false });
      // the piers between the arches; 40th Street's pylons (granite, with obelisks) over them
      for (let a = 0; a <= n; a++) {
        const s = w0 + a * span, { p } = c.at(s), vh = hw + (scenery ? 1.8 : 0) + 1.2;
        pier(c, s, -vh, vh, p.y - 2.2, { stone: false, al: 9, cut: 4 });
        if (b.pylons === 'obelisk') for (const v of [-vh - 0.4, vh + 0.4]) {
          postAbs(c, s, v, 3, 2.2, p.y - 0.5, p.y + 6.5, GRANITE);
          const q = P(c, s, v, 6.5); M.color(STONE); M.box(q.x, q.y, q.z, 1.6, 4.5, 1.6, 0); M.pyramid(q.x, q.y + 4.5, q.z, 1.6, 1.2, 1.6, 0);
          glows.push({ x: q.x, y: q.y + 5.9, z: q.z, size: 2.6, color: '#fff0cc' });
        }
      }
      approachRun(c, 0, w0, col, scenery); approachRun(c, w1, len, col, scenery);
      return [w0 - 6, w1 + 6];
    },

    // ============================================================ Smithfield Street: two lenticular (Pauli) trusses
    lenticular(c) {
      const { b, len, w0, w1, hw } = c, blue = b.color, gold = b.accent || '#c9a24a';
      const scenery = !c.ridden, { L: vl, R: vr } = c.plane(hw + 0.6);
      if (scenery) roadway(c, w0, w1, { walk: 0 });
      // the cantilevered sidewalks out to the ridden trail (or a plain one)
      for (const sd of [-1, 1]) {
        const v = sd > 0 ? vr : vl, tr = c.beside.find((x) => Math.sign(x.v) === sd);
        const out = tr ? Math.abs(tr.v) + halfOf(tr.e) : Math.abs(v) + 3;
        if (!tr) sweep(c, w0, w1, rect(sd > 0 ? Math.abs(v) + 0.5 : -out, sd > 0 ? out : -Math.abs(v) - 0.5, -0.35, 0.15), WALK, { caps: false });
        else sweep(c, w0, w1, rect(sd > 0 ? Math.abs(v) + 0.5 : -out, sd > 0 ? out : -Math.abs(v) - 0.5, -0.6, -0.12), shade(WALK, 0.85), { caps: false });
      }
      const mid = (w0 + w1) / 2, spans = [[w0, mid], [mid, w1]];
      for (const [a0, a1] of spans) {
        const span = a1 - a0, n = Math.max(10, Math.round(span / 7.5)), T = Math.min(17, span * 0.15), B = Math.min(5, span * 0.045);
        const top = (u) => 1.2 + T * Math.sin(Math.PI * u), bot = (u) => 1.2 - B * Math.sin(Math.PI * u);
        for (const v of [vl, vr]) {
          for (let k = 0; k < n; k++) {
            const u0 = k / n, u1 = (k + 1) / n, s0 = a0 + span * u0, s1 = a0 + span * u1;
            beam(P(c, s0, v, top(u0)), P(c, s1, v, top(u1)), 0.9, 0.9, blue);
            beam(P(c, s0, v, bot(u0)), P(c, s1, v, bot(u1)), 0.8, 0.8, blue);
            beam(P(c, s0, v, bot(u0)), P(c, s1, v, top(u1)), 0.2, 0.2, gold);
            beam(P(c, s0, v, top(u0)), P(c, s1, v, bot(u1)), 0.2, 0.2, gold);
            if (k > 0) beam(P(c, s0, v, bot(u0)), P(c, s0, v, top(u0)), 0.4, 0.4, blue);
          }
        }
        for (let k = 1; k < n; k++) { const u = k / n, y = top(u); if (y > 8) beam(P(c, a0 + span * u, vl, y), P(c, a0 + span * u, vr, y), 0.35, 0.5, gold); }
      }
      // the portals: at the ends and over the middle pier — posts at the trusses, a pointed arch over the roadway
      for (const s of [w0, mid, w1]) {
        for (const v of [vl, vr]) { post(c, s, v, 1.2, 1.2, -0.4, 9.5, blue); post(c, s, v, 1.5, 1.5, 9.5, 10.2, gold); }
        const l = P(c, s, vl, 8.2), r = P(c, s, vr, 8.2), apex = P(c, s, 0, 12.5);
        beam(l, r, 0.7, 0.9, blue); beam(l, apex, 0.6, 0.7, gold); beam(apex, r, 0.6, 0.7, gold);
        beam(P(c, s, (vl + vr) / 2 - 2.5, 8.2), apex, 0.25, 0.25, gold); beam(P(c, s, (vl + vr) / 2 + 2.5, 8.2), apex, 0.25, 0.25, gold);
        glows.push({ ...P(c, s, 0, 12.8), size: 3, color: '#ffe2b0' });
        pier(c, s, vl - 1.5, vr + 1.5, c.at(s).p.y - 3.9, { al: 7 });
      }
      approachRun(c, 0, w0, blue, scenery); approachRun(c, w1, len, blue, scenery);
      return [w0 - 6, w1 + 6];
    },

    // ============================================================ through trusses (Parker / Pratt): Hot Metal, Panhandle, the rail bridges, 62nd Street
    truss(c) {
      const { b, len, w0, w1, hw } = c, col = b.color, dark = shade(col, 0.82);
      const ws = w1 - w0, nS = Math.max(1, Math.ceil(ws / 140)), span = ws / nS;
      const scenery = !c.ridden, { L: vl, R: vr } = c.plane(hw + (scenery && !b.rail ? 1.8 : 0) + 0.6);
      if (scenery) roadway(c, w0, w1, { rail: !!b.rail, walk: b.rail ? 0 : 1.8 });
      const lowY = b.decks === 2 ? -8 : 0;
      if (scenery && b.decks === 2) sweep(c, w0, w1, rect(-hw, hw, lowY - 1, lowY), (j) => (j === 2 ? '#6b6259' : shade(CONCRETE, 0.8)), { caps: false });
      for (let a = 0; a < nS; a++) {
        const a0 = w0 + a * span, n = Math.max(6, Math.round(span / 9) & ~1);
        const Hc = span > 90 ? 9 : 7, Hp = span > 90 ? 5.5 : 0;
        const top = (u) => (u < 1 / n || u > 1 - 1 / n ? Hc * 0.85 : Hc + Hp * Math.sin(Math.PI * u));
        const ends = (k) => (k === 0 || k === n ? lowY : null);
        for (const v of [vl, vr]) {
          for (let k = 0; k < n; k++) {
            const u0 = k / n, u1 = (k + 1) / n, s0 = a0 + span * u0, s1 = a0 + span * u1;
            beam(P(c, s0, v, lowY - 0.3), P(c, s1, v, lowY - 0.3), 0.7, 1.0, col);                             // bottom chord
            const y0 = ends(k) ?? top(u0), y1 = ends(k + 1) ?? top(u1);
            if (k > 0 && k < n - 1) beam(P(c, s0, v, top(u0)), P(c, s1, v, top(u1)), 0.8, 0.8, col);        // top chord
            else beam(P(c, s0, v, y0), P(c, s1, v, y1), 0.85, 0.85, col);                                      // inclined end posts
            if (k > 0) beam(P(c, s0, v, lowY - 0.3), P(c, s0, v, top(u0)), 0.4, 0.4, dark);                    // verticals
            // Pratt diagonals: down toward the middle
            if (k > 0 && k < n - 1) { const toMid = u0 < 0.5; beam(P(c, toMid ? s0 : s1, v, top(toMid ? u0 : u1)), P(c, toMid ? s1 : s0, v, lowY - 0.3), 0.28, 0.28, dark); }
          }
        }
        for (let k = 1; k < n; k++) {
          const u = k / n, s = a0 + span * u, y = top(u);
          beam(P(c, s, vl, y), P(c, s, vr, y), 0.4, 0.55, dark);
          if (k + 1 < n) { const s2 = a0 + span * (k + 1) / n, y2 = top((k + 1) / n); beam(P(c, s, vl, y), P(c, s2, vr, y2), 0.18, 0.18, dark); beam(P(c, s, vr, y), P(c, s2, vl, y2), 0.18, 0.18, dark); }
          beam(P(c, s, vl, lowY - 1.1), P(c, s, vr, lowY - 1.1), 0.4, 1.0, dark);
        }
      }
      for (let a = 0; a <= nS; a++) { const s = w0 + a * span; pier(c, s, vl - 1, vr + 1, c.at(s).p.y + lowY - 1.6, { al: 6 }); }
      approachRun(c, 0, w0, col, scenery); approachRun(c, w1, len, col, scenery);
      return [w0 - 6, w1 + 6];
    },

    // ============================================================ continuous deck trusses: Homestead Grays (Wichert), Highland Park, Bloomfield
    'deck-truss'(c) { return deckTruss(c, false); },
    // ============================================================ Glenwood: a welded deck truss that rises through the deck over the piers
    glenwood(c) { return deckTruss(c, true); },

    // ============================================================ wire-cable suspension: South 10th Street
    suspension(c) {
      const { b, len, w0, w1, hw } = c, col = b.color, dark = shade(col, 0.82);
      const scenery = !c.ridden, { L: vl, R: vr } = c.plane(hw + (scenery ? 1.8 : 0) + 0.8);
      const ws = w1 - w0, tA = w0 + ws * 0.17, tB = w1 - ws * 0.17, { p: pm } = c.at((w0 + w1) / 2);
      const H = Math.max(14, (b.towerM || 35) - (pm.y - pool(pm.x, pm.z)));
      if (scenery) roadway(c, 2, len - 2);
      const cable = (s) => {
        if (s < tA) { const t = (s - 2) / (tA - 2); return 1 + (H - 1) * t * t; }
        if (s > tB) { const t = (len - 2 - s) / (len - 2 - tB); return 1 + (H - 1) * t * t; }
        const u = (s - tA) / (tB - tA); return 2.2 + (H - 2.2) * (2 * u - 1) ** 2;
      };
      for (const v of [vl, vr]) {
        let prev = null;
        for (let s = 2; s <= len - 2 + 0.01; s += 4) { const q = P(c, s, v, cable(s)); if (prev) beam(prev, q, 0.45, 0.45, dark); prev = q; if (s > 4 && s < len - 4 && cable(s) > 2.2 && s > tA - (tA - 2) * 0.95) post(c, s, v, 0.08, 0.08, 1.4, cable(s), dark); }
        // the stiffening truss along the deck
        sweep(c, 2, len - 2, rect(v - 0.2, v + 0.2, 1.3, 1.5), col, { caps: false });
        sweep(c, 2, len - 2, rect(v - 0.2, v + 0.2, -1.6, -1.4), col, { caps: false });
        for (let s = 2; s < len - 6; s += 4) { beam(P(c, s, v, -1.5), P(c, s + 4, v, 1.4), 0.15, 0.15, col); post(c, s, v, 0.15, 0.15, -1.5, 1.4, col); }
      }
      for (const t of [tA, tB]) {
        const { p } = c.at(t);
        for (const v of [vl, vr]) shaft(c, t, v, p.y - 3, p.y + H + 1.5, 1.8, 1.4, 1.2, 1.0, col);
        for (const y of [H - 1, H * 0.55]) beam(P(c, t, vl, y), P(c, t, vr, y), 1.0, 1.4, col);
        beam(P(c, t, vl, H * 0.55), P(c, t, vr, H - 1), 0.4, 0.4, dark); beam(P(c, t, vr, H * 0.55), P(c, t, vl, H - 1), 0.4, 0.4, dark);
        pier(c, t, vl - 1.5, vr + 1.5, p.y - 3, { al: 6 });
      }
      for (const s of [2, len - 2]) { const { p } = c.at(s); post(c, s, 0, 6, (vr - vl) + 3, -4, 2.2, CONCRETE); glows.push({ ...P(c, s, vl, 2.6), size: 2.5, color: '#fff0cc' }); }
      return [0, len];
    },

    // ============================================================ girders: Veterans, the small spans
    girder(c) {
      const { b, len, hw } = c, scenery = !c.ridden;
      if (scenery) roadway(c, 0, len);
      const vh = hw + (scenery ? 1.8 : 0);
      for (const sd of [-1, 1]) sweep(c, 0, len, rect(sd * vh - 0.3, sd * vh + 0.3, -2.6, -0.3), b.color, { caps: false });
      for (let k = 0; k * 4 <= len; k += 3) beam(P(c, k * 4, -vh, -1.5), P(c, k * 4, vh, -1.5), 0.4, 1.6, shade(b.color, 0.85));
      const n = Math.max(1, Math.round(len / (scenery ? 60 : 45)));
      for (let k = 1; k < n; k++) { const s = len * k / n, { p } = c.at(s); bent(c, s, -vh, vh, p.y - 2.6); }
      return [0, len];
    },
  };

  /** Plain spans from s0 to s1 (an approach): scenery decks with girders and bents; a ridden approach: left as the world's. */
  function approachRun(c, s0, s1, color, scenery) { if (scenery) approach(c, s0, s1, color, true); }

  function deckTruss(c, glen) {
    const { b, len, w0, w1, hw } = c, col = b.color, dark = shade(col, 0.82);
    const scenery = !c.ridden, ws = w1 - w0, nS = Math.max(2, Math.round(ws / 150)), span = ws / nS;
    if (scenery) roadway(c, w0, w1);
    const vt = (hw + (scenery ? 1.8 : 0)) * (glen ? 1 : 0.8) + (glen ? 0.6 : 0), D = Math.min(11, Math.max(6, span * 0.08));
    const piers = Array.from({ length: nS + 1 }, (_, k) => w0 + k * span);
    // the depth: deeper over the piers (Wichert's quadrilaterals, Glenwood's haunches)
    const depth = (s) => { let d = D; for (const q of piers.slice(1, -1)) { const t = Math.max(0, 1 - Math.abs(s - q) / (span * 0.22)); d += t * t * D * (b.wichert ? 0.7 : 0.5); } return d; };
    const above = (s) => { if (!glen) return 0; let h = 0; for (const q of piers.slice(1, -1)) { const t = Math.max(0, 1 - Math.abs(s - q) / (span * 0.2)); h = Math.max(h, 9 * Math.sin(t * Math.PI / 2)); } return h; };
    const n = Math.max(8, Math.round(ws / 8));
    for (const v of [-vt, vt]) {
      for (let k = 0; k < n; k++) {
        const s0 = w0 + ws * k / n, s1 = w0 + ws * (k + 1) / n;
        beam(P(c, s0, v, -1.0), P(c, s1, v, -1.0), 0.7, 0.9, col);
        beam(P(c, s0, v, -1 - depth(s0)), P(c, s1, v, -1 - depth(s1)), 0.8, 1.0, col);
        beam(P(c, s0, v, -1 - depth(s0)), P(c, s0, v, -1.0), 0.4, 0.4, dark);
        beam(P(c, k % 2 ? s0 : s1, v, -1 - depth(k % 2 ? s0 : s1)), P(c, k % 2 ? s1 : s0, v, -1.0), 0.32, 0.32, dark);
        // Glenwood: the top chord up through the deck over the piers
        const h0 = above(s0), h1 = above(s1);
        if (h0 > 0.5 || h1 > 0.5) { beam(P(c, s0, v, Math.max(1, h0)), P(c, s1, v, Math.max(1, h1)), 0.6, 0.6, col); if (h0 > 1.2) beam(P(c, s0, v, 0), P(c, s0, v, h0), 0.35, 0.35, dark); if (h0 > 1.2 && h1 > 1.2) beam(P(c, s0, v, 0), P(c, s1, v, h1), 0.25, 0.25, dark); }
      }
    }
    for (let k = 0; k <= n; k += 2) { const s = w0 + ws * k / n; beam(P(c, s, -vt, -1 - depth(s) * 0.5), P(c, s, vt, -1 - depth(s) * 0.5), 0.25, 0.25, dark); beam(P(c, s, -vt, -1.5), P(c, s, vt, -1.5), 0.4, 0.8, dark); }
    for (const s of piers) { const { p } = c.at(s); pier(c, s, -vt - 1.2, vt + 1.2, p.y - 1 - depth(s) - 0.6, { stone: false, al: 7 }); }
    approachRun(c, 0, w0, col, scenery); approachRun(c, w1, len, col, scenery);
    return [w0 - 6, w1 + 6];
  }

  let count = 0;
  for (const b of json.bridges || []) {
    try { if (build(b)) count++; } catch (err) { console.warn(`PGH bridge ${b.name}: ${err.message}`); }
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.22, side: THREE.DoubleSide });
  const group = new THREE.Group(); group.name = 'PGH bridges';
  if (M.count) { const mesh = new THREE.Mesh(M.geometry(), mat); mesh.name = 'PGH bridge models'; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); }
  return { group, glows, mask, count, dispose() { for (const m of group.children) m.geometry.dispose(); mat.dispose(); } };
}
