#!/usr/bin/env node
// Street network QC (user, 21 Nov: stubs, pieces that make no sense, roads over each other, random splices): what the
// rider sees within --near m (150) of the area's route, counted the way the renderer joins streets — two streets meet
// only where they share a point.
//
// | check   | what |
// | short   | a street piece under 30 m |
// | loose   | a street end that meets nothing (not a highway's: a corridor may end at the map's edge) |
// | stub    | a loose-ended piece under 60 m: a road to nowhere |
// | splice  | two pieces of one street meeting end to end with nothing else there (a street cut in pieces) |
// | overlap | two streets lying over each other along ≥ 15 m, away from where they meet |
//
// node tools/qc_streets.mjs [area ids…] [--near 150] [--baseline] [--json out]   (baseline: tools/qc-streets-baseline.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { STREET_W } from '../js/world/toolbox/city/landscape.js';
import { loadSceneSync } from './qc_course.mjs';
import { decodeStreets } from './repair_city.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const STREETS_BASELINE = 'tools/qc-streets-baseline.json';
export const SCHECKS = ['pieces', 'short', 'loose', 'stub', 'splice', 'overlap'];

export function qcStreets({ item, scene, near = 150 }) {
  const text = read(scene.cityData), city = JSON.parse(text), { streets } = decodeStreets(text);
  const proj = makeProjection(scene.origin.lat, scene.origin.lon), route = buildCatalogRoute(read(item.file), item), index = makeRouteIndex(route, proj);
  const [lat0, lon0] = city.origin, unit = city.unit, local = ([a, o]) => proj.toLocal(lat0 + a * unit, lon0 + o * unit);
  const G = streets.map((s, k) => { const pts = s.xy.map(local); let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); return { k, s, pts, len, cls: s.meta[0], w: STREET_W[s.meta[0]], bridge: !!(s.meta[1] & 1) }; });
  const seen = (g) => g.pts.some((p) => { const q = index.nearest(p.x, p.z, near); return q && q.d <= near; });
  const V = G.filter(seen), inV = new Set(V.map((g) => g.k));
  const key = (p) => p[0] * 65536 + p[1], use = new Map();
  G.forEach((g) => g.s.xy.forEach((p, i) => { const kk = key(p); if (!use.has(kk)) use.set(kk, []); use.get(kk).push({ k: g.k, i, end: i === 0 || i === g.s.xy.length - 1 }); }));
  const CELL = 25, gk = (i, j) => i * 100003 + j, grid = new Map();
  V.forEach((g) => { for (let i = 1; i < g.pts.length; i++) { const a = g.pts[i - 1], b = g.pts[i];
    for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++) for (let gz = Math.floor(Math.min(a.z, b.z) / CELL); gz <= Math.floor(Math.max(a.z, b.z) / CELL); gz++) { const kk = gk(gx, gz); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([g.k, i]); } } });
  const findings = [], add = (check, g, x, z, note) => findings.push({ check, k: g.k, cls: g.cls, x: Math.round(x), z: Math.round(z), note });
  for (const g of V) {
    if (g.len < 30) add('short', g, g.pts[0].x, g.pts[0].z, `${g.len.toFixed(0)} m piece`);
    if (g.cls === 0) continue;
    const loose = [0, g.pts.length - 1].filter((j) => !(use.get(key(g.s.xy[j])) || []).some((o) => o.k !== g.k));
    for (const j of loose) add('loose', g, g.pts[j].x, g.pts[j].z, 'end meets nothing');
    if (loose.length && g.len < 60) add('stub', g, g.pts[0].x, g.pts[0].z, `${g.len.toFixed(0)} m, loose-ended`);
  }
  for (const [kk, u] of use) {
    if (u.length !== 2 || !u[0].end || !u[1].end || u[0].k === u[1].k || !inV.has(u[0].k)) continue;
    const A = G[u[0].k], B = G[u[1].k];
    if (A.s.meta[0] === B.s.meta[0] && A.s.meta[1] === B.s.meta[1] && A.s.meta[2] === B.s.meta[2]) { const p = A.pts[u[0].i]; add('splice', A, p.x, p.z, `joins street ${B.k} end to end`); }
    void kk;
  }
  // overlaps: each pair once (the shorter's run along the other)
  const shared = (a, b) => G[a].s.xy.some((p) => (use.get(key(p)) || []).some((o) => o.k === b));
  const done = new Set();
  for (const g of V) {
    const run = new Map();
    for (let i = 1; i < g.pts.length; i++) {
      const a = g.pts[i - 1], b = g.pts[i], l = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(l / 4)), ux = (b.x - a.x) / (l || 1), uz = (b.z - a.z) / (l || 1);
      for (let m = 0; m < n; m++) {
        const x = a.x + (b.x - a.x) * (m + .5) / n, z = a.z + (b.z - a.z) * (m + .5) / n, hit = new Map();
        for (let gx = Math.floor((x - 12) / CELL); gx <= Math.floor((x + 12) / CELL); gx++) for (let gz = Math.floor((z - 12) / CELL); gz <= Math.floor((z + 12) / CELL); gz++)
          for (const [k, j] of grid.get(gk(gx, gz)) || []) {
            if (k === g.k || hit.has(k)) continue;
            const h = G[k]; if (h.bridge !== g.bridge) continue;
            const c = h.pts[j - 1], d = h.pts[j], dx = d.x - c.x, dz = d.z - c.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - c.x) * dx + (z - c.z) * dz) / l2));
            const dd = Math.hypot(c.x + dx * t - x, c.z + dz * t - z), hl = Math.sqrt(l2);
            if (dd < (g.w + h.w) / 2 * .8 && Math.abs((dx / hl) * ux + (dz / hl) * uz) > .8) hit.set(k, true);
          }
        for (const k of hit.keys()) run.set(k, (run.get(k) || 0) + l / n);
      }
    }
    for (const [k, r] of run) {
      const pair = g.k < k ? `${g.k}-${k}` : `${k}-${g.k}`;
      if (done.has(pair) || r < (shared(g.k, k) ? 30 : 15)) continue;
      done.add(pair); add('overlap', g, g.pts[0].x, g.pts[0].z, `${r.toFixed(0)} m over street ${k}`);
    }
  }
  const counts = Object.fromEntries(SCHECKS.map((c) => [c, c === 'pieces' ? V.length : findings.filter((f) => f.check === c).length]));
  return { counts, findings, total: G.length };
}

