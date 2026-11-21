// Map the Pittsburgh network's routes (the presets of routes/cities/pittsburgh-network.json) onto PGH's graph.
//
//   node tools/map_pgh_routes.mjs [--write]      (--write: the mapped routes go into routes/cities/pgh.json as "presets")
//
// Only the route itself is taken (its line), not its scenery. Each route's lap is laid out from the old network, then
// matched onto PGH without adding roads: walking along the route, every PGH junction within SNAP_M of it is a waypoint,
// and consecutive waypoints are joined by PGH's shortest way. Where the route used a road PGH no longer has, that
// shortest way is a detour; it is reported (where, how much longer). A route keeps its plan as PGH traversal keys and
// its waypoints (junction positions), so it can be matched again after a rebuild.
// Writes tools/.cache/pgh-routes.json (every route: its old line, its PGH line, the detours) for the review map.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogRoute } from '../js/routes.js';
import { loadNetwork, makePathRoute } from '../js/network.js';
import { decodeGraph } from '../js/graph.js';
import { haversine } from '../js/gpx.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const SNAP_M = 22;        // a PGH junction this close to the route is on it
const NEAR_M = 25;        // a route point this close to the mapped line counts as followed
const DETOUR_MIN = 1.25;  // a stretch of the mapped line this much longer than the route between its waypoints is a detour

// ---- the old routes
const parks = JSON.parse(read('routes/parks/index.json'));
const netJson = JSON.parse(read('routes/cities/pittsburgh-network.json'));
const bases = new Map();
for (const a of netJson.areas) {
  const it = parks.find((p) => p.id === a.catalogId);
  const r = buildCatalogRoute(read(it.file), { ...it, routeId: it.id });
  bases.set(a.id, r);
}
const net = loadNetwork(netJson, bases);

// --lines: just the old routes' lines (every 20 m), the build's input (tools/city/pgh-route-lines.json): ways the routes
// ride are kept through the cleanup (tools/build_pgh.py), so the routes map without detours
if (process.argv.includes('--lines')) {
  const lines = net.presets.map((preset) => {
    const route = makePathRoute(net, preset, { id: preset.id, name: preset.name });
    const n = Math.min(route.lat.length - 1, Math.round((route.lapM || preset.lengthM) / 10));
    const pts = [];
    for (let i = 0; i <= n; i += 2) pts.push([+route.lat[i].toFixed(6), +route.lon[i].toFixed(6)]);
    return { id: preset.id, name: preset.name, line: pts };
  });
  writeFileSync(resolve(root, 'tools/city/pgh-route-lines.json'), JSON.stringify(lines));
  console.log(`wrote tools/city/pgh-route-lines.json (${lines.length} routes)`);
  process.exit(0);
}

// ---- PGH
const pgh = JSON.parse(read('routes/cities/pgh.json'));
const G = decodeGraph(pgh);
const kx = 111320 * Math.cos((pgh.origin.lat * Math.PI) / 180), ky = 110540;
const xy = (lat, lon) => [(lon - pgh.origin.lon) * kx, (lat - pgh.origin.lat) * ky];
const nodeXY = new Map([...G.nodes.values()].map((n) => [n.id, xy(n.lat, n.lon)]));
const ngrid = new Map();
for (const [id, [x, y]] of nodeXY) { const k = `${Math.floor(x / 50)},${Math.floor(y / 50)}`; (ngrid.get(k) || ngrid.set(k, []).get(k)).push(id); }
const adj = new Map([...G.nodes.keys()].map((id) => [id, []]));
for (const e of G.edges) { adj.get(e.from).push({ e, dir: 1, to: e.to }); adj.get(e.to).push({ e, dir: -1, to: e.from }); }
function nearestNode(x, y, r) {
  let best = null, bd = r;
  const cx = Math.floor(x / 50), cy = Math.floor(y / 50);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const id of ngrid.get(`${cx + i},${cy + j}`) || []) {
    const [nx, ny] = nodeXY.get(id), d = Math.hypot(nx - x, ny - y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
function shortest(a, b) {
  if (a === b) return [];
  const dist = new Map([[a, 0]]), prev = new Map(), heap = [[0, a]];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, v] = pop();
    if (v === b) break;
    if (d > dist.get(v)) continue;
    for (const s of adj.get(v)) {
      const nd = d + s.e.n * 10;
      if (nd < (dist.get(s.to) ?? Infinity)) { dist.set(s.to, nd); prev.set(s.to, { from: v, s }); push(nd, s.to); }
    }
  }
  if (!prev.has(b)) return null;
  const out = [];
  for (let v = b; v !== a; v = prev.get(v).from) out.push(prev.get(v).s);
  return out.reverse();
}
const lineOf = (travs) => {
  const pts = [];
  for (const t of travs) {
    const e = t.e;
    for (let k = 0; k <= e.n; k++) { const i = t.dir > 0 ? k : e.n - k; if (pts.length && k === 0) continue; pts.push([e.lat[i], e.lon[i]]); }
  }
  return pts;
};

