#!/usr/bin/env node
// Plan a landmark tour over a city's ride network (PLAN 7.10, "Tour de Pittsburgh"): search closed walks from a
// start junction over the built network (routes/cities/<city>-network.json, on the areas' own 10 m samples) and
// score them by the landmarks they pass (routes/cities/<city>-map.json `landmarks`, within --reach m), length in
// range, few repeated segments and sensible climbing (the steepest walls only when they buy a landmark).
//
//   node tools/plan_tour.mjs [--start A] [--min 40000] [--max 60000] [--reach 250] [--top 10]
//
// Prints the best walks as spec keys ("A>NS+" …) ready for tools/city/<city>-network.spec.json's presets, with
// length, climb and the landmarks in the order they're passed. Data only: it writes nothing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogRoute } from '../js/routes.js';
import { haversine } from '../js/gpx.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const START = opt('start', 'A'), MIN = +opt('min', 40000), MAX = +opt('max', 60000), REACH = +opt('reach', 250), TOP = +opt('top', 10);
const net = JSON.parse(read(opt('network', 'routes/cities/pittsburgh-network.json')));
const map = JSON.parse(read(net.map));
const index = JSON.parse(read('routes/catalog.json'));

// the landmarks (not the T's stations: they're stops, not sights), weighted by rank
const marks = map.landmarks.filter((l) => l.kind !== 'transit').map((l) => ({ ...l, w: { 1: 3, 2: 2, 3: 1 }[l.rank] || 1 }));

// each edge's samples (forward), the landmarks it passes (and where along it) and its steepest grade each way
const routes = {};
for (const a of net.areas) {
  const item = index.find((r) => r.id === a.catalogId);
  routes[a.id] = buildCatalogRoute(read(item.file), { ...item, routeId: item.id });
}
const W = 3;   // grade over 30 m
const edges = net.edges.map((e) => {
  const r = routes[e.area];
  const pts = [];
  for (let s = e.s[0]; s <= e.s[1]; s += 10) { const i = Math.round(s / 10); pts.push({ lat: r.lat[i], lon: r.lon[i], ele: r.ele[i] }); }
  const near = [];
  for (const [k, m] of marks.entries()) {
    let best = null;
    pts.forEach((p, j) => { const d = haversine(p, m); if (d <= REACH && (!best || d < best.d)) best = { d, j }; });
    if (best) near.push({ k, u: best.j / Math.max(1, pts.length - 1), d: best.d });
  }
  let up = 0, down = 0;
  // (not on a conveyor: an escalator's rise is the escalator's, not the rider's)
  const onBelt = (j) => (e.conveyors || []).some((c) => j * 10 >= c.u0 - 10 && (j - W) * 10 <= c.u1 + 10);
  for (let j = W; j < pts.length; j++) { if (onBelt(j)) continue; const g = (pts[j].ele - pts[j - W].ele) / (W * 10); up = Math.max(up, g); down = Math.max(down, -g); }
  return { ...e, near, maxGrade: [up, down] };
});
const byId = Object.fromEntries(edges.map((e) => [e.id, e]));

// moves out of each node: [edge, dir(+1/-1), to]
const out = {};
for (const e of edges) {
  (out[e.from] ||= []).push({ e, dir: 1, to: e.to });
  (out[e.to] ||= []).push({ e, dir: -1, to: e.from });
}
// shortest way home from every node (prunes walks that can't close within MAX)
const home = { [START]: 0 };
{
  for (let it = 0; it < edges.length; it++) {
    let changed = false;
    for (const e of edges) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (home[b] != null && (home[a] == null || home[b] + e.lengthM < home[a])) { home[a] = home[b] + e.lengthM; changed = true; }
    }
    if (!changed) break;
  }
}

