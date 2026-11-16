// Junctions: real intersection geometry for a city's street graph (route-agnostic, pure — no three.js, so the
// course QC and the tests use exactly what the renderer draws).
//
// Streets come from cityStreets() (js/world/city-landscape.js) as independent ribbons that used to overlap at every
// crossing. planJunctions() turns the graph into junctions:
//   1. junction nodes: OSM nodes shared by streets (degree ≥ 3), plus street ends that touch the route's own road
//      (the builder splits streets where the route uses them, and the route line itself is smoothed off the nodes);
//   2. clusters: nodes OSM splits into several close ones (dual carriageways, turn lanes) merge into one junction;
//   3. arms: every street leaving a cluster (and the route's road, in and out), sorted round the centre;
//   4. corners: between neighbouring arms a curb return (fillet of radius `curbR`) — its tangent points give each
//      arm's trim distance; the junction polygon is the arms' mouths joined by the curb returns;
//   5. one surface per junction: a plane through the arms' heights (street-only junctions), or the route's own
//      height across a junction the route passes through (level side to side, following its grade);
//   6. street heights inside a junction become the surface's; just outside they ease back over `easeM` (this is
//      the hand-off to road alignment: see docs/pittsburgh/detail/s2.md);
//   7. pieces: each street's drawn ribbon minus the parts inside junctions; corner sidewalks round each curb return;
//      crosswalks and stop lines at each arm's mouth.
// Bridges, decks and ramps (st.bridge) are left alone, and so are streets that meet at different heights.
//
// Scene key: "junctions": true (or an options object, see DEFAULTS). Off: everything stays as it was.

export const DEFAULTS = {
  mergeM: 7,          // two junction nodes closer than this (or than 0.7 × their widths) are one junction
  maxSpanM: 34,       // …but a cluster never grows wider than this (no chains along a dual carriageway)
  routeReachM: 9,     // a street end this close to the route's centreline (beyond its half-width) meets the route
  levelM: 1.2,        // streets meeting more than this apart in height are crossing, not joining
  maxTrimM: 26,       // an arm is never trimmed further than this from the junction
  easeM: 10,          // street heights ease from the junction surface back to their own over this (at least)
  easeGrade: .05,     // …and over a longer stretch where the step would be steeper than this
  lift: .1,           // junction surface above its height line (streets' ribbons sit .1–.24 above theirs)
  routeGap: .05,      // a junction the route passes through sits this far below the route's road surface
  sidewalkW: 2.5,     // corner sidewalk width (the streets' sidewalks: 2.5 m either side)
  sidewalkLift: .06,  // corner sidewalks above the junction's height line (the streets' sidewalks: city.js, .06)
  crosswalkW: 3,      // crosswalk depth along the arm
  maxSlope: .1,       // a street-only junction's plane is never steeper than this
};

import { denseRoad } from './road-align.js';

const ROAD_LIFT = .12;   // (pose.js) the route's road surface above its line
const CURB_R = (cls) => (cls <= 1 ? 9 : cls <= 3 ? 6 : cls <= 6 ? 4.5 : 3);
const SIDEWALK = (cls) => cls >= 2 && cls <= 6;   // streets that carry sidewalks (city.js)
const CROSSWALK = (cls) => cls >= 2 && cls <= 6;

const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.z * b.z;
const norm = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };
const left = (u) => ({ x: -u.z, z: u.x });   // toward increasing atan2(z, x)
const along = (p, u, t) => ({ x: p.x + u.x * t, z: p.z + u.z * t });
/** Lines p + t·u and q + s·v → [t, s] (null if parallel). */
const meet = (p, u, q, v) => {
  const den = u.x * v.z - u.z * v.x;
  if (Math.abs(den) < 1e-6) return null;
  const w = sub(q, p);
  return [(w.x * v.z - w.z * v.x) / den, (w.x * u.z - w.z * u.x) / den];
};
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const LIFT_BLEND_M = 6;   // a trimmed ribbon's lift blends to the junction surface's over this from the cut
/** Highest a street point can be drawn above its line, given the street ribbons' highest lift (QC). */
export const drawnLiftMax = (p, plan, maxLift) => (p.jd != null && plan ? plan.options.lift + (maxLift - plan.options.lift) * smooth(p.jd / LIFT_BLEND_M) : maxLift);

/** Cumulative arc length along a street's points (cached). */
function arcs(st) {
  if (st._acc) return st._acc;
  const a = new Float64Array(st.pts.length);
  for (let i = 1; i < st.pts.length; i++) a[i] = a[i - 1] + Math.hypot(st.pts[i].x - st.pts[i - 1].x, st.pts[i].z - st.pts[i - 1].z);
  Object.defineProperty(st, '_acc', { value: a, enumerable: false });
  return a;
}
/** Point on a street at arc length s: {x, y, z, i (segment), dx, dz}. */
export function streetPoint(st, s) {
  const acc = arcs(st), P = st.pts, n = P.length;
  s = Math.max(0, Math.min(acc[n - 1], s));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], f = (s - acc[lo]) / ((acc[hi] - acc[lo]) || 1), len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const out = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, i: lo, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
  if (a.tl || b.tl) out.tl = (a.tl || 0) + ((b.tl || 0) - (a.tl || 0)) * f;   // [road meets] trimmed ribbon edges (road-meets.js)
  if (a.tr || b.tr) out.tr = (a.tr || 0) + ((b.tr || 0) - (a.tr || 0)) * f;
  return out;
}

/**
 * The route's road as drawn (world.js: the curved centre line when the scene has roadAlign.curve, else the 10 m
 * samples): at(s) → {x, z, y (line height), tx, tz (unit tangent), rx, rz (unit right)}; project(x, z, s, win) →
 * {s, y, d} (nearest point on the drawn line within ±win metres of s).
 */
