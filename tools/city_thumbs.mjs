// Build side of the road-graph cities' menu cards (PGH, CNY, SKAN): a small baked outline of all its roads, its water and each
// preset route, so the menu draws the card without downloading and building the whole graph (about 2 MB for the
// three cities). Used by tools/build_routes.mjs to write routes/cities/index.json; the app draws it with js/city-thumbs.js thumbLines.
import { graphNetwork } from '../js/graph.js';
import { loadNetwork, edgeLines } from '../js/network.js';

const TOLERANCE_M = 12;

/** Douglas–Peucker on [lat, lon] points (metres from a local flat projection); returns the kept points, rounded. */
export function simplifyLatLon(pts, tolM = TOLERANCE_M) {
  if (pts.length <= 2) return pts.map(round);
  const lat0 = pts[0][0], kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  const xy = pts.map(([la, lo]) => [lo * kx, la * ky]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    let best = -1, bestD = tolM;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2));
      const d = Math.hypot(xy[i][0] - (ax + t * dx), xy[i][1] - (ay + t * dy));
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(round);
}
const round = ([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5];

/**
 * The card's thumbnail for one graph city.
 * @param {object} json  routes/cities/<id>.json
 * @param {object|null} map  its baked map (water areas), when it has one
 * @returns {{lines: number[][][], water: object[]|null, routes: Object<string, number[][]>}}
 */
export function cityThumb(json, map = null, name = json.name) {
  const { base, network } = graphNetwork(json, { name });
  const net = loadNetwork(network, base);
  const lines = edgeLines(net);
  const byId = new Map(lines.map((L) => [L.id, L]));
  const pts = (L) => Array.from(L.lat, (la, i) => [la, L.lon[i]]);
  // the whole network's box (side streets too): the card frames the city as the full map does
  let s = 90, w = 180, n = -90, e = -180;
  for (const L of lines) for (let i = 0; i < L.lat.length; i++) { s = Math.min(s, L.lat[i]); n = Math.max(n, L.lat[i]); w = Math.min(w, L.lon[i]); e = Math.max(e, L.lon[i]); }
  const out = { lines: lines.map((L) => simplifyLatLon(pts(L))), box: [s, w, n, e].map((v) => Math.round(v * 1e5) / 1e5), water: map?.water || null, routes: {} };
  for (const pr of net.presets || []) {
    const path = [];
    for (const k of pr.path || []) {
      const m = /^(.+)([+-])$/.exec(k), L = m && byId.get(m[1]);
      if (!L) continue;
      const p = pts(L);
      path.push(...(m[2] === '+' ? p : p.reverse()));
    }
    out.routes[pr.id] = simplifyLatLon(path);
  }
  return out;
}

