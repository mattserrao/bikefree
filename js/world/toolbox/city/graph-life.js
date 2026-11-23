// Life on a free-ride road graph's rural maps (CNY, SKAN; user, 22 Nov: "remove cars, introduce bikes — no cars, bikes
// + walkers"): other cyclists riding the roads and trails both ways, alone and in small groups, and people walking —
// some with a dog — on the villages' sidewalks and the trails (the Erie Canal towpath). The toolbox's soft-cartoon
// figures (life/figures/people.js: the cyclist on its bike, walkers, dogs), two crowds of instanced meshes.
//
// Each figure follows the graph: along an edge's drawn centre line (world._curvePoint) at its own pace, keeping to
// the right of its way (cyclists in the lane, walkers on the sidewalk or the trail's edge); at a junction it takes
// another arm at random. Figures are kept round the camera: one that falls more than DROP_M behind is placed again
// on a way ahead or to the side (never within CLEAR_M of the rider, so nobody appears under the camera's nose).
//
//   const life = new GraphLife(world, parent, { quality, uTime }); life.tick(cam, riderPos, dt); life.dispose()
import { Crowd, CLIP, randomLook, dogLook, clipRate } from '../life/figures/people.js';
import { randomSequence } from '../core/random.js';

const COUNT = { low: { bikes: 8, walkers: 8 }, balanced: { bikes: 18, walkers: 18 }, high: { bikes: 26, walkers: 26 } };
const SPAWN_MIN = 160, SPAWN_MAX = 900, DROP_M = 1100, CLEAR_M = 90;
const BIKE_PATHS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'path']);
const LIFT = 0.1;

export class GraphLife {
  constructor(world, parent, { quality = 'balanced', uTime }) {
    this.W = world; this.rand = randomSequence(2211);
    const N = COUNT[quality] || COUNT.balanced;
    this.edges = world.G.edges.filter((e) => e.n >= 2 && BIKE_PATHS.has(e.kind) && !e.bridges.some(([a, b]) => b - a >= e.n - 1));
    // walkers: the ways with a sidewalk (the villages) and the trails
    this.walkEdges = this.edges.filter((e) => (world.walkOf(e) || 0) > 0.8 || e.kind === 'path' || e.kind === 'residential');
    this.bikeSet = new Set(this.edges); this.walkSet = new Set(this.walkEdges);
    // every ~50 m of each way, in 500 m cells: a spot is picked from the cells round the camera
    const grid = (list) => { const g = new Map(); for (const e of list) for (let k = 1; k < e.n; k += 5) { const c = `${Math.floor(e.x[k] / 500)},${Math.floor(e.z[k] / 500)}`; (g.get(c) || g.set(c, []).get(c)).push({ e, k, x: e.x[k], z: e.z[k] }); } return g; };
    this.mid = grid(this.edges); this.walkMid = grid(this.walkEdges);
    this.bikes = new Crowd(parent, { uTime, name: 'Cyclists', kind: 'cyclist', capacity: N.bikes + 4, nearM: quality === 'low' ? 30 : 60 });
    this.walkers = new Crowd(parent, { uTime, name: 'Walkers', capacity: N.walkers + 2, nearM: quality === 'low' ? 25 : 45, dogs: Math.ceil(N.walkers * 0.35) });
    this.agents = [];
    for (let k = 0; k < N.bikes; k++) this.agents.push(this._agent('bike'));
    for (let k = 0; k < N.walkers; k++) this.agents.push(this._agent('walk'));
    this.started = false;
  }

  _agent(kind) {
    const r = this.rand, bike = kind === 'bike';
    const look = randomLook(r, bike ? { helmet: true, sporty: true, kids: 0 } : { kids: 0.1, packs: 0.15, caps: 0.2 });
    let clip = bike ? CLIP.cycle : CLIP.walk;
    if (!bike && !look.kid && r() < 0.35) { look.dog = dogLook(r); clip = CLIP.leash; }
    const speed = bike ? 6 + r() * 3.5 : look.kid ? 1 : 1.15 + r() * 0.35;
    return { kind, bike, look, clip, speed, rate: clipRate(clip, speed, look), phase: r(), e: null, f: 0, dir: 1, side: 0.5 + r() * 0.3, x: 0, y: 0, z: 0, yaw: 0, roll: 0 };
  }

