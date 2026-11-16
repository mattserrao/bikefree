// Road meets: every place where roadways meet near a route — street junctions, links where one street carries on as
// another (a street onto a bridge deck), street ends that touch another surface or the route's road, streets that
// cross or run along the route's road, ribbons drawn over each other, and ribbons the route's clearance tube chops —
// inventoried and measured the way the city draws them (pure: no three.js; the course QC and the tests use it).
//
//   roadMeets(landscape, index, route, { reach, from, to }) → { sites, counts, issues }
//   site: { id, kind, x, z, y, s (route distance of the nearest route point), d (distance from the route's line),
//           streets: [k…], jn?, issues: [{ check, value, note }] }
//
// Kinds: `junction` (a planned junction, js/world/junctions.js), `link` (two street ends meeting end to end),
// `node` (streets sharing a node that no junction covers), `end` (a street end that touches another surface, or
// ends in the air), `route` (a street meeting, crossing or running along the route's road outside any junction),
// `overlap` (ribbons drawn over each other at one level), `clipped` (a ribbon the route's clearance tube cuts).
// Checks (MEET_LIMITS): `step` (surfaces meet at different heights), `gap` (they don't reach each other),
// `overlap` (drawn over each other at one level: flicker, doubled paint), `dangling` (a roadway ends in the air or
// stops short), `paint` (crosswalk or stop line across the route's road or inside another junction), `clipped`.
import { streetPieces, junctionsNear, LIFT_BLEND_M, junctionPaint, routeLine } from './junctions.js';

export const MEET_LIMITS = {
  reach: 150,        // m: sites within this distance of the route's line
  step: .09,         // m: surfaces meeting with a lip higher than this
  gap: .45,          // m: …or this far apart (a seam you see through to the ground)
  overlapM: 5,       // m: ribbon drawn over another at one level (|dy| < levelM) for longer than this
  level: .6,         // m: two surfaces this close in height are meant to be one
  dangle: 1.2,       // m: a street end this far above (or below) whatever is under it hangs in the air
  touch: 1.5,        // m: a street end this close to another surface's edge meets it
  clippedM: 2,       // m: of ribbon cut away by the route's clearance tube
};

const ROAD_LIFT = .12;           // (pose.js) the route's road surface above its line
const SLOT_LIFT = (slot) => .1 + slot * .02;   // (city.js) a street ribbon's lift by its height slot
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Height slots for street ribbons (city.js draws with these): streets whose ribbons overlap never share one. */
export function streetSlots(landscape, streets) {
  if (streets._slots) return streets._slots;
  const n = streets.length, slots = new Array(n).fill(-1);
  const order = [...Array(n).keys()].sort((a, b) => streets[a].cls - streets[b].cls || a - b);
  for (const k of order) {
    const st = streets[k], used = new Set();
    for (const p of st.pts) for (const o of landscape.streetsNear(p.x, p.z, st.width / 2 + 5)) if (o.k !== k && slots[o.k] >= 0) used.add(slots[o.k]);
    let slot = 0; while (used.has(slot) && slot < 7) slot++;
    slots[k] = slot;
  }
  Object.defineProperty(streets, '_slots', { value: slots, enumerable: false, configurable: true });
  return slots;
}

/**
 * A street as drawn: its pieces (trimmed at junctions), each point with `top` — the ribbon's surface height
 * (its line plus its lift, blended to the junction surface's at a cut, as junction-mesh.js drawnPieces draws it).
 */
export function drawnStreet(st, k, plan, lift) {
  const pieces = plan ? streetPieces(st, plan.cuts.get(k)) : [st.pts];
  const JL = plan ? plan.options.lift : lift;
  return pieces.map((pc) => {
    let d = 0;
    const along = [0];
    for (let i = 1; i < pc.length; i++) { d += Math.hypot(pc[i].x - pc[i - 1].x, pc[i].z - pc[i - 1].z); along.push(d); }
    return pc.map((p, i) => {
      const fromCut = Math.min(pc[0].cut ? along[i] : Infinity, pc[pc.length - 1].cut ? d - along[i] : Infinity);
      const w = fromCut === Infinity ? 1 : smooth(fromCut / LIFT_BLEND_M);
      return { x: p.x, z: p.z, y: p.y, top: p.y + lift + (JL - lift) * (1 - w), cut: p.cut, tx: p.tx, tz: p.tz };
    });
  });
}

