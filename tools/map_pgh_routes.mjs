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

// ---- match every route
const out = [];
for (const preset of net.presets) {
  const route = makePathRoute(net, preset, { id: preset.id, name: preset.name });
  const lapM = route.lapM || preset.lengthM;
  const n = Math.min(route.lat.length - 1, Math.round(lapM / 10));
  const line = [];
  for (let i = 0; i <= n; i++) line.push([route.lat[i], route.lon[i]]);
  // waypoints: the PGH junctions the route passes (in order, no repeats in a row)
  const way = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = xy(line[i][0], line[i][1]);
    const id = nearestNode(x, y, SNAP_M);
    if (id && way[way.length - 1]?.id !== id) way.push({ id, at: i * 10 });
  }
  // a junction met twice within a few samples on a wiggle: keep the first
  const travs = [], detours = [];
  let missing = 0;
  const closes = haversine({ lat: line[0][0], lon: line[0][1] }, { lat: line[n][0], lon: line[n][1] }) < 60;
  const wps = closes && way.length > 1 && way[0].id !== way[way.length - 1].id ? [...way, { id: way[0].id, at: lapM }] : way;
  for (let k = 1; k < wps.length; k++) {
    const a = wps[k - 1], b = wps[k];
    const seg = shortest(a.id, b.id);
    if (!seg) { missing++; continue; }
    const len = seg.reduce((s, t) => s + t.e.n * 10, 0), along = Math.max(10, b.at - a.at);
    if (len > along * DETOUR_MIN + 30) {
      const p = G.nodes.get(a.id);
      detours.push({ lat: p.lat, lon: p.lon, routeM: Math.round(along), pghM: Math.round(len), extraM: Math.round(len - along), via: [...new Set(seg.map((t) => t.e.name))].slice(0, 4) });
    }
    travs.push(...seg);
  }
  const mapped = lineOf(travs);
  const mlen = travs.reduce((s, t) => s + t.e.n * 10, 0);
  // how much of the route the mapped line follows (within NEAR_M)
  const mg = new Map();
  for (const [la, lo] of mapped) { const [x, y] = xy(la, lo); const kk = `${Math.floor(x / 30)},${Math.floor(y / 30)}`; (mg.get(kk) || mg.set(kk, []).get(kk)).push([x, y]); }
  let follow = 0;
  for (const [la, lo] of line) {
    const [x, y] = xy(la, lo), cx = Math.floor(x / 30), cy = Math.floor(y / 30);
    let ok = false;
    for (let i = -1; i <= 1 && !ok; i++) for (let j = -1; j <= 1 && !ok; j++) for (const [px, py] of mg.get(`${cx + i},${cy + j}`) || []) if (Math.hypot(px - x, py - y) < NEAR_M) { ok = true; break; }
    if (ok) follow++;
  }
  let climb = 0;
  for (const t of travs) climb += t.dir > 0 ? Math.max(0, t.e.ele[t.e.n] - t.e.ele[0]) : Math.max(0, t.e.ele[0] - t.e.ele[t.e.n]);
  out.push({ id: preset.id.replace(/^pgh-/, 'pgh2-'), from: preset.id, name: preset.name, tags: preset.tags || [], note: preset.note || '', closes,
    oldM: Math.round(lapM), pghM: mlen, followPct: Math.round((follow / line.length) * 100), waypoints: way.length, missing, detours,
    path: travs.map((t) => `${t.e.id}${t.dir > 0 ? '+' : '-'}`),
    via: wps.map((w) => { const p = G.nodes.get(w.id); return [p.lat, p.lon]; }),
    oldLine: line.filter((_, i) => i % 3 === 0 || i === n).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]),
    line: mapped.filter((_, i) => i % 2 === 0).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) });
}
mkdirSync(resolve(root, 'tools/.cache'), { recursive: true });
writeFileSync(resolve(root, 'tools/.cache/pgh-routes.json'), JSON.stringify(out));
for (const r of out) console.log(`${r.name.padEnd(46)} ${(r.oldM / 1000).toFixed(1).padStart(5)} → ${(r.pghM / 1000).toFixed(1).padStart(5)} km · follows ${String(r.followPct).padStart(3)} % · ${r.detours.length} detours${r.detours.length ? ` (+${r.detours.reduce((s, d) => s + d.extraM, 0)} m)` : ''}${r.missing ? ` · ${r.missing} gaps` : ''}`);
if (process.argv.includes('--write')) {
  pgh.presets = out.map((r) => ({ id: r.id, name: r.name, path: r.path, via: r.via, tags: r.tags, note: r.note, lengthM: r.pghM, from: r.from }));
  writeFileSync(resolve(root, 'routes/cities/pgh.json'), JSON.stringify(pgh));
  console.log(`wrote ${out.length} routes into routes/cities/pgh.json`);
}
