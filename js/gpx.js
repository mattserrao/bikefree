// GPX → a smoothed, evenly spaced route with grade. Pure functions (tested in Node).

const STEP_M = 10;            // resample spacing
const ELE_SMOOTH_M = 60;      // ± window for elevation smoothing (a route may ask for its own: `eleSmoothM`)
const GRADE_SPAN_M = 30;      // ± span for grade calculation
const GRADE_LIMIT = 25;
const CLOSED_LOOP_M = 150;    // start and end this close → treat as a loop you can ride forever

/** Parse GPX text into points [{lat, lon, ele}] and a name. Handles trkpt, rtept and wpt-less files. */
export function parseGpx(text) {
  const nameMatch = text.match(/<trk>[\s\S]*?<name>([\s\S]*?)<\/name>/) || text.match(/<name>([\s\S]*?)<\/name>/);
  const name = nameMatch ? decodeXml(nameMatch[1].trim()) : null;
  const points = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[2];
    const lat = parseFloat((attrs.match(/lat\s*=\s*["']([^"']+)["']/) || [])[1]);
    const lon = parseFloat((attrs.match(/lon\s*=\s*["']([^"']+)["']/) || [])[1]);
    const eleM = (m[4] || '').match(/<ele>([^<]+)<\/ele>/);
    const ele = eleM ? parseFloat(eleM[1]) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat, lon, ele });
  }
  if (points.length < 2) throw new Error('No track points found in this GPX file');
  // named waypoints (<wpt>): offered as start points in the route selector
  const waypoints = {};
  const wre = /<wpt\b([^>]*?)>([\s\S]*?)<\/wpt>/g;
  while ((m = wre.exec(text))) {
    const lat = parseFloat((m[1].match(/lat\s*=\s*["']([^"']+)["']/) || [])[1]);
    const lon = parseFloat((m[1].match(/lon\s*=\s*["']([^"']+)["']/) || [])[1]);
    const wName = (m[2].match(/<name>([\s\S]*?)<\/name>/) || [])[1];
    if (Number.isFinite(lat) && Number.isFinite(lon) && wName?.trim()) waypoints[decodeXml(wName.trim())] = [lat, lon];
  }
  return { name, points, waypoints };
}

function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

export function haversine(a, b) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Build a route: resampled every 10 m with smoothed elevation and grade.
 * `eleSmoothM` (± m, default 60): the moving-average window for elevation. [w2-align] A GPX whose profile is
 * already rideable (a city route from tools/build_city.py: grade and grade change limited, spikes shaved) asks
 * for a narrow one in its catalog entry, so crests and dips stay on the ground; recorded GPX keeps ±60 m.
 * @returns {{name, total, ascent, descent, minEle, maxEle, dist:Float64Array, ele:Float64Array,
 *            lat:Float64Array, lon:Float64Array, grade:Float64Array}}
 */