/**
 * Streets that run along the route's road (the rest of the street the route rides on, the other carriageway of
 * its roadway, the other half of its bridge): where a ribbon lies beside or under the road, at nearly its level,
 * its surface is set just under the road's shoulder (8 cm under the road surface), so what shows beyond the road's
 * edge is one paved surface with it — not a ledge 0.3–0.5 m down, nor a ribbon poking up through it. Outside the
 * stretch the street eases back to its own profile at no more than `grade`. Streets sharing a node with a moved
 * point follow it. Runs in cityStreets() before the junctions are planned (they own heights inside junctions).
 * ctx: { route, index, landscape, roadWidth, slots }.
 */
export function alignAlongRoute(streets, ctx, options = {}) {
  const O = { cos: .8, minRunM: 6, under: .08, level: 2.5, deckLevel: 4.5, grade: .06, maxEaseM: 60, ...options };
  const { route, index, landscape } = ctx, RW = ctx.roadWidth || 7, RL = routeLine(route, index), end = route.turnIdx || route.dist.length - 1;
  const slots = ctx.slots || streetSlots(landscape, streets);
  let moved = 0;
  const targets = streets.map(() => null);
  streets.forEach((st, k) => {
    if (st.cls > 7 || st.pts.length < 2) return;
    const lift = SLOT_LIFT(slots[k]), P = st.pts, tg = new Array(P.length).fill(null);
    let any = false;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], r = index.nearest(p.x, p.z, RW / 2 + st.width / 2 + 12);
      if (!r) continue;
      const q = RL.project(p.x, p.z, route.dist[Math.min(end, r.i > end ? 2 * end - r.i : r.i)], 30);
      if (!q || q.d > RW / 2 + st.width / 2 + .5) continue;
      // (a deck above the road is an overpass: never pulled down into the rider's space; one below it, beside it,
      // is the roadway's other half)
      if (p.y - q.y > (st.bridge ? 1 : O.level) || q.y - p.y > (st.bridge ? O.deckLevel : O.level)) continue;
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], t = RL.at(q.s);
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      if (Math.abs((dx * t.tx + dz * t.tz) / l) < O.cos) continue;
      tg[i] = q.y + ROAD_LIFT - O.under - lift;
      any = true;
    }
    if (!any) return;
    // runs shorter than minRunM are crossings (junctions' business), not streets alongside
    const acc = [0]; for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    for (let i = 0; i < P.length;) {
      if (tg[i] == null) { i++; continue; }
      let j = i; while (j + 1 < P.length && tg[j + 1] != null) j++;
      if (acc[j] - acc[i] < O.minRunM) for (let q = i; q <= j; q++) tg[q] = null;
      i = j + 1;
    }
    if (tg.some((v) => v != null)) targets[k] = tg;
  });
  // shared nodes of moved points: the other streets through them take the same height there
  const key = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`, at = new Map();
  streets.forEach((st, k) => { const tg = targets[k]; if (tg) st.pts.forEach((p, i) => { if (tg[i] != null) at.set(key(p), tg[i] + SLOT_LIFT(slots[k])); }); });
  streets.forEach((st, k) => {
    if (st.cls > 7) return;
    st.pts.forEach((p, i) => {
      const top = at.get(key(p));
      if (top == null || (targets[k] && targets[k][i] != null)) return;
      (targets[k] ||= new Array(st.pts.length).fill(null))[i] = top - SLOT_LIFT(slots[k]);
    });
  });
  // apply, easing outside each run (both ways along the street)
  streets.forEach((st, k) => {
    const tg = targets[k]; if (!tg) return;
    const P = st.pts, own = P.map((p) => p.y), n = P.length;
    const acc = [0]; for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const blend = new Array(n).fill(null);   // [weight, target]
    for (const dir of [1, -1]) {
      let last = null;
      for (let c = 0; c < n; c++) {
        const i = dir > 0 ? c : n - 1 - c;
        if (tg[i] != null) { last = i; continue; }
        if (last == null) continue;
        const d = Math.abs(acc[i] - acc[last]), L = Math.min(O.maxEaseM, Math.max(6, Math.abs(tg[last] - own[last]) / O.grade));
        if (d >= L) continue;
        const w = 1 - smooth(d / L);
        if (!blend[i] || w > blend[i][0]) blend[i] = [w, tg[last] - own[last]];
      }
    }
    for (let i = 0; i < n; i++) {
      if (tg[i] != null) { if (Math.abs(P[i].y - tg[i]) > .005) moved++; P[i].y = tg[i]; P[i].along = true; }
      else if (blend[i]) P[i].y = own[i] + blend[i][1] * blend[i][0];
    }
  });
  return moved;
}

/**
 * After junctions and the along-route pass have moved street heights: a path or street that shares a node with a
 * moved point (`jn`, `je`, `along`) but wasn't moved itself takes the same height there, easing back to its own
 * profile at no more than `grade` (so footpaths and service roads don't meet a junction with a step).
 */
export function followMovedNodes(streets, options = {}) {
  const O = { grade: .08, level: 1.2, maxEaseM: 30, ...options };
  const key = (p) => `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`, lead = new Map();
  for (const st of streets) for (const p of st.pts) if (p.jn != null || p.je != null || p.along) lead.set(key(p), p.y);
  let n = 0;
  for (const st of streets) {
    if (st.bridge) continue;
    const P = st.pts, own = P.map((p) => p.y), tg = P.map((p) => { const y = lead.get(key(p)); return y != null && p.jn == null && p.je == null && !p.along && Math.abs(y - p.y) > .005 && Math.abs(y - p.y) < O.level ? y : null; });
    if (!tg.some((v) => v != null)) continue;
    const acc = [0]; for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const best = P.map(() => null);
    tg.forEach((t, j) => {
      if (t == null) return;
      const L = Math.min(O.maxEaseM, Math.max(4, Math.abs(t - own[j]) / O.grade));
      for (let i = 0; i < P.length; i++) { const d = Math.abs(acc[i] - acc[j]); if (d < L) { const w = 1 - smooth(d / L); if (!best[i] || w > best[i][0]) best[i] = [w, t - own[j]]; } }
    });
    P.forEach((p, i) => { if (best[i]) { p.y = own[i] + best[i][1] * best[i][0]; n++; } });
  }
  return n;
}

const segDist = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
  return { d: Math.hypot(a.x + dx * t - x, a.z + dz * t - z), t };
};
const inPoly = (ring, x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r; } return r; };

/**
 * Inventory and measure every road meet within `reach` of the route between route distances `from` and `to`.
 * `landscape`: a city landscape whose streets have been built (cityStreets); works with or without junctions.
 */
export function roadMeets(landscape, index, route, options = {}) {
  const O = { ...MEET_LIMITS, ...options };
  const streets = landscape._streets, plan = landscape._junctions || null;
  if (!streets) return { sites: [], counts: {}, issues: 0 };
  const end = route.turnIdx || route.dist.length - 1, RW = options.roadWidth || 7;
  const from = O.from ?? 0, to = O.to ?? route.dist[end];
  const near = (x, z) => {   // nearest route point within reach, in [from, to]
    const r = index.nearest(x, z, O.reach);
    if (!r) return null;
    const i = r.i > end ? Math.max(0, 2 * end - r.i) : r.i, s = route.dist[i];
    return s >= from - 1 && s <= to + 1 ? { s, d: r.d, i } : null;
  };
  const slots = streetSlots(landscape, streets);
  const drawnK = (st) => st.cls <= 7;
  // drawn ribbons, on a 24 m grid of segments
  const G = 24, grid = new Map(), segs = [], drawn = new Map();
  streets.forEach((st, k) => {
    if (!drawnK(st)) return;
    const mid = st.pts[st.pts.length >> 1];
    if (!index.nearest(mid.x, mid.z, O.reach + 600)) return;
    const pcs = drawnStreet(st, k, plan, SLOT_LIFT(slots[k]));
    drawn.set(k, pcs);
    pcs.forEach((pc, q) => {
      for (let i = 1; i < pc.length; i++) {
        const a = pc[i - 1], b = pc[i], id = segs.length, r = st.width / 2;
        segs.push({ k, q, i, a, b, r });
        for (let gx = Math.floor((Math.min(a.x, b.x) - r) / G); gx <= Math.floor((Math.max(a.x, b.x) + r) / G); gx++)
          for (let gz = Math.floor((Math.min(a.z, b.z) - r) / G); gz <= Math.floor((Math.max(a.z, b.z) + r) / G); gz++) {
            const key = `${gx},${gz}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(id);
          }
      }
    });
  });
  /** Drawn surfaces at (x, z) within `pad` of their edge: [{kind, k?, jn?, top, edge}] (edge < 0: inside). */
  const surfacesAt = (x, z, pad = 0, skipK = -1) => {
    const out = [], seen = new Map();
    for (const id of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) || []) {
      const sg = segs[id];
      if (sg.k === skipK) continue;
      const { d, t } = segDist(x, z, sg.a, sg.b), edge = d - sg.r;
      if (edge > pad) continue;
      const prev = seen.get(sg.k);
      if (prev && prev.edge <= edge) continue;
      const o = { kind: 'street', k: sg.k, top: sg.a.top + (sg.b.top - sg.a.top) * t, edge };
      if (prev) out[out.indexOf(prev)] = o; else out.push(o);
      seen.set(sg.k, o);
    }
    for (const { jn, d } of plan ? junctionsNear(plan, x, z, pad) : []) out.push({ kind: 'junction', jn: jn.id, top: jn.top(x, z), edge: d });
    const r = landscape.routeDist(x, z);
    if (r && r.d - RW / 2 < pad) out.push({ kind: 'route', top: r.y + ROAD_LIFT, edge: r.d - RW / 2 });
    return out;
  };

  const sites = [];
  const add = (site) => {
    const q = near(site.x, site.z);
    if (!q) return null;
    site.s = Math.round(q.s); site.d = Math.round(q.d * 10) / 10; site.issues ||= [];
    site.id = sites.length; sites.push(site);
    return site;
  };
  const issue = (site, check, value, note) => { if (site) site.issues.push({ check, value: Math.round(value * 100) / 100, note }); };

  // 1. planned junctions: each arm's ribbon meets the surface at its mouth (no step, no gap), nothing else drawn
  // inside, paint only where it belongs
  const paint = plan ? junctionPaint(plan, streets, { route, index, routeDist: landscape.routeDist, roadWidth: RW, liftOf: (k) => SLOT_LIFT(slots[k]), routeKindAt: landscape.routeKindAt }) : null;
  if (paint && !paint.byJn) { const m = new Map(); for (const q of paint.quads) { if (!m.has(q.jn)) m.set(q.jn, []); m.get(q.jn).push(q); } Object.defineProperty(paint, 'byJn', { value: m, enumerable: false }); }
  for (const jn of plan?.list || []) {
    const site = add({ kind: 'junction', x: jn.x, z: jn.z, y: jn.J(jn.x, jn.z), jn: jn.id, route: jn.route, streets: [...new Set([...jn.arms, ...jn.extra].map((a) => a.k).filter((k) => k >= 0))] });
    if (!site) continue;
    let step = 0, gap = 0;
    for (const A of jn.arms) {
      if (A.route) {   // the route's road at the mouth vs the surface
        for (const c of A.mouth) { const r = landscape.routeDist(c.x, c.z); if (r) step = Math.max(step, Math.abs(r.y + ROAD_LIFT - jn.top(c.x, c.z))); }
        continue;
      }
      const pcs = drawn.get(A.k); if (!pcs) continue;
      const cutS = A.a0 + A.dir * A.t;
      // the piece whose end lies at this cut
      let best = null;
      for (const pc of pcs) for (const e of [0, pc.length - 1]) {
        const p = pc[e]; if (!p.cut) continue;
        const dd = Math.hypot(p.x - A.cutP.x, p.z - A.cutP.z);
        if (!best || dd < best.dd) best = { dd, pc, e };
      }
      if (!best || best.dd > .5) {
        // no ribbon arrives at this mouth (its street is cut further on, e.g. by the next junction): fine if another
        // junction's surface lies just beyond it
        const q = { x: A.cutP.x + A.ud.x * 1.2, z: A.cutP.z + A.ud.z * 1.2 };
        if (!junctionsNear(plan, q.x, q.z, .3).some((o) => o.jn !== jn && o.d < .3)) gap = Math.max(gap, best ? best.dd : A.h);
        continue;
      }
      const { pc, e } = best, p = pc[e], nb = pc[e === 0 ? 1 : pc.length - 2];
      const dir = e === 0 ? 1 : -1;
      let dx = (nb.x - p.x) * dir, dz = (nb.z - p.z) * dir; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      // ribbon corners at the cut (city-geometry.js ribbon: the end's direction is its one neighbour's)
      const h = A.h, L = { x: p.x + dz * h, z: p.z - dx * h }, R = { x: p.x - dz * h, z: p.z + dx * h };
      for (const c of [L, R]) {
        const m = A.mouth.reduce((a, b) => (Math.hypot(a.x - c.x, a.z - c.z) < Math.hypot(b.x - c.x, b.z - c.z) ? a : b));
        gap = Math.max(gap, Math.hypot(m.x - c.x, m.z - c.z));
        step = Math.max(step, Math.abs(p.top - jn.top(m.x, m.z)));
      }
    }
    if (step > O.step) issue(site, 'step', step, 'a street meets the junction surface with a lip');
    if (gap > O.gap) issue(site, 'gap', gap, 'a street’s end and the junction’s mouth don’t line up');
    // other ribbons drawn inside at its level
    let over = 0;
    const own = new Set(site.streets);
    for (const [k, pcs] of drawn) {
      if (own.has(k)) continue;
      for (const pc of pcs) for (let i = 1; i < pc.length; i++) {
        const a = pc[i - 1], b = pc[i], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 2));
        if (Math.min(a.x, b.x) > jn.bb[1] + 1 || Math.max(a.x, b.x) < jn.bb[0] - 1 || Math.min(a.z, b.z) > jn.bb[3] + 1 || Math.max(a.z, b.z) < jn.bb[2] - 1) continue;
        for (let q = 0; q < n; q++) {
          const f = (q + .5) / n, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, y = a.top + (b.top - a.top) * f;
          if (inPoly(jn.poly, x, z) && Math.abs(jn.top(x, z) - y) < O.level) over += len / n;
        }
      }
    }
    if (over > O.overlapM) issue(site, 'overlap', over, 'another street’s ribbon is drawn inside the junction');
    // paint as drawn: a street's crosswalk or stop line never on the route's road, the route's own never inside a
    // junction (nor across the road mid-junction), every quad square (a parallelogram along its street)
    let wrong = 0, why = '';
    for (const q of paint.byJn.get(jn.id) || []) {
      const c = { x: (q.pts[0].x + q.pts[2].x) / 2, z: (q.pts[0].z + q.pts[2].z) / 2 };
      if (q.kind === 'route-crosswalk') { if (plan.list.some((o) => o.bb && c.x > o.bb[0] && c.x < o.bb[1] && c.z > o.bb[2] && c.z < o.bb[3] && inPoly(o.poly, c.x, c.z))) { wrong++; why = 'a route crosswalk inside a junction'; } continue; }
      const onRoad = q.pts.some((p) => { const r = landscape.routeDist(p.x, p.z); return r && r.d < RW / 2 && Math.abs(r.y + ROAD_LIFT - p.y) < 1.5; });
      if (onRoad) { wrong++; why = 'a street crosswalk or stop line on the route’s road'; }
      else if (junctionsNear(plan, c.x, c.z, 0).some((o) => o.d < 0)) { wrong++; why = 'paint inside a junction'; }
    }
    if (wrong) issue(site, 'paint', wrong, why);
  }

  // 2. street ends and shared nodes outside junctions
  const keyOf = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  const ends = new Map();   // node key → [{k, e (0 | last), p (drawn end), pc}]
  for (const [k, pcs] of drawn) {
    for (const pc of pcs) for (const e of [0, pc.length - 1]) {
      const p = pc[e]; if (p.cut) continue;   // (a cut end meets its junction: checked above)
      const key = keyOf(p);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ k, e, p, pc });
    }
  }
  // streets passing through a node (not ending there)
  const through = new Map();
  for (const [k, pcs] of drawn) for (const pc of pcs) for (let i = 1; i < pc.length - 1; i++) { const key = keyOf(pc[i]); if (ends.has(key)) { if (!through.has(key)) through.set(key, []); through.get(key).push({ k, p: pc[i] }); } }
  const done = new Set();
  for (const [key, list] of ends) {
    if (done.has(key)) continue;
    done.add(key);
    const p = list[0].p, thru = through.get(key) || [];
    const ks = [...new Set([...list.map((o) => o.k), ...thru.map((o) => o.k)])];
    if (ks.length >= 2) {
      // a node several streets share: a link (two ends meeting end to end) or a junction no plan covers
      const tops = [...list.map((o) => o.p.top), ...thru.map((o) => o.p.y + SLOT_LIFT(slots[o.k]))];
      const lo = Math.min(...tops), hi = Math.max(...tops);
      if (hi - lo > 4) continue;   // one passes over the other
      const kind = list.length === 2 && !thru.length ? 'link' : 'node';
      const site = add({ kind, x: p.x, z: p.z, y: p.y, streets: ks, bridge: ks.some((k) => streets[k].bridge) });
      if (!site) continue;
      if (hi - lo > O.step) issue(site, 'step', hi - lo, kind === 'link' ? 'a street carries on as another at a different height' : 'streets share a node at different heights');
      if (kind === 'link') {   // the two ribbons' end edges: each square to its own direction → a wedge on the outside of the bend
        const dirOf = (o) => { const nb = o.pc[o.e === 0 ? 1 : o.pc.length - 2]; const dx = nb.x - o.p.x, dz = nb.z - o.p.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
        const a = dirOf(list[0]), b = dirOf(list[1]);
        const cos = -(a.x * b.x + a.z * b.z), th = Math.acos(Math.max(-1, Math.min(1, cos)));
        const w = Math.min(streets[list[0].k].width, streets[list[1].k].width);
        const miter = list[0].p.tx != null && list[1].p.tx != null;
        const wedge = miter ? 0 : w * Math.sin(th / 2);
        if (wedge > O.gap) issue(site, 'gap', wedge, 'two ribbons meet at an angle with a notch between their ends');
      }
      continue;
    }
    // a lone street end: what does it touch?
    const o = list[0], st = streets[o.k];
    const nb = o.pc[o.e === 0 ? 1 : o.pc.length - 2];
    let dx = p.x - nb.x, dz = p.z - nb.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // probe just beyond the end, and at the end itself
    const probes = [{ x: p.x, z: p.z }, { x: p.x + dx * O.touch, z: p.z + dz * O.touch }];
    let touch = null;
    for (const q of probes) for (const sf of surfacesAt(q.x, q.z, O.touch, o.k)) if (!touch || Math.abs(sf.top - p.top) < Math.abs(touch.top - p.top)) touch = sf;
    if (touch) {
      const site = add({ kind: touch.kind === 'route' ? 'route' : 'end', x: p.x, z: p.z, y: p.y, streets: touch.k != null ? [o.k, touch.k] : [o.k], meets: touch.kind, bridge: st.bridge });
      if (!site) continue;
      const step = Math.abs(touch.top - p.top);
      if (step > 4) { if (Math.abs(p.y - landscape.heightAt(p.x, p.z)) > O.dangle) issue(site, 'dangling', p.y - landscape.heightAt(p.x, p.z), 'a roadway ends in the air beside another at a different level'); }
      else if (step > O.step) issue(site, 'step', step, `a street ends against ${touch.kind === 'route' ? 'the route’s road' : touch.kind === 'junction' ? 'a junction' : 'another street'} at a different height`);
      continue;
    }
    // free end: on the ground, or hanging?
    const g = landscape.heightAt(p.x, p.z), off = p.top - .1 - g;
    if (Math.abs(off) > O.dangle) {
      const site = add({ kind: 'end', x: p.x, z: p.z, y: p.y, streets: [o.k], meets: 'nothing', bridge: st.bridge });
      issue(site, 'dangling', off, off > 0 ? 'a roadway ends in the air' : 'a roadway ends below the ground');
    }
  }

  // 3. the route's road: streets that cross it or run along it at its level outside the junctions, and ribbons its
  // clearance tube cuts
  const inJunction = (x, z) => plan && junctionsNear(plan, x, z, .5).some((o) => o.d < .5);
  const runs = new Map();   // k → current run
  const flush = (key) => {
    const run = runs.get(key); runs.delete(key);
    if (!run || run.m < 1.5) return;
    const site = add({ kind: run.kind, x: run.x, z: run.z, y: run.y, streets: [+key.slice(1)], along: run.along });
    if (!site) return;
    if (run.kind === 'clipped') { if (run.m > O.clippedM) issue(site, 'clipped', run.m, 'the route’s clearance cuts a hole in a street (ends left hanging)'); return; }
    if (run.step > O.step + .1) issue(site, 'step', run.step, run.along ? 'a street runs beside the route’s road at a different height' : 'a street meets the route’s road at a different height');
    if (!run.along && run.m > 3) issue(site, 'overlap', run.m, 'a street crosses the route’s road with no junction');
  };
  for (const [k, pcs] of drawn) {
    const st = streets[k];
    for (const pc of pcs) {
      for (let i = 1; i < pc.length; i++) {
        const a = pc[i - 1], b = pc[i], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 2));
        const ux = (b.x - a.x) / (len || 1), uz = (b.z - a.z) / (len || 1);
        for (let q = 0; q < n; q++) {
          const f = (q + .5) / n, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, top = a.top + (b.top - a.top) * f, m = len / n;
          const r = landscape.routeDist(x, z);
          // clearance tube: the ribbon's middle or either edge
          let tube = false;
          if (r && r.d < RW / 2 + st.width / 2 + 1 && landscape.inRouteTube) {
            for (const sd of [0, -1, 1]) { const px = x - uz * sd * (st.width / 2 - .2), pz = z + ux * sd * (st.width / 2 - .2); if (landscape.inRouteTube(px, top + .01, pz)) tube = true; }
          }
          if (tube) {
            const run = runs.get(`t${k}`) || { kind: 'clipped', m: 0, x, z, y: top };
            run.m += m; runs.set(`t${k}`, run);
          } else if (runs.has(`t${k}`)) flush(`t${k}`);
          const meets = r && r.d < RW / 2 + st.width / 2 - .5 && Math.abs(r.y + ROAD_LIFT - top) < O.level + .6 && !inJunction(x, z);
          if (meets) {
            const i0 = Math.min(end - 1, r.i), rx = index.xs[i0 + 1] - index.xs[i0], rz = index.zs[i0 + 1] - index.zs[i0], rl = Math.hypot(rx, rz) || 1;
            const par = Math.abs(ux * rx / rl + uz * rz / rl) > .8;
            const run = runs.get(`r${k}`) || { kind: 'route', m: 0, x, z, y: top, step: 0, par: 0 };
            run.m += m; if (par) run.par += m; run.along = run.par > run.m * .6;
            // the part of the ribbon beyond the road's edge shows: its height against the road's
            if (r.d + st.width / 2 > RW / 2 + 2.2) run.step = Math.max(run.step, Math.abs(r.y + ROAD_LIFT - top));
            runs.set(`r${k}`, run);
          } else if (runs.has(`r${k}`)) flush(`r${k}`);
        }
      }
      flush(`t${k}`); flush(`r${k}`);
    }
  }

  // 4. ribbons drawn over each other at one level outside junctions (40 m clusters)
  const clusters = new Map();
  for (const sg of segs) {
    const len = Math.hypot(sg.b.x - sg.a.x, sg.b.z - sg.a.z), n = Math.max(1, Math.round(len / 2));
    for (let q = 0; q < n; q++) {
      const f = (q + .5) / n, x = sg.a.x + (sg.b.x - sg.a.x) * f, z = sg.a.z + (sg.b.z - sg.a.z) * f, top = sg.a.top + (sg.b.top - sg.a.top) * f;
      let hit = null;
      for (const id of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) || []) {
        const o = segs[id];
        if (o.k === sg.k) continue;
        const { d, t } = segDist(x, z, o.a, o.b);
        if (d < o.r - .3 && Math.abs(o.a.top + (o.b.top - o.a.top) * t - top) < O.level) { hit = o; break; }
      }
      if (!hit) continue;
      const key = `${Math.floor(x / 40)},${Math.floor(z / 40)}`, c = clusters.get(key) || { x, z, y: top, m: 0, ks: new Set() };
      c.m += len / n; c.ks.add(sg.k); c.ks.add(hit.k); clusters.set(key, c);
    }
  }
  for (const c of clusters.values()) {
    const site = add({ kind: 'overlap', x: c.x, z: c.z, y: c.y, streets: [...c.ks] });
    if (site && c.m > O.overlapM) issue(site, 'overlap', c.m, 'street ribbons drawn over each other at one level (no junction)');
  }

  sites.sort((a, b) => a.s - b.s || a.kind.localeCompare(b.kind));
  sites.forEach((s, i) => { s.id = i; });
  const counts = {};
  for (const s of sites) { counts[s.kind] = (counts[s.kind] || 0) + 1; }
  return { sites, counts, issues: sites.filter((s) => s.issues.length).length, paint: paint && { quads: paint.quads.length, bad: paint.bad.length } };
}
