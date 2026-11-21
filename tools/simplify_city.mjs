#!/usr/bin/env node
// City street simplification (user, 21 Nov: "there are still many road stubs and pieces which make no sense, roads
// overlapping each other, random splices — the tools made are not addressing the problem"). The street data is raw map
// data: every footway, every half of a divided road, a street cut in pieces wherever its tags change. The renderer draws
// every piece. This simplifies the whole network of an area once, before anything is drawn (decisions, 21 Nov: the whole
// map; footpaths removed; divided roads one road except highways; "main grid" density):
//
//   1 footpaths   paths (cls 8) dropped — not a deck (a bridge's sidewalk), not one a route rides, nor within 15 m of a route
//   2 divided     a one-way street with another one-way street of about its class running beside it, 5–20 m apart and
//                 parallel along ≥ 60 % of it: the two halves of a divided road. It is dropped; its partner moves half way
//                 towards it (onto the middle) and becomes two-way; streets that ended on it end on the partner. Not highways, nor a half within 15 m of a route.
//   3 snap        a street end within 3 m of another street's end, or 4 m of another street's line, is joined to it (a
//                 shared point: the renderer joins streets only where they share one — a T needs a point on the through street)
//   4 splices     two streets meeting end to end with nothing else there, of one class and kind: joined into one street
//   5 stubs       a street with a loose end and under 60 m, or loose at both ends and under 150 m: dropped (repeated, as each
//                 drop can leave another loose)
//   6 overlaps    a street lying over another (their ribbons overlapping along ≥ 15 m and ≥ half of the shorter, away from
//                 where they meet): the less important / shorter one dropped
// Never a street a route rides (rideStreets), never a highway in 2, 5 and 6 (the corridors were chosen, 20 Nov).
//
// node tools/simplify_city.mjs [area ids…] [--dry] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { STREET_W } from '../js/world/toolbox/city/landscape.js';
import { loadSceneSync } from './qc_course.mjs';
import { decodeStreets, withStreets, rideStreets, loadRides } from './repair_city.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const SIMPLIFY = { keepClearM: 15, divMin: 5, divMax: 20, divShare: .6, divAngle: .94, snapEnd: 3, snapLine: 4, gapM: 30, gapDeg: 30, stubLoose: 60, stubBoth: 150, overlapRun: 15, overlapShare: .5, overlapK: .8, passes: 6 };

const ONEWAY = (s) => (s.meta[1] >> 1) & 3;           // 0 two-way, else one-way
const BRIDGE = (s) => s.meta[1] & 1;
const key = (p) => p[0] * 65536 + p[1];
const SKIP = new Set((process.env.SIMPLIFY_SKIP || '').split(','));   // (debugging: steps to leave out)

