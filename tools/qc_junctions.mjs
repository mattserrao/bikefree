#!/usr/bin/env node
// Junction QC: the junctions the renderer draws where city streets meet a bike route (js/world/toolbox/city/junctions.js,
// planned by cityStreets() exactly as the game plans them), measured so "it looks wrong" becomes numbers.
// (user, 20 Nov: "we need a change in the code for how junctions work" — this is step 1: measure before changing)
//
// | check      | what it catches (route junctions, and any junction within --near m of the route's road) |
// | oversize   | the surface reaches > its widest arm's half-width + 2 curb radii + 8 m from its centre: a shapeless blob
// |            | (several junctions lumped into one; #3, #13, #22, #24 of the busiest route sites) |
// | self-cross | the surface's outline crosses itself: a torn, shard-like surface (#1) |
// | sharp-arm  | two neighbouring arms < 25° apart: their curb return can't be drawn, the corner is a wedge |
// | kerb-road  | a corner sidewalk (kerb) point lies on the route's road: a kerb wedge in the bike lane (#14, #22) |
// | sliver     | a corner sidewalk whose curb is shorter than 1.5 m, or a gap < 3° between arms: a leftover shard |
// | overlap    | two junctions' surfaces overlap: two blobs drawn over each other |
// | bridge-end | a route junction whose stretch of the route (its trimmed route arms) reaches within 2 m of a bridge the route draws:
// |            | a junction at an abutment or on the deck (#12, #18) |
//
// node tools/qc_junctions.mjs [area ids…] [--near 25] [--json out.json] [--baseline] [--shots dir]
//   --baseline writes tools/qc-junctions-baseline.json (test/qc-junctions.test.mjs holds every area to it)
//   --shots writes a snap_cam shots file per area for the 12 worst junctions (render with tools/snap_cam.mjs)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { cityStreets } from '../js/world/toolbox/city/landscape.js';
import { ROAD_WIDTH } from '../js/world/pose.js';
import { loadSceneSync } from './qc_course.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const BASELINE_FILE = 'tools/qc-junctions-baseline.json';
export const CHECKS = ['oversize', 'self-cross', 'sharp-arm', 'kerb-road', 'sliver', 'overlap', 'bridge-end'];
export const JQ = { near: 25, overReach: 8, sharpDeg: 25, sliverM: 1.5, bridgeM: 15 };
const CURB_R = (cls) => (cls <= 1 ? 9 : cls <= 3 ? 6 : cls <= 6 ? 4.5 : 3);

const segX = (a, b, c, d) => {
  const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
};
const inside = (ring, x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r; } return r; };
const area = (P) => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j].x * P[i].z - P[i].x * P[j].z); return Math.abs(s) / 2; };

