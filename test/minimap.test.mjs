// The ride-screen minimap's view window (js/minimap-view.js) and its drawing (js/views.js drawMinimap,
// drawNetworkMinimap) on a recording canvas: zoomed in ~3 km across, centred a little ahead of the rider, north up,
// only what's in view drawn, the arrow half its old size, the lean eased (no jump at a junction).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPAN_M, AHEAD_M, AHEAD_SHARE, ARROW_SCALE, CHUNK, metresPerDeg, projectLine, withBoxes, makeView, toPx, visibleRuns, easeLean, aheadIndex,
} from '../js/minimap-view.js';

// ---- a recording 2D context (no browser) ----
class RecPath {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(['M', x, y]); }
  lineTo(x, y) { this.ops.push(['L', x, y]); }
}
function recCanvas(w = 200, h = 200) {
  const log = [];
  const ctx = new Proxy({ log, transform: [] }, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { log.push([k, ...a]); if (k === 'setTransform') t.transform = a; };
    },
    set(t, k, v) { log.push(['=' + String(k), v]); return true; },
  });
  return { clientWidth: w, clientHeight: h, width: 0, height: 0, getContext: () => ctx, ctx };
}
globalThis.window ??= { devicePixelRatio: 2 };
globalThis.document ??= { documentElement: { dataset: {} } };
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
globalThis.Path2D ??= RecPath;
const { drawMinimap, drawNetworkMinimap } = await import('../js/views.js');

// A straight route due east from (40.44, -80): n samples 10 m apart.
const LAT0 = 40.44, { kx, ky } = metresPerDeg(LAT0);
function eastRoute(n, { closed = false } = {}) {
  const lat = new Float64Array(n).fill(LAT0), lon = new Float64Array(n);
  for (let i = 0; i < n; i++) lon[i] = -80 + (i * 10) / kx;
  return { lat, lon, total: (n - 1) * 10, closed };
}
const strokes = (ctx) => ctx.log.filter((e) => e[0] === 'stroke' && e[1] instanceof RecPath).map((e) => e[1]);
const pts = (path) => path.ops.map(([, x, y]) => [x, y]);

test('view: ~3 km across the larger side, north up, centred on the rider plus the lean', () => {
  const v = makeView(200, 150, { mode: 'follow', rx: 1000, ry: 2000, off: { dx: 300, dy: -100 } });
  assert.equal(SPAN_M, 3000);
  assert.ok(Math.abs(200 / v.s - 3000) < 1e-9, 'the wider side shows 3 km');
  assert.deepEqual([v.cx, v.cy], [1300, 1900]);
  // north up: a point north of the centre is above it, east is right
  const [x0, y0] = toPx(v, v.cx, v.cy), [xn, yn] = toPx(v, v.cx, v.cy + 100), [xe] = toPx(v, v.cx + 100, v.cy);
  assert.deepEqual([x0, y0], [100, 75]);
  assert.ok(yn < y0 && xn === x0 && xe > x0);
  // the rider is in the view, inside its middle third
  const [rx, ry] = toPx(v, 1000, 2000);
  assert.ok(rx > 200 / 3 - 30 && rx < 200 && ry > 0 && ry < 150);
  // the bounds cover the canvas plus the margin
  assert.ok(Math.abs((v.x1 - v.x0) * v.s - (200 + 20)) < 1e-9);
  // course mode fits the bounds
  const c = makeView(200, 200, { mode: 'course', bounds: { minX: 0, minY: 0, maxX: 10000, maxY: 5000 } });
  assert.ok(Math.abs(c.s - 172 / 10000) < 1e-12);
  assert.deepEqual([c.cx, c.cy], [5000, 2500]);
});

