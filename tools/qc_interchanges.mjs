#!/usr/bin/env node
// Interchange QC: the grade-separated mess — ramps and highways drawn in the air, dirt cliffs between them, ribbons
// stacked over each other — found where it is drawn, across every area of a city (Pittsburgh by default).
//
// What it looks like (the Parkway interchange by the Three Rivers Loop, PLAN: Pittsburgh audit, E): on-ramps that
// OSM maps on embankments (not bridges) are drawn as flat ribbons up to 7 m over a ground the street grading pulled
// down to the lowest street nearby, so they read as floating slabs with dark sides; the ground between two levels
// drops in a vertical, scalloped dirt wall (the 6 m ground mesh stepping between grading zones); ramps and the
// carriageways they merge into are drawn full width over each other. Ground is the drawn ground (the 6 m patch mesh
// with its street drape, as tools/qc_course.mjs models it), streets are cityStreets as the renderer draws them.
//
// | check     | severity     | what it catches |
// | floating  | fail / warn  | a ground street (not a bridge deck) whose edge is > 3 m (fail) / > 1 m (warn) over the drawn ground:
// |           |              | a slab in the air — it needs an embankment (ground raised to it) or to be a deck. Read 1.5 m past
// |           |              | the carriageway, or past the sidewalk for streets drawn with one (warn > 1.5 m there: the 6 m mesh
// |           |              | falls that much off a ridge or shelf street). A hillside street (the other side's ground within
// |           |              | .3 m of it or above) warns only > 2.5 m, fails > 5 m: the slope falling away is normal |
// | buried    | warn         | the drawn ground > 0.6 m over a street's edge (not in a junction): the street sits in a trench lip |
// | bank-wall | fail / warn  | the ground just beyond a street's edge changes > 5 m (fail) / > 3 m (warn) within 6 m: a dirt cliff |
// | scallop   | warn         | along a street, the ground beside it saws up and down (> 0.75 m, three turns within 18 m) |
// | stacked   | warn         | two ribbons (decks too) overlap in plan with only 0.3–4.5 m between them: slab over slab, no
// |           |              | clearance under the upper one, its edge showing |
// | parallel  | warn         | two highway–tertiary ribbons (not the same street) side by side, ≤ 15° apart, edges < 6 m apart for
// |           |              | ≥ 40 m: a divided road drawn as two, or a ramp hugging its carriageway — a merge / thin-out candidate |
// | clutter   | warn         | a 50 m square more than 45 % paved with ≥ 5 different ribbons in it: too many roads drawn in one place |
//
// Scope (the user's): within --near m of the area's route, and at interchanges anywhere (within 150 m of a link road).
//
// Findings are grouped into sites (within 120 m of each other) and ranked by score (fail 5, warn 1), so a fixer can
// work site by site; each site comes with a snap_cam shot (an oblique look from 70 m out, 40 m up) to render before
// and after: `node tools/snap_cam.mjs <area> --shots <the site's shots.json>`.
//
// Speed: ~2 min for all ten areas (~17 s for the core; was ~5½ min): the route distance is asked within the scope's
// radius (index.nearest's cost grows with its radius squared) and cached per 5 m; the drawn ground is built only for the
// 96 m patches a scoped sample touches.
//
//   node tools/qc_interchanges.mjs                    every Pittsburgh area → tools/qc-interchanges-report.html
//   node tools/qc_interchanges.mjs pittsburgh         one area (catalog ids)
//   options: --near 300 (m from the area's route; 0 = everywhere)  --classes 4 (highway…tertiary)  --json out.json
//            --shots dir (one shots.json per area: the top sites)  --top 20  --baseline (writes tools/qc-interchanges-baseline.json)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { cityStreets } from '../js/world/toolbox/city/landscape.js';
import { makeMeshGround } from './qc_course.mjs';
import { cityAreas, segGrid, CLASS } from './qc_map.mjs';

