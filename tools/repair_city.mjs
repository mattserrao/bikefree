#!/usr/bin/env node
// Repair the stored city street data near the routes: the "roads to nowhere" tools/qc_map.mjs finds, fixed in
// routes/scenes/<area>-city.json without re-fetching OpenStreetMap (tools/build_city.py drops tunnels, splits ways where
// the route rides them and at cleared polygons, and keeps ways only within 900 m of the route: loose ends follow).
//
//   node tools/repair_city.mjs                         every Pittsburgh area
//   node tools/repair_city.mjs pittsburgh-westend      one area (catalog ids)
//   options: --dry (report, write nothing)   --near 300 (only ends / pieces within m of the area's route)
//            --rules interchange,near-miss,stub,dead-end,end-step,deck-end (only these rules; default: all)
//            --json out.json (every repair, what was left and why, the tunnel approaches)
//
// Only the `streets` block of the city JSON changes (the rest of the file stays byte for byte); streets keep their order
// (a dropped street's entry is removed: nothing stored refers to a street by its index — see `INDEX REFERENCES` below).
// interchange: thinning at interchanges (see thinPass below: service roads and paths between ramps, ramps far from every
// route, minor ribbons beside a carriageway) — run first in each pass; then the qc_map-driven rules.
// Rules (an end or piece within --near of the route; never a street along any Pittsburgh route, the ride network):
//   near-miss   an end 1.5–12 m short of another street, pointing at it (≤ 45°), at its height (≤ 1.2 m; or a deck above
//               a ground street long enough to ramp up to it): extended onto it, with a node shared by both (the
//               junction planner's); an end overshooting a junction by ≤ 12 m (the street it nears lies behind it):
//               trimmed back to that junction's node
//   stub        a piece < 25 m meeting something at one end only (no other street ends on it or only meets it): dropped
//   dead-end    a highway / link / primary piece < 150 m (secondary / tertiary < 60 m) meeting nothing at one end (not at
//               the data's edge or the corridor's, not a tunnel approach: the ground 15–80 m ahead rises 6 m over the
//               end), nothing else ending on it: dropped
//   end-step    a ground street ending at a deck above it: its last metres become a deck ramp (≤ 10 % grade, appended as
//               a street of its own); a deck ending on ground streets below: those ending there ramp up, else
//   deck-end    the deck is trimmed back to its last node at the ground or meeting another street at its own height;
//               dropped if it all floats (and < 150 m). Ends already level in the stored data (run-time heights) are left.
// highways (user, 20 Nov: "highways, their on- and off-ramps aren't drawn logically, and they're not important for the
//             game"): every ramp (link, cls 1) is dropped — none at all; highways (cls 0) are kept only on the city's
//             two main corridors (the Parkway East / I-279 / I-579 / Route 28 system and the west side: Ohio River Blvd
//             and the West End / Saw Mill Run), whose lines are in tools/city/pittsburgh-highways-keep.json (chosen on
//             the highways map); every other highway piece is dropped. A street a route rides is never
//             dropped (listed instead). Runs first, before the other rules clean up what it leaves.
// Tunnel approaches (a highway, link or primary ending at a hillside: the tunnel way was dropped) are listed, not
// fixed (a later "portals" job). Repeats until nothing changes (a second run changes nothing).
//
// INDEX REFERENCES: street indices exist only at run time (cityStreets() keeps one entry per stored street, in order:
// junction plans, street slots, street-kit / lamp seeds, streetsNear()). Nothing stored refers to one: the scene JSON
// (mainStreets: by route distance; qcAccept: by route distance), tools/city/*.json (dropStreets: OSM way ids, used by
// build_city.py only), tools/city/*.network.json (lat / lon nodes), the city JSON itself (bridges, routeKinds… by
// coordinates or route distance). So a street is removed from the packed arrays; later streets shift down by one
// (their hash-seeded lamp / tree placements reshuffle: cosmetic).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { qcMap, MAP_LIMITS } from './qc_map.mjs';
import { loadSceneSync } from './qc_course.mjs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { STREET_W } from '../js/world/toolbox/city/landscape.js';
import { ROAD_WIDTH } from '../js/world/pose.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

export const REPAIR = {
  near: 300,          // m from the area's route: ends / pieces farther out are left
  aim: 45,            // °: a near-miss end must point at the street it faces within this
  stub: MAP_LIMITS.stub,
  dead: 150,          // m: a highway / link / primary piece this short with a loose end is a fragment
  hill: 6,            // m: the ground 15–80 m ahead of a loose major-road end rises this far over it: a tunnel approach
  deckDrop: 150,      // m: a deck that floats all along is dropped only if this short
  rideM: 4,           // m (+ half the street's width + half the road's): a street point this close to a route rides it
  rideShare: .3,      //    …a street with this share of its points (or ≥ 30 m) along one is the ride network's: never touched
  passes: 6,
};

