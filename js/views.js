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

/** Elevation profile with ridden part highlighted and a position marker. */
export function drawProfile(canvas, route, pos, { metric = false, compact = false, ahead = 805, span = null } = {}) {
  const { ctx, w, h } = setup(canvas);
  if (!route) return;
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
    ctx.globalAlpha = compact
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

  if (compact) return drawMarker();
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

/** Bird's-eye route outline with a position dot. */
export function drawTrace(canvas, route, pos, { markerOnly = false } = {}) {
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
  if (m) return m;
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
  m = { x, y, minX, maxX, minY, maxY, outlineEnd };
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
