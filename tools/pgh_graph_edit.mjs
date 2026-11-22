// Editing PGH's graph after the build (tools/prune_pgh.mjs, tools/neaten_pgh.mjs): load the edges as plain arrays,
// change them, join through junctions left with two ways, write them back delta-coded like tools/build_pgh.py.
import { decodeGraph } from '../js/graph.js';

const STEP = 10;
export const KX = 111320 * Math.cos((40.44 * Math.PI) / 180), KY = 110540;
export const RANK = { path: 0, alley: 1, service: 1, residential: 2, tertiary: 3, secondary: 4, primary: 5 };

/** { nodes: Map(id → node), E: [{ id, from, to, name, kind, lat[], lon[], ele[], br[] }] } */
export function load(json) {
  const G = decodeGraph(json);
  const nodes = new Map(json.nodes.map((n) => [n.id, { ...n }]));
  const E = G.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, name: e.name, kind: e.kind, lat: [...e.lat], lon: [...e.lon], ele: [...e.ele],
    br: Array.from({ length: e.n + 1 }, (_, i) => e.bridges.some(([a, b]) => i > a && i < b)) }));   // (decks are written padded by one)
  return { nodes, E };
}

export const len = (e) => { let s = 0; for (let i = 1; i < e.lat.length; i++) s += Math.hypot((e.lon[i] - e.lon[i - 1]) * KX, (e.lat[i] - e.lat[i - 1]) * KY); return s; };
export const dist = (a, b) => Math.hypot((a.lon - b.lon) * KX, (a.lat - b.lat) * KY);

/** Every edge's samples back on 10 m steps (after its ends moved). */
export function resample(e) {
  const d = [0];
  for (let i = 1; i < e.lat.length; i++) d.push(d[i - 1] + Math.hypot((e.lon[i] - e.lon[i - 1]) * KX, (e.lat[i] - e.lat[i - 1]) * KY));
  const L = d[d.length - 1], n = Math.max(1, Math.round(L / STEP));
  const lat = [], lon = [], ele = [], br = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * L;
    while (j < d.length - 2 && d[j + 1] < s) j++;
    const t = d[j + 1] > d[j] ? (s - d[j]) / (d[j + 1] - d[j]) : 0;
    lat.push(e.lat[j] + (e.lat[j + 1] - e.lat[j]) * t); lon.push(e.lon[j] + (e.lon[j + 1] - e.lon[j]) * t); ele.push(e.ele[j] + (e.ele[j + 1] - e.ele[j]) * t);
    br.push(t < 0.5 ? e.br[j] : e.br[j + 1]);
  }
  br[0] = br[n] = false;
  Object.assign(e, { lat, lon, ele, br });
}

/** Move an edge's end (0: start, 1: end) onto a junction, easing the shift (and the height) out over `reach` metres. */
export function moveEnd(e, end, node, reach = 40) {
  reach = Math.min(reach, len(e) / 2);   // (a short way: each end eases over its own half)
  const idx = (i) => (end ? e.lat.length - 1 - i : i);
  const i0 = idx(0), dla = node.lat - e.lat[i0], dlo = node.lon - e.lon[i0], dh = node.ele - e.ele[i0];
  let s = 0;
  for (let i = 0; i < e.lat.length; i++) {
    if (i) s += Math.hypot((e.lon[idx(i)] - e.lon[idx(i - 1)]) * KX, (e.lat[idx(i)] - e.lat[idx(i - 1)]) * KY);
    const w = Math.max(0, 1 - s / reach), f = w * w * (3 - 2 * w);   // smoothstep
    if (f <= 0) break;
    e.lat[idx(i)] += dla * f; e.lon[idx(i)] += dlo * f; e.ele[idx(i)] += dh * f;
  }
  e.lat[i0] = node.lat; e.lon[i0] = node.lon; e.ele[i0] = node.ele;
}