// ---------- codec: the packed `streets` block (tools/build_city.py; decoded as in js/world/toolbox/city/landscape.js) ----------
const b64 = (t) => { const b = Buffer.from(t, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pack = (Type, arr) => Buffer.from(new Type(arr).buffer).toString('base64');
const STREETS_RE = /"streets":\{"count":\d+,"meta":\[[\d,]*\],"starts":"[^"]*","xy":"[^"]*","deck":"[^"]*"\}/g;

/** The `streets` block of a city JSON text → [{ meta: [cls, flags, layer+8], xy: [[qlat, qlon]…], deck: [u16…] }…] + the text's slice. */
export function decodeStreets(text) {
  const m = [...text.matchAll(STREETS_RE)];
  if (m.length !== 1) throw new Error(`expected one packed streets block, found ${m.length}`);
  const S = JSON.parse(`{${m[0][0]}}`).streets;
  const starts = new Uint32Array(b64(S.starts)), xy = new Int16Array(b64(S.xy)), deck = new Uint16Array(b64(S.deck));
  const streets = [];
  for (let k = 0; k < S.count; k++) {
    const pts = [], dk = [];
    for (let i = starts[k]; i < starts[k + 1]; i++) { pts.push([xy[i * 2], xy[i * 2 + 1]]); dk.push(deck[i]); }
    streets.push({ meta: S.meta.slice(k * 3, k * 3 + 3), xy: pts, deck: dk });
  }
  return { streets, at: m[0].index, len: m[0][0].length };
}

/** Streets → the packed block's JSON text (key order and formatting as tools/build_city.py writes it). */
export function encodeStreets(streets) {
  const starts = [0], xy = [], deck = [], meta = [];
  for (const st of streets) { for (const p of st.xy) xy.push(p[0], p[1]); deck.push(...st.deck); starts.push(starts.at(-1) + st.xy.length); meta.push(...st.meta); }
  return `"streets":${JSON.stringify({ count: streets.length, meta, starts: pack(Uint32Array, starts), xy: pack(Int16Array, xy), deck: pack(Uint16Array, deck) })}`;
}

/** The city JSON text with its streets replaced (everything else byte-identical). */
export function withStreets(text, streets) {
  const d = decodeStreets(text);
  return text.slice(0, d.at) + encodeStreets(streets) + text.slice(d.at + d.len);
}

// ---------- geometry of the stored streets (local metres; heights: a deck node's own, else the bare ground) ----------
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const polyLen = (P) => { let l = 0; for (let i = 1; i < P.length; i++) l += dist(P[i - 1], P[i]); return l; };

function geometry(streets, city, proj, ground) {
  const [lat0, lon0] = city.origin, unit = city.unit;
  const local = ([a, o]) => proj.toLocal(lat0 + a * unit, lon0 + o * unit);
  const quant = (x, z) => { const g = proj.toLatLon(x, z); const q = [Math.round((g.lat - lat0) / unit), Math.round((g.lon - lon0) / unit)]; if (Math.abs(q[0]) > 32767 || Math.abs(q[1]) > 32767) throw new Error('point outside the Int16 range'); return q; };
  const G = streets.map((s, k) => {
    const pts = s.xy.map(local), bridge = !!(s.meta[1] & 1);
    const h = pts.map((p, i) => (bridge && s.deck[i] ? 150 + s.deck[i] / 10 : ground(p.x, p.z)));
    return { k, pts, h, cls: s.meta[0], bridge, layer: s.meta[2] - 8, w: STREET_W[s.meta[0]], len: polyLen(pts) };
  });
  const cell = 20, grid = new Map(), key = (i, j) => i * 100003 + j;
  G.forEach((g) => { for (let i = 1; i < g.pts.length; i++) { const a = g.pts[i - 1], b = g.pts[i];
    for (let gx = Math.floor(Math.min(a.x, b.x) / cell); gx <= Math.floor(Math.max(a.x, b.x) / cell); gx++)
      for (let gz = Math.floor(Math.min(a.z, b.z) / cell); gz <= Math.floor(Math.max(a.z, b.z) / cell); gz++) { const kk = key(gx, gz); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([g.k, i]); } } });
  /** Every street segment within r of (x, z), but street `skip` (or a set): [{ k, i (segment i-1 → i), t, d, x, z, y }], nearest first, one per street. */
  const near = (x, z, r, skip = -1) => {
    const best = new Map();
    for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++) for (let gz = Math.floor((z - r) / cell); gz <= Math.floor((z + r) / cell); gz++)
      for (const [k, i] of grid.get(key(gx, gz)) || []) {
        if (k === skip || skip?.has?.(k)) continue;
        const g = G[k], a = g.pts[i - 1], b = g.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
        if (d <= r && !(best.get(k)?.d <= d)) best.set(k, { k, i, t, d, x: px, z: pz, y: g.h[i - 1] + (g.h[i] - g.h[i - 1]) * t });
      }
    return [...best.values()].sort((a, b) => a.d - b.d);
  };
  return { G, near, quant, local };
}

/** Which streets lie along a Pittsburgh route (the ride network: any area's route) — never touched. */
function rideStreets(G, rides, ownIndex) {
  const out = new Set();
  for (const g of G) {
    if (g.cls > 7) continue;
    const r = REPAIR.rideM + g.w / 2 + ROAD_WIDTH / 2;
    for (const { index, own } of rides) {
      let along = 0;
      for (let i = 1; i < g.pts.length; i++) {
        const a = g.pts[i - 1], b = g.pts[i], l = dist(a, b), n = Math.max(1, Math.ceil(l / 5));
        for (let m = 0; m < n; m++) {
          const x = a.x + (b.x - a.x) * (m + .5) / n, z = a.z + (b.z - a.z) * (m + .5) / n, q = index.nearest(x, z, r);
          if (!q || q.d > r) continue;
          const j = Math.min(index.xs.length - 2, q.i), tx = index.xs[j + 1] - index.xs[j], tz = index.zs[j + 1] - index.zs[j];
          if (Math.abs(tx * (b.x - a.x) + tz * (b.z - a.z)) / ((Math.hypot(tx, tz) * l) || 1) > .9) along += l / n;
        }
      }
      if (along >= 25 || (!own && along >= g.len * .5 && g.len > 0)) { out.add(g.k); break; }
    }
  }
  return out;
}

const deckOf = (h) => Math.max(1, Math.round((h - 150) * 10));

/**
 * Interchange thinning (rule `interchange`): too many roads drawn around the highways. In scope (within `near` of the
 * area's route, or within THIN.ixReach of a link road: every interchange), never a street a route rides:
 *   between   a service road (cls 7) or a pedestrian / path piece (6, 8), < THIN.betweenMax m (a longer one is a real
 *             trail), not a deck, lying between ramps: for ≥ half its
 *             length a highway / link ribbon within THIN.box m on both sides (service roads also: hugging one within
 *             THIN.hug m of its edge) — dropped
 *   ramp      a link road (cls 1) no route rides, every point > THIN.rampReach m from every Pittsburgh route — dropped
 *             with the far link pieces joined to it (the carriageways stay; nobody rides past it up close)
 *   parallel  a minor piece (tertiary…path, < THIN.parMax m) running beside a kept highway / link / primary
 *             (≤ THIN.parAngle° apart, edges < THIN.parGap m apart, within 4.5 m in height) for ≥ THIN.parShare of its
 *             length and ≥ THIN.parMin m (a shorter one is a junction's stub): a frontage / duplicate ribbon — dropped; a secondary piece only where drawn over it (a duplicate)
 *   orphan    a service / pedestrian / path piece (or any < 25 m piece) left meeting nothing at either end — dropped
 * Nothing is dropped that would leave a kept residential-or-bigger street or a deck ending on nothing, on only service
 * roads / paths, or on no street at its own height (qc_map's dead-end / near-miss / end-step / deck-end).
 */
/**
 * [highways] The highway corridors to keep: tools/city/pittsburgh-highways-keep.json (the lines of the corridors the user
 * chose, from the highways map), as a lookup "is (x, z) on a kept corridor" (within `r` m of one).
 */
export const KEEP_FILE = 'tools/city/pittsburgh-highways-keep.json';
export function highwayCorridors({ r = 4 } = {}) {
  const K = new Map(), kk = (x, z) => Math.floor(x / 5) * 100003 + Math.floor(z / 5);
  let total = 0;
  for (const P of JSON.parse(read(KEEP_FILE)).corridors) for (let j = 1; j < P.length; j++) {
    const [ax, az] = P[j - 1], [bx, bz] = P[j], l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / 2)); total += l;
    for (let m = 0; m <= n; m++) { const x = ax + (bx - ax) * m / n, z = az + (bz - az) * m / n, k = kk(x, z); if (!K.has(k)) K.set(k, []); K.get(k).push([x, z]); }
  }
  const on = (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [px, pz] of K.get((Math.floor(x / 5) + a) * 100003 + Math.floor(z / 5) + b) || []) if (Math.hypot(px - x, pz - z) <= r) return true; return false; };
  return { on, keptM: Math.round(total) };
}

