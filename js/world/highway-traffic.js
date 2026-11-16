// Light, realistic traffic on a two-lane highway (Big Sur's Highway 1): cars, pickups and SUVs,
// rental RVs and campervans, motorcycles and other cyclists, both ways. Traffic overtakes the rider
// when the oncoming lane is clear (and waits behind when it isn't), and some vehicles pull into the
// overlooks for a while. Agents live in a window around the rider and are recycled; instanced draws.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './city-geometry.js';
import { ROAD_WIDTH } from './pose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PAINT = ['#b23a2e', '#1f3a5f', '#e9ecee', '#2b2b2b', '#7f8c8d', '#c5c9cc', '#28543c', '#d9c38a', '#5b2c6f', '#8a3c12', '#ffffff', '#4f6475', '#9db4c8', '#c9c2b0'];
const KINDS = [
  { kind: 'car', w: .46, speed: [19, 25], len: 4.5 },
  { kind: 'suv', w: .22, speed: [18, 24], len: 5.0 },
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

// part: 0 body (tinted per instance), 1 glass, 2 dark trim, 10 headlight, 11 tail light
function vehicle(kind) {
  const M = new MeshBuilder({ aGlow: 1 });
  const G = (g) => M.set({ aGlow: [g] });
  G(0);
  if (kind === 'car' || kind === 'suv') {
    const W = kind === 'suv' ? 1.9 : 1.8, L = kind === 'suv' ? 4.9 : 4.5, H = kind === 'suv' ? .82 : .62;
    M.color('#ffffff'); M.box(0, .3, 0, W, H, L);
    M.box(0, .3 + H, kind === 'suv' ? -.35 : -.2, W * .92, kind === 'suv' ? .72 : .5, L * (kind === 'suv' ? .62 : .5));
    M.color('#25303a'); M.box(0, .36 + H, kind === 'suv' ? -.35 : -.2, W * .94, kind === 'suv' ? .56 : .38, L * (kind === 'suv' ? .6 : .46));
    M.color('#151515'); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) M.box(x * (W / 2 - .08), 0, z * (L / 2 - .85), .28, .66, .66);
    G(10); M.color('#fff6dc'); for (const x of [-1, 1]) M.box(x * (W / 2 - .3), .62, L / 2, .34, .14, .05);
    G(11); M.color('#b0201a'); for (const x of [-1, 1]) M.box(x * (W / 2 - .25), .66, -L / 2 - .02, .3, .14, .05);
  } else if (kind === 'rv') {
    const W = 2.4, L = 8.4;
    M.color('#f1ede4'); M.box(0, .45, -.6, W, 2.7, L - 1.6);
    M.color('#ffffff'); M.box(0, .45, L / 2 - 1.2, W * .96, 1.3, 2.2);
    M.color('#2a3540'); M.box(0, 1.2, L / 2 - .6, W * .9, .6, 1.2); M.box(0, 2.05, -.6, W + .02, .55, L - 3);
    M.color('#7a5a3a'); M.box(0, 1.25, -.6, W + .03, .16, L - 1.8);
    M.color('#151515'); for (const [x, z] of [[-1, -1], [1, -1], [-1, .6]]) M.box(x * (W / 2 - .1), 0, z * (L / 2 - 1.1), .3, .8, .8);
    M.box(1 * (W / 2 - .1), 0, .6 * (L / 2 - 1.1), .3, .8, .8);
    G(10); M.color('#fff6dc'); for (const x of [-1, 1]) M.box(x * (W / 2 - .35), .75, L / 2 + .02, .34, .16, .05);
    G(11); M.color('#b0201a'); for (const x of [-1, 1]) M.box(x * (W / 2 - .2), .9, -L / 2 + .78, .25, .3, .05);
  } else if (kind === 'jammer') {
    // long hood and rounded fenders, four rows of bench seats under an open top, the canvas rolled at the back
    const W = 2.15, L = 7.6;
    M.color('#ffffff'); M.box(0, .5, -.9, W, 1.05, L - 2.6);            // body (red, from the instance colour)
    M.box(0, .62, L / 2 - 1.15, 1.35, .82, 2.1);                         // the long hood
    G(12); M.color('#e9e4d4'); M.box(0, .62, L / 2 - .08, 1.2, .78, .12);   // chrome grille
    M.color('#1a1a1a'); for (const [x, z] of [[-1, -1], [1, -1]]) M.box(x * (W / 2 - .02), .3, z * (L / 2 - 1.25), .4, .62, 1.3);
    for (const x of [-1, 1]) M.box(x * .78, .32, L / 2 - 1.05, .42, .6, 1.25);   // front fenders
    M.color('#151515'); for (const [x, z] of [[-1, -1], [1, -1], [-.78, .73], [.78, .73]]) M.box(x * (z > 0 ? 1 : W / 2 - .1), 0, z * (L / 2 - 1.15), .3, .78, .78);
    M.color('#3b2a20'); for (let r = 0; r < 4; r++) M.box(0, 1.5, 1.35 - r * 1.2, W - .2, .32, .55);   // bench backs
    const heads = ['#e2b48a', '#c98c5e', '#8a5a3c', '#f0c9a2'];
    for (let r = 0; r < 4; r++) for (const x of [-.6, 0, .6]) if ((r * 3 + x * 5 + 7) % 3 > .5) { M.color(heads[(r + Math.round(x * 3)) % 4]); M.box(x, 1.68, 1.15 - r * 1.2, .2, .24, .2); }
    M.color('#cdbb8f'); M.box(0, 1.5, -L / 2 + .55, W - .1, .55, .8);   // rolled canvas
    M.color('#e9e4d4'); M.box(0, 1.55, L / 2 - 2.25, W - .1, .5, .06);  // windscreen frame
    G(10); M.color('#fff6dc'); for (const x of [-1, 1]) M.box(x * .78, .95, L / 2 - .5, .26, .26, .26);
    G(11); M.color('#b0201a'); for (const x of [-1, 1]) M.box(x * (W / 2 - .2), .7, -L / 2 + .45 - .02, .2, .14, .05);
  } else if (kind === 'moto') {
    M.color('#151515'); for (const z of [-.7, .7]) M.box(0, 0, z, .14, .62, .62);
    M.color('#ffffff'); M.beam(V(0, .45, -.55), V(0, .62, .55), .3, .32);
    M.color('#2b2b2b'); M.box(0, .6, -.2, .34, .42, .45);         // rider legs and body
    M.beam(V(0, .95, -.25), V(0, 1.45, .05), .38, .3);
    M.color('#d8d8d8'); M.box(0, 1.45, .02, .3, .3, .32);           // helmet
    G(10); M.color('#fff6dc'); M.box(0, .75, .95, .16, .14, .05);
    G(11); M.color('#b0201a'); M.box(0, .7, -.98, .14, .1, .04);
  } else {
    // another road cyclist: wheels, frame, rider in a bright kit
    M.color('#151515'); for (const z of [-.52, .52]) M.box(0, 0, z, .05, .68, .68);
    M.color('#9a9a9a'); M.beam(V(0, .34, -.52), V(0, .95, -.12), .05, .05); M.beam(V(0, .95, -.12), V(0, .95, .42), .05, .05); M.beam(V(0, .95, .42), V(0, .34, .52), .05, .05);
    M.color('#ffffff'); M.beam(V(0, 1.0, -.15), V(0, 1.38, .3), .36, .24);   // jersey (tinted)
    M.color('#1f1f1f'); M.box(-.1, .45, -.12, .13, .55, .15); M.box(.1, .45, -.12, .13, .55, .15);
    M.color('#f0f0f0'); M.box(0, 1.42, .34, .24, .16, .3);
    G(11); M.color('#e0281a'); M.box(0, .9, -.6, .06, .08, .03);
  }
  return M;
}

