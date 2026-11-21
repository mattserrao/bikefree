// Neaten where PGH's streets meet, within the routes (user, 21 Nov): the ideas of tools/pgh_junctions.mjs, in order —
//   1. small triangles and sharp forks: drop the minor way (never one a route rides)
//   2. short links and clusters: merge their junctions into one (a way's end eases over 40 m to the new spot; a bridge's
//      end never moves — the junction goes to it)
//   3. busy junctions left with 5+ ways: drop minor ways (never ridden) down to 4
// A way only goes when both its junctions keep two others and the network stays in one piece. Junctions left with two
// ways are joined through (not where a route starts or turns round). Run tools/map_pgh_routes.mjs --write after.
//   node tools/neaten_pgh.mjs     (reads routes/cities/pgh.json + tools/.cache/pgh-junctions.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, joinThrough, arms, canRemove, moveEnd, resample, len, dist, RANK } from './pgh_graph_edit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(file, 'utf8'));
if (!json.presets?.length) throw new Error('pgh.json has no routes: run tools/map_pgh_routes.mjs --write first');
const ideas = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-junctions.json'), 'utf8'));
let { nodes, E } = load(json);
const ridden = new Set(json.presets.flatMap((p) => p.path.map((k) => k.slice(0, -1))));
for (const e of E) e.ridden = ridden.has(e.id);
const byId = new Map(E.map((e) => [e.id, e]));
// junctions a route starts at or turns round at
const keep = new Set();
for (const p of json.presets) {
  const t0 = byId.get(p.path[0].slice(0, -1)); keep.add(p.path[0].endsWith('+') ? t0.from : t0.to);
  for (let i = 0; i < p.path.length; i++) {
    const a = p.path[i], b = p.path[(i + 1) % p.path.length];
    if (a.slice(0, -1) === b.slice(0, -1) && a !== b) { const e = byId.get(a.slice(0, -1)); keep.add(a.endsWith('+') ? e.to : e.from); }
  }
}
const km = (es) => es.reduce((s, e) => s + len(e), 0) / 1000;
const before = { j: nodes.size, e: E.length, km: km(E) };
const rep = {};

// 1. triangles, sharp forks
const gone = new Set();
let n1 = 0;
for (const kind of ['triangle', 'acute']) {
  let n = 0;
  for (const o of ideas.filter((x) => x.kind === kind && x.cut)) {
    const e = byId.get(o.cut);
    if (!e || gone.has(e) || e.ridden) continue;
    const live = E.filter((x) => !gone.has(x));
    if (!canRemove(live, e)) continue;
    gone.add(e); n++;
  }
  rep[kind] = n; n1 += n;
}
E = E.filter((e) => !gone.has(e));

