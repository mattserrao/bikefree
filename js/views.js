// Canvas views: route elevation profile, route trace, workout chart.
import { zoneColor, segIntensity } from './workout.js';

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
export function drawProfile(canvas, route, pos, { metric = false } = {}) {
  const { ctx, w, h } = setup(canvas);
  if (!route) return;
  const padL = 40, padB = 18, padT = 8, padR = 8;
  const pw = w - padL - padR, ph = h - padT - padB;
  const range = Math.max(20, route.maxEle - route.minEle);
  const lo = route.minEle - range * 0.08, hi = route.maxEle + range * 0.12;
  const X = (d) => padL + (d / route.total) * pw;
  const Y = (e) => padT + ph - ((e - lo) / (hi - lo)) * ph;

  // Filled profile, coloured by grade, in ~100 columns
  const step = Math.max(1, Math.floor(route.dist.length / Math.max(60, pw / 3)));
  for (let i = 0; i < route.dist.length - step; i += step) {
    const j = Math.min(route.dist.length - 1, i + step);
    const g = (route.ele[j] - route.ele[i]) / Math.max(1, route.dist[j] - route.dist[i]) * 100;
    ctx.fillStyle = gradeColor(g);
    ctx.globalAlpha = route.dist[j] <= pos ? 0.95 : 0.35;
    ctx.beginPath();
    ctx.moveTo(X(route.dist[i]), Y(lo));
    ctx.lineTo(X(route.dist[i]), Y(route.ele[i]));
    ctx.lineTo(X(route.dist[j]), Y(route.ele[j]));
    ctx.lineTo(X(route.dist[j]), Y(lo));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Axis labels
  ctx.fillStyle = '#8a92a6';
  ctx.font = '11px -apple-system, sans-serif';
  const eu = metric ? 1 : 3.28084;
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(route.maxEle * eu)}`, padL - 6, Y(route.maxEle) + 4);
  ctx.fillText(`${Math.round(route.minEle * eu)}`, padL - 6, Y(route.minEle) + 4);
  ctx.textAlign = 'left';
  const du = metric ? 1000 : 1609.344;
  const totalU = route.total / du;
  const tick = totalU > 40 ? 10 : totalU > 15 ? 5 : totalU > 6 ? 2 : 1;
  for (let k = tick; k < totalU; k += tick) {
    const x = X(k * du);
    ctx.fillText(`${k}`, x - 3, h - 4);
  }
  ctx.fillText(metric ? 'km' : 'mi', padL, h - 4);

  // Marker
  const at = Math.min(pos, route.total);
  const i = Math.min(route.dist.length - 1, Math.round(at / 10));
  const mx = X(at), my = Y(route.ele[i]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, Y(lo)); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
}

/** Bird's-eye route outline with a position dot. */
export function drawTrace(canvas, route, pos) {
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
  path(0, route.lat.length - 1, '#3a4152', 3);
  if (cut > 0) path(0, cut, '#ff7a1a', 3);
  const [sx, sy] = P(0);
  ctx.fillStyle = '#3ccf7a'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
  const [x, y] = P(cut);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
}

/** Workout blocks coloured by zone, with progress. */
export function drawWorkout(canvas, workout, t, ftp, bias = 1) {
  const { ctx, w, h } = setup(canvas);
  if (!workout) return;
  const padB = 16, padT = 6;
  const ph = h - padB - padT;
  const maxI = Math.max(1.3, ...workout.segments.map((s) => Math.max(s.from, s.to) * (s.unit === 'w' ? 1 / ftp : 1)));
  const X = (sec) => (sec / workout.duration) * w;
  const Y = (frac) => padT + ph - (Math.min(frac, maxI) / maxI) * ph;
  for (const s of workout.segments) {
    const a = s.unit === 'w' ? s.from / ftp : s.from;
    const b = s.unit === 'w' ? s.to / ftp : s.to;
    ctx.fillStyle = s.kind === 'free' ? '#3a4152' : zoneColor(segIntensity(s, ftp));
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
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, Y(1)); ctx.lineTo(w, Y(1)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#8a92a6';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.fillText(`FTP ${ftp} W${bias !== 1 ? ` · ${Math.round(bias * 100)}%` : ''}`, 4, Y(1) - 4);
  // Time ticks every 10 min
  for (let m = 10; m * 60 < workout.duration; m += 10) ctx.fillText(`${m}′`, X(m * 60) - 6, h - 3);
  // Progress
  const x = X(Math.min(t, workout.duration));
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, Y(0)); ctx.stroke();
}