export function buildRoute({ name, points, eleSmoothM = ELE_SMOOTH_M }) {
  // Drop duplicate points; fill missing elevation.
  const pts = [points[0]];
  for (let i = 1; i < points.length; i++) if (haversine(pts[pts.length - 1], points[i]) > 0.5) pts.push(points[i]);
  if (pts.length < 2) throw new Error('Route is too short');
  // Closed loop? Close any small gap so the end joins the start exactly.
  const closed = pts.length > 10 && haversine(pts[0], pts[pts.length - 1]) < CLOSED_LOOP_M;
  if (closed && haversine(pts[0], pts[pts.length - 1]) > 0.5) pts.push({ ...pts[0] });
  if (closed) pts[pts.length - 1] = { ...pts[0], ele: pts[0].ele };
  const anyEle = pts.some((p) => Number.isFinite(p.ele));
  let lastEle = anyEle ? pts.find((p) => Number.isFinite(p.ele)).ele : 0;
  for (const p of pts) { if (Number.isFinite(p.ele)) lastEle = p.ele; else p.ele = lastEle; }

  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversine(pts[i - 1], pts[i]);
  const total = cum[cum.length - 1];
  if (total < 50) throw new Error('Route is too short');

  // Resample
  const n = Math.floor(total / STEP_M) + 1;
  const dist = new Float64Array(n + 1);
  const rawEle = new Float64Array(n + 1);
  const lat = new Float64Array(n + 1);
  const lon = new Float64Array(n + 1);
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const d = i < n ? i * STEP_M : total;
    while (j < pts.length - 2 && cum[j + 1] < d) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (d - cum[j]) / span));
    dist[i] = d;
    rawEle[i] = pts[j].ele + (pts[j + 1].ele - pts[j].ele) * f;
    lat[i] = pts[j].lat + (pts[j + 1].lat - pts[j].lat) * f;
    lon[i] = pts[j].lon + (pts[j + 1].lon - pts[j].lon) * f;
  }

  // On a loop the last sample is the start again; smoothing and grade wrap around
  // the start/finish so there is no bump when a new lap begins.
  const m = closed ? dist.length - 1 : dist.length; // unique samples
  const wrap = (k) => ((k % m) + m) % m;

  // Smooth elevation (moving average)
  const w = Math.max(0, Math.round((Number.isFinite(eleSmoothM) ? eleSmoothM : ELE_SMOOTH_M) / STEP_M));
  const ele = new Float64Array(dist.length);
  for (let i = 0; i < m; i++) {
    let s = 0, c = 0;
    if (closed) {
      for (let k = i - w; k <= i + w; k++) { s += rawEle[wrap(k)]; c++; }
    } else {
      for (let k = Math.max(0, i - w); k <= Math.min(m - 1, i + w); k++) { s += rawEle[k]; c++; }
    }
    ele[i] = s / c;
  }
  if (closed) ele[m] = ele[0];

  // Grade
  const g = Math.round(GRADE_SPAN_M / STEP_M);
  const grade = new Float64Array(dist.length);
  for (let i = 0; i < m; i++) {
    let rise, run;
    if (closed) {
      rise = ele[wrap(i + g)] - ele[wrap(i - g)];
      run = 2 * g * STEP_M;
    } else {
      const a = Math.max(0, i - g), b = Math.min(m - 1, i + g);
      rise = ele[b] - ele[a];
      run = dist[b] - dist[a];
    }
    grade[i] = run > 0 ? Math.max(-GRADE_LIMIT, Math.min(GRADE_LIMIT, (rise / run) * 100)) : 0;
  }
  if (closed) grade[m] = grade[0];

  let ascent = 0, descent = 0, minEle = Infinity, maxEle = -Infinity;
  for (let i = 0; i < ele.length; i++) {
    minEle = Math.min(minEle, ele[i]); maxEle = Math.max(maxEle, ele[i]);
    if (i) { const d = ele[i] - ele[i - 1]; if (d > 0) ascent += d; else descent -= d; }
  }
  return { name: name || 'Route', total, ascent, descent, minEle, maxEle, dist, ele, lat, lon, grade, hasElevation: anyEle, closed };
}

/** Position within the route: wraps around on loops, clamps otherwise. */
export function wrapDist(route, d) {
  if (route.closed) return ((d % route.total) + route.total) % route.total;
  return Math.max(0, Math.min(route.total, d));
}

/** Which lap (1-based) a ridden distance is on. */
export function lapAt(route, d) {
  return route.closed ? Math.floor(Math.max(0, d) / route.total) + 1 : 1;
}

/** Interpolated route values at a distance (wrapped on loops, clamped otherwise). */
export function routeAt(route, d) {
  const x = wrapDist(route, d);
  const i = Math.min(route.dist.length - 2, Math.floor(x / STEP_M));
  const span = route.dist[i + 1] - route.dist[i] || 1;
  const f = Math.max(0, Math.min(1, (x - route.dist[i]) / span));
  const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
  return { ele: lerp(route.ele), lat: lerp(route.lat), lon: lerp(route.lon), grade: lerp(route.grade) };
}

