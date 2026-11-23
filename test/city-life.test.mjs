// City life on Pittsburgh (js/world/toolbox/city/life.js): a whole ride, Forward and Reverse, with the
// people, cyclists, cars, buses and oncoming traffic ticking around the rider. Nothing may jump (move further
// in one step than its speed allows), no person may stand in the route's carriageway near the rider, no
// vehicle may sit in the rider's lane ahead, and nothing may appear or vanish in view.
//   LIFE_SIM_REPORT=1 node --test test/city-life.test.mjs   prints the counts (LIFE_SIM_DEBUG=1: and each finding)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.min.js';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCityLandscape, cityStreets, decodeCity } from '../js/world/toolbox/city/landscape.js';
import { riderPose, CHASE, ROAD_WIDTH, LANE_OFFSET, PACER_LANE } from '../js/world/pose.js';
import { loadNetwork, NetRide } from '../js/network.js';
import { VEHICLE_INFO } from '../js/world/toolbox/life/figures/vehicles.js';
import { powerRequired, stepSpeed } from '../js/physics.js';

// the boats' wake texture draws on a canvas: a stand-in is enough here
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true }) }) };
const { CityLife } = await import('../js/world/toolbox/city/life.js');
const { ghostAt } = await import('../js/world/ghost.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('routes/catalog.json'));
const item = catalog.find((c) => c.id === 'pittsburgh');
const netJson = JSON.parse(read(item.network));
// Pittsburgh is a city of areas (PLAN 5.4): every area in the city's frame; the ride's own area is the one drawn
const proj = netJson.origin ? makeProjection(netJson.origin.lat, netJson.origin.lon) : null;
const areas = new Map();
/** An area as the world builds it: its route (with its scene and city data), index and landscape. */
function areaCtx(catalogId) {
  if (areas.has(catalogId)) return areas.get(catalogId);
  const it = catalog.find((c) => c.id === catalogId);
  const r = buildCatalogRoute(read(it.file), it);
  const sc = JSON.parse(read(it.scene));
  sc.city = JSON.parse(read(sc.cityData));
  r.scene = sc;
  let la = Infinity, lb = -Infinity, lc = Infinity, ld = -Infinity;
  for (let i = 0; i < r.lat.length; i++) { la = Math.min(la, r.lat[i]); lb = Math.max(lb, r.lat[i]); lc = Math.min(lc, r.lon[i]); ld = Math.max(ld, r.lon[i]); }
  const pj = proj || makeProjection((la + lb) / 2, (lc + ld) / 2);
  const ix = makeRouteIndex(r, pj);
  const ctx = { id: catalogId, route: r, scene: sc, index: ix, L: makeCityLandscape(sc, pj, ix, r), proj: pj };
  areas.set(catalogId, ctx);
  return ctx;
}
// (the helpers below read the area being ridden: simulate() switches these as the area drawn changes)
let route, scene, index, L;
const useArea = (ctx) => ({ route, scene, index, L } = ctx);
useArea(areaCtx('pittsburgh'));

const SPEED = 9, DT = .1;
const SPAWNS = ['_spawnWalker', '_spawnCyclist', '_spawnCar', '_spawnOncoming', '_spawnRouteRider'];
const VIEW_M = 150;         // "in view": this close to the camera and in front of it (people: tiny dots beyond)
const NEAR_M = 60;          // people out of the carriageway, vehicles out of the rider's lane, this close
const HALF = ROAD_WIDTH / 2;
const DEBUG = !!process.env.LIFE_SIM_DEBUG;
const CLOSE_M = 1.5;        // no vehicle body this close to the rider's (any direction; route traffic in its own lane aside)
const RIDER_BODY = { half: .32, len: .9 };   // rider + bike: half width, half length
const VEH = { bus: [1.3, 6] };               // vehicle half width, half length (cars: VEHICLE_INFO's length, 1.9 m wide)

function makeCity() {
  const group = new THREE.Group(), proj = areas.get(route.id)?.proj || areaCtx('pittsburgh').proj;
  const city = {
    group, route, index, landscape: L, data: L.data, D: decodeCity(L.data, proj), uniforms: { uTime: { value: 0 } }, night: { value: 0 },
    qualityKey: 'balanced', own: (x) => x, addGlows() {}, solidMaterial: new THREE.MeshBasicMaterial(),
  };
  city.streets = cityStreets(L, index, route);
  return city;
}

/** Signed distance right of the route's centre line (+ = the right of a rider riding Forward). */
function lateral(x, z, i) {
  const ax = index.xs[i], az = index.zs[i], dx = index.xs[i + 1] - ax, dz = index.zs[i + 1] - az, l = Math.hypot(dx, dz) || 1;
  return ((x - ax) * -dz + (z - az) * dx) / l;
}

/** Nearest point on the stretch of route around sample i0 (±100 m): {d, i}. (The route rides some streets twice.) */
function localRoute(x, z, i0) {
  let best = null;
  for (let i = Math.max(0, i0 - 10); i < Math.min(route.turnIdx - 1, i0 + 10); i++) {
    if (ghostAt(route, (route.dist[i] + route.dist[i + 1]) / 2)) continue;   // (a ghost stretch is never drawn: no lane there)
    const ax = index.xs[i], az = index.zs[i], dx = index.xs[i + 1] - ax, dz = index.zs[i + 1] - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (!best || d < best.d) best = { d, i, y: route.ele[i] };
  }
  return best;
}

/**
 * [6.10] A rider holding a steady power: speedAt(s) for simulate — the bike physics (js/physics.js) on the route's grade
 * there (its rise over ±15 m), starting at the speed that power makes on the flat. `kph`: that flat speed.
 */
export function steadyPower(kph, reverse = false) {
  const flat = kph / 3.6, watts = powerRequired(flat, 0);
  let v = flat;
  const y = (q) => riderPose(route, index, Math.max(0, Math.min(route.total - 1, q))).pos.y;
  return Object.assign((s) => { const g = (y(s + 15) - y(s - 15)) / 30 * 100; v = stepSpeed(v, watts, g, DT); return Math.max(v, 1); }, { watts });
}

export function makeLife() { return new CityLife(makeCity()); }
let _net = null;
const network = () => (_net ||= loadNetwork(netJson, netJson.format === 'bikefree-network-2'
  ? new Map(netJson.areas.map((a) => [a.id, areaCtx(a.catalogId).route])) : areaCtx('pittsburgh').route));

/** Gap (m) between two flat boxes (centre, unit heading, half width, half length): 0 when they overlap. */
function boxGap(a, b) {
  // sample one box's outline against the other (both small: a few cm is plenty)
  const inside = (p, o) => {
    const dx = p.x - o.x, dz = p.z - o.z, along = dx * o.hx + dz * o.hz, across = dx * -o.hz + dz * o.hx;
    return Math.hypot(Math.max(0, Math.abs(along) - o.len), Math.max(0, Math.abs(across) - o.half));
  };
  let best = Infinity;
  for (const [o, q] of [[a, b], [b, a]]) {
    for (let u = -1; u <= 1; u += .25) for (const v of [-1, 1]) {
      for (const [f, g] of [[u, v], [v, u]]) {
        const p = { x: o.x + o.hx * o.len * f - o.hz * o.half * g, z: o.z + o.hz * o.len * f + o.hx * o.half * g };
        best = Math.min(best, inside(p, q));
      }
    }
  }
  return best;
}

const note = (what, a, t) => DEBUG && console.log(what, `t=${t.toFixed(1)}`, JSON.stringify({ x: a.x, z: a.z, way: a.way, s: a.s, dir: a.dir, v: a.v, speed: a.speed, onRoute: a.onRoute, stand: a.stand, wander: a.wander }));

/**
 * A ride Forward or Reverse; `span` [a, b] outbound metres limits it to a stretch (debugging), `watch(life, rider, t)`
 * sees every step; `seed` draws the city's life anew. `plan` (network traversal keys, e.g. ["e10+", "e1+"]) rides one lap of that path instead, as the
 * world places a network ride: the turns through the junctions, edges ridden backwards on the base route's way back.
 */
export function simulate(reverse, { span = null, watch = null, plan = null, speed = SPEED, speedAt = null, pacer = false, seed = null, area: areaId = 'pittsburgh', handOff = false } = {}) {
  useArea(areaCtx(areaId));
  let city = makeCity(), life = new CityLife(city);
  if (seed != null) { let q = seed; life.rand = () => { q = (q * 1103515245 + 12345) & 0x7fffffff; return q / 0x7fffffff; }; }   // (another draw of the same city's life)
  let turn = route.turnS, total = route.total;
  // spawns and despawns: hook the spawn methods (their names are the life's contract with this test)
  const respawned = new Set();
  for (const k of SPAWNS) {
    const f = life[k].bind(life);
    life[k] = (a, ...rest) => { respawned.add(a); return f(a, ...rest); };
  }
  const groupsOf = (lf) => [['person', lf.walkers], ['person', lf.riders], ['vehicle', lf.carAgents], ['vehicle', lf.busAgents], ['vehicle', lf.oncoming], ['routeRider', lf.routeRiders]];
  let agents = groupsOf(life).flatMap(([g, list]) => list.map((a) => ({ a, g, cyclist: list === life.riders })));
  const last = new Map();
  const R = { routeRiderClose: 0, closestRouteRider: Infinity, pacerClose: 0, routeRiderSeen: 0, minutes: 0, swaps: 0, carried: 0, dropped: 0, swapPopOut: 0, swapGone: 0, swapNew: 0, jumps: 0, worstJump: 0, personInRoad: 0, vehicleInLane: 0, vehicleClose: 0, closest: Infinity, oneWayOncoming: 0, popIn: 0, popOut: 0, ticks: 0, seen: { person: 0, vehicle: 0 } };
  const episode = new Map();   // agent → which checks are failing now (count each episode once)
  const flag = (a, key) => { const e = episode.get(a) || new Set(); episode.set(a, e); if (e.has(key)) return false; e.add(key); return true; };
  let s = reverse ? turn + speed * DT : 0;   // (Reverse: from the first step on the way back, so the city sees the rider coming back)
  let end = reverse ? total - 1 : turn - 1;
  if (span) { s = reverse ? total - span[1] : span[0]; end = reverse ? total - span[0] : span[1]; }
  const ride = plan ? new NetRide(network(), {}, { plan }) : null;
  let lastDir = null, flipT = -Infinity, area = null;
  if (ride) { s = 0; end = ride.lapM - 1; }
  const lives = new Map([[areaId, { city, life, agents }]]);
  const catalogOf = (id) => (ride?.net.multi ? ride.net.areas.get(id).json.catalogId : 'pittsburgh');
  const indexOf = (id) => areaCtx(catalogOf(id)).index;
  let inViewAt = () => false;   // (in view of the last step's camera: what the swap takes away without a hand-off)
  for (let t = 0; s < end; t += DT, s += speed * DT) {
    if (speedAt) speed = speedAt(s);   // (e.g. the speed a steady power makes on the grade there)
    // (a network ride: path metre s, at its place on the area drawn, as js/world/world.js does; a city of areas
    // swaps the area drawn — its own life — where NetRide.areaFor says. Nothing is carried across: life is
    // judged within each area, and the step of the swap is not counted as pop-in or pop-out)
    let swapped = false, handing = null;
    if (ride?.net.multi) {
      const a = ride.areaFor(s, area);
      if (a !== area) {
        swapped = area != null; area = a;
        if (swapped) R.swaps++;
        // [F31] with handOff the new area's life takes over the old one's agents (life-handoff.js), and the swap's
        // step is judged like any other: what was in view and isn't carried is a pop-out, and nothing may jump
        if (swapped && handOff) handing = { life, agents };
        const cid = catalogOf(a);
        useArea(areaCtx(cid));
        if (!lives.has(cid)) { const c = makeCity(); const lf = new CityLife(c); lives.set(cid, { city: c, life: lf, agents: groupsOf(lf).flatMap(([g, list]) => list.map((x) => ({ a: x, g, cyclist: list === lf.riders }))) }); for (const k of SPAWNS) { const lf2 = lives.get(cid).life, f = lf2[k].bind(lf2); lf2[k] = (x, ...rest) => { respawned.add(x); return f(x, ...rest); }; } }
        ({ city, life, agents } = lives.get(cid));
        turn = route.turnS; total = route.total;
        if (handing) life.takeOver(handing.life);
        else if (swapped) { R.swapGone += [...last.values()].filter((w) => inViewAt(w.x, w.z)).length; last.clear(); episode.clear(); }
      }
    }
    const ws = ride ? ride.worldAt(s, area).s : s;
    const pose = ride ? ride.pose(s, indexOf, LANE_OFFSET / ROAD_WIDTH, area) : riderPose(route, index, s);
    const fwd = { x: pose.flat.x, z: pose.flat.z };
    const cam = { x: pose.pos.x - fwd.x * CHASE.back, y: pose.pos.y + CHASE.up, z: pose.pos.z - fwd.z * CHASE.back };
    const back = ws > turn, rider = { x: pose.pos.x, z: pose.pos.z, out: back ? total - ws : ws, dir: back ? -1 : 1, speed };
    // [6.10] a pacer riding with you, drifting from 6 m behind to 6 m ahead and back (its own lane, js/world/world.js)
    let pacerBox = null;
    if (pacer && !ride) {
      const ps = Math.max(0, Math.min(total - 1, s + 6 * Math.sin(t / 15))), pp = riderPose(route, index, ps, PACER_LANE);
      rider.pacer = { x: pp.pos.x, z: pp.pos.z, speed: speed * (1 + .4 * Math.cos(t / 15) * 6 / 15 / Math.max(speed, 1)) };
      pacerBox = { x: pp.pos.x, z: pp.pos.z, hx: pp.flat.x, hz: pp.flat.z, ...RIDER_BODY };
    }
    // (a U-turn ahead on the path, as js/world/world.js tells the life)
    const U = ride?.uturnAhead(s);
    if (U != null) { const w = ride.worldAt(Math.max(0, U - 1), area); if (w.area === area) rider.uturn = w.s > turn ? total - w.s : w.s; }
    const riderBox = { x: pose.pos.x, z: pose.pos.z, hx: fwd.x, hz: fwd.z, ...RIDER_BODY };
    if (lastDir != null && rider.dir !== lastDir) flipT = t;
    lastDir = rider.dir;
    respawned.clear();
    city.uniforms.uTime.value += DT;
    life.tick(cam, DT, city.uniforms.uTime.value, rider);
    watch?.(life, rider, t);
    R.ticks++;
    const inView = (x, z) => { const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz); return d < VIEW_M && (dx * fwd.x + dz * fwd.z) > d * Math.cos(75 * Math.PI / 180); };
    inViewAt = inView;
    if (swapped && !handing) R.swapNew += agents.filter(({ a }) => a.alive && a.x != null && inView(a.x, a.z)).length;   // (the new area's life, there at once)
    if (handing) {
      // the old life's agents → the new life's (the same lists, index for index): carried, or gone
      const moved = new Map();
      handing.agents.forEach(({ a }, j) => {
        const was = last.get(a), b = agents[j]?.a;
        if (!was) return;
        if (b && b.alive && !respawned.has(b) && Number.isFinite(b.x)) { moved.set(b, was); R.carried++; }
        else { R.dropped++; if (inView(was.x, was.z)) { R.popOut++; R.swapPopOut++; if (DEBUG) console.log('swap drop', `t=${t.toFixed(1)}`, JSON.stringify({ ...was, model: a.model, way: a.way, s: a.s, stand: a.stand })); } }
      });
      last.clear(); episode.clear();
      for (const [b, was] of moved) last.set(b, was);
      swapped = false;   // (judged: no pop-in, no jump on this step either)
    }
    // a ghost stretch is never ridden (the network rides that street as the reverse of its real pass): don't judge there
    const out = rider.out, ghost = ghostAt(route, out) || ghostAt(route, out - NEAR_M) || ghostAt(route, out + NEAR_M);
    R.minutes += DT / 60;
    for (const { a, g, cyclist } of agents) {
      const was = last.get(a), alive = a.alive && a.x != null && Number.isFinite(a.x);
      const re = respawned.has(a);
      if (t > 0 && !swapped) {
        if (was && (!alive || re) && inView(was.x, was.z)) { R.popOut++; if (DEBUG) console.log('pop-out', `t=${t.toFixed(1)} out=${rider.out.toFixed(0)} dir=${rider.dir}`, JSON.stringify({ ...was, model: a.model, onRoute: a.onRoute, s: a.s, way: a.way })); }
        if (alive && (!was || re) && inView(a.x, a.z)) { R.popIn++; note('pop-in', a, t); }
        if (alive && was && !re) {
          const d = Math.hypot(a.x - was.x, a.z - was.z), allow = (Math.max(a.speed || 0, 1) * 1.5 + 2) * DT + .02;
          if (d > allow && Math.hypot(a.x - rider.x, a.z - rider.z) < VIEW_M) { R.jumps++; R.worstJump = Math.max(R.worstJump, d); if (DEBUG) console.log("jump", `t=${t.toFixed(1)} out=${rider.out.toFixed(0)} d=${d.toFixed(2)}`, JSON.stringify({ model: a.model, way: a.way, s: a.s, onRoute: a.onRoute, x: a.x, z: a.z, wx: was.x, wz: was.z })); }
        }
      }
      if (!alive) { last.delete(a); episode.delete(a); continue; }
      last.set(a, { x: a.x, z: a.z });
      const near = Math.hypot(a.x - rider.x, a.z - rider.z) < NEAR_M;
      if (near) R.seen[g]++;
      const r = near ? L.routeDist(a.x, a.z) : null;
      const level = r && Math.abs((a.y ?? r.y) - r.y) < 3;
      let bad = false;
      if (ghost) { episode.delete(a); continue; }
      // [6.10] riders on the route with you: in the road by design, clear of you and the pacer (bike boxes ≥ .25 m apart)
      if (g === 'routeRider') {
        if (Math.hypot(a.x - rider.x, a.z - rider.z) < VIEW_M) R.routeRiderSeen++;
        const box = { x: a.x, z: a.z, hx: Math.sin(a.yaw), hz: Math.cos(a.yaw), ...RIDER_BODY };
        if (Math.abs(a.y - pose.pos.y) < 2 && Math.hypot(a.x - rider.x, a.z - rider.z) < 6) {
          const gap = boxGap(riderBox, box);
          R.closestRouteRider = Math.min(R.closestRouteRider, gap);
          if (gap < .25) { bad = true; if (flag(a, 'rr')) { R.routeRiderClose++; note('route rider close', a, t); } }
        }
        if (pacerBox && Math.hypot(a.x - pacerBox.x, a.z - pacerBox.z) < 6 && boxGap(pacerBox, box) < .25) { bad = true; if (flag(a, 'rp')) { R.pacerClose++; note('route rider at the pacer', a, t); } }
        if (!bad) episode.delete(a);
        continue;
      }
      if (g === 'person' && r && level && r.d < HALF) {
        // a background cyclist may ride a shared trail, on the far half from the rider
        const far = lateral(a.x, a.z, r.i) * rider.dir < -.5;
        // (after a U-turn on a network ride the trail's far half is the other one: they cross over to it)
        bad = !(cyclist && (far || t - flipT < 8) && L.routeKindAt(route.dist[r.i]) === 'trail');
        if (bad && flag(a, 'road')) { R.personInRoad++; note('in-road', a, t); }
      }
      const lr = g === 'vehicle' && r ? localRoute(a.x, a.z, Math.floor(rider.out / 10)) : null;
      if (lr && Math.abs((a.y ?? lr.y) - lr.y) < 3 && lr.d < HALF + .5) {
        const ahead = (a.x - rider.x) * fwd.x + (a.z - rider.z) * fwd.z;
        if (ahead > 0 && ahead < NEAR_M && lateral(a.x, a.z, lr.i) * rider.dir > -.3) { bad = true; if (flag(a, 'lane')) { R.vehicleInLane++; note('in-lane', a, t); } }
      }
      // [F18] no oncoming traffic on a one-way stretch of the route (against its traffic, or head-on at a rider riding it backwards)
      if (a.onRoute && near && life._oneWays().some((o) => a.s > o.fromM && a.s < o.toM)) { bad = true; if (flag(a, 'oneway')) { R.oneWayOncoming++; note('one-way', a, t); } }
      // nothing drives into (or brushes past) the rider: cross traffic waits at the kerb. Oncoming traffic on the
      // route's own street keeps its far lane (that lane is its own: it passes ~2 m off, so it is held to 0.5 m)
      if (g === 'vehicle' && near && Math.abs((a.y ?? pose.pos.y) - pose.pos.y) < 3) {
        const len = a.model === 'bus' ? VEH.bus[1] : (VEHICLE_INFO[a.model]?.len || 4.5) / 2, half = a.model === 'bus' ? VEH.bus[0] : .95;
        const gap = boxGap(riderBox, { x: a.x, z: a.z, hx: Math.sin(a.yaw), hz: Math.cos(a.yaw), half, len });
        R.closest = Math.min(R.closest, gap);
        if (gap < (a.onRoute ? .5 : CLOSE_M)) {
          bad = true;
          if (flag(a, 'close')) { R.vehicleClose++; if (DEBUG) console.log('close', `out=${rider.out.toFixed(0)} dir=${rider.dir} gap=${gap.toFixed(2)} model=${a.model}`, JSON.stringify({ x: +a.x.toFixed(1), z: +a.z.toFixed(1), rx: +rider.x.toFixed(1), rz: +rider.z.toFixed(1), way: a.way, s: a.s && +a.s.toFixed(1), dir: a.dir, v: a.v && +a.v.toFixed(2), go: !!a.go, onRoute: a.onRoute })); }
        }
      }
      if (!bad) episode.delete(a);
    }
  }
  // [6.10] passes (either way) over the ride, from every area's life
  // (an area swap hands the plan on: life-handoff.js — each plan once)
  const plans = [...new Set([...lives.values()].map((x) => x.life._rr).filter(Boolean))];
  R.passes = plans.reduce((n, p) => n + p.passes.length, 0);
  R.caught = plans.reduce((n, p) => n + p.caught, 0);
  R.passedBy = plans.reduce((n, p) => n + p.passedBy, 0);
  R.perMinute = +(R.passes / Math.max(R.minutes, 1e-9)).toFixed(2);
  for (const x of lives.values()) x.life.dispose?.();
  return R;
}

