// GPX → a smoothed, evenly spaced route with grade. Pure functions (tested in Node).

const STEP_M = 10;            // resample spacing
const ELE_SMOOTH_M = 60;      // ± window for elevation smoothing
const GRADE_SPAN_M = 30;      // ± span for grade calculation
const GRADE_LIMIT = 25;

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
  return { name, points };
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
 * @returns {{name, total, ascent, descent, minEle, maxEle, dist:Float64Array, ele:Float64Array,
 *            lat:Float64Array, lon:Float64Array, grade:Float64Array}}
 */
export function buildRoute({ name, points }) {
  // Drop duplicate points; fill missing elevation.
  const pts = [points[0]];
  for (let i = 1; i < points.length; i++) if (haversine(pts[pts.length - 1], points[i]) > 0.5) pts.push(points[i]);
  if (pts.length < 2) throw new Error('Route is too short');
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

  // Smooth elevation (moving average)
  const w = Math.round(ELE_SMOOTH_M / STEP_M);
  const ele = new Float64Array(dist.length);
  for (let i = 0; i < dist.length; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(dist.length - 1, i + w); k++) { s += rawEle[k]; c++; }
    ele[i] = s / c;
  }

  // Grade
  const g = Math.round(GRADE_SPAN_M / STEP_M);
  const grade = new Float64Array(dist.length);
  for (let i = 0; i < dist.length; i++) {
    const a = Math.max(0, i - g), b = Math.min(dist.length - 1, i + g);
    const run = dist[b] - dist[a];
    grade[i] = run > 0 ? Math.max(-GRADE_LIMIT, Math.min(GRADE_LIMIT, ((ele[b] - ele[a]) / run) * 100)) : 0;
  }

  let ascent = 0, descent = 0, minEle = Infinity, maxEle = -Infinity;
  for (let i = 0; i < ele.length; i++) {
    minEle = Math.min(minEle, ele[i]); maxEle = Math.max(maxEle, ele[i]);
    if (i) { const d = ele[i] - ele[i - 1]; if (d > 0) ascent += d; else descent -= d; }
  }
  return { name: name || 'Route', total, ascent, descent, minEle, maxEle, dist, ele, lat, lon, grade, hasElevation: anyEle };
}

/** Interpolated route values at a distance (clamped to the route). */
export function routeAt(route, d) {
  const x = Math.max(0, Math.min(route.total, d));
  const i = Math.min(route.dist.length - 2, Math.floor(x / STEP_M));
  const span = route.dist[i + 1] - route.dist[i] || 1;
  const f = Math.max(0, Math.min(1, (x - route.dist[i]) / span));
  const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
  return { ele: lerp(route.ele), lat: lerp(route.lat), lon: lerp(route.lon), grade: lerp(route.grade) };
}

/** Average grade from d over the next `ahead` metres. */
export function averageGradeAhead(route, d, ahead) {
  const a = Math.max(0, Math.min(route.total, d));
  const b = Math.min(route.total, a + ahead);
  if (b - a < 1) return 0;
  return ((routeAt(route, b).ele - routeAt(route, a).ele) / (b - a)) * 100;
}

/** Elevation still to climb from d to the finish. */
export function ascentRemaining(route, d) {
  let asc = 0;
  const start = Math.max(1, Math.ceil(d / STEP_M));
  for (let i = start; i < route.ele.length; i++) {
    const diff = route.ele[i] - route.ele[i - 1];
    if (diff > 0) asc += diff;
  }
  return asc;
}
