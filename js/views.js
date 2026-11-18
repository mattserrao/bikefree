// Canvas views: route elevation profile, route trace, workout chart.
import { zoneColor, segIntensity } from './workout.js';

// Theme colours come from the CSS tokens, so charts follow light / dark mode.
const tok = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export function gradeColor(g) {
  if (g < -2) return '#3b8beb';
  if (g < 2) return '#3ccf7a';
  if (g < 5) return '#c9d84a';
  if (g < 8) return '#f2c14e';
  if (g < 11) return '#ff7a1a';
  return '#ff4d4d';
}

/**
 * Elevation profile with ridden part highlighted and a position marker.
 * selection [a, b] (route metres): the stretch a ride covers — bright, the rest dimmed (the route
 * selector). finishAt: route metres of a chequered finish line, labelled endLabel. ticks: route metres of named stops. Returns the layout, so a pointer
 * x can be turned back into route metres (profileDistAt).
 */
export function drawProfile(canvas, route, pos, { metric = false, compact = false, ahead = 805, span = null, selection = null, finishAt = null, ticks = null, endLabel = null } = {}) {
  const { ctx, w, h } = setup(canvas);
  if (!route) return null;
  // compact: the ride-screen strip — no axis labels, the stretch just ahead is brightest.
  const padL = compact ? 0 : 40, padB = compact ? 0 : 18, padT = compact ? 10 : 8, padR = compact ? 0 : 8;
  const pw = w - padL - padR, ph = h - padT - padB;
  const range = Math.max(20, route.maxEle - route.minEle);
  const lo = route.minEle - range * 0.08, hi = route.maxEle + range * 0.12;
  // span [from, to]: draw just that stretch (a point-to-point ride that ends at the finish: one leg)
  const [from, to] = span || [0, route.total];
  const X = (d) => padL + ((d - from) / (to - from)) * pw;
  const Y = (e) => padT + ph - ((e - lo) / (hi - lo)) * ph;

  const light = document.documentElement.dataset.theme === 'light';
  // Filled profile, coloured by grade, in ~100 columns
  const i0 = Math.max(0, Math.floor(from / 10)), i1 = Math.min(route.dist.length - 1, Math.ceil(to / 10));
  const step = Math.max(1, Math.floor((i1 - i0) / Math.max(60, pw / 3)));
  for (let i = i0; i < i1; i += step) {
    const j = Math.min(i1, i + step);
    const g = (route.ele[j] - route.ele[i]) / Math.max(1, route.dist[j] - route.dist[i]) * 100;
    ctx.fillStyle = gradeColor(g);
    ctx.globalAlpha = selection
      ? (route.dist[j] > selection[0] && route.dist[i] < selection[1] ? 0.95 : light ? 0.28 : 0.18)
      : compact
      ? (route.dist[j] <= pos ? 0.45 : route.dist[i] <= pos + ahead ? 1 : light ? 0.5 : 0.3)
      : (route.dist[j] <= pos ? 0.95 : light ? 0.7 : 0.35);
    ctx.beginPath();
    ctx.moveTo(X(route.dist[i]), Y(lo));
    ctx.lineTo(X(route.dist[i]), Y(route.ele[i]));
    ctx.lineTo(X(route.dist[j]), Y(route.ele[j]));
    ctx.lineTo(X(route.dist[j]), Y(lo));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const layout = { from, to, padL, pw, w, h };

  // named stops: small ticks on the baseline
  if (ticks?.length) {
    ctx.fillStyle = tok('--ink-2', '#c2c0b6');
    for (const t of ticks) if (t >= from && t <= to) ctx.fillRect(Math.round(X(t)) - 1, Y(lo) - 5, 2, 5);
  }
  // the end of the planned ride: a chequered finish line
  if (finishAt != null && finishAt > from && finishAt <= to) {
    const ex = X(finishAt);
    const top = padT, bot = Y(lo);
    ctx.strokeStyle = tok('--ink', '#ece9e1'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(ex, top + 12); ctx.lineTo(ex, bot); ctx.stroke(); ctx.setLineDash([]);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#16181c' : '#f4f4f0';
      ctx.fillRect(ex + c * 3, top + r * 3 + 2, 3, 3);
    }
    if (endLabel && !compact) {
      ctx.font = '600 11px -apple-system, sans-serif';
      ctx.fillStyle = tok('--ink', '#ece9e1');
      const tw = ctx.measureText(endLabel).width;
      ctx.textAlign = ex + 16 + tw > w ? 'right' : 'left';
      ctx.fillText(endLabel, ctx.textAlign === 'right' ? ex - 4 : ex + 16, top + 9);
      ctx.textAlign = 'left';
    }
  }

  if (compact) { drawMarker(); return layout; }
  // Axis labels
  ctx.fillStyle = tok('--muted', '#a8a69d');
  ctx.font = '11px -apple-system, sans-serif';
  const eu = metric ? 1 : 3.28084;
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(route.maxEle * eu)}`, padL - 6, Y(route.maxEle) + 4);
  ctx.fillText(`${Math.round(route.minEle * eu)}`, padL - 6, Y(route.minEle) + 4);
  ctx.textAlign = 'left';
  const du = metric ? 1000 : 1609.344;
  const totalU = (to - from) / du;
  const tick = totalU > 40 ? 10 : totalU > 15 ? 5 : totalU > 6 ? 2 : 1;
  for (let k = tick; k < totalU; k += tick) {
    const x = X(from + k * du);
    ctx.fillText(`${k}`, x - 3, h - 4);
  }
  ctx.fillText(metric ? 'km' : 'mi', padL, h - 4);
  drawMarker();
  return layout;

  function drawMarker() {
    const at = Math.max(from, Math.min(pos, to));
    const i = Math.min(route.dist.length - 1, Math.round(at / 10));
    const mx = X(at), my = Y(route.ele[i]);
    const ink = tok('--ink', '#ece9e1');
    ctx.strokeStyle = ink;
    ctx.lineWidth = compact ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(mx, compact ? my : padT); ctx.lineTo(mx, Y(lo)); ctx.stroke();
    ctx.fillStyle = ink;
    ctx.strokeStyle = tok('--bg', '#262624');
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, compact ? 7 : 5, 0, Math.PI * 2); ctx.fill();
    if (compact) ctx.stroke();
  }
}

/** Route metres under a pointer x (CSS px) on a profile drawn with this layout. */
export function profileDistAt(layout, x) {
  if (!layout) return 0;
  const f = Math.max(0, Math.min(1, (x - layout.padL) / layout.pw));
  return layout.from + f * (layout.to - layout.from);
}

/** Bird's-eye route outline with a position dot. section [a, b] (route metres, may run past the end
 *  and wrap): the stretch a planned ride covers, drawn in the accent, with a finish dot at b. */
export function drawTrace(canvas, route, pos, { markerOnly = false, section = null } = {}) {
  const { ctx, w, h } = setup(canvas);
  if (!route) return;
  const lat0 = (Math.min(...route.lat) + Math.max(...route.lat)) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < route.lat.length; i++) {
    const x = route.lon[i] * kx, y = route.lat[i];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 10;
  const s = Math.min((w - pad * 2) / (maxX - minX || 1e-9), (h - pad * 2) / (maxY - minY || 1e-9));
  const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
  const P = (i) => [ox + (route.lon[i] * kx - minX) * s, h - (oy + (route.lat[i] - minY) * s)];
  const cut = Math.min(route.lat.length - 1, Math.round(pos / 10));
  const path = (from, to, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let i = from; i <= to; i += 2) { const [x, y] = P(i); i === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    const [x, y] = P(to); ctx.lineTo(x, y);
    ctx.stroke();
  };
  path(0, route.lat.length - 1, tok('--muted', '#a8a69d'), 2.5);
  if (cut > 0 && !markerOnly) path(0, cut, tok('--accent', '#7aa9f5'), 3);
  const last = route.lat.length - 1;
  if (section) {
    // a long ride can turn and come back, or lap: draw each pass (the way back retraces the way out)
    const total = route.total || last * 10;
    let a = section[0], left = Math.min(section[1] - section[0], total * 3);
    while (left > 0) {
      const x0 = ((a % total) + total) % total, run = Math.min(left, total - x0);
      const i0 = Math.round(x0 / 10), i1 = Math.min(last, Math.round((x0 + run) / 10));
      if (i1 > i0) path(i0, i1, tok('--accent', '#7aa9f5'), 3.5);
      a += run; left -= run;
    }
    const e = Math.min(last, Math.round((((section[1] % total) + total) % total) / 10));
    const [ex, ey] = P(e);
    ctx.fillStyle = tok('--ink', '#ece9e1'); ctx.strokeStyle = tok('--inset', '#20201f'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(ex - 4, ey - 4, 8, 8); ctx.fill(); ctx.stroke();
  }
  const [x, y] = P(cut);
  ctx.fillStyle = tok('--accent', '#7aa9f5'); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
}

/**
 * Ride-screen minimap: north-up route outline with the current leg's progress, the rider (an arrow
 * pointing the way they're riding) and the pacer. mode 'course' fits the whole route; 'follow' keeps
 * the rider centred with about `spanM` metres across.
 */
const mapCache = new WeakMap();
function mapPoints(route) {
  let m = mapCache.get(route);
  if (m && m.ver === route.netRide?.version) return m;   // a network route's path changes as you choose turns
  let lat0 = 0;
  for (let i = 0; i < route.lat.length; i++) lat0 += route.lat[i];
  lat0 /= route.lat.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;   // metres per degree
  const n = route.lat.length, x = new Float64Array(n), y = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    x[i] = route.lon[i] * kx; y[i] = route.lat[i] * ky;
    minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]);
  }
  // On a mirrored there-and-back route the return leg retraces the outbound one, so only one leg is outlined.
  const outlineEnd = route.mirrored && route.turnIdx ? route.turnIdx : n - 1;
  m = { x, y, minX, maxX, minY, maxY, outlineEnd, ver: route.netRide?.version };
  mapCache.set(route, m);
  return m;
}

export function drawMinimap(canvas, route, pos, { mode = 'course', pacerPos = null, spanM = 1600 } = {}) {
  const { ctx, w, h } = setup(canvas);
  if (!route || !route.lat?.length) return;
  const m = mapPoints(route), n = m.x.length;
  const idx = (d) => Math.max(0, Math.min(n - 1, Math.round(d / 10)));
  const cut = idx(pos);
  const pad = 14;
  let s, cx, cy;
  if (mode === 'follow') {
    s = Math.min(w, h) / spanM;
    cx = m.x[cut]; cy = m.y[cut];
  } else {
    s = Math.min((w - pad * 2) / (m.maxX - m.minX || 1), (h - pad * 2) / (m.maxY - m.minY || 1));
    cx = (m.minX + m.maxX) / 2; cy = (m.minY + m.maxY) / 2;
  }
  const PX = (i) => w / 2 + (m.x[i] - cx) * s, PY = (i) => h / 2 - (m.y[i] - cy) * s;
  // Fewer vertices when zoomed out; a vertex every ~1.5 px is plenty.
  const step = Math.max(1, Math.floor(1.5 / (10 * s)));
  const line = (from, to, color, width) => {
    if (to <= from) return;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(PX(from), PY(from));
    for (let i = from + step; i < to; i += step) ctx.lineTo(PX(i), PY(i));
    ctx.lineTo(PX(to), PY(to));
    ctx.stroke();
  };
  const ink = tok('--ink', '#ece9e1'), bg = tok('--bg', '#262624'), accent = tok('--accent', '#7aa9f5');
  const light = document.documentElement.dataset.theme === 'light';

  // Outline (with a soft casing so it reads over the glass), then this leg's ridden part.
  line(0, m.outlineEnd, light ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.35)', 6);
  line(0, m.outlineEnd, tok('--hud-muted', '#a8a69d'), 3);
  const turn = route.turnIdx || 0;
  const legStart = turn && cut > turn ? turn : 0;
  line(legStart, cut, accent, 4);

  // Start / turnaround marks
  const mark = (i, fill) => {
    ctx.fillStyle = fill; ctx.strokeStyle = bg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(PX(i) - 3.5, PY(i) - 3.5, 7, 7); ctx.fill(); ctx.stroke();
  };
  mark(0, ink);
  if (turn && route.mirrored) mark(turn, tok('--hud-muted', '#a8a69d'));

  // Pacer: a yellow dot
  if (pacerPos != null) {
    const j = idx(pacerPos);
    ctx.fillStyle = '#f5c400'; ctx.strokeStyle = '#1d1d1c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(PX(j), PY(j), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // Rider: an arrow along the direction of travel (sampled within the current leg so the U-turn doesn't flip it).
  const legEnd = turn && cut <= turn ? turn : n - 1;
  const a = Math.max(legStart, cut - 2), b = Math.min(legEnd, cut + 2);
  const ang = b > a ? Math.atan2(-(m.y[b] - m.y[a]), m.x[b] - m.x[a]) : -Math.PI / 2;
  ctx.save();
  ctx.translate(PX(cut), PY(cut)); ctx.rotate(ang);
  ctx.fillStyle = accent; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, 8); ctx.lineTo(-3, 0); ctx.lineTo(-7, -8); ctx.closePath();
  ctx.stroke(); ctx.fill();
  ctx.restore();
}

/**
 * Ride-screen minimap for a network route (js/network.js): every rideable segment faint, the path ahead
 * bold, the next junction's ways on (when `up` is given: NetRide.upcoming) with the chosen one bright,
 * the rider's arrow and the pacer. mode 'course' fits the whole network; 'follow' centres on the rider.
 */
export function drawNetworkMinimap(canvas, ride, p, { mode = 'course', pacerPos = null, spanM = 1600, up = null, aheadTo = null } = {}) {
  const { ctx, w, h } = setup(canvas);
  const r = ride.route, lines = ride.edgeLines();
  let lat0 = 0, nn = 0;
  for (const L of lines) for (let i = 0; i < L.lat.length; i += 5) { lat0 += L.lat[i]; nn++; }
  lat0 /= nn || 1;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of lines) for (let i = 0; i < L.lat.length; i++) {
    const x = L.lon[i] * kx, y = L.lat[i] * ky;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const ci = Math.max(0, Math.min(r.lat.length - 1, Math.round(p / 10)));
  const pad = 14;
  let sc, cx, cy;
  if (mode === 'follow') { sc = Math.min(w, h) / spanM; cx = r.lon[ci] * kx; cy = r.lat[ci] * ky; }
  else { sc = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1)); cx = (minX + maxX) / 2; cy = (minY + maxY) / 2; }
  const X = (lon) => w / 2 + (lon * kx - cx) * sc, Y = (lat) => h / 2 - (lat * ky - cy) * sc;
  const step = Math.max(1, Math.floor(1.5 / (10 * sc)));
  const poly = (lat, lon, from, to, color, width, dash = null) => {
    if (to <= from) return;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(X(lon[from]), Y(lat[from]));
    for (let i = from + step; i < to; i += step) ctx.lineTo(X(lon[i]), Y(lat[i]));
    ctx.lineTo(X(lon[to]), Y(lat[to]));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const accent = tok('--accent', '#7aa9f5'), ink = tok('--ink', '#ece9e1'), bg = tok('--bg', '#262624');
  const light = document.documentElement.dataset.theme === 'light';
  const casing = light ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.35)';
  // the network, faint
  for (const L of lines) { poly(L.lat, L.lon, 0, L.lat.length - 1, casing, 5); poly(L.lat, L.lon, 0, L.lat.length - 1, tok('--hud-muted', '#a8a69d'), 2.5); }
  // the path ahead, bold
  const end = Math.max(ci, Math.min(r.lat.length - 1, Math.round((aheadTo ?? p + 3000) / 10)));
  poly(r.lat, r.lon, ci, end, casing, 7);
  poly(r.lat, r.lon, ci, end, accent, 4);
  // the next junction: each way on, the chosen one bright
  if (up) {
    up.options.forEach((o, j) => {
      const st = ride.stub(o.t, 220), n = st.lat.length - 1;
      if (j === up.selected) poly(st.lat, st.lon, 0, n, ink, 5);
      else poly(st.lat, st.lon, 0, n, ink, 2.5, [3, 3]);
    });
    const x = X(up.node.lon), y = Y(up.node.lat);
    ctx.fillStyle = ink; ctx.strokeStyle = bg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // pacer (a path metre, or {lat, lon}: where it is on its own way)
  if (pacerPos != null) {
    const j = Math.max(0, Math.min(r.lat.length - 1, Math.round(pacerPos / 10)));
    const at = typeof pacerPos === 'object' ? pacerPos : { lat: r.lat[j], lon: r.lon[j] };
    ctx.fillStyle = '#f5c400'; ctx.strokeStyle = '#1d1d1c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(at.lon), Y(at.lat), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // rider arrow along the path
  const a = Math.max(0, ci - 2), b = Math.min(r.lat.length - 1, ci + 2);
  const ang = Math.atan2(-(r.lat[b] - r.lat[a]) * ky, (r.lon[b] - r.lon[a]) * kx);
  ctx.save();
  ctx.translate(X(r.lon[ci]), Y(r.lat[ci])); ctx.rotate(ang);
  ctx.fillStyle = accent; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, 8); ctx.lineTo(-3, 0); ctx.lineTo(-7, -8); ctx.closePath();
  ctx.stroke(); ctx.fill();
  ctx.restore();
}

/**
 * A city's network map (the city card's thumbnail and its panel, js/app.js): rivers, every segment faint, the
 * ones the goal filter lights a little brighter, the selected route bold with an arrow on each step, the tapped
 * segment outlined and the junctions as dots. lines: [{ id, lat, lon }] (js/network.js edgeLines); rivers:
 * [{ widthM, path: [[lat, lon], …] }]; lit: Set of edge ids (null: all); route: traversal keys ("e12+") drawn
 * bold; marked: an edge id (the tapped segment); focus: an edge id (keyboard). Returns the lines in CSS px
 * ({ id, pts }) for hit testing (js/city-routes.js nearestLine).
 */
export function drawCityMap(canvas, { lines, rivers = [], nodes = [], lit = null, route = null, marked = null, focus = null, thumb = false, project }) {
  const { ctx, w, h } = setup(canvas);
  if (!lines?.length || !w) return [];
  const small = !thumb && w < 520, k = small ? 0.7 : 1;   // a phone: thinner lines, smaller dots
  const { X, Y, scale } = project(lines, w, h, thumb ? 8 : small ? 12 : 26);
  const light = document.documentElement.dataset.theme === 'light';
  const accent = tok('--accent', '#7aa9f5'), ink = tok('--ink', '#ece9e1'), muted = tok('--muted', '#a8a69d'), faint = tok('--faint', '#62615c');
  const bg = tok('--inset', '#20201f'), water = tok('--map-water', light ? '#cfe0ea' : '#24343b');
  const stroke = (pts, color, width, dash = null) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash || []);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
  };
  // rivers: as wide as they are (a few px at least), under everything
  for (const r of rivers) stroke(r.path.map(([la, lo]) => [X(lo), Y(la)]), water, Math.max(thumb ? 3 : 5, (r.widthM || 200) * scale));
  const out = lines.map((L) => {
    const pts = [], n = L.lat.length, step = Math.max(1, Math.floor(n / 80));
    for (let i = 0; i < n; i += step) pts.push([X(L.lon[i]), Y(L.lat[i])]);
    pts.push([X(L.lon[n - 1]), Y(L.lat[n - 1])]);
    return { id: L.id, pts };
  });
  const byId = new Map(out.map((L) => [L.id, L]));
  // the tapped segment: a soft halo under everything
  if (marked && byId.has(marked)) { ctx.globalAlpha = 0.3; stroke(byId.get(marked).pts, accent, 18 * k); ctx.globalAlpha = 1; }
  // the network: faint; with a goal, its routes' segments brighter and the rest dimmer still
  for (const L of out) if (lit && !lit.has(L.id)) stroke(L.pts, faint, thumb ? 1.5 : 1.5 * k);
  ctx.globalAlpha = lit ? 1 : 0.75;
  for (const L of out) if (!lit || lit.has(L.id)) stroke(L.pts, lit ? tok('--ink-2', '#c2c0b6') : muted, thumb ? 2 : 2.5 * k);
  ctx.globalAlpha = 1;
  // the selected route, bold, an arrow on each step
  const steps = (route || []).map((k) => { const m = /^(.+)([+-])$/.exec(k); const L = m && byId.get(m[1]); return L && (m[2] === '+' ? L.pts : [...L.pts].reverse()); }).filter(Boolean);
  for (const pts of steps) stroke(pts, light ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.45)', thumb ? 5 : 9 * k);
  for (const pts of steps) stroke(pts, accent, thumb ? 3 : 5 * k);
  if (!thumb) for (const pts of steps) {
    if (pts.length < 3) continue;
    const m = Math.floor(pts.length / 2), [ax, ay] = pts[m - 1], [bx, by] = pts[m + 1];
    ctx.save(); ctx.translate(pts[m][0], pts[m][1]); ctx.rotate(Math.atan2(by - ay, bx - ax)); ctx.scale(k, k);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 4.5); ctx.lineTo(-4, -4.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  if (focus && byId.has(focus)) { stroke(byId.get(focus).pts, bg, 5); stroke(byId.get(focus).pts, ink, 2.5, [5, 4]); }
  // junctions
  if (!thumb) for (const nd of nodes) {
    ctx.fillStyle = muted; ctx.strokeStyle = bg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(nd.lon), Y(nd.lat), small ? 2.5 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  return out;
}

/** Workout blocks coloured by zone, with progress. */
export function drawWorkout(canvas, workout, t, ftp, bias = 1, { compact = false } = {}) {
  const { ctx, w, h } = setup(canvas);
  if (!workout) return;
  const padB = compact ? 0 : 16, padT = compact ? 4 : 6;
  const ph = h - padB - padT;
  const maxI = Math.max(1.3, ...workout.segments.map((s) => Math.max(s.from, s.to) * (s.unit === 'w' ? 1 / ftp : 1)));
  const X = (sec) => (sec / workout.duration) * w;
  const Y = (frac) => padT + ph - (Math.min(frac, maxI) / maxI) * ph;
  for (const s of workout.segments) {
    const a = s.unit === 'w' ? s.from / ftp : s.from;
    const b = s.unit === 'w' ? s.to / ftp : s.to;
    ctx.fillStyle = s.kind === 'free' ? tok('--line-strong', '#4a4a46') : zoneColor(segIntensity(s, ftp));
    ctx.globalAlpha = s.start + s.duration <= t ? 0.95 : 0.5;
    ctx.beginPath();
    ctx.moveTo(X(s.start) + 0.5, Y(0));
    ctx.lineTo(X(s.start) + 0.5, Y(s.kind === 'free' ? 0.5 : a));
    ctx.lineTo(X(s.start + s.duration) - 0.5, Y(s.kind === 'free' ? 0.5 : b));
    ctx.lineTo(X(s.start + s.duration) - 0.5, Y(0));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // FTP line
  ctx.strokeStyle = tok('--muted', '#a8a69d');
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, Y(1)); ctx.lineTo(w, Y(1)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (!compact) drawLabels();
  // Progress
  const x = X(Math.min(t, workout.duration));
  ctx.strokeStyle = tok('--ink', '#ece9e1'); ctx.lineWidth = 2;
  if (t > 0 || !compact) { ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, Y(0)); ctx.stroke(); }

  function drawLabels() {
    ctx.fillStyle = tok('--muted', '#a8a69d');
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(`FTP ${ftp} W${bias !== 1 ? ` · ${Math.round(bias * 100)}%` : ''}`, 4, Y(1) - 4);
    // Time ticks every 10 min
    for (let m = 10; m * 60 < workout.duration; m += 10) ctx.fillText(`${m}′`, X(m * 60) - 6, h - 3);
  }
}
