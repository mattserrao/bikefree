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

/**
 * The main menu's route list (PLAN 6.9): the city cards first, above every park and outside the In Progress /
 * Rough Drafts / Deprecated groups; the rest keep their order (and their groups). → { top, rest }.
 */
export function cityCardsFirst(cards) {
  return { top: cards.filter((c) => c.city), rest: cards.filter((c) => !c.city) };
}

/**
 * The route selected when the app opens (PLAN 6.9): the first city's first route (a preset, not your own and not
 * its free ride), else the first route of the list. items: the route list before it is folded into city cards.
 */
export function defaultRouteId(items) {
  const card = groupCityItems(items).find((c) => c.city);
  const first = card && (card.routes.find((r) => !r.custom) || card.routes[0] || card.free);
  return first ? first.id : items[0]?.id ?? null;
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

// Landmarks on the panel map (PLAN 7.9): the city map's `landmarks` ([{name, label, kind, rank, lat, lon}], baked
// from the map spec by tools/build_city_map.py). Every marker is drawn at its true spot; a label where one fits,
// as a leader-line callout (PLAN 7.9b).
/** The label ranks shown at a zoom: on a phone-sized map rank 1 only until zoomed in, else ranks 1–2; all at 2.5×. */
export const landmarkRank = (k, small) => (k >= 2.5 ? 3 : small ? (k >= 1.6 ? 2 : 1) : 2);
const boxHit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
/** Does the segment (x1, y1)–(x2, y2) pass through box b (Liang–Barsky)? */
export function segHitsBox(x1, y1, x2, y2, b) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - b[0]], [dx, b[2] - x1], [-dy, y1 - b[1]], [dy, b[3] - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}
const segsCross = (a, b) => {
  const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return o(a[0], a[1], a[2], a[3], b[0], b[1]) * o(a[0], a[1], a[2], a[3], b[2], b[3]) < 0
    && o(b[0], b[1], b[2], b[3], a[0], a[1]) * o(b[0], b[1], b[2], b[3], a[2], a[3]) < 0;
};
const segDot = (s, x, y) => {
  const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L));
  return Math.hypot(s[0] + t * dx - x, s[1] + t * dy - y);
};
/**
 * Where the landmarks go in canvas px, and their labels as leader-line callouts (PLAN 7.9b): each dot stays at its
 * true spot; its label is tried next to it and then out around it (16 directions × growing radii, up to `maxLead`
 * px), scored by the leader's length, the network under the label (`lines`: [{pts: [[x, y], …]}] in px), a dense
 * group's labels fanning outward (away from the group's middle) and leaders crossing; never over the canvas edge,
 * a dot, another label, the `avoid` boxes (the map's own labels) or another leader, and no leader through a dot or a
 * landmark label (under a map label only at a cost). Greedy by rank, the most crowded first, then a pass re-placing the labels whose leaders cross. items: the
 * map's landmarks; X, Y: the projection; measure(text) → px width; r: the marker's radius; lh: the label's height.
 * → [{lm, x, y, label: {x, y, align, box, leader: [x1, y1, x2, y2] | null} | null}] (markers off the canvas left out).
 */