// ridden through (PLAN 7.8, Phipps): the landmark counts double only on the traversal that rides through it
const THROUGH = { 'NS>CB+': 'PNC Park', 'R>A+': 'Acrisure Stadium', 'K>J+': 'Phipps' };
// a walk's score: landmark weight (each once), less a penalty per repeated segment, for climbing and for walls
const STEEP = 0.15;
function score(path) {
  const seen = new Set(), used = {};
  let pts = 0, len = 0, climb = 0, repeats = 0, walls = 0;
  for (const { e, dir } of path) {
    len += e.lengthM; climb += e.climbM[dir > 0 ? 0 : 1];
    used[e.id] = (used[e.id] || 0) + 1; if (used[e.id] > 1) repeats += e.lengthM;
    let gained = 0;
    for (const n of e.near) if (!seen.has(n.k)) { seen.add(n.k); pts += marks[n.k].w; gained += marks[n.k].w; }
    const thr = THROUGH[e.key + (dir > 0 ? '+' : '-')];
    if (thr && !seen.has(`through ${thr}`)) { seen.add(`through ${thr}`); pts += 3; gained += 3; }
    if (e.maxGrade[dir > 0 ? 0 : 1] > STEEP) walls += gained ? 0.5 : 2;   // a wall that buys a landmark costs less
  }
  return { pts, len, climb, repeats, walls, n: [...seen].filter((x) => typeof x === 'number').length, s: pts - repeats / 1500 - climb / 150 - walls - Math.max(0, len - 55000) / 2000 };
}

// depth-first over closed walks: each segment at most twice, the same way at most once
const best = [];
let visited = 0;
const LIMIT = +opt('limit', 40e6);
function dfs(node, path, len, uses) {
  if (++visited > LIMIT) return;
  if (node === START && path.length && len >= MIN) {
    const sc = score(path);
    best.push({ path: path.slice(), ...sc });
    if (best.length > 4000) { best.sort((a, b) => b.s - a.s); best.length = 400; }
  }
  for (const m of out[node]) {
    const key = m.e.id + (m.dir > 0 ? '+' : '-');
    const n = uses[m.e.id] || 0;
    if (n >= 2 || uses[key]) continue;
    // never straight back the way we came (a spur's out-and-back is allowed only at a dead end)
    const last = path[path.length - 1];
    if (last && last.e.id === m.e.id && out[node].length > 1) continue;
    if (len + m.e.lengthM + home[m.to] > MAX) continue;
    uses[m.e.id] = n + 1; uses[key] = 1; path.push(m);
    dfs(m.to, path, len + m.e.lengthM, uses);
    path.pop(); uses[m.e.id] = n; delete uses[key];
  }
}
// --path '["A>NS+", …]': score that one walk instead of searching (to compare a hand-made variant)
if (opt('path')) {
  const path = JSON.parse(opt('path')).map((t) => { const e = edges.find((x) => x.key === t.slice(0, -1)); if (!e) throw new Error(`no edge ${t}`); return { e, dir: t.endsWith('+') ? 1 : -1, to: t.endsWith('+') ? e.to : e.from }; });
  best.push({ path, ...score(path) });
} else dfs(START, [], 0, {});
best.sort((a, b) => b.s - a.s);
// distinct walks only (the same set of segments, rotated or reordered, counts once)
const shown = new Set();
let k = 0;
console.log(`${visited.toLocaleString()} walks searched${visited > LIMIT ? ' (limit hit)' : ''}; ${marks.length} landmarks within ${REACH} m`);
for (const b of best) {
  const sig = b.path.map((m) => m.e.id).sort().join(',');
  if (shown.has(sig)) continue; shown.add(sig);
  if (++k > TOP) break;
  const keys = b.path.map((m) => `${m.e.key}${m.dir > 0 ? '+' : '-'}`);
  // the landmarks in riding order
  const order = [], seen = new Set();
  for (const m of b.path) {
    const list = m.e.near.map((x) => ({ ...x, u: m.dir > 0 ? x.u : 1 - x.u })).sort((a, c) => a.u - c.u);
    for (const x of list) if (!seen.has(x.k)) { seen.add(x.k); order.push(marks[x.k].label); }
  }
  console.log(`\n#${k} score ${b.s.toFixed(1)} · ${(b.len / 1000).toFixed(1)} km · +${b.climb} m · ${b.n} landmarks (${b.pts} pts) · repeats ${b.repeats} m · walls ${b.walls}`);
  console.log(`  ${JSON.stringify(keys)}`);
  console.log(`  ${b.path.map((m) => m.e.name).join(' → ')}`);
  console.log(`  landmarks: ${order.join(', ')}`);
  console.log(`  missed: ${marks.filter((_, i) => !seen.has(i)).map((m) => m.label).join(', ')}`);
}
if (opt('edges')) for (const e of edges) console.log(`${e.id} ${e.key} ${(e.maxGrade[0] * 100).toFixed(0)}%/${(e.maxGrade[1] * 100).toFixed(0)}% ${e.near.map((n) => marks[n.k].label).join(', ')}`);
export { byId };