/** [highways] Drop every ramp and every highway piece off the kept corridors (never a street a route rides). */
export function highwayPass({ streets, city, proj, ground, index, rides, corridors }) {
  const { G } = geometry(streets, city, proj, ground);
  const ride = rideStreets(G, rides, null), drop = new Set(), kept = [], changes = [];
  for (const g of G) {
    if (g.cls > 1) continue;
    if (ride.has(g.k)) { kept.push({ k: g.k, cls: g.cls, why: 'a route rides it' }); continue; }
    const onShare = g.cls === 0 ? g.pts.filter((p) => corridors.on(p.x, p.z)).length / g.pts.length : 0;
    if (g.cls === 1 || onShare < .8) {
      drop.add(g.k);
      const m = g.pts[Math.floor(g.pts.length / 2)];
      changes.push({ rule: g.cls === 1 ? 'hw-ramp' : 'hw-off-corridor', k: g.k, cls: g.cls, x: Math.round(m.x), z: Math.round(m.z), lenM: Math.round(g.len) });
    }
  }
  return { streets: streets.filter((_, k) => !drop.has(k)), changes, kept };
}

export const THIN = { ixReach: 150, rampReach: 150, box: 40, hug: 10, share: .5, parGap: 6, parAngle: 15, parShare: .6, parMin: 20, parMax: 200, betweenMax: 150, step: 5 };

