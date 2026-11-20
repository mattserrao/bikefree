#!/usr/bin/env node
// Map QC: the whole city street network, not just what lies along the routes (tools/qc_course.mjs checks the
// route and the streets within ~300 m of it). For every area of a city (Pittsburgh by default) it builds the
// streets as the renderer draws them (cityStreets) and checks:
//
// | check        | severity            | what it catches |
// | dead-end     | fail / warn / info  | a street that stops without meeting another street, away from the data's edge — a road
// |              |                     | to nowhere (fail: highway or link; warn: primary–tertiary; info: residential) |
// | stub         | warn                | a street piece < 25 m long that meets something at one end only |
// | deck-end     | fail                | a bridge deck that ends in the air (> 1.5 m over the ground) without meeting a street |
// | end-step     | fail / warn         | an end that meets another street (same layer) > 1.2 m above / below it: the ribbon stops
// |              |                     | in a slab edge or a wall (fail on decks, highways and links) |
// | near-miss    | warn                | a loose end 1.5–12 m from another street: a gap where two roads should join |
// | zig-zag      | fail / warn         | the line turns one way then straight back within 25 m (opposite turns > 15°): jagged
// |              |                     | (fail on highways and links, warn on primary–tertiary) |
// | kink         | warn                | a highway, link or primary turns > 35° at one point between pieces ≥ 8 m: a corner a real
// |              |                     | road of that class can't have |
// | facet        | warn                | a highway, link or primary curve drawn as straight pieces: a > 9° corner between pieces
// |              |                     | ≥ 14 m (a polygon where the road should curve) |
// | bump         | warn                | a highway–tertiary point > 0.45 m above / below the line through its neighbours: a hump,
// |              |                     | a dip, a sawtooth along the ribbon |
// | height-step  | warn                | a ground street climbs or drops > 40 % between two points ≥ 3 m apart |
// | overlap      | (summary)           | km of street ribbon drawn over other street ribbon (z-fighting), from junctions.js |
//
//   node tools/qc_map.mjs                       every area of Pittsburgh → tools/qc-map-report.html
//   node tools/qc_map.mjs pittsburgh-oakland    one area (catalog ids)
//   options: --json out.json   --html file   --strict (warnings fail too)   --near 300 (only within m of a route: off)
//   node tools/qc_map.mjs --baseline        write tools/qc-map-baseline.json: per area and check, the fails and warnings
//                                          within BASELINE_NEAR_M of a route — the budget test/qc-map.test.mjs holds the map to
// Exit code 1 on any fail (or warn with --strict).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { cityStreets, STREET_W } from '../js/world/toolbox/city/landscape.js';
import { streetOverlaps } from '../js/world/toolbox/city/junctions.js';
import { ROAD_WIDTH } from '../js/world/pose.js';
import { loadSceneSync } from './qc_course.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

