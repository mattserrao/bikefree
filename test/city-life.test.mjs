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
import { riderPose, CHASE, ROAD_WIDTH } from '../js/world/pose.js';

// the boats' wake texture draws on a canvas: a stand-in is enough here
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true }) }) };
const { CityLife } = await import('../js/world/toolbox/city/life.js');
const { ghostAt } = await import('../js/world/ghost.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const item = JSON.parse(read('routes/catalog.json')).find((c) => c.id === 'pittsburgh');
const route = buildCatalogRoute(read(item.file), item);
const scene = JSON.parse(read(item.scene));
scene.city = JSON.parse(read(scene.cityData));
route.scene = scene;
let la = Infinity, lb = -Infinity, lc = Infinity, ld = -Infinity;
for (let i = 0; i < route.lat.length; i++) { la = Math.min(la, route.lat[i]); lb = Math.max(lb, route.lat[i]); lc = Math.min(lc, route.lon[i]); ld = Math.max(ld, route.lon[i]); }
const proj = makeProjection((la + lb) / 2, (lc + ld) / 2);
const index = makeRouteIndex(route, proj);
const L = makeCityLandscape(scene, proj, index, route);

const SPEED = 9, DT = .1;
const VIEW_M = 150;         // "in view": this close to the camera and in front of it (people: tiny dots beyond)
const NEAR_M = 60;          // people out of the carriageway, vehicles out of the rider's lane, this close
const HALF = ROAD_WIDTH / 2;
const DEBUG = !!process.env.LIFE_SIM_DEBUG;

function makeCity() {
  const group = new THREE.Group();
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
    const ax = index.xs[i], az = index.zs[i], dx = index.xs[i + 1] - ax, dz = index.zs[i + 1] - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (!best || d < best.d) best = { d, i, y: route.ele[i] };
  }
  return best;
}

export function makeLife() { return new CityLife(makeCity()); }

const note = (what, a, t) => DEBUG && console.log(what, `t=${t.toFixed(1)}`, JSON.stringify({ x: a.x, z: a.z, way: a.way, s: a.s, dir: a.dir, v: a.v, speed: a.speed, onRoute: a.onRoute, stand: a.stand, wander: a.wander }));

export function simulate(reverse) {
  const city = makeCity(), life = new CityLife(city);
  const turn = route.turnS, total = route.total;
  // spawns and despawns: hook the spawn methods (their names are the life's contract with this test)
  const respawned = new Set();
  for (const k of ['_spawnWalker', '_spawnCyclist', '_spawnCar', '_spawnOncoming']) {
    const f = life[k].bind(life);
    life[k] = (a, ...rest) => { respawned.add(a); return f(a, ...rest); };
  }
  const groups = [['person', life.walkers], ['person', life.riders], ['vehicle', life.carAgents], ['vehicle', life.busAgents], ['vehicle', life.oncoming]];
  const agents = groups.flatMap(([g, list]) => list.map((a) => ({ a, g, cyclist: list === life.riders })));
  const last = new Map();
  const R = { jumps: 0, worstJump: 0, personInRoad: 0, vehicleInLane: 0, popIn: 0, popOut: 0, ticks: 0, seen: { person: 0, vehicle: 0 } };
  const episode = new Map();   // agent → which checks are failing now (count each episode once)
  const flag = (a, key) => { const e = episode.get(a) || new Set(); episode.set(a, e); if (e.has(key)) return false; e.add(key); return true; };
  let s = reverse ? turn : 0;
  const end = reverse ? total - 1 : turn - 1;
  for (let t = 0; s < end; t += DT, s += SPEED * DT) {
    const pose = riderPose(route, index, s);
    const fwd = { x: pose.flat.x, z: pose.flat.z };
    const cam = { x: pose.pos.x - fwd.x * CHASE.back, y: pose.pos.y + CHASE.up, z: pose.pos.z - fwd.z * CHASE.back };
    const back = s > turn, rider = { x: pose.pos.x, z: pose.pos.z, out: back ? total - s : s, dir: back ? -1 : 1, speed: SPEED };
    respawned.clear();
    city.uniforms.uTime.value += DT;
    life.tick(cam, DT, city.uniforms.uTime.value, rider);
    R.ticks++;
    // a ghost stretch is never ridden (the network rides that street as the reverse of its real pass): don't judge there
    const out = back ? total - s : s, ghost = ghostAt(route, out) || ghostAt(route, out - NEAR_M) || ghostAt(route, out + NEAR_M);
    const inView = (x, z) => { const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz); return d < VIEW_M && (dx * fwd.x + dz * fwd.z) > d * Math.cos(75 * Math.PI / 180); };
    for (const { a, g, cyclist } of agents) {
      const was = last.get(a), alive = a.alive && a.x != null && Number.isFinite(a.x);
      const re = respawned.has(a);
      if (t > 0) {
        if (was && (!alive || re) && inView(was.x, was.z)) R.popOut++;
        if (alive && (!was || re) && inView(a.x, a.z)) { R.popIn++; note('pop-in', a, t); }
        if (alive && was && !re) {
          const d = Math.hypot(a.x - was.x, a.z - was.z), allow = (Math.max(a.speed || 0, 1) * 1.5 + 2) * DT + .02;
          if (d > allow && Math.hypot(a.x - rider.x, a.z - rider.z) < VIEW_M) { R.jumps++; R.worstJump = Math.max(R.worstJump, d); }
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
      if (g === 'person' && r && level && r.d < HALF) {
        // a background cyclist may ride a shared trail, on the far half from the rider
        const far = lateral(a.x, a.z, r.i) * rider.dir < -.5;
        bad = !(cyclist && far && L.routeKindAt(route.dist[r.i]) === 'trail');
        if (bad && flag(a, 'road')) { R.personInRoad++; note('in-road', a, t); }
      }
      const lr = g === 'vehicle' && r ? localRoute(a.x, a.z, Math.floor(rider.out / 10)) : null;
      if (lr && Math.abs((a.y ?? lr.y) - lr.y) < 3 && lr.d < HALF + .5) {
        const ahead = (a.x - rider.x) * fwd.x + (a.z - rider.z) * fwd.z;
        if (ahead > 0 && ahead < NEAR_M && lateral(a.x, a.z, lr.i) * rider.dir > -.3) { bad = true; if (flag(a, 'lane')) { R.vehicleInLane++; note('in-lane', a, t); } }
      }
      if (!bad) episode.delete(a);
    }
  }
  life.dispose?.();
  return R;
}

for (const reverse of process.env.NO_TESTS ? [] : [false, true]) {
  test(`pittsburgh life, ${reverse ? 'Reverse' : 'Forward'}: no jumps, people off the road, vehicles out of the rider's lane, no pop-in`, () => {
    const R = simulate(reverse);
    if (process.env.LIFE_SIM_REPORT) console.log(reverse ? 'Reverse' : 'Forward', JSON.stringify(R));
    // still a busy city: about as many people and vehicles near the rider as before (main: ~140k / ~31k agent-steps)
    assert.ok(R.seen.person > 90000 && R.seen.vehicle > 20000, `life near the rider: ${JSON.stringify(R.seen)}`);
    assert.equal(R.jumps, 0, `jumps (worst ${R.worstJump.toFixed(2)} m in one step)`);
    assert.equal(R.personInRoad, 0, 'people in the carriageway near the rider');
    assert.equal(R.vehicleInLane, 0, "vehicles in the rider's lane ahead");
    assert.equal(R.popIn + R.popOut, 0, `spawned ${R.popIn} / despawned ${R.popOut} in view`);
  });
}
