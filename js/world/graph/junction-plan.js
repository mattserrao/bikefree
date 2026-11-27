// The graph maps' junctions (js/world/graph-world.js), planned from the graph alone: a pure function of the ways
// meeting at each node, their widths and the map's curb radii. [review 27 Nov] W14: out of GraphWorld._planJunctions,
// the same arithmetic (test/world-graph.test.mjs: every plan of every graph map against the old method's snapshot).
import { curvePoint } from './curves.js';

/**
 * Junctions (user, 21 Nov: "the way intersections connect is poor and jarring"), as the Pittsburgh map's
 * (js/world/toolbox/city/junctions.js) on PGH's graph: where three or more ways meet, each way's ribbon stops at
 * its mouth, square to it; between neighbouring ways a curb return (a fillet, its radius by the ways' class); the
 * surface is one polygon — the mouths joined by the curb returns — on a plane through the mouths' heights (each
 * mouth exactly at its ribbon's end); the sidewalks wrap round the corners, the verges where there are none.
 * armsAt: node id → [{ e, end (0 from, 1 to) }]; wOf(e), walkOf(e): a way's width and sidewalk (m); curbs: the map
 * profile's junctionCurbs (radius by kind, over the defaults).
 * → { jn (node id → { x, z, y, poly, corners, arms, J }), trim (edge id → [m cut at from, m cut at to]) }.
 */