/** Simplify one area's packed streets. → { streets, log: [{ step, note }] } */
export function simplifyArea({ streets, city, proj, rides }) {
  const [lat0, lon0] = city.origin, unit = city.unit;
  const local = ([a, o]) => proj.toLocal(lat0 + a * unit, lon0 + o * unit);
  const quant = (x, z) => { const g = proj.toLatLon(x, z); return [Math.round((g.lat - lat0) / unit), Math.round((g.lon - lon0) / unit)]; };
  let S = streets.map((s) => ({ meta: s.meta.slice(), xy: s.xy.map((p) => p.slice()), deck: s.deck.slice() }));
  const log = [];
  const say = (step, note) => log.push({ step, note });

  // geometry of the current list (recomputed after each step)
  let G, grid;
  const CELL = 25, gk = (i, j) => i * 100003 + j;
  const build = () => {
    G = S.map((s, k) => {
      const pts = s.xy.map(local); let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      return { k, s, pts, len, cls: s.meta[0], w: STREET_W[s.meta[0]], bridge: !!BRIDGE(s) };
    });
    grid = new Map();
    G.forEach((g) => { for (let i = 1; i < g.pts.length; i++) { const a = g.pts[i - 1], b = g.pts[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++)
        for (let gz = Math.floor(Math.min(a.z, b.z) / CELL); gz <= Math.floor(Math.max(a.z, b.z) / CELL); gz++) { const kk = gk(gx, gz); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([g.k, i]); } } });
  };
  /** Nearest point on each street within r of (x, z): [{ k, i, t, d, x, z, ux, uz }], nearest first. */
  const near = (x, z, r, skip = null) => {
    const best = new Map();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++)
      for (const [k, i] of grid.get(gk(gx, gz)) || []) {
        if (skip?.has(k)) continue;
        const g = G[k], a = g.pts[i - 1], b = g.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, l = Math.sqrt(l2);
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
        if (d <= r && (!best.has(k) || d < best.get(k).d)) best.set(k, { k, i, t, d, x: px, z: pz, ux: dx / l, uz: dz / l });
      }
    return [...best.values()].sort((a, b) => a.d - b.d);
  };
  /** Every point (vertex) count by its integer key: how many street points sit there. */
  const pointUse = () => { const m = new Map(); S.forEach((s, k) => s.xy.forEach((p, i) => { const kk = key(p); if (!m.has(kk)) m.set(kk, []); m.get(kk).push({ k, i, end: i === 0 || i === s.xy.length - 1 }); })); return m; };
  const samples = (g, step = 4) => { const out = []; for (let i = 1; i < g.pts.length; i++) { const a = g.pts[i - 1], b = g.pts[i], l = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(l / step)); for (let m = 0; m < n; m++) out.push({ x: a.x + (b.x - a.x) * (m + .5) / n, z: a.z + (b.z - a.z) * (m + .5) / n, l: l / n, ux: (b.x - a.x) / (l || 1), uz: (b.z - a.z) / (l || 1) }); } return out; };
  /** Insert a point into street k's segment i (between i-1 and i) at integer q, unless it is one of its points already. → its index */
  const insertPoint = (k, i, q) => {
    const s = S[k];
    for (let j = 0; j < s.xy.length; j++) if (s.xy[j][0] === q[0] && s.xy[j][1] === q[1]) return j;
    s.xy.splice(i, 0, q); s.deck.splice(i, 0, s.deck[i - 1] && s.deck[i] ? Math.round((s.deck[i - 1] + s.deck[i]) / 2) : 0);
    return i;
  };
  let ride;
  // (no street point within keepClearM of a route moves: the ground and the junctions there are shaped round the route)
  const byRoute = (x, z) => rides.some(({ index }) => { const q = index.nearest(x, z, SIMPLIFY.keepClearM + 4); return q && q.d < SIMPLIFY.keepClearM + 4; });
  const near40 = (x, z) => rides.some(({ index }) => index.nearest(x, z, 40));
  const protect = () => { build(); ride = rideStreets(G.map((g) => ({ ...g })), rides, null); };
  const remove = (drop) => { if (!drop.size) return; S = S.filter((_, k) => !drop.has(k)); };

  // 1 footpaths
  protect();
  if (!SKIP.has('footpaths')) { const drop = new Set(); for (const g of G) if (g.cls === 8 && !g.bridge && !ride.has(g.k) && !g.pts.some((p) => near40(p.x, p.z))) drop.add(g.k); say('footpaths', `${drop.size} dropped`); remove(drop); }

  // 2 divided roads → one road (not highways)
  protect();
  if (!SKIP.has('divided')) {
    const drop = new Set(), moved = new Map();   // k → partner list
    const order = G.filter((g) => ONEWAY(g.s) && g.cls >= 2 && g.cls <= 7 && !g.bridge && !ride.has(g.k) && !g.pts.some((p) => near40(p.x, p.z))).sort((a, b) => a.len - b.len);   // (40 m: the junctions at the route reach that far)
    for (const g of order) {
      if (drop.has(g.k)) continue;
      let par = 0; const partners = new Map();
      for (const p of samples(g)) {
        const hit = near(p.x, p.z, SIMPLIFY.divMax, new Set([g.k, ...drop])).find((q) => { const h = G[q.k];
          return q.d >= SIMPLIFY.divMin && ONEWAY(h.s) && !h.bridge && h.cls >= 2 && Math.abs(h.cls - g.cls) <= 1 && Math.abs(q.ux * p.ux + q.uz * p.uz) > SIMPLIFY.divAngle; });
        if (hit) { par += p.l; partners.set(hit.k, true); }
      }
      if (par < 20 || par < g.len * SIMPLIFY.divShare) continue;
      drop.add(g.k); moved.set(g.k, [...partners.keys()]);
    }
    // the partners: each point half way towards the dropped half (where one lies within divMax), and two-way
    const shift = new Map();
    for (const [k, ps] of moved) for (const pk of ps) {
      if (drop.has(pk)) continue;
      const P = G[pk];
      P.pts.forEach((p, i) => { if (near40(p.x, p.z)) return; const q = near(p.x, p.z, SIMPLIFY.divMax, null).find((h) => h.k === k); if (q) { const m = shift.get(pk) || new Map(); m.set(i, { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }); shift.set(pk, m); } });
    }
    // (and every other street's point that was that point moves with it: they still meet there)
    const remap = new Map();
    for (const [pk, m] of shift) { const s = S[pk]; for (const [i, p] of m) { const q = quant(p.x, p.z); remap.set(key(s.xy[i]), q); s.xy[i] = q; } s.meta[1] &= ~6; }
    S.forEach((s, k) => { if (shift.has(k)) return; s.xy.forEach((p, i) => { const q = remap.get(key(p)); if (q) s.xy[i] = q.slice(); }); });
    // streets that ended on a dropped half: onto its nearest partner (a point added to it there)
    build();
    let re = 0;
    for (const [k, ps] of moved) {
      const gone = G[k];
      for (const g of G) {
        if (drop.has(g.k)) continue;
        for (const j of [0, g.pts.length - 1]) {
          const e = g.pts[j];
          if (!near(e.x, e.z, 1.5, null).some((q) => q.k === k)) continue;
          const to = near(e.x, e.z, 40, new Set([g.k, ...drop])).find((q) => ps.includes(q.k));
          if (!to) continue;
          const q = quant(to.x, to.z); S[g.k].xy[j] = q; insertPoint(to.k, to.i, q); re++;
        }
      }
      void gone;
    }
    say('divided', `${drop.size} halves dropped, ${shift.size} partners moved to the middle, ${re} street ends moved onto them`);
    remove(drop);
  }

  // 3–6, repeated until nothing changes
  for (let pass = 0; pass < SIMPLIFY.passes; pass++) {
    let changed = 0;
    // 3 snap
    protect();
    if (!SKIP.has('snap')) {
      const use = pointUse(); let n = 0;
      for (const g of G) for (const j of [0, g.pts.length - 1]) {
        const q0 = S[g.k].xy[j], u = use.get(key(q0)) || [];
        if (u.some((o) => o.k !== g.k)) continue;   // already shared
        const e = g.pts[j];
        // another street's end close by: share it
        const ends = near(e.x, e.z, SIMPLIFY.snapEnd, new Set([g.k])).filter((q) => G[q.k].bridge === g.bridge);
        const endHit = ends.map((q) => { const h = G[q.k]; const d0 = Math.hypot(h.pts[0].x - e.x, h.pts[0].z - e.z), d1 = Math.hypot(h.pts.at(-1).x - e.x, h.pts.at(-1).z - e.z); return d0 <= SIMPLIFY.snapEnd ? { k: q.k, j: 0, d: d0 } : d1 <= SIMPLIFY.snapEnd ? { k: q.k, j: h.pts.length - 1, d: d1 } : null; }).filter(Boolean).sort((a, b) => a.d - b.d)[0];
        if (endHit) { S[g.k].xy[j] = S[endHit.k].xy[endHit.j].slice(); n++; continue; }
        const line = near(e.x, e.z, SIMPLIFY.snapLine, new Set([g.k])).find((q) => G[q.k].bridge === g.bridge);
        if (line) { const q = quant(line.x, line.z); S[g.k].xy[j] = q; insertPoint(line.k, line.i, q); n++; }
        else if (g.cls <= 7 && !rides.some(({ index }) => index.nearest(e.x, e.z, 40))) {   // (not at the route: its junctions are shaped round what is there)
          // a road that stops short of one it heads straight into (up to gapM ahead, within gapDeg of its own line):
          // carried on to meet it (a point added at the end) — the gaps a dropped piece or the map left
          const o = g.pts[j === 0 ? 1 : g.pts.length - 2], ux = e.x - o.x, uz = e.z - o.z, ul = Math.hypot(ux, uz) || 1;
          const ahead = near(e.x, e.z, SIMPLIFY.gapM, new Set([g.k])).find((q) => G[q.k].bridge === g.bridge && G[q.k].cls <= 7 && q.d > .3
            && ((q.x - e.x) * ux + (q.z - e.z) * uz) / ul / q.d > Math.cos(SIMPLIFY.gapDeg * Math.PI / 180));
          if (ahead) {
            const q = quant(ahead.x, ahead.z), dk = S[g.k].deck[j];
            if (j === 0) { S[g.k].xy.unshift(q); S[g.k].deck.unshift(dk); } else { S[g.k].xy.push(q); S[g.k].deck.push(dk); }
            insertPoint(ahead.k, ahead.i, q); n++;
          }
        }
      }
      if (n) { say('snap', `${n} street ends joined`); changed += n; }
    }
    // 4 splices
    if (!SKIP.has('splices')) {
      let n = 0;
      for (let guard = 0; guard < 5000; guard++) {
        const use = pointUse(); let joined = false;
        for (const [, u] of use) {
          if (u.length !== 2 || !u[0].end || !u[1].end || u[0].k === u[1].k) continue;
          const A = S[u[0].k], B = S[u[1].k];
          if (A.meta[0] !== B.meta[0] || A.meta[1] !== B.meta[1] || A.meta[2] !== B.meta[2] || A.meta[0] === 0) continue;
          { const p = local(A.xy[u[0].i]); if (rides.some(({ index }) => index.nearest(p.x, p.z, 40))) continue; }   // (not at the route: the ribbons there are fitted to the pieces as they are)
          if (ONEWAY(A)) { // one-way: only head to tail (their directions run on)
            if (!((u[0].i === A.xy.length - 1 && u[1].i === 0) || (u[1].i === B.xy.length - 1 && u[0].i === 0))) continue;
          }
          // A … shared … B
          const a = u[0].i === 0 ? { xy: A.xy.slice().reverse(), deck: A.deck.slice().reverse() } : { xy: A.xy, deck: A.deck };
          const b = u[1].i === 0 ? { xy: B.xy, deck: B.deck } : { xy: B.xy.slice().reverse(), deck: B.deck.slice().reverse() };
          let xy = a.xy.concat(b.xy.slice(1)), deck = a.deck.concat(b.deck.slice(1));
          // (one-way: keep A's direction of travel)
          if (ONEWAY(A) && u[0].i === 0) { xy = xy.reverse(); deck = deck.reverse(); }
          // (never one that runs back over itself — two pieces of a loop sharing more than the point where they meet)
          if (new Set(xy.map(key)).size < xy.length - (key(xy[0]) === key(xy.at(-1)) ? 1 : 0)) continue;
          const keep = { meta: A.meta, xy, deck };
          S = S.filter((_, k) => k !== u[0].k && k !== u[1].k); S.push(keep);
          joined = true; n++; break;
        }
        if (!joined) break;
      }
      if (n) { say('splices', `${n} joins`); changed += n; }
    }
    // 5 stubs
    protect();
    if (!SKIP.has('stubs')) {
      const use = pointUse(), drop = new Set();
      for (const g of G) {
        if (g.cls === 0 || ride.has(g.k) || g.pts.some((p) => near40(p.x, p.z))) continue;   // (the route's junctions and street grades are fitted to what is there)
        const loose = [0, g.pts.length - 1].map((j) => !(use.get(key(S[g.k].xy[j])) || []).some((o) => o.k !== g.k));
        if ((loose[0] && loose[1] && g.len < SIMPLIFY.stubBoth) || ((loose[0] || loose[1]) && g.len < SIMPLIFY.stubLoose)) drop.add(g.k);
      }
      if (drop.size) { say('stubs', `${drop.size} dropped`); changed += drop.size; remove(drop); }
    }
    // 6 overlaps
    protect();
    if (!SKIP.has('overlaps')) {
      const use = pointUse(), drop = new Set();
      const shared = (a, b) => S[a].xy.some((p) => (use.get(key(p)) || []).some((o) => o.k === b));
      const rank = (g) => (ride.has(g.k) ? 1e9 : 0) + (9 - g.cls) * 1e5 + g.len;
      for (const g of G.slice().sort((a, b) => rank(a) - rank(b))) {
        if (g.cls === 0 || ride.has(g.k) || drop.has(g.k) || g.pts.some((p) => near40(p.x, p.z))) continue;
        const over = new Map();
        // (sharing ≥ 3 of its points with another street: drawn on top of it)
        const sharedPts = new Map(); S[g.k].xy.forEach((p) => (use.get(key(p)) || []).forEach((o) => { if (o.k !== g.k && !drop.has(o.k)) sharedPts.set(o.k, (sharedPts.get(o.k) || 0) + 1); }));
        if ([...sharedPts].some(([hk, n]) => n >= 3 && rank(G[hk]) >= rank(g))) { drop.add(g.k); continue; }
        for (const p of samples(g)) {
          for (const q of near(p.x, p.z, 12, new Set([g.k, ...drop]))) {
            const h = G[q.k];
            if (h.bridge !== g.bridge || rank(h) < rank(g)) continue;
            if (q.d < (g.w + h.w) / 2 * SIMPLIFY.overlapK && Math.abs(q.ux * p.ux + q.uz * p.uz) > .8) over.set(q.k, (over.get(q.k) || 0) + p.l);
          }
        }
        for (const [hk, run] of over) {
          // (away from where they meet: a street that shares a point with it overlaps it near that point anyway)
          const need = shared(g.k, hk) ? SIMPLIFY.overlapRun * 2 : SIMPLIFY.overlapRun;
          if (run >= need && run >= g.len * SIMPLIFY.overlapShare) { drop.add(g.k); break; }
        }
      }
      if (drop.size) { say('overlaps', `${drop.size} dropped`); changed += drop.size; remove(drop); }
    }
    if (!changed) break;
  }
  return { streets: S, log };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
  const dry = flag('--dry'), json = opt('--json', null);
  const catalog = JSON.parse(read('routes/parks/index.json'));
  const items = catalog.filter((it) => (args.length ? args.includes(it.id) : it.id.startsWith('pittsburgh')) && it.scene);
  const rideRoutes = loadRides(catalog), report = [];
  for (const item of items) {
    const t0 = Date.now(), scene = loadSceneSync(item.scene);
    if (!scene.cityData) continue;
    const text = read(scene.cityData), city = JSON.parse(text);
    const proj = makeProjection(scene.origin.lat, scene.origin.lon);
    const rides = rideRoutes.map((r) => ({ own: r.id === item.id, index: makeRouteIndex(r.route, proj) }));
    const { streets } = decodeStreets(text);
    const out = simplifyArea({ streets, city, proj, rides });
    console.log(`${item.id}: ${streets.length} → ${out.streets.length} streets  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const l of out.log) console.log(`  ${l.step}: ${l.note}`);
    report.push({ id: item.id, before: streets.length, after: out.streets.length, log: out.log });
    if (!dry) writeFileSync(join(ROOT, scene.cityData), withStreets(text, out.streets));
  }
  if (json) writeFileSync(json, JSON.stringify(report, null, 1));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
