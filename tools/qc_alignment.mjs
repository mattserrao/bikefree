// Course QC: road alignment checks (plan, profile, city streets). Called by tools/qc_course.mjs ([road-align]);
// route-agnostic: the plan and profile checks run on every route, the street checks on city scenes.
//
// | check            | severity | what it catches |
// | lateral-jump     | warn     | one 10 m sample pushed sideways off the line through its neighbours (a jog) |
// | heading-jitter   | warn     | the drawn centre line's turn rate changes abruptly (a kink you see); info where the
// |                  |          | scene draws straight 10 m pieces (no `roadAlign.curve`): those facets are expected |
//
// Severity: warn on routes whose scene has `roadAlign` (street checks: `roadAlign.streets`); info elsewhere, so
// the report shows them without failing routes that don't use the alignment system yet.
// | grade-crease     | warn     | the drawn road's grade changes sharply between 10 m pieces (a crease in the surface) |
// | route-off-ground | warn     | (city) the road runs well above or below its own bare ground, off bridges |
// | street-steep     | warn     | (city) a street steeper than any real street (ground streets) |
// | street-crease    | warn     | (city) a street's grade changes abruptly (a step or a hump in the ribbon) |
// | street-step      | warn     | (city) streets meeting at a junction node arrive at different heights |
// | street-bank      | warn     | (city) a street on an embankment or in a trench: its ground lies well below/above on both sides |
import { cityStreets } from '../js/world/city-landscape.js';
import { routePoint } from '../js/world/pose.js';
import { curveOn } from '../js/world/road-align.js';

export const ALIGN_LIMITS = {
  lateral: .8,         // m: a 10 m sample this far off the smooth curve through its neighbours, turning against both
  jogTurn: 4,          // °: …and every one of the three samples turns at least this much (a jog, not a corner's tail)
  jitter: 3,           // °/m per m: change of the drawn line's turn rate (2 m chords)
  crease: 4.5,         // %-points between consecutive 10 m pieces of the drawn road
  offGround: 4,        // m: road above/below its bare ground (city, off bridges and their approaches)
  streetSteep: 38,     // %: ground street grade over a ≥ 10 m stretch
  streetCrease: 22,    // %-points between consecutive street pieces (≥ 3 m long)
  streetStep: .3,      // m: height difference between streets at one junction node
  streetBank: 5,       // m: street above (or below) its bare ground on both sides, 6 m beyond the carriageway
  streetReach: 300,    // m: streets checked within this distance of the route (what a rider sees)
};

const turnDeg = (ax, az, bx, bz, cx, cz) => ((((Math.atan2(cz - bz, cx - bx) - Math.atan2(bz - az, bx - ax)) * 180) / Math.PI + 540) % 360) - 180;