export function routeLine(route, index) {
  if (route._line?.index === index) return route._line.line;
  const [R, I] = denseRoad(route, index);
  const n = (R.turnIdx || R.dist.length - 1), D = R.dist;
  const seg = (s) => { let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D[m] <= s) lo = m; else hi = m; } return lo; };
  const tan = (j) => { const a = Math.max(0, j - 1), b = Math.min(n, j + 1), dx = I.xs[b] - I.xs[a], dz = I.zs[b] - I.zs[a], l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
  const at = (s) => {
    s = Math.max(0, Math.min(D[n], s));
    const j = Math.min(n - 1, seg(s)), f = Math.max(0, Math.min(1, (s - D[j]) / ((D[j + 1] - D[j]) || 1)));
    const t0 = tan(j), t1 = tan(j + 1); let tx = t0.x + (t1.x - t0.x) * f, tz = t0.z + (t1.z - t0.z) * f; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // (the road's own vertices take their right vector from the neighbouring samples, as here)
    return { x: I.xs[j] + (I.xs[j + 1] - I.xs[j]) * f, z: I.zs[j] + (I.zs[j + 1] - I.zs[j]) * f, y: R.ele[j] + (R.ele[j + 1] - R.ele[j]) * f, tx, tz, rx: -tz, rz: tx, j, f };
  };
  const project = (x, z, s, win = 40) => {
    let best = null;
    for (let j = Math.max(0, seg(s - win)); j < n && D[j] <= s + win; j++) {
      const ax = I.xs[j], az = I.zs[j], dx = I.xs[j + 1] - ax, dz = I.zs[j + 1] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (!best || d < best.d) best = { d, y: R.ele[j] + (R.ele[j + 1] - R.ele[j]) * t, s: D[j] + (D[j + 1] - D[j]) * t, j };
    }
    return best;
  };
  const line = { route: R, index: I, n, at, project, length: D[n] };
  Object.defineProperty(route, '_line', { value: { index, line }, enumerable: false, configurable: true, writable: true });
  return line;
}

/**
 * Plan every junction. `ctx`: { route, index, end, routeDist(x, z) → {d, i, y}, onRouteBridge(s, margin),
 * roadWidth }. Mutates street heights inside (and just outside) junctions; returns the plan:
 * { list: [junction], cuts: Map k → [[a0, a1]…] (arc-length ranges not drawn), spans: [[s0, s1]] on the route }.
 */
