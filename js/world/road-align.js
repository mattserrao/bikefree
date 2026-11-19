// Road alignment at run time (the builder half is tools/citylib/road_align.py). Pure functions, no three.js,
// so the course QC sweep uses exactly what the renderer draws.
//
// 1. The route's centre line as a curve. The app keeps the route as samples exactly 10 m apart; drawn as
//    straight 10 m pieces, a tight city corner (25–50° per sample) shows as a row of kinks. With the scene's
//    `roadAlign.curve` on, the road ribbons, the rider and the chase camera follow a Catmull-Rom curve through
//    the same samples instead (it passes through every sample, so everything placed at a sample still lines up;
//    between samples it differs from the straight piece by at most ~L·θ/8, 0.5 m at a 25° corner).
// 2. City street profiles (`roadAlign.streets`). Street heights sampled from the ground jump wherever the
//    line brushes a retaining wall, a bank or a cliff, and streets that meet at a junction each bring their own
//    height. alignStreetProfiles() smooths each street's profile, gives every junction node one height shared
//    by all its streets (a bridge deck's or the route's own height wins there), and limits grade and grade
//    change between junctions, without straying far from the ground. The junctions are listed for the
//    junction builder (S2): `streets.junctions = [{x, z, y, streets: [k…], deck, route}]`.
//
// 3. Smooth sharp turns (`roadAlign.turns`: Pittsburgh and Alpe d'Huez). The 10 m samples squeeze a hairpin into
//    one or two samples (Alpe d'Huez: 133° at one sample), and the curve through them then turns on a ~0.5 m radius:
//    the road shows facets and kinks, its inside edge pinches, the paint zig-zags and the rider swings round. With
//    `turns` on:
//    (a) smoothTurns() (run by makeRouteIndex) finds every stretch where the curve is tighter than `minRadiusM`,
//        redraws it as a 1 m polyline eased towards the inside of the turn (curve-shortening steps, only where it
//        is too tight, no point more than `maxShiftM` from the original curve) and spaces it evenly again. The
//        curve (curveXZ, curveTangent) follows these windows, so the road, its paint, the rider and the camera all
//        follow one smooth line; the 10 m samples inside a window are moved onto it, so everything else that reads
//        the route index (ground, rails, walls, junctions) follows the same road. Outside the windows nothing moves.
//    (b) denseRoad() cuts the curve finer in tight turns (where its even cut would step more than `refineDeg`), so
//        consecutive cross-sections there differ by at most `stepDeg` (everything else keeps its pieces), and hands
//        the ribbons the curve's own tangents;
//    (c) ribbonSections() clamps each ribbon edge so it never runs backwards (no fold inside a tight turn).
//    Ride distance and the elevation profile are untouched (dist / ele are the GPX's); the rider is drawn on the
//    curve at the same distance. It implies `curve`. Defaults in TURN_DEFAULTS; off unless the scene asks.
//
// Scene keys: "roadAlign": { "curve": true, "streets": true, "turns": { "minRadiusM": 8 }, "maxGrade": 0.3, … }
// (defaults in STREET_DEFAULTS and TURN_DEFAULTS).

import { drain, each, mapJob, mapGen, due } from './toolbox/core/jobs.js';   // [F30] street profiles run as a job (in frame slices on the ride)
import { ghostMask } from './ghost.js';   // [pittsburgh-network] no eased turn across a ghost
/** Is the curved centre line on for this route? (`turns` implies it.) */
export const curveOn = (route) => !!(route.scene?.roadAlign?.curve || route.scene?.roadAlign?.turns);

export const TURN_DEFAULTS = {
  minRadiusM: 8,     // the centre line is eased until it turns no tighter than this…
  maxShiftM: 6,      // …moving no point further than this from the curve through the GPX samples
  marginM: 40,       // each eased stretch reaches this far past the too-tight part (the easing never meets its ends)
  refineDeg: 6,      // drawn road: a 10 m piece whose even cut (1, 2 or 4 pieces by its bow) turns more than this
                     // between cross-sections is cut finer…
  stepDeg: 3,        // …so that consecutive cross-sections differ by at most this
  maxPieces: 48,     // …but at most this many pieces per 10 m sample
};

/** The scene's smooth-turn options, or null when off. */
export function turnOptions(route) {
  const t = route?.scene?.roadAlign?.turns;
  return t ? { ...TURN_DEFAULTS, ...(t === true ? {} : t) } : null;
}

/** Radius (m) of the circle through three points (Infinity when straight). */
export function circumRadius(ax, az, bx, bz, cx, cz) {
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (Math.abs(cross) < 1e-12) return Infinity;
  return (Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)) / (2 * Math.abs(cross));
}

const cr = (p0, p1, p2, p3, f) => {
  const f2 = f * f, f3 = f2 * f;
  return .5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3);
};
const crd = (p0, p1, p2, p3, f) => .5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * f + 3 * (3 * p1 - p0 - 3 * p2 + p3) * f * f);

