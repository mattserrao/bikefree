// Everything that moves in the city: people walking, jogging, cycling and standing around,
// cars and buses (oncoming traffic on the route's streets too), light-rail and freight trains,
// the two inclines up Mount Washington, barges, the riverboat, motorboats and kayaks, and birds.
// Agents live near the camera and are recycled as you ride; all draw calls are instanced.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder, makePath, hash, ribbon } from './city-geometry.js';
import { LAND } from './city-landscape.js';
import { ROAD_WIDTH } from './pose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const COUNTS = { low: { people: 70, cars: 40, cyclists: 6 }, balanced: { people: 160, cars: 85, cyclists: 12 }, high: { people: 260, cars: 140, cyclists: 18 } };
const SHIRTS = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#ecf0f1', '#34495e', '#8e44ad', '#e67e22', '#16a085', '#d35400', '#1b1b1b', '#f5b7b1', '#5d6d7e', '#ffcc00'];
const PANTS = ['#2c3e50', '#1c2833', '#5d4e37', '#34495e', '#7f8c8d', '#283747', '#b9a27e'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0673a'];
const CARS = ['#c0392b', '#1f3a5f', '#ecf0f1', '#2c2c2c', '#7f8c8d', '#bdc3c7', '#1e8449', '#f4d03f', '#5b2c6f', '#a04000', '#ffffff', '#566573'];

// ---------------------------------------------------------------- shared animated material
function animatedMaterial(life, kind) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = life.city.uniforms.uTime; shader.uniforms.uNight = life.city.night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; attribute float aPart; attribute vec3 aMask; attribute vec3 iA; attribute vec3 iB; attribute vec3 iC; attribute vec2 iAnim;
        varying float vLight;`)
      .replace('#include <begin_vertex>', kind === 'people' ? `
        vec3 transformed = vec3(position);
        float gait = iAnim.y;
        float freq = gait > 2.5 ? 7.5 : gait > 1.5 ? 9.5 : 6.2;
        float amp = gait > 2.5 ? .9 : gait > 1.5 ? .75 : gait > .5 ? .42 : 0.;
        float sw = sin(uTime * freq + iAnim.x) * amp;
        float ang = 0.;
        if (aPart > .5 && aPart < 1.5) ang = sw; else if (aPart > 1.5 && aPart < 2.5) ang = gait > 2.5 ? sin(uTime * freq + iAnim.x + 3.1416) * amp : -sw;
        else if (aPart > 2.5 && aPart < 3.5) ang = -sw * .8 * step(gait, 2.5); else if (aPart > 3.5) ang = sw * .8 * step(gait, 2.5);
        float pivot = aPart < 2.5 ? (gait > 2.5 ? .95 : .92) : 1.45;
        if (aPart > .5) { float y = transformed.y - pivot, z = transformed.z - (gait > 2.5 && aPart < 2.5 ? -.12 : 0.); float c = cos(ang), s = sin(ang);
          transformed.y = pivot + y * c - z * s; transformed.z = y * s + z * c + (gait > 2.5 && aPart < 2.5 ? -.12 : 0.); }
        if (gait < .5) transformed.x += sin(uTime * .8 + iAnim.x) * .025 * transformed.y;
        transformed.y += abs(sw) * .035 * step(gait, 2.5);` : `
        vec3 transformed = vec3(position);`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb = vColor.rgb * clamp(1. - aMask.x - aMask.y - aMask.z, 0., 1.) + iA * aMask.x + iB * aMask.y + iC * aMask.z;
        vLight = aPart;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying float vLight;')
      .replace('#include <emissivemap_fragment>', kind === 'people' ? '#include <emissivemap_fragment>' : `#include <emissivemap_fragment>
        if (vLight > 9.5 && vLight < 10.5) totalEmissiveRadiance += vec3(1., .93, .78) * uNight * 4.;
        if (vLight > 10.5 && vLight < 11.5) totalEmissiveRadiance += vec3(1., .08, .05) * uNight * 2.5;
        if (vLight > 11.5 && vLight < 12.5) totalEmissiveRadiance += vec3(1., .82, .55) * uNight * .9;`);
  };
  m.customProgramCacheKey = () => `city-anim-${kind}-1`;
  return life.city.own(m);
}

function instanced(life, builder, material, count, name, shadow = true) {
  const geo = life.city.own(builder.geometry());
  for (const [k, n] of [['iA', 3], ['iB', 3], ['iC', 3], ['iAnim', 2]]) geo.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(count * n), n));
  const im = new THREE.InstancedMesh(geo, material, count);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true; im.name = name;
  im.count = 0;
  life.city.group.add(im);
  return im;
}

const setColor = (im, attr, i, hex) => { const c = new THREE.Color(hex); im.geometry.attributes[attr].setXYZ(i, c.r, c.g, c.b); };

// ---------------------------------------------------------------- geometry
function personGeometry() {
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  const P = (part, mask) => M.set({ aPart: [part], aMask: mask });
  P(1, [0, 1, 0]); M.box(-.1, .1, 0, .15, .84, .17); P(2, [0, 1, 0]); M.box(.1, .1, 0, .15, .84, .17);
  M.color('#222'); P(1, [0, 0, 0]); M.box(-.1, 0, .03, .15, .1, .27); P(2, [0, 0, 0]); M.box(.1, 0, .03, .15, .1, .27);
  M.color('#fff'); P(0, [1, 0, 0]); M.box(0, .9, 0, .44, .62, .25);
  P(3, [1, 0, 0]); M.box(-.28, .92, 0, .11, .56, .13); P(4, [1, 0, 0]); M.box(.28, .92, 0, .11, .56, .13);
  P(3, [0, 0, 1]); M.box(-.28, .8, 0, .09, .12, .1); P(4, [0, 0, 1]); M.box(.28, .8, 0, .09, .12, .1);
  P(0, [0, 0, 1]); M.box(0, 1.52, 0, .22, .27, .24); M.box(0, 1.48, 0, .1, .06, .1);
  M.color('#2b2018'); P(0, [0, 0, 0]); M.box(0, 1.74, -.01, .24, .08, .26);
  return M;
}

function cyclistGeometry() {
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  const P = (part, mask) => M.set({ aPart: [part], aMask: mask });
  M.color('#1b1b1b'); P(0, [0, 0, 0]);
  for (const z of [-.52, .52]) { M.cylinder(0, .02, z, .02, .01); M.beam(V(0, .34, z - .33), V(0, .34, z + .33), .04, .66); }
  M.color('#888'); M.beam(V(0, .34, -.52), V(0, .95, -.15), .05, .05); M.beam(V(0, .95, -.15), V(0, .95, .42), .05, .05); M.beam(V(0, .95, .42), V(0, .34, .52), .05, .05); M.beam(V(0, .34, -.1), V(0, .95, .42), .05, .05);
  M.color('#fff'); P(1, [0, 1, 0]); M.box(-.1, .45, -.1, .13, .52, .15); P(2, [0, 1, 0]); M.box(.1, .45, -.1, .13, .52, .15);
  P(0, [1, 0, 0]); M.beam(V(0, 1.0, -.12), V(0, 1.42, .25), .38, .24);
  M.beam(V(-.2, 1.36, .2), V(-.2, 1.0, .45), .09, .09); M.beam(V(.2, 1.36, .2), V(.2, 1.0, .45), .09, .09);
  P(0, [0, 0, 1]); M.box(0, 1.45, .3, .2, .24, .22);
  M.color('#e8e8e8'); P(0, [0, 0, 0]); M.box(0, 1.66, .28, .26, .1, .3);
  return M;
}

function carGeometry(bus = false) {
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  const P = (part, mask) => M.set({ aPart: [part], aMask: mask });
  const L = bus ? 12 : 4.4, W = bus ? 2.55 : 1.82, H = bus ? 2.9 : 1.45;
  M.color('#fff'); P(0, [1, 0, 0]);
  M.box(0, .32, 0, W, bus ? H - .32 : .62, L);
  if (!bus) { M.box(0, .94, -.25, W * .9, .5, L * .5); M.color('#1d2329'); P(12, [0, 0, 0]); M.box(0, .96, -.25, W * .92, .42, L * .46); }
  else { M.color('#1d2329'); P(12, [0, 0, 0]); M.box(0, 1.35, 0, W + .02, .9, L - .8); M.color('#2a5aa5'); P(0, [0, 0, 0]); M.box(0, .5, 0, W + .03, .25, L - .3); }
  M.color('#111'); P(0, [0, 0, 0]);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) M.box(x * (W / 2 - .05), 0, z * (L / 2 - (bus ? 2 : .8)), .26, .64, .64);
  M.color('#fff8e0'); P(10, [0, 0, 0]); for (const x of [-1, 1]) M.box(x * (W / 2 - .3), .58, L / 2, .32, .16, .05);
  M.color('#c0392b'); P(11, [0, 0, 0]); for (const x of [-1, 1]) M.box(x * (W / 2 - .25), .62, -L / 2 - .02, .3, .14, .05);
  return M;
}

function boatGeometry(type) {
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  const P = (part) => M.set({ aPart: [part], aMask: [0, 0, 0] });
  P(0);
  if (type === 'tow') {
    // towboat pushing a 2×3 raft of barges ahead of it (+z forward)
    M.color('#2a2a2a'); M.box(0, -1, -8, 10, 2.6, 30);
    M.color('#f2f2ee'); M.box(0, 1.6, -14, 8, 3, 12); M.box(0, 4.6, -15, 6.5, 3, 7); M.color('#e9e6dc'); M.box(0, 7.6, -15.5, 5, 2.4, 4.4);
    M.color('#1a1f24'); P(12); M.box(0, 8.2, -15.5, 5.1, .9, 4.5); P(0);
    M.color('#c0392b'); M.box(0, 1.5, -6, 9.6, .5, 10);
    for (let r = 0; r < 3; r++) for (const x of [-5.4, 5.4]) {
      M.color(r % 2 ? '#5b3a29' : '#3b3530'); M.box(x, -1.2, 18 + r * 60, 10.6, 2.6, 59);
      M.color('#2c2c2c'); M.box(x, 1.4, 18 + r * 60, 9, .9, 55);
      M.color('#1b1b1b'); M.box(x, 2.2, 18 + r * 60, 8, 1.1, 50);
    }
  } else if (type === 'clipper') {
    M.color('#f4f4f0'); M.box(0, -1, 0, 12, 3, 46); M.color('#b22222'); M.box(0, 1.9, 0, 12.2, .5, 46.2);
    M.color('#f7f7f2'); M.box(0, 2.4, -2, 11, 3, 38); M.box(0, 5.4, -4, 10, 2.8, 28); M.box(0, 8.2, -8, 7, 2.4, 10);
    M.color('#1c2630'); P(12); M.box(0, 3.4, -2, 11.1, 1.2, 37); M.box(0, 6.3, -4, 10.1, 1.1, 27); M.box(0, 8.9, -8, 7.1, 1, 9.6); P(0);
    M.color('#b22222'); M.cylinder(0, 10.6, -12, .8, 3.2, 8, .7);
  } else if (type === 'motor') {
    M.color('#fff'); M.set({ aPart: [0], aMask: [1, 0, 0] }); M.box(0, -.4, 0, 2.6, 1.1, 8); M.pyramid(0, -.4, 4.5, 2.6, 1.1, 1.4, 0);
    M.color('#1c2630'); P(12); M.box(0, .7, -.5, 2.2, .7, 2.4); P(0); M.color('#eee'); M.box(0, .7, -2.6, 2.4, .3, 2.6);
  } else {
    M.set({ aPart: [0], aMask: [1, 0, 0] }); M.color('#fff'); M.box(0, -.15, 0, .65, .3, 4.2);
    P(0); M.color('#2b3a4a'); M.box(0, .15, 0, .36, .5, .4); M.color('#f1c27d'); M.box(0, .65, 0, .18, .22, .2);
    M.color('#333'); M.beam(V(-1.1, .55, .1), V(1.1, .55, .1), .05, .05);
  }
  return M;
}

function trainGeometry(kind) {
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  const P = (part) => M.set({ aPart: [part], aMask: [0, 0, 0] });
  P(0);
  if (kind === 'lrt') {
    M.color('#d4d6d8'); M.box(0, .6, 0, 2.65, 2.9, 25.5);
    M.color('#b0182a'); M.box(0, 1.2, 0, 2.67, .4, 25.6);
    M.color('#1c2630'); P(12); M.box(0, 2.1, 0, 2.68, 1, 23); P(0);
    M.color('#fff8e0'); P(10); M.box(0, 1.3, 12.8, 1.4, .25, .1);
    M.color('#333'); P(0); M.beam(V(0, 3.5, -4), V(0, 4.4, 0), .06, .06);
  } else {
    M.color('#2b2b2b'); M.box(0, .9, 0, 3, 3.4, 18);   // locomotive or car
    M.color('#e0a020'); M.box(0, 3.2, 6, 3.05, .4, 6);
    M.color('#fff8e0'); P(10); M.box(0, 3.8, 9, .8, .3, .1);
  }
  return M;
}

function railCarGeometry(color) {
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  M.set({ aPart: [0], aMask: [1, 0, 0] }); M.color('#fff'); M.box(0, .9, 0, 3, 3, 16.5);
  M.set({ aPart: [0], aMask: [0, 0, 0] }); M.color('#222'); M.box(0, .3, 0, 2.6, .6, 16);
  return M;
}

function birdGeometry() {
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  M.set({ aPart: [0], aMask: [0, 0, 0] }); M.color('#e8e8e4');
  M.triangle(V(0, 0, .25), V(-.5, 0, -.1), V(0, 0, -.25)); M.triangle(V(0, 0, .25), V(0, 0, -.25), V(.5, 0, -.1));
  M.triangle(V(0, 0, .25), V(0, 0, -.25), V(-.5, 0, -.1)); M.triangle(V(0, 0, .25), V(.5, 0, -.1), V(0, 0, -.25));
  return M;
}

// ---------------------------------------------------------------- network helpers
function offsetLine(pts, off) {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x - (b.z - a.z) / len * off, y: p.y, z: p.z + (b.x - a.x) / len * off };
  });
}
function chainPolylines(lines, tol = 1.5) {
  const key = (p) => `${Math.round(p.x / tol)},${Math.round(p.z / tol)}`;
  const pool = lines.map((l) => l.slice());
  const out = [];
  while (pool.length) {
    let cur = pool.pop(), grown = true;
    while (grown) {
      grown = false;
      for (let k = 0; k < pool.length; k++) {
        const l = pool[k];
        if (key(l[0]) === key(cur[cur.length - 1])) cur = cur.concat(l.slice(1));
        else if (key(l[l.length - 1]) === key(cur[cur.length - 1])) cur = cur.concat(l.slice(0, -1).reverse());
        else if (key(l[l.length - 1]) === key(cur[0])) cur = l.slice(0, -1).concat(cur);
        else if (key(l[0]) === key(cur[0])) cur = l.slice(1).reverse().concat(cur);
        else continue;
        pool.splice(k, 1); grown = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}

class Network {
  /** ways: [{path, lateral(), speed}] — joins ends so agents carry on round corners. */
  constructor(ways) {
    this.ways = ways;
    this.ends = new Map(); this.cells = new Map();
    const key = (p) => `${Math.round(p.x)},${Math.round(p.z)}`;
    ways.forEach((w, i) => {
      for (const [end, p] of [[0, w.path.pts[0]], [1, w.path.pts[w.path.pts.length - 1]]]) {
        const k = key(p); if (!this.ends.has(k)) this.ends.set(k, []); this.ends.get(k).push({ i, end });
      }
      for (let s = 0; s < w.path.length; s += 25) {
        const p = w.path.at(s), c = `${Math.floor(p.x / 120)},${Math.floor(p.z / 120)}`;
        if (!this.cells.has(c)) this.cells.set(c, []); this.cells.get(c).push([i, s]);
      }
    });
    this.key = key;
  }
  /** A random spot within r of (x, z): [wayIndex, s] or null. */
  near(x, z, r, rand, minR = 0) {
    for (let tries = 0; tries < 12; tries++) {
      const a = rand() * Math.PI * 2, d = minR + Math.sqrt(rand()) * (r - minR);
      const c = this.cells.get(`${Math.floor((x + Math.cos(a) * d) / 120)},${Math.floor((z + Math.sin(a) * d) / 120)}`);
      if (c && c.length) return c[Math.floor(rand() * c.length)];
    }
    return null;
  }
  next(i, atEnd, rand) {
    const p = atEnd ? this.ways[i].path.pts[this.ways[i].path.pts.length - 1] : this.ways[i].path.pts[0];
    const opts = (this.ends.get(this.key(p)) || []).filter((o) => o.i !== i && this.ways[o.i].allow(o.end === 0 ? 1 : -1));
    if (!opts.length) return null;
    const o = opts[Math.floor(rand() * opts.length)];
    return { i: o.i, s: o.end === 0 ? 0 : this.ways[o.i].path.length, dir: o.end === 0 ? 1 : -1 };
  }
}

// ---------------------------------------------------------------- the life of the city
export class CityLife {
  constructor(city) {
    this.city = city;
    this.rand = (() => { let s = 1234567; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
    this.counts = COUNTS[city.qualityKey] || COUNTS.balanced;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.one = V(1, 1, 1);
    this.peopleMat = animatedMaterial(this, 'people');
    this.vehicleMat = animatedMaterial(this, 'vehicles');
    this._networks();
    this._people();
    this._traffic();
    this._rails();
    this._inclines();
    this._boats();
    this._birds();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  _networks() {
    const c = this.city, walk = [], drive = [];
    const onRoute = (st) => {   // streets that run along the route itself (its other carriageway, a parallel path)
      let near = 0;
      for (const p of st.pts) { const r = c.index.nearest(p.x, p.z, 9); if (r && r.d < 8) near++; }
      return near > st.pts.length * .4;
    };
    c.streets.forEach((st) => {
      const path = makePath(st.pts);
      if (path.length < 8 || onRoute(st)) return;
      if (st.cls >= 2) walk.push({ path, side: st.cls === 8 ? 0 : st.width / 2 + 1.7, allow: () => true, cls: st.cls });
      if (st.cls <= 5) drive.push({ path, lane: st.oneway ? 0 : Math.min(st.width / 4, 2.6), oneway: st.oneway, speed: [22, 14, 12, 11, 10, 7.5][st.cls],
        allow: (dir) => !st.oneway || dir === st.oneway, cls: st.cls, bus: st.cls >= 2 && st.cls <= 3 });
    });
    // the route's trails: people out on the riverfront with you
    const r = c.route, end = r.turnIdx || r.dist.length - 1, L = c.landscape;
    for (const k of (L.data.routeKinds || []).filter((k) => k.kind === 'trail')) {
      const pts = [];
      for (let i = Math.floor(k.fromM / 10); i <= Math.min(end, Math.ceil(k.toM / 10)); i++) pts.push({ x: c.index.xs[i], y: r.ele[i], z: c.index.zs[i] });
      if (pts.length > 3) walk.push({ path: makePath(pts), side: 4.7, allow: () => true, cls: 9, trail: true });
    }
    this.walk = new Network(walk);
    this.drive = new Network(drive);
  }

  // -------------------------------------------------------------- people
  _people() {
    const n = this.counts.people, scene = this.city.route.scene || {};
    this.people = instanced(this, personGeometry(), this.peopleMat, n, 'People');
    this.cyclists = instanced(this, cyclistGeometry(), this.peopleMat, this.counts.cyclists, 'Cyclists');
    this.walkers = [];
    for (let i = 0; i < n; i++) this.walkers.push({ id: i, alive: false });
    this.riders = [];
    for (let i = 0; i < this.counts.cyclists; i++) this.riders.push({ id: i, alive: false, bike: true });
    for (const im of [this.people, this.cyclists]) {
      for (let i = 0; i < im.geometry.attributes.iA.count; i++) {
        setColor(im, 'iA', i, SHIRTS[Math.floor(this.rand() * SHIRTS.length)]);
        setColor(im, 'iB', i, PANTS[Math.floor(this.rand() * PANTS.length)]);
        setColor(im, 'iC', i, SKIN[Math.floor(this.rand() * SKIN.length)]);
      }
    }
    // gathering spots (squares, overlooks, the stadium plaza): people standing about
    this.hotspots = (scene.hotspots || []).map((h) => ({ ...h, ...this.city.D.proj.toLocal(h.lat, h.lon) }));
  }

  _spawnWalker(a, cam, initial) {
    const R = 260, net = this.walk;
    // a third of the crowd gathers at the nearest hotspots
    const spot = this.hotspots.length && this.rand() < .35 ? this.hotspots[Math.floor(this.rand() * this.hotspots.length)] : null;
    if (spot && Math.hypot(spot.x - cam.x, spot.z - cam.z) < R + 100) {
      const ang = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * (spot.radiusM || 25);
      const x = spot.x + Math.cos(ang) * d, z = spot.z + Math.sin(ang) * d;
      const c = this.city.landscape.landAt(x, z);
      if (c !== LAND.water && c !== LAND.building) {
        Object.assign(a, { alive: true, stand: true, x, z, y: this.city.landscape.heightAt(x, z), yaw: this.rand() * 6.28, gait: this.rand() < .8 ? 0 : 1, speed: 0, way: -1 });
        if (a.gait === 1) Object.assign(a, { stand: false, speed: .6, wander: true });
        return;
      }
    }
    const hit = net.near(cam.x, cam.z, R, this.rand, initial ? 0 : R * .55);
    if (!hit) { a.alive = false; return; }
    const w = net.ways[hit[0]], jog = w.trail || w.cls === 8 ? this.rand() < .35 : this.rand() < .06;
    Object.assign(a, { alive: true, stand: false, wander: false, way: hit[0], s: hit[1], dir: this.rand() < .5 ? 1 : -1,
      speed: jog ? 2.6 + this.rand() * .8 : 1.1 + this.rand() * .5, gait: jog ? 2 : 1,
      lat: (w.side ? (this.rand() < .5 ? -1 : 1) * (w.side + (this.rand() - .5) * 1.2) : (this.rand() - .5) * 2.2) });
    if (w.trail) a.lat = -Math.abs(a.lat);   // keep to the left of the route's centre line: the rider's lane is clear
  }

  _spawnCyclist(a, cam, initial) {
    const hit = this.walk.near(cam.x, cam.z, 300, this.rand, initial ? 0 : 160);
    if (!hit) { a.alive = false; return; }
    const w = this.walk.ways[hit[0]];
    if (!(w.trail || w.cls === 8 || w.cls <= 5)) { a.alive = false; return; }
    Object.assign(a, { alive: true, way: hit[0], s: hit[1], dir: this.rand() < .5 ? 1 : -1, speed: 4.5 + this.rand() * 2.5, gait: 3,
      lat: w.trail ? -2.2 : w.side ? (w.side - 1.2) : 0 });
    if (w.cls <= 5) a.lat = w.side - 2.4;
  }

  _moveOnNetwork(a, net, dt) {
    let w = net.ways[a.way];
    a.s += a.dir * a.speed * dt;
    if (a.s < 0 || a.s > w.path.length) {
      const nx = net.next(a.way, a.s > w.path.length, this.rand);
      if (nx) { a.way = nx.i; a.s = nx.s; a.dir = nx.dir; w = net.ways[a.way]; }
      else { a.dir = -a.dir; a.s = Math.max(0, Math.min(w.path.length, a.s)); }
    }
    const p = w.path.at(a.s, this._tmp || (this._tmp = {}));
    const side = a.dir > 0 ? 1 : -1;
    a.x = p.x - p.dz * a.lat * side; a.z = p.z + p.dx * a.lat * side;
    a.y = p.y; a.yaw = Math.atan2(p.dx * a.dir, p.dz * a.dir); a.pitch = Math.atan(p.dy || 0) * a.dir;
    if (!w.trail) {
      // never stand in the rider's road: step aside where a street crosses the route
      const r = this.city.index.nearest(a.x, a.z, 5);
      if (r && r.d < 4.6) {
        const ox = a.x - this.city.index.xs[r.i], oz = a.z - this.city.index.zs[r.i], d = Math.hypot(ox, oz) || 1;
        if (net === this.walk) { a.x = this.city.index.xs[r.i] + ox / d * 4.8; a.z = this.city.index.zs[r.i] + oz / d * 4.8; }
      }
    }
    return w;
  }

  /**
   * Keep traffic, walkers and cyclists out of the rider's way. `prev` is where the agent was before this step.
   * Anything about to step onto the route's road while the rider is within `reach` waits at the edge; anything
   * already on it when the rider is close either hurries across (vehicles) or steps to the road's edge (people).
   */
  _yield(a, prev, rider, reach, person) {
    if (!rider) return;
    const L = this.city.landscape, edge = ROAD_WIDTH / 2 + 2, now = L.routeDist(a.x, a.z);
    if (!now || now.d > edge) return;
    const near = Math.hypot(a.x - rider.x, a.z - rider.z);
    if (near > reach && !(person && a.asideUntil > this._clock)) return;
    const before = L.routeDist(prev.x, prev.z);
    if (!before || before.d > edge) { Object.assign(a, prev); return; }   // wait at the kerb
    // people stay at the edge for a few seconds after the rider has gone by, so they step back out of view
    if (near > 16 && !(person && a.asideUntil > this._clock)) return;
    if (!person) { a.hurry = 2.5; return; }
    if (near <= 16) a.asideUntil = this._clock + 4;
    // a person on the road as the rider arrives: step out to the road's edge
    const ix = this.city.index, i = now.i, dx = ix.xs[i + 1] - ix.xs[i], dz = ix.zs[i + 1] - ix.zs[i], l = Math.hypot(dx, dz) || 1;
    let nx = -dz / l, nz = dx / l;
    const t = Math.max(0, Math.min(1, ((a.x - ix.xs[i]) * dx + (a.z - ix.zs[i]) * dz) / (l * l)));
    const ox = a.x - (ix.xs[i] + dx * t), oz = a.z - (ix.zs[i] + dz * t);
    if (ox * nx + oz * nz < 0) { nx = -nx; nz = -nz; }
    a.x = ix.xs[i] + dx * t + nx * (edge + .3); a.z = ix.zs[i] + dz * t + nz * (edge + .3);
    a.y = L.heightAt(a.x, a.z);
  }

  _updatePeople(cam, dt, time, rider) {
    const im = this.people, L = this.city.landscape;
    for (const a of this.walkers) {
      if (!a.alive || Math.hypot(a.x - cam.x, a.z - cam.z) > 330) this._spawnWalker(a, cam, !this._started);
      if (!a.alive) { im.setMatrixAt(a.id, this.zero); continue; }
      if (a.wander) { a.yaw += (this.rand() - .5) * dt; a.x += Math.sin(a.yaw) * a.speed * dt; a.z += Math.cos(a.yaw) * a.speed * dt; a.y = L.heightAt(a.x, a.z); }
      else if (!a.stand) { const prev = { x: a.x, y: a.y, z: a.z, s: a.s, way: a.way, dir: a.dir, yaw: a.yaw, pitch: a.pitch }; this._moveOnNetwork(a, this.walk, dt); this._yield(a, prev, rider, 70, true); }
      this.e.set(0, a.yaw, 0); this.q.setFromEuler(this.e);
      im.setMatrixAt(a.id, this.m.compose(V(a.x, a.y, a.z), this.q, this.one));
      im.geometry.attributes.iAnim.setXY(a.id, a.id * 1.7, a.gait);
    }
    im.count = this.walkers.length; im.instanceMatrix.needsUpdate = true; im.geometry.attributes.iAnim.needsUpdate = true;
    const cy = this.cyclists;
    for (const a of this.riders) {
      if (!a.alive || Math.hypot(a.x - cam.x, a.z - cam.z) > 380) this._spawnCyclist(a, cam, !this._started);
      if (!a.alive) { cy.setMatrixAt(a.id, this.zero); continue; }
      const prev = { x: a.x, y: a.y, z: a.z, s: a.s, way: a.way, dir: a.dir, yaw: a.yaw, pitch: a.pitch };
      this._moveOnNetwork(a, this.walk, dt); this._yield(a, prev, rider, 50, true);
      this.e.set(-a.pitch, a.yaw, 0); this.q.setFromEuler(this.e);
      cy.setMatrixAt(a.id, this.m.compose(V(a.x, a.y, a.z), this.q, this.one));
      cy.geometry.attributes.iAnim.setXY(a.id, a.id * 2.3, 3);
    }
    cy.count = this.riders.length; cy.instanceMatrix.needsUpdate = true; cy.geometry.attributes.iAnim.needsUpdate = true;
  }

  // -------------------------------------------------------------- cars and buses
  _traffic() {
    const n = this.counts.cars, buses = Math.max(4, Math.round(n / 12));
    this.cars = instanced(this, carGeometry(false), this.vehicleMat, n + 4, 'Cars');
    this.buses = instanced(this, carGeometry(true), this.vehicleMat, buses, 'Buses');
    for (let i = 0; i < n + 4; i++) setColor(this.cars, 'iA', i, CARS[Math.floor(this.rand() * CARS.length)]);
    for (let i = 0; i < buses; i++) setColor(this.buses, 'iA', i, '#f2f2f2');
    this.carAgents = Array.from({ length: n }, (_, id) => ({ id, alive: false }));
    this.busAgents = Array.from({ length: buses }, (_, id) => ({ id, alive: false, bus: true }));
    this.oncoming = Array.from({ length: 4 }, (_, id) => ({ id: n + id, alive: false }));   // oncoming traffic on the route's streets
  }

  _spawnCar(a, cam, initial) {
    const R = 420, net = this.drive;
    for (let t = 0; t < 4; t++) {
      const hit = net.near(cam.x, cam.z, R, this.rand, initial ? 0 : R * .55);
      if (!hit) break;
      const w = net.ways[hit[0]];
      if (a.bus && !w.bus) continue;
      const dir = w.oneway ? w.oneway : (this.rand() < .5 ? 1 : -1);
      Object.assign(a, { alive: true, way: hit[0], s: hit[1], dir, speed: w.speed * (.8 + this.rand() * .35), lat: w.lane || (this.rand() - .5) * 3, gait: 0 });
      return;
    }
    a.alive = false;
  }

  _spawnOncoming(a, rider) {
    // oncoming traffic on the route's own streets, in the far lane
    const r = this.city.route, L = this.city.landscape, turn = r.turnS || r.total;
    const ahead = 220 + this.rand() * 420, s = rider.out + rider.dir * ahead;
    if (s < 0 || s > turn || L.routeKindAt(s) !== 'road' || L.routeBridges.some((b) => s > b.fromM - 30 && s < b.toM + 30 && b.style === 'lenticular')) { a.alive = false; a.wait = 1 + this.rand() * 3; return; }
    Object.assign(a, { alive: true, onRoute: true, s, dir: -rider.dir, speed: 8 + this.rand() * 4 });
  }

  _routeAt(s, out) {
    const r = this.city.route, ix = this.city.index, end = (r.turnIdx || r.dist.length - 1) - 1;
    const i = Math.max(0, Math.min(end, Math.floor(s / 10))), f = Math.min(1, Math.max(0, (s - r.dist[i]) / 10));
    out.x = ix.xs[i] + (ix.xs[i + 1] - ix.xs[i]) * f; out.z = ix.zs[i] + (ix.zs[i + 1] - ix.zs[i]) * f; out.y = r.ele[i] + (r.ele[i + 1] - r.ele[i]) * f;
    const len = Math.hypot(ix.xs[i + 1] - ix.xs[i], ix.zs[i + 1] - ix.zs[i]) || 1;
    out.dx = (ix.xs[i + 1] - ix.xs[i]) / len; out.dz = (ix.zs[i + 1] - ix.zs[i]) / len; out.dy = (r.ele[i + 1] - r.ele[i]) / len;
    return out;
  }

  _updateTraffic(cam, dt, rider) {
    const draw = (im, a) => {
      this.e.set(-(a.pitch || 0), a.yaw, 0); this.q.setFromEuler(this.e);
      im.setMatrixAt(a.id, this.m.compose(V(a.x, a.y + .02, a.z), this.q, this.one));
    };
    for (const a of this.carAgents) {
      if (!a.alive || Math.hypot(a.x - cam.x, a.z - cam.z) > 480) this._spawnCar(a, cam, !this._started);
      if (!a.alive) { this.cars.setMatrixAt(a.id, this.zero); continue; }
      // keep clear of the rider where a street crosses or joins the route
      const prev = { x: a.x, y: a.y, z: a.z, s: a.s, way: a.way, dir: a.dir, yaw: a.yaw, pitch: a.pitch };
      this._moveOnNetwork(a, this.drive, dt * (a.hurry || 1)); a.hurry = 0;
      this._yield(a, prev, rider, 30, false);
      draw(this.cars, a);
    }
    for (const a of this.oncoming) {
      if (rider && !a.alive) { a.wait = (a.wait || 0) - dt; if (a.wait <= 0) this._spawnOncoming(a, rider); }
      if (!rider || !a.alive) { this.cars.setMatrixAt(a.id, this.zero); continue; }
      {
        a.s += a.dir * a.speed * dt;
        const behind = (rider.out - a.s) * rider.dir;
        if (behind > 80 || a.s < 0 || a.s > (this.city.route.turnS || this.city.route.total) || this.city.landscape.routeKindAt(a.s) !== 'road') { a.alive = false; a.wait = 2 + this.rand() * 6; this.cars.setMatrixAt(a.id, this.zero); continue; }
        const p = this._routeAt(a.s, this._tmpR || (this._tmpR = {}));
        const lane = ROAD_WIDTH * .26 * (a.dir > 0 ? 1 : -1);
        a.x = p.x - p.dz * lane; a.z = p.z + p.dx * lane; a.y = p.y + .1;
        a.yaw = Math.atan2(p.dx * a.dir, p.dz * a.dir); a.pitch = Math.atan(p.dy) * a.dir;
        draw(this.cars, a);
      }
    }
    this.cars.count = this.carAgents.length + this.oncoming.length; this.cars.instanceMatrix.needsUpdate = true;
    for (const a of this.busAgents) {
      if (!a.alive || Math.hypot(a.x - cam.x, a.z - cam.z) > 480) this._spawnCar(a, cam, !this._started);
      if (!a.alive) { this.buses.setMatrixAt(a.id, this.zero); continue; }
      const prev = { x: a.x, y: a.y, z: a.z, s: a.s, way: a.way, dir: a.dir, yaw: a.yaw, pitch: a.pitch };
      this._moveOnNetwork(a, this.drive, dt * (a.hurry || 1)); a.hurry = 0;
      this._yield(a, prev, rider, 35, false);
      draw(this.buses, a);
    }
    this.buses.count = this.busAgents.length; this.buses.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------- trains
  _rails() {
    const c = this.city, L = c.landscape, byKind = { light_rail: [], rail: [] };
    const tracks = new MeshBuilder();
    for (const r of c.landscape.data.rails || []) {
      if (r.kind === 'funicular') continue;
      const pts = r.path.map(([a, o]) => c.D.local(a, o));
      if (r.bridge) { const y0 = L.baseHeight(pts[0].x, pts[0].z), y1 = L.baseHeight(pts.at(-1).x, pts.at(-1).z); pts.forEach((p, k) => { p.y = y0 + (y1 - y0) * k / (pts.length - 1) + 1; }); }
      else pts.forEach((p) => { p.y = L.heightAt(p.x, p.z) + .25; });
      (byKind[r.kind === 'tram' ? 'light_rail' : r.kind] || byKind.rail).push(pts);
    }
    for (const lines of Object.values(byKind)) for (const pts of lines) {
      // ballast bed and two rails as flat ribbons (cheap: two triangles per segment)
      const raised = pts.map((p) => ({ x: p.x, y: p.y - .2, z: p.z }));
      tracks.color('#6b6359'); ribbon(tracks, raised, 3.2, 0, 10);
      tracks.color('#2f2c29');
      for (const side of [-.72, .72]) ribbon(tracks, offsetLine(pts, side), .14, .08, 10);
    }
    tracks.keepOutOf(L.inRouteTube);   // rail beds the data lifts into the rider's space
    if (tracks.count) { const tm = new THREE.Mesh(c.own(tracks.geometry()), c.solidMaterial); tm.receiveShadow = true; tm.name = 'Rail tracks'; c.group.add(tm); }
    // trains: two-car light-rail sets on the longest light-rail line, one long freight on the longest rail line
    const longest = (lines) => chainPolylines(lines, 2).map((l) => makePath(l)).sort((a, b) => b.length - a.length)[0];
    this.trains = [];
    const lrt = byKind.light_rail.length ? longest(byKind.light_rail) : null;
    const freight = byKind.rail.length ? longest(byKind.rail) : null;
    if (lrt && lrt.length > 200) {
      const im = instanced(this, trainGeometry('lrt'), this.vehicleMat, 4, 'Light rail');
      this.trains.push({ im, path: lrt, cars: 2, gap: 26.5, s: lrt.length * .3, dir: 1, speed: 9, wait: 0 }, { im, path: lrt, cars: 2, gap: 26.5, s: lrt.length * .7, dir: -1, speed: 9, wait: 0, offset: 2 });
    }
    if (freight && freight.length > 600) {
      const loco = instanced(this, trainGeometry('freight'), this.vehicleMat, 2, 'Locomotives');
      const cars = instanced(this, railCarGeometry(), this.vehicleMat, 28, 'Freight cars');
      for (let i = 0; i < 28; i++) setColor(cars, 'iA', i, ['#5b3a29', '#2f4f4f', '#7b2d26', '#3b3b3b', '#1f3a5f'][i % 5]);
      this.trains.push({ im: loco, carIm: cars, path: freight, cars: 30, gap: 18, s: 30 * 18 + 20, dir: 1, speed: 6, wait: 0, freight: true });
    }
  }

  /** Where a train line crosses the route's road at its level: [{s0, s1, x, z, routeS}] along the line. */
  _crossings(t) {
    if (t.crossings) return t.crossings;
    const L = this.city.landscape, out = [], p = {};
    let cur = null;
    for (let s = 0; s <= t.path.length; s += 2) {
      t.path.at(s, p);
      const r = L.routeDist(p.x, p.z), on = r && r.d < ROAD_WIDTH / 2 + 3 && Math.abs(p.y - r.y) < 4.5;
      if (on && !cur) cur = { s0: s, s1: s, x: p.x, z: p.z, routeS: this.city.route.dist[r.i] };
      else if (on) cur.s1 = s;
      else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return (t.crossings = out);
  }

  _updateTrains(dt, rider) {
    const p = {};
    for (const t of this.trains) {
      const tail = (t.cars - 1) * t.gap;
      // level crossings with the route: hold before one while the rider approaches it; clear it fast if already on it
      let factor = 1;
      for (const c of rider ? this._crossings(t) : []) {
        const passed = (rider.out - c.routeS) * rider.dir > 15, far = Math.hypot(rider.x - c.x, rider.z - c.z) > 400;
        if (passed || far) continue;
        const front = t.s, back = t.s - t.dir * tail, lo = Math.min(front, back), hi = Math.max(front, back);
        if (hi > c.s0 - 6 && lo < c.s1 + 6) { factor = Math.max(factor, 3); continue; }
        const next = front + t.dir * t.speed * dt;
        if ((t.dir > 0 && front < c.s0 && next > c.s0 - 20) || (t.dir < 0 && front > c.s1 && next < c.s1 + 20)) factor = 0;
      }
      if (t.wait > 0) t.wait -= dt;
      else if (factor > 0) {
        t.s += t.dir * t.speed * dt * factor;
        // at the end of the line the last car becomes the front
        if (t.dir > 0 && t.s > t.path.length - 5) { t.s -= tail; t.dir = -1; t.wait = 25; }
        else if (t.dir < 0 && t.s < 5) { t.s += tail; t.dir = 1; t.wait = 25; }
      }
      for (let k = 0; k < t.cars; k++) {
        t.path.at(Math.max(0, Math.min(t.path.length, t.s - t.dir * k * t.gap)), p);
        this.e.set(-Math.atan(p.dy || 0) * t.dir, Math.atan2(p.dx, p.dz) + (t.dir < 0 ? Math.PI : 0), 0); this.q.setFromEuler(this.e);
        this.m.compose(V(p.x, p.y, p.z), this.q, this.one);
        if (t.freight) { if (k < 2) t.im.setMatrixAt(k, this.m); else t.carIm.setMatrixAt(k - 2, this.m); }
        else t.im.setMatrixAt((t.offset || 0) + k, this.m);
      }
      if (t.freight) { t.im.count = 2; t.carIm.count = t.cars - 2; t.carIm.instanceMatrix.needsUpdate = true; }
      else t.im.count = 4;
      t.im.instanceMatrix.needsUpdate = true;
    }
  }

  // -------------------------------------------------------------- inclines
  _inclines() {
    const c = this.city, L = c.landscape, groups = {};
    for (const r of L.data.rails || []) if (r.kind === 'funicular') (groups[r.name || 'Incline'] ||= []).push(...r.path.map(([a, o]) => c.D.local(a, o)));
    this.inclines = [];
    const M = new MeshBuilder();
    for (const [name, pts] of Object.entries(groups)) {
      if (pts.length < 2) continue;
      let lo = pts[0], hi = pts[0];
      for (const p of pts) { p.g = L.baseHeight(p.x, p.z); if (p.g < lo.g) lo = p; if (p.g > hi.g) hi = p; }
      if (hi.g - lo.g < 30) continue;
      const a = V(lo.x, lo.g + 1.5, lo.z), b = V(hi.x, hi.g + 1.5, hi.z);
      const dir = b.clone().sub(a), len = dir.length(); dir.normalize();
      const right = V(-dir.z, 0, dir.x).normalize();
      for (const side of [-1.7, 1.7]) {
        M.color('#3d3a36');
        M.beam(a.clone().addScaledVector(right, side - .55), b.clone().addScaledVector(right, side - .55), .16, .2);
        M.beam(a.clone().addScaledVector(right, side + .55), b.clone().addScaledVector(right, side + .55), .16, .2);
      }
      M.color('#5e554b');
      for (let s = 0; s < len; s += 5) {
        const p = a.clone().addScaledVector(dir, s), g = L.baseHeight(p.x, p.z);
        M.beam(p.clone().addScaledVector(right, -2.6).setY(p.y - .25), p.clone().addScaledVector(right, 2.6).setY(p.y - .25), .3, .3);
        if (p.y - g > 1) for (const side of [-2.2, 2.2]) M.beam(p.clone().addScaledVector(right, side).setY(g - .5), p.clone().addScaledVector(right, side).setY(p.y - .3), .28, .28);
      }
      // stations
      M.color('#8a5a3c'); M.box(a.x - dir.x * 7, a.y - 1.5, a.z - dir.z * 7, 9, 6, 10, Math.atan2(dir.x, dir.z));
      M.color('#6b3d26'); M.pyramid(a.x - dir.x * 7, a.y + 4.5, a.z - dir.z * 7, 10, 2.5, 11, Math.atan2(dir.x, dir.z));
      M.color('#8a5a3c'); M.box(b.x + dir.x * 6, b.y - 1.5, b.z + dir.z * 6, 10, 7, 11, Math.atan2(dir.x, dir.z));
      M.color('#6b3d26'); M.pyramid(b.x + dir.x * 6, b.y + 5.5, b.z + dir.z * 6, 11, 2.5, 12, Math.atan2(dir.x, dir.z));
      this.inclines.push({ name, a, b, dir, right, len, period: 190 + this.inclines.length * 23 });
      const lights = [];
      for (let s = 0; s < len; s += 9) for (const side of [-2.7, 2.7]) { const p = a.clone().addScaledVector(dir, s).addScaledVector(right, side); lights.push({ x: p.x, y: p.y + .6, z: p.z, size: 1.8, color: '#ffe7b0' }); }
      c.addGlows(lights, `${name} lights`);
    }
    M.keepOutOf(c.landscape.inRouteTube);
    if (M.count) { const tm = new THREE.Mesh(c.own(M.geometry()), c.solidMaterial); tm.castShadow = tm.receiveShadow = true; tm.name = 'Inclines'; c.group.add(tm); }
    // incline cars: stepped wooden cabins, level floors on a steep track
    const car = new MeshBuilder({ aPart: 1, aMask: 3 });
    car.set({ aPart: [0], aMask: [1, 0, 0] }); car.color('#fff');
    for (let k = 0; k < 3; k++) car.box(0, k * 1.6, -3 + k * 3, 3.2, 2.6, 3);
    car.set({ aPart: [12], aMask: [0, 0, 0] }); car.color('#1e2a33');
    for (let k = 0; k < 3; k++) car.box(0, k * 1.6 + 1.2, -3 + k * 3, 3.25, .9, 2.4);
    car.set({ aPart: [0], aMask: [0, 0, 0] }); car.color('#e9dcc0'); for (let k = 0; k < 3; k++) car.box(0, k * 1.6 + 2.6, -3 + k * 3, 3.3, .3, 3.1);
    this.inclineCars = this.inclines.length ? instanced(this, car, this.vehicleMat, this.inclines.length * 2, 'Incline cars') : null;
    if (this.inclineCars) for (let i = 0; i < this.inclines.length * 2; i++) setColor(this.inclineCars, 'iA', i, i < 2 ? '#7c2d1d' : '#a33b25');
  }

  _updateInclines(time) {
    if (!this.inclineCars) return;
    let k = 0;
    for (const inc of this.inclines) {
      const f = .5 - .5 * Math.cos((time / inc.period) * Math.PI * 2);
      for (const [side, u] of [[-1.7, f], [1.7, 1 - f]]) {
        const p = inc.a.clone().addScaledVector(inc.dir, 4 + u * (inc.len - 8)).addScaledVector(inc.right, side);
        this.e.set(0, Math.atan2(inc.dir.x, inc.dir.z), 0); this.q.setFromEuler(this.e);
        this.inclineCars.setMatrixAt(k++, this.m.compose(V(p.x, p.y - 1.2, p.z), this.q, this.one));
      }
    }
    this.inclineCars.count = k; this.inclineCars.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------- boats
  _boats() {
    const c = this.city, rivers = (c.route.scene?.rivers || []).map((r) => ({ ...r, path: makePath(r.path.map(([la, lo]) => ({ ...c.D.proj.toLocal(la, lo), y: c.landscape.level }))) }));
    this.boats = [];
    if (!rivers.length) return;
    const types = { tow: 3, clipper: 2, motor: 5, kayak: 7 };
    this.boatMeshes = {};
    for (const [type, n] of Object.entries(types)) {
      this.boatMeshes[type] = instanced(this, boatGeometry(type), this.vehicleMat, n, `Boats · ${type}`, type !== 'kayak');
      for (let i = 0; i < n; i++) {
        const river = rivers[(i + type.length) % rivers.length];
        const half = (river.widthM || 240) / 2 - (type === 'kayak' ? 18 : type === 'tow' ? 70 : 45);
        const lat = type === 'kayak' ? (this.rand() < .5 ? -1 : 1) * half : (this.rand() - .5) * 2 * half * .6;
        this.boats.push({ type, i, river, s: this.rand() * river.path.length, dir: this.rand() < .5 ? 1 : -1, lat,
          speed: { tow: 2.2, clipper: 3.6, motor: 8 + this.rand() * 4, kayak: 1.2 + this.rand() * .5 }[type] });
        setColor(this.boatMeshes[type], 'iA', i, type === 'kayak' ? ['#e74c3c', '#f1c40f', '#27ae60', '#3498db', '#e67e22'][i % 5] : type === 'motor' ? ['#ffffff', '#f2f2f2', '#1f3a5f', '#c0392b'][i % 4] : '#ffffff');
      }
    }
    // wakes behind moving boats
    const cvs = document.createElement('canvas'); cvs.width = 64; cvs.height = 128; const g = cvs.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, 'rgba(255,255,255,.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(32, 0); g.lineTo(64, 128); g.lineTo(54, 128); g.lineTo(32, 18); g.lineTo(10, 128); g.lineTo(0, 128); g.closePath(); g.fill();
    const wakeGeo = c.own(new THREE.PlaneGeometry(1, 1)); wakeGeo.rotateX(-Math.PI / 2); wakeGeo.translate(0, 0, -.5);
    this.wakes = new THREE.InstancedMesh(wakeGeo, c.own(new THREE.MeshBasicMaterial({ map: c.own(new THREE.CanvasTexture(cvs)), transparent: true, depthWrite: false, opacity: .55 })), this.boats.length);
    this.wakes.frustumCulled = false; this.wakes.renderOrder = 2; c.group.add(this.wakes);
  }

  _updateBoats(dt, time) {
    if (!this.boats.length) return;
    const p = {}, level = this.city.landscape.level;
    const counts = {};
    let w = 0;
    for (const b of this.boats) {
      b.s += b.dir * b.speed * dt;
      if (b.s > b.river.path.length) { b.s = b.river.path.length; b.dir = -1; }
      if (b.s < 0) { b.s = 0; b.dir = 1; }
      b.river.path.at(b.s, p);
      const side = b.dir > 0 ? 1 : -1, x = p.x - p.dz * b.lat * side, z = p.z + p.dx * b.lat * side;
      const yaw = Math.atan2(p.dx * b.dir, p.dz * b.dir), bob = Math.sin(time * 1.3 + b.i * 2) * (b.type === 'kayak' ? .06 : .12);
      this.e.set(Math.sin(time * .9 + b.i) * .01, yaw, Math.sin(time * 1.1 + b.i) * (b.type === 'motor' ? .03 : .015)); this.q.setFromEuler(this.e);
      const im = this.boatMeshes[b.type], k = counts[b.type] = (counts[b.type] || 0);
      im.setMatrixAt(k, this.m.compose(V(x, level + bob, z), this.q, this.one)); counts[b.type]++;
      const wl = b.type === 'motor' ? 40 : b.type === 'clipper' ? 70 : b.type === 'tow' ? 90 : 10, ww = b.type === 'motor' ? 14 : b.type === 'kayak' ? 2.5 : 30;
      const back = b.type === 'tow' ? -20 : b.type === 'clipper' ? -22 : b.type === 'motor' ? -3.5 : -2;
      this.q.setFromEuler(this.e.set(0, yaw, 0));
      this.wakes.setMatrixAt(w++, this.m.compose(V(x + Math.sin(yaw) * back, level + .12, z + Math.cos(yaw) * back), this.q, V(ww, 1, wl)));
    }
    for (const [type, im] of Object.entries(this.boatMeshes)) { im.count = counts[type] || 0; im.instanceMatrix.needsUpdate = true; }
    this.wakes.count = w; this.wakes.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------- birds
  _birds() {
    const c = this.city, rivers = c.route.scene?.rivers || [];
    const flocks = rivers.slice(0, 3).map((r, k) => { const mid = r.path[Math.floor(r.path.length / 2)]; return { ...c.D.proj.toLocal(mid[0], mid[1]), h: c.landscape.level + 30 + k * 12, r: 60 + k * 25, n: 10 }; });
    this.flocks = flocks;
    const n = flocks.reduce((a, f) => a + f.n, 0);
    if (!n) return;
    const mat = c.own(new THREE.MeshBasicMaterial({ color: '#e8e8e4', side: THREE.DoubleSide }));
    this.birds = new THREE.InstancedMesh(c.own(birdGeometry().geometry()), mat, n);
    this.birds.frustumCulled = false; c.group.add(this.birds);
  }

  _updateBirds(time) {
    if (!this.birds) return;
    let k = 0;
    for (const [fi, f] of this.flocks.entries()) {
      for (let i = 0; i < f.n; i++) {
        const a = time * (.12 + fi * .03) + i * .4, r = f.r + Math.sin(i * 3.1) * 14;
        const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r, y = f.h + Math.sin(time * .5 + i) * 4;
        const flap = Math.sin(time * 9 + i * 1.7) * .5 + .7;
        this.e.set(0, -a, Math.sin(time * .4 + i) * .2); this.q.setFromEuler(this.e);
        this.birds.setMatrixAt(k++, this.m.compose(V(x, y, z), this.q, V(1.6, flap, 1.6)));
      }
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------- per frame
  tick(cam, dt, time, rider) {
    dt = Math.min(dt, .1);
    this._clock = (this._clock || 0) + dt;
    this._updatePeople(cam, dt, time, rider);
    this._updateTraffic(cam, dt, rider);
    this._updateTrains(dt, rider);
    this._updateInclines(time);
    this._updateBoats(dt, time);
    this._updateBirds(time);
    this._started = true;
  }

  setQuality(key) { this.counts = COUNTS[key] || COUNTS.balanced; }

  dispose() {
    for (const im of [this.people, this.cyclists, this.cars, this.buses, this.inclineCars, this.wakes, this.birds, ...Object.values(this.boatMeshes || {}), ...this.trains.flatMap((t) => [t.im, t.carIm])]) im?.dispose?.();
  }
}