export function thinPass({ streets, city, proj, ground, index, rides, near }) {
  const { G, near: around } = geometry(streets, city, proj, ground);
  const ride = rideStreets(G, rides), M = MAP_LIMITS, T = THIN;
  const drop = new Set(), changes = [];
  const toRoute = (p) => { const r = index.nearest(p.x, p.z, near + 1); return r ? r.d : Infinity; };
  const anyRoute = (p, r) => rides.some(({ index: ix }) => { const q = ix.nearest(p.x, p.z, r + 1); return q && q.d <= r; });
  const C = 50, ck = (x, z) => Math.floor(x / C) * 100003 + Math.floor(z / C), Rc = Math.ceil(T.ixReach / C), ix = new Set();
  for (const g of G) if (g.cls === 1) for (const p of g.pts) for (let a = -Rc; a <= Rc; a++) for (let b = -Rc; b <= Rc; b++) ix.add((Math.floor(p.x / C) + a) * 100003 + Math.floor(p.z / C) + b);
  const inScope = (p) => ix.has(ck(p.x, p.z)) || toRoute(p) <= near;
  /** Points every `step` m along street g, with the unit heading there. */
  const samples = (g, step = T.step) => {
    const out = [];
    for (let i = 1; i < g.pts.length; i++) {
      const a = g.pts[i - 1], b = g.pts[i], l = dist(a, b); if (l < .01) continue;
      const n = Math.max(1, Math.round(l / step));
      for (let m = 0; m < n; m++) { const t = (m + .5) / n; out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: g.h[i - 1] + (g.h[i] - g.h[i - 1]) * t, hx: (b.x - a.x) / l, hz: (b.z - a.z) / l, l: l / n }); }
    }
    return out;
  };
  // every street end: the streets it meets (by index) and whether it meets the route's road
  const ends = G.map((g) => [0, g.pts.length - 1].map((j) => { const e = g.pts[j], hits = around(e.x, e.z, M.join, g.k); return { e, on: hits.map((h) => h.k), level: hits.filter((h) => Math.abs(h.y - g.h[j]) <= M.endStep).map((h) => h.k), route: toRoute(e) <= ROAD_WIDTH / 2 + g.w / 2 + M.join }; }));
  const loose = (k, j, gone) => !ends[k][j].route && ends[k][j].on.every((o) => gone.has(o));
  const weak = (k, j, gone) => !ends[k][j].route && ends[k][j].on.some((o) => gone.has(o)) && !ends[k][j].on.some((o) => !gone.has(o) && G[o].cls <= 5);
  // (a kept end left meeting nothing but service roads and paths, or losing every street at its own height: loose, or a step up / down to a deck — qc_map's end-step, deck-end)
  const unlevel = (k, j, gone) => !ends[k][j].route && ends[k][j].level.some((o) => gone.has(o)) && ends[k][j].level.every((o) => gone.has(o));
  const byEnd = new Map(); ends.forEach((two, k) => two.forEach(({ on }) => on.forEach((o) => { if (!byEnd.has(o)) byEnd.set(o, new Set()); byEnd.get(o).add(k); })));
  /** Would dropping the streets `set` leave a kept residential-or-bigger street ending on nothing? → its index, else -1 */
  const strands = (set) => {
    const gone = new Set([...drop, ...set]);
    for (const k of set) for (const o of byEnd.get(k) || []) if (!gone.has(o) && (G[o].cls <= 5 || G[o].bridge) && (weak(o, 0, gone) || weak(o, 1, gone) || unlevel(o, 0, gone) || unlevel(o, 1, gone))) return o;
    return -1;
  };
  const log = (rule, g, note) => { const p = g.pts[Math.floor(g.pts.length / 2)]; changes.push({ rule, k: g.k, cls: g.cls, x: +p.x.toFixed(1), z: +p.z.toFixed(1), note }); };
  const tryDrop = (rule, list, note) => { if (list.some((g) => ride.has(g.k) || drop.has(g.k))) return false; if (strands(new Set(list.map((g) => g.k))) >= 0) return false; for (const g of list) { drop.add(g.k); log(rule, g, note(g)); } return true; };

  // ramp: link pieces far from every route, dropped chain by chain (pieces joined end to end, or one's end on the other)
  const far = new Set(G.filter((g) => g.cls === 1 && !ride.has(g.k) && !samples(g, 10).some((p) => anyRoute(p, T.rampReach))).map((g) => g.k));
  const seen = new Set();
  for (const k0 of far) {
    if (seen.has(k0)) continue;
    const comp = [G[k0]]; seen.add(k0);
    for (let q = 0; q < comp.length; q++) for (const k of [...ends[comp[q].k][0].on, ...ends[comp[q].k][1].on, ...(byEnd.get(comp[q].k) || [])]) {
      if (!far.has(k) || seen.has(k)) continue;
      seen.add(k); comp.push(G[k]);
    }
    tryDrop('ix-ramp', comp, (o) => `${o.len.toFixed(0)} m link (${comp.length > 1 ? `a ${comp.length}-piece ramp ` : ''}> ${T.rampReach} m from every route) dropped`);
  }
  // between: service / pedestrian / path pieces between ramps
  for (const g of G) {
    if (g.cls < 6 || g.bridge || g.len > T.betweenMax || ride.has(g.k) || drop.has(g.k)) continue;
    const S = samples(g); if (!S.length) continue;
    let inside = 0, boxed = 0, hug = 0;
    for (const p of S) {
      if (!inScope(p)) continue;
      inside += p.l;
      let L = false, R = false, H = false;
      for (const h of around(p.x, p.z, T.box, new Set([g.k, ...drop]))) {
        const o = G[h.k]; if (o.cls > 1) continue;
        const side = p.hx * (h.z - p.z) - p.hz * (h.x - p.x);
        if (side > 0) L = true; else R = true;
        if (h.d - o.w / 2 - g.w / 2 < T.hug) H = true;
      }
      if (L && R) boxed += p.l; if (H) hug += p.l;
    }
    const total = S.reduce((a, p) => a + p.l, 0);
    if (inside < total * T.share) continue;
    const share = g.cls === 7 ? Math.max(boxed, hug) : boxed;
    if (share >= total * T.share) tryDrop('ix-between', [g], () => `${g.len.toFixed(0)} m ${['', '', '', '', '', '', 'pedestrian', 'service', 'path'][g.cls]} piece between ramps dropped`);
  }
  // parallel: minor frontage / duplicate pieces beside a kept carriageway
  for (const g of G) {
    if (g.cls < 3 || g.len >= T.parMax || ride.has(g.k) || drop.has(g.k)) continue;
    const S = samples(g); if (!S.length || !inScope(S[Math.floor(S.length / 2)])) continue;
    let run = 0;
    for (const p of S) {
      const ok = around(p.x, p.z, g.w / 2 + 7.5 + T.parGap, new Set([g.k, ...drop])).some((h) => {
        const o = G[h.k]; if (o.cls > 2 || o.bridge !== g.bridge || Math.abs(h.y - p.y) > 4.5 || h.d - o.w / 2 - g.w / 2 > (g.cls === 3 ? 0 : T.parGap)) return false;
        const a = o.pts[h.i - 1], b = o.pts[h.i], l = dist(a, b) || 1;
        return Math.abs(((b.x - a.x) * p.hx + (b.z - a.z) * p.hz) / l) >= Math.cos(T.parAngle * Math.PI / 180);
      });
      if (ok) run += p.l;
    }
    if (run >= g.len * T.parShare && run >= T.parMin) tryDrop('ix-parallel', [g], () => `${g.len.toFixed(0)} m ${['', '', '', 'secondary', 'tertiary', 'residential', 'pedestrian', 'service', 'path'][g.cls]} piece beside a carriageway (${run.toFixed(0)} m within ${T.parGap} m) dropped`);
  }
  // orphans the drops leave (repeat: a chain of them)
  for (let again = true; again;) {
    again = false;
    for (const g of G) {
      if (drop.has(g.k) || ride.has(g.k) || g.pts.length < 2 || g.len >= (g.cls < 6 ? M.stub : 60)) continue;
      if ([...(byEnd.get(g.k) || [])].some((o) => !drop.has(o))) continue;   // a kept street ends on it
      if (!inScope(g.pts[0]) && !inScope(g.pts.at(-1))) continue;
      if (!loose(g.k, 0, drop) || !loose(g.k, 1, drop)) continue;
      // it met something before the drops (else it is the data's own: left alone)
      if (!ends[g.k][0].on.length && !ends[g.k][1].on.length) continue;
      if (tryDrop('ix-orphan', [g], () => `${g.len.toFixed(0)} m piece left meeting nothing dropped`)) again = true;
    }
  }
  return { streets: streets.filter((s, k) => !drop.has(k)), changes };
}

