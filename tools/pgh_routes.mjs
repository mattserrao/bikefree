// PGH's routes (user, 22 Nov: "Redo all bike routes on PGH. Define about five high quality ones"): a few rides worth
// doing, each laid out by its waypoints — named junctions and places — and joined by the best bike way between them
// over PGH's own graph (trails first, then quiet streets; never the wrong way down a one-way street; a way already
// ridden on the lap avoided, so a loop doesn't fold back on itself).
//
//   node tools/pgh_routes.mjs [--write] [--only <id>]
//
// Prints each route: its length, climb, the ways it rides (in order, merged by name) and its checks (closes, no
// U-turn, no way ridden twice, no wrong-way one-way). --write: the routes become routes/cities/pgh.json's "presets"
// and routes/cities/pgh-presets.json (the app's list), replacing the 48 mapped from the Pittsburgh network.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGraph, graphNetwork } from '../js/graph.js';
import { loadNetwork, makePathRoute, planCloses } from '../js/network.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pghPath = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(pghPath, 'utf8'));
const city = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh-city.json'), 'utf8'));
const G = decodeGraph(json);
const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// ---------------------------------------------------------------- the routes
// A waypoint: { near: [lat, lon] } — the junction nearest the spot (by position, not node id: ids change when PGH
// is rebuilt); { near, on: street } — the junction on that street nearest it; { at: [street, street], near } — the
// two's junction. `prefer`: ways to favour on the way to it (by name); `avoid`: ways to keep off (by name or edge id).
const TRAILS = ['Trail', 'Three Rivers Heritage Trail', 'North Shore Trail', 'Strip District Trail', 'Eliza Furnace Trail', 'South Side Trail',
  'Station Square Trail', 'Great Allegheny Passage', 'Hot Metal Bike/Pedestrian Bridge', 'Junction Hollow Trail', 'Fort Duquesne Bridge'];
