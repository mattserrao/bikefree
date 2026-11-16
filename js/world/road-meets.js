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
  overlapM: 5,       // m: ribbon drawn over another at one level (|dy| < levelM) for longer than this…
  overlapDepth: .75, // m: …by more than this across (less: two ribbons sharing an edge)
  level: .6,         // m: two surfaces this close in height are meant to be one
  dangle: 1.2,       // m: a street end this far above (or below) whatever is under it hangs in the air
  touch: 1.5,        // m: a street end this close to another surface's edge meets it
  clippedM: 2,       // m: of ribbon cut away by the route's clearance tube
  seeM: 25,          // limits grow by their own size every this many metres from the route (×4 at 75 m, ×7 at 150 m)
};

const ROAD_LIFT = .12;           // (pose.js) the route's road surface above its line
const SLOT_LIFT = (slot) => .1 + slot * .02;   // (city.js) a street ribbon's lift by its height slot
const JLIFT = .1;                // (junctions.js DEFAULTS.lift) a junction surface's lift
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Height slots for street ribbons (city.js draws with these when junctions are on): streets whose ribbons come
 * within 5 m of each other never share one. Its own segment grid (city.js's _streetSlots asks the landscape's
 * street index, which may not exist yet while the streets are being built), cached on the street list.
 */
export function streetSlots(landscape, streets) {
  if (streets._slots) return streets._slots;
  const n = streets.length, slots = new Array(n).fill(-1), G = 24, grid = new Map();
  streets.forEach((st, k) => {
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], r = st.width / 2 + 14;
      for (let gx = Math.floor((Math.min(a.x, b.x) - r) / G); gx <= Math.floor((Math.max(a.x, b.x) + r) / G); gx++)
        for (let gz = Math.floor((Math.min(a.z, b.z) - r) / G); gz <= Math.floor((Math.max(a.z, b.z) + r) / G); gz++) {
          const key = `${gx},${gz}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([k, i]);
        }
    }
  });
  const order = [...Array(n).keys()].sort((a, b) => streets[a].cls - streets[b].cls || a - b);
  for (const k of order) {
    const st = streets[k], used = new Set();
    for (const p of st.pts) {
      for (const [ko, i] of grid.get(`${Math.floor(p.x / G)},${Math.floor(p.z / G)}`) || []) {
        if (ko === k || slots[ko] < 0 || used.has(slots[ko])) continue;
        const so = streets[ko];
        if (segDist(p.x, p.z, so.pts[i - 1], so.pts[i]).d - so.width / 2 < st.width / 2 + 5) used.add(slots[ko]);
      }
    }
    let slot = 0; while (used.has(slot) && slot < 7) slot++;
    slots[k] = slot;
  }
  Object.defineProperty(streets, '_slots', { value: slots, enumerable: false, configurable: true });
  return slots;
}

/**
 * Streets that cross at one level without sharing an OSM node (a service road over a street, two streets the data
 * left unconnected) were drawn as two ribbons through each other. Each such crossing gets a node shared by both
 * (same coordinates, at their mean height), so the junction planner turns it into a junction. Crossings within
 * `nearM` of a node the two already share, at shallow angles (< `minDeg`) or at different levels are left alone.
 * Keeps st.nodes / st.nodeIdx in step. Run before anything indexes the streets' points.
 */
export function joinCrossings(streets, options = {}) {
  const O = { level: .6, minDeg: 25, nearM: 12, ...options };
  const G = 32, grid = new Map(), key = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  streets.forEach((st, k) => {
    if (st.cls > 7 || !st.nodeIdx) return;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / G); gx <= Math.floor(Math.max(a.x, b.x) / G); gx++)
        for (let gz = Math.floor(Math.min(a.z, b.z) / G); gz <= Math.floor(Math.max(a.z, b.z) / G); gz++) {
          const kk = `${gx},${gz}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([k, i]);
        }
    }
  });
  const shared = (k, ko, p) => streets[k].nodes.some((n) => Math.hypot(n.x - p.x, n.z - p.z) < O.nearM && streets[ko].nodes.some((m) => key(m) === key(n)));
  const ins = new Map(), seen = new Set();   // k → [{i, f, x, z, y}]
  for (const list of grid.values()) {
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const [k, i] = list[u], [ko, j] = list[v];
      if (k === ko) continue;
      const pair = k < ko ? `${k}:${i}:${ko}:${j}` : `${ko}:${j}:${k}:${i}`;
      if (seen.has(pair)) continue; seen.add(pair);
      const A = streets[k], B = streets[ko], a = A.pts[i - 1], b = A.pts[i], c = B.pts[j - 1], d = B.pts[j];
      const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z, den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den, w = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
      if (t <= .02 || t >= .98 || w <= .02 || w >= .98) continue;
      const ang = Math.acos(Math.min(1, Math.abs(rx * sx + rz * sz) / (Math.hypot(rx, rz) * Math.hypot(sx, sz) || 1))) * 180 / Math.PI;
      if (ang < O.minDeg) continue;
      const ya = a.y + (b.y - a.y) * t, yb = c.y + (d.y - c.y) * w;
      if (Math.abs(ya - yb) > O.level) continue;
      const P = { x: a.x + rx * t, z: a.z + rz * t };
      if (shared(k, ko, P)) continue;
      const y = (ya + yb) / 2;
      (ins.get(k) || ins.set(k, []).get(k)).push({ i, f: t, ...P, y });
      (ins.get(ko) || ins.set(ko, []).get(ko)).push({ i: j, f: w, ...P, y });
    }
  }
  let n = 0;
  for (const [k, list] of ins) {
    const st = streets[k], P = st.pts, out = [], map = [];
    list.sort((p, q) => p.i - q.i || p.f - q.f);
    let q = 0;
    const added = [];
    for (let i = 0; i < P.length; i++) {
      while (q < list.length && list[q].i === i) { const e = list[q++]; added.push(out.length); out.push({ x: e.x, y: e.y, z: e.z }); n++; }
      map.push(out.length); out.push(P[i]);
    }
    st.pts = out;
    const nodeIdx = st.nodeIdx.map((i) => map[i]), nodes = [...st.nodes];
    for (const ai of added) { nodeIdx.push(ai); nodes.push(out[ai]); }
    const order = nodeIdx.map((_, m) => m).sort((x, y) => nodeIdx[x] - nodeIdx[y]);
    st.nodeIdx = order.map((m) => nodeIdx[m]); st.nodes = order.map((m) => nodes[m]);
  }
  return n;
}