function material(uniforms, night) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying float vGlow;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // lights and glass keep their own colour (not the paint tint)
        #ifdef USE_INSTANCING_COLOR
          if (vGlow > 9.5) diffuseColor.rgb = vColor.rgb / max(vInstanceColor.rgb, vec3(.05));
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vGlow > 9.5 && vGlow < 10.5) totalEmissiveRadiance += vec3(1., .93, .78) * (.15 + uNight * 4.);
        if (vGlow > 10.5 && vGlow < 11.5) totalEmissiveRadiance += vec3(1., .1, .06) * (.25 + uNight * 2.5);`);
  };
  m.customProgramCacheKey = () => 'bf-highway-traffic-2';
  return m;
}

export class HighwayTraffic {
  constructor(parent, route, index, landscape, uniforms, quality = 'balanced', config = {}) {
    this.route = route; this.index = index; this.L = landscape; this.config = config;
    this.group = new THREE.Group(); this.group.name = 'Highway traffic'; parent.add(this.group);
    this.night = { value: 0 };
    this.mat = material(uniforms, this.night);
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
    for (const k of this.kinds) {
      const geometry = vehicle(k.kind).geometry();
      const mesh = new THREE.InstancedMesh(geometry, this.mat, this.n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `Traffic · ${k.kind}`; mesh.count = 0;
      for (let i = 0; i < this.n; i++) mesh.setColorAt(i, new THREE.Color(k.color || (k.kind === 'rv' ? '#ffffff' : PAINT[Math.floor(this.rand() * PAINT.length)])));
      this.meshes[k.kind] = mesh; this.group.add(mesh);
    }
    this.agents = Array.from({ length: this.n }, (_, id) => ({ id, alive: false }));
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
        const kind = jam && this.rand() < .3 ? jam : this.rand() < .2 ? this.kinds[2] : this.rand() < .4 ? this.kinds[1] : this.kinds[0];
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
    Object.assign(a, { alive: true, k, dir, s, v: k.speed[0] + this.rand() * (k.speed[1] - k.speed[0]), lane: 0, target: 0, state: 'drive', stop: 0, visited: false, over: false });
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
      a.v += Math.max(-9 * dt, Math.min(2.5 * dt, want - a.v));
      a.v = Math.max(0, a.v);
      let step = a.v * dt;
      if (lead) step = Math.min(step, Math.max(0, lead.d - (2 + (a.k.len + lead.len) / 2)));   // hard stop: no overlap
      a.s += a.dir * step;
      a.lane += Math.max(-1.6 * dt, Math.min(1.6 * dt, a.target - a.lane));
      if (a.s < 0 || a.s > this.turn || (a.s - rider.out) * rider.dir < -400 || (a.s - rider.out) * rider.dir > 1300) {
        if (a.state === 'in' || a.state === 'parked' || a.state === 'out') a.bay.taken = false;
        a.alive = false;
      }
    }
    // draw
    const put = (kind, id, s, lateral, dir, pitchOn = true, yawExtra = 0) => {
      const p = this._at(s, this.tmp);
      const x = p.x - p.dz * lateral, z = p.z + p.dx * lateral;
      this.e.set(pitchOn ? -Math.atan(p.dy) * dir : 0, Math.atan2(p.dx * dir, p.dz * dir) + yawExtra, 0);
      this.q.setFromEuler(this.e);
      this.meshes[kind].setMatrixAt(id, this.m.compose(V(x, p.y + .12, z), this.q, this.one));
    };
    const next = {}, assigned = {};
    for (const k of this.kinds) { next[k.kind] = 0; assigned[k.kind] = new Set(); }
    for (const a of this.agents) {
      if (!a.alive) continue;
      const kind = a.k.kind, id = next[kind]++;
      if (id > this.top[kind]) { a.alive = false; continue; }
      // right of the direction of travel (cyclists ride near the edge)
      put(kind, id, a.s, lat(a), a.dir);
      assigned[kind].add(id);
    }
    for (const p of this.parked) { put(p.kind.kind, p.id, p.s, p.lane, 1, false, p.angle); assigned[p.kind.kind].add(p.id); }
    for (const k of this.kinds) {
      const mesh = this.meshes[k.kind], ids = assigned[k.kind];
      const count = ids.size ? Math.max(...ids) + 1 : 0;
      for (let i = 0; i < count; i++) if (!ids.has(i)) mesh.setMatrixAt(i, this.zero);
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of Object.values(this.meshes)) { m.geometry.dispose(); m.dispose(); }
    this.mat.dispose();
  }
}