const ROUTES = [
  {
    id: 'pgh-three-rivers', name: 'Three Rivers Loop', tags: ['flat', 'trail', 'classic'],
    note: 'The Three Rivers Heritage Trail from the Point: along the Mon and over the Smithfield Street Bridge to Station Square, through the South Side to the Hot Metal Bridge, back into town on the Eliza Furnace Trail, then along the Allegheny and round the Point',
    prefer: TRAILS,
    way: [
      { near: [40.44023, -80.00700] },                                                                   // the Point (its Mon side)
      { near: [40.43219, -80.00377], prefer: ['Fort Pitt Boulevard', 'Three Rivers Heritage Trail'] },   // along the Mon, over the Smithfield Street Bridge
      { near: [40.42720, -79.96244] }, { near: [40.42971, -79.95838] },                                                          // the South Side; the Hot Metal Bridge
      { near: [40.43472, -79.99688] },                                                                   // the Eliza Furnace Trail into town
      { near: [40.44422, -80.00323] },                                                                   // through town to the Allegheny
      { near: [40.44023, -80.00700] },                                                                   // round the Point
    ],
  },
  {
    id: 'pgh-mt-washington', name: 'Mount Washington', tags: ['hilly', 'views', 'climb'],
    note: 'From Station Square along East Carson Street and up P J McArdle Roadway onto Mount Washington, along Grandview Avenue past the overlooks above the Point, over the top through Allentown and down Brosville Street to the South Side, home on its back streets',
    way: [
      { near: [40.43133, -80.00158] },                                                                   // Station Square
      { near: [40.42713, -79.98975], prefer: ['East Carson Street'] },                         // along East Carson to the roadway
      { near: [40.43536, -80.01297], prefer: ['P J McArdle Roadway'] },                        // the climb, the whole roadway
      { near: [40.43064, -80.00637], prefer: ['Grandview Avenue'] },                           // Grandview Avenue's overlooks
      { near: [40.42181, -79.99252], prefer: ['Wyoming Street', 'Bailey Avenue', 'Beltzhoover Avenue', 'East Warrington Avenue'] },   // over the top through Allentown
      { near: [40.43133, -80.00158], prefer: ['Brosville Street', 'South Brosville Street', 'Sarah Street', 'Bingham Street', 'McKean Street', 'Station Square Trail', 'Street'] },   // down Brosville Street to the South Side
    ],
  },
  {
    id: 'pgh-oakland-schenley', name: 'Oakland & Schenley Park', tags: ['hilly', 'park', 'trail'],
    note: 'From the Hot Metal Bridge along the river to Hazelwood and up Junction Hollow into Schenley Park, round Panther Hollow Lake, along Forbes Avenue past Carnegie Mellon, the Carnegie Museums and the Cathedral of Learning, then down Bates Street to the river',
    prefer: TRAILS,
    way: [
      { near: [40.42971, -79.95838] },                                                                   // the Hot Metal Bridge's north end
      { near: [40.42774, -79.94910], prefer: ['Hazelwood Trail', 'Great Allegheny Passage', 'Trail'] },
      { near: [40.44040, -79.95024], prefer: ['Junction Hollow Trail'] },                      // up Junction Hollow
      { near: [40.43863, -79.94584], prefer: ['Schenley Drive'] },                             // Schenley Park
      { near: [40.43952, -79.94335], prefer: ['Lower Panther Hollow Trail'], avoid: ['Schenley Drive'] },   // down round Panther Hollow Lake
      { near: [40.43967, -79.95237], prefer: ['Schenley Drive', 'Forbes Avenue', 'South Bouquet Street'] },   // Forbes Avenue past the museums and the Cathedral of Learning
      { near: [40.43057, -79.95971], prefer: ['Bates Street'] },                               // down Bates Street
      { near: [40.42971, -79.95838], prefer: TRAILS },
    ],
  },
  {
    id: 'pgh-north-side', name: 'North Shore & North Side', tags: ['flat', 'stadiums', 'neighbourhoods'],
    note: 'From PNC Park along North Shore Drive past Acrisure Stadium, up Allegheny Avenue to Ridge Avenue\'s old mansions, up Arch Street beside West Park into the Mexican War Streets, and back down round Allegheny Commons to the river',
    prefer: ['North Shore Trail', 'Trail', 'Ridge Avenue', 'Federal Street'],
    way: [
      { near: [40.44926, -80.00462] },                                           // PNC Park: Federal Street at Lacock
      { near: [40.44514, -80.01673], prefer: ['North Shore Drive'], avoid: ['e1235'] },   // North Shore Drive past Acrisure Stadium (the trail doubles back there)
      { near: [40.44971, -80.01835], prefer: ['Allegheny Avenue'] },
      { near: [40.45198, -80.00866], prefer: ['Ridge Avenue'] },                               // Ridge Avenue's mansions
      { near: [40.45881, -80.00983], prefer: ['Arch Street'] },                                // up Arch Street beside West Park into the Mexican War Streets
      { near: [40.45552, -80.00979], prefer: ['Sherman Avenue', 'Jacksonia Street', 'Sampsonia Street'] },
      { near: [40.44926, -80.00462], prefer: ['Sherman Avenue', 'West Commons', 'East Commons', 'Federal Street', 'Sandusky Street'] },   // round Allegheny Commons
    ],
  },
  {
    id: 'pgh-strip-lawrenceville', name: 'Strip District & Lawrenceville', tags: ['flat', 'neighbourhoods', 'trail'],
    note: 'Along the Strip District Trail, up Smallman Street through the Strip and Butler Street through Lawrenceville, over the 40th Street Bridge, back down the Allegheny on the North Shore Trail past Washington\'s Landing, and over the Roberto Clemente Bridge',
    prefer: ['Smallman Street', 'Butler Street', 'North Shore Trail', 'Strip District Trail', 'Trail'],
    way: [
      { near: [40.45028, -79.98889] },                                                                   // the Strip District Trail's west end, by Waterfront Drive
      { near: [40.45528, -79.98152], prefer: ['Strip District Trail'] },                       // along the Allegheny
      { near: [40.46290, -79.96695], prefer: ['Smallman Street', 'Penn Avenue'] },             // Smallman Street up the Strip, Penn Avenue to Butler
      { near: [40.46878, -79.96224], prefer: ['Butler Street'] },                              // Butler Street, Lawrenceville
      { near: [40.46446, -79.97951], prefer: ['40th Street', '40th Street Bridge'] },          // over the 40th Street Bridge to Millvale
      { near: [40.44701, -80.00374], prefer: ['North Shore Trail', 'Trail'] },                 // down the Allegheny on the North Shore Trail
      { near: [40.45028, -79.98889], prefer: ['Roberto Clemente Bridge', 'Route link', '10th Street Bypass', 'Fort Duquesne Boulevard', 'Smallman Street', 'Waterfront Drive'] },   // over the Roberto Clemente Bridge
    ],
  },
];

// ---------------------------------------------------------------- the graph as a router
const M_LAT = 111320, mLon = M_LAT * Math.cos(40.44 * Math.PI / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * mLon);
const arms = new Map();   // node → [{ e, dir }] (dir 1: from the node along the edge)
for (const e of G.edges) {
  if (!arms.has(e.from)) arms.set(e.from, []); if (!arms.has(e.to)) arms.set(e.to, []);
  arms.get(e.from).push({ e, dir: 1 }); arms.get(e.to).push({ e, dir: -1 });
}
const lenOf = (e) => e.n * 10;
const ow = (e) => city.edges?.[e.id]?.ow || 0;   // 1: only along the edge; -1: only against it
const nodeLL = (id) => { const n = G.nodes.get(id); return [n.lat, n.lon]; };
const named = (id, name) => (arms.get(id) || []).some(({ e }) => e.name === name);
const KIND = { path: 0.8, residential: 1, tertiary: 1.05, secondary: 1.25, primary: 1.6, alley: 1.6, plaza: 1.3 };

