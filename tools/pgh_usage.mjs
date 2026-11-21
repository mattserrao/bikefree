// Which PGH ways the Pittsburgh routes use (user, 21 Nov): ridden by a route (0), a street touching one — it shares a
// junction with a ridden way (1), inside the area the routes draw (3), or none of these (2: removed by tools/prune_pgh.mjs).
// The area: every route's mapped line as a closed shape, filled by non-zero winding on a 20 m grid (a there-and-back
// draws no area; a figure eight fills both loops). A way is inside if any part of it is.
import { decodeGraph } from '../js/graph.js';

export function routeArea(lines) {
  const LAT0 = 40.44, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110540, C = 20;
  const xy = ([la, lo]) => [((lo + 80) * KX) / C, ((la - LAT0) * KY) / C];
  const cells = new Set();
  for (const line of lines) {
    const pts = line.map(xy);
    if (pts.length < 3) continue;
    const ys = pts.map((p) => p[1]), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= yc) !== (by <= yc)) xs.push([ax + ((yc - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
      }
      xs.sort((a, b) => a[0] - b[0]);
      let w = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        w += xs[i][1];
        if (w) for (let x = Math.ceil(xs[i][0] - 0.5); x <= Math.floor(xs[i + 1][0] - 0.5); x++) cells.add(x + ',' + y);
      }
    }
  }
  return (la, lo) => { const [x, y] = xy([la, lo]); return cells.has(Math.floor(x) + ',' + Math.floor(y)); };
}

/** { G, use: Map(edge id → 0|1|2|3), stub: Set(edge ids of kept ways that end in a dead end once class 2 goes) } */
export function routeUse(json, lines) {
  const G = decodeGraph(json);
  const ridden = new Set((json.presets || []).flatMap((p) => p.path.map((k) => k.slice(0, -1))));
  const rj = new Set();
  for (const e of G.edges) if (ridden.has(e.id)) { rj.add(e.from); rj.add(e.to); }
  const inside = routeArea(lines);
  const inArea = (e) => { for (let i = 0; i <= e.n; i += 2) if (inside(e.lat[i], e.lon[i])) return true; return inside(e.lat[e.n], e.lon[e.n]); };
  const use = new Map(G.edges.map((e) => [e.id, ridden.has(e.id) ? 0 : rj.has(e.from) || rj.has(e.to) ? 1 : inArea(e) ? 3 : 2]));
  const deg = new Map();
  for (const e of G.edges) if (use.get(e.id) !== 2) for (const n of [e.from, e.to]) deg.set(n, (deg.get(n) || 0) + 1);
  const stub = new Set(G.edges.filter((e) => use.get(e.id) % 2 === 1 && (deg.get(e.from) === 1 || deg.get(e.to) === 1)).map((e) => e.id));
  return { G, use, stub };
}
