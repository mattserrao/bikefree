// Ghost stretches of a route: where a ride network's base tour rides a segment a second time to reach the next
// one (a spur out and back, or the way to an odd junction), tools/build_city.py marks the repeat as a ghost
// (city data `routeGhosts`: [{fromM, toM}], outbound metres). The rider never rides a ghost (the network's edges
// skip it) and the world draws and places nothing along it — the real pass, on the same streets, has it all.
// Pure; used by the route index, the road ribbons, the city and the QC.
// [subway] Underground stretches (city data `routeUnderground`: a tunnel, a station's escalator shaft) count the same
// for the street world: no road ribbon, no ground pressed to them, nothing placed beside them — the subway kit
// (toolbox/structures/subway.js) draws them. They are ridden (network edges); `undergroundAt` tells them apart.
// [7.8] Decks (city data `routeDecks`: a stadium's escalator, concourse and ramp, off the ground) the same: the stadium
// kit (toolbox/structures/stadium.js) draws them; `deckAt` tells them apart.

/** One flag per route sample (both legs of a mirrored route): 1 on a ghost stretch. Cached on the route. */
const hidden = (city) => {
  const g = city?.routeGhosts, u = city?.routeUnderground, d = city?.routeDecks;
  if (!u?.length && !d?.length) return g;
  if (!city._hidden) Object.defineProperty(city, '_hidden', { value: [...(g || []), ...(u || []), ...(d || [])], enumerable: false });
  return city._hidden;
};

export function ghostMask(route) {
  const ranges = hidden(route?.scene?.city);
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
  const ranges = hidden(route?.scene?.city);
  if (!ranges?.length) return false;
  for (const g of ranges) if (s > g.fromM + .5 && s < g.toM - .5) return true;
  return false;
}

/** [subway] Is outbound metre s underground (a tunnel or an escalator shaft: city data `routeUnderground`)? */
export function undergroundAt(route, s) {
  const ranges = route?.scene?.city?.routeUnderground;
  if (!ranges?.length) return false;
  for (const g of ranges) if (s > g.fromM && s < g.toM) return true;
  return false;
}

/** [7.8] Is outbound metre s on a deck a structure draws (a stadium's escalator, concourse or ramp: city data `routeDecks`)? */
export function deckAt(route, s) {
  const ranges = route?.scene?.city?.routeDecks;
  if (!ranges?.length) return false;
  for (const g of ranges) if (s > g.fromM && s < g.toM) return true;
  return false;
}

/** [7.8] Off the street world's line: underground or on a deck (no route riders, no traffic beside you there). */
export const offStreetAt = (route, s) => undergroundAt(route, s) || deckAt(route, s);