export function placeLandmarks(items, X, Y, { w, h, r = 5, lh = 13, maxRank = 3, measure, avoid = [], lines = [], maxLead = null } = {}) {
  const pts = (items || []).map((lm) => ({ lm, x: X(lm.lon), y: Y(lm.lat), label: null }))
    .filter((p) => p.x >= -r && p.x <= w + r && p.y >= -r && p.y <= h + r);
  const n = pts.length, lead = maxLead ?? Math.max(60, Math.min(150, Math.min(w, h * 1.6) * 0.14));
  const dots = pts.map((p) => [p.x - r - 2, p.y - r - 2, p.x + r + 2, p.y + r + 2]);
  // the network as a summed-area table of line samples (cells of G px): how much of a label would sit on the lines
  const G = 4, cw = Math.ceil(w / G) + 1, ch = Math.ceil(h / G) + 1, sat = new Float32Array((cw + 1) * (ch + 1));
  for (const L of lines || []) {
    const P = L.pts || L;
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
      for (let s = 0; s < m; s++) {
        const cx = Math.floor((ax + (bx - ax) * s / m) / G), cy = Math.floor((ay + (by - ay) * s / m) / G);
        if (cx >= 0 && cy >= 0 && cx < cw && cy < ch) sat[(cy + 1) * (cw + 1) + cx + 1] += 1;
      }
    }
  }
  for (let y = 1; y <= ch; y++) for (let x = 1; x <= cw; x++) sat[y * (cw + 1) + x] += sat[(y - 1) * (cw + 1) + x] + sat[y * (cw + 1) + x - 1] - sat[(y - 1) * (cw + 1) + x - 1];
  const onLines = (b) => {
    const x0 = Math.max(0, Math.floor(b[0] / G)), y0 = Math.max(0, Math.floor(b[1] / G)), x1 = Math.min(cw, Math.ceil(b[2] / G)), y1 = Math.min(ch, Math.ceil(b[3] / G));
    if (x1 <= x0 || y1 <= y0) return 0;
    return sat[y1 * (cw + 1) + x1] - sat[y0 * (cw + 1) + x1] - sat[y1 * (cw + 1) + x0] + sat[y0 * (cw + 1) + x0];
  };
  // crowding: each dot's way out of its group (from the group's weighted middle) and how crowded it is
  const R0 = Math.max(40, lead * 0.6);
  const out = pts.map((p, i) => {
    let sx = 0, sy = 0, sw = 0, c = 0;
    pts.forEach((q, j) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < R0) { const wt = 1 - d / R0; sx += q.x * wt; sy += q.y * wt; sw += wt; if (j !== i) c += wt; } });
    const dx = p.x - sx / sw, dy = p.y - sy / sw, m = Math.hypot(dx, dy);
    return m > 0.5 ? { dx: dx / m, dy: dy / m, c } : { dx: 0, dy: 0, c };
  });
  const tws = pts.map((p) => (p.lm.rank <= maxRank ? measure(p.lm.label) : 0));
  const dirs = Array.from({ length: 16 }, (_, k) => [Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);
  const all = [0, 8, 14, 22, 32, 44, 58, 74, 92, 112, 135, 160, 190, 225], radii = all.filter((d) => d <= lead), far = all.filter((d) => d <= lead * 1.5);
  /** The best spot for pts[i]'s label with every other label as placed (crossings cost `xCost` each); null: none. */
  const best = (i, xCost, R = radii) => {
    const p = pts[i], bw = tws[i] + 4, o = out[i];
    let top = null;
    for (const d of R) {
      if (top && d > top.cost) break;   // (a longer leader can't win)
      for (const [cx, cy] of dirs) {
        const ax = p.x + cx * (r + 3 + d), ay = p.y + cy * (r + 3 + d);
        const x0 = cx > 0.38 ? ax : cx < -0.38 ? ax - bw : ax - bw / 2, y0 = cy > 0.38 ? ay : cy < -0.38 ? ay - lh : ay - lh / 2;
        const b = [x0, y0, x0 + bw, y0 + lh];
        if (b[0] < 2 || b[2] > w - 2 || b[1] < 2 || b[3] > h - 2) continue;
        const base = d + (d > 0 ? 6 : 0) + onLines(b) * 3 + 3 * Math.abs(cy) + Math.min(3, o.c) * 14 * (1 - (cx * o.dx + cy * o.dy));
        if (top && base >= top.cost) continue;   // (can't win: skip the checks)
        if (dots.some((q) => boxHit(b, q)) || avoid.some((q) => boxHit(b, q))) continue;
        let ld = null;
        if (d > 0) {
          const ex = Math.max(b[0], Math.min(p.x, b[2])), ey = Math.max(b[1], Math.min(p.y, b[3])), m = Math.hypot(ex - p.x, ey - p.y) || 1;
          ld = [p.x + (ex - p.x) / m * (r + 1), p.y + (ey - p.y) / m * (r + 1), ex, ey];
        }
        let bad = false, cross = 0;
        for (let j = 0; j < n && !bad; j++) {
          if (j === i) continue;
          const q = pts[j], L = q.label;
          if (ld && segDot(ld, q.x, q.y) < r + 2) bad = true;
          else if (L && (boxHit(b, L.box) || (L.leader && segHitsBox(...L.leader, b)) || (ld && segHitsBox(...ld, L.box)))) bad = true;
          else if (ld && L?.leader && segsCross(ld, L.leader)) cross++;
        }
        if (bad) continue;
        // a leader under one of the map's labels: allowed (a dot can sit under one, F372), but costly
        const under = ld ? avoid.filter((q) => segHitsBox(...ld, q)).length : 0;
        let along = 0;   // a leader on top of a street reads as one: the network under it, sampled every 3 px
        if (ld) for (let m = Math.ceil(Math.hypot(ld[2] - ld[0], ld[3] - ld[1]) / 3), s = 1; s < m; s++) {
          const sx = ld[0] + (ld[2] - ld[0]) * s / m, sy = ld[1] + (ld[3] - ld[1]) * s / m;
          if (onLines([sx - 1, sy - 1, sx + 1, sy + 1]) > 0) along++;
        }
        const cost = base + cross * xCost + under * 40 + along * 2;
        if (!top || cost < top.cost) top = { cost, cross, label: { x: cx > 0.38 ? x0 + 2 : cx < -0.38 ? x0 + bw - 2 : x0 + bw / 2, y: y0 + lh / 2, align: cx > 0.38 ? 'left' : cx < -0.38 ? 'right' : 'center', box: b, leader: ld } };
      }
    }
    return top;
  };
  const order = pts.map((p, i) => i).filter((i) => pts[i].lm.rank <= maxRank)
    .sort((a, b) => pts[a].lm.rank - pts[b].lm.rank || out[b].c - out[a].c || a - b);
  for (const i of order) pts[i].label = (best(i, 60) || best(i, 60, far))?.label || null;   // (no room near: a longer leader)
  // leaders that still cross: re-place each such label with the others fixed (its old spot is still a candidate)
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (const i of order) {
      const L = pts[i].label;
      if (!L?.leader || !pts.some((q, j) => j !== i && q.label?.leader && segsCross(L.leader, q.label.leader))) continue;
      pts[i].label = null;
      const t = best(i, 400);
      pts[i].label = t?.label || L;
      if (t && t.label !== L) moved = true;
    }
    if (!moved) break;
  }
  // a pair still crossing: both re-placed together, in the other order; kept only if neither is lost and they no longer cross
  for (const i of order) for (const j of order) {
    const A = pts[i].label, B = pts[j].label;
    if (i >= j || !A?.leader || !B?.leader || !segsCross(A.leader, B.leader)) continue;
    pts[i].label = pts[j].label = null;
    pts[j].label = best(j, 400)?.label || null;
    pts[i].label = best(i, 400)?.label || null;
    const ok = pts[i].label && pts[j].label && !(pts[i].label.leader && pts[j].label.leader && segsCross(pts[i].label.leader, pts[j].label.leader));
    if (!ok) { pts[i].label = A; pts[j].label = B; }
  }
  return pts;
}
/** The landmark marker nearest (x, y) within maxD px, or the one whose label is under (x, y): placed (placeLandmarks) → the entry, or null. */
export function nearestLandmark(placed, x, y, maxD) {
  let best = null, bestD = maxD;
  for (const p of placed || []) { const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = p; } }
  if (!best) for (const p of placed || []) { const b = p.label?.box; if (b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return p; }
  return best;
}
/**
 * The list's scrollTop that brings a row fully into view (PLAN 7.9c): null when it is already fully visible.
 * rowTop / rowBottom are the row's edges in the list's content (px from its top); a row taller than the view shows its top.
 */
export function revealScrollTop(rowTop, rowBottom, scrollTop, viewHeight, pad = 8) {
  if (rowTop >= scrollTop && rowBottom <= scrollTop + viewHeight) return null;
  const want = rowBottom - rowTop + 2 * pad > viewHeight || rowTop < scrollTop ? rowTop - pad : rowBottom + pad - viewHeight;
  return Math.max(0, Math.round(want));
}
