// [F31] City life carried across an area swap (PLAN 5.4, 6.2). A city of areas draws one area at a time and each
// area has its own life (js/world/toolbox/city/life.js): people, cyclists, cars and buses on its own street networks,
// oncoming traffic on its own line, trains on its rails, boats on its rivers. Where the world swaps (inside an apron,
// 200 m past a portal) both areas are built from the same streets in the same frame, so the new area's life takes
// over the old one's agents where they are: each agent near the camera keeps its look, model, paint, speed and drawn
// place, and is put on the same street (way, distance along it, direction, side) of the new area's networks. What
// can't be matched (a street only one area keeps, cut back where only one area's route crosses it) is left dead, to
// appear again out of the rider's sight as the life always does. Nothing new appears in view on the swap's frame.
// Pure apart from the agents it writes: the life sim (test/city-life.test.mjs) rides it across the portals.

/** Nearest point on a polyline path ({pts, d}) to (x, z): {s, d, tx, tz, y} or null beyond `maxD`. */
function project(path, x, z, maxD) {
  const P = path.pts, D = path.d;
  let best = null;
  for (let k = 0; k + 1 < P.length; k++) {
    const a = P[k], b = P[k + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) continue;
    // (a quick reject: the segment's box, grown by maxD)
    if (x < Math.min(a.x, b.x) - maxD || x > Math.max(a.x, b.x) + maxD || z < Math.min(a.z, b.z) - maxD || z > Math.max(a.z, b.z) + maxD) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d <= maxD && (!best || d < best.d)) {
      const l = Math.sqrt(l2);
      best = { s: D[k] + (D[k + 1] - D[k]) * t, d, tx: dx / l, tz: dz / l, y: a.y + (b.y - a.y) * t };
    }
  }
  return best;
}

/** The ways of a network (life.js Network) passing within r of (x, z): way indices (from its 120 m cells). */
function waysNear(net, x, z, r) {
  const out = new Set(), cx = Math.floor(x / 120), cz = Math.floor(z / 120), k = Math.ceil(r / 120);
  for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) for (const [i] of net.cells.get(`${cx + a},${cz + b}`) || []) out.add(i);
  return out;
}

/**
 * Where agent `a` of the old network is on the new one: {way, s, dir, lat} or null. The old way's centre line at the
 * agent's distance (and its heading) is matched to the nearest way of the new network running the same way at the
 * same level (≤ 2.5 m off, ≤ ~37° apart); the side it walks or drives on is kept in the world, and so its offset.
 */
function locate(a, oldNet, newNet, at) {
  const w = oldNet.ways[a.way];
  if (!w) return null;
  const p = at(w.path, a.s, {});
  let best = null;
  // (strict first; then looser — a street the two areas' data bend or level a little differently, a corner)
  for (const [maxD, minCos, maxDy] of [[2.5, .8, 3], [4.5, .55, 4.5]]) {
    for (const i of waysNear(newNet, p.x, p.z, 40)) {
      const nw = newNet.ways[i];
      if (!!nw.trail !== !!w.trail) continue;
      const h = project(nw.path, p.x, p.z, maxD);
      if (!h || Math.abs(h.y - p.y) > maxDy) continue;
      const cos = h.tx * p.tx + h.tz * p.tz;
      // (a one-way only the way it may be driven — unless it is the very street the agent is on: a car turned round at
      // a one-way's dead end carries on as it was)
      if (Math.abs(cos) < minCos || (!nw.allow(Math.sign(cos) * a.dir || a.dir) && !(h.d < .5 && Math.abs(cos) > .98))) continue;
      const score = h.d + (1 - Math.abs(cos)) * 4;
      if (!best || score < best.score) best = { i, h, cos, score };
    }
    if (best) break;
  }
  if (!best) return null;
  const dir = Math.sign(best.cos) * a.dir || a.dir;   // (one-ways: only a way it may drive that way, above)
  // the world offset off the centre line (right of the way's own direction), kept: lat is along the agent's direction
  const wl = (a.lat || 0) * (a.dir > 0 ? 1 : -1);
  const ox = -p.tz * wl, oz = p.tx * wl;   // (life.js _advance: x - tz·wl, z + tx·wl)
  const nwl = ox * -best.h.tz + oz * best.h.tx;
  return { way: best.i, s: best.h.s, dir, lat: w.trail ? a.lat : nwl * (dir > 0 ? 1 : -1) };
}

/** Copy what an agent is and does (its look, model, pace, place drawn) from `a` to `b`. */
const KEEP = ['alive', 'paint', 'x', 'y', 'z', 'yaw', 'pitch', 'speed', 'v', 'gait', 'stand', 'wander', 'look', 'clip', 'phase', 'rate', 'kerbJ', 'wside', 'dist', 'lx', 'lz'];
function copy(a, b) {
  for (const k of KEEP) if (a[k] !== undefined) b[k] = a[k];
  b.nx = undefined; b.go = null; b.slot = 0;
  if (b.queue) { b.queue.waiting = Math.max(0, (b.queue.waiting || 1) - 1); b.queue = null; }
}

/**
 * `to` (the life of the area drawn from now on) takes over `from`'s agents near the camera. `cam`: the camera
 * {x, z}; `rider`: as life.tick has it, on the new area's line ({x, z, out, dir}). Returns counts for the tools:
 * { carried, dropped, inView: {carried, dropped} } per kind.
 */
