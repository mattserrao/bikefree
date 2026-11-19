#!/usr/bin/env node
// Build a city's ride network (choose your turns) from a spec: tools/city/<id>-network.spec.json.
//
//   node tools/build_network.mjs [tools/city/pittsburgh-network.spec.json] [--check]
//
// Nodes are junctions given by lat/lon; the tool finds every pass of the loop's GPX through each one
// (on the app's 10 m samples) and splits the loop there into edges. Edges are keyed "FROM>TO" in the
// spec (names for each riding direction); presets are lists of edge traversals ("A>G+" forward,
// "A>G-" backward). Output: the network the app loads (js/network.js), format bikefree-network-1.
//
// Areas (PLAN 5.4): a spec with "areas" builds a network of areas (format bikefree-network-2). Each area is a
// catalog route of its own (its base line, scene and city data) with its own network fragment
// (tools/city/<city>-<area>.network.json: "nodes", "edges", and "presets" of its own); the city spec lists the
// areas, the shared "origin" and the presets that cross areas. A junction found on two areas' lines is a portal.
// An area's apron stretches (city data `routeAprons`: drawn, not ridden as its own edges) are matched to the
// edge of another area they run along. Edge keys must be unique across the city.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
const index = JSON.parse(read('routes/catalog.json'));   // (the catalog itself: tools/build_routes.mjs checks the network against it)
const REACH = 30;   // a pass is where the loop comes within this many metres of the node (a node's own "reachM" overrides it:
                    // a junction with a bridge deck passing overhead within 30 m, the GAP's GB under the Glenwood Bridge)

