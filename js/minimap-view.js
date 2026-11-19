// The ride-screen minimap's view window (js/views.js drawMinimap / drawNetworkMinimap): pure maths, no DOM.
// Zoomed in it shows about SPAN_M across (the canvas's larger side), north up, centred a little ahead of the
// rider so more of the way ahead shows; the offset ahead eases (no jump when the path ahead changes at a
// junction). Lines are projected to metres once and cut into chunks with bounding boxes, so a draw only walks
// the chunks in view.

export const SPAN_M = 3000;          // zoomed in: metres across the minimap's larger side
export const AHEAD_M = 900;          // the view leans towards the point this far ahead on the route…
export const AHEAD_SHARE = 0.5;      // …by this share of the way to it (at most 450 m: the rider stays in the middle third)
export const EASE_S = 0.8;           // the lean eases with this time constant (s)
export const ARROW_SCALE = 0.5;      // the rider's arrow: half the size it was (18 Nov)
export const CHUNK = 32;             // points per clipping chunk

/** Metres per degree of longitude and latitude about latitude lat0 (equirectangular, north up). */
export function metresPerDeg(lat0) {
  return { kx: Math.cos((lat0 * Math.PI) / 180) * 111320, ky: 110540 };
}

/**
 * Projects a lat/lon line to metres (x east, y north) and cuts it into chunks of CHUNK segments, each with its
 * bounding box: boxes[4k..4k+3] = minX, minY, maxX, maxY of points k*CHUNK … (k+1)*CHUNK (the next chunk's first
 * point included, so every segment is in a chunk).
 */
export function projectLine(lat, lon, kx, ky) {
  const n = lat.length, x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = lon[i] * kx; y[i] = lat[i] * ky; }
  return withBoxes(x, y);
}

export function withBoxes(x, y) {
  const n = x.length, nc = Math.max(1, Math.ceil((n - 1) / CHUNK)), boxes = new Float64Array(nc * 4);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < nc; k++) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = k * CHUNK, e = Math.min(n - 1, (k + 1) * CHUNK); i <= e; i++) {
      if (x[i] < a) a = x[i]; if (x[i] > c) c = x[i]; if (y[i] < b) b = y[i]; if (y[i] > d) d = y[i];
    }
    boxes[k * 4] = a; boxes[k * 4 + 1] = b; boxes[k * 4 + 2] = c; boxes[k * 4 + 3] = d;
    minX = Math.min(minX, a); minY = Math.min(minY, b); maxX = Math.max(maxX, c); maxY = Math.max(maxY, d);
  }
  return { x, y, boxes, minX, minY, maxX, maxY };
}

/**
 * The view for a w × h canvas. Zoomed in ('follow'): SPAN_M (spanM) across the larger side, centred at the rider
 * (rx, ry) plus the eased lean `off` ({dx, dy}, metres). 'course': the whole of bounds ({minX, minY, maxX, maxY})
 * with `pad` px round it. North up either way. The view's bounds (x0…x1, y0…y1, metres) include `marginPx` so a
 * line just outside still draws its width.
 */
export function makeView(w, h, { mode = 'follow', rx = 0, ry = 0, off = null, spanM = SPAN_M, bounds = null, pad = 14, marginPx = 10 } = {}) {
  let s, cx, cy;
  if (mode === 'follow' || !bounds) {
    s = Math.max(w, h) / spanM;
    cx = rx + (off?.dx || 0); cy = ry + (off?.dy || 0);
  } else {
    s = Math.min((w - pad * 2) / (bounds.maxX - bounds.minX || 1), (h - pad * 2) / (bounds.maxY - bounds.minY || 1));
    cx = (bounds.minX + bounds.maxX) / 2; cy = (bounds.minY + bounds.maxY) / 2;
  }
  const hx = (w / 2 + marginPx) / s, hy = (h / 2 + marginPx) / s;
  return { s, cx, cy, w, h, x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}

/** Canvas px of a point in metres (north up: y grows down the canvas). */
export const toPx = (v, x, y) => [v.w / 2 + (x - v.cx) * v.s, v.h / 2 - (y - v.cy) * v.s];

/** Does a box (minX, minY, maxX, maxY) touch the view? */
export const boxInView = (v, a, b, c, d) => c >= v.x0 && a <= v.x1 && d >= v.y0 && b <= v.y1;

/**
 * The index runs [i, j] of a projected line (projectLine) between indices from and to whose chunks touch the view,
 * consecutive chunks merged. Everything drawn on the minimap goes through these, so a draw walks only what shows.
 */
export function visibleRuns(L, v, from = 0, to = L.x.length - 1) {
  const runs = [];
  if (to <= from) return runs;
  const { boxes } = L;
  if (!boxInView(v, L.minX, L.minY, L.maxX, L.maxY)) return runs;
  const k0 = Math.floor(from / CHUNK), k1 = Math.min(boxes.length / 4 - 1, Math.floor((to - 1) / CHUNK));
  let open = -1;
  for (let k = k0; k <= k1; k++) {
    const on = boxInView(v, boxes[k * 4], boxes[k * 4 + 1], boxes[k * 4 + 2], boxes[k * 4 + 3]);
    if (on && open < 0) open = k;
    if ((!on || k === k1) && open >= 0) {
      const end = on ? k : k - 1;
      runs.push([Math.max(from, open * CHUNK), Math.min(to, (end + 1) * CHUNK)]);
      open = -1;
    }
  }
  return runs;
}

/**
 * The lean of the view towards the way ahead, eased: state ({dx, dy, t}) is kept per minimap. target is the
 * offset from the rider to the point AHEAD_M ahead (metres). Without a time (now == null) it doesn't ease; after a
 * long gap (a new ride, the minimap turned back on) it starts at the target.
 */
export function easeLean(state, tx, ty, now, share = AHEAD_SHARE) {
  const gx = tx * share, gy = ty * share;
  if (now == null || state.t == null || now - state.t > 3000 || now < state.t) { state.dx = gx; state.dy = gy; }
  else {
    const k = 1 - Math.exp(-(now - state.t) / 1000 / EASE_S);
    state.dx += (gx - state.dx) * k; state.dy += (gy - state.dy) * k;
  }
  state.t = now ?? null;
  return { dx: state.dx, dy: state.dy };
}

/** Index of the point `aheadM` metres past index i on a line of 10 m samples (wrapping on a closed loop). */
export function aheadIndex(i, n, aheadM = AHEAD_M, closed = false, stepM = 10) {
  const j = i + Math.round(aheadM / stepM);
  if (closed && n > 1) return j % (n - 1);
  return Math.min(n - 1, j);
}