/** Junction findings for one area: [{ check, jn, x, z, s, value, note }] + the plan's counts. */
export function qcJunctions({ item, scene, near = JQ.near }) {
  if (!scene.city && scene.cityData) scene = { ...scene, city: JSON.parse(read(scene.cityData)) };
  const route = buildCatalogRoute(read(item.file), item); route.scene = scene;
  const proj = makeProjection(scene.origin.lat, scene.origin.lon), index = makeRouteIndex(route, proj);
  const L = landscapeBuilder(scene)(scene, proj, index, route);
  if (!L.city) return { findings: [], junctions: 0, routeJunctions: 0, proj };
  cityStreets(L, index, route);
  const plan = L._junctions;
  if (!plan) return { findings: [], junctions: 0, routeJunctions: 0, proj };
  const RW = ROAD_WIDTH, end = route.turnIdx || route.dist.length - 1;
  const bridges = (L.routeBridges || []).filter((b) => !b.underpass);
  const routeD = (x, z) => { const q = index.nearest(x, z, 200); return q ? q.d : Infinity; };
  const findings = [];
  const scope = plan.list.filter((jn) => jn.route || jn.poly.some((p) => routeD(p.x, p.z) < RW / 2 + near));
  const add = (check, jn, value, note) => findings.push({ check, jn: jn.id, x: +jn.x.toFixed(1), z: +jn.z.toFixed(1), s: jn.s != null ? Math.round(jn.s) : null, route: jn.route, value: +(+value).toFixed(2), note });
  for (const jn of scope) {
    const P = jn.poly;
    // oversize: the surface's reach from its centre against what its arms need
    const need = Math.max(...jn.arms.map((a) => a.h)) + 2 * Math.max(...jn.arms.map((a) => (a.route ? 6 : CURB_R(a.cls)))) + JQ.overReach;
    const reach = Math.max(...P.map((p) => Math.hypot(p.x - jn.x, p.z - jn.z)));
    if (reach > need) add('oversize', jn, reach - need, `surface reaches ${reach.toFixed(0)} m from its centre (its arms need ${need.toFixed(0)} m)`);
    // self-cross
    let crosses = 0;
    for (let i = 0; i < P.length; i++) for (let j = i + 2; j < P.length; j++) { if (i === 0 && j === P.length - 1) continue; if (segX(P[i], P[(i + 1) % P.length], P[j], P[(j + 1) % P.length])) crosses++; }
    if (crosses) add('self-cross', jn, crosses, `outline crosses itself ${crosses}×`);
    // arms: angles between neighbours
    const th = jn.arms.map((a) => Math.atan2(a.u.z, a.u.x)).sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 0; i < th.length; i++) { let g = (th[(i + 1) % th.length] - th[i]) * 180 / Math.PI; if (g <= 0) g += 360; minGap = Math.min(minGap, g); }
    if (th.length > 1 && minGap < 3) add('sliver', jn, minGap, `two arms ${minGap.toFixed(1)}° apart`);
    else if (th.length > 1 && minGap < JQ.sharpDeg) add('sharp-arm', jn, minGap, `two arms only ${minGap.toFixed(0)}° apart`);
    // kerbs: corner sidewalks on the route's road, and tiny ones
    let onRoad = 0, tiny = 0;
    for (const c of jn.curbs || []) {
      let len = 0; for (let i = 1; i < c.pts.length; i++) len += Math.hypot(c.pts[i].x - c.pts[i - 1].x, c.pts[i].z - c.pts[i - 1].z);
      if (len < JQ.sliverM) tiny++;
      if (c.pts.some((p) => routeD(p.x, p.z) < RW / 2 - .5)) onRoad++;
    }
    if (onRoad) add('kerb-road', jn, onRoad, `${onRoad} corner kerb(s) on the route's road`);
    if (tiny) add('sliver', jn, tiny, `${tiny} corner kerb(s) under ${JQ.sliverM} m long`);
    // bridge ends: the stretch of route the junction covers (its route arms' trims) reaches a bridge the route draws
    if (jn.route && jn.s != null) {
      // (the arms' trims and the surface itself: every outline point's place along the route, out to 15 m from its road)
      const ra = jn.arms.filter((a) => a.route); let s0 = jn.s - (ra.find((a) => a.dir < 0)?.t ?? 0), s1 = jn.s + (ra.find((a) => a.dir > 0)?.t ?? 0);
      for (const p of jn.poly) {
        const q = index.nearest(p.x, p.z, RW / 2 + 15); if (!q || q.i > end) continue;
        // (exactly along the line: the nearest of the two segments either side of the nearest sample)
        let best = null;
        for (const j of [q.i - 1, q.i]) {
          if (j < 0 || j + 1 >= index.xs.length) continue;
          const ax = index.xs[j], az = index.zs[j], dx = index.xs[j + 1] - ax, dz = index.zs[j + 1] - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - p.x, az + dz * t - p.z);
          if (!best || d < best.d) best = { d, s: route.dist[j] + (route.dist[j + 1] - route.dist[j]) * t };
        }
        if (best && Math.abs(best.s - jn.s) < 80) { s0 = Math.min(s0, best.s); s1 = Math.max(s1, best.s); }
      }
      const b = bridges.find((b) => s1 > b.fromM - 2 && s0 < b.toM + 2);
      if (b) add('bridge-end', jn, Math.max(0, Math.min(Math.abs(jn.s - b.fromM), Math.abs(jn.s - b.toM))), `route junction (${s0.toFixed(0)}–${s1.toFixed(0)} m) reaches ${b.name || 'a bridge'} (${b.fromM}–${b.toM} m)`);
    }
  }
  // overlaps between surfaces in scope
  for (let a = 0; a < scope.length; a++) for (let b = a + 1; b < scope.length; b++) {
    const A = scope[a], B = scope[b];
    if (Math.hypot(A.x - B.x, A.z - B.z) > 80) continue;
    if (A.poly.some((p) => inside(B.poly, p.x, p.z)) || B.poly.some((p) => inside(A.poly, p.x, p.z))) add('overlap', A, B.id, `surface overlaps junction ${B.id}`);
  }
  return { findings, junctions: plan.list.length, routeJunctions: plan.list.filter((j) => j.route).length, scoped: scope.length, proj, route, index };
}

