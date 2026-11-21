// Remove stubs found by tools/pgh_stubs.mjs (user, 21 Nov: "remove orange" — the real dead ends: cul-de-sacs, trail
// ends, driveways), never one a route rides. Junctions left with two ways are joined through (not where a route starts
// or turns round). Run tools/map_pgh_routes.mjs --write after.
//   node tools/remove_stubs_pgh.mjs [--why osm,trimmed]     (default: osm)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, joinThrough, len } from './pgh_graph_edit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const why = new Set((args.includes('--why') ? args[args.indexOf('--why') + 1] : 'osm').split(','));
const file = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(file, 'utf8'));
const stubs = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-stubs.json'), 'utf8'));
const { nodes, E } = load(json);
const byId = new Map(E.map((e) => [e.id, e]));
const keep = new Set();
for (const p of json.presets || []) {
  const t0 = byId.get(p.path[0].slice(0, -1)); keep.add(p.path[0].endsWith('+') ? t0.from : t0.to);
  for (let i = 0; i < p.path.length; i++) { const a = p.path[i], b = p.path[(i + 1) % p.path.length]; if (a.slice(0, -1) === b.slice(0, -1) && a !== b) { const e = byId.get(a.slice(0, -1)); keep.add(a.endsWith('+') ? e.to : e.from); } }
}
const ridden = new Set((json.presets || []).flatMap((p) => p.path.map((k) => k.slice(0, -1))));
const gone = new Set();
let n = 0, m = 0;
for (const s of stubs) {
  if (!why.has(s.why) || s.ridden || s.ways.some((id) => ridden.has(id))) continue;
  for (const id of s.ways) gone.add(id);
  n++; m += s.m;
}
const before = E.length;
let rest = E.filter((e) => !gone.has(e.id));
// a stub that ended in a little loop (a turning circle): the loop goes with it (keep the largest connected piece)
{
  const adj = new Map();
  for (const e of rest) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) (adj.get(a) || adj.set(a, []).get(a)).push(b);
  const comp = new Map(); let best = null, bestN = 0, c = 0;
  for (const s0 of adj.keys()) {
    if (comp.has(s0)) continue;
    c++; let k = 0; const q = [s0]; comp.set(s0, c);
    while (q.length) { const x = q.pop(); k++; for (const y of adj.get(x)) if (!comp.has(y)) { comp.set(y, c); q.push(y); } }
    if (k > bestN) { bestN = k; best = c; }
  }
  const lost = rest.filter((e) => comp.get(e.from) !== best);
  if (lost.length) console.log(`  + ${lost.length} ways of turning loops at the end of removed stubs`);
  rest = rest.filter((e) => comp.get(e.from) === best);
}
const out = joinThrough(rest, keep);
save(json, nodes, out);
writeFileSync(file, JSON.stringify(json));
console.log(`removed ${n} stubs (${gone.size} ways, ${(m / 1000).toFixed(1)} km: ${[...why].join(', ')}) → ${json.nodes.length} junctions, ${out.length} ways (was ${before}), ${(out.reduce((s, e) => s + len(e), 0) / 1000).toFixed(0)} km`);
