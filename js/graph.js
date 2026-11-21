// PGH and other free-ride road graphs ("bikefree-graph-1", tools/build_pgh.py): every street, trail and bridge
// of a city you can bike, as junctions and edges. Pure — no DOM, no three.js — so the app, the QC and the tests
// share it.
//
// A graph rides on the ride-network machinery unchanged (js/network.js: NetRide, the turn prompt, the minimap,
// the path route the session rides). The network wants every edge to be a stretch of a "base route" on its 10 m
// samples; a graph has no one line through its streets, so graphNetwork lays every edge out end to end on a
// synthetic base line, each with two 10 m pads (its own line run on 10 m past each end) between it and the next.
// The pads are never ridden: a path only ever takes an edge's own samples, and the pads keep a pose near an edge's
// end looking along that edge (riderPose looks a few metres ahead and behind). Like every catalog route, the base
// line is mirrored into there and back ([0, L] out, [L, 2L] back): an edge ridden backwards is its stretch on the
// way back. The 3D world (js/world/graph-world.js) draws the graph itself, not the base line.

export const STEP = 10;
const GRADE_LIMIT = 40;   // % (Pittsburgh's steepest streets are ~37 %)

/** Decode an edge's delta-coded lat / lon / ele (first value absolute). */
function undelta(a, k) {
  const out = new Float64Array(a.length);
  let acc = 0;
  for (let i = 0; i < a.length; i++) { acc += a[i]; out[i] = acc * k; }
  return out;
}

/** The graph JSON → its edges decoded: [{ id, from, to, name, kind, n, lat, lon, ele, bridges }]. */
export function decodeGraph(json) {
  if (json?.format !== 'bikefree-graph-1') throw new Error('Unsupported graph format');
  if (json._decoded) return json._decoded;
  const kl = json.unit?.latlon ?? 1e-6, ke = json.unit?.ele ?? 0.1;
  const nodes = new Map(json.nodes.map((n) => [n.id, n]));
  const edges = json.edges.map((e) => {
    const lat = undelta(e.lat, kl), lon = undelta(e.lon, kl), ele = undelta(e.ele, ke);
    return { id: e.id, from: e.from, to: e.to, name: e.name, kind: e.kind, n: lat.length - 1, lat, lon, ele, bridges: e.bridges || [] };
  });
  const out = { json, nodes, edges, byId: new Map(edges.map((e) => [e.id, e])) };
  Object.defineProperty(json, '_decoded', { value: out, enumerable: false, configurable: true });
  return out;
}

/** The edge nearest a spot (lat, lon): its id and the sample index, for the free ride's start. */
export function nearestEdge(G, lat, lon) {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = null, bd = Infinity;
  for (const e of G.edges) for (let i = 0; i <= e.n; i++) {
    const d = (e.lat[i] - lat) ** 2 + ((e.lon[i] - lon) * kx) ** 2;
    if (d < bd) { bd = d; best = { e, i }; }
  }
  return best;
}

/**
 * The graph as a ride network: `{ base, network }` — the base route (the app's route frame: mirrored, 10 m samples)
 * and a "bikefree-network-1" JSON over it, for js/network.js loadNetwork(network, base) and makePathRoute.
 */
export function graphNetwork(json, { name } = {}) {
  const G = decodeGraph(json);
  // the outbound line: [pad, edge samples…, pad] per edge
  let count = 0;
  for (const e of G.edges) count += e.n + 3;
  const K = count - 1, N = 2 * K + 1;
  const lat = new Float64Array(N), lon = new Float64Array(N), ele = new Float64Array(N), grade = new Float64Array(N), dist = new Float64Array(N);
  const netEdges = [];
  let k = 0;
  for (const e of G.edges) {
    const pad = (i, j) => { lat[k] = 2 * e.lat[i] - e.lat[j]; lon[k] = 2 * e.lon[i] - e.lon[j]; ele[k] = e.ele[i]; k++; };
    pad(0, Math.min(1, e.n));
    const s0 = k * STEP;
    let up = 0, down = 0;
    for (let i = 0; i <= e.n; i++) {
      lat[k] = e.lat[i]; lon[k] = e.lon[i]; ele[k] = e.ele[i];
      const a = Math.max(0, i - 1), b = Math.min(e.n, i + 1);
      grade[k] = b > a ? Math.max(-GRADE_LIMIT, Math.min(GRADE_LIMIT, ((e.ele[b] - e.ele[a]) / ((b - a) * STEP)) * 100)) : 0;
      if (i) { const d = e.ele[i] - e.ele[i - 1]; if (d > 0) up += d; else down -= d; }
      k++;
    }
    pad(e.n, Math.max(0, e.n - 1));
    netEdges.push({ id: e.id, from: e.from, to: e.to, s: [s0, s0 + e.n * STEP], lengthM: e.n * STEP,
      climbM: [Math.round(up), Math.round(down)], name: e.name, kind: e.kind });
  }
  // the way back: the outbound line mirrored (grades reversed)
  for (let i = 0; i < N; i++) {
    dist[i] = i * STEP;
    if (i > K) { const j = 2 * K - i; lat[i] = lat[j]; lon[i] = lon[j]; ele[i] = ele[j]; grade[i] = -grade[j]; }
  }
  let minEle = Infinity, maxEle = -Infinity;
  for (let i = 0; i <= K; i++) { minEle = Math.min(minEle, ele[i]); maxEle = Math.max(maxEle, ele[i]); }
  const L = K * STEP;
  const base = { name: name || json.name, id: `${json.id}-graph`, park: json.city || json.name, total: 2 * L, dist, lat, lon, ele, grade,
    ascent: 0, descent: 0, minEle, maxEle, hasElevation: true, closed: true, outAndBack: true, mirrored: true, turnIdx: K, turnS: L,
    oneWay: { total: L, ascent: 0, closedLoop: false }, stops: [], sceneUrl: null, scene: null, graph: G };
  // where a free ride starts: the configured spot's nearest edge, ridden forward from its start
  const at = json.start ? nearestEdge(G, json.start.lat, json.start.lon) : { e: G.edges[0] };
  const network = { format: 'bikefree-network-1', id: json.id, graph: true, legM: L,
    nodes: json.nodes.map((n) => ({ id: n.id, name: n.name, lat: n.lat, lon: n.lon, ele: n.ele })), edges: netEdges, presets: (json.presets || []).map((p) => ({ ...p })),
    freeRide: { name: 'Free ride', first: `${at.e.id}+`, note: 'Every street, trail and bridge: straight on at every junction unless you choose a turn. Ride until you stop' } };
  return { base, network, graph: G };
}