export const countsOf = (findings) => Object.fromEntries(CHECKS.map((c) => [c, findings.filter((f) => f.check === c).length]));
export function junctionAreas(ids = null) {
  const catalog = JSON.parse(read('routes/parks/index.json'));
  return catalog.filter((it) => (ids?.length ? ids.includes(it.id) : it.id.startsWith('pittsburgh')) && it.scene)
    .map((item) => ({ item, scene: loadSceneSync(item.scene) })).filter(({ scene }) => scene.cityData);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
  const near = Number(opt('--near', JQ.near)), json = opt('--json', null), shots = opt('--shots', null), baseline = flag('--baseline');
  const out = {};
  for (const { item, scene } of junctionAreas(args)) {
    const t0 = Date.now();
    const r = qcJunctions({ item, scene, near });
    const c = countsOf(r.findings);
    out[item.id] = { counts: c, junctions: r.junctions, routeJunctions: r.routeJunctions, scoped: r.scoped, findings: r.findings };
    console.log(`${item.id.padEnd(22)} ${String(r.scoped).padStart(4)} junctions at the route  ${CHECKS.map((k) => `${k} ${c[k]}`).join('  ')}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (shots) {
      // the worst junctions: most findings first
      const by = new Map(); for (const f of r.findings) by.set(f.jn, [...(by.get(f.jn) || []), f]);
      const worst = [...by.values()].sort((a, b) => b.length - a.length).slice(0, 12);
      const sh = worst.map((fs) => {
        const f = fs[0], g = r.proj.toLatLon(f.x, f.z), back = r.proj.toLatLon(f.x + 35, f.z + 35);
        return { name: `${item.id}-jn${f.jn}`, cam: [back.lat, back.lon, null], camUp: 40, look: [g.lat, g.lon, null], checks: fs.map((x) => x.check) };
      });
      mkdirSync(shots, { recursive: true }); writeFileSync(join(shots, `shots-${item.id}.json`), JSON.stringify(sh));
    }
  }
  if (json) writeFileSync(json, JSON.stringify(out, null, 1));
  if (baseline) {
    writeFileSync(join(ROOT, BASELINE_FILE), JSON.stringify(Object.fromEntries(Object.entries(out).map(([id, o]) => [id, o.counts])), null, 1) + '\n');
    console.log(`Baseline: ${BASELINE_FILE}`);
  }
  const tot = Object.fromEntries(CHECKS.map((k) => [k, Object.values(out).reduce((a, o) => a + o.counts[k], 0)]));
  console.log(`total: ${CHECKS.map((k) => `${k} ${tot[k]}`).join('  ')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
