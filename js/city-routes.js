// City cards (ride networks, PLAN 5.x): a city with a network (Pittsburgh) is one card on the route list, not one
// card per preset. Its panel (js/app.js) shows a map of the whole network with a list of its routes; tapping a
// route lights it on the map, tapping a line on the map picks the routes that ride it. The logic here is plain
// data (no DOM), so it's tested in node: test/city-routes.test.mjs.

/** A network item's city: the part of its name before " · " ("Pittsburgh · Homestead Loop" → "Pittsburgh"). */
export const cityName = (name) => String(name || '').split(' · ')[0];
/** Its route name without the city ("Homestead Loop"). */
export const shortName = (name) => { const s = String(name || ''); const i = s.indexOf(' · '); return i < 0 ? s : s.slice(i + 3); };
/** Is this route-list item one of a network's (a preset, its free ride or your own route on it)? */
export const isNetItem = (it) => !!(it && it.baseId && it.network && (it.preset || it.free || it.custom));
export const cityCardId = (baseId) => `city-${baseId}`;

/**
 * The route list with each network's items folded into one city card, in the place of the city's first item:
 * { id: 'city-<baseId>', city: true, baseId, network, name, stage, park, routes (presets + your own),
 *   free (its free ride or null), mine (your own) }. Other items pass through as they are.
 */
export function groupCityItems(items) {
  const out = [], cards = new Map();
  for (const it of items) {
    if (!isNetItem(it)) { out.push(it); continue; }
    let c = cards.get(it.baseId);
    if (!c) {
      c = { id: cityCardId(it.baseId), city: true, kind: 'city', baseId: it.baseId, network: it.network, name: cityName(it.name),
        stage: it.stage, park: it.park, group: it.group, routes: [], free: null, mine: [] };
      cards.set(it.baseId, c);
      out.push(c);
    }
    if (it.free) c.free ||= it;
    else { c.routes.push(it); if (it.custom) c.mine.push(it); }
  }
  return out;
}

/** "8 areas · 39 routes · free ride" */
export function citySubline(card, areas) {
  const n = card.routes.length;
  return [areas > 1 ? `${areas} areas` : null, `${n} route${n === 1 ? '' : 's'}`, card.free ? 'free ride' : null].filter(Boolean).join(' · ');
}

/** The items a goal shows ('all': every one); tagsOf(item) → its goal tags (js/app.js goalTags). */
export const filterByGoal = (items, goal, tagsOf) => (goal === 'all' ? items.slice() : items.filter((it) => tagsOf(it).includes(goal)));

/** Edge ids a path rides ("e12+" / "e12-" → "e12"), once each, in riding order. */
export const pathEdges = (path) => [...new Set((path || []).map((k) => String(k).replace(/[+-]$/, '')))];

/**
 * Edge id → the route ids that ride it, in list order. routes: [{ id, path }] (path: traversal keys; a route
 * without one — a free ride — is left out).
 */
export function segmentRoutes(routes) {
  const m = new Map();
  for (const r of routes) for (const e of pathEdges(r.path)) { if (!m.has(e)) m.set(e, []); m.get(e).push(r.id); }
  return m;
}

/**
 * Tapping a segment: the routes that ride it (of those shown) and which to select. Tapping the same segment
 * again moves on to the next of them (round and round); a new segment starts at its first.
 * → { ids, selected } (selected null when no shown route rides it).
 */
export function pickOnSegment(segIndex, edgeId, shownIds, { lastEdge = null, selected = null } = {}) {
  const shown = new Set(shownIds);
  const ids = (segIndex.get(edgeId) || []).filter((id) => shown.has(id));
  if (!ids.length) return { ids, selected: null };
  if (edgeId === lastEdge && ids.includes(selected)) return { ids, selected: ids[(ids.indexOf(selected) + 1) % ids.length] };
  return { ids, selected: ids[0] };
}

/** The nearest polyline to (x, y) within maxD: lines [{ pts: [[x, y], …] }] → its index, or -1. */
export function nearestLine(lines, x, y, maxD) {
  let best = -1, bestD = maxD;
  lines.forEach((L, j) => { const d = polyDist(L.pts, x, y); if (d < bestD) { bestD = d; best = j; } });
  return best;
}
export function polyDist(pts, x, y) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

/**
 * A north-up equirectangular fit of lat/lon lines into a w × h box with `pad` around (the map planner's
 * projection): → { X(lon), Y(lat), scale (px per metre) }.
 */
export function fitProjection(lines, w, h, pad) {
  let lat0 = 0, n = 0;
  for (const L of lines) for (let i = 0; i < L.lat.length; i++) { lat0 += L.lat[i]; n++; }
  lat0 /= n || 1;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of lines) for (let i = 0; i < L.lat.length; i++) {
    const x = L.lon[i] * kx, y = L.lat[i] * ky;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const scale = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { X: (lon) => w / 2 + (lon * kx - cx) * scale, Y: (lat) => h / 2 - (lat * ky - cy) * scale, scale };
}