const SIDEWALK = (cls) => cls >= 2 && cls <= 6;   // (js/world/toolbox/city/landscape.js SIDEWALK_CLS)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const IX_LIMITS = {
  edgeOut: 1.5,      // m beyond the carriageway where the ground is read (sidewalks and verges sit within it)
  sidewalk: 2.5,     // m: streets of SIDEWALK classes are drawn with sidewalks this wide: the ground is read beyond them
  floatWarn: 1, floatFail: 3,
  floatWarnWalk: 1.5, // streets with sidewalks (read beyond them): the 6 m ground mesh falls ~1–1.5 m off a sidewalk on a ridge or a shelf
  hillLevel: .3, hillWarn: 2.5, hillFail: 5,   // a hillside street (the other side's ground within .3 m of it or above): a drop to this side is the slope
  buried: .6,
  wallSpan: 6, wallWarn: 3, wallFail: 5,   // m of ground change within wallSpan m beyond the edge
  scallop: .75, scallopSpan: 18,
  stackMin: .3, stackMax: 4.5,
  step: 5,           // m between samples along a street
  site: 120,         // m: findings this close form one site
  parAngle: 15, parGap: 6, parLen: 40,   // parallel: ≤ 15° apart, edges < 6 m apart, for ≥ 40 m
  clutCell: 50, clutPaved: .45, clutRibbons: 5,
  ixReach: 150,      // m from a link road: an interchange (in scope wherever it is)
};
export const IX_BASELINE = 'tools/qc-interchanges-baseline.json';

