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
  routeGap: .03,      // a junction the route passes through sits this far below the route's road surface
  sidewalkW: 2.5,     // corner sidewalk width (the streets' sidewalks: 2.5 m either side)
  sidewalkLift: .06,  // corner sidewalks above the junction's height line (the streets' sidewalks: city.js, .06)
  crosswalkW: 3,      // crosswalk depth along the arm
  maxSlope: .1,       // a street-only junction's plane is never steeper than this
};

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
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, i: lo, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
}

/**
 * Plan every junction. `ctx`: { route, index, end, routeDist(x, z) → {d, i, y}, onRouteBridge(s, margin),
 * roadWidth }. Mutates street heights inside (and just outside) junctions; returns the plan:
 * { list: [junction], cuts: Map k → [[a0, a1]…] (arc-length ranges not drawn), spans: [[s0, s1]] on the route }.
 */
export function planJunctions(streets, ctx, options = {}) {
  const O = { ...DEFAULTS, ...(options === true ? {} : options) };
  const { route, index, end, routeDist } = ctx, RW = ctx.roadWidth || 7;
  const eligible = (st) => !st.bridge && st.cls <= 7 && st.nodes && st.nodeIdx;

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
  const routeY = (i, x, z) => {   // the route's line height by projection onto the segments around sample i
    let best = null;
    for (let j = Math.max(0, i - 3); j < Math.min(end, i + 3); j++) {
      const ax = index.xs[j], az = index.zs[j], dx = index.xs[j + 1] - ax, dz = index.zs[j + 1] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (!best || d < best.d) best = { d, y: route.ele[j] + (route.ele[j + 1] - route.ele[j]) * t, s: route.dist[j] + (route.dist[j + 1] - route.dist[j]) * t, j, t };
    }
    return best;
  };
  const items = [];
  for (const nd of nodes.values()) {
    const deg = nd.inc.reduce((a, o) => a + (o.end ? 1 : 2), 0);
    const ys = nd.inc.map((o) => streets[o.k].pts[o.i].y), w = Math.max(...nd.inc.map((o) => streets[o.k].width));
    if (Math.max(...ys) - Math.min(...ys) > O.levelM) continue;   // a crossing at different heights
    const r = routeDist(nd.x, nd.z);
    const nearRoute = r && r.d < RW / 2 + Math.max(O.routeReachM, w / 2 + 3) && Math.abs(Math.min(...ys) - r.y) < O.levelM &&
      !(ctx.onRouteBridge && ctx.onRouteBridge(route.dist[r.i], 4));
    if (nearRoute && nd.inc.some((o) => o.end || deg >= 3)) {
      // only where a street actually leaves the route: a street running along it (the rest of the one the route
      // rides, a few metres off its smoothed line) is the route's own, not a junction
      const q = routeY(r.i, nd.x, nd.z), j = Math.min(end - 1, q.j);
      const rd = norm({ x: index.xs[j + 1] - index.xs[j], z: index.zs[j + 1] - index.zs[j] });
      const crossing = nd.inc.some((o) => [1, -1].some((dir) => {
        const st = streets[o.k], acc = arcs(st), a = acc[o.i] + dir * 10;
        if (a < -1 || a > acc[acc.length - 1] + 1) return false;
        const p = streetPoint(st, a), u = norm(sub(p, nd));
        return Math.abs(dot(u, rd)) < .82 && Math.hypot(p.x - nd.x, p.z - nd.z) > 2;
      }));
      if (crossing) items.push({ nd, w, route: true, s: q.s, i: q.j, x: nd.x, z: nd.z });
      else if (deg >= 3 && r.d > RW / 2 + w / 2) items.push({ nd, w, route: false, x: nd.x, z: nd.z });
    } else if (deg >= 3) items.push({ nd, w, route: false, x: nd.x, z: nd.z });
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
  const addCut = (k, a0, a1) => { if (a1 - a0 < .01) return; if (!cuts.has(k)) cuts.set(k, []); cuts.get(k).push([a0, a1]); };
  const heightJobs = [];

  clusters.forEach((cl, c) => {
    const isRoute = cl.some((it) => it.route);
    let C, rq = null;
    if (isRoute) {
      const rs = cl.filter((it) => it.route), s = rs.reduce((a, it) => a + it.s, 0) / rs.length;
      const i = Math.max(0, Math.min(end - 1, Math.floor(s / 10)));
      let j = i; while (j > 0 && route.dist[j] > s) j--; while (j < end - 1 && route.dist[j + 1] < s) j++;
      const f = (s - route.dist[j]) / ((route.dist[j + 1] - route.dist[j]) || 1);
      C = { x: index.xs[j] + (index.xs[j + 1] - index.xs[j]) * f, z: index.zs[j] + (index.zs[j + 1] - index.zs[j]) * f };
      rq = { s, j };
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
      const at = (s) => { let j = rq.j; while (j > 0 && route.dist[j] > s) j--; while (j < end - 1 && route.dist[j + 1] < s) j++; const f = Math.max(0, Math.min(1, (s - route.dist[j]) / ((route.dist[j + 1] - route.dist[j]) || 1))); return { x: index.xs[j] + (index.xs[j + 1] - index.xs[j]) * f, z: index.zs[j] + (index.zs[j + 1] - index.zs[j]) * f }; };
      for (const dir of [-1, 1]) {
        const s1 = rq.s + dir * 12;
        if (s1 < 0 || s1 > route.dist[end]) continue;
        const p = at(s1);
        arms.push({ k: -1, route: true, dir, N: C, u: norm(sub(p, C)), h: RW / 2, cls: 3, oneway: 0, avail: 60, theta: Math.atan2(p.z - C.z, p.x - C.x) });
      }
    }
    if (arms.length < 2 || (!isRoute && arms.length < 3)) return;
    // streets running along the route inside its corridor (the rest of the street the route rides on) join its arm
    const routeArms = arms.filter((a) => a.route);
    for (const a of arms) {
      if (a.route) continue;
      for (const r of routeArms) if (dot(a.u, r.u) > .94 && Math.abs(dot(sub(a.N, C), left(r.u))) < RW / 2 + a.h) a.alongRoute = r;
    }
    arms.sort((a, b) => a.theta - b.theta);
    const ring = arms.filter((a) => !a.alongRoute);
    if (ring.length < 2 || (!isRoute && ring.length < 3)) return;

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
      const base = rq.j;
      J = (x, z) => { const q = routeY(base, x, z); return q.y + ROAD_LIFT - O.routeGap - O.lift; };
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
    for (let q = 0; q < n; q++) {
      const A = ring[q], cr = corners[q], B = cr.B;
      poly.push(edge(A, -1, A.t), edge(A, 1, A.t));
      const curb = [edge(A, 1, A.t)];
      if (cr.arc) {
        if (cr.tA < A.t - .05) curb.push(edge(A, 1, cr.tA));
        const { O: Oc, r } = cr.arc, a0 = Math.atan2(curb[curb.length - 1].z - Oc.z, curb[curb.length - 1].x - Oc.x);
        const pB = edge(B, -1, cr.tB);
        let da = Math.atan2(pB.z - Oc.z, pB.x - Oc.x) - a0;
        while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 9)));
        for (let s = 1; s < steps; s++) curb.push({ x: Oc.x + Math.cos(a0 + da * s / steps) * r, z: Oc.z + Math.sin(a0 + da * s / steps) * r });
        curb.push(pB);
        if (cr.tB < B.t - .05) curb.push(edge(B, -1, B.t));
      } else curb.push(edge(B, -1, B.t));
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
      addCut(A.k, A.dir > 0 ? A.a0 : A.a0 - A.t, A.dir > 0 ? A.a0 + A.t : A.a0);
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
  streets.forEach((st) => {
    if (!st.nodes || st.bridge) return;
    for (const p of st.pts) if (p.je != null) p.y = below(p.x, p.z, p.y, drawnLiftMax(p, { options: O }, .24), st.width / 2 + 1);
  });
  for (const jn of list) {
    if (jn.route || !index.nearest(jn.x, jn.z, O.maxTrimM + O.maxSpanM + RW)) continue;   // (far from the route: nothing to do)
    const J0 = jn.J;
    jn.J = (x, z) => below(x, z, J0(x, z), O.lift, 1);
  }
  return { list, cuts, spans, options: O };
}

/**
 * The parts of a street that are drawn: its points split where junctions cut it, with exact end points at the
 * cuts. → [[{x, y, z, cut?}…]…] (each at least two points).
 */
export function streetPieces(st, cuts) {
  if (!cuts || !cuts.length) return [st.pts];
  const acc = arcs(st), total = acc[acc.length - 1];
  const merged = cuts.map((c) => [Math.max(0, c[0]), Math.min(total, c[1])]).sort((a, b) => a[0] - b[0]);
  const keep = [];
  let from = 0;
  for (const [a, b] of merged) { if (a > from + .3) keep.push([from, a]); from = Math.max(from, b); }
  if (total > from + .3) keep.push([from, total]);
  return keep.map(([a, b]) => {
    const out = [{ ...streetPoint(st, a), cut: a > 0 }];
    for (let i = 0; i < st.pts.length; i++) if (acc[i] > a + .05 && acc[i] < b - .05) out.push(st.pts[i]);
    out.push({ ...streetPoint(st, b), cut: b < total });
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