test('clipping: chunks with boxes, only the runs in view', () => {
  const r = eastRoute(1001);   // 10 km east
  const L = projectLine(r.lat, r.lon, kx, ky);
  assert.equal(L.boxes.length / 4, Math.ceil(1000 / CHUNK));
  assert.ok(Math.abs(L.maxX - L.minX - 10000) < 1e-6);
  const x0 = L.x[0], y = L.y[0];
  // a 3 km view centred 5 km along: one run, covering 5 km ± 1.5 km (to the chunk), not the whole line
  const v = makeView(200, 200, { mode: 'follow', rx: x0 + 5000, ry: y });
  const runs = visibleRuns(L, v);
  assert.equal(runs.length, 1);
  const [a, b] = runs[0];
  assert.ok(a <= 350 && a >= 350 - CHUNK - 2, `run starts at ${a}`);
  assert.ok(b >= 650 && b <= 650 + CHUNK + 2, `run ends at ${b}`);
  // from/to limit the run; a view off the line has none
  assert.deepEqual(visibleRuns(L, v, 500, 520), [[500, 520]]);
  assert.deepEqual(visibleRuns(L, makeView(200, 200, { rx: x0 + 5000, ry: y + 5000 })), []);
  // a line that leaves and comes back: two runs
  const xs = new Float64Array(400), ys = new Float64Array(400);
  for (let i = 0; i < 400; i++) { xs[i] = i < 200 ? i * 20 : (399 - i) * 20; ys[i] = i < 200 ? 0 : 50; }
  const U = withBoxes(xs, ys);
  assert.equal(visibleRuns(U, makeView(200, 200, { rx: 0, ry: 0 })).length, 2);
});

test('lean ahead: towards the way ahead, eased over time, no jump when it changes', () => {
  assert.equal(aheadIndex(10, 1000), 10 + AHEAD_M / 10);
  assert.equal(aheadIndex(990, 1000), 999);                 // the end of a point-to-point route: the end
  assert.equal(aheadIndex(990, 1000, AHEAD_M, true), (990 + 90) % 999);   // a loop: wraps round
  const s = { dx: 0, dy: 0, t: null };
  assert.deepEqual(easeLean(s, 900, 0, 1000), { dx: 900 * AHEAD_SHARE, dy: 0 });   // first draw: at the target
  // the way ahead turns north at a junction: the lean moves only part of the way in 200 ms
  const e = easeLean(s, 0, 900, 1200);
  assert.ok(e.dx < 450 && e.dx > 300 && e.dy > 0 && e.dy < 150, JSON.stringify(e));
  for (let t = 1400; t <= 6000; t += 200) easeLean(s, 0, 900, t);
  assert.ok(Math.abs(s.dx) < 1 && Math.abs(s.dy - 450) < 1);
  // after a long gap (a new ride) it starts at the target
  assert.deepEqual(easeLean(s, -900, 0, 20000), { dx: -450, dy: 0 });
});

test('drawMinimap follow: rider a little behind centre, ~3 km shown, only the part in view drawn, arrow at half size', () => {
  const r = eastRoute(2001);   // 20 km east
  const c = recCanvas(200, 200);
  drawMinimap(c, r, 10000, { mode: 'follow', now: 0 });
  assert.equal(c.width, 400, 'crisp at devicePixelRatio 2');
  assert.deepEqual(c.ctx.transform, [2, 0, 0, 2, 0, 0]);
  // the arrow: translated to the rider, scaled by half
  const tr = c.ctx.log.find((e) => e[0] === 'translate'), sc = c.ctx.log.find((e) => e[0] === 'scale');
  assert.deepEqual(sc.slice(1), [ARROW_SCALE, ARROW_SCALE]);
  assert.equal(ARROW_SCALE, 0.5);
  const leanPx = (AHEAD_M * AHEAD_SHARE * 200) / 3000;   // heading east: the rider sits left of centre
  assert.ok(Math.abs(tr[1] - (100 - leanPx)) < 0.5 && Math.abs(tr[2] - 100) < 0.5, `rider at ${tr[1]}, ${tr[2]}`);
  // the outline drawn: only the ~3 km in view (plus a chunk each side), not the 20 km route
  const [outline] = strokes(c.ctx);
  const xs = pts(outline).map(([x]) => x);
  assert.ok(Math.min(...xs) > -60 && Math.max(...xs) < 260, `outline x from ${Math.min(...xs)} to ${Math.max(...xs)}`);
  assert.ok(outline.ops.length < 260, `${outline.ops.length} vertices`);
  // course mode: the whole route, the rider where the route has them
  const cc = recCanvas(200, 200);
  drawMinimap(cc, r, 10000, { mode: 'course' });
  const xs2 = pts(strokes(cc.ctx)[0]).map(([x]) => x);
  assert.ok(Math.abs(Math.min(...xs2) - 14) < 0.5 && Math.abs(Math.max(...xs2) - 186) < 0.5);
});