/** One area's line split at its junctions: { route, L, nodes (with passes), edges, ghosts, aprons }. */
function buildArea(area) {
  const item = index.find((r) => r.id === area.catalogId);
  if (!item || (area.base && item.file !== area.base)) throw new Error(`catalog entry ${area.catalogId} must ride ${area.base}`);
  const route = buildCatalogRoute(read(item.file), { ...item, routeId: item.id });
  // ghost stretches (a tour's repeats, tools/build_city.py): never a pass, never an edge; their ends are junctions
  // apron stretches (another area's edge, drawn here): the same, but drawn (PLAN 5.4)
  const sceneJson = item.scene ? JSON.parse(read(item.scene)) : null;
  const city = sceneJson?.cityData ? JSON.parse(read(sceneJson.cityData)) : {};
  const ghosts = city.routeGhosts || [], aprons = city.routeAprons || [];
  const inRange = (list) => (s) => list.some((g) => s > g.fromM + 5 && s < g.toM - 5);
  const inGhost = inRange(ghosts), inApron = inRange(aprons), skip = (s) => inGhost(s) || inApron(s);
  const L = route.turnS || route.total;
  const K = Math.round(L / 10);
  const closed = !!route.oneWay?.closedLoop || !route.mirrored;
  const at = (i) => ({ lat: route.lat[i], lon: route.lon[i] });
  const nodes = area.nodes.map((n) => ({ ...n }));
  const splits = [];
  for (const n of nodes) {
    // "at": "start" / "end": the route's own first / last point (an open tour's ends are junctions)
    if (n.at === 'start' || n.at === 'end') Object.assign(n, at(n.at === 'start' ? 0 : K));
    let run = null;
    const passes = [];
    const reach = n.reachM ?? REACH;
    for (let i = 0; i <= K; i++) {
      if (skip(i * 10)) { if (run) { passes.push(run.i); run = null; } continue; }
      const d = haversine(n, at(i));
      if (d < reach) { if (!run || d < run.d) run = { d, i }; if (!run.open) run.open = true; }
      else if (run) { passes.push(run.i); run = null; }
    }
    if (run) passes.push(run.i);
    // a closed loop's start and end are one point: a node there splits at 0 (and the loop closes at L);
    // an open tour (Pittsburgh's: the loop and the Jail Trail in one line) has a node at each end
    const list = [...new Set(passes.map((i) => (closed && i === K ? 0 : i)))];
    // a ghost's (or an apron's) ends at this junction are splits too (where the real pass turns into its repeat and back)
    for (const g of [...ghosts, ...aprons]) for (const s of [g.fromM, g.toM]) {
      const i = Math.round(s / 10);
      if (i <= K && haversine(n, at(i)) < reach && !list.some((k) => Math.abs(k - i) < 3)) list.push(i);
    }
    // passes a few samples apart (a ghost's end next to the real pass's end) are one
    list.sort((a, b) => a - b);
    for (let k = list.length - 1; k > 0; k--) if (list[k] - list[k - 1] < 3) list.splice(k, 1);
    if (!list.length) throw new Error(`node ${n.id}: the ${area.id || 'route'} line doesn't pass within ${reach} m`);
    n.passes = list.map((i) => i * 10);
    for (const s of n.passes) splits.push({ s, node: n.id });
  }
  splits.sort((a, b) => a.s - b.s);
  // the line's ends: nodes, unless the line starts (or ends) in an apron or a ghost
  const covered = (s) => [...ghosts, ...aprons].some((g) => s >= g.fromM - 5 && s <= g.toM + 5);
  if (splits[0].s !== 0 && !covered(0)) throw new Error('the route\'s start must be a node (the edges are split from it)');
  if (!closed && splits[splits.length - 1].s !== L && !covered(L)) throw new Error('an open route\'s end must be a node too');
  // passes that are really one junction crossed twice must sit at the same height
  for (const n of nodes) {
    const ele = n.passes.map((s) => route.ele[s / 10]);
    n.lat = +route.lat[n.passes[0] / 10].toFixed(6); n.lon = +route.lon[n.passes[0] / 10].toFixed(6);
    n.ele = +(ele.reduce((a, b) => a + b, 0) / ele.length).toFixed(2);
    n.eles = ele;
    const spread = Math.max(...ele) - Math.min(...ele);
    if (spread > 1.5) throw new Error(`node ${n.id}: passes differ by ${spread.toFixed(2)} m in height`);
  }
  const edges = [];
  for (let k = 0; k < splits.length; k++) {
    if (!closed && k === splits.length - 1) break;   // the end node of an open route
    const a = splits[k], b = splits[k + 1] || { s: L, node: splits[0].node };
    // a tour's repeat (a ghost) or another area's edge (an apron): not an edge here
    let inside = skip((a.s + b.s) / 2);
    for (let s = a.s + 10; !inside && s < b.s - 5; s += 10) inside = skip(s);
    if (inside) continue;
    const key = `${a.node}>${b.node}`;
    const names = area.edges[key];
    if (!names) throw new Error(`no names for edge ${key} in the spec${area.id ? ` (area ${area.id})` : ''}`);
    if (edges.some((e) => e.key === key)) throw new Error(`two edges ${key}: name them apart in the spec`);
    let up = 0, down = 0;
    for (let i = a.s / 10 + 1; i <= b.s / 10; i++) { const d = route.ele[i] - route.ele[i - 1]; if (d > 0) up += d; else down -= d; }
    // assisted conveyors (escalators: city data `routeConveyors`, line metres) on this edge, in its forward metres
    const conveyors = (city.routeConveyors || []).filter((c) => c.fromM >= a.s - 1 && c.toM <= b.s + 1)
      .map((c) => ({ u0: Math.max(0, c.fromM - a.s), u1: Math.min(b.s - a.s, c.toM - a.s), mps: c.mps, label: c.label }));
    edges.push({ key, from: a.node, to: b.node, s: [a.s, b.s], lengthM: b.s - a.s,
      climbM: [Math.round(up), Math.round(down)], name: names.name, toward: [names.fwd, names.rev], ...(conveyors.length ? { conveyors } : {}) });
  }
  return { area, item, route, L, nodes, edges, ghosts, aprons };
}