// Catmull-Rom through points X, Z (n of them) at segment k, fraction f; ends extrapolated. d: derivative instead.
function crAt(X, Z, n, k, f, d) {
  const at = (j, A) => (j < 0 ? 2 * A[0] - A[1] : j >= n ? 2 * A[n - 1] - A[n - 2] : A[j]);
  const g = d ? crd : cr;
  return { x: g(at(k - 1, X), X[k], at(k + 1, X), at(k + 2, X), f), z: g(at(k - 1, Z), Z[k], at(k + 1, Z), at(k + 2, Z), f) };
}

const WIN_STEP = .1;   // window points every 0.1 sample (1 m)

// [smooth-turns] the eased window holding curve parameter u (in samples), with u mapped onto the way out on a
// mirrored route: { w, t (window point coordinate), sign (−1 on the way back) } or null
function turnWindow(index, i, f) {
  const T = index.turns;
  let u = i + f, sign = 1;
  if (T.mirror != null && u > T.mirror) { u = 2 * T.mirror - u; sign = -1; }
  const W = T.windows;
  let lo = 0, hi = W.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, w = W[m];
    if (u < w.a) hi = m - 1; else if (u > w.b) lo = m + 1; else return { w, t: (u - w.a) / WIN_STEP, sign };
  }
  return null;
}

/**
 * [smooth-turns] One eased stretch: the polyline ox, oz (K + 1 points) redrawn so it turns no tighter than radius r.
 * Its heading, every 0.5 m along it, is relaxed wherever it turns faster than 1/r (the total turn and the heading
 * at both ends stay as they were), the line is rebuilt from the headings, and the small offset that leaves at the
 * far end is taken out gradually (zero slope at both ends, so the line still meets the untouched curve smoothly).
 * Returns the line again as K + 1 evenly spaced points, with its length before and after.
 */
function easeWindow(ox, oz, r) {
  const K = ox.length - 1, c = new Float64Array(K + 1);
  for (let k = 1; k <= K; k++) c[k] = c[k - 1] + Math.hypot(ox[k] - ox[k - 1], oz[k] - oz[k - 1]);
  const L = c[K], M = Math.max(8, Math.round(L / .5)), ds = L / M;
  const along = (X, Z, C, s) => {   // point at arc length s on a polyline with cumulative lengths C
    let lo = 0, hi = C.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m; }
    const f = Math.min(1, Math.max(0, (s - C[lo]) / ((C[hi] - C[lo]) || 1)));
    return { x: X[lo] + (X[hi] - X[lo]) * f, z: Z[lo] + (Z[hi] - Z[lo]) * f };
  };
  const qx = new Float64Array(M + 1), qz = new Float64Array(M + 1);
  for (let j = 0; j <= M; j++) { const p = along(ox, oz, c, j * ds); qx[j] = p.x; qz[j] = p.z; }
  // headings of the M pieces, unwrapped
  const th = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    let t = Math.atan2(qz[j + 1] - qz[j], qx[j + 1] - qx[j]);
    if (j) { while (t - th[j - 1] > Math.PI) t -= 2 * Math.PI; while (t - th[j - 1] < -Math.PI) t += 2 * Math.PI; }
    th[j] = t;
  }
  const thIn = Float64Array.from(th);
  // relax: a heading is pulled towards its neighbours' mean while it turns faster than 1/r on either side
  const lim = ds / r, hold = 4;
  let active = [];
  const over = (j) => Math.abs(th[j] - th[j - 1]) > lim * 1.0001 || Math.abs(th[j + 1] - th[j]) > lim * 1.0001;
  for (let j = hold; j < M - hold; j++) if (over(j)) active.push(j);
  for (let it = 0; it < 200000 && active.length; it++) {
    const next = new Set();
    for (const j of active) {
      if (!over(j)) continue;
      th[j] += ((th[j - 1] + th[j + 1]) / 2 - th[j]) * .6;
      for (let q = Math.max(hold, j - 1); q <= Math.min(M - hold - 1, j + 1); q++) next.add(q);
    }
    active = [...next];
  }
  // ease the curvature in and out too (a Gaussian over the changed part, σ ≈ 2.5 m): the turn rate builds up over
  // a few metres instead of switching on (no visible kink where the arc meets the straight)
  const th0 = Float64Array.from(th), sg = 2.5 / ds, reach = Math.ceil(3 * sg), mask = new Uint8Array(M);
  for (let j = 0; j < M; j++) if (Math.abs(th[j] - thIn[j]) > 1e-9) for (let q = Math.max(hold, j - reach); q <= Math.min(M - hold - 1, j + reach); q++) mask[q] = 1;
  for (let j = hold; j < M - hold; j++) {
    if (!mask[j]) continue;
    let w = 0, v = 0;
    for (let q = Math.max(0, j - reach); q <= Math.min(M - 1, j + reach); q++) { const g = Math.exp(-(((q - j) / sg) ** 2) / 2); w += g; v += g * th0[q]; }
    th[j] = v / w;
  }
  // rebuild from the headings, then take out the end offset with a smoothstep (zero slope at both ends)
  const px = new Float64Array(M + 1), pz = new Float64Array(M + 1);
  px[0] = qx[0]; pz[0] = qz[0];
  for (let j = 0; j < M; j++) { px[j + 1] = px[j] + Math.cos(th[j]) * ds; pz[j + 1] = pz[j] + Math.sin(th[j]) * ds; }
  const ex = qx[M] - px[M], ez = qz[M] - pz[M];
  for (let j = 0; j <= M; j++) { const t = j / M, w = t * t * (3 - 2 * t); px[j] += ex * w; pz[j] += ez * w; }
  const C = new Float64Array(M + 1);
  for (let j = 1; j <= M; j++) C[j] = C[j - 1] + Math.hypot(px[j] - px[j - 1], pz[j] - pz[j - 1]);
  const x = new Float64Array(K + 1), z = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) { const p = along(px, pz, C, C[M] * k / K); x[k] = p.x; z[k] = p.z; }
  x[0] = ox[0]; z[0] = oz[0]; x[K] = ox[K]; z[K] = oz[K];
  return { x, z, length0: L, length: C[M] };
}