/**
 * One repair pass over an area's streets, driven by qc_map's findings (`near` m of the route).
 * → { streets (new list), changes: [{ rule, k, x, z, note }], tunnels: [...], left: [...] }
 */
function repairPass({ streets, city, proj, ground, index, findings, rides, near, rules }) {
  const { G, near: around, quant } = geometry(streets, city, proj, ground);
  const ride = rideStreets(G, rides);
  const M = MAP_LIMITS, R = REPAIR;
  const toRoute = (p) => { const r = index.nearest(p.x, p.z, 5000); return r ? r.d : Infinity; };
  const onRoad = (g, p) => toRoute(p) <= ROAD_WIDTH / 2 + g.w / 2 + M.join;
  const changes = [], tunnels = [], left = [], done = new Set(), drop = new Set(), append = [];
  const edit = new Map();   // k → new { xy, deck } (and meta)
  const cur = (k) => edit.get(k) || { meta: streets[k].meta, xy: streets[k].xy.slice(), deck: streets[k].deck.slice() };
  const endOf = (g, f) => { const j = dist(g.pts[0], f) <= dist(g.pts.at(-1), f) ? 0 : g.pts.length - 1; return dist(g.pts[j], f) < 5 ? j : -1; };
  const inward = (g, j) => { const n = g.pts.length; for (let s = 1; s < n; s++) { const i = j === 0 ? s : n - 1 - s; if (dist(g.pts[i], g.pts[j]) > 1) return i; } return -1; };
  const touches = (g, p) => around(p.x, p.z, M.join, new Set([g.k, ...drop])).length > 0 || onRoad(g, p);
  /** Other streets' ends lying on street g away from its point E (they'd be stranded if g went). */
  const dependants = (g, keepNear) => {
    const out = [];
    for (const p of g.pts) for (const h of around(p.x, p.z, 12, new Set([g.k, ...drop]))) {
      const o = G[h.k];
      for (const e of [o.pts[0], o.pts.at(-1)]) {
        if (keepNear && dist(e, keepNear) < 2) continue;
        let on = false; for (let i = 1; i < g.pts.length && !on; i++) { const a = g.pts[i - 1], b = g.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((e.x - a.x) * dx + (e.z - a.z) * dz) / l2)); on = Math.hypot(a.x + dx * t - e.x, a.z + dz * t - e.z) <= M.join; }
        if (on && !out.includes(o.k)) out.push(o.k);
      }
    }
    return out;
  };
  /** Streets whose end at E meets nothing but street g there (dropping g would leave them loose). */
  const stranded = (g, E) => around(E.x, E.z, M.join, new Set([g.k, ...drop])).map((h) => G[h.k]).filter((o) => {
    const e = dist(o.pts[0], E) <= M.join ? o.pts[0] : dist(o.pts.at(-1), E) <= M.join ? o.pts.at(-1) : null;
    return e && !onRoad(o, e) && around(e.x, e.z, M.join, new Set([o.k, g.k, ...drop])).length === 0;
  });
  const deadLimit = (cls) => (cls <= 2 ? R.dead : cls <= 4 ? 60 : 0);
  /** A loose major-road end running into a hillside: the ground 15–80 m ahead rises `hill` m over the end. */
  const tunnelAhead = (g, j) => {
    const i = inward(g, j); if (i < 0) return false;
    const E = g.pts[j], P = g.pts[i], l = dist(P, E), ux = (E.x - P.x) / l, uz = (E.z - P.z) / l;
    for (let s = 15; s <= 80; s += 5) if (ground(E.x + ux * s, E.z + uz * s) - g.h[j] > R.hill) return true;
    return false;
  };
  const log = (rule, g, p, note) => changes.push({ rule, k: g.k, cls: g.cls, x: +p.x.toFixed(1), z: +p.z.toFixed(1), note });
  const nearF = findings.filter((f) => f.routeM != null && f.routeM <= near && (!rules || rules.includes(f.check)));

  // 1. near-miss: extend the loose end onto the street it faces
  for (const f of nearF.filter((f) => f.check === 'near-miss')) {
    const g = G[f.street], skip = (why) => left.push({ check: 'near-miss', x: f.x, z: f.z, why });
    if (!g || done.has(g.k)) continue;
    if (ride.has(g.k)) { skip('a street along a route'); continue; }
    const j = endOf(g, f), i = j < 0 ? -1 : inward(g, j); if (i < 0) { skip('end not found in the stored data'); continue; }
    const E = g.pts[j], P = g.pts[i], l = dist(P, E), ux = (E.x - P.x) / l, uz = (E.z - P.z) / l;
    if (touches(g, E)) { skip('meets a street in the stored data (moved at run time)'); continue; }
    const cand = around(E.x, E.z, M.nearMiss + .5, new Set([g.k, ...drop])).filter((h) => {
      if (h.d < M.join - .3) return false;
      const c = ((h.x - E.x) * ux + (h.z - E.z) * uz) / h.d;
      if (c < Math.cos(R.aim * Math.PI / 180) || done.has(h.k)) return false;
      // at its height, or a deck above a ground street long enough to ramp up to it (the next pass makes the ramp)
      const dy = h.y - g.h[j];
      return Math.abs(dy) <= M.endStep || (!g.bridge && G[h.k].bridge && dy > 0 && g.len + h.d >= dy / .10 + 5);
    });
    if (!cand.length) {
      // an end overshooting a junction (the street it nears lies behind it): trimmed back to that junction's node
      const n = g.pts.length;
      let at = -1, run = 0;
      for (let st = 1; st < n - 1; st++) {
        const ii = j === 0 ? st : n - 1 - st, prev = j === 0 ? ii - 1 : ii + 1;
        run += dist(g.pts[prev], g.pts[ii]);
        if (run > M.nearMiss) break;
        if (touches(g, g.pts[ii])) { at = ii; break; }
      }
      if (at >= 0) {
        const keep = j === 0 ? [at, n] : [0, at + 1], cut = { ...g, pts: j === 0 ? g.pts.slice(0, at + 1) : g.pts.slice(at) };
        const dep = dependants(cut, g.pts[at]);
        if (!dep.length) {
          const raw = streets[g.k];
          edit.set(g.k, { meta: raw.meta, xy: raw.xy.slice(...keep), deck: raw.deck.slice(...keep) }); done.add(g.k);
          log('near-miss', g, E, `${run.toFixed(1)} m overshoot past a junction trimmed`);
          continue;
        }
      }
      const any = around(E.x, E.z, M.nearMiss + .5, new Set([g.k, ...drop]))[0];
      const ang = any && Math.acos(Math.max(-1, Math.min(1, ((any.x - E.x) * ux + (any.z - E.z) * uz) / (any.d || 1)))) * 180 / Math.PI;
      skip(any ? `the nearest street (${any.d.toFixed(1)} m) lies ${ang.toFixed(0)}° off its heading, ${(any.y - g.h[j]).toFixed(1)} m above / below` : 'no street within 12 m in the stored data');
      continue;
    }
    const h = cand[0], T = G[h.k];
    // snap to the faced street's node if one is close, else put a node there (a shared node: the junction planner's)
    const a = T.pts[h.i - 1], b = T.pts[h.i], snap = dist(a, h) < 1 ? h.i - 1 : dist(b, h) < 1 ? h.i : -1;
    let q, y = h.y;
    if (snap >= 0) { q = streets[T.k].xy[snap]; y = T.h[snap]; }
    else {
      q = quant(h.x, h.z);
      if (!ride.has(T.k)) { const t = cur(T.k); t.xy.splice(h.i, 0, q); t.deck.splice(h.i, 0, T.bridge && streets[T.k].deck[h.i - 1] && streets[T.k].deck[h.i] ? deckOf(h.y) : 0); edit.set(T.k, t); done.add(T.k); }
    }
    const s = cur(g.k), dk = g.bridge && streets[g.k].deck[j] ? deckOf(y) : 0;
    if (j === 0) { s.xy.unshift(q); s.deck.unshift(dk); } else { s.xy.push(q); s.deck.push(dk); }
    edit.set(g.k, s); done.add(g.k);
    log('near-miss', g, E, `extended ${h.d.toFixed(1)} m onto street ${T.k}`);
  }

  // 2. end-step / deck-end: ramps and trims
  const ramp = (g, j, H, layer) => {   // a ground street's end at E climbs on a deck to height H (split off as its own deck street)
    const dy = H - g.h[j], need = dy / .10;
    if (dy <= 0 || g.len < need + 5) return false;
    const Lr = Math.min(g.len - 5, Math.max(need, dy / .07));
    const P = j === 0 ? g.pts : [...g.pts].reverse(), raw = streets[g.k], xy = j === 0 ? raw.xy.slice() : raw.xy.slice().reverse();
    let acc = 0, s = 1; while (s < P.length && acc + dist(P[s - 1], P[s]) < Lr) { acc += dist(P[s - 1], P[s]); s++; }
    if (s >= P.length) return false;
    const t = (Lr - acc) / dist(P[s - 1], P[s]), S = { x: P[s - 1].x + (P[s].x - P[s - 1].x) * t, z: P[s - 1].z + (P[s].z - P[s - 1].z) * t };
    let rampXY, groundXY, rampP;
    if (dist(S, P[s - 1]) < 3 && s - 1 > 0) { rampXY = xy.slice(0, s); groundXY = xy.slice(s - 1); rampP = P.slice(0, s); }
    else if (dist(S, P[s]) < 3 && s < P.length - 1) { rampXY = xy.slice(0, s + 1); groundXY = xy.slice(s); rampP = P.slice(0, s + 1); }
    else { const q = quant(S.x, S.z); rampXY = [...xy.slice(0, s), q]; groundXY = [q, ...xy.slice(s)]; rampP = [...P.slice(0, s), S]; }
    if (groundXY.length < 2) return false;
    const L = polyLen(rampP), y0 = ground(rampP.at(-1).x, rampP.at(-1).z);
    if ((H - y0) / L > .101) return false;
    let a = 0; const rampDeck = rampP.map((p, m) => { if (m) a += dist(rampP[m - 1], p); return deckOf(H + (y0 - H) * a / L); });
    const meta = [g.cls, raw.meta[1] | 1, layer + 8];
    const fix = (arr) => (j === 0 ? arr : arr.reverse());
    edit.set(g.k, { meta: raw.meta, xy: fix(groundXY), deck: fix(groundXY.map(() => 0)) });
    append.push({ meta, xy: fix(rampXY), deck: fix(rampDeck) });
    done.add(g.k);
    return { L, dy };
  };
  const trim = (g, j, rule) => {   // a deck end back to its last node at the ground or meeting another street at its own height
    const n = g.pts.length;
    for (let s = 1; s < n; s++) {
      const i = j === 0 ? s : n - 1 - s, p = g.pts[i];
      const grounded = !streets[g.k].deck[i] || Math.abs(g.h[i] - ground(p.x, p.z)) <= M.deckAir;
      const meets = around(p.x, p.z, M.join, new Set([g.k, ...drop])).some((h) => Math.abs(h.y - g.h[i]) <= M.endStep);
      if (!grounded && !meets) continue;
      const keep = j === 0 ? [i, n] : [0, i + 1], cut = j === 0 ? g.pts.slice(0, i) : g.pts.slice(i + 1);
      if (keep[1] - keep[0] < 2 || polyLen(g.pts.slice(...keep)) < 2) break;   // nothing left: drop below
      const dep = dependants({ ...g, pts: j === 0 ? g.pts.slice(0, i + 1) : g.pts.slice(i) }, p).filter((k) => k !== g.k);
      if (dep.length) { left.push({ check: rule, x: g.pts[j].x, z: g.pts[j].z, why: `streets ${dep} end on the part to cut` }); return true; }
      const raw = streets[g.k];
      edit.set(g.k, { meta: raw.meta, xy: raw.xy.slice(...keep), deck: raw.deck.slice(...keep) }); done.add(g.k);
      log(rule, g, g.pts[j], `deck trimmed back ${polyLen(j === 0 ? g.pts.slice(0, i + 1) : g.pts.slice(i)).toFixed(0)} m to its last node ${grounded ? 'at the ground' : 'meeting a street at its height'}`);
      return true;
    }
    // it all floats: drop (a short piece nothing else ends on)
    if (g.len < R.deckDrop && !dependants(g).length) { drop.add(g.k); done.add(g.k); log(rule, g, g.pts[j], `${g.len.toFixed(0)} m deck floats all along: dropped`); return true; }
    left.push({ check: rule, x: g.pts[j].x, z: g.pts[j].z, why: 'a long floating deck' });
    return true;
  };
  for (const f of nearF.filter((f) => f.check === 'end-step' || f.check === 'deck-end')) {
    const g = G[f.street]; if (!g || done.has(g.k) || drop.has(g.k) || ride.has(g.k)) continue;
    const j = endOf(g, f); if (j < 0) continue;
    const E = g.pts[j];
    if (f.check === 'deck-end') { trim(g, j, 'deck-end'); continue; }
    const hits = around(E.x, E.z, M.join, new Set([g.k, ...drop]));
    if (!hits.length || hits.some((h) => Math.abs(h.y - g.h[j]) <= M.endStep)) { left.push({ check: 'end-step', x: f.x, z: f.z, why: 'level in the stored data (heights moved at run time)' }); continue; }
    const ownDeck = g.bridge && streets[g.k].deck[j];
    if (!ownDeck) {
      // a ground street reaching a deck above it: its end becomes a ramp up to the deck
      const d = hits.filter((h) => G[h.k].bridge && h.y > g.h[j]).sort((a, b) => a.y - b.y)[0];
      const r = d && ramp(g, j, d.y, G[d.k].layer);
      if (r) log('end-step', g, E, `last ${r.L.toFixed(0)} m made a ramp climbing ${r.dy.toFixed(1)} m to the deck of street ${d.k}`);
      else left.push({ check: 'end-step', x: f.x, z: f.z, why: d ? 'too short for a ramp at ≤ 10 %' : 'the deck it reaches lies below the ground' });
      continue;
    }
    // a deck ending on ground streets below it: those ending there ramp up to it, else the deck is trimmed back
    const gr = hits.map((h) => G[h.k]).filter((o) => !o.bridge && !done.has(o.k) && !ride.has(o.k) && (dist(o.pts[0], E) <= M.join || dist(o.pts.at(-1), E) <= M.join));
    let ok = false;
    for (const o of gr) { const jj = dist(o.pts[0], E) <= M.join ? 0 : o.pts.length - 1, r = g.h[j] > o.h[jj] && ramp(o, jj, g.h[j], g.layer); if (r) { ok = true; log('end-step', o, E, `last ${r.L.toFixed(0)} m made a ramp climbing ${r.dy.toFixed(1)} m to the deck of street ${g.k}`); } }
    if (!ok) trim(g, j, 'end-step');
  }

  // 3. dead fragments: short major-road pieces with a loose end (tunnel approaches listed, not touched)
  for (const f of nearF.filter((f) => f.check === 'dead-end' && f.severity !== 'info')) {
    const g = G[f.street]; if (!g) continue;
    const j = endOf(g, f); if (j < 0) continue;
    if (g.cls <= 2 && tunnelAhead(g, j)) { tunnels.push({ x: +g.pts[j].x.toFixed(1), z: +g.pts[j].z.toFixed(1), cls: g.cls, lenM: Math.round(g.len), k: g.k }); continue; }
    if (done.has(g.k) || drop.has(g.k) || ride.has(g.k)) continue;
    if (g.len >= deadLimit(g.cls)) { left.push({ check: 'dead-end', x: f.x, z: f.z, why: `${Math.round(g.len)} m: too long to be a fragment` }); continue; }
    const other = g.pts[j === 0 ? g.pts.length - 1 : 0];
    const dep = dependants(g, other), str = stranded(g, other).filter((o) => o.len >= deadLimit(o.cls));
    if (dep.length || str.length) { left.push({ check: 'dead-end', x: f.x, z: f.z, why: `streets ${[...dep, ...str.map((o) => o.k)]} meet it` }); continue; }
    drop.add(g.k); done.add(g.k);
    log('dead-end', g, g.pts[j], `${Math.round(g.len)} m fragment dropped`);
  }

  // 4. stubs: a short piece meeting something at one end only
  for (const f of nearF.filter((f) => f.check === 'stub')) {
    const g = G[f.street]; if (!g || done.has(g.k) || drop.has(g.k) || ride.has(g.k) || g.len >= R.stub || g.cls > 5) continue;
    const met = [g.pts[0], g.pts.at(-1)].map((p) => touches(g, p));
    if (met[0] === met[1]) continue;
    const E = met[0] ? g.pts[0] : g.pts.at(-1);
    const dep = dependants(g, E), str = stranded(g, E);
    if (dep.length || str.length) { left.push({ check: 'stub', x: f.x, z: f.z, why: `streets ${[...dep, ...str.map((o) => o.k)]} meet it` }); continue; }
    drop.add(g.k); done.add(g.k);
    log('stub', g, g.pts[met[0] ? g.pts.length - 1 : 0], `${g.len.toFixed(0)} m stub dropped`);
  }

  const out = [];
  streets.forEach((s, k) => { if (!drop.has(k)) out.push(edit.get(k) || s); });
  out.push(...append);
  return { streets: out, changes, tunnels, left };
}