/** Run the alignment checks; findings go to F (qc_course's Findings). */
export function alignmentChecks({ route, index, landscape, F, nearUturn, oneWay }) {
  const L = ALIGN_LIMITS, end = route.turnIdx || route.dist.length - 1, last = Math.round(oneWay / 10);
  // enforced (warn) on routes whose scene uses the alignment system; reported (info) on the others
  const align = route.scene?.roadAlign, sev = align ? 'warn' : 'info', streetSev = align?.streets ? 'warn' : 'info';
  // plan: one 10 m sample pushed sideways (off the cubic through its neighbours, turning against both)
  const t = (i) => turnDeg(index.xs[i - 1], index.zs[i - 1], index.xs[i], index.zs[i], index.xs[i + 1], index.zs[i + 1]);
  for (let i = 3; i < last - 3; i++) {
    const s = route.dist[i]; if (nearUturn(s, 30)) continue;
    const ti = t(i), ta = t(i - 1), tb = t(i + 1);
    if (!(ti * ta < 0 && ti * tb < 0) || Math.min(Math.abs(ti), Math.abs(ta), Math.abs(tb)) <= L.jogTurn) continue;
    const px = (-index.xs[i - 2] + 4 * index.xs[i - 1] + 4 * index.xs[i + 1] - index.xs[i + 2]) / 6;
    const pz = (-index.zs[i - 2] + 4 * index.zs[i - 1] + 4 * index.zs[i + 1] - index.zs[i + 2]) / 6;
    const off = Math.hypot(index.xs[i] - px, index.zs[i] - pz);
    if (off > L.lateral) F.add('lateral-jump', sev, s, off, 'the road steps sideways at one point');
  }
  F.open.clear();
  // the drawn line: turn rate over 2 m chords, change per metre
  const curved = curveOn(route);
  let prevRate = null;
  for (let s = 2; s <= oneWay - 2; s += 1) {
    if (nearUturn(s, 15)) { prevRate = null; continue; }
    const a = routePoint(route, index, s - 1), b = routePoint(route, index, s), c = routePoint(route, index, s + 1);
    const rate = turnDeg(a.x, a.z, b.x, b.z, c.x, c.z);
    if (prevRate != null && Math.abs(rate - prevRate) > L.jitter)
      F.add('heading-jitter', curved && sev === 'warn' ? 'warn' : 'info', s, rate - prevRate, curved ? 'the road’s curve kinks' : 'straight 10 m pieces (turn on the scene’s roadAlign.curve)');
    prevRate = rate;
  }
  F.open.clear();
  // profile of the drawn road
  for (let i = 1; i < end - 1; i++) {
    const s = route.dist[i]; if (nearUturn(s, 20)) continue;
    const g0 = (route.ele[i] - route.ele[i - 1]) / ((route.dist[i] - route.dist[i - 1]) || 10) * 100;
    const g1 = (route.ele[i + 1] - route.ele[i]) / ((route.dist[i + 1] - route.dist[i]) || 10) * 100;
    if (Math.abs(g1 - g0) > L.crease) F.add('grade-crease', sev, s, g1 - g0, 'the road surface creases (grade changes sharply)');
  }
  F.open.clear();
  if (!landscape?.city) return;
  // route vs its own bare ground (off bridges, underpasses and their approaches)
  for (let i = 0; i <= end; i++) {
    const s = route.dist[i];
    if (landscape.routeBridges.some((b) => s > b.fromM - 40 && s < b.toM + 40)) continue;
    const d = route.ele[i] - landscape.terrainAt(index.xs[i], index.zs[i]);
    if (Math.abs(d) > L.offGround) F.add('route-off-ground', sev, s, d, d > 0 ? 'road rides above its own ground' : 'road sunk below its own ground');
  }
  F.open.clear();
  // city streets as drawn (the renderer's cityStreets)
  const streets = cityStreets(landscape, index, route);
  const sAt = (p) => { const r = index.nearest(p.x, p.z, L.streetReach); return r ? route.dist[Math.min(r.i, end)] : null; };
  const hits = [];
  streets.forEach((st) => {
    const P = st.pts;
    let run = 0, runMax = 0, runAt = null;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < .5) continue;
      const g = (b.y - a.y) / l * 100;
      if (!st.bridge && !a.pin && !b.pin && Math.abs(g) > L.streetSteep) { run += l; if (Math.abs(g) > Math.abs(runMax)) { runMax = g; runAt = b; } }
      else { if (run >= 10) hits.push(['street-steep', runAt, runMax, 'a street steeper than any real one']); run = 0; runMax = 0; }
      if (i + 1 < P.length) {
        const c = P[i + 1], l2 = Math.hypot(c.x - b.x, c.z - b.z);
        if (l >= 3 && l2 >= 3 && !a.pin && !b.pin && !c.pin) {
          const dg = (c.y - b.y) / l2 * 100 - g;
          if (Math.abs(dg) > L.streetCrease) hits.push(['street-crease', b, dg, 'a street’s grade changes abruptly (step or hump)']);
        }
      }
      if (!st.bridge && l >= 3 && i % 2 === 0) {
        const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l, o = st.width / 2 + 6;
        const up = b.y - landscape.baseHeight(b.x + nx * o, b.z + nz * o), dn = b.y - landscape.baseHeight(b.x - nx * o, b.z - nz * o);
        const wet = Math.max(landscape.waterAt(b.x + nx * o, b.z + nz * o), landscape.waterAt(b.x - nx * o, b.z - nz * o), landscape.waterAt(b.x, b.z));
        if (!b.pin && wet < .2 && Math.sign(up) === Math.sign(dn) && Math.min(Math.abs(up), Math.abs(dn)) > L.streetBank)
          hits.push(['street-bank', b, Math.sign(up) * Math.min(Math.abs(up), Math.abs(dn)), up > 0 ? 'a street on an embankment above its ground' : 'a street sunk in a trench']);
      }
    }
    if (run >= 10) hits.push(['street-steep', runAt, runMax, 'a street steeper than any real one']);
  });
  // junction nodes: every street through a shared node at one height (decks and the route's crossings aside)
  const nodes = new Map();
  streets.forEach((st, k) => st.pts.forEach((p) => {
    if (st.bridge || p.pin) return;
    const key = `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
    if (!nodes.has(key)) nodes.set(key, []);
    nodes.get(key).push([k, p]);
  }));
  for (const refs of nodes.values()) {
    if (new Set(refs.map((r) => r[0])).size < 2) continue;
    const ys = refs.map((r) => r[1].y), d = Math.max(...ys) - Math.min(...ys);
    if (d > L.streetStep && d < 4) hits.push(['street-step', refs[0][1], d, 'streets meet a junction at different heights']);
  }
  hits.map((h) => [sAt(h[1]), ...h]).filter((h) => h[0] != null).sort((a, b) => a[0] - b[0])
    .forEach(([s, check, , v, note]) => F.add(check, streetSev, s, v, note));
  F.open.clear();
}