  /** Put agent a on a way between SPAWN_MIN and SPAWN_MAX from the camera (biased ahead), clear of the rider. */
  _spawn(a, cam, rider, fwd, first) {
    const G = a.bike ? this.mid : this.walkMid, list = [], ci = Math.floor(cam.x / 500), cj = Math.floor(cam.z / 500);
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) { const c = G.get(`${i},${j}`); if (c) list.push(c); }
    if (!list.length) return false;
    for (let tries = 0; tries < 40; tries++) {
      const cell = list[Math.floor(this.rand() * list.length)], m = cell[Math.floor(this.rand() * cell.length)], dx = m.x - cam.x, dz = m.z - cam.z, d = Math.hypot(dx, dz);
      if (d > SPAWN_MAX || (!first && d < SPAWN_MIN) || d < 25) continue;
      if (fwd && !first && (dx * fwd.x + dz * fwd.z) / (d || 1) < -0.3 && this.rand() < 0.75) continue;   // mostly ahead or to the side
      a.e = m.e; a.f = Math.min(m.e.n - 0.5, Math.max(0.5, m.k + this.rand() * 4 - 2)); a.dir = this.rand() < 0.5 ? 1 : -1;
      this._pose(a);
      if (rider && Math.hypot(a.x - rider.x, a.z - rider.z) < CLEAR_M) continue;
      return true;
    }
    return false;
  }

  /** Where agent a is drawn: on its edge at sample f, kept right of its way (by its travel direction). */
  _pose(a) {
    const W = this.W, e = a.e, p = W._curvePoint(e, a.f), half = W.wOf(e) / 2, walk = W.walkOf(e) || 0;
    let off;
    if (a.bike) off = e.kind === 'path' ? half * 0.45 : half * a.side;
    else off = walk > 0.8 ? half + walk * 0.5 : half - 0.45;   // (no sidewalk: on the edge of the way, facing traffic — there is none)
    // right of travel: (−dz, dx) along +f, the other way along −f
    const rx = -p.dz * a.dir, rz = p.dx * a.dir;
    a.x = p.x + rx * off; a.z = p.z + rz * off;
    a.y = (walk > 0.8 && !a.bike ? p.y + 0.15 : p.y) + LIFT;
    const yaw = Math.atan2(p.dx * a.dir, p.dz * a.dir);
    // a cyclist leans into a bend (from the heading's change), eased
    if (a.bike) { let dy = yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.roll += (Math.max(-0.35, Math.min(0.35, dy * 6)) - a.roll) * 0.2; }
    a.yaw = yaw;
  }

  /** Move agent a dist metres along the graph, turning onto another arm at a junction. */
  _move(a, dist) {
    let left = dist;
    for (let guard = 0; guard < 6 && left > 0; guard++) {
      const e = a.e, to = a.dir > 0 ? e.n : 0, room = Math.abs(to - a.f) * 10;
      if (left < room) { a.f += a.dir * left / 10; return; }
      left -= room;
      const node = a.dir > 0 ? e.to : e.from, arms = (this.W.arms?.get(node) || []).filter((r) => r.e !== e && (a.bike ? this.bikeSet : this.walkSet).has(r.e));
      if (!arms.length) { a.dir = -a.dir; a.f = to; continue; }   // (a dead end: turn round)
      const pick = arms[Math.floor(this.rand() * arms.length)];
      a.e = pick.e; a.dir = pick.end === 0 ? 1 : -1; a.f = pick.end === 0 ? 0 : pick.e.n;
    }
  }

  tick(cam, rider, fwd, dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    this.bikes.begin(cam); this.walkers.begin(cam);
    for (const a of this.agents) {
      if (!a.e || Math.hypot(a.x - cam.x, a.z - cam.z) > DROP_M) { if (!this._spawn(a, cam, rider, fwd, !this.started)) continue; }
      if (dt) { this._move(a, a.speed * dt); this._pose(a); }
      // nobody rides through the rider: a figure about to pass within 1.6 m of the rider waits a moment
      if (rider && Math.hypot(a.x - rider.x, a.z - rider.z) < 1.6) continue;
      (a.bike ? this.bikes : this.walkers).add(a.look, a.x, a.y, a.z, a.yaw, a.clip, a.phase, a.rate, a.bike ? a.roll : 0);
    }
    this.started = true;
    this.bikes.end(); this.walkers.end();
  }

  dispose() { this.bikes.dispose(); this.walkers.dispose(); }
}
