// Toolbox: traffic kit, any stylized scene with a "traffic" block. First built for Big Sur.
//
// v0.14 (user, 23 Nov 2026: "cars should be stationary only"; "remove all moving traffic"): nothing motorised
// moves any more. The road carries other cyclists only; the cars, campers and Red Jammers stand parked at the
// overlooks (the cars from the shared parked-car kit, life/figures/cars.js). Below, as first written:
//
// Light, realistic traffic on a two-lane highway (Big Sur's Highway 1): cars, hatchbacks, pickups and SUVs,
// rental RVs and campervans, motorcycles and other cyclists, both ways. Models from the figures kit (wheels
// turn with the distance driven, brake lights come on when slowing). Traffic overtakes the rider
// when the oncoming lane is clear (and waits behind when it isn't), and some vehicles pull into the
// overlooks for a while. Agents live in a window around the rider and are recycled; instanced draws.
import * as THREE from '../../../../vendor/three.js';
import { ROAD_WIDTH } from '../core/road-frame.js';
import { vehicleMesh, vehicleMaterial, setPaint, setMove, PAINTS } from './figures/vehicles.js';
import { carGeometry, carMaterial, PALETTES } from './figures/cars.js';
// the traffic kinds → the parked-car kit's (the jammer keeps its own model)
const KIT = { car: 'sedan', hatch: 'hatch', suv: 'suv', pickup: 'pickup', camper: 'van', rv: 'van' };
import { Crowd, CLIP, randomLook, clipRate } from './figures/people.js';
import { cyclists } from './population.js';   // [27 Nov] half the cyclists

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// kind (the scene's "mix" names) → model in the figures kit; bikes are cyclists from the people kit
const KINDS = [
  { kind: 'car', model: 'sedan', w: .3, speed: [19, 25], len: 4.5 },
  { kind: 'hatch', model: 'hatch', w: .12, speed: [18, 24], len: 4.0 },
  { kind: 'suv', w: .2, speed: [18, 24], len: 4.8 },
  { kind: 'pickup', w: .08, speed: [18, 24], len: 5.3 },
  { kind: 'camper', w: .05, speed: [15, 20], len: 4.7 },
  { kind: 'rv', w: .1, speed: [15, 19], len: 8.5 },
  { kind: 'moto', w: .1, speed: [20, 27], len: 2.2 },
  { kind: 'bike', w: .12, speed: [6, 9.5], len: 1.8 },
];
const COUNT = { low: 6, balanced: 10, high: 14 };
// optional kinds a scene can add to the mix ("traffic": { "mix": { "jammer": 0.33 } })
const EXTRA_KINDS = {
  // Glacier's Red Jammers: 1930s White Motor tour buses, canvas top rolled back
  jammer: { kind: 'jammer', w: 0, speed: [13, 18], len: 7.6, color: '#b5231c' },
};