/** Presets: spec keys → edge ids, checked to lead on from step to step and close up. */
function buildPresets(list, edges) {
  return list.map((p) => {
    const path = p.path.map(trav(edges));
    // each step must leave from where the last one arrived, and the loop must close
    const ends = path.map((t) => { const e = edges.find((x) => x.id === t.slice(0, -1)); return t.endsWith('+') ? [e.from, e.to] : [e.to, e.from]; });
    for (let i = 0; i < ends.length; i++) if (ends[i][1] !== ends[(i + 1) % ends.length][0]) throw new Error(`preset ${p.id}: step ${i + 1} doesn't lead into step ${(i + 2 - 1) % ends.length + 1}`);
    const lengthM = path.reduce((s, t) => s + edges.find((x) => x.id === t.slice(0, -1)).lengthM, 0);
    const climbM = path.reduce((s, t) => { const e = edges.find((x) => x.id === t.slice(0, -1)); return s + e.climbM[t.endsWith('+') ? 0 : 1]; }, 0);
    return { ...p, path, lengthM, climbM };
  });
}
const trav = (edges) => (t) => {
  const m = /^(.+)([+-])$/.exec(t);
  const e = m && edges.find((x) => x.key === m[1]);
  if (!e) throw new Error(`preset step ${t}: no such edge`);
  return `${e.id}${m[2]}`;
};