// ---- match every route (hidden-Markov map matching): every 20 m of the route projects onto the PGH ways near it; the
// Viterbi path picks, sample to sample, the positions whose network distance best matches the route's own step (and
// lie close to it); the junctions it passes between them become the route's traversals. No roads added: where PGH has
// no road the route rode, the match takes PGH's way round (a detour, reported).
const SIG = 8, CAP = 2000;
const startN = (t) => (t.dir > 0 ? t.e.from : t.e.to), endN = (t) => (t.dir > 0 ? t.e.to : t.e.from);
const egrid = new Map();
for (const e of G.edges) {
  e.xy = []; e.cum = [0];
  for (let i = 0; i <= e.n; i++) { e.xy.push(xy(e.lat[i], e.lon[i])); if (i) e.cum.push(e.cum[i - 1] + Math.hypot(e.xy[i][0] - e.xy[i - 1][0], e.xy[i][1] - e.xy[i - 1][1])); }
  e.len = e.cum[e.n];
  for (let i = 0; i <= e.n; i++) { const k = `${Math.floor(e.xy[i][0] / 40)},${Math.floor(e.xy[i][1] / 40)}`; (egrid.get(k) || egrid.set(k, []).get(k)).push([e, i]); }
}
function project(x, y, ele) {
  const best = new Map();
  const cx = Math.floor(x / 40), cy = Math.floor(y / 40);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [e, i] of egrid.get(`${cx + a},${cy + b}`) || []) {
    for (const j of [i - 1, i]) {
      if (j < 0 || j >= e.n) continue;
      const [ax, ay] = e.xy[j], [bx, by] = e.xy[j + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
      if (d > 30) continue;
      const h = e.ele[j] + (e.ele[j + 1] - e.ele[j]) * t;
      if (Math.abs(h - ele) > 15) continue;
      const cost = (d / SIG) ** 2 + (Math.abs(h - ele) / 6) ** 2;
      const prev = best.get(e);
      if (!prev || cost < prev.cost) best.set(e, { e, s: e.cum[j] + Math.sqrt(l2) * t, cost });
    }
  }
  return [...best.values()].sort((a, b) => a.cost - b.cost).slice(0, 6);
}
const sp = new Map();   // node → { dist, prev } (bounded single-source)
function from(u) {
  if (sp.has(u)) return sp.get(u);
  const dist = new Map([[u, 0]]), prev = new Map(), heap = [[0, u]];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist.get(v) || d > CAP) continue;
    for (const s2 of adj.get(v)) { const nd = d + s2.e.len; if (nd < (dist.get(s2.to) ?? Infinity)) { dist.set(s2.to, nd); prev.set(s2.to, { from: v, s: s2 }); push(nd, s2.to); } }
  }
  const r = { dist, prev };
  sp.set(u, r);
  return r;
}
function pathTo(u, v) { const r = from(u), out = []; if (!r.dist.has(v)) return null; for (let x = v; x !== u; x = r.prev.get(x).from) out.push(r.prev.get(x).s); return out.reverse(); }
// network distance between two positions, and how: { d, u (exit end of p), v (entry end of q) }
function netd(p, q) {
  if (p.e === q.e) return { d: Math.abs(q.s - p.s), same: true };
  let best = { d: Infinity };
  for (const [u, du] of [[p.e.from, p.s], [p.e.to, p.e.len - p.s]]) {
    const D = from(u).dist;
    for (const [v, dv] of [[q.e.from, q.s], [q.e.to, q.e.len - q.s]]) {
      const m = D.get(v);
      if (m == null) continue;
      const d = du + m + dv;
      if (d < best.d) best = { d, u, v };
    }
  }
  return best;
}
const out = [];
for (const preset of net.presets) {
  const route = makePathRoute(net, preset, { id: preset.id, name: preset.name });
  const lapM = route.lapM || preset.lengthM;
  const n = Math.min(route.lat.length - 1, Math.round(lapM / 10));
  const line = [];
  for (let i = 0; i <= n; i++) line.push([route.lat[i], route.lon[i], route.ele[i]]);
  const cols = [];
  for (let i = 0; i <= n; i += 2) { const [x, y] = xy(line[i][0], line[i][1]); const c = project(x, y, line[i][2]); if (c.length) cols.push({ i, c }); }
  // Viterbi
  let score = cols[0].c.map((c) => c.cost);
  const back = [], how = [];
  for (let t = 1; t < cols.length; t++) {
    const step = (cols[t].i - cols[t - 1].i) * 10, ns = [], bk = [], hw = [];
    for (const q of cols[t].c) {
      let bi = 0, bv = Infinity, bh = null;
      cols[t - 1].c.forEach((p, j) => {
        const nd = netd(p, q);
        const v = score[j] + (isFinite(nd.d) ? Math.abs(nd.d - step) / 10 : 400);
        if (v < bv) { bv = v; bi = j; bh = nd; }
      });
      ns.push(bv + q.cost); bk.push(bi); hw.push(bh);
    }
    score = ns; back.push(bk); how.push(hw);
  }
  let j = score.indexOf(Math.min(...score));
  const pick = [], via = [];
  for (let t = cols.length - 1; t >= 0; t--) { pick.push(cols[t].c[j]); if (t > 0) { via.push(how[t - 1][j]); j = back[t - 1][j]; } }
  pick.reverse(); via.reverse();
  // traversals: leave the current way through the end the transition used, then PGH's way to the next one
  const travs = [];
  let cur = pick[0].e, ent = null, gaps = 0;
  for (let t = 1; t < pick.length; t++) {
    const h = via[t - 1], q = pick[t];
    if (h.same || q.e === cur) continue;
    if (!isFinite(h.d)) { gaps++; cur = q.e; ent = null; continue; }
    if (ent !== h.u) travs.push({ e: cur, dir: h.u === cur.to ? 1 : -1 });   // (out by the end it came in: turned round mid-way, dropped)
    travs.push(...(pathTo(h.u, h.v) || []));
    cur = q.e; ent = h.v;
  }
  const closes = haversine({ lat: line[0][0], lon: line[0][1] }, { lat: line[n][0], lon: line[n][1] }) < 60;
  if (closes && travs.length) {
    const first = travs[0];
    // finish the last way and close the loop onto the first traversal's start
    const target = startN(first);
    if (ent != null) {
      const ends = [cur.from, cur.to].filter((x) => x !== ent);
      const u = ends[0] ?? cur.to;
      if (u !== ent) travs.push({ e: cur, dir: u === cur.to ? 1 : -1 });
      const tail = pathTo(endN(travs[travs.length - 1]), target);
      if (tail) travs.push(...tail);
    }
  }
  for (let changed = true; changed;) {   // a way ridden there and straight back by a turn at its far end that the route never made
    changed = false;
    for (let i = 1; i < travs.length; i++) if (travs[i].e === travs[i - 1].e && travs[i].dir === -travs[i - 1].dir && travs[i].e.len < 120) { travs.splice(i - 1, 2); changed = true; break; }
  }
  // join any break (a stretch of the route with no PGH way near it) by PGH's shortest way
  let breaks = 0;
  for (let i = 1; i < travs.length; i++) {
    if (endN(travs[i - 1]) === startN(travs[i])) continue;
    const seg = shortest(endN(travs[i - 1]), startN(travs[i]));
    if (seg) { travs.splice(i, 0, ...seg); i += seg.length; } else breaks++;
  }
  if (closes && travs.length && endN(travs[travs.length - 1]) !== startN(travs[0])) { const seg = shortest(endN(travs[travs.length - 1]), startN(travs[0])); if (seg) travs.push(...seg); }
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 1; i < travs.length; i++) if (travs[i].e === travs[i - 1].e && travs[i].dir === -travs[i - 1].dir && travs[i].e.len < 120) { travs.splice(i - 1, 2); changed = true; break; }
  }
  const mapped = lineOf(travs);
  const mlen = travs.reduce((s2, t) => s2 + t.e.n * 10, 0);
  const mg = new Map();
  for (const [la, lo] of mapped) { const [x, y] = xy(la, lo); const kk = `${Math.floor(x / 30)},${Math.floor(y / 30)}`; (mg.get(kk) || mg.set(kk, []).get(kk)).push([x, y]); }
  const onMapped = (la, lo) => { const [x, y] = xy(la, lo), cx = Math.floor(x / 30), cy = Math.floor(y / 30); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [px, py] of mg.get(`${cx + a},${cy + b}`) || []) if (Math.hypot(px - x, py - y) < NEAR_M) return true; return false; };
  const follow = line.filter(([la, lo]) => onMapped(la, lo)).length;
  // detours: stretches of the mapped line far from the route
  const rg = new Map();
  for (const [la, lo] of line) { const [x, y] = xy(la, lo); const kk = `${Math.floor(x / 30)},${Math.floor(y / 30)}`; (rg.get(kk) || rg.set(kk, []).get(kk)).push([x, y]); }
  const onRoute = (la, lo) => { const [x, y] = xy(la, lo), cx = Math.floor(x / 30), cy = Math.floor(y / 30); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [px, py] of rg.get(`${cx + a},${cy + b}`) || []) if (Math.hypot(px - x, py - y) < 40) return true; return false; };
  const detours = [];
  let run = null;
  mapped.forEach(([la, lo], i) => { if (!onRoute(la, lo)) { if (!run) { run = { lat: la, lon: lo, pghM: 0, via: new Set() }; detours.push(run); } run.pghM += 10; } else run = null; });
  const named = new Map();
  for (const t of travs) for (let i = 0; i <= t.e.n; i += 3) named.set(`${t.e.lat[i].toFixed(4)},${t.e.lon[i].toFixed(4)}`, t.e.name);
  for (const d of detours) { d.via = [named.get(`${d.lat.toFixed(4)},${d.lon.toFixed(4)}`) || '']; d.extraM = d.pghM; d.routeM = 0; }
  const big = detours.filter((d) => d.pghM >= 60);
  let climb = 0;
  for (const t of travs) climb += t.dir > 0 ? Math.max(0, t.e.ele[t.e.n] - t.e.ele[0]) : Math.max(0, t.e.ele[0] - t.e.ele[t.e.n]);
  out.push({ id: preset.id.replace(/^pgh-/, 'pgh2-'), from: preset.id, name: preset.name, tags: preset.tags || [], note: preset.note || '', closes,
    oldM: Math.round(lapM), pghM: mlen, climbM: Math.round(climb), followPct: Math.round((follow / line.length) * 100), missing: gaps + breaks, detours: big,
    path: travs.map((t) => `${t.e.id}${t.dir > 0 ? '+' : '-'}`),
    oldLine: line.filter((_, i) => i % 3 === 0 || i === n).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]),
    line: mapped.filter((_, i) => i % 2 === 0).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) });
}
mkdirSync(resolve(root, 'tools/.cache'), { recursive: true });
writeFileSync(resolve(root, 'tools/.cache/pgh-routes.json'), JSON.stringify(out));
for (const r of out) console.log(`${r.name.padEnd(46)} ${(r.oldM / 1000).toFixed(1).padStart(5)} → ${(r.pghM / 1000).toFixed(1).padStart(5)} km · follows ${String(r.followPct).padStart(3)} % · ${r.detours.length} detours${r.detours.length ? ` (${r.detours.reduce((s, d) => s + d.extraM, 0)} m off the route)` : ''}${r.missing ? ` · ${r.missing} breaks` : ''}`);
if (process.argv.includes('--write')) {
  pgh.presets = out.map((r) => ({ id: r.id, name: r.name, path: r.path, tags: r.tags, note: r.note, lengthM: r.pghM, climbM: r.climbM, from: r.from }));
  writeFileSync(resolve(root, 'routes/cities/pgh.json'), JSON.stringify(pgh));
  // the list the app shows before any route loads (pgh.json is MBs; this is a few KB)
  writeFileSync(resolve(root, 'routes/cities/pgh-presets.json'), JSON.stringify(out.map((r) => ({ id: r.id, name: r.name, tags: r.tags,
    note: r.note, lengthM: r.pghM, climbM: r.climbM, followPct: r.followPct })), null, 0));
  console.log(`wrote ${out.length} routes into routes/cities/pgh.json`);
}