export function handOffLife(from, to, cam, rider, { poseOn, viewM = 150 } = {}) {
  const R = { people: [0, 0], cyclists: [0, 0], vehicles: [0, 0], oncoming: [0, 0], trains: [0, 0], boats: [0, 0], droppedInView: 0 };
  const inView = (x, z) => x != null && Math.hypot(x - cam.x, z - cam.z) < viewM;
  const pose = (path, s) => poseOn(path, s, 1, {});
  const at2 = (path, s, out) => { const q = pose(path, s); out.x = q.x; out.y = q.y; out.z = q.z; out.tx = q.tx; out.tz = q.tz; return out; };
  const pair = (list0, list1, net0, net1, kind, reach) => {
    for (let k = 0; k < list1.length; k++) {
      const a = list0[k], b = list1[k];
      b.alive = false; b.x = null; b.lx = null;
      if (b.queue) { b.queue.waiting = Math.max(0, (b.queue.waiting || 1) - 1); b.queue = null; }
      if (!a?.alive || a.x == null || Math.hypot(a.x - cam.x, a.z - cam.z) > reach) continue;
      if (a.model && b.model && a.model !== b.model) { R[kind][1]++; if (inView(a.x, a.z)) R.droppedInView++; continue; }
      if (a.stand || a.wander || a.way < 0) { copy(a, b); b.way = -1; R[kind][0]++; continue; }   // standing about a square: where they are
      const m = locate(a, net0, net1, at2);
      if (!m) { R[kind][1]++; if (inView(a.x, a.z)) R.droppedInView++; continue; }
      copy(a, b);
      Object.assign(b, m, { alive: true });
      R[kind][0]++;
    }
  };
  pair(from.walkers, to.walkers, from.walk, to.walk, 'people', 330);
  pair(from.riders, to.riders, from.walk, to.walk, 'cyclists', 380);
  pair(from.carAgents, to.carAgents, from.drive, to.drive, 'vehicles', 480);
  pair(from.busAgents, to.busAgents, from.drive, to.drive, 'vehicles', 480);
  // oncoming traffic on the route's own street: the same street is the new line's there (the swap is inside an apron)
  for (let k = 0; k < to.oncoming.length; k++) {
    const a = from.oncoming[k], b = to.oncoming[k];
    b.alive = false; b.lx = null; b.wait = 1 + k;
    if (!a?.alive || a.x == null) continue;
    const L = to.city.landscape, r = L.routeDist(a.x, a.z), route = to.city.route, ix = to.city.index;
    if (!r || r.d > 4 || Math.abs(r.y - a.y) > 3 || !rider) { R.oncoming[1]++; if (inView(a.x, a.z)) R.droppedInView++; continue; }
    const i = r.i, dx = ix.xs[i + 1] - ix.xs[i], dz = ix.zs[i + 1] - ix.zs[i], l = Math.hypot(dx, dz) || 1;
    const t = Math.max(0, Math.min(1, ((a.x - ix.xs[i]) * dx + (a.z - ix.zs[i]) * dz) / (l * l)));
    const s = route.dist[i] + (route.dist[i + 1] - route.dist[i]) * t;
    const dir = Math.sin(a.yaw) * dx + Math.cos(a.yaw) * dz > 0 ? 1 : -1;
    if (dir !== -rider.dir) { R.oncoming[1]++; if (inView(a.x, a.z)) R.droppedInView++; continue; }
    copy(a, b);
    Object.assign(b, { alive: true, onRoute: true, s, dir });
    R.oncoming[0]++;
  }
  // trains: the same line (the longest light-rail and freight lines near both areas) at the same place, if it is one
  for (const t of to.trains || []) {
    const o = (from.trains || []).find((u) => !!u.freight === !!t.freight && (u.offset || 0) === (t.offset || 0));
    if (!o) continue;
    const head = o.path.at(Math.max(0, Math.min(o.path.length, o.s)), {});
    const h = project(t.path, head.x, head.z, 3);
    if (!h || Math.abs(h.y - head.y) > 3) { R.trains[1]++; continue; }
    const ahead = o.path.at(Math.max(0, Math.min(o.path.length, o.s + o.dir * 5)), {});
    const dir = (ahead.x - head.x) * h.tx + (ahead.z - head.z) * h.tz >= 0 ? 1 : -1;
    // (the cars behind run back along the new line: only where it carries them as the old one did)
    const tail = (t.cars - 1) * t.gap, back = h.s - dir * tail;
    if (back < 0 || back > t.path.length) { R.trains[1]++; continue; }
    Object.assign(t, { s: h.s, dir, wait: o.wait });
    R.trains[0]++;
  }
  // boats: the same rivers (the scene's, city-wide): the same boat on the same river carries on where it is
  for (let k = 0; k < (to.boats || []).length; k++) {
    const a = from.boats?.[k], b = to.boats[k];
    if (!a || a.type !== b.type || a.river.name !== b.river.name || Math.abs(a.river.path.length - b.river.path.length) > 1) { R.boats[1]++; continue; }
    Object.assign(b, { s: a.s, dir: a.dir, latNow: a.latNow });
    R.boats[0]++;
  }
  to._started = true;   // (from now on new agents appear out of the rider's sight, as on a ride under way)
  to._clock = from._clock;
  return R;
}