/** Areas left out of a run with no area named: why. */
export const HOLD = {};   // (pittsburgh-polish was held for F336; the user chose to skip that one life check instead, 20 Nov)

const CHECKS = ['near-miss', 'stub', 'dead-end', 'end-step', 'deck-end'];
/** Counts of the repaired checks: { check: [near, total] } (dead-end: fail and warn only). */
export function counts(findings, near) {
  const c = {};
  for (const k of CHECKS) { const f = findings.filter((x) => x.check === k && (k !== 'dead-end' || x.severity !== 'info')); c[k] = [f.filter((x) => x.routeM != null && x.routeM <= near).length, f.length]; }
  return c;
}

/** Repair one area's city JSON text. → { text, before, after, changes, tunnels, left, passes } */
export function repairArea({ item, scene, text, near = REPAIR.near, rides, rules = null, corridors = null, log = () => {} }) {
  const route = buildCatalogRoute(read(item.file), item); route.scene = scene;
  const o = scene.origin, proj = makeProjection(o.lat, o.lon), index = makeRouteIndex(route, proj);
  const city0 = JSON.parse(text);
  const L = landscapeBuilder(scene)({ ...scene, city: city0 }, proj, index, route);
  const ground = L.baseHeight || L.heightAt;
  const rideIdx = rides.map((r) => ({ own: r.id === item.id, index: makeRouteIndex(r.route, proj) }));
  const qc = (t) => qcMap({ id: item.id, name: item.name, gpxText: read(item.file), item, scene: { ...scene, city: JSON.parse(t) }, near: 0 }).findings;
  let findings = qc(text);
  const before = counts(findings, near), changes = [];
  let tunnels = [], left = [], passes = 0;
  const thin = !rules || rules.includes('interchange');
  let rideHighways = [];
  if (corridors && (!rules || rules.includes('highways'))) {
    const h = highwayPass({ streets: decodeStreets(text).streets, city: JSON.parse(text), proj, ground, index, rides: rideIdx, corridors });
    rideHighways = h.kept;
    if (h.changes.length) { changes.push(...h.changes.map((c) => ({ ...c, pass: 0 }))); log(`  highways: ${h.changes.length} dropped (${h.changes.filter((c) => c.rule === 'hw-ramp').length} ramps)${h.kept.length ? `, ${h.kept.length} kept: a route rides them` : ''}`); text = withStreets(text, h.streets); findings = qc(text); }
  }
  for (; passes < REPAIR.passes; passes++) {
    let n = 0;
    if (thin) {
      const t = thinPass({ streets: decodeStreets(text).streets, city: JSON.parse(text), proj, ground, index, rides: rideIdx, near });
      if (t.changes.length) {
        n += t.changes.length; changes.push(...t.changes.map((c) => ({ ...c, pass: passes + 1 })));
        log(`  pass ${passes + 1}: ${t.changes.length} interchange drops`);
        text = withStreets(text, t.streets); findings = qc(text);
      }
    }
    const city = JSON.parse(text);
    const r = repairPass({ streets: decodeStreets(text).streets, city, proj, ground, index, findings, rides: rideIdx, near, rules });
    tunnels = r.tunnels; left = r.left;
    if (!r.changes.length && !n) break;
    if (!r.changes.length) continue;
    changes.push(...r.changes.map((c) => ({ ...c, pass: passes + 1 })));
    log(`  pass ${passes + 1}: ${r.changes.length} repairs`);
    text = withStreets(text, r.streets);
    findings = qc(text);
  }
  return { text, before, after: counts(findings, near), changes, tunnels, left, passes, rideHighways };
}