/** Rivers from several scenes (each area's scene has its own copy, some reaching further): the longest of each name. */
export function mergeRivers(lists) {
  const by = new Map();
  for (const list of lists) for (const r of list || []) {
    if (!r?.path?.length) continue;
    const had = by.get(r.name);
    if (!had || r.path.length > had.path.length) by.set(r.name, r);
  }
  return [...by.values()];
}

/**
 * Where each area's name goes on the city map (F101): on its own segments, at the point nearest their middle (a
 * centroid can fall in a river or another area). lines: [{id, lat, lon}]; areaOf(id) → the segment's area id;
 * names: {areaId: text} (an area without one gets no label). [{text, lat, lon, kind: 'area'}]
 */
export function areaLabelSpots(lines, areaOf, names = {}) {
  const by = new Map();
  for (const L of lines) {
    const a = areaOf(L.id);
    if (!a || !names[a]) continue;
    if (!by.has(a)) by.set(a, []);
    by.get(a).push(L);
  }
  const out = [];
  for (const [a, ls] of by) {
    let sx = 0, sy = 0, n = 0;
    for (const L of ls) for (let i = 0; i < L.lat.length; i++) { sx += L.lon[i]; sy += L.lat[i]; n++; }
    if (!n) continue;
    const cx = sx / n, cy = sy / n, k = Math.cos((cy * Math.PI) / 180);
    let best = null;
    for (const L of ls) for (let i = 0; i < L.lat.length; i++) {
      const d = ((L.lon[i] - cx) * k) ** 2 + (L.lat[i] - cy) ** 2;
      if (!best || d < best.d) best = { d, lat: L.lat[i], lon: L.lon[i] };
    }
    out.push({ text: names[a], lat: best.lat, lon: best.lon, kind: 'area' });
  }
  return out;
}

/**
 * The panel's list by area (F103): each route under the area where most of its metres are, areas in the network's
 * order (a route that crosses areas sits under its main one). `pathOf(it)` → its traversal keys ("e3+");
 * `edgeOf(id)` → {area, len}. [{area, items}], in the items' own order within each area; one group for one area.
 */
export function groupByArea(items, pathOf, edgeOf, areaOrder) {
  const by = new Map();
  for (const it of items) {
    const m = new Map();
    for (const k of pathOf(it) || []) { const e = edgeOf(String(k).replace(/[+-]$/, '')); if (e) m.set(e.area, (m.get(e.area) || 0) + e.len); }
    let area = null, best = -1;
    for (const a of areaOrder) if ((m.get(a) || 0) > best) { best = m.get(a) || 0; area = a; }
    if (!best) area = null;   // no known segments (a route to plan again): its own group at the end
    if (!by.has(area)) by.set(area, []);
    by.get(area).push(it);
  }
  return [...areaOrder, null].filter((a) => by.has(a)).map((area) => ({ area, items: by.get(area) }));
}

// The panel map's zoom (F102: the Polish Hill / North Side tangle is tight to tap on a phone). A view is
// {k, ox, oy}: k× the fitted map, centred on the fitted map's point (ox, oy) in canvas px; k 1 is the whole map.
export const MAP_ZOOM_MAX = 8;
/** A fitted projection (fitProjection's {X, Y, scale}) seen through a view. */
export function zoomProjection(P, w, h, view) {
  const k = view?.k || 1;
  if (k <= 1) return P;
  const ox = view.ox ?? w / 2, oy = view.oy ?? h / 2;
  return { X: (lon) => w / 2 + (P.X(lon) - ox) * k, Y: (lat) => h / 2 + (P.Y(lat) - oy) * k, scale: P.scale * k };
}
const clampView = (v, w, h) => {
  if (v.k <= 1) return { k: 1, ox: w / 2, oy: h / 2 };
  const hw = w / 2 / v.k, hh = h / 2 / v.k;
  return { k: v.k, ox: Math.max(hw, Math.min(w - hw, v.ox)), oy: Math.max(hh, Math.min(h - hh, v.oy)) };
};
/** Zoom by `factor` about canvas point (px, py): the map under it stays under it (within the map's edges). */
export function zoomAt(view, w, h, px, py, factor) {
  const k = view?.k || 1, ox = view?.ox ?? w / 2, oy = view?.oy ?? h / 2;
  const bx = ox + (px - w / 2) / k, by = oy + (py - h / 2) / k;
  const k2 = Math.max(1, Math.min(MAP_ZOOM_MAX, k * factor));
  return clampView({ k: k2, ox: bx - (px - w / 2) / k2, oy: by - (py - h / 2) / k2 }, w, h);
}
/** Drag the zoomed map by (dx, dy) canvas px. */
export function panBy(view, w, h, dx, dy) {
  const k = view?.k || 1;
  return clampView({ k, ox: (view?.ox ?? w / 2) - dx / k, oy: (view?.oy ?? h / 2) - dy / k }, w, h);
}
