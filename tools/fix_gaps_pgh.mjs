// Fix four gaps in PGH's graph (user, 22 Nov: "Yes, fix those issues" — found laying out the routes,
// tools/pgh_routes.mjs). Each fix finds its ways and junctions by name and position (not by id: ids change when PGH is
// rebuilt) and does nothing if it's already done, so the tool can run again after a rebuild.
//
//   1. The Rachel Carson Bridge's north end landed on nothing: Anderson Street on to East General Robinson Street.
//   2. No David McCullough (16th Street) Bridge: added from Penn Avenue at 16th Street to Chestnut Street and Progress
//      Street on the North Side (OSM's line; a deck).
//   3. "40th Street Bridge" was one 2.9 km way: the North Shore Trail from Washington's Landing to Millvale, then the
//      ramp and the bridge. Split where the trail meets the ramp; the trail named and drawn as the trail.
//   4. The North Shore Trail stopped west of the Fort Duquesne Bridge and doubled back; its stretch past Acrisure
//      Stadium to North Shore Drive added (OSM's line).
//
//   node tools/fix_gaps_pgh.mjs        then: node tools/pgh_routes.mjs --write; node tools/pgh_bridges.mjs; python3 tools/pgh_city.py
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, resample, len, KX, KY } from './pgh_graph_edit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(path, 'utf8'));
const presets = json.presets;
const { nodes, E } = load(json);
const d2 = (a, b) => Math.hypot((a[1] - b[1]) * KX, (a[0] - b[0]) * KY);
const nodeNear = (p, r = 40, test = () => true) => { let best = null; for (const n of nodes.values()) { const d = d2([n.lat, n.lon], p); if (d < r && test(n) && (!best || d < best.d)) best = { n, d }; } return best?.n || null; };
const edgeNamed = (name, test = () => true) => E.filter((e) => e.name === name && test(e));
let nextId = Math.max(...[...nodes.keys()].map((k) => +k.slice(1))) + 1;
const newNode = (lat, lon, ele, name) => { const n = { id: `n${nextId++}`, name, lat, lon, ele }; nodes.set(n.id, n); return n; };
const log = [];

/** A new way from junction a to junction b along pts ([lat, lon], a's and b's own positions added at the ends): heights
 *  from a's to b's (a deck: `deck` — the inside samples; a way on the ground: eased); 10 m samples. */
function addWay(a, b, pts, name, kind, deck = false) {
  const P = [[a.lat, a.lon], ...pts, [b.lat, b.lon]];
  const e = { id: 'new', from: a.id, to: b.id, name, kind, lat: P.map((p) => p[0]), lon: P.map((p) => p[1]), ele: P.map(() => 0), br: P.map(() => false) };
  const L = len(e); let s = 0;
  e.ele = P.map((p, i) => { if (i) s += d2(P[i - 1], p); const t = L ? s / L : 0, f = deck ? t : t * t * (3 - 2 * t); return a.ele + (b.ele - a.ele) * f; });
  e.br = P.map((_, i) => deck && i > 0 && i < P.length - 1);
  resample(e);
  if (deck) for (let i = 1; i < e.lat.length - 1; i++) e.br[i] = true;
  E.push(e);
  log.push(`added ${name} (${kind}) ${Math.round(L)} m: ${a.name || a.id} → ${b.name || b.id}`);
  return e;
}
/** Split edge e at sample i: a new junction there; → [the first part, the second]. */
function split(e, i, name) {
  const n = newNode(e.lat[i], e.lon[i], e.ele[i], name);
  const A = { ...e, id: 'new', to: n.id, lat: e.lat.slice(0, i + 1), lon: e.lon.slice(0, i + 1), ele: e.ele.slice(0, i + 1), br: e.br.slice(0, i + 1) };
  const B = { ...e, id: 'new', from: n.id, lat: e.lat.slice(i), lon: e.lon.slice(i), ele: e.ele.slice(i), br: e.br.slice(i) };
  A.br[A.br.length - 1] = false; B.br[0] = false;
  E.splice(E.indexOf(e), 1, A, B);
  return [A, B, n];
}
/** The sample of e nearest p. */
const nearestSample = (e, p) => { let bi = 0, bd = Infinity; for (let i = 0; i < e.lat.length; i++) { const d = d2([e.lat[i], e.lon[i]], p); if (d < bd) { bd = d; bi = i; } } return { i: bi, d: bd }; };
const ways = () => { const at = new Map(); for (const e of E) for (const n of [e.from, e.to]) (at.get(n) || at.set(n, []).get(n)).push(e); return at; };

// ---- 1. the Rachel Carson Bridge's north end
{
  const rc = edgeNamed('Rachel Carson Bridge')[0];
  const north = rc && [rc.from, rc.to].map((id) => nodes.get(id)).sort((x, y) => y.lat - x.lat)[0];
  if (north && ways().get(north.id).length === 1) {
    const gr = nodeNear([40.44896, -80.00071], 40, (n) => ways().get(n.id)?.some((e) => /General Robinson/.test(e.name)));
    addWay(north, gr, [[40.44857, -80.00061]], 'Anderson Street', 'tertiary');
  } else log.push('1: the Rachel Carson Bridge already lands');
}