function snap(wp) {
  if (typeof wp === 'string') return wp;
  if (wp.node) return wp.node;
  let best = null;
  for (const [id] of arms) {
    if (wp.at && !(named(id, wp.at[0]) && named(id, wp.at[1]))) continue;
    if (wp.on && !named(id, wp.on)) continue;
    const d = wp.near ? dist(nodeLL(id), wp.near) : 0;
    if (!best || d < best.d) best = { id, d };
  }
  if (!best) throw new Error(`no junction for ${JSON.stringify(wp)}`);
  if (best.d > 40) console.warn(`  (waypoint ${JSON.stringify(wp)}: ${Math.round(best.d)} m off)`);
  return best.id;
}

/** The heading (radians) of edge e leaving / arriving at its ends, ridden in direction dir. */
function heading(e, dir, atEnd) {
  const lat = e.lat, lon = e.lon, n = e.n, k = Math.min(n, 3);
  let i0, i1;
  if (dir > 0) { if (atEnd) { i0 = n - k; i1 = n; } else { i0 = 0; i1 = k; } }
  else { if (atEnd) { i0 = k; i1 = 0; } else { i0 = n; i1 = n - k; } }
  return Math.atan2((lat[i1] - lat[i0]) * M_LAT, (lon[i1] - lon[i0]) * mLon);
}
/** A turn's cost (m): straight on free, a bend a little, a right angle more, a hairpin a lot — so a route keeps to
 *  a street rather than zigzagging through a grid. */
function turnCost(a, b) {
  let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
  return d < 0.5 ? 0 : d < 1.2 ? 35 : d < 2.2 ? 80 : 400;
}

/** The best way from a to b: Dijkstra over (edge, direction) — the cost of each way by its kind, its climb, whether
 *  it's preferred or avoided, whether this lap has ridden it already, and the turn onto it. → [{ e, dir }] */
function route(a, b, used, prefer = [], avoid = [], arriveHeading = null) {
  const D = new Map(), prev = new Map(), Q = [];
  const push = (key, d, from, step) => { if (d < (D.get(key) ?? Infinity)) { D.set(key, d); prev.set(key, { from, step }); Q.push([d, key]); } };
  const stepCost = (e, dir) => {
    let c = lenOf(e) * (KIND[e.kind] ?? 1.2);
    const up = Math.max(0, dir > 0 ? e.ele[e.n] - e.ele[0] : e.ele[0] - e.ele[e.n]); c += up * 4;
    if (prefer.includes(e.name)) c *= 0.75;
    if (avoid.includes(e.name)) c *= 8;
    if (used.has(e.id)) c *= 6;
    return c;
  };
  const okDir = (e, dir) => { const o = ow(e); return !(o && o !== dir && e.kind !== 'path'); };
  for (const { e, dir } of arms.get(a) || []) if (okDir(e, dir)) push(`${e.id}${dir}`, stepCost(e, dir) + (arriveHeading == null ? 0 : turnCost(arriveHeading, heading(e, dir, false))), null, { e, dir });
  const done = new Set(); let goal = null;
  while (Q.length) {
    let k = 0; for (let q = 1; q < Q.length; q++) if (Q[q][0] < Q[k][0]) k = q;
    const [d, key] = Q.splice(k, 1)[0];
    if (done.has(key)) continue; done.add(key);
    const { step } = prev.get(key), v = step.dir > 0 ? step.e.to : step.e.from;
    if (v === b) { goal = key; break; }
    const h = heading(step.e, step.dir, true);
    for (const { e, dir } of arms.get(v) || []) {
      if (e === step.e || !okDir(e, dir)) continue;
      push(`${e.id}${dir}`, d + stepCost(e, dir) + turnCost(h, heading(e, dir, false)), key, { e, dir });
    }
  }
  if (!goal) throw new Error(`no way from ${a} to ${b}`);
  const out = []; for (let key = goal; key; key = prev.get(key).from) out.unshift(prev.get(key).step);
  return out;
}