/** Every Pittsburgh route (the ride network), for "never touch a street a route rides". */
export function loadRides(catalog) {
  return catalog.filter((it) => it.id.startsWith('pittsburgh') && it.scene).map((it) => ({ id: it.id, route: buildCatalogRoute(read(it.file), it) }));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const near = Number(opt('--near', String(REPAIR.near))), dry = flag('--dry'), json = opt('--json', null), rules = opt('--rules', null)?.split(',') ?? null;
  const catalog = JSON.parse(read('routes/parks/index.json'));
  const items = catalog.filter((it) => (args.length ? args.includes(it.id) : it.id.startsWith('pittsburgh') && !HOLD[it.id]) && it.scene);
  for (const id of Object.keys(HOLD)) if (!args.length) console.log(`${id}: held (${HOLD[id]}; name it to repair it)`);
  const rides = loadRides(catalog), report = [];
  // [highways] the corridors to keep, from every Pittsburgh area's data (not only the areas named)
  const corridors = !rules || rules.includes('highways') ? highwayCorridors() : null;
  if (corridors) console.log(`highways: keeping ${(corridors.keptM / 1000).toFixed(1)} km of corridor lines (${KEEP_FILE})`);
  const fmt = (c) => CHECKS.map((k) => `${k} ${c[k][0]}/${c[k][1]}`).join('  ');
  for (const item of items) {
    const t0 = Date.now(), scene = loadSceneSync(item.scene);
    if (!scene.cityData) continue;
    const text = read(scene.cityData);
    console.log(`${item.id}:`);
    const r = repairArea({ item, scene, text, near, rides, rules, corridors, log: console.log });
    if (!dry && r.text !== text) writeFileSync(join(ROOT, scene.cityData), r.text);
    const by = {}; for (const c of r.changes) by[c.rule] = (by[c.rule] || 0) + 1;
    console.log(`  before  ${fmt(r.before)}   (within ${near} m / total)\n  after   ${fmt(r.after)}\n  repairs ${JSON.stringify(by)}  ${r.text === text ? 'unchanged' : dry ? '(dry: not written)' : `→ ${scene.cityData}`}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const t of r.tunnels) console.log(`  tunnel approach (left for the portals job): ${['highway', 'link', 'primary'][t.cls]} end at x ${t.x}, z ${t.z} (${t.lenM} m piece)`);
    report.push({ id: item.id, ...r, text: undefined });
  }
  if (json) writeFileSync(json, JSON.stringify(report, null, 1));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