export class HighwayTraffic {
  constructor(parent, route, index, landscape, uniforms, quality = 'balanced', config = {}) {
    this.route = route; this.index = index; this.L = landscape; this.config = config;
    this.group = new THREE.Group(); this.group.name = 'Highway traffic'; parent.add(this.group);
    this.night = { value: 0 };
    this.mat = vehicleMaterial(this.night);
    this.carMat = carMaterial({ dirt: .15, rust: .03, night: this.night });
    this.turn = route.turnS || route.total;
    this.seed = 9137; this.rand = () => ((this.seed = (this.seed * 16807) % 2147483647) / 2147483647);
    this.meshes = {};
    this.n = COUNT[quality] || COUNT.balanced;
    // the scene's mix: extra kinds (Red Jammers) with their share, the rest keep their weights
    this.kinds = KINDS.map((k) => ({ ...k }));
    for (const [name, w] of Object.entries(config.mix || {})) {
      const k = this.kinds.find((x) => x.kind === name) || (EXTRA_KINDS[name] && this.kinds.push({ ...EXTRA_KINDS[name] }) && this.kinds.at(-1));
      if (k) k.w = w;
    }
    // (moving: cyclists only — the motor kinds only park)
    for (const k of this.kinds) if (k.kind !== 'bike') k.w = 0;
    if (!this.kinds.some((k) => k.w > 0)) this.kinds.find((k) => k.kind === 'bike').w = 1;
    for (const k of this.kinds) {
      if (k.kind === 'bike') {
        // other road cyclists: pedalling figures (people kit), one draw
        this.bikes = new Crowd(this.group, { uTime: uniforms.uTime, name: 'Traffic · bike', capacity: this.n, nearM: Infinity, kind: 'cyclist' });
        this.bikeLooks = Array.from({ length: this.n }, () => randomLook(this.rand, { kids: 0, helmet: true }));
        continue;
      }
      if (k.kind === 'moto') continue;   // (no parked motorbikes)
      let mesh;
      if (KIT[k.kind]) {
        mesh = new THREE.InstancedMesh(carGeometry(KIT[k.kind], 'hi', { rack: k.kind === 'suv' }), this.carMat, this.n);
        const c = new THREE.Color();
        for (let i = 0; i < this.n; i++) mesh.setColorAt(i, c.set(k.kind === 'rv' ? '#f2efe6' : PALETTES.city[Math.floor(this.rand() * PALETTES.city.length)][0]));
        mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `Parked · ${k.kind}`; mesh.count = 0; mesh.userData.kit = true;
      } else {
        mesh = vehicleMesh(k.model || k.kind, this.mat, this.n, `Parked · ${k.kind}`);
        for (let i = 0; i < this.n; i++) if (k.color || k.kind !== 'rv') setPaint(mesh, i, k.color || PAINTS[Math.floor(this.rand() * PAINTS.length)]);
      }
      this.meshes[k.kind] = mesh; this.group.add(mesh);
    }
    this.agents = Array.from({ length: cyclists(this.n) }, (_, id) => ({ id, alive: false }));   // [27 Nov] half the cyclists (the parked cars keep this.n)
    // overlooks (turnouts) where traffic can pull in
    this.turnouts = (route.scene?.lookouts || []).map((l) => ({ s: l.atM, side: l.side === 'inland' ? -1 : 1, width: l.widthM || 10, length: l.lengthM || 30, used: 0 }));
    this.parked = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.one = V(1, 1, 1); this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.tmp = {};
    this._parkAtOverlooks();
  }

  // Outbound route frame at distance s: position, direction, grade.
  _at(s, out) {
    const r = this.route, ix = this.index, end = (r.turnIdx || r.dist.length - 1) - 1;
    const i = Math.max(0, Math.min(end, Math.floor(s / 10))), f = Math.min(1, Math.max(0, (s - r.dist[i]) / (r.dist[i + 1] - r.dist[i] || 10)));
    out.x = ix.xs[i] + (ix.xs[i + 1] - ix.xs[i]) * f; out.z = ix.zs[i] + (ix.zs[i + 1] - ix.zs[i]) * f; out.y = r.ele[i] + (r.ele[i + 1] - r.ele[i]) * f;
    const len = Math.hypot(ix.xs[i + 1] - ix.xs[i], ix.zs[i + 1] - ix.zs[i]) || 1;
    out.dx = (ix.xs[i + 1] - ix.xs[i]) / len; out.dz = (ix.zs[i + 1] - ix.zs[i]) / len; out.dy = (r.ele[i + 1] - r.ele[i]) / len;
    return out;
  }

  /** Is there a guard rail on the vehicle's right-hand edge near s? (scene roadside ranges) */
  _railAt(s, dir) {
    return (this.route.scene?.roadside || []).some((r) => (r.side === 'inland' ? -1 : 1) === dir && s > r.fromM - 25 && s < r.toM + 25);
  }

  _pick() {
    let r = this.rand() * this.kinds.reduce((a, k) => a + k.w, 0);
    for (const k of this.kinds) { r -= k.w; if (r <= 0) return k; }
    return this.kinds[0];
  }