export function planJunctions(streets, ctx, options = {}) {
  const O = { ...DEFAULTS, ...(options === true ? {} : options) };
  const { route, index, end, routeDist } = ctx, RW = ctx.roadWidth || 7;
  const RL = routeLine(route, index);   // [road meets] the road as drawn (its curve), not the 10 m chords
  // ([road meets] decks too: a ramp or a bridge meeting streets at their level is a junction like any other)
  const eligible = (st) => st.cls <= 7 && st.nodes && st.nodeIdx;

  // 0. [road meets] a street crossing the route's road at its level with no OSM node near the crossing (a trail
  // across a street, a street across a riverfront path) gets one there, so the crossing becomes a junction
  const virtual = new Set();
  streets.forEach((st) => {
    if (!eligible(st)) return;
    const P = st.pts;
    for (let i = 1; i < P.length - 1; i++) {
      const r = routeDist(P[i].x, P[i].z);
      if (!r || r.d > RW / 2 || Math.abs(P[i].y - r.y) > O.levelM || (ctx.onRouteBridge && ctx.onRouteBridge(route.dist[r.i], 4))) continue;
      const q = RL.project(P[i].x, P[i].z, route.dist[r.i], 30), t = RL.at(q.s);
      const dx = P[i + 1].x - P[i - 1].x, dz = P[i + 1].z - P[i - 1].z, l = Math.hypot(dx, dz) || 1;
      if (Math.abs((dx * t.tx + dz * t.tz) / l) > .82) continue;   // running along the road, not across it
      if (st.nodes.some((nd) => Math.hypot(nd.x - P[i].x, nd.z - P[i].z) < 10)) continue;   // a node close by will do
      // the point nearest the road's line in this stretch
      let best = i;
      for (let j = i + 1; j < P.length - 1; j++) { const rj = routeDist(P[j].x, P[j].z); if (!rj || rj.d > RW / 2) break; if (rj.d < routeDist(P[best].x, P[best].z).d) best = j; }
      const at = st.nodeIdx.findIndex((ni) => ni > best);
      st.nodeIdx.splice(at, 0, best); st.nodes.splice(at, 0, P[best]);
      virtual.add(`${P[best].x.toFixed(2)},${P[best].z.toFixed(2)}`);
      i = best + 2;
    }
  });

  // 1. nodes and their streets
  const nodes = new Map(), keys = new Map(), byIdx = new Map();
  streets.forEach((st, k) => {
    if (!eligible(st)) return;
    const last = st.nodes.length - 1, ks = st.nodes.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`), bi = new Map();
    keys.set(k, ks); byIdx.set(k, bi);
    st.nodes.forEach((p, j) => {
      const key = ks[j]; bi.set(st.nodeIdx[j], j);
      if (!nodes.has(key)) nodes.set(key, { key, x: p.x, z: p.z, inc: [] });
      nodes.get(key).inc.push({ k, i: st.nodeIdx[j], end: j === 0 || j === last });
    });
  });
  const routeY = (i, x, z) => RL.project(x, z, route.dist[Math.min(end, i)], 35);   // the drawn line's height and distance
  const items = [];
  for (const nd of nodes.values()) {
    const deg = nd.inc.reduce((a, o) => a + (o.end ? 1 : 2), 0);
    const ys = nd.inc.map((o) => streets[o.k].pts[o.i].y), w = Math.max(...nd.inc.map((o) => streets[o.k].width));
    if (Math.max(...ys) - Math.min(...ys) > O.levelM) continue;   // a crossing at different heights
    const r = routeDist(nd.x, nd.z);
    const nearRoute = r && r.d < RW / 2 + Math.max(O.routeReachM, w / 2 + 3) && Math.abs(Math.min(...ys) - r.y) < O.levelM &&
      !(ctx.onRouteBridge && ctx.onRouteBridge(route.dist[r.i], 4));
    if (nearRoute && (nd.inc.some((o) => o.end || deg >= 3) || virtual.has(nd.key))) {
      // only where a street actually leaves the route: a street running along it (the rest of the one the route
      // rides, a few metres off its smoothed line) is the route's own, not a junction
      const q = routeY(r.i, nd.x, nd.z), rt = RL.at(q.s), rd = { x: rt.tx, z: rt.tz };
      const crossing = nd.inc.some((o) => [1, -1].some((dir) => {
        const st = streets[o.k], acc = arcs(st), a = acc[o.i] + dir * 10;
        if (a < -1 || a > acc[acc.length - 1] + 1) return false;
        const p = streetPoint(st, a), u = norm(sub(p, nd));
        return Math.abs(dot(u, rd)) < .82 && Math.hypot(p.x - nd.x, p.z - nd.z) > 2;
      }));
      if (crossing) items.push({ nd, w, route: true, s: q.s, x: nd.x, z: nd.z });
      else if (deg >= 3 && r.d > RW / 2 + w / 2) items.push({ nd, w, route: false, x: nd.x, z: nd.z });
    } else if (deg >= 3) items.push({ nd, w, route: false, x: nd.x, z: nd.z });
    else if (deg === 2 && nd.inc.length === 2 && nd.inc[0].k !== nd.inc[1].k) {
      // [road meets] two streets meeting end to end round a sharp bend (> 50°): a corner junction (a curb return
      // inside, the outside filled), not two ribbons with a notch between their square ends
      const out = nd.inc.map((o) => { const st = streets[o.k], acc = arcs(st), a = acc[o.i] + (o.i === 0 ? 1 : -1) * Math.min(8, acc[acc.length - 1] * .4); return norm(sub(streetPoint(st, a), nd)); });
      if (dot(out[0], out[1]) > -Math.cos(50 * Math.PI / 180)) items.push({ nd, w, route: false, corner: true, x: nd.x, z: nd.z });
    }
  }

  // 2. clusters (union-find; a merge that would make a cluster wider than maxSpanM is refused)
  const parent = items.map((_, i) => i), members = items.map((_, i) => [i]);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grid = new Map(), G = 20;
  items.forEach((it, i) => { const key = `${Math.floor(it.x / G)},${Math.floor(it.z / G)}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i); });
  const pairs = [];
  items.forEach((a, i) => {
    for (let gx = Math.floor(a.x / G) - 1; gx <= Math.floor(a.x / G) + 1; gx++) for (let gz = Math.floor(a.z / G) - 1; gz <= Math.floor(a.z / G) + 1; gz++) {
      for (const j of grid.get(`${gx},${gz}`) || []) {
        if (j <= i) continue;
        const b = items[j], d = Math.hypot(a.x - b.x, a.z - b.z);
        if (a.route && b.route) { if (Math.abs(a.s - b.s) < Math.max(O.mergeM, (a.w + b.w) / 2 + 3) && d < O.maxSpanM) pairs.push([d * .5, i, j]); }
        else if (d < Math.max(O.mergeM, .7 * (a.w + b.w) / 2)) pairs.push([d, i, j]);
      }
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of pairs) {
    const a = find(i), b = find(j);
    if (a === b) continue;
    const all = [...members[a], ...members[b]];
    let span = 0;
    for (const p of all) for (const q of all) span = Math.max(span, Math.hypot(items[p].x - items[q].x, items[p].z - items[q].z));
    if (span > O.maxSpanM) continue;
    if (all.some((m) => items[m].route) && new Set(all.filter((m) => items[m].route).map((m) => Math.round(items[m].s / 60))).size > 2) continue;
    parent[b] = a; members[a] = all;
  }
  const clusters = [...new Set(items.map((_, i) => find(i)))].map((r) => members[r].map((m) => items[m]));

  // node key → cluster index (to find links inside one junction, and the next junction along a street)
  const nodeCluster = new Map();
  clusters.forEach((cl, c) => cl.forEach((it) => nodeCluster.set(it.nd.key, c)));
  const nodeAt = (k, i) => { const j = byIdx.get(k)?.get(i); return j === undefined ? null : keys.get(k)[j]; };

  const list = [], cuts = new Map(), spans = [], clusterToJn = new Map();
  const addCut = (k, a0, a1, d0 = null, d1 = null) => { if (a1 - a0 < .01) return; if (!cuts.has(k)) cuts.set(k, []); cuts.get(k).push([a0, a1, d0, d1]); };
  const heightJobs = [];

  clusters.forEach((cl, c) => {
    const isRoute = cl.some((it) => it.route);
    let C, rq = null;
    if (isRoute) {
      const rs = cl.filter((it) => it.route), s = rs.reduce((a, it) => a + it.s, 0) / rs.length;
      const c0 = RL.at(s);
      C = { x: c0.x, z: c0.z };
      rq = { s };
    } else C = { x: cl.reduce((a, it) => a + it.x, 0) / cl.length, z: cl.reduce((a, it) => a + it.z, 0) / cl.length };

    // 3. arms
    const arms = [], seen = new Set();
    for (const it of cl) {
      for (const o of it.nd.inc) {
        const st = streets[o.k], acc = arcs(st), a0 = acc[o.i], last = st.pts.length - 1;
        for (const dir of [1, -1]) {
          if ((dir > 0 && o.i >= last) || (dir < 0 && o.i <= 0)) continue;
          const tag = `${o.k}:${o.i}:${dir}`;
          if (seen.has(tag)) continue;
          seen.add(tag);
          // walk to the next junction node along the street (or its end)
          let farI = dir > 0 ? last : 0, farInside = false;
          for (let j = byIdx.get(o.k).get(o.i) + dir; j >= 0 && j < st.nodes.length; j += dir) {
            const key = nodeAt(o.k, st.nodeIdx[j]), cc = nodeCluster.get(key);
            if (cc === undefined) continue;
            farI = st.nodeIdx[j]; farInside = cc === c; break;
          }
          const avail = Math.abs(acc[farI] - a0);
          if (farInside) {   // a link between two nodes of this junction: all of it lies inside
            seen.add(`${o.k}:${farI}:${-dir}`);
            addCut(o.k, Math.min(a0, acc[farI]), Math.max(a0, acc[farI]));
            heightJobs.push({ k: o.k, from: Math.min(a0, acc[farI]), to: Math.max(a0, acc[farI]), inside: true, c });
            continue;
          }
          const ahead = streetPoint(st, a0 + dir * Math.min(12, avail * .5)), N = st.pts[o.i];
          const u = norm(sub(ahead, N));
          const far = nodeCluster.has(nodeAt(o.k, farI));
          arms.push({ k: o.k, i: o.i, a0, dir, N: { x: N.x, z: N.z }, u, h: st.width / 2, cls: st.cls, oneway: st.oneway,
            avail, shared: far, theta: Math.atan2(ahead.z - C.z, ahead.x - C.x) });
        }
      }
    }
    if (isRoute) {
      const at = RL.at;
      for (const dir of [-1, 1]) {
        const s1 = rq.s + dir * 12;
        if (s1 < 0 || s1 > route.dist[end]) continue;
        const p = at(s1);
        arms.push({ k: -1, route: true, dir, N: C, u: norm(sub(p, C)), h: RW / 2, cls: 3, oneway: 0, avail: 60, theta: Math.atan2(p.z - C.z, p.x - C.x) });
      }
    }
    const corner = cl.length === 1 && cl[0].corner;   // [road meets] a corner junction: two arms
    if (arms.length < 2 || (!isRoute && !corner && arms.length < 3)) return;
    // streets running along the route inside its corridor (the rest of the street the route rides on) join its arm
    const routeArms = arms.filter((a) => a.route);
    for (const a of arms) {
      if (a.route) continue;
      for (const r of routeArms) if (dot(a.u, r.u) > .94 && Math.abs(dot(sub(a.N, C), left(r.u))) < RW / 2 + a.h) a.alongRoute = r;
    }
    arms.sort((a, b) => a.theta - b.theta);
    const ring = arms.filter((a) => !a.alongRoute);
    if (ring.length < 2 || (!isRoute && !corner && ring.length < 3)) return;

    // 4. corners: curb returns between neighbours
    const n = ring.length, corners = [];
    for (let q = 0; q < n; q++) {
      const A = ring[q], B = ring[(q + 1) % n];
      let gap = B.theta - A.theta; if (gap <= 0) gap += Math.PI * 2;
      if (n === 2 && q === 1) gap = Math.PI * 2 - (ring[1].theta - ring[0].theta);
      const nA = left(A.u), nB = left(B.u);
      const corner = { A, B, gap, arc: null, tA: 0, tB: 0 };
      if (gap < Math.PI * .86 && gap > .3) {
        const r = Math.min(CURB_R(A.cls), CURB_R(B.cls));
        const pA = along(A.N, nA, A.h + r), pB = along(B.N, nB, -(B.h + r));
        const m = meet(pA, A.u, pB, B.u);
        if (m && m[0] > 0 && m[1] > 0 && m[0] < O.maxTrimM && m[1] < O.maxTrimM) {
          const Oc = along(pA, A.u, m[0]);
          corner.tA = dot(sub(Oc, A.N), A.u); corner.tB = dot(sub(Oc, B.N), B.u);
          corner.arc = { O: Oc, r };
        }
      }
      if (!corner.arc && gap < Math.PI * .95) {   // sharp or awkward: the edges' own crossing
        const m = meet(along(A.N, nA, A.h), A.u, along(B.N, nB, -B.h), B.u);
        if (m && m[0] > 0 && m[1] > 0) { corner.tA = Math.min(O.maxTrimM, m[0]); corner.tB = Math.min(O.maxTrimM, m[1]); }
      }
      corners.push(corner);
    }
    // trim distances
    for (let q = 0; q < n; q++) {
      const A = ring[q], before = corners[(q - 1 + n) % n], after = corners[q];
      let t = Math.max(before.tB, after.tA, 1.5);
      // never past the middle of the street to the next junction, nor beyond the street's end
      t = Math.min(t, A.route ? 40 : A.shared ? A.avail * .45 : Math.max(1.5, A.avail - 4));
      A.t = t;
    }
    for (const a of arms) if (a.alongRoute) a.t = Math.min(a.alongRoute.t + 2, a.avail);
    for (const cr of corners) if (cr.arc && (cr.tA > cr.A.t + .01 || cr.tB > cr.B.t + .01)) cr.arc = null;   // clamped short: straight corner

    // 5. the surface's height (line height; drawn at +lift)
    let J;
    if (isRoute) {
      J = (x, z) => RL.project(x, z, rq.s, 45).y + ROAD_LIFT - O.routeGap - O.lift;
    } else {
      const P = ring.map((a) => { const sp = streetPoint(streets[a.k], a.a0 + a.dir * a.t); return { x: sp.x - C.x, z: sp.z - C.z, y: sp.y }; });
      // least squares plane y = c + gx·x + gz·z
      let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
      for (const p of P) { sx += p.x; sz += p.z; sy += p.y; sxx += p.x * p.x; szz += p.z * p.z; sxz += p.x * p.z; sxy += p.x * p.y; szy += p.z * p.y; }
      const m = P.length, mx = sx / m, mz = sz / m, my = sy / m;
      const cxx = sxx / m - mx * mx, czz = szz / m - mz * mz, cxz = sxz / m - mx * mz, cxy = sxy / m - mx * my, czy = szy / m - mz * my;
      const det = cxx * czz - cxz * cxz;
      let gx = 0, gz = 0;
      if (Math.abs(det) > 1e-3) { gx = (cxy * czz - czy * cxz) / det; gz = (czy * cxx - cxy * cxz) / det; }
      const g = Math.hypot(gx, gz); if (g > O.maxSlope) { gx *= O.maxSlope / g; gz *= O.maxSlope / g; }
      const c0 = my - gx * mx - gz * mz;
      J = (x, z) => c0 + gx * (x - C.x) + gz * (z - C.z);
    }

    // 6. polygon (counter-clockwise in x/z), curbs and paint
    const poly = [], curbs = [];
    const edge = (A, side, t) => along(along(A.N, A.u, t), left(A.u), side * A.h);
    // [road meets] each arm's mouth: square to the street (or the road) where it is cut, exactly where its ribbon ends
    for (const A of ring) {
      let P, ud;
      if (A.route) { const p = RL.at(rq.s + A.dir * A.t); P = { x: p.x, z: p.z }; ud = { x: p.tx * A.dir, z: p.tz * A.dir }; }
      else {
        const st = streets[A.k], cs = A.a0 + A.dir * A.t, p = streetPoint(st, cs);
        P = { x: p.x, z: p.z }; ud = norm(sub(streetPoint(st, cs + A.dir * 2.5), streetPoint(st, cs - A.dir * Math.min(2.5, A.t))));
        A.cutS = cs;
      }
      A.cutP = P; A.ud = ud;
      A.mouth = [along(P, left(ud), -A.h), along(P, left(ud), A.h)];
    }
    for (let q = 0; q < n; q++) {
      const A = ring[q], cr = corners[q], B = cr.B;
      poly.push(A.mouth[0], A.mouth[1]);
      const curb = [A.mouth[1]];
      if (cr.arc) {
        if (cr.tA < A.t - .05) curb.push(edge(A, 1, cr.tA));
        const { O: Oc, r } = cr.arc, a0 = Math.atan2(curb[curb.length - 1].z - Oc.z, curb[curb.length - 1].x - Oc.x);
        const pB = cr.tB < B.t - .05 ? edge(B, -1, cr.tB) : B.mouth[0];
        let da = Math.atan2(pB.z - Oc.z, pB.x - Oc.x) - a0;
        while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 9)));
        for (let s = 1; s < steps; s++) curb.push({ x: Oc.x + Math.cos(a0 + da * s / steps) * r, z: Oc.z + Math.sin(a0 + da * s / steps) * r });
        curb.push(pB);
        if (cr.tB < B.t - .05) curb.push(B.mouth[0]);
      } else curb.push(B.mouth[0]);
      for (let s = 1; s < curb.length - 1; s++) poly.push(curb[s]);
      // a corner with a sidewalk on either side gets one wrapping round it (the route's road: its 2 m shoulder)
      const swA = A.route ? 2 : SIDEWALK(A.cls) ? O.sidewalkW : 0, swB = B.route ? 2 : SIDEWALK(B.cls) ? O.sidewalkW : 0;
      if (cr.gap < Math.PI * .95 && (swA || swB)) curbs.push({ pts: curb, wA: swA || swB, wB: swB || swA, arc: !!cr.arc });
    }
    const id = list.length;
    const jn = { id, x: C.x, z: C.z, route: isRoute, s: rq?.s ?? null, arms: ring, extra: arms.filter((a) => a.alongRoute), poly, curbs, J, lift: O.lift };
    list.push(jn); clusterToJn.set(c, id);

    // cuts and heights for the arms
    for (const A of arms) {
      if (A.route) continue;
      const st = streets[A.k];
      // (the drawn ribbon's end edge lies square to the mouth: its direction at the cut, along increasing arc length)
      const ud = A.ud || A.u, inc = { x: ud.x * A.dir, z: ud.z * A.dir };
      if (A.dir > 0) addCut(A.k, A.a0, A.a0 + A.t, null, inc); else addCut(A.k, A.a0 - A.t, A.a0, inc, null);
      heightJobs.push({ k: A.k, a0: A.a0, dir: A.dir, t: A.t, avail: A.avail, J, jn: id });
      A.width = st.width;
    }
    if (isRoute) {
      const rA = ring.filter((a) => a.route), back = rA.find((a) => a.dir < 0), fwd = rA.find((a) => a.dir > 0);
      spans.push({ jn: id, s0: rq.s - (back ? back.t : 0), s1: rq.s + (fwd ? fwd.t : 0) });
    }
  });

  // 7. heights: inside a junction the surface's; past its mouth easing back to the street's own profile
  const own = streets.map((st) => (st.nodes ? st.pts.map((p) => p.y) : null));
  for (const job of heightJobs) {
    const st = streets[job.k], acc = arcs(st), base = own[job.k];
    if (job.inside) {
      const jn = list[clusterToJn.get(job.c)];
      if (!jn) continue;
      for (let i = 0; i < st.pts.length; i++) if (acc[i] >= job.from - 1e-6 && acc[i] <= job.to + 1e-6) { st.pts[i].y = jn.J(st.pts[i].x, st.pts[i].z); st.pts[i].jn = jn.id; }
      continue;
    }
    const cutP = streetPoint(st, job.a0 + job.dir * job.t), cy = base[cutP.i] + (base[Math.min(base.length - 1, cutP.i + 1)] - base[cutP.i]) *
      Math.max(0, Math.min(1, (job.a0 + job.dir * job.t - acc[cutP.i]) / ((acc[Math.min(acc.length - 1, cutP.i + 1)] - acc[cutP.i]) || 1)));
    const step = Math.abs(job.J(cutP.x, cutP.z) - cy);
    const ease = Math.min(Math.max(O.easeM, step / O.easeGrade), Math.max(2, (job.avail - job.t) * (st.nodes ? .5 : 1)));
    for (let i = 0; i < st.pts.length; i++) {
      const d = (acc[i] - job.a0) * job.dir;
      if (d < -1e-6 || d > job.t + ease) continue;
      const p = st.pts[i], Jy = job.J(p.x, p.z);
      if (d <= job.t + 1e-6) { p.y = Jy; p.jn = job.jn; }
      else { const w = 1 - smooth((d - job.t) / ease); p.y = base[i] + (Jy - base[i]) * w; p.je = job.jn; p.jd = Math.min(p.jd ?? Infinity, d - job.t); }
    }
  }
  // 8. never over the route's own road: a street drawn near it (its ribbon within the road + 1 m), or a street-only
  // junction reaching into it, stays under the road surface (the rule cityStreets() applies, on the drawn heights)
  const below = (x, z, y, lift, reach) => {
    let lim = Infinity;
    const q = index.nearest(x, z, RW / 2 + reach + 6);
    if (!q) return y;
    if (q.d < RW / 2 + reach + .5) { const i = q.i > end ? Math.max(0, 2 * end - q.i) : q.i; if (y > route.ele[i] - 4) lim = route.ele[i]; }
    const r = routeDist(x, z);
    if (r && r.d < RW / 2 + reach && y > r.y - 4) lim = Math.min(lim, r.y);
    return lim === Infinity ? y : Math.min(y, lim + ROAD_LIFT - O.routeGap - lift);
  };
  streets.forEach((st, k) => {
    if (!st.nodes || st.bridge) return;
    // ([road meets] each ribbon's own lift when the caller knows it: ctx.liftOf, as city.js draws it)
    for (const p of st.pts) if (p.je != null) p.y = below(p.x, p.z, p.y, drawnLiftMax(p, { options: O }, ctx.liftOf ? ctx.liftOf(k) : .24), st.width / 2 + 1);
  });
  for (const jn of list) {
    if (jn.route || !index.nearest(jn.x, jn.z, O.maxTrimM + O.maxSpanM + RW)) continue;   // (far from the route: nothing to do)
    const J0 = jn.J;
    jn.J = (x, z) => below(x, z, J0(x, z), O.lift, 1);
  }
  // 9. junctions whose surfaces overlap at one height (two close junctions on the route, both at its height) would
  // flicker: the later one sits 12 mm higher (still under the route's road)
  const plan = { list, cuts, spans, options: O };
  for (const jn of list) {
    for (const { jn: o } of junctionsNear(plan, jn.x, jn.z, 40)) {
      if (o.id >= jn.id || o.lift !== jn.lift) continue;
      const hit = jn.poly.find((p) => inside(o.poly, p.x, p.z)) || o.poly.find((p) => inside(jn.poly, p.x, p.z));
      // ([road meets] one the route passes through can't go up — it would reach the road — so it goes 12 mm down)
      if (hit && Math.abs(jn.J(hit.x, hit.z) + jn.lift - o.J(hit.x, hit.z) - o.lift) < .02) { jn.lift += jn.route ? -.012 : .012; break; }
    }
  }
  // 10. [road meets] the surface as drawn: each street's mouth at the height its ribbon arrives at (ribbons are level
  // across, the junction's plane need not be), the rest on the plane; jn.top(x, z) is that surface's height
  const onRoad = (x, z) => { const r = routeDist(x, z); return !!r && r.d < RW / 2 + .8; };
  for (const jn of list) surfaceTops(jn, streets, O, onRoad);
  // 11. [road meets] two streets meeting end to end outside any junction (a street carrying on as another, a street
  // onto a bridge deck): both ribbons end square to the bend's bisector, so no notch opens on its outside
  mitreLinks(streets);
  return plan;
}