/**
 * [smooth-turns] Ease the route's too-tight turns (see 3. above). xs, zs: the samples in the local frame, moved in
 * place inside each window. Returns { windows: [{a, b (sample numbers), x, z (1 m points)}], mirror (the far
 * turnaround's sample on a mirrored A → B → A route, else null), stats: {windows, minRadiusBefore, minRadiusAfter,
 * maxShift, lengthChange (m, way out)} }.
 */
export function smoothTurns(route, xs, zs, o = TURN_DEFAULTS) {
  const n = xs.length, turn = route.turnIdx > 0 ? route.turnIdx : n - 1;
  // a mirrored out-and-back (js/routes.js mirrorRoute): sample i of the way back is sample 2·turn − i of the way out
  const mirrored = turn < n - 1 && n === 2 * turn + 1 && [1, 2, Math.floor(turn / 2)].every((i) => xs[i] === xs[2 * turn - i] && zs[i] === zs[2 * turn - i]);
  const end = mirrored ? turn : n - 1;
  const base = { xs: Float64Array.from(xs), zs: Float64Array.from(zs) };
  const P = (u) => { const i = Math.min(end - 1, Math.floor(u)); return crAt(base.xs, base.zs, n, i, u - i, false); };
  // 1. where the curve through the samples is too tight (circles through points 1 m apart, every 0.5 m)
  const tight = [];
  let before = Infinity;
  for (let u = .1; u < end - .1; u += .05) {
    const p = P(u - .1), q = P(u), r = P(u + .1), R = circumRadius(p.x, p.z, q.x, q.z, r.x, r.z);
    before = Math.min(before, R);
    if (R < o.minRadiusM) tight.push(Math.floor(u));
  }
  // (never at the far turnaround or the start: the U-turns there are the rider's, js/world/pose.js)
  // [pittsburgh-network] nor through a network line's other U-turns (a dead end's turnaround, a ghost repeat's
  // ends) or across a ghost stretch: those reversals are the rider's too, and a ghost is never drawn
  const ghost = ghostMask(route), keep = new Uint8Array(n);
  for (let i = 1; i < end; i++) {
    const ax = base.xs[i] - base.xs[i - 1], az = base.zs[i] - base.zs[i - 1], bx = base.xs[i + 1] - base.xs[i], bz = base.zs[i + 1] - base.zs[i];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if ((la > 1e-6 && lb > 1e-6 && (ax * bx + az * bz) / (la * lb) < -.7) || ghost?.[i]) keep[i] = 1;
  }
  const margin = Math.ceil(o.marginM / 10), spans = [];
  for (const i of tight) {
    let a = Math.max(2, i - margin), b = Math.min(end - 2, i + 1 + margin);
    // a window stops 3 samples short of a U-turn or a ghost (none at all when the tight spot is one)
    for (let j = i - 2; j <= i + 3; j++) if (keep[j]) a = b;
    for (let j = i - 3; j >= a - 3 && j >= 0; j--) if (keep[j]) { a = j + 4; break; }
    for (let j = i + 4; j <= b + 3 && j < n; j++) if (keep[j]) { b = j - 4; break; }
    if (b - a < 4) continue;
    if (spans.length && a <= spans[spans.length - 1][1]) spans[spans.length - 1][1] = Math.max(spans[spans.length - 1][1], b);
    else spans.push([a, b]);
  }
  const windows = [];
  let after = Infinity, maxShift = 0, lengthChange = 0;
  for (const [a, b] of spans) {
    const K = Math.round((b - a) / WIN_STEP), ox = new Float64Array(K + 1), oz = new Float64Array(K + 1);
    for (let k = 0; k <= K; k++) { const p = P(a + k * WIN_STEP); ox[k] = p.x; oz[k] = p.z; }
    let best = null;
    // the tightest radius that keeps the line within maxShiftM of the original: try minRadiusM, then less
    for (let r = o.minRadiusM; r >= 1.5 && !best; r *= .85) {
      const e = easeWindow(ox, oz, r);
      let shift = 0; for (let k = 0; k <= K; k++) shift = Math.max(shift, Math.hypot(e.x[k] - ox[k], e.z[k] - oz[k]));
      if (shift <= o.maxShiftM || r * .85 < 1.5) best = { ...e, shift, r };
    }
    lengthChange += best.length - best.length0;
    maxShift = Math.max(maxShift, best.shift);
    for (let k = 2; k <= K - 2; k++) after = Math.min(after, circumRadius(best.x[k - 2], best.z[k - 2], best.x[k], best.z[k], best.x[k + 2], best.z[k + 2]));
    windows.push({ a, b, x: best.x, z: best.z, K, radius: best.r });
    // the samples inside (not the two next to each end: the curve just outside the window is drawn through those)
    for (let i = a + 2; i <= b - 2; i++) { const k = Math.round((i - a) / WIN_STEP); xs[i] = best.x[k]; zs[i] = best.z[k]; }
  }
  if (mirrored) for (let i = turn + 1; i < n; i++) { xs[i] = xs[2 * turn - i]; zs[i] = zs[2 * turn - i]; }
  return { windows, mirror: mirrored ? turn : null, stats: { windows: windows.length, minRadiusBefore: before, minRadiusAfter: windows.length ? after : before, maxShift, lengthChange } };
}