  _parkAtOverlooks() {
    // a few cars and campers already parked at each overlook; they use the top slots of each buffer
    const top = Object.fromEntries(this.kinds.map((k) => [k.kind, this.n - 1]));
    for (const t of this.turnouts) {
      // parking bays along the pad, 9 m apart; a few already taken
      t.bays = Array.from({ length: Math.max(1, Math.floor((t.length - 8) / 9) + 1) }, (_, k) => ({ s: t.s - t.length / 2 + 5 + k * 9, taken: false }));
      t.lat = t.side * (ROAD_WIDTH / 2 + t.width / 2 + .3);
      const n = Math.min(t.bays.length - 1, 1 + Math.floor(this.rand() * 2));
      for (let k = 0; k < n; k++) {
        const jam = this.kinds.find((x) => x.kind === 'jammer');
        const by = (n) => this.kinds.find((x) => x.kind === n) || this.kinds[0], r = this.rand();
        const kind = jam && this.rand() < .3 ? jam : r < .15 ? by('rv') : r < .25 ? by('camper') : r < .5 ? by('suv') : r < .62 ? by('pickup') : r < .75 ? by('hatch') : by('car');
        if (top[kind.kind] < this.n / 2) continue;
        // parked from the far end (for the traffic that uses this side), so arrivals take the near bays
        const bay = t.side > 0 ? t.bays[t.bays.length - 1 - k] : t.bays[k]; if (bay.taken) continue;
        bay.taken = true;
        this.parked.push({ id: top[kind.kind]--, kind, s: bay.s, lane: t.lat, angle: .45 * t.side });
      }
    }
    this.top = top;   // moving agents use ids at or below these
  }

  _spawn(a, rider) {
    const k = this._pick(), dir = this.rand() < .5 ? 1 : -1;
    // same-direction traffic comes up from behind the rider; oncoming appears ahead
    const fwd = rider.dir;
    const ahead = dir === fwd ? -(150 + this.rand() * 300) : 450 + this.rand() * 500;
    const s = rider.out + fwd * ahead;
    if (s < 5 || s > this.turn - 5 || (k.kind === 'bike' && dir === fwd && this.rand() < .7)) { a.alive = false; return; }
    if (this.agents.some((b) => b.alive && b !== a && Math.abs(b.s - s) < 40)) { a.alive = false; return; }   // room to appear
    Object.assign(a, { alive: true, k, dir, s, v: k.speed[0] + this.rand() * (k.speed[1] - k.speed[0]), lane: 0, target: 0, state: 'drive', stop: 0, visited: false, over: false, dist: this.rand() * 50, brake: 0 });
    a.vmax = a.v;
  }

  setNight(v) { this.night.value = v; }