/** Run the checks on one area. → { id, name, findings, sites, shots, counts } */
export function qcInterchanges({ id, name, gpxText, item, scene, near = 300, classes = 4 }) {
  const route = buildCatalogRoute(gpxText, item); route.scene = scene;
  const proj = makeProjection(scene.origin.lat, scene.origin.lon), index = makeRouteIndex(route, proj);
  const L = landscapeBuilder(scene)(scene, proj, index, route);
  const streets = cityStreets(L, index, route);
  const G = makeMeshGround(L.heightAt, scene.groundMesh?.fineCells, scene.groundMesh?.fineCells ? L.fineGroundAt : null, L);
  const others = segGrid(streets);
  const M = IX_LIMITS, F = [];
  // (index.nearest's cost grows with the square of its radius: ask within what is needed, widening only when nothing is found)
  const within = (x, z, r) => { const q = index.nearest(x, z, r); return q && q.d <= r ? q.d : Infinity; };
  const toRoute = (x, z) => { for (const r of [near || 300, 1200, 5000]) { const d = within(x, z, r); if (d < Infinity) return d; } return Infinity; };
  // interchanges: 50 m cells within ixReach of a link road's point
  const ixCells = new Set(), C = 50, ck = (x, z) => Math.floor(x / C) * 100003 + Math.floor(z / C), R = Math.ceil(M.ixReach / C);
  for (const st of streets) if (st.cls === 1) for (const p of st.pts) for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) ixCells.add((Math.floor(p.x / C) + a) * 100003 + Math.floor(p.z / C) + b);
  const scopeCache = new Map();   // (per 5 m cell)
  const inScope = (x, z) => {
    if (!near || ixCells.has(ck(x, z))) return true;
    const key = Math.floor(x / 5) * 100003 + Math.floor(z / 5);
    let v = scopeCache.get(key); if (v === undefined) scopeCache.set(key, (v = within(x, z, near) <= near)); return v;
  };
  const add = (check, severity, x, z, value, note, k) => F.push({ check, severity, x: +x.toFixed(1), z: +z.toFixed(1), value: +value.toFixed(2), note, cls: CLASS[streets[k].cls], street: k, routeM: Math.round(toRoute(x, z)) });
  streets.forEach((st, k) => {
    if (st.cls > classes || st.pts.length < 2) return;
    const P = st.pts, e = st.width / 2 + M.edgeOut, eF = e + (SIDEWALK(st.cls) ? M.sidewalk : 0);   // (floating: read beyond the sidewalk, which covers the ground under it)
    const side = [[], []];   // the ground beside the street every step m, each side: [s, height above/below the ribbon, x, z]
    let s = 0, next = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < .01) continue;
      const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
      while (next <= s + l) {
        const t = (next - s) / l, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
        const inJn = (t < .5 ? a : b).jn != null;
        if (!inScope(x, z)) { next += M.step; continue; }
        const onRoute = within(x, z, st.width / 2 + 6) < Infinity;   // (beside the route's own road its bank rules: qc_course checks it)
        // both sides first: a street on a hillside has one side at or above it (the bank) and one below — normal; a slab
        // in the air (an embankment ramp drawn flat) has the ground below it on both sides
        const at = [1, -1].map((sg) => {
          const ex = x + nx * e * sg, ez = z + nz * e * sg, g = G(ex, ez), gf = eF > e ? G(x + nx * eF * sg, z + nz * eF * sg) : g;
          return { sg, ex, ez, g, gf, cover: others(ex, ez, 1, k) };
        });
        for (const [j, { sg, ex, ez, g, gf, cover }] of at.entries()) {
          const far = G(x + nx * (e + M.wallSpan) * sg, z + nz * (e + M.wallSpan) * sg);
          // something else drawn there (another street, a deck) carries the edge: not ground's job
          side[j].push([next, g - y, ex, ez, cover]);
          if (inJn || onRoute || cover) continue;
          if (!st.bridge) {
            const over = y - gf, o = at[1 - j], hill = !o.cover && y - o.gf <= M.hillLevel;
            const warn = hill ? M.hillWarn : eF > e ? M.floatWarnWalk : M.floatWarn, fail = hill ? M.hillFail : M.floatFail;
            if (over > warn) add('floating', over > fail ? 'fail' : 'warn', ex, ez, over, `a ${CLASS[st.cls]} edge ${over.toFixed(1)} m over the ground${hill ? ' (a hillside street: the bank above it on the other side)' : ' on both sides'}: a slab in the air (needs an embankment, or to be a deck)`, k);
            else if (g - y > M.buried) add('buried', 'warn', ex, ez, g - y, `the ground ${(g - y).toFixed(1)} m over a ${CLASS[st.cls]}'s edge`, k);
          }
          const wall = Math.abs(far - g);
          if (wall > M.wallWarn) add('bank-wall', wall > M.wallFail ? 'fail' : 'warn', ex, ez, wall, `the ground beside a ${CLASS[st.cls]} ${far > g ? 'rises' : 'drops'} ${wall.toFixed(1)} m within ${M.wallSpan} m: a dirt cliff`, k);
        }
        next += M.step;
      }
      s += l;
    }
    // scallops: the ground beside the street saws up and down
    for (const list of side) {
      const n = Math.round(M.scallopSpan / M.step);
      for (let i = 1; i + n < list.length; i++) {
        let turns = 0, amp = 0;
        for (let q = i; q < i + n; q++) {
          const d1 = list[q][1] - list[q - 1][1], d2 = list[q + 1][1] - list[q][1];
          if (d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) > M.scallop) { turns++; amp = Math.max(amp, Math.abs(d1), Math.abs(d2)); }
        }
        if (turns >= 3 && !list[i][4]) { add('scallop', 'warn', list[i][2], list[i][3], amp, `the ground beside a ${CLASS[st.cls]} saws up and down (${amp.toFixed(1)} m, ${turns} turns in ${M.scallopSpan} m)`, k); i += n; }
      }
    }
    // stacked: another ribbon over or under this one, too close
    for (let i = 0; i < P.length; i += 2) {
      const p = P[i];
      if (p.jn != null || !inScope(p.x, p.z)) continue;
      const hits = []; others(p.x, p.z, st.width / 2, k, hits);
      for (const h of hits) {
        const o = streets[h.k], dy = Math.abs(h.y - p.y);
        if (o.cls > classes || h.k < k) continue;   // (each pair once)
        if (dy > M.stackMin && dy < M.stackMax) { add('stacked', 'warn', p.x, p.z, dy, `a ${CLASS[st.cls]} and a ${CLASS[o.cls]} drawn over each other ${dy.toFixed(1)} m apart`, k); break; }
      }
    }
  });
  // parallel ribbons: walk each major street every 5 m; another major street beside it, heading alike, edges close
  const par = new Map();   // "k|o" → run length (m)
  streets.forEach((st, k) => {
    if (st.cls > classes || st.bridge || st.pts.length < 2) return;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < 1) continue;
      const hx = (b.x - a.x) / l, hz = (b.z - a.z) / l;
      for (let t = 0; t < l; t += M.step) {
        const x = a.x + hx * t, z = a.z + hz * t;
        if (!inScope(x, z) || a.jn != null) continue;
        const hits = []; others(x, z, st.width / 2 + 7.5 + M.parGap, k, hits);
        for (const h of hits) {
          const o = streets[h.k];
          if (o.cls > classes || o.bridge || h.k < k || Math.abs(h.y - (a.y + (b.y - a.y) * t / l)) > 4.5) continue;
          if (h.d - st.width / 2 - o.width / 2 > M.parGap || h.d < (st.width + o.width) / 4) continue;   // (not crossing / overlapping: that is `stacked` or a junction)
          // the other street's heading there
          const q = o.pts, j = q.reduce((bi, p, ii) => (Math.hypot(p.x - h.x, p.z - h.z) < Math.hypot(q[bi].x - h.x, q[bi].z - h.z) ? ii : bi), 0), j2 = Math.min(q.length - 1, j + 1), j1 = j2 - 1;
          const ox = q[j2].x - q[j1].x, oz = q[j2].z - q[j1].z, ol = Math.hypot(ox, oz) || 1, cos = Math.abs((hx * ox + hz * oz) / ol);
          if (cos < Math.cos(M.parAngle * Math.PI / 180)) continue;
          const key = `${k}|${h.k}`, run = par.get(key) || { len: 0, x, z };
          run.len += M.step; par.set(key, run);
        }
      }
    }
  });
  for (const [key, run] of par) if (run.len >= M.parLen) { const [k, o] = key.split('|').map(Number); add('parallel', 'warn', run.x, run.z, run.len, `a ${CLASS[streets[k].cls]} and a ${CLASS[streets[o].cls]} drawn side by side for ${run.len} m (merge or thin out)`, k); }
  // clutter: paved share and number of ribbons per 50 m square
  const cells = new Map(), cs = M.clutCell;
  streets.forEach((st, k) => {
    if (st.cls > 7) return;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t < l; t += 2) {
        const x = a.x + (b.x - a.x) * t / l, z = a.z + (b.z - a.z) * t / l, key = Math.floor(x / cs) * 100003 + Math.floor(z / cs);
        let c = cells.get(key); if (!c) cells.set(key, (c = { area: 0, set: new Set(), x: (Math.floor(x / cs) + .5) * cs, z: (Math.floor(z / cs) + .5) * cs }));
        c.area += 2 * st.width; c.set.add(k);
      }
    }
  });
  for (const c of cells.values()) {
    const paved = c.area / (cs * cs);
    if (paved > M.clutPaved && c.set.size >= M.clutRibbons && inScope(c.x, c.z)) add('clutter', 'warn', c.x, c.z, paved, `${Math.round(Math.min(1, paved) * 100)} % paved by ${c.set.size} ribbons in a ${cs} m square`, [...c.set][0]);
  }
  // thin out: one finding per check per 10 m
  const seen = new Set(), findings = F.filter((f) => { const key = `${f.check}|${Math.round(f.x / 10)}|${Math.round(f.z / 10)}`; if (seen.has(key)) return false; seen.add(key); return true; });
  // sites: findings within IX_LIMITS.site of each other (single link), ranked by score
  const sites = [], cell = M.site, grid = new Map();
  for (const f of findings) {
    const gx = Math.floor(f.x / cell), gz = Math.floor(f.z / cell);
    let site = null;
    for (let a = -1; a <= 1 && !site; a++) for (let b = -1; b <= 1 && !site; b++) for (const sIdx of grid.get(`${gx + a},${gz + b}`) || []) { const S = sites[sIdx]; if (Math.hypot(S.cx - f.x, S.cz - f.z) < cell) { site = S; break; } }
    if (!site) { site = { n: sites.length, list: [], cx: f.x, cz: f.z }; sites.push(site); const k = `${gx},${gz}`; grid.set(k, [...(grid.get(k) || []), site.n]); }
    site.list.push(f);
    site.cx += (f.x - site.cx) / site.list.length; site.cz += (f.z - site.cz) / site.list.length;
  }
  for (const S of sites) {
    S.score = S.list.reduce((a, f) => a + (f.severity === 'fail' ? 5 : 1), 0);
    S.counts = {}; for (const f of S.list) S.counts[f.check] = (S.counts[f.check] || 0) + 1;
    S.routeM = Math.min(...S.list.map((f) => f.routeM));
    S.classes = [...new Set(S.list.map((f) => f.cls))];
    const ll = proj.toLatLon(S.cx, S.cz), cam = proj.toLatLon(S.cx + 50, S.cz + 50);
    S.shot = { name: `${id}-site${S.n}`, cam: [cam.lat, cam.lon, null], camUp: 40, look: [ll.lat, ll.lon, null] };
    S.cx = Math.round(S.cx); S.cz = Math.round(S.cz);
  }
  sites.sort((a, b) => b.score - a.score);
  const counts = {}; for (const f of findings) { const c = (counts[f.check] ||= { fail: 0, warn: 0 }); c[f.severity]++; }
  return { id, name, findings, sites, counts };
}