// the free ride (no plan): where it starts, and (F25, F80) the way it prefers at a junction over the street's
// straight on — "prefer": {junction: traversal key}, e.g. {"LB": "N>LB-"}: from 40th & Butler over the 40th
// Street Bridge to Millvale; the way must leave that junction
const freeRideOut = (fr, edges) => {
  const out = { ...fr, first: trav(edges)(fr.first) };
  if (fr.prefer) {
    out.prefer = {};
    for (const [node, key] of Object.entries(fr.prefer)) {
      const t = trav(edges)(key), e = edges.find((x) => x.id === t.slice(0, -1));
      if ((t.endsWith('+') ? e.from : e.to) !== node) throw new Error(`freeRide.prefer ${node}: ${key} doesn't leave ${node}`);
      out.prefer[node] = t;
    }
  }
  return out;
};
let out;
if (!spec.areas) {
  // one base line (format 1)
  const A = buildArea({ catalogId: spec.catalogId, base: spec.base, nodes: spec.nodes, edges: spec.edges });
  const edges = A.edges.map((e, k) => ({ id: `e${k + 1}`, ...e }));
  out = {
    format: 'bikefree-network-1', id: spec.id, base: spec.base, legM: A.L,
    nodes: A.nodes.map(({ id, name, lat, lon, ele, passes, deadEnd }) => ({ id, name, lat, lon, ele, passes, ...(deadEnd ? { deadEnd } : {}) })),
    ...(A.ghosts.length ? { ghosts: A.ghosts } : {}),
    edges, presets: buildPresets(spec.presets, edges),
  };
  if (spec.freeRide) out.freeRide = freeRideOut(spec.freeRide, edges);
} else {
  // a network of areas (format 2)
  if (!spec.origin || !Number.isFinite(spec.origin.lat) || !Number.isFinite(spec.origin.lon)) throw new Error('a network of areas needs its city\'s "origin" (lat, lon)');
  const built = spec.areas.map((a) => {
    const frag = JSON.parse(read(a.spec));
    return { ...buildArea({ ...a, nodes: frag.nodes, edges: frag.edges }), presets: frag.presets || [] };
  });
  // edges: ids across the city, in area order; keys unique city-wide (saved routes keep them)
  const edges = [];
  for (const A of built) for (const e of A.edges) {
    if (edges.some((x) => x.key === e.key)) throw new Error(`edge ${e.key} is in two areas: an edge lives on one area`);
    edges.push({ id: `e${edges.length + 1}`, key: e.key, area: A.area.id, ...e });
  }
  // nodes: one per id; a node on two areas' lines is a portal (it must be the same junction: same place, same height)
  const nodes = new Map();
  for (const A of built) for (const n of A.nodes) {
    const prev = nodes.get(n.id);
    if (!prev) { nodes.set(n.id, { id: n.id, name: n.name, lat: n.lat, lon: n.lon, eles: [...n.eles], passes: { [A.area.id]: n.passes }, deadEnd: n.deadEnd }); continue; }
    if (prev.name !== n.name) throw new Error(`node ${n.id}: named "${prev.name}" and "${n.name}" in two areas`);
    const d = haversine(prev, n);
    if (d > 12) throw new Error(`node ${n.id}: ${d.toFixed(1)} m apart on the ${Object.keys(prev.passes)[0]} and ${A.area.id} lines`);
    prev.passes[A.area.id] = n.passes; prev.eles.push(...n.eles); prev.deadEnd ||= n.deadEnd;
  }
  for (const n of nodes.values()) {
    const spread = Math.max(...n.eles) - Math.min(...n.eles);
    if (spread > 1.5) throw new Error(`portal ${n.id}: its passes differ by ${spread.toFixed(2)} m in height across areas`);
    n.ele = +(n.eles.reduce((a, b) => a + b, 0) / n.eles.length).toFixed(2);
    for (const k of Object.keys(n.passes)) if (!edges.some((e) => e.area === k && (e.from === n.id || e.to === n.id))) {
      // on an area's line only through its aprons: a portal still (the other side's junction, drawn here)
    }
  }
  // aprons: which edge of another area each apron rides, which way, from which metre (by geometry: the apron's
  // samples lie on that edge's samples)
  const areasOut = built.map((A) => {
    const list = [];
    for (const ap of A.aprons) {
      const m = matchApron(A, ap, built, edges);
      if (!m) throw new Error(`area ${A.area.id}: the apron ${ap.fromM}–${ap.toM} m doesn't run along another area's edge`);
      list.push(m);
      // an apron through a portal of the other area (two of its junctions close together): on along its next edges
      for (let more = m; more && Math.floor(ap.toM / 10) * 10 - more.s[1] >= 50;) {
        more = matchApron(A, { fromM: more.s[1], toM: ap.toM }, built, edges);
        if (more) list.push(more);
      }
    }
    return { id: A.area.id, ...(A.area.name ? { name: A.area.name } : {}), catalogId: A.area.catalogId, base: A.item.file, legM: A.L, ...(A.ghosts.length ? { ghosts: A.ghosts } : {}), ...(list.length ? { aprons: list } : {}) };
  });
  out = {
    format: 'bikefree-network-2', id: spec.id, origin: spec.origin, areas: areasOut,
    nodes: [...nodes.values()].map(({ id, name, lat, lon, ele, passes, deadEnd }) => ({ id, name, lat, lon, ele, passes,
      ...(Object.keys(passes).length > 1 ? { portal: true } : {}), ...(deadEnd ? { deadEnd } : {}) })),
    edges: edges.map(({ id, key, area, from, to, s, lengthM, climbM, name, toward, conveyors }) => ({ id, key, area, from, to, s, lengthM, climbM, name, toward, ...(conveyors ? { conveyors } : {}) })),
    presets: buildPresets([...built.flatMap((A) => A.presets), ...(spec.presets || [])], edges),
  };
  if (spec.freeRide) out.freeRide = freeRideOut(spec.freeRide, edges);
}
// the city map's baked rivers and labels (F101: tools/build_city_map.py), for the city card and panel
if (spec.map) { if (!existsSync(resolve(root, spec.map))) throw new Error(`map ${spec.map}: run tools/build_city_map.py`); out.map = spec.map; }
// the key history (F40): every segment a new junction split, old key → its pieces in its own forward order, so a
// route saved before the split maps onto the way it rode (js/network.js keysToIds); a piece may itself have split later
if (spec.keySplits) {
  const keys = new Set(out.edges.map((e) => e.key));
  const expand = (k, depth = 0) => (keys.has(k) ? [k] : spec.keySplits[k] && depth < 8 ? spec.keySplits[k].flatMap((p) => expand(p, depth + 1)) : null);
  for (const [old, pieces] of Object.entries(spec.keySplits)) {
    if (keys.has(old)) throw new Error(`keySplits: ${old} is still a segment`);
    const flat = pieces.flatMap((p) => expand(p) || [p]);
    const missing = flat.filter((p) => !keys.has(p));
    if (missing.length) throw new Error(`keySplits: ${old} → ${missing.join(', ')} not a segment (add their own split)`);
    const ends = flat.map((p) => p.split('>'));
    if (ends[0][0] !== old.split('>')[0] || ends[ends.length - 1][1] !== old.split('>')[1] || ends.some((e, i) => i && e[0] !== ends[i - 1][1])) throw new Error(`keySplits: ${old} → ${flat.join(', ')} is not a chain from its start to its end`);
  }
  out.keySplits = spec.keySplits;
}