/**
 * Every dead end near the route that cars and buses drive into: one of each driven in from 40 m out and left to
 * turn round there (no rider about). No corner of it may come onto the route's road (F16: a bus turning round at
 * a T cut back from the route on Second Ave swung its nose through the rider). [{way, dir, bus, worst}] where it does.
 */
export function deadEndTurns(areaId = 'pittsburgh') {
  useArea(areaCtx(areaId));   // (an area's own streets: PLAN 5.4)
  const life = new CityLife(makeCity()), net = life.drive, out = [];
  let n = 0;
  net.ways.forEach((w, i) => {
    for (const dir of [1, -1]) {
      const endP = dir > 0 ? w.path.pts.at(-1) : w.path.pts[0];
      if (!w.allow(dir) || (net.ends.get(net.key(endP)) || []).some((o) => o.i !== i && net.ways[o.i].allow(o.end === 0 ? 1 : -1))) continue;
      const near = L.routeDist(endP.x, endP.z);
      if (!near || near.d > 40) continue;
      for (const bus of w.bus ? [false, true] : [false]) {
        if (!life._turnOk(w, dir, bus)) continue;   // (never driven into)
        n++;
        // (driven in at full speed from far enough out to brake for where it turns round, but past the last crossing of the
        // route on the way: crossing it is fine)
        const wall = (c) => (dir > 0 ? c.s1 >= w.path.length - .01 : c.s0 <= .01);   // (a band at the end: the way ends on the road there)
        const lastX = (w.band || []).filter((c) => !wall(c)).reduce((m, c) => (dir > 0 ? Math.max(m, c.s1) : Math.min(m, c.s0)), dir > 0 ? -Infinity : Infinity);
        const turnAt = life._turnRound(w, dir, bus), brake = w.speed ** 2 / (4 * 3.2) + 10;
        const from = dir > 0 ? Math.max(0, turnAt - brake, lastX + 12) : Math.min(w.path.length, turnAt + brake, lastX - 12);
        if (dir > 0 ? from >= turnAt - 3 : from <= turnAt + 3) continue;
        const a = { alive: true, bus, model: bus ? 'bus' : 'sedan', way: i, s: from, dir,
          speed: w.speed, v: w.speed, lat: w.lane || 0, gait: 0, nx: undefined, go: null, slot: 0, x: null };
        const len = bus ? VEH.bus[1] : VEHICLE_INFO.sedan.len / 2, half = bus ? VEH.bus[0] : .95;
        let worst = Infinity;
        for (let k = 0; k < 300 && a.way === i; k++) {
          life._advance(a, net, DT, null, 'car');
          const hx = Math.sin(a.yaw), hz = Math.cos(a.yaw);
          for (const [f, g] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const r = L.routeDist(a.x + hx * len * f - hz * half * g, a.z + hz * len * f + hx * half * g);
            if (r && Math.abs(r.y - a.y) < 3) worst = Math.min(worst, r.d - HALF);
          }
          if (a.dir !== dir && (Math.abs(a.s - from) < 3 || (a.s - from) * dir < 0)) break;   // turned round and back where it came in
        }
        if (worst < 0) out.push({ way: i, dir, bus, worst: +worst.toFixed(2) });
      }
    }
  });
  return Object.assign(out, { checked: n });
}