export const MAP_LIMITS = {
  join: 1.5,          // m: an end this close to another street's line meets it
  nearMiss: 12,       // m: a loose end within this of another street: a gap
  edge: 120,          // m: ends this close to the data's bounding box are cut by the map's extent, not loose
  corridor: 650,      // m from the area's route: the street data is a corridor (tools/build_city.py keeps ways
                      // within streetRadiusM, 900 m): a way's continuation out there may simply not be in it
  stub: 25,           // m: a piece this short that meets something at one end only
  deckAir: 1.5,       // m: a deck end this far over the ground
  endStep: 1.2,       // m: an end that meets another street this far above or below it: a slab edge, a wall
  zigTurn: 15,        // °: opposite turns this big…
  zigSpan: 25,        // m: …within this distance
  zigShift: .75,      // m: and the line steps at least this far sideways (shorter jogs are noise in the data)
  kink: 35,           // °: one turn this sharp on a major road
  kinkSeg: 8,         // m: between pieces at least this long
  facet: 9,           // °: a highway, link or primary turns this much at one point between two pieces ≥ facetSeg:
  facetSeg: 14,       //    a curve drawn as a polygon — its corners show on a wide ribbon
  bump: .45,          // m: a point this far above / below the straight line through its neighbours (≤ 25 m away): a
                      //    hump or a dip in the ribbon (a sawtooth on a long road)
  step: .4,           // rise per metre on a ground street (Pittsburgh's steepest real street, Canton Ave, is 37 %)
  stepSeg: 3,         // m: pieces at least this long
};
// street classes (tools/build_city.py CLS)
export const CLASS = ['highway', 'link', 'primary', 'secondary', 'tertiary', 'residential', 'pedestrian', 'service', 'path'];
export const BASELINE_NEAR_M = 300;   // (the user's scope: what a rider sees near the routes)
export const BASELINE_FILE = 'tools/qc-map-baseline.json';
/** Per check: fails and warnings within BASELINE_NEAR_M of the area's route. */
export function nearCounts(r) {
  const out = {};
  for (const f of r.findings) if (f.severity !== 'info' && f.routeM != null && f.routeM <= BASELINE_NEAR_M) out[f.check] = (out[f.check] || 0) + 1;
  return out;
}
/** The Pittsburgh areas qc_map checks (catalog items with a city), with their scenes loaded. */
export function cityAreas(ids = null) {
  const catalog = JSON.parse(read('routes/parks/index.json'));
  return catalog.filter((it) => (ids?.length ? ids.includes(it.id) : it.id.startsWith('pittsburgh')) && it.scene).map((item) => {
    let scene = loadSceneSync(item.scene);
    if (!scene.cityData) return null;
    scene = { ...scene, city: JSON.parse(read(scene.cityData)) };
    return { id: item.id, name: item.name, gpxText: read(item.file), item, scene };
  }).filter(Boolean);
}
const sevByClass = (cls, fail, warn) => (cls <= fail ? 'fail' : cls <= warn ? 'warn' : 'info');

const turnDeg = (a, b, c) => ((((Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x)) * 180) / Math.PI + 540) % 360) - 180;
const len = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/** A grid of street segments for "the nearest other street to (x, z)". */
export function segGrid(streets, cell = 20) {
  const g = new Map(), key = (i, j) => i * 100003 + j;
  streets.forEach((st, k) => {
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / cell); gx <= Math.floor(Math.max(a.x, b.x) / cell); gx++)
        for (let gz = Math.floor(Math.min(a.z, b.z) / cell); gz <= Math.floor(Math.max(a.z, b.z) / cell); gz++) {
          const kk = key(gx, gz); let l = g.get(kk); if (!l) g.set(kk, (l = [])); l.push(k * 65536 + i);
        }
    }
  });
  /** Nearest point on another street within r: { k, d, x, z, y } (skip: street k itself); all: every street within r. */
  return (x, z, r, skip, all = null) => {
    let best = null;
    for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++) for (let gz = Math.floor((z - r) / cell); gz <= Math.floor((z + r) / cell); gz++) {
      for (const v of g.get(key(gx, gz)) || []) {
        const k = Math.floor(v / 65536), i = v % 65536;
        if (k === skip) continue;
        const st = streets[k], a = st.pts[i - 1], b = st.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
        if (d <= r) { const h = { k, d, x: px, z: pz, y: a.y + (b.y - a.y) * t }; all?.push(h); if (!best || d < best.d) best = h; }
      }
    }
    return best;
  };
}

