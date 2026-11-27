// [review 27 Nov] W15: point in polygon, the one copy (graph-world.js and graph-city.js carried eight). Even-odd
// crossing test, the same arithmetic as the copies it replaces (so every inside/outside answer is unchanged).

/** Inside a ring of local points ({ x, z }, closed or not). */
export function inRing(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; }
  return c;
}

/** Inside a ring of [x, z] pairs. */
export function inPairs(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}

/** Inside a ring of { x, z } or within `grow` m of it, roughly: its edge tested at four offsets. */
export function inRingGrown(ring, x, z, grow = 0) {
  if (inRing(ring, x, z)) return true;
  return grow > 0 && (inRing(ring, x + grow, z) || inRing(ring, x - grow, z) || inRing(ring, x, z + grow) || inRing(ring, x, z - grow));
}
