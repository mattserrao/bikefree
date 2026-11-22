// Where PGH's streets meet, within the routes (user, 21 Nov: "look again at how streets intersect, especially where
// multiple come together; pruned and neatened"). Finds — nothing is changed:
//   short   two junctions joined by a way under 25 m (a split crossing, a jog) → merge them into one
//   cluster three or more junctions within 40 m of each other → one junction at their middle
//   acute   two ways leaving a junction under 25° apart (a slip, a fork drawn twice) → drop the minor, or share its first metres
//   triangle three junctions joined to each other, round trip under 200 m (a slip-lane triangle) → drop its minor side
//   busy    a junction of 5+ ways → drop minor ways down to 4
// "Within the routes": a junction on a ridden way or inside the area the routes draw (tools/pgh_usage.mjs).
//   node tools/pgh_junctions.mjs → tools/.cache/pgh-junctions.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeUse, routeArea } from './pgh_usage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const lines = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-routes.json'), 'utf8')).map((r) => r.line);
const { G, use } = routeUse(json, lines);
const inside = routeArea(lines);
const RANK = { path: 0, alley: 1, residential: 2, service: 1, tertiary: 3, secondary: 4, primary: 5 };
const kx = 111320 * Math.cos((40.44 * Math.PI) / 180), ky = 110540;
const N = new Map(json.nodes.map((n) => [n.id, n]));
const dist = (a, b) => Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * ky);
const at = new Map();
for (const e of G.edges) for (const [n, end] of [[e.from, 0], [e.to, 1]]) (at.get(n) || at.set(n, []).get(n)).push({ e, end });
const ridden = (e) => use.get(e.id) === 0;
const within = (n) => (at.get(n) || []).some((a) => ridden(a.e)) || inside(N.get(n).lat, N.get(n).lon);
const heading = ({ e, end }) => {   // leaving the junction, over its first ~15 m
  const i0 = end ? e.n : 0, i1 = end ? Math.max(0, e.n - 2) : Math.min(e.n, 2);
  return Math.atan2((e.lat[i1] - e.lat[i0]) * ky, (e.lon[i1] - e.lon[i0]) * kx);
};
const minor = (es) => es.slice().sort((a, b) => (ridden(a) - ridden(b)) || (RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2) || a.n - b.n)[0];
const lab = (e) => `${e.name} (${e.kind}, ${e.n * 10} m${ridden(e) ? ', a route rides it' : ''})`;
const P = (n) => [N.get(n).lat, N.get(n).lon];
const out = [];

// short links
for (const e of G.edges) {
  if (e.from === e.to || e.n * 10 >= 25 || !(within(e.from) || within(e.to))) continue;
  out.push({ kind: 'short', at: [(N.get(e.from).lat + N.get(e.to).lat) / 2, (N.get(e.from).lon + N.get(e.to).lon) / 2], nodes: [e.from, e.to], edges: [e.id],
    msg: `${e.name}: ${e.n * 10} m between two junctions`, fix: 'Merge the two junctions into one (the short way goes)', route: ridden(e) });
}
// clusters (3+ junctions within 40 m)
const done = new Set();
for (const n of json.nodes) {
  if (done.has(n.id) || !within(n.id)) continue;
  const near = json.nodes.filter((m) => dist(n, m) < 40);
  if (near.length < 3) continue;
  near.forEach((m) => done.add(m.id));
  const c = [near.reduce((s, m) => s + m.lat, 0) / near.length, near.reduce((s, m) => s + m.lon, 0) / near.length];
  const ways = new Set(near.flatMap((m) => (at.get(m.id) || []).map((a) => a.e.name)));
  out.push({ kind: 'cluster', at: c, nodes: near.map((m) => m.id), edges: [], msg: `${near.length} junctions within 40 m: ${[...ways].filter(Boolean).slice(0, 4).join(', ')}`,
    fix: 'Collapse to one junction at their middle', route: near.some((m) => (at.get(m.id) || []).some((a) => ridden(a.e))) });
}
// acute splits and busy junctions
for (const [n, arms] of at) {
  if (!within(n)) continue;
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    const a = arms[i], b = arms[j];
    if (a.e === b.e) continue;
    const d = Math.abs(((heading(a) - heading(b) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (d < (25 * Math.PI) / 180) {
      const m = minor([a.e, b.e]);
      out.push({ kind: 'acute', at: P(n), nodes: [n], edges: [a.e.id, b.e.id], msg: `${a.e.name} & ${b.e.name} leave ${Math.round((d * 180) / Math.PI)}° apart`,
        fix: ridden(m) ? 'Both ridden: share the first metres (one way that forks further out)' : `Drop ${lab(m)}`, route: ridden(a.e) || ridden(b.e), cut: ridden(m) ? null : m.id });
    }
  }
  const ways = new Set(arms.map((a) => a.e.id));
  if (ways.size >= 5) {
    const drop = arms.map((a) => a.e).filter((e, k, all) => all.indexOf(e) === k && !ridden(e)).sort((x, y) => (RANK[x.kind] ?? 2) - (RANK[y.kind] ?? 2) || x.n - y.n).slice(0, ways.size - 4);
    out.push({ kind: 'busy', at: P(n), nodes: [n], edges: [...ways], msg: `${ways.size} ways meet: ${[...new Set(arms.map((a) => a.e.name))].slice(0, 5).join(', ')}`,
      fix: drop.length ? `Drop ${drop.map(lab).join('; ')}` : 'All ridden: leave', route: arms.some((a) => ridden(a.e)), cut: drop[0]?.id });
  }
}
// triangles
const nb = new Map();
for (const e of G.edges) if (e.from !== e.to) { (nb.get(e.from) || nb.set(e.from, new Map()).get(e.from)).set(e.to, e); (nb.get(e.to) || nb.set(e.to, new Map()).get(e.to)).set(e.from, e); }
const seenT = new Set();
for (const [a, ma] of nb) for (const [b, eab] of ma) for (const [c, ebc] of nb.get(b)) {
  if (c === a || !ma.has(c)) continue;
  const key = [a, b, c].sort().join(); if (seenT.has(key)) continue; seenT.add(key);
  const es = [eab, ebc, ma.get(c)], per = es.reduce((s, e) => s + e.n * 10, 0);
  if (per >= 200 || ![a, b, c].some(within)) continue;
  const m = minor(es);
  out.push({ kind: 'triangle', at: [(N.get(a).lat + N.get(b).lat + N.get(c).lat) / 3, (N.get(a).lon + N.get(b).lon + N.get(c).lon) / 3], nodes: [a, b, c], edges: es.map((e) => e.id),
    msg: `A ${per} m triangle: ${[...new Set(es.map((e) => e.name))].join(', ')}`, fix: ridden(m) ? 'All sides ridden: merge into one junction' : `Drop ${lab(m)}`, route: es.some(ridden), cut: ridden(m) ? null : m.id });
}
const count = {};
for (const o of out) count[o.kind] = (count[o.kind] || 0) + 1;
writeFileSync(resolve(root, 'tools/.cache/pgh-junctions.json'), JSON.stringify(out));
const jw = json.nodes.filter((n) => within(n.id)).length;
const touched = new Set(out.flatMap((o) => o.nodes)).size;
console.log(`junctions within the routes: ${jw} of ${json.nodes.length}; findings:`, count, `· ${touched} junctions involved`);