/** Run the map checks on one area. → { id, name, streets, km, findings, overlaps, bounds, svg data } */
export function qcMap({ id, name, gpxText, item, scene, near = 0 }) {
  const route = buildCatalogRoute(gpxText, item); route.scene = scene;
  const o = scene.origin, proj = makeProjection(o.lat, o.lon), index = makeRouteIndex(route, proj);
  const L = landscapeBuilder(scene)(scene, proj, index, route);
  const streets = cityStreets(L, index, route);
  const M = MAP_LIMITS, F = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, km = 0;
  for (const st of streets) for (let i = 0; i < st.pts.length; i++) { const p = st.pts[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); if (i) km += len(st.pts[i - 1], p) / 1000; }
  const nearest = segGrid(streets);
  const toRoute = (p) => { const r = index.nearest(p.x, p.z, 5000); return r ? r.d : Infinity; };
  const atEdge = (p) => p.x - x0 < M.edge || x1 - p.x < M.edge || p.z - z0 < M.edge || z1 - p.z < M.edge || toRoute(p) > M.corridor;
  const add = (check, severity, p, value, note, k) => {
    const d = toRoute(p);
    if (near && d > near) return;
    F.push({ check, severity, x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +(p.y ?? 0).toFixed(1), value: +value.toFixed(2), note, cls: CLASS[streets[k]?.cls] || '?', street: k, routeM: Number.isFinite(d) ? Math.round(d) : null });
  };
  streets.forEach((st, k) => {
    const P = st.pts, cls = st.cls;
    if (P.length < 2) return;
    let L2 = 0; for (let i = 1; i < P.length; i++) L2 += len(P[i - 1], P[i]);
    const isPath = cls >= 6;
    // ends: does each meet another street?
    const ends = [P[0], P.at(-1)].map((p) => ({ p, hit: nearest(p.x, p.z, M.nearMiss, k) }));
    // (the route's own road is not in the street list: an end on its carriageway meets it)
    const onRoad = (p) => toRoute(p) <= ROAD_WIDTH / 2 + st.width / 2 + M.join;
    const met = ends.map((e) => (!!e.hit && e.hit.d <= M.join) || onRoad(e.p));
    ends.forEach((e, j) => {
      // an end that meets another street at a different height: the ribbon stops in a slab edge (decks, ramps)
      // (it may pass over or under one street and join another at its own height there: fine)
      if (met[j] && e.hit && e.hit.d <= M.join && !isPath && cls <= 5 && !onRoad(e.p)) {
        const hits = []; nearest(e.p.x, e.p.z, M.join, k, hits);
        const level = hits.some((h) => Math.abs(e.p.y - h.y) <= M.endStep);
        if (!level) {
          const h = hits.reduce((a, b) => (Math.abs(e.p.y - a.y) < Math.abs(e.p.y - b.y) ? a : b)), dy = e.p.y - h.y;
          add('end-step', st.bridge || cls <= 1 ? 'fail' : 'warn', e.p, dy, `a ${CLASS[cls]}${st.bridge ? ' deck' : ''} ends ${Math.abs(dy).toFixed(1)} m ${dy > 0 ? 'above' : 'below'} the ${CLASS[streets[h.k].cls]} it reaches: a slab edge or a wall`, k);
        }
      }
      if (met[j] || atEdge(e.p)) return;
      // a deck that stops in the air
      if (st.bridge) {
        const g = L.baseHeight ? L.baseHeight(e.p.x, e.p.z) : L.heightAt(e.p.x, e.p.z), air = e.p.y - g;
        if (air > M.deckAir && !L.isWater?.(e.p.x, e.p.z)) { add('deck-end', 'fail', e.p, air, `a ${CLASS[cls]} bridge deck ends ${air.toFixed(1)} m in the air`, k); return; }
      }
      if (e.hit && e.hit.d > M.join && !isPath) { add('near-miss', cls <= 5 ? 'warn' : 'info', e.p, e.hit.d, `a ${CLASS[cls]} stops ${e.hit.d.toFixed(1)} m short of a ${CLASS[streets[e.hit.k].cls]}`, k); return; }
      if (!isPath) add('dead-end', sevByClass(cls, 1, 4), e.p, L2, `a ${CLASS[cls]} (${Math.round(L2)} m) ends without meeting another street`, k);
    });
    if (!isPath && L2 < M.stub && met.filter(Boolean).length === 1 && !ends.some((e) => atEdge(e.p))) add('stub', 'warn', P[0], L2, `a ${Math.round(L2)} m ${CLASS[cls]} stub`, k);
    if (cls > 4) return;   // the line checks: highways to tertiary roads
    for (let i = 1; i < P.length - 2; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1], d = P[i + 2];
      const t1 = turnDeg(a, b, c), t2 = turnDeg(b, c, d);
      const shift = len(b, c) * Math.sin(Math.min(Math.abs(t1), Math.abs(t2)) * Math.PI / 180);
      if (t1 * t2 < 0 && Math.min(Math.abs(t1), Math.abs(t2)) > M.zigTurn && len(b, c) < M.zigSpan && shift > M.zigShift && b.jn == null && c.jn == null)
        add('zig-zag', sevByClass(cls, 1, 4), b, Math.min(Math.abs(t1), Math.abs(t2)), `a ${CLASS[cls]} zig-zags (${Math.round(t1)}° then ${Math.round(t2)}° within ${len(b, c).toFixed(0)} m: ${shift.toFixed(1)} m sideways)`, k);
    }
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1];
      if (cls <= 2 && len(a, b) >= M.kinkSeg && len(b, c) >= M.kinkSeg && b.jn == null) {
        const t = Math.abs(turnDeg(a, b, c));
        if (t > M.kink) add('kink', 'warn', b, t, `a ${CLASS[cls]} turns ${Math.round(t)}° at one point`, k);
        else if (t > M.facet && len(a, b) >= M.facetSeg && len(b, c) >= M.facetSeg) add('facet', 'warn', b, t, `a ${CLASS[cls]} curve drawn as straight pieces (${Math.round(t)}° corner between ${Math.round(len(a, b))} m and ${Math.round(len(b, c))} m pieces)`, k);
      }
      if (cls <= 4 && len(a, b) <= 25 && len(b, c) <= 25 && len(a, b) > 2 && len(b, c) > 2 && b.jn == null) {
        const f = len(a, b) / (len(a, b) + len(b, c)), mid = a.y + (c.y - a.y) * f, off = b.y - mid;
        if (Math.abs(off) > M.bump) add('bump', 'warn', b, off, `a ${CLASS[cls]} ${off > 0 ? 'humps' : 'dips'} ${Math.abs(off).toFixed(1)} m at one point`, k);
      }
      if (!st.bridge && len(a, b) >= M.stepSeg && Math.abs(b.y - a.y) / len(a, b) > M.step) add('height-step', 'warn', b, (b.y - a.y) / len(a, b) * 100, `a ${CLASS[cls]} ${b.y > a.y ? 'climbs' : 'drops'} ${Math.abs((b.y - a.y) / len(a, b) * 100).toFixed(0)} % between two points`, k);
    }
  });
  let overlaps = null;
  try { overlaps = streetOverlaps(streets, L._junctions || null, { routeDist: L.routeDist, roadWidth: ROAD_WIDTH }); } catch { /* (a city without junctions) */ }
  // de-duplicate: two ends of different streets reported at the same place → one finding
  const seen = new Set(), findings = F.filter((f) => { const k = `${f.check}|${Math.round(f.x / 3)}|${Math.round(f.z / 3)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const lines = streets.map((st) => ({ c: st.cls, b: st.bridge ? 1 : 0, p: st.pts.filter((_, i) => i === 0 || i === st.pts.length - 1 || i % 3 === 0).map((p) => [Math.round(p.x), Math.round(p.z)]) }));
  const routeLine = []; for (let i = 0; i < index.xs.length; i += 5) routeLine.push([Math.round(index.xs[i]), Math.round(index.zs[i])]);
  return { id, name, streets: streets.length, km: +km.toFixed(1), findings, overlaps, bounds: [x0, z0, x1, z1].map(Math.round), lines, routeLine };
}

const COLORS = ['#c0392b', '#e67e22', '#d4ac0d', '#7f8c8d', '#95a5a6', '#bdc3c7', '#cfd8dc', '#dfe6e9', '#e8ecee'];
function svgMap(r) {
  const [x0, z0, x1, z1] = r.bounds, W = 900, s = W / Math.max(1, x1 - x0), H = Math.round((z1 - z0) * s);
  const pt = ([x, z]) => `${((x - x0) * s).toFixed(1)},${((z - z0) * s).toFixed(1)}`;
  const lines = [...r.lines].sort((a, b) => b.c - a.c).map((l) => `<polyline points="${l.p.map(pt).join(' ')}" fill="none" stroke="${COLORS[l.c]}" stroke-width="${l.c <= 1 ? 2.2 : l.c <= 4 ? 1.4 : .7}"${l.b ? ' stroke-dasharray="3 2"' : ''}/>`).join('');
  const route = `<polyline points="${r.routeLine.map(pt).join(' ')}" fill="none" stroke="#2563eb" stroke-width="2.5" opacity=".55"/>`;
  const marks = r.findings.filter((f) => f.severity !== 'info').map((f, i) => `<circle cx="${((f.x - x0) * s).toFixed(1)}" cy="${((f.z - z0) * s).toFixed(1)}" r="5" fill="none" stroke="${f.severity === 'fail' ? '#d00' : '#e0a020'}" stroke-width="2"><title>#${i + 1} ${f.check}: ${f.note}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;background:#fafafa;border:1px solid #ddd">${lines}${route}${marks}</svg>`;
}

export function htmlReport(results) {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const count = (r, sev) => r.findings.filter((f) => f.severity === sev).length;
  const rows = results.map((r) => `<tr><td><a href="#${r.id}">${esc(r.name)}</a></td><td>${r.streets}</td><td>${r.km}</td><td class="f">${count(r, 'fail')}</td><td class="w">${count(r, 'warn')}</td><td>${count(r, 'info')}</td><td>${r.overlaps ? (r.overlaps.overlapM / 1000).toFixed(1) : '—'}</td></tr>`).join('');
  const sections = results.map((r) => {
    const byCheck = {}; for (const f of r.findings) (byCheck[f.check] ||= { fail: 0, warn: 0, info: 0 })[f.severity]++;
    const list = r.findings.filter((f) => f.severity !== 'info').sort((a, b) => (a.severity === 'fail' ? 0 : 1) - (b.severity === 'fail' ? 0 : 1) || (a.routeM ?? 1e9) - (b.routeM ?? 1e9));
    return `<h2 id="${r.id}">${esc(r.name)}</h2><p>${Object.entries(byCheck).map(([c, n]) => `<b>${c}</b> ${n.fail ? `<span class="f">${n.fail} fail</span> ` : ''}${n.warn ? `<span class="w">${n.warn} warn</span> ` : ''}${n.info ? `${n.info} info` : ''}`).join(' · ') || 'clean'}</p>${svgMap(r)}
      <table><tr><th>#</th><th>check</th><th>class</th><th>x, z</th><th>from a route</th><th>note</th></tr>${list.map((f, i) => `<tr class="${f.severity}"><td>${i + 1}</td><td>${f.check}</td><td>${f.cls}</td><td>${f.x}, ${f.z}</td><td>${f.routeM ?? '—'} m</td><td>${esc(f.note)}</td></tr>`).join('')}</table>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Map QC</title><style>body{font:14px system-ui;margin:20px;max-width:1000px}table{border-collapse:collapse;margin:8px 0 24px}td,th{padding:3px 8px;border-bottom:1px solid #eee;text-align:left;font-size:12.5px}.f,.fail td:nth-child(2){color:#c00}.w,.warn td:nth-child(2){color:#b07800}</style>
  <h1>Map QC</h1><p>Every street of every area as the renderer draws it. Map: streets by class (red highways, orange links, yellow primary), dashed = bridges, blue = the area's route; circles = fails (red) and warnings (amber).</p>
  <table><tr><th>area</th><th>streets</th><th>km</th><th>fail</th><th>warn</th><th>info</th><th>km of ribbon over ribbon</th></tr>${rows}</table>${sections}`;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const json = opt('--json', null), html = opt('--html', 'tools/qc-map-report.html'), near = Number(opt('--near', '0')), strict = flag('--strict'), baseline = flag('--baseline');
  const results = [];
  for (const area of cityAreas(args)) {
    const t0 = Date.now(), item = area.item;
    const r = qcMap({ ...area, near });
    results.push(r);
    const c = (s) => r.findings.filter((f) => f.severity === s).length;
    const by = {}; for (const f of r.findings) if (f.severity !== 'info') by[f.check] = (by[f.check] || 0) + 1;
    console.log(`${c('fail') ? 'FAIL' : c('warn') ? 'warn' : 'ok  '} ${item.name.padEnd(44).slice(0, 44)} ${String(r.streets).padStart(5)} streets ${String(r.km).padStart(6)} km  ${c('fail')} fail ${c('warn')} warn ${c('info')} info  ${JSON.stringify(by)}${r.overlaps ? `  overlap ${(r.overlaps.overlapM / 1000).toFixed(1)} km` : ''}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  writeFileSync(isAbsolute(html) ? html : join(ROOT, html), htmlReport(results));
  if (baseline) { writeFileSync(join(ROOT, BASELINE_FILE), `${JSON.stringify(Object.fromEntries(results.map((r) => [r.id, nearCounts(r)])), null, 1)}\n`); console.log(`Baseline: ${BASELINE_FILE}`); }
  if (json) writeFileSync(json, JSON.stringify(results.map(({ lines, routeLine, ...r }) => r), null, 1));
  console.log(`Report: ${html}`);
  const bad = results.some((r) => r.findings.some((f) => f.severity === 'fail' || (strict && f.severity === 'warn')));
  process.exit(bad ? 1 : 0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