// ---- 2. the David McCullough (16th Street) Bridge
if (!edgeNamed('David McCullough Bridge').length) {
  const south = nodeNear([40.448823, -79.98752], 40, (n) => ways().get(n.id)?.some((e) => e.name === '16th Street'));
  // the north end: Chestnut Street at Progress Street, a junction made on the Progress Street way
  const prog = edgeNamed('Progress Street').map((e) => ({ e, ...nearestSample(e, [40.45319, -79.99269]) })).sort((x, y) => x.d - y.d)[0];
  let north;
  if (prog && prog.d < 40 && prog.i > 0 && prog.i < prog.e.lat.length - 1) north = split(prog.e, prog.i, 'Progress Street & David McCullough Bridge')[2];
  else north = nodeNear([40.45319, -79.99269], 60);
  // OSM's deck: 40.44903,-79.98774 → 40.45154,-79.99073 → 40.45298,-79.99244 (bridge ways 465555707, 28388796)
  const mc = addWay(south, north, [[40.44903, -79.98774], [40.45154, -79.99073], [40.45298, -79.99244]], 'David McCullough Bridge', 'tertiary', true);
  // its deck: up over Smallman Street and Waterfront Drive (the Strip's end), over the river, down to Chestnut Street
  const n = mc.lat.length - 1;
  for (let i = 1; i < n; i++) { const s0 = i * 10, s1 = (n - i) * 10, up = (x) => { const t = Math.min(1, x / 85); return t * t * (3 - 2 * t); }; mc.ele[i] += 9 * Math.min(up(s0), up(s1)); }
} else log.push('2: the David McCullough Bridge is there');

// ---- 3. the 40th Street Bridge's long way: the North Shore Trail, then the ramp and the bridge
{
  const e = edgeNamed('40th Street Bridge', (x) => len(x) > 2000)[0];
  if (e) {
    // where the trail turns back up the ramp: the way's northernmost sample (Millvale)
    let k = 0; for (let i = 0; i < e.lat.length; i++) if (e.lat[i] > e.lat[k]) k = i;
    const southFirst = e.lat[0] < e.lat[e.lat.length - 1] ? false : true;   // (which end is the trail's: the one away from the bridge)
    const [A, B] = split(e, k, 'North Shore Trail & 40th Street Bridge ramp');
    // the part ending in Lawrenceville (40th Street) is the bridge; the other the trail
    const lawr = (x) => [x.from, x.to].some((id) => (ways().get(id) || []).some((o) => o.name === '40th Street'));
    const [bridge, trail] = lawr(A) ? [A, B] : [B, A];
    Object.assign(trail, { name: 'North Shore Trail', kind: 'path' });
    // a spike at the trail's Washington's Landing end (out 20 m and back, from the original data): straightened
    for (const end of [0, 1]) {
      const at = (i) => (end ? trail.lat.length - 1 - i : i), ref = at(Math.min(10, trail.lat.length - 1)), o = at(0);
      const vx = trail.lon[ref] - trail.lon[o], vy = trail.lat[ref] - trail.lat[o];
      const bad = []; for (let i = 1; i < Math.min(8, trail.lat.length - 2); i++) { const k = at(i); if ((trail.lon[k] - trail.lon[o]) * vx + (trail.lat[k] - trail.lat[o]) * vy < 0) bad.push(k); }
      if (bad.length) {
        for (const k of bad.sort((a, b) => b - a)) for (const a of ['lat', 'lon', 'ele', 'br']) trail[a].splice(k, 1);
        resample(trail);
        // (the spike was its ramp down from the junction: the drop eased over the trail's first 80 m instead)
        const n = trail.lat.length - 1, m = Math.min(8, n - 1), K = (i) => (end ? n - i : i), y0 = trail.ele[K(0)], y1 = trail.ele[K(m)];
        for (let i = 1; i < m; i++) { const t = i / m; trail.ele[K(i)] = y0 + (y1 - y0) * t * t * (3 - 2 * t); trail.br[K(i)] = false; }
        log.push(`3: straightened ${bad.length} samples doubling back at the trail's end`);
      }
    }
    log.push(`3: split the 40th Street Bridge way: ${Math.round(len(trail))} m of North Shore Trail, ${Math.round(len(bridge))} m of ramp and bridge${southFirst ? '' : ''}`);
  } else log.push('3: the 40th Street Bridge way is already split');
}

// ---- 4. the North Shore Trail past Acrisure Stadium
{
  const w = nodeNear([40.44500, -80.01149], 30), x = nodeNear([40.44514, -80.01673], 30);
  const joined = w && x && E.some((e) => (e.from === w.id && e.to === x.id) || (e.from === x.id && e.to === w.id));
  if (w && x && !joined) {
    // OSM's line (cycleways 450174413, 450174412, 379511875): along the river below the stadium
    addWay(w, x, [[40.44485, -80.01277], [40.44484, -80.0132], [40.44483, -80.01341], [40.44481, -80.01354], [40.44479, -80.01368], [40.44476, -80.01382], [40.44475, -80.01393], [40.44474, -80.01402], [40.44475, -80.01419], [40.44476, -80.01428], [40.44477, -80.0145], [40.44477, -80.01482], [40.44477, -80.01508], [40.44477, -80.01523], [40.44481, -80.01541], [40.44486, -80.01555], [40.44488, -80.0157], [40.44488, -80.01596], [40.4449, -80.01609], [40.44496, -80.01626], [40.44501, -80.01639], [40.44503, -80.01657], [40.44509, -80.01669]], 'North Shore Trail', 'path');
  } else log.push('4: the North Shore Trail already runs through');
}

save(json, nodes, E);
json.presets = presets;   // (stale ids until tools/pgh_routes.mjs --write)
writeFileSync(path, JSON.stringify(json));
console.log(log.join('\n'));