/**
 * Where a ribbon runs alongside another (within both half-widths, near-parallel, at its level), its points are
 * made at most `stepM` apart, so the trims (trimOverlaps) follow the other ribbon's edge instead of cutting
 * across it in 7 m wedges. Keeps st.nodeIdx in step. Run before anything indexes the streets' points.
 */
export function densifyAlongside(streets, options = {}) {
  const O = { cos: .85, level: .9, stepM: 2.5, ...options };
  const G = 24, grid = new Map();
  streets.forEach((st, k) => {
    if (st.cls > 7) return;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], r = st.width / 2;
      for (let gx = Math.floor((Math.min(a.x, b.x) - r) / G); gx <= Math.floor((Math.max(a.x, b.x) + r) / G); gx++)
        for (let gz = Math.floor((Math.min(a.z, b.z) - r) / G); gz <= Math.floor((Math.max(a.z, b.z) + r) / G); gz++) {
          const key = `${gx},${gz}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([k, i]);
        }
    }
  });
  let added = 0;
  streets.forEach((st, k) => {
    if (st.cls > 7 || st.pts.length < 2) return;
    const P = st.pts, mark = new Uint8Array(P.length + 1);
    for (let i = 0; i < P.length; i++) {
      const p = P[i], a0 = P[Math.max(0, i - 1)], b0 = P[Math.min(P.length - 1, i + 1)], ux = b0.x - a0.x, uz = b0.z - a0.z, ul = Math.hypot(ux, uz) || 1;
      for (const [ko, j] of grid.get(`${Math.floor(p.x / G)},${Math.floor(p.z / G)}`) || []) {
        if (ko === k) continue;
        const so = streets[ko], a = so.pts[j - 1], b = so.pts[j], { d, t } = segDist(p.x, p.z, a, b);
        if (d > st.width / 2 + so.width / 2 + 3 || Math.abs(a.y + (b.y - a.y) * t - p.y) > O.level) continue;
        const bx = b.x - a.x, bz = b.z - a.z;
        if (Math.abs((ux * bx + uz * bz) / ul / (Math.hypot(bx, bz) || 1)) < O.cos) continue;
        mark[i] = 1; mark[i + 1] = 1; break;
      }
    }
    if (!mark.some((v) => v)) return;
    const out = [P[0]], map = [0];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (mark[i] && len > O.stepM * 1.2) {
        const m = Math.ceil(len / O.stepM);
        for (let q = 1; q < m; q++) { const f = q / m; out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, ...(a.along && b.along ? { along: true } : {}) }); added++; }
      }
      map.push(out.length); out.push(b);
    }
    if (out.length === P.length) return;
    st.pts = out;
    if (st.nodeIdx) st.nodeIdx = st.nodeIdx.map((i) => map[i]);
  });
  return added;
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
      return { x: p.x, z: p.z, y: p.y, top: p.y + lift + (JL - lift) * (1 - w), cut: p.cut, tx: p.tx, tz: p.tz, tl: p.tl || 0, tr: p.tr || 0 };
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
    if (st.cls > 7 || st.pts.length < 2 || !nearRouteStreet(st, index, RW / 2 + st.width / 2 + 2)) return;
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
 * A deck or ramp crossing over the route's road lower than the rider's clearance (the builder interpolates deck
 * heights between their ground ends, so a flyover can come down onto a trail beneath it) was cut open by the
 * clearance tube, leaving its two halves hanging. It is lifted to `clearM` over the road where it crosses, easing
 * back along the deck at no more than `grade`, so it passes over in one piece. ctx: { route, index, roadWidth }.
 */
export function clearOverpasses(streets, ctx, options = {}) {
  const { route, index } = ctx, RW = ctx.roadWidth || 7;
  const O = { cos: .7, clearM: 4.9, below: .1, grade: .06, ...options };   // (below: a deck lower than the road's surface less this passes under it)
  const RL = routeLine(route, index), end = route.turnIdx || route.dist.length - 1;
  let n = 0;
  streets.forEach((st) => {
    if (!st.bridge || st.cls > 7 || !nearRouteStreet(st, index, RW / 2 + st.width / 2 + 4)) return;
    const P = st.pts, need = P.map(() => 0);
    let crosses = false;
    const cand = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i], r = index.nearest(p.x, p.z, RW / 2 + st.width / 2 + 8); if (!r) continue;
      const q = RL.project(p.x, p.z, route.dist[Math.min(end, r.i > end ? 2 * end - r.i : r.i)], 30);
      if (!q || q.d > RW / 2 + st.width / 2 + 3) continue;
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], t = RL.at(q.s), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const road = q.y + ROAD_LIFT, under = road + O.clearM - p.y;
      // ([w2-meets] a deck point pinned just under the road — it reached the road's level — goes over it too)
      if ((p.y > road - O.below || (p.pin && p.y > road - 1)) && under > 0) { cand.push([i, under]); if (Math.abs((dx * t.tx + dz * t.tz) / l) <= O.cos) crosses = true; }
    }
    if (!crosses) return;   // (a deck alongside the road is the road's other half: alignAlongRoute)
    for (const [i, under] of cand) need[i] = under;
    const acc = [0]; for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const lift = P.map((_, i) => { let m = 0; need.forEach((v, j) => { if (v > 0) m = Math.max(m, v - Math.abs(acc[i] - acc[j]) * O.grade); }); return m; });
    P.forEach((p, i) => { if (lift[i] > 0) { p.y += lift[i]; p.lifted = true; n++; } });
  });
  return n;
}

/**
 * A street running beside the route at a different level (on a terrace above a riverfront trail, a ramp below a
 * viaduct) used to hang its ribbon over the road's shoulder or under the road itself. Its side towards the route is
 * trimmed back to the shoulder's outer edge (`edgeM` from the road's line), so the two read as two levels side by side
 * (a wall between them), never one surface hovering over the other; a stretch lying across the road's line at a
 * different level isn't drawn. Streets flush with the road (alignAlongRoute), crossings (cos < `cos`) and
 * over/underpasses (more than `pass` apart) are left alone. ctx: { route, index, landscape, roadWidth }.
 */
export function trimAtRoute(streets, ctx, options = {}) {
  const { route, index, landscape } = ctx, RW = ctx.roadWidth || 7;
  const O = { cos: .5, step: .15, pass: 4.5, edgeM: RW / 2 + 2.2, stripM: 2.5, ...options };
  const RL = routeLine(route, index), end = route.turnIdx || route.dist.length - 1, slots = streetSlots(landscape, streets);
  let n = 0;
  streets.forEach((st, k) => {
    if (st.cls > 7 || !nearRouteStreet(st, index, st.width / 2 + O.edgeM + 2)) return;
    const P = st.pts, h = st.width / 2, lift = SLOT_LIFT(slots[k]);
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.along) {
        // flush with the road: what shows of it is the strip beyond the shoulder on either side; a strip narrower
        // than `stripM` (a sliver along the shoulder) goes, and so does the part under the road when only one stays
        const r = index.nearest(p.x, p.z, h + O.edgeM + 12); if (!r) continue;
        const q = RL.project(p.x, p.z, route.dist[Math.min(end, r.i > end ? 2 * end - r.i : r.i)], 30); if (!q) continue;
        const t = RL.at(q.s), sd = (p.x - t.x) * t.rx + (p.z - t.z) * t.rz, E = O.edgeM;
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        const leftIsPlus = (dz / l) * t.rx - (dx / l) * t.rz > 0;   // the ribbon's (dz, −dx) side is the road's +r side
        const wPlus = sd + h - E, wMinus = -E - (sd - h), keepP = wPlus >= O.stripM, keepM = wMinus >= O.stripM;
        let trimPlus = 0, trimMinus = 0;
        if (!keepP && !keepM) { trimPlus = trimMinus = 2 * h; }
        else if (keepP && !keepM) trimMinus = Math.min(2 * h, E - (sd - h));
        else if (keepM && !keepP) trimPlus = Math.min(2 * h, sd + h + E);
        if (trimPlus || trimMinus) {
          const fl = leftIsPlus ? trimPlus : trimMinus, fr = leftIsPlus ? trimMinus : trimPlus;
          p.tl = Math.max(p.tl || 0, fl); p.tr = Math.max(p.tr || 0, fr); n++;
        }
        continue;
      }
      const r = index.nearest(p.x, p.z, h + O.edgeM + 12); if (!r) continue;
      const q = RL.project(p.x, p.z, route.dist[Math.min(end, r.i > end ? 2 * end - r.i : r.i)], 30);
      if (!q || q.d > h + O.edgeM) continue;
      const dy = p.y + lift - (q.y + ROAD_LIFT);
      if (Math.abs(dy) < O.step || Math.abs(dy) > O.pass) continue;
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], t = RL.at(q.s);
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      if (Math.abs((dx * t.tx + dz * t.tz) / l) < O.cos) continue;
      const c = { x: t.x, z: t.z }, left = (c.x - p.x) * (dz / l) - (c.z - p.z) * (dx / l) > 0;   // the road on the (dz, −dx) side?
      const need = q.d < h * .5 ? 2 * h : Math.min(2 * h, O.edgeM - (q.d - h));
      if (need <= 0) continue;
      const f = left ? 'tl' : 'tr';
      p[f] = Math.max(p[f] || 0, need); n++;
    }
  });
  return n;
}

/**
 * Last word on the rule that nothing covers the route's road: any ground street or path whose ribbon reaches over
 * the road (its width plus `marginM`) with its top between the road's surface less `under` and 4 m above it is put
 * just under the road there (decks that cross over it were lifted clear by clearOverpasses first).
 */
export function keepUnderRoad(streets, ctx, options = {}) {
  const { route, index, landscape } = ctx, RW = ctx.roadWidth || 7, O = { under: .05, marginM: 1, ...options };
  const RL = routeLine(route, index), end = route.turnIdx || route.dist.length - 1, slots = streetSlots(landscape, streets);
  let n = 0;
  streets.forEach((st, k) => {
    if (!nearRouteStreet(st, index, RW / 2 + st.width / 2 + O.marginM + 1)) return;
    const lift = SLOT_LIFT(slots[k]);
    for (const p of st.pts) {
      if (p.jn != null || (O.keepJunctions && p.je != null)) continue;   // (keepJunctions: their ease zones are theirs)
      const r = index.nearest(p.x, p.z, RW / 2 + st.width / 2 + 6); if (!r) continue;
      const q = RL.project(p.x, p.z, route.dist[Math.min(end, r.i > end ? 2 * end - r.i : r.i)], 30);
      if (!q || q.d > RW / 2 + st.width / 2 + O.marginM) continue;
      const L = p.jd != null ? JLIFT + (lift - JLIFT) * smooth(p.jd / LIFT_BLEND_M) : lift;   // (near a junction the lift blends to its surface's)
      const road = q.y + ROAD_LIFT, top = p.y + L;
      if (top > road - O.under && top < road + 4) { p.y = road - O.under - .005 - L; p.under = true; n++; }
    }
  });
  return n;
}

/**
 * A street, path or deck end that meets nothing (no other street shares it, it isn't on the route's road) yet
 * hangs above the ground or is buried in it (a footpath stub on a bluff, a deck whose ground street the data cut
 * off) comes down to the ground: its end sits `onM` over the bare ground and the last stretch eases there at no more
 * than `grade` (at most half the street). ctx: { route, index, landscape, roadWidth }.
 */
export function settleFreeEnds(streets, ctx, options = {}) {
  const { index, landscape } = ctx, RW = ctx.roadWidth || 7, O = { tol: .3, onM: .05, grade: .12, ...options };
  const key = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`, count = new Map();
  for (const st of streets) for (const p of st.pts) count.set(key(p), (count.get(key(p)) || 0) + 1);
  const G = 24, grid = new Map();
  streets.forEach((st, k) => { for (let i = 1; i < st.pts.length; i++) { const a = st.pts[i - 1], b = st.pts[i]; for (const q of [a, b]) { const kk = `${Math.floor(q.x / G)},${Math.floor(q.z / G)}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([k, i]); } } });
  const touches = (st, p) => {
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const [k, i] of grid.get(`${Math.floor(p.x / G) + gx},${Math.floor(p.z / G) + gz}`) || []) {
      const o = streets[k]; if (o === st) continue;
      if (segDist(p.x, p.z, o.pts[i - 1], o.pts[i]).d < o.width / 2 + st.width / 2 + 1) return true;
    }
    return false;
  };
  let n = 0;
  for (const st of streets) {
    const P = st.pts; if (P.length < 2) continue;
    const acc = [0]; for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    for (const e of [0, P.length - 1]) {
      const p = P[e];
      if (count.get(key(p)) > 1 || p.jn != null || p.je != null || p.along || p.under) continue;
      const r = index.nearest(p.x, p.z, RW / 2 + st.width / 2 + 4); if (r) continue;   // (at the route: its own rules)
      // (nor where it ends against another street's ribbon: that is a meet, not a free end)
      if (touches(st, p)) continue;
      const g = landscape.baseHeight(p.x, p.z) + O.onM, dy = g - p.y;
      if (Math.abs(dy) < O.tol) continue;
      const L = Math.min(acc[acc.length - 1] / 2, Math.max(6, Math.abs(dy) / O.grade));
      for (let i = 0; i < P.length; i++) {
        const d = Math.abs(acc[i] - acc[e]); if (d >= L) continue;
        P[i].y += dy * (1 - smooth(d / L));
      }
      n++;
    }
  }
  return n;
}

/**
 * After junctions and the along-route pass have moved street heights: a path or street that shares a node with a
 * moved point (`jn`, `je`, `along`) but wasn't moved itself takes the same height there, easing back to its own
 * profile at no more than `grade` (so footpaths and service roads don't meet a junction with a step).
 */
export function followMovedNodes(streets, options = {}) {
  const O = { grade: .08, level: 1.2, maxEaseM: 30, rounds: 4, ...options };
  const key = (p) => `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
  // ([w2-meets] in rounds: a short street that followed all the way along moves its far end too, and the street
  // carrying on from there follows it in the next round)
  const isLead = (p) => p.jn != null || p.je != null || p.along || p.under || p.lifted || p.followed;
  let n = 0;
  for (let round = 0; round < O.rounds; round++) {
  const lead = new Map(), lifted = new Set();
  for (const st of streets) for (const p of st.pts) if (isLead(p)) { lead.set(key(p), Math.min(lead.get(key(p)) ?? Infinity, p.y)); if (p.lifted || p.followedLift) lifted.add(key(p)); }
  let moved = 0;
  for (const st of streets) {
    // (decks too where one ends on a moved street: it follows over its last metres)
    const P = st.pts, own = P.map((p) => p.y), tg = P.map((p) => { const y = lead.get(key(p)); return y != null && !isLead(p) && Math.abs(y - p.y) > .005 && Math.abs(y - p.y) < (st.bridge || lifted.has(key(p)) ? 4.5 : O.level) ? y : null; });
    if (!tg.some((v) => v != null)) continue;
    const acc = [0]; for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const best = P.map(() => null);
    tg.forEach((t, j) => {
      if (t == null) return;
      const L = Math.min(O.maxEaseM, Math.max(4, Math.abs(t - own[j]) / O.grade));
      for (let i = 0; i < P.length; i++) { const d = Math.abs(acc[i] - acc[j]); if (d < L) { const w = 1 - smooth(d / L); if (!best[i] || w > best[i][0]) best[i] = [w, t - own[j]]; } }
    });
    P.forEach((p, i) => {
      if (!best[i]) return;
      const dy = best[i][1] * best[i][0]; p.y = own[i] + dy; n++;
      if (Math.abs(dy) > .005 && (i === 0 || i === P.length - 1)) { p.followed = true; moved++; if (Math.abs(dy) > O.level / 2) p.followedLift = true; }
    });
  }
  if (!moved) break;
  }
  return n;
}

/**
 * Carriageways that run side by side or merge (ramps leaving or joining a road, the two halves of a dual
 * carriageway, a street splitting in two) used to be drawn as two full ribbons over each other: doubled lane paint
 * and a ramp's ribbon lying across its parent's lanes. Here every street point whose ribbon overlaps a near-parallel
 * one at its level gets trimmed on that side (`tl` / `tr`: metres taken off its left / right half, city-geometry.js
 * ribbon), and levelled with it:
 * - a branch (a street that ends on the other, within `branchM` of the overlap: a ramp, a slip road) yields: its
 *   inner edge runs along the parent's edge, so it widens the parent into a proper gore and fills it, and where it
 *   lies wholly inside the parent it isn't drawn at all; its surface eases to the parent's height;
 * - peers (neither ends on the other) split the overlap down the middle and meet at their mean height.
 * Left = the ribbon's (dz, −dx) side for its direction (dx, dz). Run after the junctions are planned.
 */
/**
 * [w2] Carriageways drawn over each other at one level, resolved by priority: streets are visited most important
 * first (lower class, then deck, then longer); at each point a street's drawn width (its interval across, trims
 * taken off) loses whatever an already-visited near-parallel neighbour at its level covers — the end of the interval
 * it covers is cut back to the neighbour's edge, all of it when the neighbour covers it whole; a neighbour lying wholly
 * inside it gives way instead (that neighbour's points there are hidden), so what is drawn is the union with nothing
 * over anything. A street that lost width takes the neighbour's height there (easing out at `grade`), so the two
 * meet flush. Gores fill themselves: a ramp leaving a road keeps only what lies beyond the road's edge.
 */
export function resolveOverlaps(streets, landscape, options = {}) {
  const O = { cos: .7, level: .6, grade: .08, ...options };
  const slots = streetSlots(landscape, streets), lift = (k) => SLOT_LIFT(slots[k]);
  const len = streets.map((st) => { let l = 0; for (let i = 1; i < st.pts.length; i++) l += Math.hypot(st.pts[i].x - st.pts[i - 1].x, st.pts[i].z - st.pts[i - 1].z); return l; });
  const order = streets.map((_, k) => k).filter((k) => streets[k].cls <= 7 && streets[k].pts.length > 1)
    .sort((a, b) => streets[a].cls - streets[b].cls || (streets[b].bridge ? 1 : 0) - (streets[a].bridge ? 1 : 0) || len[b] - len[a] || a - b);
  const G = 24, grid = new Map(), done = new Uint8Array(streets.length);
  streets.forEach((st, k) => {
    if (st.cls > 7) return;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], r = st.width / 2;
      for (let gx = Math.floor((Math.min(a.x, b.x) - r) / G); gx <= Math.floor((Math.max(a.x, b.x) + r) / G); gx++)
        for (let gz = Math.floor((Math.min(a.z, b.z) - r) / G); gz <= Math.floor((Math.max(a.z, b.z) + r) / G); gz++) {
          const kk = `${gx},${gz}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([k, i]);
        }
    }
  });
  const dirAt = (P, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
  const targets = new Map();   // k → Map(i → top)
  let n = 0;
  for (const k of order) {
    const st = streets[k], P = st.pts, h = st.width / 2;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], u = dirAt(P, i), Lx = u.z, Lz = -u.x, top = p.y + lift(k);
      if (p.jn != null) continue;   // (inside a junction: not drawn, its surface decides)
      let lo = -(h - (p.tr || 0)), hi = h - (p.tl || 0);
      if (hi - lo < .05) continue;
      let flushTop = null;
      const seen = new Set();
      for (const [ko, j] of grid.get(`${Math.floor(p.x / G)},${Math.floor(p.z / G)}`) || []) {
        if (ko === k || !done[ko] || seen.has(`${ko}:${j}`)) continue;
        seen.add(`${ko}:${j}`);
        const so = streets[ko], a = so.pts[j - 1], b = so.pts[j], { d, t } = segDist(p.x, p.z, a, b), hN = so.width / 2;
        if (d > h + hN || a.jn != null || b.jn != null) continue;
        // (only where we lie alongside this piece of it: past its end the ribbon stops square, and a street carrying on
        // from it isn't under it)
        {
          const vx0 = b.x - a.x, vz0 = b.z - a.z, l0 = Math.hypot(vx0, vz0) || 1, tu = ((p.x - a.x) * vx0 + (p.z - a.z) * vz0) / l0;   // metres along
          if ((j === 1 && tu < .05) || (j === so.pts.length - 1 && tu > l0 - .05) || tu < -1 || tu > l0 + 1) continue;
        }
        const vx = b.x - a.x, vz = b.z - a.z, vl = Math.hypot(vx, vz) || 1;
        if (Math.abs((u.x * vx + u.z * vz) / vl) < O.cos) continue;   // crossing, not alongside (junctions' business)
        const topN = a.y + (b.y - a.y) * t + lift(ko);
        if (Math.abs(topN - top) > O.level) continue;
        const cx = a.x + vx * t, cz = a.z + vz * t, e = (cx - p.x) * Lx + (cz - p.z) * Lz;
        const same = (vz / vl) * Lx - (vx / vl) * Lz > 0;   // the neighbour's left is our left?
        const tlN = (a.tl || 0) + ((b.tl || 0) - (a.tl || 0)) * t, trN = (a.tr || 0) + ((b.tr || 0) - (a.tr || 0)) * t;
        const jlo = e - (hN - (same ? trN : tlN)), jhi = e + (hN - (same ? tlN : trN));
        if (jhi - jlo < .05 || jhi <= lo + .05 || jlo >= hi - .05) continue;
        if (jlo <= lo + .05 && jhi >= hi - .05) { lo = hi = 0; flushTop = topN; break; }            // covered whole
        if (jlo > lo + .05 && jhi < hi - .05) {                                                  // the neighbour lies inside us
          for (const q of [j - 1, j]) { so.pts[q].tl = so.width; so.pts[q].tr = so.width; } continue;
        }
        if (jhi >= hi - .05) hi = jlo; else lo = jhi;
        flushTop = topN;
      }
      const ntl = Math.max(0, h - hi), ntr = Math.max(0, h + lo);
      if (lo === 0 && hi === 0) { p.tl = p.tr = 2 * h; } else { p.tl = Math.max(p.tl || 0, ntl); p.tr = Math.max(p.tr || 0, ntr); }
      if (flushTop != null && !p.along && !p.pin) { if (!targets.has(k)) targets.set(k, new Map()); targets.get(k).set(i, flushTop); n++; }
    }
    done[k] = 1;
  }
  // heights: flush with what it gave way to, easing out — but a node another street shares keeps its height (one
  // height per node: the streets through it would step)
  const shared = new Map(), nk = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  for (const st of streets) for (const p of st.pts) shared.set(nk(p), (shared.get(nk(p)) || 0) + 1);
  for (const [k, t] of targets) {
    const st = streets[k], P = st.pts, own = P.map((p) => p.y), A = [0];
    for (let i = 1; i < P.length; i++) A.push(A[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const best = P.map(() => null);
    for (const [j, topN] of t) {
      const dy = topN - lift(k) - own[j]; if (Math.abs(dy) < .003) continue;
      const L = Math.max(4, Math.abs(dy) / O.grade);
      for (let i = 0; i < P.length; i++) { const d = Math.abs(A[i] - A[j]); if (d < L) { const w = t.has(i) ? (i === j ? 1 : 0) : 1 - smooth(d / L); if (w > 0 && (!best[i] || w > best[i][0])) best[i] = [w, dy]; } }
    }
    P.forEach((p, i) => { if (best[i] && !p.along && !p.pin && p.jn == null && !(O.final && p.je != null) && shared.get(nk(p)) < 2) p.y = own[i] + best[i][1] * best[i][0]; });
  }
  return n;
}

export function trimOverlaps(streets, landscape, plan, options = {}) {
  const O = { cos: .85, level: .6, branchM: 90, grade: .08, ...options };
  const slots = streetSlots(landscape, streets), lift = (k) => SLOT_LIFT(slots[k]);
  const key = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  const at = new Map();   // node key → streets through it
  streets.forEach((st, k) => { if (st.cls <= 7) for (const p of st.pts) { const kk = key(p); if (!at.has(kk)) at.set(kk, new Set()); at.get(kk).add(k); } });
  const acc = (st) => { const a = [0]; for (let i = 1; i < st.pts.length; i++) a.push(a[i - 1] + Math.hypot(st.pts[i].x - st.pts[i - 1].x, st.pts[i].z - st.pts[i - 1].z)); return a; };
  const dirAt = (P, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
  const drawnPt = (p) => p.jn == null;
  // a segment grid of every drawn ribbon
  const G = 24, grid = new Map();
  streets.forEach((st, k) => {
    if (st.cls > 7) return;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], r = st.width / 2;
      for (let gx = Math.floor((Math.min(a.x, b.x) - r) / G); gx <= Math.floor((Math.max(a.x, b.x) + r) / G); gx++)
        for (let gz = Math.floor((Math.min(a.z, b.z) - r) / G); gz <= Math.floor((Math.max(a.z, b.z) + r) / G); gz++) {
          const kk = `${gx},${gz}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([k, i]);
        }
    }
  });
  const endKeys = streets.map((st) => (st.pts.length ? [key(st.pts[0]), key(st.pts[st.pts.length - 1])] : []));
  const lens = streets.map((st) => { let l = 0; for (let i = 1; i < st.pts.length; i++) l += Math.hypot(st.pts[i].x - st.pts[i - 1].x, st.pts[i].z - st.pts[i - 1].z); return l; });
  /** Is street k a branch of street ko near arc length s along k (or near point p, measured straight)? */
  const isBranch = (k, ko, s, p) => {
    const st = streets[k], so = streets[ko];
    for (const [e, kk] of endKeys[k].entries()) {
      if (!at.get(kk)?.has(ko)) continue;
      const E = st.pts[e === 0 ? 0 : st.pts.length - 1];
      const d = s != null ? Math.abs(s - (e === 0 ? 0 : lens[k])) : Math.hypot(p.x - E.x, p.z - E.z);
      if (d < O.branchM && (!endKeys[ko].includes(kk) || st.cls > so.cls)) return true;
    }
    return false;
  };
  const jobs = [];   // [k, i, side ('l' | 'r'), trim, targetTop]
  let n = 0;
  streets.forEach((st, k) => {
    if (st.cls > 7 || st.pts.length < 2) return;
    const P = st.pts, A = acc(st), hA = st.width / 2, ends = [key(P[0]), key(P[P.length - 1])];
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (!drawnPt(p)) continue;
      const u = dirAt(P, i), Lx = u.z, Lz = -u.x, topA = p.y + lift(k);
      const best = new Map();
      for (const [ko, j] of grid.get(`${Math.floor(p.x / G)},${Math.floor(p.z / G)}`) || []) {
        if (ko === k) continue;
        const so = streets[ko], a = so.pts[j - 1], b = so.pts[j];
        if (!drawnPt(a) || !drawnPt(b)) continue;
        const { d, t } = segDist(p.x, p.z, a, b), hB = so.width / 2;
        if (d >= hA + hB - .05) continue;
        const prev = best.get(ko); if (prev && prev.d <= d) continue;
        const bx = b.x - a.x, bz = b.z - a.z, bl = Math.hypot(bx, bz) || 1;
        if (Math.abs((u.x * bx + u.z * bz) / bl) < O.cos) continue;   // crossing, not running alongside
        if (p.along && (a.along || b.along)) continue;   // both alongside the route: trimAtRoute shapes them
        const cx = a.x + bx * t, cz = a.z + bz * t, yB = a.y + (b.y - a.y) * t, topB = yB + lift(ko);
        if (Math.abs(topB - topA) > O.level) continue;
        best.set(ko, { ko, d, hB, side: (cx - p.x) * Lx + (cz - p.z) * Lz > 0 ? 'l' : 'r', topB, along: !!(a.along || b.along) });
      }
      for (const o of best.values()) {
        const so = streets[o.ko];
        // is this street a branch of the other (it ends on it, close by)?
        // (it ends on the other where that one carries on through, or where both end and it is the lesser road)
        const branch = isBranch(k, o.ko, A[i]);
        if (!branch && isBranch(o.ko, k, null, p)) continue;   // the other one is the branch: it yields, this one stays whole
        const over = hA + o.hB - o.d;
        // (heights: a street flush with the route's road keeps its height; one meeting it takes that height)
        const top = p.along || p.pin ? null : o.along || branch ? o.topB : (topA + o.topB) / 2;   // (pinned under the road: stays)
        if (branch) jobs.push([k, i, o.side, Math.min(2 * hA, over), top]);   // its inner edge on the parent's edge; wholly inside: not drawn
        else jobs.push([k, i, o.side, Math.min(hA, over / 2), top]);
      }
    }
  });
  // apply: trims (the largest per side), heights (the overlap's target, easing out along the street)
  const targets = new Map();
  for (const [k, i, side, trim, top] of jobs) {
    const p = streets[k].pts[i], f = side === 'l' ? 'tl' : 'tr';
    p[f] = Math.max(p[f] || 0, trim);
    if (top == null) continue;
    if (!targets.has(k)) targets.set(k, new Map());
    const t = targets.get(k), y = top - lift(k);
    if (!t.has(i) || Math.abs(y - p.y) > Math.abs(t.get(i) - p.y)) t.set(i, y);
    n++;
  }
  // trims vary smoothly along a street: a point between two trimmed ones (within 5 m) is trimmed as much as the
  // lesser of them, so the trimmed edge never zig-zags (no sawtooth of ground showing between two ribbons)
  for (const st of streets) {
    const P = st.pts;
    for (const f of ['tl', 'tr']) {
      const v = P.map((p) => p[f] || 0);
      for (let i = 1; i < P.length - 1; i++) {
        if (Math.hypot(P[i + 1].x - P[i - 1].x, P[i + 1].z - P[i - 1].z) > 10) continue;
        const m = Math.min(v[i - 1], v[i + 1]);
        if (m > v[i]) P[i][f] = m;
      }
    }
  }
  for (const [k, t] of targets) {
    const st = streets[k], P = st.pts, A = acc(st), own = P.map((p) => p.y);
    const best = P.map(() => null);
    for (const [j, y] of t) {
      const dy = y - own[j]; if (Math.abs(dy) < .003) continue;
      const L = Math.max(4, Math.abs(dy) / O.grade);
      for (let i = 0; i < P.length; i++) { const d = Math.abs(A[i] - A[j]); if (d < L) { const w = t.has(i) ? (i === j ? 1 : 0) : 1 - smooth(d / L); if (w > 0 && (!best[i] || w > best[i][0])) best[i] = [w, dy]; } }
    }
    P.forEach((p, i) => { if (best[i] && p.jn == null && !p.along && !p.pin) p.y = own[i] + best[i][1] * best[i][0]; });
  }
  return n;
}

/** Could any point of this street lie within `reach` of the route's line? (its bounding circle; cheap pre-check) */
const nearRouteStreet = (st, index, reach) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of st.pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
  return !!index.nearest((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + reach);
};

const segDist = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
  return { d: Math.hypot(a.x + dx * t - x, a.z + dz * t - z), t };
};
/** A drawn ribbon segment's half-width on the side of (x, z) (its trims: `tl` on its (dz, −dx) side, `tr` the other). */
const sideR = (x, z, sg, t) => {
  const dx = sg.b.x - sg.a.x, dz = sg.b.z - sg.a.z, px = sg.a.x + dx * t, pz = sg.a.z + dz * t;
  const left = (x - px) * dz - (z - pz) * dx > 0;
  const trim = left ? (sg.a.tl || 0) + ((sg.b.tl || 0) - (sg.a.tl || 0)) * t : (sg.a.tr || 0) + ((sg.b.tr || 0) - (sg.a.tr || 0)) * t;
  return Math.max(0, sg.r - trim);
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
  // the route's road as drawn (its curve): {d, y (line height), i} like landscape.routeDist
  const RL = routeLine(route, index);
  const roadAt = (x, z) => {
    const r = landscape.routeDist(x, z); if (!r) return null;
    const q = RL.project(x, z, route.dist[Math.min(end, r.i)], 25);
    return q ? { d: q.d, y: q.y, i: r.i, s: q.s } : r;
  };
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
        segs.push({ k, q, i, a, b, r, last: i === pc.length - 1 });
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
      const { d, t } = segDist(x, z, sg.a, sg.b), edge = d - sideR(x, z, sg, t);
      if (edge > pad) continue;
      const prev = seen.get(sg.k);
      if (prev && prev.edge <= edge) continue;
      const o = { kind: 'street', k: sg.k, top: sg.a.top + (sg.b.top - sg.a.top) * t, edge };
      if (prev) out[out.indexOf(prev)] = o; else out.push(o);
      seen.set(sg.k, o);
    }
    for (const { jn, d } of plan ? junctionsNear(plan, x, z, pad) : []) out.push({ kind: 'junction', jn: jn.id, top: jn.top(x, z), edge: d });
    const r = roadAt(x, z);
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
  // an issue counts when it is bigger than its limit, scaled with the site's distance from the route (what a rider can
  // see: a 9 cm lip at the roadside, 35 cm 75 m away); `scaled` false: the limit holds everywhere (paint, clipping)
  const issue = (site, check, value, note, limit = 0, scaled = true) => {
    if (!site || !(Math.abs(value) > limit * (scaled ? 1 + site.d / O.seeM : 1))) return;
    site.issues.push({ check, value: Math.round(value * 100) / 100, note });
  };

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
        for (const c of A.mouth) { const r = roadAt(c.x, c.z); if (r) step = Math.max(step, Math.abs(r.y + ROAD_LIFT - jn.top(c.x, c.z))); }
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
        // (or the street ends inside this junction: a stub, nothing to meet)
        const beyond = [.6, 1.5].some((dd) => { const q = { x: A.cutP.x + A.ud.x * dd, z: A.cutP.z + A.ud.z * dd }; return junctionsNear(plan, q.x, q.z, .6).some((o) => o.jn !== jn && o.d < .6); });
        // ([w2-meets] or what lies beyond is the route's road and its shoulder: covered, nothing to see through)
        const q2 = { x: A.cutP.x + A.ud.x * 1.5, z: A.cutP.z + A.ud.z * 1.5 }, rq = roadAt(q2.x, q2.z), underRoad = rq && rq.d < RW / 2 + 2.2;
        if (!beyond && !underRoad && A.avail > A.t + .3) gap = Math.max(gap, best ? best.dd : A.h);
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
        // (a corner under the route's road — or under its shoulder, which a junction it doesn't pass through leaves
        // in place — is hidden by it: no lip shows there)
        const r = roadAt(m.x, m.z), hidden = r && r.d < RW / 2 + (jn.route ? .3 : 2) && Math.max(p.top, jn.top(m.x, m.z)) < r.y + ROAD_LIFT - .03;
        if (!hidden) step = Math.max(step, Math.abs(p.top - jn.top(m.x, m.z)));
      }
    }
    issue(site, 'step', step, 'a street meets the junction surface with a lip', O.step);
    issue(site, 'gap', gap, 'a street’s end and the junction’s mouth don’t line up', O.gap);
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
    issue(site, 'overlap', over, 'another street’s ribbon is drawn inside the junction', O.overlapM);
    // paint as drawn: a street's crosswalk or stop line never on the route's road, the route's own never inside a
    // junction (nor across the road mid-junction), every quad square (a parallelogram along its street)
    let wrong = 0, why = '';
    for (const q of paint.byJn.get(jn.id) || []) {
      const c = { x: (q.pts[0].x + q.pts[2].x) / 2, z: (q.pts[0].z + q.pts[2].z) / 2 };
      if (q.kind === 'route-crosswalk') { if (plan.list.some((o) => o.bb && c.x > o.bb[0] && c.x < o.bb[1] && c.z > o.bb[2] && c.z < o.bb[3] && inPoly(o.poly, c.x, c.z))) { wrong++; why = 'a route crosswalk inside a junction'; } continue; }
      const onRoad = q.pts.some((p) => { const r = roadAt(p.x, p.z); return r && r.d < RW / 2 && Math.abs(r.y + ROAD_LIFT - p.y) < 4; });
      if (onRoad) { wrong++; why = 'a street crosswalk or stop line on the route’s road'; }
      else if (junctionsNear(plan, c.x, c.z, 0).some((o) => o.d < 0)) { wrong++; why = 'paint inside a junction'; }
    }
    if (wrong) issue(site, 'paint', wrong, why, 0, false);
  }

  // 2. street ends and shared nodes outside junctions
  const keyOf = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  const ends = new Map();   // node key → [{k, e (0 | last), p (drawn end), pc}]
  for (const [k, pcs] of drawn) {
    for (const pc of pcs) for (const e of [0, pc.length - 1]) {
      const p = pc[e]; if (p.cut) continue;   // (a cut end meets its junction: checked above)
      if ((p.tl || 0) + (p.tr || 0) > streets[k].width - .3) continue;   // (trimmed away to nothing: not drawn)
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
      issue(site, 'step', hi - lo, kind === 'link' ? 'a street carries on as another at a different height' : 'streets share a node at different heights', O.step);
      if (kind === 'link') {   // the two ribbons' end edges: each square to its own direction → a wedge on the outside of the bend
        const dirOf = (o) => { const nb = o.pc[o.e === 0 ? 1 : o.pc.length - 2]; const dx = nb.x - o.p.x, dz = nb.z - o.p.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
        const a = dirOf(list[0]), b = dirOf(list[1]);
        const cos = -(a.x * b.x + a.z * b.z), th = Math.acos(Math.max(-1, Math.min(1, cos)));
        const w = Math.min(streets[list[0].k].width, streets[list[1].k].width);
        const miter = list[0].p.tx != null && list[1].p.tx != null;
        const wedge = miter ? 0 : w * Math.sin(th / 2);
        issue(site, 'gap', wedge, 'two ribbons meet at an angle with a notch between their ends', O.gap);
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
      if (step > 4) issue(site, 'dangling', p.y - landscape.heightAt(p.x, p.z), 'a roadway ends in the air beside another at a different level', O.dangle);
      else issue(site, 'step', step, `a street ends against ${touch.kind === 'route' ? 'the route’s road' : touch.kind === 'junction' ? 'a junction' : 'another street'} at a different height`, O.step);
      continue;
    }
    // free end: on the ground, or hanging?
    const g = landscape.heightAt(p.x, p.z), off = p.top - .1 - g;
    if (Math.abs(off) > O.dangle) {
      const site = add({ kind: 'end', x: p.x, z: p.z, y: p.y, streets: [o.k], meets: 'nothing', bridge: st.bridge });
      issue(site, 'dangling', off, off > 0 ? 'a roadway ends in the air' : 'a roadway ends below the ground', O.dangle);
    }
  }

  // 2b. paths (cls 8: footpaths, cycleways) are drawn too: a path end that meets nothing must sit on the ground
  streets.forEach((st, k) => {
    if (st.cls !== 8 || st.pts.length < 2) return;
    for (const p of [st.pts[0], st.pts[st.pts.length - 1]]) {
      if ((ends.get(keyOf(p)) || []).length || through.has(keyOf(p))) continue;
      if (streets.some((o, j) => j !== k && o.pts.length && [o.pts[0], o.pts[o.pts.length - 1]].some((q) => keyOf(q) === keyOf(p)))) continue;
      if (surfacesAt(p.x, p.z, 1).length) continue;
      const off = p.y - landscape.heightAt(p.x, p.z);   // (the ground as drawn)
      if (Math.abs(off) > O.dangle) issue(add({ kind: 'end', x: p.x, z: p.z, y: p.y, streets: [k], meets: 'nothing', path: true }), 'dangling', off, off > 0 ? 'a path ends in the air' : 'a path ends below the ground', O.dangle);
    }
  });

  // 3. the route's road: streets that cross it or run along it at its level outside the junctions, and ribbons its
  // clearance tube cuts
  const inJunction = (x, z) => plan && junctionsNear(plan, x, z, .5).some((o) => o.d < .5);
  const runs = new Map();   // k → current run
  const flush = (key) => {
    const run = runs.get(key); runs.delete(key);
    if (!run || run.m < 1.5) return;
    const site = add({ kind: run.kind, x: run.x, z: run.z, y: run.y, streets: [+key.slice(1)], along: run.along });
    if (!site) return;
    if (run.kind === 'clipped') { issue(site, 'clipped', run.m, 'the route’s clearance cuts a hole in a street (ends left hanging)', O.clippedM, false); return; }
    issue(site, 'step', run.step, run.along ? 'a street runs beside the route’s road at a different height' : 'a street meets the route’s road at a different height', O.step + .1);
    if (!run.along) issue(site, 'overlap', run.m, 'a street crosses the route’s road with no junction', 3);
  };
  for (const [k, pcs] of drawn) {
    const st = streets[k];
    for (const pc of pcs) {
      for (let i = 1; i < pc.length; i++) {
        const a = pc[i - 1], b = pc[i], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 2));
        const ux = (b.x - a.x) / (len || 1), uz = (b.z - a.z) / (len || 1);
        for (let q = 0; q < n; q++) {
          const f = (q + .5) / n, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, top = a.top + (b.top - a.top) * f, m = len / n;
          // (a stretch trimmed away to nothing isn't drawn: nothing to meet, clip or overlap)
          if ((a.tl || 0) + ((b.tl || 0) - (a.tl || 0)) * f + (a.tr || 0) + ((b.tr || 0) - (a.tr || 0)) * f > st.width - .3) { for (const kk of [`t${k}`, `r${k}`]) if (runs.has(kk)) flush(kk); continue; }
          const r = roadAt(x, z);
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
            // the part of the ribbon beyond the road's edge shows: its height against the road's, where what is drawn of
            // it (trims taken off) still reaches over the road's shoulder from beyond it
            const tl = (a.tl || 0) + ((b.tl || 0) - (a.tl || 0)) * f, tr = (a.tr || 0) + ((b.tr || 0) - (a.tr || 0)) * f, h = st.width / 2;
            const c = RL.at(r.s ?? 0), left = (c.x - x) * uz - (c.z - z) * ux > 0;
            const near = r.d - (h - (left ? tl : tr)), far = r.d + (h - (left ? tr : tl));
            if (h * 2 - tl - tr > .3 && near < RW / 2 + 2.1 && far > RW / 2 + 2.2) run.step = Math.max(run.step, Math.abs(r.y + ROAD_LIFT - top));
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
    const ux = (sg.b.x - sg.a.x) / (len || 1), uz = (sg.b.z - sg.a.z) / (len || 1);
    for (let q = 0; q < n; q++) {
      const f = (q + .5) / n, top = sg.a.top + (sg.b.top - sg.a.top) * f;
      // the middle of what is drawn of this ribbon here (trimmed ribbons: off its line)
      const tl = (sg.a.tl || 0) + ((sg.b.tl || 0) - (sg.a.tl || 0)) * f, tr = (sg.a.tr || 0) + ((sg.b.tr || 0) - (sg.a.tr || 0)) * f;
      if (tl + tr > 2 * sg.r - .4) continue;   // (nothing drawn here)
      const off = (tr - tl) / 2, x = sg.a.x + (sg.b.x - sg.a.x) * f + uz * off, z = sg.a.z + (sg.b.z - sg.a.z) * f - ux * off;
      { const r = roadAt(x, z); if (r && r.d < RW / 2 + 2.2 && top < r.y + ROAD_LIFT - .02) continue; }   // (hidden under the road and its shoulder)
      let hit = null;
      for (const id of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) || []) {
        const o = segs[id];
        if (o.k === sg.k) continue;
        // (how deep the two drawn ribbons overlap here: less than `overlapDepth` is a shared edge, not one over another)
        const { d, t } = segDist(x, z, o.a, o.b), hw = sg.r - (tl + tr) / 2;
        // (past the end of the other ribbon nothing of it is drawn: a street carrying on from it isn't under it)
        { const ox = o.b.x - o.a.x, oz = o.b.z - o.a.z, ol = Math.hypot(ox, oz) || 1, tu = ((x - o.a.x) * ox + (z - o.a.z) * oz) / ol; if (tu < -.5 || tu > ol + .5) continue; }
        if (sideR(x, z, o, t) + Math.min(hw, sideR(x, z, o, t)) - d > O.overlapDepth && d < sideR(x, z, o, t) + hw && Math.abs(o.a.top + (o.b.top - o.a.top) * t - top) < O.level) { hit = o; break; }
      }
      if (!hit) continue;
      if (O.debug) { const dx = hit.b.x - hit.a.x, dz = hit.b.z - hit.a.z; O.debug.push({ k: sg.k, ko: hit.k, cos: Math.abs((ux * dx + uz * dz) / (Math.hypot(dx, dz) || 1)), tl, tr, otl: hit.a.tl || 0, otr: hit.a.tr || 0, x, z }); }
      const key = `${Math.floor(x / 40)},${Math.floor(z / 40)}`, c = clusters.get(key) || { x, z, y: top, m: 0, ks: new Set() };
      c.m += len / n; c.ks.add(sg.k); c.ks.add(hit.k); clusters.set(key, c);
    }
  }
  for (const c of clusters.values()) {
    const site = add({ kind: 'overlap', x: c.x, z: c.z, y: c.y, streets: [...c.ks] });
    if (site) issue(site, 'overlap', c.m, 'street ribbons drawn over each other at one level (no junction)', O.overlapM);
  }

  sites.sort((a, b) => a.s - b.s || a.kind.localeCompare(b.kind));
  sites.forEach((s, i) => { s.id = i; });
  const counts = {};
  for (const s of sites) { counts[s.kind] = (counts[s.kind] || 0) + 1; }
  return { sites, counts, issues: sites.filter((s) => s.issues.length).length, paint: paint && { quads: paint.quads.length, bad: paint.bad.length } };
}
