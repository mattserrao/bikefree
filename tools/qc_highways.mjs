#!/usr/bin/env node
// Highway continuity (PLAN: Pittsburgh audit, highways): "can a car drive on it?" — the highways the city keeps
// (tools/city/pittsburgh-highways-keep.json; every ramp dropped), as the renderer draws them, over every area at once
// (an area's data stops at its corridor: the next area carries the road on).
//
// | check    | severity | what it catches |
// | gap      | fail     | a highway carriageway ends without meeting another highway piece — not at the map's outer edge, not
// |          |          | at a hillside (a tunnel portal, later), not where a route rides it |
// | jump     | fail     | two highway pieces meet (≤ 2 m apart in plan) at heights > 0.5 m apart: a step a car can't drive |
// | step     | fail     | inside a piece, the road rises or falls > 0.5 m between two points < 5 m apart (a ledge) |
// | grade    | warn     | a stretch ≥ 20 m steeper than 8 % (no real highway here is) |
// | air-end  | fail     | a highway end > 1.5 m over the ground, meeting nothing: a slab end |
//
//   node tools/qc_highways.mjs [--json out.json] [--html file]    → tools/qc-highways-report.html (map + list)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { cityStreets } from '../js/world/toolbox/city/landscape.js';
import { cityAreas } from './qc_map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HW_LIMITS = { join: 2, jump: .5, step: .5, stepSeg: 5, grade: .08, gradeLen: 20, air: 1.5, edge: 150, hill: 6 };

