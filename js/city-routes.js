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