// ---------------------------------------------------------------- build, check, report
const { base, network } = graphNetwork(json);
const net = loadNetwork(network, base);
if (args.includes('--find')) {   // --find <street> [<street>]: the junctions on it (and the other), with where they are
  const [a, b] = args.slice(args.indexOf('--find') + 1).filter((x) => !x.startsWith('--'));
  for (const [id] of arms) if (named(id, a) && (!b || named(id, b))) console.log(id, nodeLL(id).map((v) => v.toFixed(5)).join(', '), [...new Set(arms.get(id).map(({ e }) => e.name))].join(' / '));
  process.exit(0);
}
const results = [];
for (const R of ROUTES) {
  if (only && R.id !== only) continue;
  const ids = R.way.map(snap), used = new Set(), steps = [];
  if (args.includes('--wp')) R.way.forEach((w, k) => console.log(`  wp${k} ${ids[k]} ${nodeLL(ids[k]).map((v) => v.toFixed(5))} ${[...new Set(arms.get(ids[k]).map(({ e }) => e.name))].join(' / ')} (${Math.round(dist(nodeLL(ids[k]), w?.near || nodeLL(ids[k])))} m)`));
  for (let k = 0; k + 1 < ids.length; k++) {
    if (ids[k] === ids[k + 1]) continue;
    const last = steps[steps.length - 1];
    const leg = route(ids[k], ids[k + 1], used, (typeof R.way[k + 1] === 'object' && R.way[k + 1].prefer) || R.prefer || [], (typeof R.way[k + 1] === 'object' && R.way[k + 1].avoid) || R.avoid || [], last ? heading(last.e, last.dir, true) : null);
    if (args.includes('--legs')) console.log(`  leg ${ids[k]}→${ids[k + 1]}: ${leg.map((x) => `${x.e.name}(${x.e.id}${x.dir > 0 ? '+' : '-'})`).join(' ')}`);
    for (const s of leg) { steps.push(s); used.add(s.e.id); }
  }
  // tidy: a step straight back along the way just ridden (a spur out and back) is cut out
  for (let k = 0; k + 1 < steps.length; ) { if (steps[k].e.id === steps[k + 1].e.id) { steps.splice(k, 2); k = Math.max(0, k - 1); } else k++; }
  const keys = steps.map((s) => `${s.e.id}${s.dir > 0 ? '+' : '-'}`);
  const preset = { id: R.id, name: R.name, path: keys, tags: R.tags, note: R.note };
  const r = makePathRoute(net, preset);
  preset.lengthM = Math.round(r.lapM); preset.climbM = Math.round(r.lapClimbM);
  // checks
  const issues = [];
  if (!planCloses(net, keys)) issues.push('does not close');
  const seen = new Map(); for (const s of steps) seen.set(s.e.id, (seen.get(s.e.id) || 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => `${G.byId.get(id).name || id}`);
  if (twice.length) issues.push(`ridden twice: ${[...new Set(twice)].join(', ')}`);
  for (let k = 0; k < steps.length; k++) { const s = steps[k], n = steps[(k + 1) % steps.length]; if (s.e.id === n.e.id) issues.push(`U-turn on ${s.e.name}`); }
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k], n = steps[(k + 1) % steps.length];
    let d = Math.abs(heading(n.e, n.dir, false) - heading(s.e, s.dir, true)); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 2.6 && s.e.id !== n.e.id) issues.push(`hairpin ${s.e.name || s.e.id} → ${n.e.name || n.e.id}`);
  }
  const wrong = steps.filter((s) => { const o = ow(s.e); return o && o !== s.dir && s.e.kind !== 'path'; });
  if (wrong.length) issues.push(`wrong way: ${wrong.map((s) => s.e.name).join(', ')}`);
  // the ways, merged by name
  const legs = [];
  for (const s of steps) { const nm = s.e.name || `(${s.e.kind})`, l = lenOf(s.e); if (legs.length && legs[legs.length - 1][0] === nm) legs[legs.length - 1][1] += l; else legs.push([nm, l]); }
  const kinds = {}; for (const s of steps) kinds[s.e.kind] = (kinds[s.e.kind] || 0) + lenOf(s.e);
  console.log(`\n${R.name} (${R.id}): ${(preset.lengthM / 1000).toFixed(1)} km, ${preset.climbM} m climb, ${steps.length} steps, ${legs.length} legs`);
  console.log(`  by kind: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(', ')}`);
  console.log(`  ${legs.map(([n, l]) => `${n} ${Math.round(l)}`).join(' → ')}`);
  console.log(`  checks: ${issues.length ? issues.join('; ') : 'ok'}`);
  results.push({ preset, issues });
}

if (args.includes('--write')) {
  if (only) throw new Error('--write builds every route: leave out --only');
  json.presets = results.map((x) => x.preset);
  writeFileSync(pghPath, JSON.stringify(json));
  writeFileSync(resolve(root, 'routes/cities/pgh-presets.json'), JSON.stringify(results.map(({ preset: p }) => ({ id: p.id, name: p.name, tags: p.tags, note: p.note, lengthM: p.lengthM, climbM: p.climbM })), null, 1));
  console.log(`\nwrote ${results.length} routes → routes/cities/pgh.json (presets), routes/cities/pgh-presets.json`);
}