/** Vertex heights of a junction's surface (`poly[i].y`, `cy` at the centre) and `jn.top(x, z)`. */
function surfaceTops(jn, streets, O, onRoad) {
  const mouthTop = new Map();
  for (const A of jn.arms) if (!A.route) {
    const y = streetPoint(streets[A.k], A.cutS).y + O.lift;
    // (on the route's road, never above the surface's own height there: that is under the road)
    for (const m of A.mouth) mouthTop.set(m, jn.route && onRoad(m.x, m.z) ? Math.min(y, jn.J(m.x, m.z) + jn.lift) : y);
  }
  for (const v of jn.poly) v.y = mouthTop.has(v) ? mouthTop.get(v) : jn.J(v.x, v.z) + jn.lift;
  jn.cy = jn.J(jn.x, jn.z) + jn.lift;
  const P = jn.poly;
  jn.top = (x, z) => {   // the fan from the centre, as junction-mesh.js draws it
    for (const v of P) if (Math.abs(v.x - x) < 1e-3 && Math.abs(v.z - z) < 1e-3) return v.y;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const d = (a.x - jn.x) * (b.z - jn.z) - (a.z - jn.z) * (b.x - jn.x);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((x - jn.x) * (b.z - jn.z) - (z - jn.z) * (b.x - jn.x)) / d, v = ((a.x - jn.x) * (z - jn.z) - (a.z - jn.z) * (x - jn.x)) / d;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return jn.cy + (a.y - jn.cy) * u + (b.y - jn.cy) * v;
    }
    return jn.J(x, z) + jn.lift;
  };
}