/** Average grade from d over the next `ahead` metres. */
export function averageGradeAhead(route, d, ahead) {
  if (route.closed) {
    const a = wrapDist(route, d);
    return ((routeAt(route, a + ahead).ele - routeAt(route, a).ele) / ahead) * 100;
  }
  const a = Math.max(0, Math.min(route.total, d));
  const b = Math.min(route.total, a + ahead);
  if (b - a < 1) return 0;
  return ((routeAt(route, b).ele - routeAt(route, a).ele) / (b - a)) * 100;
}

/** Elevation still to climb from d to the finish (end of this lap on loops). */
export function ascentRemaining(route, d) {
  let asc = 0;
  const start = Math.max(1, Math.ceil(wrapDist(route, d) / STEP_M));
  for (let i = start; i < route.ele.length; i++) {
    const diff = route.ele[i] - route.ele[i - 1];
    if (diff > 0) asc += diff;
  }
  return asc;
}

/**
 * A point-to-point route: a one-way stage (Alpe d'Huez) or your own GPX that doesn't come back to its
 * start. The app mirrors it into A → B → A; with Endless off the ride ends at the finish instead.
 * Built-in there-and-back routes and loops are not point to point.
 */
export function isPointToPoint(route) {
  return !!(route?.mirrored && route.oneWay && !route.oneWay.closedLoop);
}

/** The leg a ride from `startM` is on: [0, turn] riding forward, [turn, total] riding the way back. */
export function legSpan(route, startM) {
  if (route.lapM) return [0, route.lapM];   // a network route (js/network.js): its first lap
  const turn = route.turnS || route.total;
  const s = ((startM % route.total) + route.total) % route.total;
  return s < turn ? [0, turn] : [turn, route.total];
}

/** Metres from a start point to the finish: the far end riding forward, back at A riding the way back. */
export function finishDistanceM(route, startM) {
  if (route.netOpen) return Math.max(0, route.lapM - startM);   // your own one-way network route: its end
  const turn = route.turnS || route.total;
  const s = ((startM % route.total) + route.total) % route.total;
  return (s < turn ? turn : route.total) - s;
}

// ---------- Assisted conveyors (escalators, and later ferries or inclines) ----------
// A route may carry `carry`: [{from, to, mps, label}] in route metres (a network path route builds them from its
// edges' `conveyors`). On such a stretch the rider is carried at `mps` whatever the pedals do: the session holds
// that speed, the trainer is set to (near) no resistance, the HUD shows the label instead of the grade.
export const CARRY_EASE_MPS2 = 1.5;   // how fast the speed eases onto (and the approach slows to) a conveyor's pace

/** The conveyor zone at route metre s (wrapped on loops), or null. */
export function carryAt(route, s) {
  const zones = route?.carry;
  if (!zones?.length) return null;
  const x = wrapDist(route, s);
  for (const z of zones) if (x >= z.from && x < z.to) return z;
  return null;
}

/** The next conveyor zone starting within `reach` m ahead of s: {zone, dist}, or null. */
export function carryAhead(route, s, reach = 80) {
  const zones = route?.carry;
  if (!zones?.length) return null;
  const x = wrapDist(route, s);
  let best = null;
  for (const z of zones) {
    const d = z.from - x;
    if (d > 0 && d <= reach && (!best || d < best.dist)) best = { zone: z, dist: d };
  }
  return best;
}

/**
 * Speed (m/s) for one step near conveyors: on one, eased to its pace (up or down); approaching one, no faster than
 * a gentle slow-down (CARRY_EASE_MPS2) onto its pace allows. Otherwise `v` unchanged.
 */
export function carrySpeed(route, s, v, dt) {
  const z = carryAt(route, s);
  if (z) {
    const step = CARRY_EASE_MPS2 * dt;
    return v > z.mps ? Math.max(z.mps, v - step) : Math.min(z.mps, v + step);
  }
  const a = carryAhead(route, s);
  if (a) { const cap = Math.sqrt(a.zone.mps ** 2 + 2 * CARRY_EASE_MPS2 * a.dist); if (v > cap) return cap; }
  return v;
}
