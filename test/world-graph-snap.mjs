// [review 27 Nov] W14: the graph world's junction plan and curves as a fingerprint, per map: the plan's every node
// (centre, polygon, corners, arms: their cuts, mouths, returns) and trims, the drawn curves of every edge and points
// on them, and the ground's road hash — serialised (numbers exact) and hashed. test/world-graph.test.mjs compares the
// extracted modules (js/world/graph/*.js) with test/fixtures/graph-plan.snapshot.json, taken from GraphWorld's own
// methods before they moved: the extraction must not move a single vertex.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodeGraph } from '../js/graph.js';
import { makeProjection } from '../js/world/geo.js';
import { mapProfile } from '../js/world/toolbox/map-profile.js';

export const MAPS = ['pgh', 'cny', 'skan', 'nyc', 'outwest'];
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);

/** A map's edges in the local frame (as GraphWorld's constructor lays them), its profile, widths and arms. */
export function loadMap(id, root) {
  const json = JSON.parse(readFileSync(new URL(`routes/cities/${id}.json`, root), 'utf8'));
  const G = decodeGraph(json), proj = makeProjection(json.origin.lat, json.origin.lon);
  for (const e of G.edges) {
    e.x = new Float64Array(e.n + 1); e.z = new Float64Array(e.n + 1);
    for (let i = 0; i <= e.n; i++) { const q = proj.toLocal(e.lat[i], e.lon[i]); e.x[i] = q.x; e.z[i] = q.z; }
  }
  // (a few edges with the city's own widths and sidewalks, as graph-city.js sets them: the plan reads both)
  G.edges.forEach((e, k) => { if (k % 7 === 3) e._w = 5 + (k % 5); if (k % 11 === 5) e._walk = 1.5; });
  const widths = json.widths || {}, wOf = (e) => e._w ?? (widths[e.kind] || 7), walkOf = (e) => e._walk || 0;
  const arms = new Map();
  for (const e of G.edges) for (const [id2, end] of [[e.from, 0], [e.to, 1]]) { if (!arms.has(id2)) arms.set(id2, []); arms.get(id2).push({ e, end }); }
  return { json, G, profile: mapProfile(json), wOf, walkOf, arms, widths };
}

const num = (v) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : v === undefined ? 'u' : v === null ? 'n' : JSON.stringify(v));
const pt = (p) => (p ? `${num(p.x)},${num(p.y)},${num(p.z)}` : 'n');

/** plan: { jn, trim } (graph-world's this.jn / this.trim). */
export function planPrint(plan) {
  const out = [];
  for (const [id, J] of plan.jn) {
    const idx = new Map(J.arms.map((A, k) => [A, k]));
    out.push(`J ${id} ${num(J.x)} ${num(J.z)} ${num(J.y)} ${num(J.J(J.x + 3, J.z - 2))} poly ${J.poly.map(pt).join(' ')}`);
    for (const A of J.arms) out.push(` A ${A.e.id} ${A.end} u ${num(A.u.x)},${num(A.u.z)} h ${num(A.h)} w ${num(A.walk)} r ${num(A.r)} len ${num(A.len)} o ${A.other} th ${num(A.theta)} t ${num(A.t)} cut ${pt(A.cut)} ud ${num(A.ud.x)},${num(A.ud.z)} m ${A.mouth.map(pt).join(' ')}`);
    for (const c of J.corners) out.push(` C ${idx.get(c.A)} ${idx.get(c.B)} ${num(c.gap)} ${num(c.tA)} ${num(c.tB)} arc ${c.arc ? `${pt(c.arc.O)} ${num(c.arc.r)}` : 'n'} curb ${c.curb.map(pt).join(' ')}`);
  }
  for (const [id, t] of plan.trim) out.push(`T ${id} ${num(t[0])} ${num(t[1])}`);
  return out.join('\n');
}

/** fns: { plan(map) → { jn, trim }, curvePoint(e, f), curve(e, a, b), roadHash(edges, wOf) }. */
export function snapshotGraph(fns, root) {
  const snap = {};
  for (const id of MAPS) {
    const M = loadMap(id, root);
    const plan = fns.plan(M);
    const cps = [], cvs = [];
    M.G.edges.forEach((e, k) => {
      if (k % 3) return;
      for (const f of [0, 0.37, e.n / 2, e.n - 0.6, e.n]) { const p = fns.curvePoint(e, f); cps.push(`${pt(p)} ${num(p.dx)} ${num(p.dz)}`); }
      const a = Math.min(e.n, k % 5), b = Math.max(a, Math.min(e.n, a + 1 + (k % 40)));
      cvs.push(fns.curve(e, a, b).map((p) => `${pt(p)} ${num(p.i)} ${num(p.s)} ${num(p.dx)} ${num(p.dz)}`).join(' '));
    });
    const H = fns.roadHash(M.G.edges, M.wOf), probes = [];
    for (const e of M.G.edges.filter((_, k) => k % 9 === 0)) for (const i of [0, e.n >> 1]) probes.push(`${num(H.cap(e.x[i] + 4, e.z[i] - 3))} ${num(H.fill(e.x[i] - 2, e.z[i] + 5))}`);
    const cells = [...H.grid.entries()].sort((p, q) => p[0] - q[0]).map(([k, v]) => `${k}:${Array.from(v, num).join(',')}`).join(';');
    snap[id] = { nodes: plan.jn.size, trims: plan.trim.size, plan: sha(planPrint(plan)), curvePoints: sha(cps.join('\n')), curves: sha(cvs.join('\n')), roadHash: sha(cells), roadProbes: sha(probes.join('\n')) };
  }
  return snap;
}
