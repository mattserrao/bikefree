// A road-graph city's menu card (PGH, CNY, SKAN) drawn from its baked thumbnail (routes/cities/index.json, built by
// tools/build_routes.mjs with tools/city_thumbs.mjs): its main roads, water and each preset route, so the menu draws the
// cards without downloading and building the graphs themselves (about 2 MB for the three cities). No imports: the menu
// loads it.

/** The thumbnail as drawCityMap's lines (all main roads) plus the selected route as one more line. */
export function thumbLines(thumb, routeId = null) {
  const lines = thumb.lines.map((p, i) => ({ id: `t${i}`, lat: p.map((q) => q[0]), lon: p.map((q) => q[1]), minor: 0 }));
  // the network's whole box, as an undrawn side street: the card frames the city as the full map does
  if (thumb.box) lines.push({ id: 'box', lat: [thumb.box[0], thumb.box[2]], lon: [thumb.box[1], thumb.box[3]], minor: 2 });
  const r = routeId && thumb.routes[routeId];
  if (r?.length > 1) lines.push({ id: 'route', lat: r.map((q) => q[0]), lon: r.map((q) => q[1]), minor: 3 });
  return { lines, route: r?.length > 1 ? ['route+'] : null };
}