/** Unit tangent of the curve between samples i and i+1 at fraction f: {x, z}. */
export function curveTangent(index, i, f) {
  let d;
  const hit = index.turns && turnWindow(index, i, f);   // [smooth-turns]
  if (hit) {
    const { w, t, sign } = hit, k = Math.min(w.K - 1, Math.floor(t));
    d = crAt(w.x, w.z, w.K + 1, k, t - k, true); d.x *= sign; d.z *= sign;
  } else d = crAt(index.xs, index.zs, index.xs.length, i, f, true);
  const l = Math.hypot(d.x, d.z);
  if (l > 1e-9) return { x: d.x / l, z: d.z / l };
  const n = index.xs.length, j = Math.min(n - 1, i + 1), h = Math.max(0, j - 1), dx = index.xs[j] - index.xs[h], dz = index.zs[j] - index.zs[h], m = Math.hypot(dx, dz) || 1;
  return { x: dx / m, z: dz / m };
}

/** Point on the curve between samples i and i+1 at fraction f: {x, z} (uniform Catmull-Rom, ends extrapolated). */
export function curveXZ(index, i, f) {
  const hit = index.turns && turnWindow(index, i, f);   // [smooth-turns] an eased turn
  if (hit) { const { w, t } = hit, k = Math.min(w.K - 1, Math.floor(t)); return crAt(w.x, w.z, w.K + 1, k, t - k, false); }
  const n = index.xs.length, X = index.xs, Z = index.zs;
  const at = (k, A) => (k < 0 ? 2 * A[0] - A[1] : k >= n ? 2 * A[n - 1] - A[n - 2] : A[k]);
  return { x: cr(at(i - 1, X), X[i], at(i + 1, X), at(i + 2, X), f), z: cr(at(i - 1, Z), Z[i], at(i + 1, Z), at(i + 2, Z), f) };
}

/**
 * The route subdivided along the curve (up to `per` points per 10 m sample): [route-like, index-like] with dist,
 * ele, turnIdx and xs, zs, so ribbon builders written for the 10 m samples draw the curve unchanged. Heights stay
 * straight between samples (as the rider's). Without the curve it returns its inputs.
 * [w2-align] Adaptive: a piece whose curve bows less than 2 cm from its chord stays one piece, less than 12 cm two,
 * else `per` — the drawn line stays within ~3 cm of the curve, and long straight roads (Going-to-the-Sun: 75 km
 * of ribbons, drawn whole) don't pay four times the triangles.
 */