export function planJunctions(armsAt, { wOf, walkOf, curbs = null }) {
  const CURB = { primary: 7, secondary: 6, tertiary: 5, residential: 4, alley: 2.5, plaza: 2, path: 1.5, ...(curbs || {}) };   // (NYC: rounder park corners)
  const left = (u) => ({ x: -u.z, z: u.x }), along = (p, u, t) => ({ x: p.x + u.x * t, z: p.z + u.z * t }), dot = (a, b) => a.x * b.x + a.z * b.z;
  const meet = (p, u, q, v) => { const den = u.x * v.z - u.z * v.x; if (Math.abs(den) < 1e-6) return null; const wx = q.x - p.x, wz = q.z - p.z; return [(wx * v.z - wz * v.x) / den, (wx * u.z - wz * u.x) / den]; };
  const jn = new Map(), trim = new Map();
  const deckEnd = (e, end) => e.bridges.some(([a, b]) => (end ? b >= e.n - 1 : a <= 1));
  for (const [id, list] of armsAt) {
    if (list.length < 3 || list.some(({ e, end }) => deckEnd(e, end))) continue;
    if (list.every(({ e }) => e._cf)) continue;   // (singletrack meeting singletrack: the treads just run together)
    const e0 = list[0].e, N = { x: list[0].end ? e0.x[e0.n] : e0.x[0], z: list[0].end ? e0.z[e0.n] : e0.z[0] };
    // the arms, round the node
    const arms = list.map(({ e, end }) => {
      const len = e.n * 10, d = Math.min(8, len * 0.5), p = curvePoint(e, end ? e.n - d / 10 : d / 10);
      const ux = p.x - N.x, uz = p.z - N.z, l = Math.hypot(ux, uz) || 1;
      const other = armsAt.get(end ? e.from : e.to)?.length >= 3;
      return { e, end, u: { x: ux / l, z: uz / l }, h: wOf(e) / 2, walk: walkOf(e) || 0, r: CURB[e.kind] || 4, len, other, theta: Math.atan2(uz, ux) };
    }).sort((a, b) => a.theta - b.theta);
    const n = arms.length, corners = [];
    // (how far each arm's mouth can sit from the node: a return whose tangent runs past it is dropped below)
    const maxT = (A) => Math.min(26, A.other ? A.len * 0.45 : Math.max(1.5, A.len - 4));
    for (let q = 0; q < n; q++) {
      const A = arms[q], B = arms[(q + 1) % n];
      let gap = B.theta - A.theta; if (gap <= 0) gap += Math.PI * 2;
      const nA = left(A.u), nB = left(B.u), c = { A, B, gap, arc: null, tA: 0, tB: 0 };
      if (gap < Math.PI * 0.86 && gap > 0.3) {
        // (the curb's radius, then smaller ones until the return fits its arms — a sharp fork on short arms gets a
        //  tight return, not none: the map QC's sharpCorner, 25 Nov fix pass)
        const r0 = Math.min(A.r, B.r);
        // (then larger ones: an obtuse corner of a narrow path on a wide road has its small returns' centres behind the
        //  road's mouth — a wider return sits in front of it)
        for (const r of [r0, r0 * 0.5, 1.5, 0.8, Math.max(r0 * 2, 3), Math.max(r0 * 3, 5)]) {
          const pA = along(N, nA, A.h + r), pB = along(N, nB, -(B.h + r)), m = meet(pA, A.u, pB, B.u);
          const fits = m && m[0] <= maxT(A) + 0.01 && m[1] <= maxT(B) + 0.01;   // (a return that fits is as before)
          if (m && m[0] > 0 && m[1] > 0 && m[0] < 26 && m[1] < 26 && fits) { const O = along(pA, A.u, m[0]); c.tA = dot({ x: O.x - N.x, z: O.z - N.z }, A.u); c.tB = dot({ x: O.x - N.x, z: O.z - N.z }, B.u); c.arc = { O, r }; break; }
        }
      }
      if (!c.arc && gap < Math.PI * 0.95) {   // sharp or awkward: where the two edges cross
        const m = meet(along(N, nA, A.h), A.u, along(N, nB, -B.h), B.u);
        if (m && m[0] > 0 && m[1] > 0) { c.tA = Math.min(26, m[0]); c.tB = Math.min(26, m[1]); }
      }
      corners.push(c);
    }
    for (let q = 0; q < n; q++) {
      const A = arms[q];
      A.t = Math.min(Math.max(corners[(q - 1 + n) % n].tB, corners[q].tA, 1.5), 26, A.other ? A.len * 0.45 : Math.max(1.5, A.len - 4));
    }
    for (const c of corners) if (c.arc && (c.tA > c.A.t + 0.01 || c.tB > c.B.t + 0.01)) c.arc = null;   // (clamped short: a straight corner)
    // each mouth: where its ribbon ends, square to it, at the ribbon's height
    for (const A of arms) {
      const f = A.end ? A.e.n - A.t / 10 : A.t / 10, p = curvePoint(A.e, f), sg = A.end ? -1 : 1, ud = { x: p.dx * sg, z: p.dz * sg }, L = left(ud);
      A.cut = { x: p.x, y: p.y, z: p.z }; A.ud = ud;
      A.mouth = [{ x: p.x - L.x * A.h, z: p.z - L.z * A.h, y: p.y }, { x: p.x + L.x * A.h, z: p.z + L.z * A.h, y: p.y }];
      const tr = trim.get(A.e.id) || [0, 0]; tr[A.end] = A.t; trim.set(A.e.id, tr);
    }
    // the surface's plane: least squares through the mouths' heights (never steeper than 10 %)
    let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
    for (const A of arms) { const x = A.cut.x - N.x, z = A.cut.z - N.z, y = A.cut.y; sx += x; sz += z; sy += y; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y; }
    const mx = sx / n, mz = sz / n, my = sy / n, cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxy = sxy / n - mx * my, czy = szy / n - mz * my, det = cxx * czz - cxz * cxz;
    let gx = 0, gz = 0; if (Math.abs(det) > 1e-3) { gx = (cxy * czz - czy * cxz) / det; gz = (czy * cxx - cxy * cxz) / det; }
    const g = Math.hypot(gx, gz); if (g > 0.1) { gx *= 0.1 / g; gz *= 0.1 / g; }
    const c0 = my - gx * mx - gz * mz, J = (x, z) => c0 + gx * (x - N.x) + gz * (z - N.z);
    // the polygon (counter-clockwise in x/z): each mouth, then the curb round to the next
    const poly = [];
    const edge = (A, side, t) => { const p = along(along(N, A.u, t), left(A.u), side * A.h); return { x: p.x, z: p.z, y: J(p.x, p.z) }; };
    for (let q = 0; q < n; q++) {
      const A = arms[q], c = corners[q], B = c.B;
      poly.push(A.mouth[0], A.mouth[1]);
      const curb = [A.mouth[1]];
      if (c.arc) {
        if (c.tA < A.t - 0.05) curb.push(edge(A, 1, c.tA));
        const { O, r } = c.arc, last = curb[curb.length - 1], a0 = Math.atan2(last.z - O.z, last.x - O.x);
        const pB = c.tB < B.t - 0.05 ? edge(B, -1, c.tB) : B.mouth[0];
        let da = Math.atan2(pB.z - O.z, pB.x - O.x) - a0; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 12)));
        for (let k = 1; k < steps; k++) { const x = O.x + Math.cos(a0 + da * k / steps) * r, z = O.z + Math.sin(a0 + da * k / steps) * r; curb.push({ x, z, y: J(x, z) }); }
        curb.push(pB);
        if (c.tB < B.t - 0.05) curb.push(B.mouth[0]);
      } else curb.push(B.mouth[0]);
      for (let k = 1; k < curb.length - 1; k++) poly.push(curb[k]);
      c.curb = curb;
    }
    jn.set(id, { x: N.x, z: N.z, y: J(N.x, N.z), J, poly, corners, arms });
  }

  return { jn, trim };
}
