// Rideability QC for a free-ride road graph (PGH: tools/build_pgh.py → routes/cities/pgh.json).
//
//   node tools/qc_pgh.mjs                     # routes/cities/pgh.json
//   node tools/qc_pgh.mjs <graph.json> [--rides 40] [--km 25] [--json] [--list 30]
//
// Fails (the graph is not rideable as drawn):
//   structure   an edge to a junction that doesn't exist, an edge shorter than one 10 m step, NaN data
//   connected   a junction you can't reach from the start (every edge rides both ways, so one piece = all reachable)
//   end-gap     an edge's end more than 1.5 m from its junction (the ride would jump there)
//   end-step    an edge's end height more than 0.5 m off its junction's (a step at the junction)
//   gap         two samples of an edge more than 15 m apart (a jump along the way)
//   grade       steeper than 40 % over 10 m
//   ways        at a junction, a way out not offered when arriving from some way in (every way through every
//               junction is checked: arriving on each arm, every arm — back included — must be an option)
//   ride        a simulated ride (random turns) whose path route jumps (> 15 m between 10 m samples) or steps
//               (> 5 m between samples)
// Warnings (rideable, worth a look): grade over 32 %, a crossing of two edges at nearly the same height with no
// junction (you can't turn there; the two roads overlap), dead ends (you turn round there: info).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphNetwork } from '../js/graph.js';
import { loadNetwork, makePathRoute, optionsAt, travKey, endNode } from '../js/network.js';
import { haversine } from '../js/gpx.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a) => a.endsWith('.json')) || 'routes/cities/pgh.json';

