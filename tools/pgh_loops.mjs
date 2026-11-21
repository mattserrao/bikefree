// PGH's loops and appendages (user, 21 Nov: the "appendage" on the Point's trail — "these loops are all over the map,
// certainly GPX errors"). Shapes a real street or trail doesn't make, found in the ways' own lines:
//   loop    a way that starts and ends at the same junction, under 300 m (a lasso hung on the trail)
//   eye     two ways joining the same two junctions, the shorter under 200 m (a way drawn twice, a little ring)
//   knot    a way that comes back within 8 m of itself after ≥ 40 m along it (a curl in the line)
//   spike   a way that turns back on itself (> 150°) with arms under 40 m (an out-and-back drawn into the line)
//   squiggle a way that turns more than 540° in 100 m (zigzags)
// Each: where, how big, whether a route rides it, and the fix (drop it, or cut the curl/spike out of the line).
//   node tools/pgh_loops.mjs → tools/.cache/pgh-loops.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGraph } from '../js/graph.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const G = decodeGraph(json);
const ridden = new Set((json.presets || []).flatMap((p) => p.path.map((k) => k.slice(0, -1))));
const kx = 111320 * Math.cos((40.44 * Math.PI) / 180), ky = 110540;
const X = (e, i) => e.lon[i] * kx, Y = (e, i) => e.lat[i] * ky;
const line = (e, a = 0, b = e.n) => Array.from({ length: b - a + 1 }, (_, k) => [+e.lat[a + k].toFixed(6), +e.lon[a + k].toFixed(6)]);
const out = [];
const add = (kind, e, i, m, msg, fix, part) => out.push({ kind, id: e.id, name: e.name, wayKind: e.kind, at: [e.lat[i], e.lon[i]], m, ridden: ridden.has(e.id), msg, fix, line: line(e), part: part || null });

for (const e of G.edges) {
  const L = e.n * 10;
  if (e.from === e.to && L < 300) add('loop', e, Math.floor(e.n / 2), L, `${e.name}: ${/^8/.test(String(L)) ? "an" : "a"} ${L} m loop from and back to ${G.nodes.get(e.from).name}`, ridden.has(e.id) ? 'A route rides it: re-map the route past it, then drop it' : 'Drop it', line(e));
  // knots: the line comes back near itself (not a loop's own ends)
  if (e.from !== e.to) for (let i = 0; i <= e.n; i++) {
    let found = -1;
    for (let j = i + 4; j <= e.n; j++) if (Math.hypot(X(e, j) - X(e, i), Y(e, j) - Y(e, i)) < 8) { found = j; }
    if (found >= 0 && !(e.from === e.to && i === 0 && found === e.n)) {
      add('knot', e, Math.floor((i + found) / 2), (found - i) * 10, `${e.name}: curls ${(found - i) * 10} m round and back to within 8 m of itself`, 'Cut the curl out: the line goes straight from where it starts to where it ends', line(e, i, found));
      i = found;
    }
  }
  // spikes: a sharp reversal with short arms
  for (let i = 1; i < e.n; i++) {
    const a = Math.atan2(Y(e, i) - Y(e, i - 1), X(e, i) - X(e, i - 1)), b = Math.atan2(Y(e, i + 1) - Y(e, i), X(e, i + 1) - X(e, i));
    const d = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (d > (150 * Math.PI) / 180) {
      // arm: how far back along each side before the line gets 15 m away from the tip
      let k = 1; while (i - k >= 0 && i + k <= e.n && Math.hypot(X(e, i - k) - X(e, i + k), Y(e, i - k) - Y(e, i + k)) < 15) k++;
      if (k * 10 < 40 && i - k >= 0 && i + k <= e.n) { add('spike', e, i, k * 20, `${e.name}: turns back ${Math.round((d * 180) / Math.PI)}° — a ${k * 10} m out-and-back in the line`, 'Cut the spike out of the line', line(e, Math.max(0, i - k), Math.min(e.n, i + k))); i += k; }
    }
  }
  // squiggles: turning per 100 m
  for (let i = 1; i + 10 < e.n; i += 5) {
    let t = 0;
    for (let k = i; k < i + 10; k++) { const a = Math.atan2(Y(e, k) - Y(e, k - 1), X(e, k) - X(e, k - 1)), b = Math.atan2(Y(e, k + 1) - Y(e, k), X(e, k + 1) - X(e, k)); t += Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); }
    if (t > 3 * Math.PI) { add('squiggle', e, i + 5, 100, `${e.name}: turns ${Math.round((t * 180) / Math.PI)}° in 100 m`, 'Smooth the line (or drop it if it is a GPS scribble)', line(e, i - 1, i + 10)); i += 10; }
  }
}
// eyes: two ways between the same two junctions
const pairs = new Map();
for (const e of G.edges) if (e.from !== e.to) { const k = [e.from, e.to].sort().join('|'); (pairs.get(k) || pairs.set(k, []).get(k)).push(e); }
for (const es of pairs.values()) {
  if (es.length < 2) continue;
  es.sort((a, b) => a.n - b.n);
  const [a, b] = es;
  if (a.n * 10 >= 200) continue;
  // a way drawn twice runs beside the other all along (≤ 25 m apart); two streets round a block don't
  const apart = Math.max(...Array.from({ length: a.n + 1 }, (_, i) => Math.min(...Array.from({ length: b.n + 1 }, (_, j) => Math.hypot(X(a, i) - X(b, j), Y(a, i) - Y(b, j))))));
  if (apart > 25) continue;
  const drop = ridden.has(a.id) && !ridden.has(b.id) ? b : a;
  add('eye', drop, Math.floor(drop.n / 2), a.n * 10 + b.n * 10, `${a.name} & ${b.name}: two ways between the same junctions (${a.n * 10} m and ${b.n * 10} m) — a little ring, ${Math.round(apart)} m apart at most`, ridden.has(drop.id) ? 'Both ridden: keep the one the routes ride, re-map' : `Drop ${drop.name} (${drop.n * 10} m)`, line(drop));
}
writeFileSync(resolve(root, 'tools/.cache/pgh-loops.json'), JSON.stringify(out));
const c = {};
for (const o of out) { c[o.kind] ||= [0, 0]; c[o.kind][0]++; if (o.ridden) c[o.kind][1]++; }
console.log('loops & appendages:', Object.entries(c).map(([k, [n, r]]) => `${k} ${n} (${r} on a route)`).join(', '));
for (const k of Object.keys(c)) for (const o of out.filter((x) => x.kind === k).slice(0, 3)) console.log(`  ${k.padEnd(8)} ${o.msg} · ${o.at.map((v) => v.toFixed(5)).join(',')}`);