export function qcHighways(areas = cityAreas()) {
  const M = HW_LIMITS, pieces = [], ground = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const routes = [];
  for (const a of areas) {
    const route = buildCatalogRoute(a.gpxText, a.item); route.scene = a.scene;
    const proj = makeProjection(a.scene.origin.lat, a.scene.origin.lon), index = makeRouteIndex(route, proj);
    const L = landscapeBuilder(a.scene)(a.scene, proj, index, route);
    const S = cityStreets(L, index, route);
    for (const st of S) {
      for (const p of st.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      if (st.cls !== 0 || st.pts.length < 2) continue;
      pieces.push({ area: a.id, bridge: st.bridge, pts: st.pts.map((p) => ({ x: p.x, z: p.z, y: p.y })), L });
    }
    routes.push(index);
    ground.push(L);
  }
  // all highway segments on a grid
  const C = 10, grid = new Map(), ck = (i, j) => i * 100003 + j;
  pieces.forEach((P, k) => { for (let i = 1; i < P.pts.length; i++) { const a = P.pts[i - 1], b = P.pts[i];
    for (let gx = Math.floor(Math.min(a.x, b.x) / C); gx <= Math.floor(Math.max(a.x, b.x) / C); gx++) for (let gz = Math.floor(Math.min(a.z, b.z) / C); gz <= Math.floor(Math.max(a.z, b.z) / C); gz++) { const kk = ck(gx, gz); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([k, i]); } } });
  const near = (x, z, r, skipArea, skipK) => {
    const out = [];
    for (let gx = Math.floor((x - r) / C); gx <= Math.floor((x + r) / C); gx++) for (let gz = Math.floor((z - r) / C); gz <= Math.floor((z + r) / C); gz++) for (const [k, i] of grid.get(ck(gx, gz)) || []) {
      if (k === skipK) continue;
      const P = pieces[k], a = P.pts[i - 1], b = P.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d <= r) out.push({ k, d, y: a.y + (b.y - a.y) * t, same: P.area === skipArea });
    }
    return out;
  };
  const onRoute = (x, z, r) => routes.some((ix) => { const q = ix.nearest(x, z, r); return q && q.d <= r; });
  const F = [];
  const add = (check, severity, p, value, note, area) => F.push({ check, severity, x: Math.round(p.x), z: Math.round(p.z), value: +value.toFixed(2), note, area });
  pieces.forEach((P, k) => {
    const pts = P.pts;
    for (const [e, nb] of [[pts[0], pts[1]], [pts.at(-1), pts.at(-2)]]) {
      const hits = near(e.x, e.z, M.join, null, k);
      if (hits.length) {
        // pieces meeting here: a level join? (any piece within 0.5 m of this end's height)
        if (!hits.some((h) => Math.abs(h.y - e.y) <= M.jump)) { const h = hits.reduce((a, b) => (Math.abs(a.y - e.y) < Math.abs(b.y - e.y) ? a : b)); add('jump', 'fail', e, e.y - h.y, `highway pieces meet ${Math.abs(e.y - h.y).toFixed(1)} m apart in height`, P.area); }
        continue;
      }
      if (e.x - x0 < M.edge || x1 - e.x < M.edge || e.z - z0 < M.edge || z1 - e.z < M.edge) continue;   // the map's outer edge
      if (onRoute(e.x, e.z, 12)) continue;   // (a route rides on from here)
      // a hillside ahead: a tunnel (portals later)
      const l = Math.hypot(e.x - nb.x, e.z - nb.z) || 1, ux = (e.x - nb.x) / l, uz = (e.z - nb.z) / l;
      const ahead = Math.max(...[15, 30, 50, 80].map((d) => P.L.baseHeight ? P.L.baseHeight(e.x + ux * d, e.z + uz * d) : P.L.heightAt(e.x + ux * d, e.z + uz * d)));
      if (ahead - e.y > M.hill) { add('tunnel', 'info', e, ahead - e.y, 'ends at a hillside: a tunnel portal (later)', P.area); continue; }
      const g = P.L.heightAt(e.x, e.z);
      if (e.y - g > M.air) add('air-end', 'fail', e, e.y - g, `a highway ends ${(e.y - g).toFixed(1)} m in the air`, P.area);
      else add('gap', 'fail', e, 0, 'a highway ends without meeting another highway piece', P.area);
    }
    let run = 0, runFrom = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z), dy = b.y - a.y;
      if (l < M.stepSeg && Math.abs(dy) > M.step) add('step', 'fail', b, dy, `the road steps ${Math.abs(dy).toFixed(1)} m in ${l.toFixed(1)} m`, P.area);
      if (l >= 1 && Math.abs(dy) / l > M.grade) { run += l; runFrom ||= b; if (run >= M.gradeLen) { add('grade', 'warn', runFrom, Math.abs(dy) / l * 100, `steeper than ${M.grade * 100} % for ${Math.round(run)} m`, P.area); run = -1e9; } }
      else { run = 0; runFrom = null; }
    }
  });
  const seen = new Set(), findings = F.filter((f) => { const key = `${f.check}|${Math.round(f.x / 4)}|${Math.round(f.z / 4)}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const km = pieces.reduce((s, P) => s + P.pts.reduce((a, q, i) => (i ? a + Math.hypot(q.x - P.pts[i - 1].x, q.z - P.pts[i - 1].z) : 0), 0), 0) / 1000;
  return { pieces: pieces.length, km: +km.toFixed(1), findings, lines: pieces.map((P) => P.pts.map((p) => [Math.round(p.x), Math.round(p.z)])), bounds: [x0, z0, x1, z1] };
}

function html(r) {
  const [x0, z0, x1, z1] = r.bounds, W = 1400, s = W / (x1 - x0), H = Math.round((z1 - z0) * s);
  const pt = ([x, z]) => `${((x - x0) * s).toFixed(1)},${((z - z0) * s).toFixed(1)}`;
  const lines = r.lines.map((l) => `<polyline points="${l.map(pt).join(' ')}" fill="none" stroke="#1e8449" stroke-width="2"/>`).join('');
  const col = { fail: '#d00', warn: '#e0a020', info: '#888' };
  const marks = r.findings.map((f, i) => `<circle cx="${((f.x - x0) * s).toFixed(1)}" cy="${((f.z - z0) * s).toFixed(1)}" r="6" fill="none" stroke="${col[f.severity]}" stroke-width="2"><title>#${i + 1} ${f.check}: ${f.note} (${f.area}, ${f.x}, ${f.z})</title></circle>`).join('');
  const by = {}; for (const f of r.findings) by[`${f.check} (${f.severity})`] = (by[`${f.check} (${f.severity})`] || 0) + 1;
  return `<!doctype html><meta charset="utf-8"><title>Highway continuity</title><style>body{font:14px system-ui;margin:20px}td{padding:2px 8px;font-size:12.5px;border-bottom:1px solid #eee}</style><h1>Highway continuity</h1><p>${r.km} km of highway ribbon in ${r.pieces} pieces (all areas). ${Object.entries(by).map(([k, n]) => `${k}: ${n}`).join(' · ')}</p><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;border:1px solid #ddd;background:#fafafa">${lines}${marks}</svg><table>${r.findings.map((f, i) => `<tr><td>${i + 1}</td><td>${f.severity}</td><td>${f.check}</td><td>${f.area}</td><td>${f.x}, ${f.z}</td><td>${f.note}</td></tr>`).join('')}</table>`;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = opt('--json', null), out = opt('--html', 'tools/qc-highways-report.html');
  const r = qcHighways();
  const by = {}; for (const f of r.findings) by[`${f.check}:${f.severity}`] = (by[`${f.check}:${f.severity}`] || 0) + 1;
  console.log(`${r.km} km of highway ribbon, ${r.pieces} pieces · ${JSON.stringify(by)}`);
  writeFileSync(isAbsolute(out) ? out : join(ROOT, out), html(r));
  if (json) writeFileSync(json, JSON.stringify({ ...r, lines: undefined }, null, 1));
  console.log(`Report: ${out}`);
  process.exit(r.findings.some((f) => f.severity === 'fail') ? 1 : 0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