test('drawMinimap follow moves smoothly as the rider rides (no jump through a loop\'s start)', () => {
  const n = 1201, lat = new Float64Array(n), lon = new Float64Array(n);   // a 12 km circle, closed
  const R = 12000 / (2 * Math.PI);
  for (let i = 0; i < n; i++) { const a = (i / (n - 1)) * 2 * Math.PI; lat[i] = LAT0 + (R * Math.sin(a)) / ky; lon[i] = -80 + (R * Math.cos(a)) / kx; }
  const r = { lat, lon, total: 12000, closed: true };
  const c = recCanvas(200, 200);
  let prev = null;
  for (let k = 0; k < 120; k++) {
    const pos = (11400 + k * 10) % 12000, now = k * 200;   // 10 m every 200 ms, through the start
    c.ctx.log.length = 0;
    drawMinimap(c, r, pos, { mode: 'follow', now });
    const tr = c.ctx.log.find((e) => e[0] === 'translate');
    if (prev) assert.ok(Math.hypot(tr[1] - prev[0], tr[2] - prev[1]) < 1.5, `jump of ${Math.hypot(tr[1] - prev[0], tr[2] - prev[1])} px at ${pos} m`);
    prev = [tr[1], tr[2]];
  }
});

test('drawNetworkMinimap follow: the network clipped to the view, the path and the options drawn', () => {
  // a grid network: 21 east-west and 21 north-south lines, 1 km apart (20 km square)
  const lines = [];
  for (let k = 0; k <= 20; k++) {
    const m = 2001, la = new Float64Array(m), lo = new Float64Array(m), lb = new Float64Array(m), lc = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      la[i] = LAT0 + (k * 1000) / ky; lo[i] = -80 + (i * 10) / kx;
      lb[i] = LAT0 + (i * 10) / ky; lc[i] = -80 + (k * 1000) / kx;
    }
    lines.push({ id: `ew${k}`, lat: la, lon: lo }, { id: `ns${k}`, lat: lb, lon: lc });
  }
  const route = eastRoute(2001);
  for (let i = 0; i < 2001; i++) route.lat[i] = LAT0 + 10000 / ky;   // the path: along the middle east-west line
  let calls = 0;
  const ride = {
    route, version: 1,
    edgeLines() { calls++; return lines; },
    stub() { const lat = [], lon = []; for (let u = 0; u <= 220; u += 10) { lat.push(LAT0 + (10000 + u) / ky); lon.push(-80 + 11000 / kx); } return { lat, lon }; },
  };
  const up = { options: [{ t: 1 }, { t: 2 }], selected: 0, node: { lat: LAT0 + 10000 / ky, lon: -80 + 11000 / kx } };
  const c = recCanvas(200, 200);
  drawNetworkMinimap(c, ride, 10000, { mode: 'follow', up, pacerPos: { lat: LAT0 + 10000 / ky, lon: -80 + 9950 / kx }, now: 0 });
  const [faint, , ahead] = strokes(c.ctx);
  // the faint network: only the ~3 km in view: about 4 east-west and 4 north-south lines' worth, not 42 lines × 20 km
  const moves = faint.ops.filter((o) => o[0] === 'M').length;
  assert.ok(moves >= 6 && moves <= 12, `${moves} runs in view`);
  assert.ok(faint.ops.length < 2000, `${faint.ops.length} vertices (the whole network: ~42 000)`);
  for (const [x, y] of pts(faint)) assert.ok(x > -80 && x < 280 && y > -80 && y < 280, `vertex at ${x}, ${y}`);
  // the path ahead goes right (east) from the rider
  const ap = pts(ahead);
  assert.ok(ap.length > 2 && ap[ap.length - 1][0] > ap[0][0]);
  // the rider: left of centre (heading east), on the middle line
  const tr = c.ctx.log.find((e) => e[0] === 'translate');
  assert.ok(tr[1] < 100 && tr[1] > 60 && Math.abs(tr[2] - 100) < 0.5, `rider at ${tr[1]}, ${tr[2]}`);
  // the options' stubs and the pacer are drawn
  assert.ok(strokes(c.ctx).length >= 6);
  assert.ok(c.ctx.log.filter((e) => e[0] === 'arc').length >= 2);
  // drawn again 10 m on: the same picture, moved by under a pixel
  c.ctx.log.length = 0;
  drawNetworkMinimap(c, ride, 10010, { mode: 'follow', up, now: 200 });
  const tr2 = c.ctx.log.find((e) => e[0] === 'translate');
  assert.ok(Math.hypot(tr2[1] - tr[1], tr2[2] - tr[2]) < 1);
  assert.ok(calls >= 2);
});