export function denseRoad(route, index, per = 4) {
  if (!curveOn(route)) return [route, index];
  const key = `_dense${per}`;
  if (route[key]?.index === index) return route[key].pair;
  const n = route.dist.length, xs = [], zs = [], ele = [], dist = [];
  // [smooth-turns] with roadAlign.turns: finer in turns (≤ stepDeg between cross-sections), and the curve's own tangents
  const T = turnOptions(route), tx = T ? [] : null, tz = T ? [] : null;
  let turnIdx = route.turnIdx;
  for (let i = 0; i < n - 1; i++) {
    if (i === route.turnIdx) turnIdx = xs.length;
    const mid = curveXZ(index, i, .5);
    const bow = Math.hypot(mid.x - (index.xs[i] + index.xs[i + 1]) / 2, mid.z - (index.zs[i] + index.zs[i + 1]) / 2);
    let k = bow < .02 ? 1 : bow < .12 ? Math.min(2, per) : per;
    if (T) {
      // [smooth-turns] a piece whose even cut steps more than refineDeg: a cross-section wherever the heading has
      // turned stepDeg since the last one (walked in 1/64 steps, so a turn bunched at one end of the piece is cut as
      // finely as an even one), and at least as many as the bow asks for. Any other piece keeps exactly its even
      // cut, so the drawn line (and the junctions and road meets built on it) changes only in the tight turns.
      const SUB = 64, lim = T.stepDeg * Math.PI / 180, ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
      let fs = [], even = true;
      {
        let maxStep = 0, prev = curveTangent(index, i, 0);
        for (let q = 1; q <= k; q++) { const t = curveTangent(index, i, q / k); maxStep = Math.max(maxStep, ang(prev, t)); prev = t; }
        even = maxStep <= T.refineDeg * Math.PI / 180;
      }
      if (even) for (let q = 0; q < k; q++) fs.push(q / k);
      else {
        fs = [0];
        let last = curveTangent(index, i, 0), lastF = 0;
        for (let q = 1; q < SUB; q++) {
          const f = q / SUB, t = curveTangent(index, i, f);
          if (ang(last, t) >= lim * .999 || f - lastF >= 1 / k - 1e-9) { fs.push(f); last = t; lastF = f; }
        }
      }
      for (const f of fs) {
        const p = curveXZ(index, i, f);   // (at f = 0 outside an eased window: the sample itself, exactly)
        const t = i === route.turnIdx && !f && tx.length ? { x: tx[tx.length - 1], z: tz[tz.length - 1] } : curveTangent(index, i, f);   // (the turnaround keeps the way out's heading)
        xs.push(p.x); zs.push(p.z); tx.push(t.x); tz.push(t.z);
        ele.push(route.ele[i] + (route.ele[i + 1] - route.ele[i]) * f);
        dist.push(route.dist[i] + (route.dist[i + 1] - route.dist[i]) * f);
      }
      continue;
    }
    for (let q = 0; q < k; q++) {
      const f = q / k, p = q ? curveXZ(index, i, f) : { x: index.xs[i], z: index.zs[i] };
      xs.push(p.x); zs.push(p.z);
      ele.push(route.ele[i] + (route.ele[i + 1] - route.ele[i]) * f);
      dist.push(route.dist[i] + (route.dist[i + 1] - route.dist[i]) * f);
    }
  }
  if (n - 1 === route.turnIdx) turnIdx = xs.length;
  xs.push(index.xs[n - 1]); zs.push(index.zs[n - 1]); ele.push(route.ele[n - 1]); dist.push(route.dist[n - 1]);
  if (T) { const t = curveTangent(index, n - 2, 1); tx.push(t.x); tz.push(t.z); }
  const F = (a) => Float64Array.from(a);
  const pair = [{ ...route, dist: F(dist), ele: F(ele), turnIdx, [key]: undefined }, T ? { xs: F(xs), zs: F(zs), tx: F(tx), tz: F(tz) } : { xs: F(xs), zs: F(zs) }];
  Object.defineProperty(route, key, { value: { index, pair }, enumerable: false, configurable: true, writable: true });
  return pair;
}

/**
 * [smooth-turns] Cross-sections of a ribbon along the drawn road: for each dense point i < n, the left and right
 * edge points at half-width hw. Uses the curve's tangents when the dense road carries them (roadAlign.turns) and
 * then clamps each edge so it never runs backwards along the road (no fold on the inside of a tight turn);
 * otherwise the old central-difference sections, unchanged. Returns Float64Array [lx, lz, rx, rz] × n.
 */
export function ribbonSections(index, n, hw) {
  const out = new Float64Array(n * 4), T = !!index.tx;
  for (let i = 0; i < n; i++) {
    let dx, dz;
    if (T) { dx = index.tx[i]; dz = index.tz[i]; }
    else {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      dx = index.xs[b] - index.xs[a]; dz = index.zs[b] - index.zs[a];
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    }
    const rx = -dz, rz = dx;
    out[i * 4] = index.xs[i] - rx * hw; out[i * 4 + 1] = index.zs[i] - rz * hw;
    out[i * 4 + 2] = index.xs[i] + rx * hw; out[i * 4 + 3] = index.zs[i] + rz * hw;
  }
  if (!T) return out;
  for (const side of [0, 2]) for (let i = 1; i < n; i++) {
    // moving backwards (against this section's tangent) from the previous section's edge: hold it there
    const px = out[(i - 1) * 4 + side], pz = out[(i - 1) * 4 + side + 1];
    if ((out[i * 4 + side] - px) * index.tx[i] + (out[i * 4 + side + 1] - pz) * index.tz[i] < 0) { out[i * 4 + side] = px; out[i * 4 + side + 1] = pz; }
  }
  return out;
}

