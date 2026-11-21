// PGH's stubs (user, 21 Nov: "odd stubs of road around"): every branch that hangs off the network — a dead-end way,
// or a little tree of them — found as what is not in the graph's 2-core (peel dead ends until none are left).
// Each branch: its ways, length, where it hangs from, whether a route rides it, and why it is there:
//   trimmed  its far end lost its ways when the ways no route touches went (tools/prune_pgh.mjs)
//   tiny     under 30 m (a leftover of a merged or split junction)
//   osm      a real dead end (a cul-de-sac, a trail's end, a driveway)
// Suggested: remove — unless a route rides it.
//   node tools/pgh_stubs.mjs → tools/.cache/pgh-stubs.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGraph } from '../js/graph.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const G = decodeGraph(json);
const ridden = new Set((json.presets || []).flatMap((p) => p.path.map((k) => k.slice(0, -1))));
const pruned = (() => { try { return JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-pruned.json'), 'utf8')).ways; } catch { return []; } })();
const kx = 111320 * Math.cos((40.44 * Math.PI) / 180), ky = 110540;
const pg = new Map();
for (const w of pruned) for (const p of [w.line[0], w.line[w.line.length - 1]]) { const k = `${Math.round(p[0] * 2000)},${Math.round(p[1] * 1500)}`; (pg.get(k) || pg.set(k, []).get(k)).push(p); }
const nearPruned = (la, lo) => { const a = Math.round(la * 2000), b = Math.round(lo * 1500); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of pg.get(`${a + i},${b + j}`) || []) if (Math.hypot((p[1] - lo) * kx, (p[0] - la) * ky) < 25) return true; return false; };

// peel to the 2-core
const at = new Map();
for (const e of G.edges) for (const n of [e.from, e.to]) (at.get(n) || at.set(n, []).get(n)).push(e);
const deg = new Map([...at].map(([n, es]) => [n, es.filter((e) => e.from !== e.to).length]));
const off = new Set(), q = [...deg].filter(([, d]) => d === 1).map(([n]) => n);
while (q.length) {
  const n = q.pop();
  for (const e of at.get(n)) {
    if (off.has(e) || e.from === e.to) continue;
    off.add(e);
    for (const m of [e.from, e.to]) if (m !== n) { deg.set(m, deg.get(m) - 1); if (deg.get(m) === 1) q.push(m); }
    deg.set(n, 0);
  }
}
// group the peeled ways into branches (connected through junctions that are not in the core)
const core = (n) => deg.get(n) >= 2;
const seen = new Set(), branches = [];
for (const e of off) {
  if (seen.has(e)) continue;
  const list = [], stack = [e]; seen.add(e);
  let root = null;
  while (stack.length) {
    const x = stack.pop(); list.push(x);
    for (const n of [x.from, x.to]) {
      if (core(n)) { root = n; continue; }
      for (const y of at.get(n)) if (off.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
    }
  }
  const L = list.reduce((s, x) => s + x.n * 10, 0);
  const tips = [...new Set(list.flatMap((x) => [x.from, x.to]))].filter((n) => at.get(n).length === 1);
  const N = (id) => G.nodes.get(id);
  const why = tips.some((n) => nearPruned(N(n).lat, N(n).lon)) ? 'trimmed' : L < 30 ? 'tiny' : 'osm';
  const rid = list.some((x) => ridden.has(x.id));
  const onRoute = root ? at.get(root).some((x) => ridden.has(x.id)) : false;   // (kept by the trim's rule: it touches a route)
  branches.push({ ways: list.map((x) => x.id), names: [...new Set(list.map((x) => x.name))], kinds: [...new Set(list.map((x) => x.kind))], m: L,
    root: root ? N(root).name : '', at: root ? [N(root).lat, N(root).lon] : [list[0].lat[0], list[0].lon[0]], why, ridden: rid, onRoute,
    fix: rid ? 'Keep: a route rides it (turns round here)' : 'Remove',
    lines: list.map((x) => Array.from({ length: x.n + 1 }, (_, i) => [+x.lat[i].toFixed(6), +x.lon[i].toFixed(6)])) });
}
writeFileSync(resolve(root, 'tools/.cache/pgh-stubs.json'), JSON.stringify(branches));
const sum = (f) => { const l = branches.filter(f); return `${l.length} (${(l.reduce((s, b) => s + b.m, 0) / 1000).toFixed(1)} km)`; };
console.log(`stubs: ${sum(() => true)} branches hang off the network · ridden ${sum((b) => b.ridden)}`);
for (const w of ['trimmed', 'tiny', 'osm']) console.log(`  ${w.padEnd(8)} ${sum((b) => b.why === w && !b.ridden)} to remove`);
console.log(`  by length (not ridden): < 30 m ${sum((b) => !b.ridden && b.m < 30)}, 30–100 m ${sum((b) => !b.ridden && b.m >= 30 && b.m < 100)}, 100–300 m ${sum((b) => !b.ridden && b.m >= 100 && b.m < 300)}, ≥ 300 m ${sum((b) => !b.ridden && b.m >= 300)}`);