/** Mitre the ends of streets that meet end to end (exactly two street ends at a node, no third street through it). */
export function mitreLinks(streets) {
  const at = new Map();
  streets.forEach((st, k) => {
    if (!st.pts || st.pts.length < 2 || st.cls > 7) return;
    st.pts.forEach((p, i) => {
      const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`, endI = i === 0 ? 0 : i === st.pts.length - 1 ? 1 : -1;
      if (endI < 0 && !at.has(key)) return;
      if (!at.has(key)) at.set(key, []);
      at.get(key).push({ k, i, end: endI >= 0 });
    });
  });
  // (a node first seen as a street's inner point is added only once one end reaches it: re-check inner points)
  streets.forEach((st, k) => { if (!st.pts || st.cls > 7) return; for (let i = 1; i < st.pts.length - 1; i++) { const key = `${st.pts[i].x.toFixed(2)},${st.pts[i].z.toFixed(2)}`, l = at.get(key); if (l && !l.some((o) => o.k === k && o.i === i)) l.push({ k, i, end: false }); } });
  for (const l of at.values()) {
    if (l.length !== 2 || !l.every((o) => o.end) || l[0].k === l[1].k) continue;
    const out = l.map((o) => { const st = streets[o.k], p = st.pts[o.i], q = st.pts[o.i === 0 ? 1 : o.i - 1]; return norm(sub(q, p)); });
    if (dot(out[0], out[1]) > -.5) continue;   // a sharp bend (> 60°): left square
    const t = norm(sub(out[1], out[0]));   // travelling from the first street into the second
    l.forEach((o, j) => {
      const p = streets[o.k].pts[o.i], ends = o.i !== 0;   // does this street end here (travel runs along its arc)?
      const sg = (j === 0) === ends ? 1 : -1;
      p.tx = t.x * sg; p.tz = t.z * sg;
    });
  }
}

/**
 * [road meets] Road paint at the junctions (pure: junction-mesh.js draws exactly these, the course QC checks them):
 * a continental crosswalk across each street arm (2–6 classes) of a junction of three or more arms, square to the
 * street just outside its mouth, a stop line across the lanes coming in, and a crosswalk across the route's road at
 * each mouth of a junction the route passes through where it is a street (`routeKindAt(s) === 'road'`).
 * Nothing is painted on the route's road except its own crosswalks, nor inside or against another junction, nor
 * where the block is too short. ctx: { route, index, routeDist, roadWidth, liftOf(k), routeKindAt(s) }.
 * → { quads: [{ jn, kind, pts: [4 × {x, y, z}] }], bad: [{ jn, kind, why }] (left out, by rule) }
 */
export function junctionPaint(plan, streets, ctx) {
  if (plan._paint) return plan._paint;
  const O = plan.options, JL = O.lift, RW = ctx.roadWidth || 7, RL = routeLine(ctx.route, ctx.index);
  const quads = [], bad = [];
  junctionsNear(plan, 0, 0, 0);   // (the lookup grid)
  const inJunction = (self, p, pad) => junctionsNear(plan, p.x, p.z, pad).some(({ jn, d }) => jn !== self && d < pad);
  const onRoad = (p) => {   // (on or under the road as drawn: its curve)
    const r = ctx.routeDist(p.x, p.z); if (!r) return false;
    const q = RL.project(p.x, p.z, ctx.route.dist[Math.min(RL.n, r.i)], 25) || r;
    return q.d < RW / 2 + .5 && Math.abs(q.y + ROAD_LIFT - p.y) < 4;
  };
  for (const jn of plan.list) {
    const busy = jn.arms.length >= 3;
    for (const A of jn.arms) {
      if (A.route || !busy || !CROSSWALK(A.cls)) continue;
      const st = streets[A.k], lift = ctx.liftOf ? ctx.liftOf(A.k) : JL;
      const at = (d, side) => {   // a point on the arm d from its node, `side` metres to the left, at the ribbon's top
        const p = streetPoint(st, A.a0 + A.dir * d), nx = -p.dz * A.dir, nz = p.dx * A.dir;
        return { x: p.x + nx * side, z: p.z + nz * side, y: p.y + JL + (lift - JL) * smooth((d - A.t) / LIFT_BLEND_M) + .014 };
      };
      const d0 = A.t + .5, d1 = d0 + O.crosswalkW, h = A.h - .5;
      if (A.shared ? d1 + 1 > A.avail * .5 : d1 + 1 > A.avail) continue;   // the block is too short for one
      const box = [at(d0, -A.h), at(d0, A.h), at(d1 + 1.6, A.h), at(d1 + 1.6, -A.h)];
      // (the box's corners, edges and middle, every metre: the road may cross it between its corners)
      const probe = [];
      for (let dd = d0; dd <= d1 + 1.6 + 1e-6; dd += Math.max(.5, (d1 + 1.6 - d0) / 4)) for (let sd = -A.h; sd <= A.h + 1e-6; sd += Math.max(.5, A.h / 4)) probe.push(at(dd, sd));
      if (probe.some((p) => onRoad(p))) { bad.push({ jn: jn.id, kind: 'crosswalk', why: 'would lie on the route’s road' }); continue; }
      if (box.some((p) => inJunction(jn, p, 1.5))) { bad.push({ jn: jn.id, kind: 'crosswalk', why: 'would lie in another junction' }); continue; }
      const bars = Math.max(2, Math.floor((2 * h) / 1.1));
      for (let q = 0; q < bars; q++) {
        const s0 = -h + (2 * h) * (q + .25) / bars, s1 = -h + (2 * h) * (q + .75) / bars;
        quads.push({ jn: jn.id, kind: 'crosswalk', pts: [at(d0, s0), at(d0, s1), at(d1, s1), at(d1, s0)] });
      }
      const inbound = A.oneway === 0 ? [-A.h + .3, -.15] : A.oneway * A.dir < 0 ? [-A.h + .3, A.h - .3] : null;
      if (inbound) { const ds = d1 + 1.1; quads.push({ jn: jn.id, kind: 'stop', pts: [at(ds, inbound[0]), at(ds, inbound[1]), at(ds + .45, inbound[1]), at(ds + .45, inbound[0])] }); }
    }
  }
  // the route's own crosswalks, across its road just outside each mouth of a junction it passes through
  const W = O.crosswalkW, total = RL.length;
  const spans = plan.spans.map((sp) => ({ ...sp, s0: Math.max(0, sp.s0), s1: Math.min(total, sp.s1) })).filter((sp) => sp.s1 - sp.s0 > 1);
  for (const sp of spans) {
    const jn = plan.list[sp.jn];
    if (jn.arms.length < 3 || !jn.arms.some((o) => !o.route && CROSSWALK(o.cls))) continue;
    for (const [d0, sgn] of [[sp.s0 - .5, -1], [sp.s1 + .5, 1]]) {
      const a0 = sgn > 0 ? d0 : d0 - W, a1 = sgn > 0 ? d0 + W : d0;
      if (a0 < 5 || a1 > total - 5 || spans.some((o) => o !== sp && o.s0 - 2 < a1 + 1.5 && o.s1 + 2 > a0 - 1.5)) continue;   // no room before the next junction
      if (ctx.routeKindAt && ctx.routeKindAt((a0 + a1) / 2) !== 'road') continue;   // a trail: no street approach
      const pt = (s, side) => { const r = RL.at(s); return { x: r.x + r.rx * side, z: r.z + r.rz * side, y: r.y + ROAD_LIFT + .008 }; };
      const box = [pt(a0, -RW / 2), pt(a0, RW / 2), pt(a1, RW / 2), pt(a1, -RW / 2)];
      if (box.some((p) => inJunction(null, p, .3))) { bad.push({ jn: jn.id, kind: 'route-crosswalk', why: 'would lie in a junction' }); continue; }
      for (let q = 0; q < 6; q++) {
        const u0 = -3 + 6 * (q + .2) / 6, u1 = -3 + 6 * (q + .8) / 6;
        quads.push({ jn: jn.id, kind: 'route-crosswalk', pts: [pt(a0, u0), pt(a0, u1), pt(a1, u1), pt(a1, u0)] });
      }
    }
  }
  const out = { quads, bad };
  Object.defineProperty(plan, '_paint', { value: out, enumerable: false, configurable: true });
  return out;
}

const inside = (ring, x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r; } return r; };

/** Junctions within `reach` of (x, z): [{jn, d}] (d: distance to the surface's outline, negative inside). */
export function junctionsNear(plan, x, z, reach) {
  if (!plan) return [];
  const G = 32;
  if (!plan._grid) {
    const grid = new Map();
    for (const jn of plan.list) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of jn.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      jn.bb = [x0, x1, z0, z1];
      for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
        const key = `${gx},${gz}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(jn);
      }
    }
    Object.defineProperty(plan, '_grid', { value: grid, enumerable: false });
  }
  const out = [], seen = new Set();
  for (let gx = Math.floor((x - reach) / G); gx <= Math.floor((x + reach) / G); gx++) for (let gz = Math.floor((z - reach) / G); gz <= Math.floor((z + reach) / G); gz++) {
    for (const jn of plan._grid.get(`${gx},${gz}`) || []) {
      if (seen.has(jn) || x < jn.bb[0] - reach || x > jn.bb[1] + reach || z < jn.bb[2] - reach || z > jn.bb[3] + reach) continue;
      seen.add(jn);
      let d = Infinity;
      for (let i = 0, j = jn.poly.length - 1; i < jn.poly.length; j = i++) {
        const a = jn.poly[j], b = jn.poly[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        d = Math.min(d, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
      }
      if (inside(jn.poly, x, z)) d = -d;
      if (d < reach) out.push({ jn, d });
    }
  }
  return out;
}

/**
 * The ground round a junction (city-landscape.js heightAt): under the surface and its corner sidewalks just below
 * them; never above them for 6.5 m more (like the streets' own flat verges), easing out by 14 m. → height
 */
export function junctionGround(plan, x, z, h) {
  for (const { jn, d } of junctionsNear(plan, x, z, 14)) {
    const top = jn.J(x, z) - .12;
    if (d < 2.6) h = top;
    else h = Math.min(h, top + Math.max(0, d - 6.5) * .6);
  }
  return h;
}

/**
 * The parts of a street that are drawn: its points split where junctions cut it, with exact end points at the
 * cuts. → [[{x, y, z, cut?}…]…] (each at least two points).
 */
export function streetPieces(st, cuts) {
  if (!cuts || !cuts.length) return [st.pts];
  const acc = arcs(st), total = acc[acc.length - 1];
  const merged = cuts.map((c) => [Math.max(0, c[0]), Math.min(total, c[1]), c[2], c[3]]).sort((a, b) => a[0] - b[0]);
  const keep = [];
  let from = 0, fromDir = null;
  for (const [a, b, d0, d1] of merged) { if (a > from + .3) keep.push([from, a, fromDir, d0]); if (b >= from) { from = b; fromDir = d1; } }
  if (total > from + .3) keep.push([from, total, fromDir, null]);
  // [road meets] a cut end carries the direction its ribbon's end edge is square to (tx, tz: city-geometry.js ribbon)
  const end = (s, cut, d) => ({ ...streetPoint(st, s), cut, ...(cut && d ? { tx: d.x, tz: d.z } : {}) });
  return keep.map(([a, b, da, db]) => {
    const out = [a > 0 ? end(a, true, da) : { ...st.pts[0], cut: false }];
    for (let i = 0; i < st.pts.length; i++) if (acc[i] > a + .05 && acc[i] < b - .05) out.push(st.pts[i]);
    out.push(b < total ? end(b, true, db) : { ...st.pts[st.pts.length - 1], cut: false });
    return out;
  });
}

/**
 * QC: how much street surface is drawn on top of other street surface at (nearly) the same height — the
 * overlapping ribbons junctions are meant to remove. Samples every drawn carriageway's centreline every 2 m and
 * counts the metres that lie inside another street's drawn carriageway (or inside a junction surface that isn't
 * its own) within ±0.6 m in height. Works with or without a plan (without: every street drawn whole).
 * ctx: { routeDist } (optional) also counts metres under the route's own road. → { overlapM, junctionOverlapM,
 * routeOverlapM, spots: [{x, z, m}] (worst first) }
 */
export function streetOverlaps(streets, plan = null, ctx = {}) {
  const G = 24, grid = new Map(), segs = [];
  const drawn = (st) => !st.bridge && st.cls <= 7;
  streets.forEach((st, k) => {
    if (!drawn(st)) return;
    for (const pc of plan ? streetPieces(st, plan.cuts.get(k)) : [st.pts]) {
      for (let i = 1; i < pc.length; i++) {
        const a = pc[i - 1], b = pc[i], id = segs.length, r = st.width / 2;
        segs.push({ k, a, b, r });
        for (let gx = Math.floor((Math.min(a.x, b.x) - r) / G); gx <= Math.floor((Math.max(a.x, b.x) + r) / G); gx++)
          for (let gz = Math.floor((Math.min(a.z, b.z) - r) / G); gz <= Math.floor((Math.max(a.z, b.z) + r) / G); gz++) {
            const key = `${gx},${gz}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(id);
          }
      }
    }
  });
  const jgrid = new Map();
  for (const jn of plan?.list || []) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of jn.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    jn._bb = [x0, x1, z0, z1];
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
      const key = `${gx},${gz}`; if (!jgrid.has(key)) jgrid.set(key, []); jgrid.get(key).push(jn);
    }
  }
  const inPoly = (ring, x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r; } return r; };
  let overlapM = 0, junctionOverlapM = 0, routeOverlapM = 0;
  const spots = new Map();
  for (const s of segs) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), n = Math.max(1, Math.round(len / 2));
    for (let q = 0; q < n; q++) {
      const f = (q + .5) / n, x = s.a.x + (s.b.x - s.a.x) * f, z = s.a.z + (s.b.z - s.a.z) * f, y = s.a.y + (s.b.y - s.a.y) * f, m = len / n;
      let hit = false;
      for (const id of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) || []) {
        const o = segs[id];
        if (o.k === s.k) continue;
        const dx = o.b.x - o.a.x, dz = o.b.z - o.a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - o.a.x) * dx + (z - o.a.z) * dz) / l2));
        if (Math.hypot(o.a.x + dx * t - x, o.a.z + dz * t - z) < o.r && Math.abs(o.a.y + (o.b.y - o.a.y) * t - y) < .6) { hit = true; break; }
      }
      if (hit) {
        overlapM += m;
        const key = `${Math.floor(x / 40)},${Math.floor(z / 40)}`, sp = spots.get(key) || { x, z, m: 0 }; sp.m += m; spots.set(key, sp);
      }
      for (const jn of jgrid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) || []) {
        if (x < jn._bb[0] || x > jn._bb[1] || z < jn._bb[2] || z > jn._bb[3]) continue;
        if (jn.arms.some((a) => a.k === s.k) || jn.extra.some((a) => a.k === s.k)) continue;
        if (inPoly(jn.poly, x, z) && Math.abs(jn.J(x, z) - y) < .6) { junctionOverlapM += m; break; }
      }
      if (ctx.routeDist) {
        const r = ctx.routeDist(x, z);
        if (r && r.d < (ctx.roadWidth || 7) / 2 && Math.abs(r.y - y) < .6 && !(plan && (plan.list.some((jn) => jn.route && jn._bb && x >= jn._bb[0] && x <= jn._bb[1] && z >= jn._bb[2] && z <= jn._bb[3] && inPoly(jn.poly, x, z))))) routeOverlapM += m;
      }
    }
  }
  return { overlapM: Math.round(overlapM), junctionOverlapM: Math.round(junctionOverlapM), routeOverlapM: Math.round(routeOverlapM),
    spots: [...spots.values()].sort((a, b) => b.m - a.m).slice(0, 20).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z), m: Math.round(p.m) })) };
}
