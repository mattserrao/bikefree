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
// Scene keys: "roadAlign": { "curve": true, "streets": true, "maxGrade": 0.3, … } (defaults in STREET_DEFAULTS).

/** Is the curved centre line on for this route? */
export const curveOn = (route) => !!route.scene?.roadAlign?.curve;

const cr = (p0, p1, p2, p3, f) => {
  const f2 = f * f, f3 = f2 * f;
  return .5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3);
};

/** Point on the curve between samples i and i+1 at fraction f: {x, z} (uniform Catmull-Rom, ends extrapolated). */
export function curveXZ(index, i, f) {
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
  let turnIdx = route.turnIdx;
  for (let i = 0; i < n - 1; i++) {
    if (i === route.turnIdx) turnIdx = xs.length;
    const mid = curveXZ(index, i, .5);
    const bow = Math.hypot(mid.x - (index.xs[i] + index.xs[i + 1]) / 2, mid.z - (index.zs[i] + index.zs[i + 1]) / 2);
    const k = bow < .02 ? 1 : bow < .12 ? Math.min(2, per) : per;
    for (let q = 0; q < k; q++) {
      const f = q / k, p = q ? curveXZ(index, i, f) : { x: index.xs[i], z: index.zs[i] };
      xs.push(p.x); zs.push(p.z);
      ele.push(route.ele[i] + (route.ele[i + 1] - route.ele[i]) * f);
      dist.push(route.dist[i] + (route.dist[i + 1] - route.dist[i]) * f);
    }
  }
  if (n - 1 === route.turnIdx) turnIdx = xs.length;
  xs.push(index.xs[n - 1]); zs.push(index.zs[n - 1]); ele.push(route.ele[n - 1]); dist.push(route.dist[n - 1]);
  const F = (a) => Float64Array.from(a);
  const pair = [{ ...route, dist: F(dist), ele: F(ele), turnIdx, [key]: undefined }, { xs: F(xs), zs: F(zs) }];
  Object.defineProperty(route, key, { value: { index, pair }, enumerable: false, configurable: true, writable: true });
  return pair;
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
export function alignStreetProfiles(streets, options = {}) {
  const o = { ...STREET_DEFAULTS, ...options };
  const key = (p) => Math.round(p.x * 100) * 4194304 + Math.round(p.z * 100);   // cm grid (±20 km)
  const nodes = new Map();
  streets.forEach((st, k) => st.pts.forEach((p, i) => {
    const id = key(p);
    if (!nodes.has(id)) nodes.set(id, []);
    nodes.get(id).push([k, i]);
  }));
  const junctions = [];
  for (const [, refs] of nodes) {
    if (new Set(refs.map((r) => r[0])).size < 2 && refs.length < 2) continue;
    junctions.push({ refs, x: streets[refs[0][0]].pts[refs[0][1]].x, z: streets[refs[0][0]].pts[refs[0][1]].z });
  }
  // the reference profile: the heights given (the ground, raised towards the route's road near it), except that
  // a street mapped below another level (layer < 0: under a deck or the route) that never meets the route follows
  // its own bare ground (o.ground) instead of riding up the route's bank
  const y0 = streets.map((st) => {
    const own = o.ground && st.layer < 0 && !st.bridge && !st.pts.some((p) => p.pin);
    // a ground street never runs below the water's surface (riverside streets mapped on the water's edge cells)
    if (!own) return st.pts.map((p) => (st.bridge || p.pin || o.floor == null ? p.y : Math.max(p.y, o.floor)));
    // (within ~16 m of the route the route's bank still decides: the 6 m ground mesh can't drop faster)
    return st.pts.map((p) => { const w = o.nearRoute ? o.nearRoute(p.x, p.z) : 0; return Math.max(o.floor ?? -Infinity, p.y * w + o.ground(p.x, p.z) * (1 - w)); });
  });
  // along-street distance
  const S = streets.map((st) => { let a = 0; return st.pts.map((p, i) => (i ? (a += Math.hypot(p.x - st.pts[i - 1].x, p.z - st.pts[i - 1].z)) : 0)); });
  // 1. smooth each ground street along its length (Gaussian in metres, ends held by reflection)
  const smooth = streets.map((st, k) => {
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
  const settle = (cur) => {
    target.clear();
    for (const j of junctions) {
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
    relaxJunctions(cur);
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
  const relaxJunctions = (cur) => {
    for (let it = 0; it < 60; it++) {
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
  const solve = (cur) => streets.map((st, k) => {
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
    limitProfile(y, s, fixed, y0[k], o);
    return y;
  });
  let cur = smooth;
  for (let pass = 0; pass < 2; pass++) { settle(cur); cur = solve(cur); }
  streets.forEach((st, k) => { if (!st.bridge) st.pts.forEach((p, i) => { p.y = cur[k][i]; }); });
  const out = junctions.map((j) => ({ x: j.x, z: j.z, y: j.y, deck: j.deck, route: j.route, streets: [...new Set(j.refs.map((r) => r[0]))] }));
  Object.defineProperty(streets, 'junctions', { value: out, enumerable: false, configurable: true });
  return out;
}

/** After a later pass pins some street points (e.g. kept under the route's road), give every other ground street
 *  through the same junction node the same height, so a junction never splits into two levels. */
export function syncPinnedNodes(streets) {
  const key = (p) => `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`, pinned = new Map();
  for (const st of streets) if (!st.bridge) for (const p of st.pts) if (p.pin) pinned.set(key(p), Math.min(pinned.get(key(p)) ?? Infinity, p.y));
  for (const st of streets) if (!st.bridge) for (const p of st.pts) { const y = pinned.get(key(p)); if (y != null && Math.abs(p.y - y) < 4) { p.y = y; p.pin = true; } }
}

/** Grade, grade-change and deviation limits on one profile (in place; `fixed` samples never move). */
export function limitProfile(y, s, fixed, ground, o = STREET_DEFAULTS) {
  const n = y.length;
  for (let it = 0; it < 40; it++) {
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