/** Join through junctions with exactly two ways (not those in `keep`); returns the new edge list. */
export function joinThrough(E, keep = new Set()) {
  for (let changed = true; changed;) {
    changed = false;
    const at = new Map();
    E.forEach((e, k) => { for (const n of [e.from, e.to]) (at.get(n) || at.set(n, []).get(n)).push(k); });
    const dead = new Set();
    for (const [n, ks] of at) {
      if (ks.length !== 2 || keep.has(n) || ks[0] === ks[1] || dead.has(ks[0]) || dead.has(ks[1])) continue;
      let [a, b] = ks.map((k) => E[k]);
      if (a.from === a.to || b.from === b.to) continue;
      const rev = (e) => ({ ...e, from: e.to, to: e.from, lat: e.lat.slice().reverse(), lon: e.lon.slice().reverse(), ele: e.ele.slice().reverse(), br: e.br.slice().reverse() });
      if (a.to !== n) a = rev(a);
      if (b.from !== n) b = rev(b);
      const m = { ...(a.lat.length >= b.lat.length ? a : b), from: a.from, to: b.to, ridden: !!(a.ridden || b.ridden),
        lat: a.lat.concat(b.lat.slice(1)), lon: a.lon.concat(b.lon.slice(1)), ele: a.ele.concat(b.ele.slice(1)), br: a.br.concat(b.br.slice(1)) };
      E[ks[0]] = m; dead.add(ks[1]); changed = true;
    }
    E = E.filter((_, k) => !dead.has(k));
  }
  return E;
}

/** Ways at each junction. */
export function arms(E) {
  const at = new Map();
  for (const e of E) for (const n of [e.from, e.to]) (at.get(n) || at.set(n, []).get(n)).push(e);
  return at;
}

/** Can `e` go: both its junctions keep ≥ 2 other ways and the network stays in one piece. */
export function canRemove(E, e, at = arms(E)) {
  if (e.from !== e.to && ((at.get(e.from)?.length ?? 0) < 3 || (at.get(e.to)?.length ?? 0) < 3)) return false;
  if (e.from === e.to) return true;
  // still joined without it?
  const seen = new Set([e.from]), q = [e.from];
  while (q.length) {
    const x = q.pop();
    if (x === e.to) return true;
    for (const o of at.get(x) || []) {
      if (o === e) continue;
      const y = o.from === x ? o.to : o.from;
      if (!seen.has(y)) { seen.add(y); q.push(y); }
    }
  }
  return false;
}

/** Write the edges back (renumbered) and the junctions still used. Routes must be mapped again after. */
export function save(json, nodes, E) {
  const used = new Set(E.flatMap((e) => [e.from, e.to]));
  const d = (a) => a.map((v, i) => (i ? v - a[i - 1] : v));
  const kl = json.unit?.latlon ?? 1e-6, ke = json.unit?.ele ?? 0.1;
  json.nodes = [...nodes.values()].filter((n) => used.has(n.id)).map((n) => ({ id: n.id, name: n.name, lat: +n.lat.toFixed(6), lon: +n.lon.toFixed(6), ele: +n.ele.toFixed(1) }));
  E.sort((x, y) => (x.from === y.from ? (x.to < y.to ? -1 : 1) : x.from < y.from ? -1 : 1));
  json.edges = E.map((e, i) => {
    const n = e.lat.length - 1;
    const rec = { id: `e${i}`, from: e.from, to: e.to, name: e.name, kind: e.kind,
      lat: d(e.lat.map((v) => Math.round(v / kl))), lon: d(e.lon.map((v) => Math.round(v / kl))), ele: d(e.ele.map((v) => Math.round(v / ke))) };
    const runs = [];
    for (let k = 0; k <= n;) {
      if (!e.br[k]) { k++; continue; }
      let j = k; while (j + 1 <= n && e.br[j + 1]) j++;
      runs.push([Math.max(0, k - 1), Math.min(n, j + 1)]); k = j + 1;
    }
    if (runs.length) rec.bridges = runs;
    return rec;
  });
  delete json.presets;
  delete json._decoded;
  return json;
}