/**
 * An apron of area A ([fromM, toM] on its line) as {edge, dir, s: [s0, s1], u0}: the edge of another area whose
 * samples it runs along (within 3 m), the way it runs (+1 the edge's forward way), the stretch of A's line that
 * covers the edge, and the edge's forward metre at s0.
 */
function matchApron(A, ap, built, edges) {
  const pt = (r, s) => ({ lat: r.lat[Math.round(s / 10)], lon: r.lon[Math.round(s / 10)] });
  // (to the nearest sample: an apron that starts at a portal a few metres past a sample — a legs-built line, PLAN 5.5 —
  // must cover the path from the junction itself, or the area drawn flips at the portal)
  const s0 = Math.round(ap.fromM / 10) * 10, s1 = Math.round(ap.toM / 10) * 10;
  for (const e of edges) {
    if (e.area === A.area.id) continue;
    const B = built.find((x) => x.area.id === e.area);
    // the apron's first sample on the edge: its nearest edge sample
    const p = pt(A.route, s0 + 10);
    let best = null;
    for (let u = 0; u <= e.lengthM; u += 10) { const d = haversine(p, pt(B.route, e.s[0] + u)); if (!best || d < best.d) best = { d, u }; }
    if (best.d > 3) continue;
    // its way: the next apron sample 10 m on along the edge, forward or back
    const fwd = best.u + 10 <= e.lengthM ? haversine(pt(A.route, s0 + 20), pt(B.route, e.s[0] + best.u + 10)) : Infinity;
    const back = best.u - 10 >= 0 ? haversine(pt(A.route, s0 + 20), pt(B.route, e.s[0] + best.u - 10)) : Infinity;
    const dir = fwd <= back ? 1 : -1;
    const u0 = best.u - dir * 10;
    // as far as it runs along the edge (every sample within 3 m)
    let end = s0;
    for (let s = s0; s <= s1; s += 10) {
      const u = u0 + dir * (s - s0);
      if (u < 0 || u > e.lengthM || haversine(pt(A.route, s), pt(B.route, e.s[0] + u)) > 3) break;
      end = s;
    }
    if (end - s0 < 50) continue;
    return { edge: e.id, dir, s: [s0, end], u0 };
  }
  return null;
}

const text = `${JSON.stringify(out, null, 1)}\n`;
if (check) {
  if (read(spec.out) !== text) { console.error(`${spec.out} is out of date: run node tools/build_network.mjs ${specPath}`); process.exit(1); }
  console.log(`${spec.out} is up to date`);
} else {
  writeFileSync(resolve(root, spec.out), text);
  console.log(`${spec.out}: ${out.nodes.length} nodes, ${out.edges.length} edges, ${out.presets.length} presets${out.areas ? `, ${out.areas.length} areas` : ''}`);
  for (const e of out.edges) console.log(`  ${e.id} ${e.key}${e.area ? ` [${e.area}]` : ''} ${e.s[0]}–${e.s[1]} m (${(e.lengthM / 1000).toFixed(2)} km, +${e.climbM[0]} / −${e.climbM[1]} m) ${e.name}`);
  for (const a of out.areas || []) for (const ap of a.aprons || []) console.log(`  apron ${a.id} ${ap.s[0]}–${ap.s[1]} m on ${ap.edge}${ap.dir > 0 ? '+' : '-'} from ${ap.u0} m`);
  for (const p of out.presets) console.log(`  preset ${p.id}: ${p.path.join(' ')} · ${(p.lengthM / 1000).toFixed(1)} km · ${p.climbM} m`);
}
