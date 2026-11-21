// Take out the PGH ways the Pittsburgh routes don't use (user, 21 Nov): every way that touches no route and lies
// outside the area the routes draw (tools/pgh_usage.mjs, class 2). Ridden ways, the streets touching them and the
// ways inside the routes' area stay. Junctions left with two ways are joined through (a junction is a choice);
// edges are numbered again, so run tools/map_pgh_routes.mjs --write after this (npm run pgh:build does).
//
//   node tools/prune_pgh.mjs        (reads routes/cities/pgh.json + tools/.cache/pgh-routes.json; writes pgh.json and
//                                    tools/.cache/pgh-pruned.json, the removed ways for the review map)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeUse } from './pgh_usage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(file, 'utf8'));
const lines = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-routes.json'), 'utf8')).map((r) => r.line);
if (!json.presets?.length) throw new Error('pgh.json has no routes yet: run tools/map_pgh_routes.mjs --write first');
const { G, use } = routeUse(json, lines);

const gone = G.edges.filter((e) => use.get(e.id) === 2);
let E = G.edges.filter((e) => use.get(e.id) !== 2).map((e) => ({ ...e, lat: [...e.lat], lon: [...e.lon], ele: [...e.ele],
  br: Array.from({ length: e.n + 1 }, (_, i) => e.bridges.some(([a, b]) => i > a && i < b)) }));   // (tools/build_pgh.py writes a deck's points padded by one)

// join through junctions left with two ways — not where a route turns round (a there-and-back's far end needs its junction)
const turns = new Set();
const byId = new Map(G.edges.map((e) => [e.id, e]));
for (const p of json.presets) {   // (…nor where a route starts and closes its loop)
  const e = byId.get(p.path[0].slice(0, -1)); turns.add(p.path[0].endsWith('+') ? e.from : e.to);
}
for (const p of json.presets) for (let i = 0; i < p.path.length; i++) {
  const a = p.path[i], b = p.path[(i + 1) % p.path.length];
  if (a.slice(0, -1) === b.slice(0, -1) && a !== b) { const e = byId.get(a.slice(0, -1)); turns.add(a.endsWith('+') ? e.to : e.from); }
}
for (let changed = true; changed;) {
  changed = false;
  const at = new Map();
  E.forEach((e, k) => { for (const n of [e.from, e.to]) (at.get(n) || at.set(n, []).get(n)).push(k); });
  const dead = new Set();
  for (const [n, ks] of at) {
    if (ks.length !== 2 || turns.has(n) || ks[0] === ks[1] || dead.has(ks[0]) || dead.has(ks[1])) continue;
    let [a, b] = ks.map((k) => E[k]);
    if (a.from === a.to || b.from === b.to) continue;
    const rev = (e) => ({ ...e, from: e.to, to: e.from, lat: e.lat.slice().reverse(), lon: e.lon.slice().reverse(), ele: e.ele.slice().reverse(), br: e.br.slice().reverse() });
    if (a.to !== n) a = rev(a);
    if (b.from !== n) b = rev(b);
    const L = (e) => e.lat.length;
    const m = { ...(L(a) >= L(b) ? a : b), from: a.from, to: b.to,
      lat: a.lat.concat(b.lat.slice(1)), lon: a.lon.concat(b.lon.slice(1)), ele: a.ele.concat(b.ele.slice(1)), br: a.br.concat(b.br.slice(1)) };
    m.n = m.lat.length - 1;
    E[ks[0]] = m; dead.add(ks[1]); changed = true;
  }
  E = E.filter((_, k) => !dead.has(k));
}

// write: junctions still used, edges numbered again (delta-coded like tools/build_pgh.py)
const used = new Set(E.flatMap((e) => [e.from, e.to]));
const d = (a) => a.map((v, i) => (i ? v - a[i - 1] : v));
const kl = json.unit?.latlon ?? 1e-6, ke = json.unit?.ele ?? 0.1;
json.nodes = json.nodes.filter((n) => used.has(n.id));
E.sort((x, y) => (x.from === y.from ? (x.to < y.to ? -1 : 1) : x.from < y.from ? -1 : 1));
json.edges = E.map((e, i) => {
  const rec = { id: `e${i}`, from: e.from, to: e.to, name: e.name, kind: e.kind,
    lat: d(e.lat.map((v) => Math.round(v / kl))), lon: d(e.lon.map((v) => Math.round(v / kl))), ele: d(e.ele.map((v) => Math.round(v / ke))) };
  const runs = [];
  for (let k = 0; k <= e.n;) {
    if (!e.br[k]) { k++; continue; }
    let j = k; while (j + 1 <= e.n && e.br[j + 1]) j++;
    runs.push([Math.max(0, k - 1), Math.min(e.n, j + 1)]); k = j + 1;
  }
  if (runs.length) rec.bridges = runs;
  return rec;
});
delete json.presets;   // (edge ids changed: map the routes again)
writeFileSync(file, JSON.stringify(json));
writeFileSync(resolve(root, 'tools/.cache/pgh-pruned.json'), JSON.stringify({ ways: gone.map((e) => ({ name: e.name, kind: e.kind, L: e.n * 10,
  line: Array.from({ length: e.n + 1 }, (_, i) => [+e.lat[i].toFixed(6), +e.lon[i].toFixed(6)]) })) }));
const km = (es) => (es.reduce((s, e) => s + e.n * 10, 0) / 1000).toFixed(0);
console.log(`pruned PGH: removed ${gone.length} ways (${km(gone)} km) no route touches, outside the routes' area → ${json.nodes.length} junctions, ${E.length} edges, ${km(E)} km`);