  /** rider: {x, z, out (outbound distance), dir (+1 outbound, −1 return), speed} */
  tick(dt, rider) {
    if (!rider) return;
    if (this._lastOut != null && dt > 0) rider.speed ??= Math.abs(rider.out - this._lastOut) / dt;
    this._lastOut = rider.out;
    // one shared clock: on average `perMinute` vehicles join the road around you (both directions)
    const mean = 60 / (this.config.perMinute ?? 4);
    if (this._next == null) {
      // start with a few already on the road
      for (const a of this.agents.slice(0, 3)) { this._spawn(a, rider); if (a.alive) a.s = rider.out + rider.dir * (-200 + this.rand() * 900); }
      this._next = mean * this.rand();
    }
    this._next -= dt;
    if (this._next <= 0) {
      const free = this.agents.find((a) => !a.alive);
      if (free) this._spawn(free, rider);
      this._next = -Math.log(1 - this.rand() * .95) * mean;   // exponential gaps: sometimes two close together
    }
    const lane0 = ROAD_WIDTH * .25;
    // Everyone on the road in one frame: absolute lateral offset from the centre line (outbound frame).
    const base = (k) => (k === 'bike' ? ROAD_WIDTH * .34 : k === 'rv' ? lane0 - .3 : lane0);   // campers hug the centre line on the bends
    const lat = (a) => (base(a.k.kind) + a.lane) * a.dir;
    const OVER = (a) => -2 * base(a.k.kind);   // overtaking: the middle of the other lane (not out by its edge)
    const riderBody = { s: rider.out, v: rider.speed || 0, dir: rider.dir, lat: 1.54 * rider.dir, len: 1.8, rider: true };
    const bodies = [riderBody];
    for (const b of this.agents) if (b.alive) bodies.push({ a: b, s: b.s, v: b.v, dir: b.dir, lat: lat(b), len: b.k.len, bike: b.k.kind === 'bike' });
    for (const p of this.parked) bodies.push({ s: p.s, v: 0, dir: 0, lat: p.lane, len: p.kind.len + 1, parked: true });
    // the nearest body ahead of `a` (in its direction of travel) that it would hit at lateral `l`
    const leader = (a, l, range) => {
      let best = null;
      for (const o of bodies) {
        if (o.a === a) continue;
        const d = (o.s - a.s) * a.dir;
        if (d <= 0 || d > range || Math.abs(o.lat - l) > 2.3) continue;
        if (!best || d < best.d) best = { ...o, d };
      }
      return best;
    };
    for (const a of this.agents) {
      if (!a.alive) continue;
      let want = a.vmax;
      const myLat = lat(a);
      if (a.state === 'drive') {
        const ahead = leader(a, myLat, 90);
        const slow = ahead && (ahead.rider || ahead.bike || (ahead.dir === a.dir && ahead.v < a.vmax - 3));
        if (a.k.kind === 'bike' && ahead?.rider && ahead.dir === a.dir && ahead.d < 9) want = Math.min(want, ahead.v * .97);   // sits on your wheel
        if (a.k.kind !== 'bike' && !a.over && slow && ahead.dir === a.dir && ahead.d < 60) {
          // overtake only if the other lane is clear well ahead (nobody coming, nobody already there)
          const overLat = -base(a.k.kind) * a.dir, need = 280;
          const blocked = bodies.some((o) => o.a !== a && Math.abs(o.lat - overLat) < 2.3 && (o.s - a.s) * a.dir > -12 && (o.s - a.s) * a.dir < need);
          if (!blocked) { a.target = OVER(a); a.over = true; }
        }
        if (a.over) {
          // in the other lane: abort if something comes at us; back in once clear of what we passed
          const coming = leader(a, myLat, 150);
          if (coming && coming.dir !== a.dir) { a.target = 0; a.over = false; }
          const passed = !bodies.some((o) => o.a !== a && (o.rider || o.bike || o.dir === a.dir) && Math.abs(o.lat - lane0 * a.dir) < 2.3 && (o.s - a.s) * a.dir > -14 && (o.s - a.s) * a.dir < 25);
          if (passed) { a.target = 0; a.over = false; }
        }
        // pull into an overlook on our side now and then, into a free bay
        for (const t of this.turnouts) {
          const side = t.side * (a.dir > 0 ? 1 : -1);   // overlook on the vehicle's right?
          if (a.k.kind === 'bike' || side <= 0 || a.visited || a.target !== 0 || Math.abs((t.s - a.s) * a.dir - 70) > 3) continue;
          a.visited = true;
          // the first bay in the direction of travel, so the car never drives across a parked one
          const bay = [...t.bays].sort((p, q) => (p.s - q.s) * a.dir)[0];
          if (bay.taken) continue;
          if (bay && this.rand() < .35) { a.state = 'in'; a.turnout = t; a.bay = bay; bay.taken = true; }
        }
        // a slower vehicle or cyclist just ahead of the rider moves over to let you by
        const r = (rider.out - a.s) * a.dir;
        // (onto the shoulder; where a guard rail lines that edge, it straddles the centre line instead if
        // nothing is coming, so you pass on its right)
        if (a.dir === rider.dir && r < 0 && r > -35 && Math.abs(myLat - riderBody.lat) < 2.3 && a.v < riderBody.v + .5 && !a.over) {
          if (a.k.kind === 'bike') a.target = .9;
          else if (!this._railAt(a.s, a.dir)) a.target = 1.3;
          else if (!bodies.some((o) => o.dir === -a.dir && (o.s - a.s) * a.dir > -10 && (o.s - a.s) * a.dir < 150)) a.target = -1.6;
        } else if (Math.abs(a.target) > .5 && !a.over && (a.dir !== rider.dir || r > 8 || r < -40 || a.v > riderBody.v + 1)) a.target = 0;
      }
      if (a.state === 'in') {
        const t = a.turnout, d = (a.bay.s - a.s) * a.dir;
        want = Math.max(1.5, Math.min(a.vmax, d * .45));
        a.target = d < 25 ? t.lat * a.dir - lane0 : 0;
        if (d < 1) { a.state = 'parked'; a.stop = 15 + this.rand() * 30; a.v = 0; }
      } else if (a.state === 'parked') {
        want = 0; a.stop -= dt;
        if (a.stop <= 0) { a.state = 'out'; }
      } else if (a.state === 'out') {
        // wait for a gap before rejoining
        const near = bodies.some((o) => o.a !== a && Math.abs(o.lat - lane0 * a.dir) < 2.3 && (a.s - o.s) * a.dir > -10 && (a.s - o.s) * a.dir < 60);
        want = near ? 0 : a.vmax * .6; if (!near) a.target = 0;
        if (Math.abs(a.lane) < .3) { a.state = 'drive'; a.bay.taken = false; }
      }
      // follow whatever is ahead in our path, and never closer than a car length or so
      let lead = a.state === 'parked' ? null : leader(a, myLat, 120);
      if (lead?.parked && a.state !== 'drive') lead = null;   // pulling into (or out of) a bay beside the parked ones
      if (lead) {
        const safe = 5 + (a.k.len + lead.len) / 2;
        const closing = lead.dir === a.dir ? lead.v : -lead.v;   // oncoming in our lane: stop
        want = Math.min(want, Math.max(0, closing + (lead.d - safe - 6) * .55));
      }
      a.brake = want < a.v - .6 ? 1 : 0;   // brake lights
      a.v += Math.max(-9 * dt, Math.min(2.5 * dt, want - a.v));
      a.v = Math.max(0, a.v);
      let step = a.v * dt;
      if (lead) step = Math.min(step, Math.max(0, lead.d - (2 + (a.k.len + lead.len) / 2)));   // hard stop: no overlap
      a.s += a.dir * step; a.dist += step;
      a.lane += Math.max(-1.6 * dt, Math.min(1.6 * dt, a.target - a.lane));
      if (a.s < 0 || a.s > this.turn || (a.s - rider.out) * rider.dir < -400 || (a.s - rider.out) * rider.dir > 1300) {
        if (a.state === 'in' || a.state === 'parked' || a.state === 'out') a.bay.taken = false;
        a.alive = false;
      }
    }
    // draw
    this.bikes?.begin({ x: 0, y: 0, z: 0 });
    const put = (kind, id, s, lateral, dir, pitchOn = true, yawExtra = 0, a = null) => {
      const p = this._at(s, this.tmp);
      const x = p.x - p.dz * lateral, z = p.z + p.dx * lateral, yaw = Math.atan2(p.dx * dir, p.dz * dir) + yawExtra;
      if (kind === 'bike') { this.bikes.add(this.bikeLooks[id], x, p.y + .12, z, yaw, CLIP.cycle, (id * .37) % 1, a && a.v > .3 ? clipRate(CLIP.cycle, a.v) : 0); return; }
      this.e.set(pitchOn ? -Math.atan(p.dy) * dir : 0, yaw, 0);
      this.q.setFromEuler(this.e);
      const mesh = this.meshes[kind]; if (!mesh) return;
      mesh.setMatrixAt(id, this.m.compose(V(x, p.y + .12, z), this.q, this.one));
      if (!mesh.userData.kit) setMove(mesh, id, a ? a.dist : 0, a ? a.brake : 0);
    };
    const next = {}, assigned = {};
    for (const k of this.kinds) { next[k.kind] = 0; assigned[k.kind] = new Set(); }
    for (const a of this.agents) {
      if (!a.alive) continue;
      const kind = a.k.kind, id = next[kind]++;
      if (id > this.top[kind]) { a.alive = false; continue; }
      // right of the direction of travel (cyclists ride near the edge)
      put(kind, id, a.s, lat(a), a.dir, true, 0, a);
      assigned[kind].add(id);
    }
    for (const p of this.parked) { put(p.kind.kind, p.id, p.s, p.lane, 1, false, p.angle); assigned[p.kind.kind].add(p.id); }
    this.bikes?.end();
    for (const k of this.kinds) {
      const mesh = this.meshes[k.kind], ids = assigned[k.kind];
      if (!mesh) continue;
      const count = ids.size ? Math.max(...ids) + 1 : 0;
      for (let i = 0; i < count; i++) if (!ids.has(i)) mesh.setMatrixAt(i, this.zero);
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true; if (mesh.geometry.attributes.iMove) mesh.geometry.attributes.iMove.needsUpdate = true;
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of Object.values(this.meshes)) { if (!m.userData.kit) m.geometry.dispose(); m.dispose(); }
    this.carMat.dispose();
    this.bikes?.dispose();
    this.mat.dispose();
  }
}