if (!process.env.NO_TESTS) test('pittsburgh life: cars and buses turn round at dead ends clear of the route\'s road', () => {
  const bad = deadEndTurns();
  if (process.env.LIFE_SIM_REPORT) console.log('dead-end turns', bad.checked, JSON.stringify(bad));
  assert.ok(bad.checked > 50, `dead ends checked: ${bad.checked}`);
  assert.deepEqual([...bad], [], 'vehicles swinging onto the route\'s road as they turn round');
});

// each area's own line (PLAN 5.4: Pittsburgh's areas — the core, the Allegheny & Troy Hill, Oakland & Schenley, the West End, the GAP & Homestead), Forward and Reverse
const BUSY = { pittsburgh: [90000, 20000], 'pittsburgh-allegheny': [30000, 6000], 'pittsburgh-oakland': [30000, 6000], 'pittsburgh-westend': [3000, 500], 'pittsburgh-homestead': [30000, 6000] };
for (const [areaId, reverse] of process.env.NO_TESTS ? [] : Object.keys(BUSY).flatMap((a) => [[a, false], [a, true]])) {
  test(`${areaId} life, ${reverse ? 'Reverse' : 'Forward'}: no jumps, people off the road, vehicles out of the rider's lane, no pop-in`, () => {
    const R = simulate(reverse, { area: areaId });
    if (process.env.LIFE_SIM_REPORT) console.log(areaId, reverse ? 'Reverse' : 'Forward', JSON.stringify(R));
    // still a busy city: about as many people and vehicles near the rider as before (the whole 40 km tour: ~180k / ~50k agent-steps)
    // (v0.14: no moving traffic — the city's cars are parked: nothing drives)
    assert.ok(R.seen.person > BUSY[areaId][0] && R.seen.vehicle === 0, `life near the rider: ${JSON.stringify(R.seen)}`);
    assert.equal(R.jumps, 0, `jumps (worst ${R.worstJump.toFixed(2)} m in one step)`);
    assert.equal(R.personInRoad, 0, 'people in the carriageway near the rider');
    assert.equal(R.vehicleInLane, 0, "vehicles in the rider's lane ahead");
    assert.equal(R.oneWayOncoming, 0, 'oncoming traffic on a one-way stretch of the route');
    assert.equal(R.vehicleClose, 0, `vehicles within ${CLOSE_M} m of the rider (closest ${R.closest.toFixed(2)} m)`);
    assert.equal(R.popIn + R.popOut, 0, `spawned ${R.popIn} / despawned ${R.popOut} in view`);
    assert.equal(R.routeRiderClose, 0, `[6.10] riders on the route within .25 m of the rider (closest ${R.closestRouteRider.toFixed(2)} m)`);
  });
}