export function streetAreas(ids = null) {
  const catalog = JSON.parse(read('routes/parks/index.json'));
  return catalog.filter((it) => (ids?.length ? ids.includes(it.id) : it.id.startsWith('pittsburgh')) && it.scene)
    .map((item) => ({ item, scene: loadSceneSync(item.scene) })).filter(({ scene }) => scene.cityData);
}

function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
  const near = Number(opt('--near', 150)), json = opt('--json', null), baseline = flag('--baseline');
  const out = {}, tot = Object.fromEntries(SCHECKS.map((c) => [c, 0]));
  for (const { item, scene } of streetAreas(args)) {
    const r = qcStreets({ item, scene, near });
    out[item.id] = { counts: r.counts, total: r.total, findings: r.findings };
    for (const c of SCHECKS) tot[c] += r.counts[c];
    console.log(`${item.id.padEnd(22)} ${SCHECKS.map((c) => `${c} ${r.counts[c]}`).join('  ')}   (${r.total} streets in the area)`);
  }
  console.log(`total: ${SCHECKS.map((c) => `${c} ${tot[c]}`).join('  ')}`);
  if (json) writeFileSync(json, JSON.stringify(out, null, 1));
  if (baseline) { writeFileSync(join(ROOT, STREETS_BASELINE), JSON.stringify(Object.fromEntries(Object.entries(out).map(([id, o]) => [id, o.counts])), null, 1) + '\n'); console.log(`Baseline: ${STREETS_BASELINE}`); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