// 2. merge junctions: short links + clusters (a group spans ≤ 50 m)
const gid = new Map(), groups = new Map();   // node → group id; group id → Set(nodes)
const at0 = arms(E);
const onBridge = (n) => (at0.get(n) || []).some((e) => { const k = e.lat.length - 1, idx = e.from === n ? [0, 1, 2, 3] : [k, k - 1, k - 2, k - 3]; return idx.some((i) => e.br[Math.max(0, Math.min(k, i))]); });
let gseq = 0;
const tryUnion = (list) => {
  const live = list.filter((n) => at0.has(n));
  if (live.length < 2) return false;
  const all = new Set(live.flatMap((n) => (gid.has(n) ? [...groups.get(gid.get(n))] : [n])));
  const pts = [...all].map((n) => nodes.get(n));
  for (const a of pts) for (const b of pts) if (dist(a, b) > 50) return false;
  if ([...all].filter(onBridge).length > 1) return false;
  for (const n of all) if (gid.has(n)) groups.delete(gid.get(n));
  const g = ++gseq; groups.set(g, all);
  for (const n of all) gid.set(n, g);
  return true;
};
rep.short = 0; rep.cluster = 0;
for (const kind of ['cluster', 'short']) for (const o of ideas.filter((x) => x.kind === kind)) if (tryUnion(o.nodes)) rep[kind]++;
let merged = 0, dropped = 0;
const moved = new Set();
const to = new Map();   // merged node → the junction kept
for (const set of groups.values()) {
  const ms = [...set].map((n) => nodes.get(n));
  const anchor = ms.find((m) => onBridge(m.id)) || null;
  const deg = (n) => (at0.get(n) || []).length;
  const keepId = (anchor || ms.slice().sort((a, b) => deg(b.id) - deg(a.id))[0]).id;
  const pos = anchor ? { lat: anchor.lat, lon: anchor.lon, ele: anchor.ele }
    : { lat: ms.reduce((s, m) => s + m.lat, 0) / ms.length, lon: ms.reduce((s, m) => s + m.lon, 0) / ms.length, ele: ms.reduce((s, m) => s + m.ele, 0) / ms.length };
  Object.assign(nodes.get(keepId), pos);
  if ([...set].some((n) => keep.has(n))) keep.add(keepId);
  for (const n of set) if (n !== keepId) to.set(n, keepId);
  merged += set.size - 1;
}
const fin = (n) => to.get(n) || n;
const out2 = [];
for (const e of E) {
  const a = fin(e.from), b = fin(e.to);
  if (a === b && a !== e.from && len(e) < 60) { dropped++; continue; }   // a way inside a merged junction
  if (a === b && e.from !== e.to && len(e) < 60) { dropped++; continue; }
  e.from = a; e.to = b;
  const k = e.lat.length - 1, A = nodes.get(a), B = nodes.get(b);   // (the kept junction itself may have moved to the middle)
  if (Math.abs(e.lat[0] - A.lat) + Math.abs(e.lon[0] - A.lon) + Math.abs(e.ele[0] - A.ele) * 1e-6 > 1e-7) { moveEnd(e, 0, A); moved.add(e); }
  if (Math.abs(e.lat[k] - B.lat) + Math.abs(e.lon[k] - B.lon) + Math.abs(e.ele[k] - B.ele) * 1e-6 > 1e-7) { moveEnd(e, 1, B); moved.add(e); }
  out2.push(e);
}
// the same two junctions joined twice by ways of nearly the same length: keep one (ridden, then the major, then the longer)
const pair = new Map();
E = [];
for (const e of out2) {
  const k = [e.from, e.to].sort().join('|');
  const o = pair.get(k);
  if (o && e.from !== e.to && Math.abs(len(o) - len(e)) < 0.2 * Math.max(len(o), len(e))) {
    const better = (x, y) => (x.ridden - y.ridden) || ((RANK[x.kind] ?? 2) - (RANK[y.kind] ?? 2)) || (len(x) - len(y));
    if (better(e, o) > 0) { E[E.indexOf(o)] = e; pair.set(k, e); }
    e.ridden = e.ridden || o.ridden; dropped++; continue;
  }
  pair.set(k, e); E.push(e);
}
for (const e of moved) if (E.includes(e)) resample(e);
rep.merged = merged; rep.inside = dropped;

// 3. busy junctions: minor ways down to 4
rep.busy = 0;
for (let again = true; again;) {
  again = false;
  const at = arms(E);
  for (const [n, es] of at) {
    if (es.length < 5) continue;
    const cand = es.filter((e) => !e.ridden).sort((a, b) => ((RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2)) || (len(a) - len(b)));
    for (const e of cand) {
      if ((at.get(n)?.length ?? 0) <= 4) break;
      if (!canRemove(E, e, at)) continue;
      E = E.filter((x) => x !== e); rep.busy++; again = true;
      break;
    }
    if (again) break;
  }
}

E = joinThrough(E, keep);
// every end on its junction (a junction can be both a group's keeper and a way's far end: pin once more)
for (const e of E) {
  const k = e.lat.length - 1, A = nodes.get(e.from), B = nodes.get(e.to);
  let m = false;
  if (dist({ lat: e.lat[0], lon: e.lon[0] }, A) > 0.3 || Math.abs(e.ele[0] - A.ele) > 0.1) { moveEnd(e, 0, A); m = true; }
  if (dist({ lat: e.lat[k], lon: e.lon[k] }, B) > 0.3 || Math.abs(e.ele[k] - B.ele) > 0.1) { moveEnd(e, 1, B); m = true; }
  if (m) resample(e);
}
save(json, nodes, E);
writeFileSync(file, JSON.stringify(json));
const after = { j: json.nodes.length, e: E.length, km: km(E) };
console.log(`neatened PGH: dropped ${rep.triangle} triangle sides, ${rep.acute} sharp forks; merged ${rep.merged} junctions (${rep.short} short links, ${rep.cluster} clusters; ${rep.inside} ways inside them or doubled); ${rep.busy} ways off busy junctions`);
console.log(`  ${before.j} → ${after.j} junctions, ${before.e} → ${after.e} ways, ${before.km.toFixed(0)} → ${after.km.toFixed(0)} km`);