function htmlReport(results, top) {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = results.map((r) => `<tr><td><a href="#${r.id}">${esc(r.name)}</a></td>${['floating', 'bank-wall', 'scallop', 'stacked', 'parallel', 'clutter', 'buried'].map((c) => `<td>${r.counts[c] ? `<span class="f">${r.counts[c].fail || ''}</span>${r.counts[c].fail ? ' / ' : ''}${r.counts[c].warn}` : '—'}</td>`).join('')}<td>${r.sites.length}</td></tr>`).join('');
  const secs = results.map((r) => `<h2 id="${r.id}">${esc(r.name)}</h2><table><tr><th>site</th><th>score</th><th>x, z</th><th>from route</th><th>classes</th><th>findings</th></tr>${r.sites.slice(0, top).map((S) => `<tr><td>${S.shot.name}</td><td>${S.score}</td><td>${S.cx}, ${S.cz}</td><td>${S.routeM} m</td><td>${S.classes.join(', ')}</td><td>${Object.entries(S.counts).map(([c, n]) => `${c} ${n}`).join(' · ')}</td></tr>`).join('')}</table>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Interchange QC</title><style>body{font:14px system-ui;margin:20px;max-width:1100px}table{border-collapse:collapse;margin:8px 0 22px}td,th{padding:3px 8px;border-bottom:1px solid #eee;text-align:left;font-size:12.5px}.f{color:#c00}</style>
  <h1>Interchange QC</h1><p>Ramps and highways in the air, dirt cliffs, scalloped banks, ribbons stacked over each other — by area (fail / warn), then each area's worst sites (render one: <code>node tools/snap_cam.mjs &lt;area&gt; --shots &lt;dir&gt;/&lt;area&gt;.json</code>).</p>
  <table><tr><th>area</th><th>floating</th><th>bank-wall</th><th>scallop</th><th>stacked</th><th>parallel</th><th>clutter</th><th>buried</th><th>sites</th></tr>${rows}</table>${secs}`;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const near = Number(opt('--near', '300')), classes = Number(opt('--classes', '4')), top = Number(opt('--top', '20'));
  const json = opt('--json', null), shots = opt('--shots', null), html = opt('--html', 'tools/qc-interchanges-report.html'), baseline = flag('--baseline');
  const results = [];
  for (const area of cityAreas(args)) {
    const t0 = Date.now();
    const r = qcInterchanges({ ...area, near, classes });
    results.push(r);
    const c = (sev) => r.findings.filter((f) => f.severity === sev).length;
    console.log(`${c('fail') ? 'FAIL' : c('warn') ? 'warn' : 'ok  '} ${r.name.padEnd(44).slice(0, 44)} ${c('fail')} fail ${c('warn')} warn  ${JSON.stringify(Object.fromEntries(Object.entries(r.counts).map(([k, v]) => [k, v.fail + v.warn])))}  ${r.sites.length} sites, worst ${r.sites[0] ? `${r.sites[0].shot.name} (${r.sites[0].cx}, ${r.sites[0].cz}) score ${r.sites[0].score}` : '—'}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  writeFileSync(isAbsolute(html) ? html : join(ROOT, html), htmlReport(results, top));
  if (shots) { mkdirSync(shots, { recursive: true }); for (const r of results) writeFileSync(join(shots, `${r.id}.json`), JSON.stringify(r.sites.slice(0, top).map((S) => S.shot), null, 1)); }
  if (json) writeFileSync(json, JSON.stringify(results.map((r) => ({ ...r, sites: r.sites.map(({ list, ...S }) => S) })), null, 1));
  if (baseline) writeFileSync(join(ROOT, IX_BASELINE), `${JSON.stringify(Object.fromEntries(results.map((r) => [r.id, Object.fromEntries(Object.entries(r.counts).map(([k, v]) => [k, v.fail + v.warn]))])), null, 1)}\n`);
  console.log(`Report: ${html}`);
  process.exit(results.some((r) => r.findings.some((f) => f.severity === 'fail')) ? 1 : 0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