// ---------------------------------------------------------------- street profiles
export const STREET_DEFAULTS = {
  smoothM: 9,          // σ of the along-street smoothing (m)
  maxGrade: .3,        // steepest street grade (Pittsburgh's steepest real streets are ~30 %)
  maxGradeChange: .02, // grade change per metre of street (crest/sag radius ≥ 50 m)
  maxDeviation: 3,     // a street may sit at most this far from its own ground (m), except at pinned points
  fadeM: 30,           // a junction's correction fades out along a dead-end street over this distance
};

/**
 * Align the heights of city streets in place.
 * streets: [{bridge, width, pts: [{x, y, z, pin?}]}] — bridge decks keep their heights; points with `pin` (e.g.
 * where a street meets the route) keep theirs. Junction nodes are the points shared exactly by two or more
 * streets (OSM node positions). `options.ground(x, z)`: the bare ground under a street (default: the heights
 * given); `options.floor`: lowest height of a ground street (e.g. just over the water); `options.nearRoute(x, z)`: 1 where the route's own bank decides the ground, falling to 0 away from it. Returns the junction list (also stored as streets.junctions).
 */
export function alignStreetProfiles(...args) { return drain(alignStreetProfilesJob(...args)); }
/** alignStreetProfiles as a job (js/world/toolbox/core/jobs.js): pauses between streets when its slice is used up. */
export function* alignStreetProfilesJob(streets, options = {}) {
  const o = { ...STREET_DEFAULTS, ...options };
  const key = (p) => Math.round(p.x * 100) * 4194304 + Math.round(p.z * 100);   // cm grid (±20 km)
  const nodes = new Map();
  yield* each(streets, (st, k) => st.pts.forEach((p, i) => {
    const id = key(p);
    if (!nodes.has(id)) nodes.set(id, []);
    nodes.get(id).push([k, i]);
  }));
  const junctions = [];
  for (const [, refs] of nodes) {
    if (due()) yield;
    if (new Set(refs.map((r) => r[0])).size < 2 && refs.length < 2) continue;
    junctions.push({ refs, x: streets[refs[0][0]].pts[refs[0][1]].x, z: streets[refs[0][0]].pts[refs[0][1]].z });
  }
  // the reference profile: the heights given (the ground, raised towards the route's road near it), except that
  // a street mapped below another level (layer < 0: under a deck or the route) that never meets the route follows
  // its own bare ground (o.ground) instead of riding up the route's bank
  const y0 = yield* mapJob(streets, (st) => {
    const own = o.ground && st.layer < 0 && !st.bridge && !st.pts.some((p) => p.pin);
    // a ground street never runs below the water's surface (riverside streets mapped on the water's edge cells)
    if (!own) return st.pts.map((p) => (st.bridge || p.pin || o.floor == null ? p.y : Math.max(p.y, o.floor)));
    // (within ~16 m of the route the route's bank still decides: the 6 m ground mesh can't drop faster)
    return st.pts.map((p) => { const w = o.nearRoute ? o.nearRoute(p.x, p.z) : 0; return Math.max(o.floor ?? -Infinity, p.y * w + o.ground(p.x, p.z) * (1 - w)); });
  });
  // along-street distance
  const S = yield* mapJob(streets, (st) => { let a = 0; return st.pts.map((p, i) => (i ? (a += Math.hypot(p.x - st.pts[i - 1].x, p.z - st.pts[i - 1].z)) : 0)); });
  // 1. smooth each ground street along its length (Gaussian in metres, ends held by reflection)
  const smooth = yield* mapJob(streets, (st, k) => {
    const P = st.pts, s = S[k], n = P.length, out = new Float64Array(n);
    if (st.bridge || n < 3) { P.forEach((p, i) => { out[i] = y0[k][i]; }); return out; }
    const sg = o.smoothM, span = 2.5 * sg;
    for (let i = 0; i < n; i++) {
      if (P[i].pin) { out[i] = P[i].y; continue; }
      let w = 0, v = 0;
      for (let j = i; j >= 0 && s[i] - s[j] <= span; j--) { const g = Math.exp(-(((s[i] - s[j]) / sg) ** 2) / 2); w += g; v += g * y0[k][j]; }
      for (let j = i + 1; j < n && s[j] - s[i] <= span; j++) { const g = Math.exp(-(((s[j] - s[i]) / sg) ** 2) / 2); w += g; v += g * y0[k][j]; }
      out[i] = v / w;
    }
    return out;
  });
  // 2. one height per junction: a deck's, else a pinned point's, else the width-weighted mean of its streets
  const target = new Map();   // (k * 65536 + i) → height
  const settle = function* (cur) {
    target.clear();
    for (const j of junctions) {
      if (due()) yield;
      let y = null, deck = false, route = false, w = 0, v = 0;
      for (const [k, i] of j.refs) {
        const st = streets[k];
        if (st.bridge) { y = y == null || !deck ? st.pts[i].y : Math.max(y, st.pts[i].y); deck = true; }
        else if (st.pts[i].pin && !deck) { y = st.pts[i].y; route = true; }
        w += st.width; v += st.width * cur[k][i];
      }
      // streets that merely cross at different levels (a deck over a street) aren't one junction
      j.y = y ?? v / w; j.deck = deck; j.route = route; j.hard = y != null;
    }
    yield* relaxJunctions(cur);
    // (a deck or the route only joins the streets that reach it within 4 m; the rest pass under or over)
    for (const j of junctions) for (const [k, i] of j.refs) if (!streets[k].bridge && (!j.hard || Math.abs(cur[k][i] - j.y) < 4)) target.set((k * 65536 + i), j.y);
  };
  // Junctions joined by a street must not be steeper apart than the street may be: soft junctions (no deck, no
  // route) give way, pulled towards each other along every street between consecutive fixed points.
  const jAt = new Map();
  junctions.forEach((j, n) => j.refs.forEach(([k, i]) => jAt.set((k * 65536 + i), n)));
  const links = [];
  streets.forEach((st, k) => {
    if (st.bridge) return;
    let prev = null;
    st.pts.forEach((p, i) => {
      const n = jAt.get((k * 65536 + i)) ?? (p.pin ? -1 : undefined);
      if (n === undefined) return;
      if (prev && n >= 0 && prev.n >= 0 && n !== prev.n) links.push([prev.n, n, S[k][i] - prev.s]);
      prev = { n, s: S[k][i] };
    });
  });
  const relaxJunctions = function* (cur) {
    for (let it = 0; it < 60; it++) {
      if (due()) yield;
      let moved = false;
      for (const [a, b, len] of links) {
        const A = junctions[a], B = junctions[b], d = B.y - A.y, over = Math.abs(d) - o.maxGrade * Math.max(1, len);
        if (over <= 1e-3 || (A.hard && B.hard)) continue;
        const fa = A.hard ? 0 : B.hard ? 1 : .5, fb = 1 - fa;
        A.y += Math.sign(d) * over * fa; B.y -= Math.sign(d) * over * fb; moved = true;
      }
      if (!moved) break;
    }
  };
  const solve = (cur) => mapGen(streets, function* (st, k) {
    const P = st.pts, s = S[k], n = P.length, y = Float64Array.from(cur[k]);
    if (st.bridge) return y;
    const fixed = new Uint8Array(n), corr = [];
    for (let i = 0; i < n; i++) {
      const t = target.get((k * 65536 + i)) ?? (P[i].pin ? y0[k][i] : null);
      if (t != null) { fixed[i] = 1; corr.push([s[i], t - y[i]]); }
    }
    // spread the corrections linearly between fixed points, fading out past the last one
    if (corr.length) {
      for (let i = 0, c = 0; i < n; i++) {
        while (c + 1 < corr.length && corr[c + 1][0] <= s[i]) c++;
        let d;
        if (s[i] <= corr[0][0]) d = corr[0][1] * Math.max(0, 1 - (corr[0][0] - s[i]) / o.fadeM);
        else if (c + 1 >= corr.length) d = corr[c][1] * Math.max(0, 1 - (s[i] - corr[c][0]) / o.fadeM);
        else { const f = (s[i] - corr[c][0]) / Math.max(1e-6, corr[c + 1][0] - corr[c][0]); d = corr[c][1] + (corr[c + 1][1] - corr[c][1]) * f; }
        y[i] += d;
      }
      for (let i = 0; i < n; i++) if (fixed[i]) y[i] = target.get((k * 65536 + i)) ?? y0[k][i];
    }
    yield* limitProfileJob(y, s, fixed, y0[k], o);
    return y;
  });
  let cur = smooth;
  for (let pass = 0; pass < 2; pass++) { yield* settle(cur); cur = yield* solve(cur); }
  yield* each(streets, (st, k) => { if (!st.bridge) st.pts.forEach((p, i) => { p.y = cur[k][i]; }); });
  const out = junctions.map((j) => ({ x: j.x, z: j.z, y: j.y, deck: j.deck, route: j.route, streets: [...new Set(j.refs.map((r) => r[0]))] }));
  Object.defineProperty(streets, 'junctions', { value: out, enumerable: false, configurable: true });
  return out;
}

