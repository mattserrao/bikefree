#!/usr/bin/env node
// Build a city's ride network (choose your turns) from a spec: tools/city/<id>-network.spec.json.
//
//   node tools/build_network.mjs [tools/city/pittsburgh-network.spec.json] [--check]
//
// Nodes are junctions given by lat/lon; the tool finds every pass of the loop's GPX through each one
// (on the app's 10 m samples) and splits the loop there into edges. Edges are keyed "FROM>TO" in the
// spec (names for each riding direction); presets are lists of edge traversals ("A>G+" forward,
// "A>G-" backward). Output: the network the app loads (js/network.js), format bikefree-network-1.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogRoute } from '../js/routes.js';
import { haversine } from '../js/gpx.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const specPath = args.find((a) => !a.startsWith('--')) || 'tools/city/pittsburgh-network.spec.json';
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const spec = JSON.parse(read(specPath));
const index = JSON.parse(read('routes/parks/index.json'));
const item = index.find((r) => r.id === spec.catalogId);
if (!item || item.file !== spec.base) throw new Error(`catalog entry ${spec.catalogId} must ride ${spec.base}`);
const route = buildCatalogRoute(read(spec.base), { ...item, routeId: item.id });
const L = route.turnS || route.total;
const K = Math.round(L / 10);
const REACH = 30;   // a pass is where the loop comes within this many metres of the node

// every pass of the loop through each node: the nearest sample of each run within REACH
const at = (i) => ({ lat: route.lat[i], lon: route.lon[i] });
const splits = [];
for (const n of spec.nodes) {
  let run = null;
  const passes = [];
  for (let i = 0; i <= K; i++) {
    const d = haversine(n, at(i));
    if (d < REACH) { if (!run || d < run.d) run = { d, i }; if (!run.open) run.open = true; }
    else if (run) { passes.push(run.i); run = null; }
  }
  if (run) passes.push(run.i);
  // the loop's start and end are one point: a node there splits at 0 (and the loop closes at L)
  const list = [...new Set(passes.map((i) => (i === K ? 0 : i)))];
  if (!list.length) throw new Error(`node ${n.id}: the loop doesn't pass within ${REACH} m`);
  n.passes = list.map((i) => i * 10);
  for (const s of n.passes) splits.push({ s, node: n.id });
}
splits.sort((a, b) => a.s - b.s);
if (splits[0].s !== 0) throw new Error('the loop\'s start must be a node (the edges are split from it)');
// passes that are really one junction crossed twice must sit at the same height
for (const n of spec.nodes) {
  const ele = n.passes.map((s) => route.ele[s / 10]);
  n.lat = +route.lat[n.passes[0] / 10].toFixed(6); n.lon = +route.lon[n.passes[0] / 10].toFixed(6);
  n.ele = +(ele.reduce((a, b) => a + b, 0) / ele.length).toFixed(2);
  const spread = Math.max(...ele) - Math.min(...ele);
  if (spread > 1.5) throw new Error(`node ${n.id}: passes differ by ${spread.toFixed(2)} m in height`);
}
const edges = [];
for (let k = 0; k < splits.length; k++) {
  const a = splits[k], b = splits[k + 1] || { s: L, node: splits[0].node };
  const key = `${a.node}>${b.node}`;
  const names = spec.edges[key];
  if (!names) throw new Error(`no names for edge ${key} in the spec`);
  if (edges.some((e) => e.key === key)) throw new Error(`two edges ${key}: name them apart in the spec`);
  let up = 0, down = 0;
  for (let i = a.s / 10 + 1; i <= b.s / 10; i++) { const d = route.ele[i] - route.ele[i - 1]; if (d > 0) up += d; else down -= d; }
  edges.push({ id: `e${edges.length + 1}`, key, from: a.node, to: b.node, s: [a.s, b.s], lengthM: b.s - a.s,
    climbM: [Math.round(up), Math.round(down)], name: names.name, toward: [names.fwd, names.rev] });
}
const trav = (t) => {
  const m = /^(.+)([+-])$/.exec(t);
  const e = m && edges.find((x) => x.key === m[1]);
  if (!e) throw new Error(`preset step ${t}: no such edge`);
  return `${e.id}${m[2]}`;
};
const presets = spec.presets.map((p) => {
  const path = p.path.map(trav);
  // each step must leave from where the last one arrived, and the loop must close
  const ends = path.map((t) => { const e = edges.find((x) => x.id === t.slice(0, -1)); return t.endsWith('+') ? [e.from, e.to] : [e.to, e.from]; });
  for (let i = 0; i < ends.length; i++) if (ends[i][1] !== ends[(i + 1) % ends.length][0]) throw new Error(`preset ${p.id}: step ${i + 1} doesn't lead into step ${(i + 2 - 1) % ends.length + 1}`);
  const lengthM = path.reduce((s, t) => s + edges.find((x) => x.id === t.slice(0, -1)).lengthM, 0);
  const climbM = path.reduce((s, t) => { const e = edges.find((x) => x.id === t.slice(0, -1)); return s + e.climbM[t.endsWith('+') ? 0 : 1]; }, 0);
  return { ...p, path, lengthM, climbM };
});
const out = {
  format: 'bikefree-network-1', id: spec.id, base: spec.base, legM: L,
  nodes: spec.nodes.map(({ id, name, lat, lon, ele, passes }) => ({ id, name, lat, lon, ele, passes })),
  edges, presets,
};
const text = `${JSON.stringify(out, null, 1)}\n`;
if (check) {
  if (read(spec.out) !== text) { console.error(`${spec.out} is out of date: run node tools/build_network.mjs ${specPath}`); process.exit(1); }
  console.log(`${spec.out} is up to date`);
} else {
  writeFileSync(resolve(root, spec.out), text);
  console.log(`${spec.out}: ${out.nodes.length} nodes, ${edges.length} edges, ${presets.length} presets`);
  for (const e of edges) console.log(`  ${e.id} ${e.key} ${e.s[0]}–${e.s[1]} m (${(e.lengthM / 1000).toFixed(2)} km, +${e.climbM[0]} / −${e.climbM[1]} m) ${e.name}`);
  for (const p of presets) console.log(`  preset ${p.id}: ${p.path.join(' ')} · ${(p.lengthM / 1000).toFixed(1)} km · ${p.climbM} m`);
}
