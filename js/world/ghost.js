// Ghost stretches of a route: where a ride network's base tour rides a segment a second time to reach the next
// one (a spur out and back, or the way to an odd junction), tools/build_city.py marks the repeat as a ghost
// (city data `routeGhosts`: [{fromM, toM}], outbound metres). The rider never rides a ghost (the network's edges
// skip it) and the world draws and places nothing along it — the real pass, on the same streets, has it all.
// Pure; used by the route index, the road ribbons, the city and the QC.

/** One flag per route sample (both legs of a mirrored route): 1 on a ghost stretch. Cached on the route. */
export function ghostMask(route) {
  const ranges = route?.scene?.city?.routeGhosts;
  if (!ranges?.length) return null;
  if (route._ghost?.ranges === ranges && route._ghost.n === route.dist.length) return route._ghost.mask;
  const n = route.dist.length, end = route.turnIdx || n - 1, mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = route.dist[i > end ? Math.max(0, 2 * end - i) : i];
    for (const g of ranges) if (s > g.fromM + .5 && s < g.toM - .5) { mask[i] = 1; break; }
  }
  route._ghost = { ranges, n, mask };
  return mask;
}

/** Is outbound metre s on a ghost stretch? */
export function ghostAt(route, s) {
  const ranges = route?.scene?.city?.routeGhosts;
  if (!ranges?.length) return false;
  for (const g of ranges) if (s > g.fromM + .5 && s < g.toM - .5) return true;
  return false;
}