/** After a later pass pins some street points (e.g. kept under the route's road), give every other ground street
 *  through the same junction node the same height, so a junction never splits into two levels. */
export function syncPinnedNodes(...args) { return drain(syncPinnedNodesJob(...args)); }
export function* syncPinnedNodesJob(streets) {
  const key = (p) => `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`, pinned = new Map();
  for (const st of streets) { if (!st.bridge) for (const p of st.pts) if (p.pin) pinned.set(key(p), Math.min(pinned.get(key(p)) ?? Infinity, p.y)); if (due()) yield; }
  for (const st of streets) { if (!st.bridge) for (const p of st.pts) { const y = pinned.get(key(p)); if (y != null && Math.abs(p.y - y) < 4) { p.y = y; p.pin = true; } } if (due()) yield; }
}

/** Grade, grade-change and deviation limits on one profile (in place; `fixed` samples never move). */
export function limitProfile(...args) { return drain(limitProfileJob(...args)); }
export function* limitProfileJob(y, s, fixed, ground, o = STREET_DEFAULTS) {
  const n = y.length;
  for (let it = 0; it < 40; it++) {
    if (due()) yield;
    let moved = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      const lo = ground[i] - o.maxDeviation, hi = ground[i] + o.maxDeviation;
      if (y[i] < lo || y[i] > hi) { y[i] = Math.min(hi, Math.max(lo, y[i])); moved = true; }
    }
    for (let i = 0; i + 1 < n; i++) {
      const ds = Math.max(.5, s[i + 1] - s[i]), d = y[i + 1] - y[i], over = Math.abs(d) - o.maxGrade * ds;
      if (over <= 1e-4) continue;
      moved = true;
      const a = fixed[i] ? 0 : fixed[i + 1] ? 1 : .5, b = fixed[i + 1] ? 0 : fixed[i] ? 1 : .5;
      y[i] += Math.sign(d) * over * a; y[i + 1] -= Math.sign(d) * over * b;
    }
    for (let i = 1; i + 1 < n; i++) {
      if (fixed[i]) continue;
      const d1 = Math.max(.5, s[i] - s[i - 1]), d2 = Math.max(.5, s[i + 1] - s[i]);
      const g1 = (y[i] - y[i - 1]) / d1, g2 = (y[i + 1] - y[i]) / d2, lim = o.maxGradeChange * (d1 + d2) / 2;
      if (Math.abs(g2 - g1) <= lim + 1e-6) continue;
      // move y[i] towards the straight line through its neighbours just enough
      const line = y[i - 1] + (y[i + 1] - y[i - 1]) * d1 / (d1 + d2);
      const k = 1 - lim / Math.abs(g2 - g1);
      y[i] += (line - y[i]) * k * .7; moved = true;
    }
    if (!moved) break;
  }
  // the grade limit has the last word (a street may leave its ground by more than maxDeviation rather than drop
  // like a ramp where its ground is carved away)
  for (let it = 0; it < 40; it++) {
    if (due()) yield;
    let moved = false;
    for (let i = 0; i + 1 < n; i++) {
      const ds = Math.max(.5, s[i + 1] - s[i]), d = y[i + 1] - y[i], over = Math.abs(d) - o.maxGrade * ds;
      if (over <= 1e-4 || (fixed[i] && fixed[i + 1])) continue;
      const a = fixed[i] ? 0 : fixed[i + 1] ? 1 : .5;
      y[i] += Math.sign(d) * over * a; y[i + 1] -= Math.sign(d) * over * (1 - a); moved = true;
    }
    for (let i = 1; i + 1 < n; i++) {
      if (fixed[i]) continue;
      const d1 = Math.max(.5, s[i] - s[i - 1]), d2 = Math.max(.5, s[i + 1] - s[i]);
      const g1 = (y[i] - y[i - 1]) / d1, g2 = (y[i + 1] - y[i]) / d2, lim = o.maxGradeChange * (d1 + d2) / 2;
      if (Math.abs(g2 - g1) <= lim + 1e-6) continue;
      const line = y[i - 1] + (y[i + 1] - y[i - 1]) * d1 / (d1 + d2);
      y[i] += (line - y[i]) * (1 - lim / Math.abs(g2 - g1)) * .7; moved = true;
    }
    if (!moved) break;
  }
  return y;
}

// ---------------------------------------------------------------- metrics (QC and the alignment report)
/** Turn rate of a polyline at each interior vertex, degrees per metre. */
export function turnRates(pts) {
  const out = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    if (l1 < .05 || l2 < .05) { out.push(0); continue; }
    const t = ((Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x)) * 180 / Math.PI + 540) % 360 - 180;
    out.push(t / ((l1 + l2) / 2));
  }
  return out;
}
