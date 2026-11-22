// Fix PGH's loops and appendages (tools/pgh_loops.mjs; user, 21 Nov: "fix all" — GPS errors):
//   loop   the way dropped              eye    the minor of the two ways dropped (routes are mapped again after)
//   knot   the curl cut out of the line spike  the out-and-back cut out of the line
// Junctions left with two ways are joined through (not where a route starts or turns round); only the largest
// connected piece is kept. Run tools/map_pgh_routes.mjs --write after.
//   node tools/fix_loops_pgh.mjs     (reads tools/.cache/pgh-loops.json for loops and eyes; finds knots and spikes again)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, joinThrough, resample, len, KX, KY } from './pgh_graph_edit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(file, 'utf8'));
const found = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-loops.json'), 'utf8'));
const { nodes, E } = load(json);
const byId = new Map(E.map((e) => [e.id, e]));
const keep = new Set();
for (const p of json.presets || []) {
  const t0 = byId.get(p.path[0].slice(0, -1)); keep.add(p.path[0].endsWith('+') ? t0.from : t0.to);
  for (let i = 0; i < p.path.length; i++) { const a = p.path[i], b = p.path[(i + 1) % p.path.length]; if (a.slice(0, -1) === b.slice(0, -1) && a !== b) { const e = byId.get(a.slice(0, -1)); keep.add(a.endsWith('+') ? e.to : e.from); } }
}
const rep = { loop: 0, eye: 0, knot: 0, spike: 0, cutM: 0, ramps: [] };
const gone = new Set();
for (const o of found) if ((o.kind === 'loop' || o.kind === 'eye') && byId.has(o.id) && !gone.has(o.id)) { gone.add(o.id); rep[o.kind]++; }
const X = (e, i) => e.lon[i] * KX, Y = (e, i) => e.lat[i] * KY;
const cut = (e, a, b) => { for (const k of ['lat', 'lon', 'ele', 'br']) e[k].splice(a + 1, b - a - 1); };   // keep a and b, drop between
for (const e of E) {
  if (gone.has(e.id)) continue;
  let changed = false;
  // knots (as tools/pgh_loops.mjs): the farthest point along that comes back within 8 m
  if (e.from !== e.to) for (let i = 0; i < e.lat.length; i++) {
    let f = -1;
    for (let j = i + 4; j < e.lat.length; j++) if (Math.hypot(X(e, j) - X(e, i), Y(e, j) - Y(e, i)) < 8) f = j;
    if (f >= 0 && Math.abs(e.ele[f] - e.ele[i]) > 2) { rep.ramps.push(`${e.name} (${(f - i) * 10} m, ${Math.abs(e.ele[f] - e.ele[i]).toFixed(0)} m up)`); i = f; continue; }   // (a curl that climbs is a real ramp: kept)
    if (f >= 0) { rep.cutM += (f - i) * 10; cut(e, i, f); rep.knot++; changed = true; }
  }
  // spikes
  for (let i = 1; i + 1 < e.lat.length; i++) {
    const a = Math.atan2(Y(e, i) - Y(e, i - 1), X(e, i) - X(e, i - 1)), b = Math.atan2(Y(e, i + 1) - Y(e, i), X(e, i + 1) - X(e, i));
    if (Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) <= (150 * Math.PI) / 180) continue;
    let k = 1; while (i - k >= 0 && i + k < e.lat.length && Math.hypot(X(e, i - k) - X(e, i + k), Y(e, i - k) - Y(e, i + k)) < 15) k++;
    if (k * 10 < 40 && i - k >= 0 && i + k < e.lat.length) { rep.cutM += 2 * k * 10; cut(e, i - k, i + k); rep.spike++; changed = true; i = Math.max(1, i - k); }
  }
  if (changed) resample(e);
}
let rest = E.filter((e) => !gone.has(e.id) && e.lat.length > 1);
{ // the largest connected piece
  const adj = new Map();
  for (const e of rest) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) (adj.get(a) || adj.set(a, []).get(a)).push(b);
  const comp = new Map(); let best = 0, bestN = 0, c = 0;
  for (const s0 of adj.keys()) { if (comp.has(s0)) continue; c++; let k = 0; const q = [s0]; comp.set(s0, c); while (q.length) { const x = q.pop(); k++; for (const y of adj.get(x)) if (!comp.has(y)) { comp.set(y, c); q.push(y); } } if (k > bestN) { bestN = k; best = c; } }
  const lost = rest.filter((e) => comp.get(e.from) !== best).length;
  if (lost) console.log(`  + ${lost} ways cut off with them`);
  rest = rest.filter((e) => comp.get(e.from) === best);
}
const out = joinThrough(rest, keep);
save(json, nodes, out);
writeFileSync(file, JSON.stringify(json));
console.log(`loops & appendages fixed: ${rep.loop} loops and ${rep.eye} eyes dropped; ${rep.knot} knots and ${rep.spike} spikes cut out of their lines (${rep.cutM} m of line) → ${json.nodes.length} junctions, ${out.length} ways, ${(out.reduce((s, e) => s + len(e), 0) / 1000).toFixed(0)} km${rep.ramps.length ? `; kept ${rep.ramps.length} curls that climb (real ramps): ${rep.ramps.join(', ')}` : ''}`);