export function qcGraph(json, { rides = 40, km = 25, seed = 1 } = {}) {
  const fails = [], warns = [], info = [];
  const F = (check, where, msg) => fails.push({ check, ...where, msg });
  const W = (check, where, msg) => warns.push({ check, ...where, msg });
  const { base, network, graph: G } = graphNetwork(json);
  const nodes = G.nodes;
  // structure, ends, gaps, grades
  for (const e of G.edges) {
    const at = { edge: e.id, name: e.name };
    if (!nodes.has(e.from) || !nodes.has(e.to)) { F('structure', at, 'edge to a missing junction'); continue; }
    if (e.n < 1) F('structure', at, 'shorter than 10 m');
    for (let i = 0; i <= e.n; i++) if (!Number.isFinite(e.lat[i] + e.lon[i] + e.ele[i])) { F('structure', at, `NaN at sample ${i}`); break; }
    for (const [end, i] of [[nodes.get(e.from), 0], [nodes.get(e.to), e.n]]) {
      const d = haversine({ lat: e.lat[i], lon: e.lon[i] }, end);
      if (d > 1.5) F('end-gap', { ...at, lat: end.lat, lon: end.lon }, `${d.toFixed(1)} m from ${end.name}`);
      const dh = Math.abs(e.ele[i] - end.ele);
      if (dh > 0.5) F('end-step', { ...at, lat: end.lat, lon: end.lon }, `${dh.toFixed(2)} m off ${end.name}'s height`);
    }
    let steep = 0, where = 0;
    for (let i = 1; i <= e.n; i++) {
      const d = haversine({ lat: e.lat[i - 1], lon: e.lon[i - 1] }, { lat: e.lat[i], lon: e.lon[i] });
      if (d > 15) F('gap', { ...at, lat: e.lat[i], lon: e.lon[i] }, `${d.toFixed(1)} m between samples ${i - 1} and ${i}`);
      const g = Math.abs(e.ele[i] - e.ele[i - 1]) / 10 * 100;   // (the ride's grade: samples are 10 m apart along the way; a hairpin's chord is shorter)
      if (g > steep) { steep = g; where = i; }
    }
    if (steep > 40) F('grade', { ...at, lat: e.lat[where], lon: e.lon[where] }, `${steep.toFixed(0)} % grade`);
    else if (steep > 32) W('grade', { ...at, lat: e.lat[where], lon: e.lon[where] }, `${steep.toFixed(0)} % grade`);
  }
  // connected
  const adj = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const e of G.edges) { adj.get(e.from)?.push(e.to); adj.get(e.to)?.push(e.from); }
  const start = G.byId.get(network.freeRide.first.replace(/[+-]$/, '')).from;
  const seen = new Set([start]), stack = [start];
  while (stack.length) for (const y of adj.get(stack.pop())) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  for (const id of nodes.keys()) if (!seen.has(id)) { const n = nodes.get(id); F('connected', { node: id, lat: n.lat, lon: n.lon }, `${n.name} can't be reached from the start`); }
  // every way through every junction
  const net = loadNetwork(network, base);
  let ways = 0, deadEnds = 0;
  for (const n of net.nodes.values()) {
    if (n.arms.length === 1) { deadEnds++; info.push({ check: 'dead-end', node: n.id, lat: n.lat, lon: n.lon, msg: `${n.name}: dead end (turn round)` }); }
    for (const arm of n.arms) {
      const tin = { e: arm.e, dir: -arm.dir };   // arriving along this arm
      if (endNode(tin) !== n.id) { F('ways', { node: n.id, lat: n.lat, lon: n.lon }, 'arm direction mixed up'); continue; }
      const opts = optionsAt(net, tin), keys = new Set(opts.map((o) => o.key));
      for (const out of n.arms) {
        ways++;
        const k = travKey({ e: out.e, dir: out.dir });
        if (!keys.has(k)) F('ways', { node: n.id, lat: n.lat, lon: n.lon }, `arriving on ${arm.e.name}, ${out.e.name} (${k}) isn't offered`);
      }
      if (opts.some((o) => !Number.isFinite(o.angle) || !Number.isFinite(o.turn))) F('ways', { node: n.id, lat: n.lat, lon: n.lon }, 'a turn angle is not a number');
    }
  }
  // simulated rides: random turns at every junction, the path route must run on without jumps
  let rnd = seed >>> 0;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 2 ** 32; };
  const edgeIds = [...net.edges.keys()];
  let rideKm = 0, covered = new Set();
  for (let r = 0; r < rides; r++) {
    const first = `${edgeIds[Math.floor(rand() * edgeIds.length)]}${rand() < 0.5 ? '+' : '-'}`;
    const route = makePathRoute(net, { id: 'qc', name: 'qc', path: null, first });
    const ride = route.netRide;
    for (let p = 0; p < km * 1000; p += 10) {
      const up = ride.upcoming(p);
      if (up.distTo > 40 && up.distTo < 50 && !up.locked && rand() < 0.6) {
        const o = up.options[Math.floor(rand() * up.options.length)];
        if (o.key !== up.options[up.selected]?.key) ride.pick(o.key, p);
      }
      ride.update(p);
    }
    for (const x of ride.entries) if (x.p0 < km * 1000) covered.add(travKey(x.t));
    const R = ride.route, end = Math.min(R.dist.length - 1, km * 100);
    for (let i = 1; i <= end; i++) {
      const d = haversine({ lat: R.lat[i - 1], lon: R.lon[i - 1] }, { lat: R.lat[i], lon: R.lon[i] });
      const dh = Math.abs(R.ele[i] - R.ele[i - 1]);
      if (d > 15 || dh > 5) { F('ride', { lat: R.lat[i], lon: R.lon[i] }, `ride ${r + 1} (from ${first}): ${d.toFixed(1)} m / ${dh.toFixed(1)} m between path samples at ${(i / 100).toFixed(2)} km`); break; }
    }
    rideKm += end / 100;
  }
  // crossings with no junction at nearly the same height (overlapping roads you can't turn between)
  const cell = 40, grid = new Map(), kx = 111320 * Math.cos((json.origin.lat * Math.PI) / 180), ky = 110540;
  const segs = [];
  for (const e of G.edges) for (let i = 0; i < e.n; i++) {
    const s = { e, i, x0: e.lon[i] * kx, y0: e.lat[i] * ky, x1: e.lon[i + 1] * kx, y1: e.lat[i + 1] * ky };
    segs.push(s);
    const key = `${Math.floor((s.x0 + s.x1) / 2 / cell)},${Math.floor((s.y0 + s.y1) / 2 / cell)}`;
    (grid.get(key) || grid.set(key, []).get(key)).push(s);
  }
  const cross = (a, b) => {
    const d = (b.x1 - b.x0) * (a.y1 - a.y0) - (b.y1 - b.y0) * (a.x1 - a.x0);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((b.x0 - a.x0) * (b.y1 - b.y0) - (b.y0 - a.y0) * (b.x1 - b.x0)) / -d;
    const u = ((b.x0 - a.x0) * (a.y1 - a.y0) - (b.y0 - a.y0) * (a.x1 - a.x0)) / -d;
    return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98 ? { t, u } : null;
  };
  const crossings = new Map();
  for (const a of segs) {
    const cx = Math.floor((a.x0 + a.x1) / 2 / cell), cy = Math.floor((a.y0 + a.y1) / 2 / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of grid.get(`${cx + i},${cy + j}`) || []) {
      if (b.e === a.e || a.e.id > b.e.id) continue;
      if (a.e.from === b.e.from || a.e.from === b.e.to || a.e.to === b.e.from || a.e.to === b.e.to) continue;
      const c = cross(a, b);
      if (!c) continue;
      const ha = a.e.ele[a.i] + (a.e.ele[a.i + 1] - a.e.ele[a.i]) * c.t, hb = b.e.ele[b.i] + (b.e.ele[b.i + 1] - b.e.ele[b.i]) * c.u;
      if (Math.abs(ha - hb) > 3) continue;   // one passes over the other
      const key = `${a.e.id}×${b.e.id}`;
      if (!crossings.has(key)) crossings.set(key, { check: 'crossing', edge: a.e.id, name: `${a.e.name} × ${b.e.name}`, lat: (a.y0 + (a.y1 - a.y0) * c.t) / ky, lon: (a.x0 + (a.x1 - a.x0) * c.t) / kx, msg: `cross ${Math.abs(ha - hb).toFixed(1)} m apart in height, no junction` });
    }
  }
  warns.push(...crossings.values());
  const km_ = G.edges.reduce((s, e) => s + e.n * 10, 0) / 1000;
  const summary = { junctions: nodes.size, edges: G.edges.length, km: +km_.toFixed(1), waysChecked: ways, deadEnds,
    rides, rideKm: +rideKm.toFixed(1), traversalsRidden: covered.size, fails: fails.length, warns: warns.length };
  return { summary, fails, warns, info };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  const t0 = performance.now();
  const r = qcGraph(json, { rides: +opt('--rides', 40), km: +opt('--km', 25) });
  const list = +opt('--list', 20);
  const S = r.summary;
  console.log(`${json.name}: ${S.junctions} junctions, ${S.edges} edges, ${S.km} km · ${S.waysChecked} ways through junctions checked · ${S.deadEnds} dead ends · ${S.rides} simulated rides, ${S.rideKm} km (${S.traversalsRidden} edge-ways) · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const by = (arr) => Object.entries(arr.reduce((m, x) => ((m[x.check] = (m[x.check] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  console.log(`FAIL ${r.fails.length}: ${by(r.fails)}`);
  for (const f of r.fails.slice(0, list)) console.log(`  ✗ ${f.check} ${f.edge || f.node || ''} ${f.name || ''} — ${f.msg} (${f.lat?.toFixed(5)}, ${f.lon?.toFixed(5)})`);
  console.log(`WARN ${r.warns.length}: ${by(r.warns)}`);
  for (const w of r.warns.slice(0, Math.min(list, 10))) console.log(`  ! ${w.check} ${w.edge || ''} ${w.name || ''} — ${w.msg} (${w.lat?.toFixed(5)}, ${w.lon?.toFixed(5)})`);
  if (args.includes('--json')) { writeFileSync(resolve(root, 'tools/qc-pgh-report.json'), JSON.stringify(r, null, 1)); console.log('wrote tools/qc-pgh-report.json'); }
  process.exitCode = r.fails.length ? 1 : 0;
}
