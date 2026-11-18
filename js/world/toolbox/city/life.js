// Everything that moves in the city: people walking, jogging, cycling and standing around,
// cars and buses (oncoming traffic on the route's streets too), light-rail and freight trains,
// the two inclines up Mount Washington, barges, the riverboat, motorboats and kayaks, and birds.
// Agents live near the camera and are recycled as you ride; all draw calls are instanced. People, cyclists, dogs,
// strollers, cars and buses come from the figures kit (life/figures): soft cartoon models, baked walk cycles.
import { ghostAt } from '../../ghost.js';
import * as THREE from '../../../../vendor/three.module.min.js';
import { Crowd, CLIP, FIT, randomLook, dogLook, clipRate, PALETTES } from '../life/figures/people.js';
import { vehicleMesh, vehicleMaterial, setPaint, setMove } from '../life/figures/vehicles.js';
import { MeshBuilder, makePath, hash, ribbon } from '../core/mesh-builder.js';
import { drain, due, each } from '../core/jobs.js';   // [F30] built as a job (in frame slices on the ride)
import { LAND } from './landscape.js';
import { ROAD_WIDTH } from '../../pose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// car models by share (the city's mix)
const CAR_MIX = [['sedan', .34], ['hatch', .2], ['suv', .22], ['pickup', .07], ['van', .09], ['taxi', .08]];
const COUNTS = { low: { people: 70, cars: 40, cyclists: 6 }, balanced: { people: 160, cars: 85, cyclists: 12 }, high: { people: 260, cars: 140, cyclists: 18 } };
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
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb = vColor.rgb * clamp(1. - aMask.x - aMask.y - aMask.z, 0., 1.) + iA * aMask.x + iB * aMask.y + iC * aMask.z;
        vLight = aPart;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying float vLight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
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

// Keeping clear of the rider. Nothing dodges: people and traffic are kept off the route's road by their networks
// (walk and drive ways that run along it are cut out when the city loads), and where a way crosses it they stop
// at the kerb or the stop line, ahead of time, until the rider is well clear. Every move is continuous: speeds
// ease up and down, and what is drawn follows the agent's place on its way at no more than its own pace (corners,
// the far sidewalk after a turn round), so nothing snaps sideways in view.
const HALF = ROAD_WIDTH / 2;
const HIDDEN = new THREE.Vector3(0, 0, 0);   // a train car not drawn (scale 0): in a shallow cut under the route (F59)
const MOVE = {
  //      look: m ahead to decide · acc/dec: m/s² · kerb: stop this far before the route's road · catch: m/s
  //      drawn place may close on the agent's place beyond its pace · turn: rad/s · body: length to clear
  walk: { look: 9, acc: 1.2, dec: 1.6, kerb: .4, catch: .8, turn: 4, body: 1, chord: 2, margin: .9, longM: 30 },
  bike: { look: 25, acc: 1.5, dec: 2.2, kerb: 1.4, catch: 1.5, turn: 2.5, body: 2, chord: 3 },
  car: { look: 55, acc: 2.2, dec: 3.2, kerb: 3.6, catch: 2, turn: 1.6, body: 5, chord: 4, margin: 1.2, longM: 40 },
};
const _pa = {}, _pb = {};
/** Point on a path at s (binary search: agents share paths, so makePath's walking hint would thrash). */
function pathAt(path, s, out) {
  const d = path.d, pts = path.pts;
  s = Math.max(0, Math.min(path.length, s));
  let lo = 0, hi = d.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d[m] <= s) lo = m; else hi = m - 1; }
  const a = pts[lo], b = pts[lo + 1], f = (s - d[lo]) / ((d[lo + 1] - d[lo]) || 1);
  out.x = a.x + (b.x - a.x) * f; out.y = a.y + (b.y - a.y) * f; out.z = a.z + (b.z - a.z) * f;
  return out;
}
/** Point and a smoothed heading (the chord over ±`chord` m): a sideways offset from it bends round a polyline's corners. */
function poseOn(path, s, chord, out) {
  pathAt(path, s, out); pathAt(path, s - chord, _pa); pathAt(path, s + chord, _pb);
  let tx = _pb.x - _pa.x, tz = _pb.z - _pa.z, l = Math.hypot(tx, tz);
  if (l < 1e-3) { pathAt(path, Math.min(path.length, s + .5), _pb); pathAt(path, Math.max(0, s - .5), _pa); tx = _pb.x - _pa.x; tz = _pb.z - _pa.z; l = Math.hypot(tx, tz) || 1; }
  out.tx = tx / l; out.tz = tz / l; out.dy = (_pb.y - _pa.y) / l;
  return out;
}
/** The stretch [s0, s1] of a path (its end points interpolated). */
function subPath(path, s0, s1) {
  const pts = [pathAt(path, s0, {})];
  for (let k = 0; k < path.pts.length; k++) if (path.d[k] > s0 + .05 && path.d[k] < s1 - .05) pts.push({ ...path.pts[k] });
  pts.push(pathAt(path, s1, {}));
  return makePath(pts);
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
  /** The way on from an end of way i ({i, s, dir}, or null: a dead end); `keep(way, dir)` can rule ways out. */
  next(i, atEnd, rand, keep = null) {
    const p = atEnd ? this.ways[i].path.pts[this.ways[i].path.pts.length - 1] : this.ways[i].path.pts[0];
    const opts = (this.ends.get(this.key(p)) || []).filter((o) => o.i !== i && this.ways[o.i].allow(o.end === 0 ? 1 : -1) && (!keep || keep(this.ways[o.i], o.end === 0 ? 1 : -1)));
    if (!opts.length) return null;
    const o = opts[Math.floor(rand() * opts.length)];
    return { i: o.i, s: o.end === 0 ? 0 : this.ways[o.i].path.length, dir: o.end === 0 ? 1 : -1 };
  }
}

// ---------------------------------------------------------------- the life of the city
export class CityLife {
  /** `deferred` ([F30]): `this.job` builds it (the same steps), for the caller to run in frame slices. */
  constructor(city, deferred = false) {
    const job = this._buildJob(city);
    if (deferred) { this.job = job; return; }
    drain(job);
  }

  *_buildJob(city) {
    this.city = city;
    this.rand = (() => { let s = 1234567; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
    this.counts = COUNTS[city.qualityKey] || COUNTS.balanced;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.one = V(1, 1, 1);
    this.vehicleMat = animatedMaterial(this, 'vehicles');
    this.carMat = vehicleMaterial(city.night);
    yield* this._networksJob();
    this._people();
    if (due()) yield;
    this._traffic();
    if (due()) yield;
    yield* this._railsJob();
    this._inclines();
    if (due()) yield;
    this._boats();
    if (due()) yield;
    this._birds();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  *_networksJob() {
    const c = this.city, walk = [], drive = [];
    const onRoute = (st) => {   // streets that run along the route itself (its other carriageway, a parallel path)
      let near = 0;
      for (const p of st.pts) { const r = c.index.nearest(p.x, p.z, 9); if (r && r.d < 8) near++; }
      return near > st.pts.length * .4;
    };
    yield* each(c.streets, (st) => {
      const path = makePath(st.pts);
      if (path.length < 8 || onRoute(st)) return;
      if (st.cls >= 2) walk.push({ path, side: st.cls === 8 ? 0 : st.width / 2 + 1.7, allow: () => true, cls: st.cls });
      if (st.cls <= 5) drive.push({ path, lane: st.oneway ? 0 : Math.min(st.width / 4, 2.6), oneway: st.oneway, speed: [22, 14, 12, 11, 10, 7.5][st.cls],
        allow: (dir) => !st.oneway || dir === st.oneway, cls: st.cls, bus: st.cls >= 2 && st.cls <= 3 });
    });
    // the route's trails: people out on the riverfront with you
    const r = c.route, end = r.turnIdx || r.dist.length - 1, L = c.landscape;
    // [network] (not where the route passes itself: a ride network's junction, where a walker beside one pass
    // would be on the other's carriageway — the trail walk breaks there)
    const otherPass = (i) => {
      const x = c.index.xs[i], z = c.index.zs[i];
      for (let j = 0; j <= end; j += 1) {
        if (Math.abs(j - i) < 4 || ghostAt(r, r.dist[j])) continue;
        const dx = c.index.xs[j] - x, dz = c.index.zs[j] - z;
        if (dx * dx + dz * dz < 30 * 30) return true;
      }
      return false;
    };
    for (const k of (L.data.routeKinds || []).filter((k) => k.kind === 'trail')) {
      if (due()) yield;
      let pts = [];
      const flush = () => { if (pts.length > 3) walk.push({ path: makePath(pts), side: 4.7, allow: () => true, cls: 9, trail: true }); pts = []; };
      for (let i = Math.ceil(k.fromM / 10) + 1; i <= Math.min(end, Math.floor(k.toM / 10) - 1); i++) {
        if ((i & 15) === 0 && due()) yield;
        if (ghostAt(r, r.dist[i])) { flush(); continue; }   // (a network tour's repeat: walkers are on the real pass)
        if (this._passCache?.[i] ?? ((this._passCache ||= [])[i] = otherPass(i))) { flush(); continue; }
        pts.push({ x: c.index.xs[i], y: r.ele[i], z: c.index.zs[i] });
      }
      flush();
    }
    // off the route's road: sidewalks across its carriageway become crossings (with a kerb to wait at); sidewalks
    // and lanes that run along it, or that end on it with nowhere to go, are cut out here
    this.walk = yield* this._offRouteJob(walk, (w) => (w.side ? w.side + .9 : 1.4), MOVE.walk);
    this.drive = yield* this._offRouteJob(drive, (w) => (w.oneway ? 1.5 : w.lane) + 1.1, MOVE.car);
  }

  /**
   * Where a way runs over the route's road (at its level): [{s0, s1, lo, hi, rx, rz, half}] — s along the way;
   * lo/hi the route's distances there; rx, rz the middle of it on the route. `hw`: half the width the way's
   * agents use (both sidewalks, both lanes); `margin`: room kept beyond the route's carriageway.
   */
  _bandOf(path, hw, margin) {
    const L = this.city.landscape, ix = this.city.index, dist = this.city.route.dist, step = 1.5, p = {}, out = [];
    let cur = null;
    const close = () => { if (cur) out.push(cur); cur = null; };
    // (a coarse pass first: most ways never come near the route)
    const coarse = [], cs = 8, reach = hw + HALF + margin + 8 + cs;
    for (let k = 0; k <= Math.ceil(path.length / cs); k++) { pathAt(path, Math.min(path.length, k * cs), p); coarse.push(!!ix.nearest(p.x, p.z, reach)); }
    if (!coarse.includes(true)) return out;
    const n = Math.ceil(path.length / step);
    for (let k = 0; k <= n; k++) {
      const s = Math.min(path.length, k * step), j = Math.floor(s / cs);
      if (!coarse[j] && !coarse[j + 1]) { close(); continue; }
      poseOn(path, s, 1, p);
      if (!ix.nearest(p.x, p.z, hw + HALF + margin + 8)) { close(); continue; }
      let hit = null;
      for (const f of [0, -1, 1, -.5, .5]) {
        const r = L.routeDist(p.x - p.tz * hw * f, p.z + p.tx * hw * f);
        if (r && r.d < HALF + margin && Math.abs(p.y - r.y) < 3.5) { hit = r; break; }
      }
      if (!hit) { close(); continue; }
      // [network] where the route passes the same spot twice (a ride network's junction), each pass is its own band
      if (cur && Math.abs(dist[hit.i] - cur.at) > 60) close();
      if (!cur) cur = { s0: s, s1: s, lo: Infinity, hi: -Infinity, rx: 0, rz: 0, n: 0 };
      cur.at = dist[hit.i];
      cur.s1 = s; cur.lo = Math.min(cur.lo, dist[hit.i]); cur.hi = Math.max(cur.hi, dist[hit.i + 1] ?? dist[hit.i]);
      cur.rx += ix.xs[hit.i]; cur.rz += ix.zs[hit.i]; cur.n++;
    }
    close();
    return out.map((c) => ({ s0: Math.max(0, c.s0 - step), s1: Math.min(path.length, c.s1 + step), lo: c.lo, hi: c.hi,
      rx: c.rx / c.n, rz: c.rz / c.n, half: (c.s1 - c.s0) / 2 + step }));
  }

  *_offRouteJob(ways, hwOf, K) {
    const pieces = function* (list, cut) {
      const out = [];
      for (const w of list) {
        if (due()) yield;
        if (w.trail) { out.push(w); continue; }
        const band = w.band || this._bandOf(w.path, hwOf(w), K.margin), len = w.path.length, gaps = [];
        for (const c of band) if (cut(w, c, len)) gaps.push([c.s0 - 1, c.s1 + 1]);
        if (!gaps.length) { out.push(Object.assign(w, { band })); continue; }
        let from = 0;
        for (const [a, b] of [...gaps, [len + 1, len + 1]]) {
          if (a - from >= 8) { const path = subPath(w.path, from, Math.min(len, a)); out.push({ ...w, path, band: this._bandOf(path, hwOf(w), K.margin) }); }
          from = Math.max(from, b);
        }
      }
      return out;
    };
    // 1. along the route's road (more than a crossing's length on it): cut out
    let list = yield* pieces.call(this, ways, (w, c) => c.s1 - c.s0 > K.longM);
    // 2. ends on the route's road where no other way carries on (that may be entered there): cut back to the kerb
    const key = (p) => `${Math.round(p.x)},${Math.round(p.z)}`, ends = new Map();   // (as Network joins them)
    for (const w of list) for (const [end, p] of [[0, w.path.pts[0]], [1, w.path.pts.at(-1)]]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push({ w, end }); }
    const others = (w, end) => (ends.get(key(end ? w.path.pts.at(-1) : w.path.pts[0])) || []).filter((o) => o.w !== w && o.w.allow(o.end === 0 ? 1 : -1)).length;
    list = yield* pieces.call(this, list, (w, c, len) => (c.s0 <= .01 && !others(w, false)) || (c.s1 >= len - .01 && !others(w, true)));
    return new Network(list);
  }

  // -------------------------------------------------------------- people
  _people() {
    const n = this.counts.people, scene = this.city.route.scene || {};
    const uTime = this.city.uniforms.uTime, nearM = { low: 25, balanced: 45, high: 70 }[this.city.qualityKey] ?? 45;
    const farM = { low: 70, balanced: 110, high: 160 }[this.city.qualityKey] ?? 110;
    this.crowd = new Crowd(this.city.group, { uTime, name: 'People', capacity: n, nearM, farM, dogs: Math.ceil(n * .08), strollers: Math.ceil(n * .05) });
    this.cyclistCrowd = new Crowd(this.city.group, { uTime, name: 'Cyclists', capacity: this.counts.cyclists, nearM: Infinity, kind: 'cyclist' });
    this.walkers = [];
    for (let i = 0; i < n; i++) this.walkers.push({ id: i, alive: false });
    this.riders = [];
    for (let i = 0; i < this.counts.cyclists; i++) this.riders.push({ id: i, alive: false, bike: true, look: randomLook(this.rand, { kids: 0, helmet: true }), phase: this.rand() });
    // gathering spots (squares, overlooks, the stadium plaza): people standing about
    this.hotspots = (scene.hotspots || []).map((h) => ({ ...h, ...this.city.D.proj.toLocal(h.lat, h.lon) }));
  }

  _spawnWalker(a, cam, initial) {
    a.x = null; a.lx = null;   // a new life: no old position to fall back to
    this._placeWalker(a, cam, initial);
    if (a.alive) { this._dress(a); a.v = a.speed; }
  }

  /** A new look and what they're doing: standing about, strolling, walking (some with a dog or a stroller), jogging. */
  _dress(a) {
    const r = this.rand;
    let look, clip;
    if (a.stand) {
      look = randomLook(r, { kids: .12 });
      const k = r(); clip = k < .35 ? CLIP.idle : k < .6 ? CLIP.look : k < .82 ? CLIP.phone : CLIP.photo;
      if (clip === CLIP.phone || clip === CLIP.photo) look.bits |= FIT.PROP;
    } else if (a.gait === 2) { look = randomLook(r, { kids: 0, sporty: true }); clip = CLIP.jog; }
    else {
      look = randomLook(r, { kids: .12, packs: .14 });
      clip = a.wander ? CLIP.stroll : CLIP.walk;
      if (!a.wander && !look.kid && r() < .08) { look.dog = dogLook(r); look.h = .97 + r() * .05; clip = CLIP.leash; a.speed = Math.min(a.speed, 1.3); }
      else if (!a.wander && !look.kid && r() < .05) { look.stroller = new THREE.Color(PALETTES.strollers[Math.floor(r() * PALETTES.strollers.length)]); clip = CLIP.push; a.speed = Math.min(a.speed, 1.15); }
      else if (look.kid) a.speed = Math.min(a.speed, 1.05);
    }
    a.look = look; a.clip = clip; a.phase = r(); a.rate = clipRate(clip, a.stand ? 0 : a.speed, look);
  }

  /** Somewhere new for an agent: out of the rider's sight (far off, or behind the camera) unless the ride is just starting. */
  _outOfView(x, z, cam, minR, initial) {
    if (initial) return true;
    const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
    if (d >= minR) return true;
    const r = this._rider;
    if (!r) return false;
    const fx = r.x - cam.x, fz = r.z - cam.z, fl = Math.hypot(fx, fz) || 1;
    return (dx * fx + dz * fz) / fl < -.2 * d;
  }

  /** A spot on a network to start from, [way, s], clear of the route's road. */
  _spotOn(net, cam, R, minR, initial) {
    const p = this._tmpS || (this._tmpS = {});
    for (let t = 0; t < 6; t++) {
      const hit = net.near(cam.x, cam.z, R, this.rand, initial ? 0 : minR);
      if (!hit) return null;
      const w = net.ways[hit[0]];
      if ((w.band || []).some((c) => hit[1] > c.s0 - 4 && hit[1] < c.s1 + 4)) continue;
      pathAt(w.path, hit[1], p);   // (near() picks a 120 m cell: check the spot itself)
      if (!this._outOfView(p.x, p.z, cam, minR + 10, initial)) continue;
      return hit;
    }
    return null;
  }

  _placeWalker(a, cam, initial) {
    const R = 260, net = this.walk, L = this.city.landscape;
    // a third of the crowd gathers at the nearest hotspots
    const spot = this.hotspots.length && this.rand() < .35 ? this.hotspots[Math.floor(this.rand() * this.hotspots.length)] : null;
    if (spot && Math.hypot(spot.x - cam.x, spot.z - cam.z) < R + 100) {
      const ang = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * (spot.radiusM || 25);
      const x = spot.x + Math.cos(ang) * d, z = spot.z + Math.sin(ang) * d;
      const c = L.landAt(x, z), road = L.routeDist(x, z);
      if (c !== LAND.water && c !== LAND.building && !(road && road.d < HALF + 1.5) && this._outOfView(x, z, cam, 165, initial)) {
        Object.assign(a, { alive: true, stand: true, x, z, y: L.heightAt(x, z), yaw: this.rand() * 6.28, gait: this.rand() < .8 ? 0 : 1, speed: 0, v: 0, way: -1 });
        if (a.gait === 1) Object.assign(a, { stand: false, speed: .6, v: .6, wander: true });
        return;
      }
    }
    const hit = this._spotOn(net, cam, R, 165, initial);
    if (!hit) { a.alive = false; return; }
    const w = net.ways[hit[0]], jog = w.trail || w.cls === 8 ? this.rand() < .35 : this.rand() < .06;
    Object.assign(a, { alive: true, stand: false, wander: false, way: hit[0], s: hit[1], dir: this.rand() < .5 ? 1 : -1,
      speed: jog ? 2.6 + this.rand() * .8 : 1.1 + this.rand() * .5, gait: jog ? 2 : 1, nx: undefined, go: null, kerbJ: this.rand() * 1.2,
      lat: (w.side ? (this.rand() < .5 ? -1 : 1) * (w.side + (this.rand() - .5) * 1.2) : (this.rand() - .5) * 2.2) });
    // on a shared trail: a side of their own, off the rider's road (4.3–5.3 m from its centre line; the rider rides 1.5 m out)
    if (w.trail) { a.lat = 4.3 + this.rand(); a.wside = this.rand() < .5 ? -1 : 1; }
    a.v = a.speed;
  }

  _spawnCyclist(a, cam, initial) {
    a.x = null;
    const hit = this._spotOn(this.walk, cam, 300, 165, initial);
    if (!hit) { a.alive = false; return; }
    const w = this.walk.ways[hit[0]];
    if (!(w.trail || w.cls === 8 || w.cls <= 5)) { a.alive = false; return; }
    Object.assign(a, { alive: true, way: hit[0], s: hit[1], dir: this.rand() < .5 ? 1 : -1, speed: 4.5 + this.rand() * 2.5, gait: 3, nx: undefined, go: null,
      lat: w.trail ? 2.3 : w.side ? (w.side - 1.2) : 0, wside: -1 });
    if (w.cls <= 5) a.lat = w.side - 2.4;
    a.v = a.speed;
  }

  /**
   * The next stretch of the route's road on the agent's way ahead (or just round the corner on the way it will
   * take next): {c, dist, cross, inside, wall} or null. `wall`: the way ends on the road with nowhere to go.
   */
  _ahead(a, net, look) {
    const w = net.ways[a.way], len = w.path.length, fwd = a.dir > 0, rem = fwd ? len - a.s : a.s;
    const first = (way, s, dir) => {
      let best = null;
      for (const c of way.band || []) {
        if (dir > 0 ? c.s1 <= s : c.s0 >= s) continue;
        const d = dir > 0 ? c.s0 - s : s - c.s1;
        if (!best || d < best.d) best = { c, d };
      }
      return best;
    };
    const here = first(w, a.s, a.dir);
    const next = a.nx ? net.ways[a.nx.i] : null;
    if (here) {
      if (here.d > look) return null;
      let cross = here.c.s1 - here.c.s0, wall = false;
      if (fwd ? here.c.s1 >= len - .01 : here.c.s0 <= .01) {
        // runs on into the next way: across the junction
        if (!next) wall = a.nx === null;
        else { const on = first(next, a.nx.s - a.nx.dir * .01, a.nx.dir); if (on && on.d <= .05) cross += on.c.s1 - on.c.s0; }
      }
      return { c: here.c, dist: here.d, cross, inside: here.d <= 0, wall };
    }
    if (!next || rem > look) return null;
    const on = first(next, a.nx.s - a.nx.dir * .01, a.nx.dir);
    if (!on || rem + on.d > look) return null;
    return { c: on.c, dist: rem + Math.max(0, on.d), cross: on.c.s1 - on.c.s0, inside: false, wall: false };
  }

  /** Clear to cross here: the rider is well past (70 m), or far enough off to need longer than `t` s (+ 5 s) to arrive. */
  _clear(c, rider, t) {
    if (!rider) return true;
    const past = rider.dir > 0 ? rider.out - c.hi : c.lo - rider.out;
    if (past > 70 && past < 400) return true;
    return Math.hypot(rider.x - c.rx, rider.z - c.rz) - c.half > Math.max(rider.speed || 0, 3) * (t + 5) + 40;
  }

  /**
   * Where a vehicle driving `dir` along way w turns round at its dead end (s along the way): its front at the end,
   * or further back where that would swing it into the route's road. A vehicle turning round pivots about its
   * middle (half its length each way, and its lane swaps sides), so on a street cut back short of the route's
   * kerb, or running close beside the route, the middle stays half a length + a lane + room clear of the road.
   * (A bus at a cut-back T on Second Ave swung its nose through the rider.) Cached per way, direction and size.
   */
  _turnRound(w, dir, bus) {
    const key = (dir > 0 ? 'f' : 'b') + (bus ? 'B' : 'c'), cache = (w.turnAt ||= {});
    if (cache[key] != null) return cache[key];
    const L = this.city.landscape, len = w.path.length, half = bus ? 6.5 : 2.8, need = HALF + half + (w.lane || 1.5) + .6, p = {};
    const endS = dir > 0 ? len : 0;
    let at = dir > 0 ? 0 : len;   // (none clear: as far back as the way goes)
    for (let k = half; k <= len; k += 1) {
      const s = endS - dir * k;
      pathAt(w.path, s, p);
      const r = L.routeDist(p.x, p.z);
      if (!r || r.d > need || Math.abs(p.y - r.y) > 4) { at = s; break; }
    }
    return (cache[key] = at);
  }

  /**
   * [F38] The nearest stretch of the route's road beyond the far end of way i (driven `dir`), on any way that carries
   * on from there (within 160 m): {d: metres from that end to its kerb side, c: the band} or null. Cached.
   */
  _roadAhead(net, i, dir, car, left = 160, depth = 0) {
    const top = depth === 0, key = `${dir > 0 ? 'f' : 'b'}${car ? 'c' : 'w'}`, w = net.ways[i];
    if (top && (w.roadAhead ||= {})[key] !== undefined) return w.roadAhead[key];
    const endP = dir > 0 ? w.path.pts.at(-1) : w.path.pts[0];
    let best = null;
    for (const o of net.ends.get(net.key(endP)) || []) {
      if (o.i === i) continue;
      const od = o.end === 0 ? 1 : -1, ow = net.ways[o.i];
      if (!ow.allow(od) || (car && !this._turnOk(ow, od, false))) continue;
      const len = ow.path.length;
      let hit = null;
      for (const c of ow.band || []) { const d = od > 0 ? c.s0 : len - c.s1; if (!hit || d < hit.d) hit = { d: Math.max(0, d), c }; }
      if (!hit && len < left && depth < 6) { const r = this._roadAhead(net, o.i, od, car, left - len, depth + 1); if (r) hit = { d: len + r.d, c: r.c }; }
      if (hit && hit.d < left && (!best || hit.d < best.d)) best = hit;
    }
    if (top) w.roadAhead[key] = best;
    return best;
  }

  /** Can a vehicle drive way w in direction dir: no dead end at its far end, or room to turn round before it (and to brake for that). */
  _turnOk(w, dir, bus) {
    const net = this.drive, i = net.ways.indexOf(w), endP = dir > 0 ? w.path.pts.at(-1) : w.path.pts[0];
    const key = (dir > 0 ? 'f' : 'b') + (bus ? 'B' : 'c'), cache = (w.turnOk ||= {});
    if (cache[key] != null) return cache[key];
    const on = (net.ends.get(net.key(endP)) || []).some((o) => o.i !== i && net.ways[o.i].allow(o.end === 0 ? 1 : -1));
    let ok = on;
    if (!ok) {
      // clear of the road there, and far enough in to brake for it from the way's start
      const at = this._turnRound(w, dir, bus), p = pathAt(w.path, at, {}), r = this.city.landscape.routeDist(p.x, p.z);
      const brake = (w.speed * 1.15) ** 2 / (4 * MOVE.car.dec) + 5;   // (its top speed, braking as _advance does)
      ok = (!r || r.d > HALF + (bus ? 6.5 : 2.8) + (w.lane || 1.5) + .6 || Math.abs(p.y - r.y) > 4) && (dir > 0 ? at : w.path.length - at) >= brake;
    }
    return (cache[key] = ok);
  }

  /**
   * One step along a network: ease the speed (to a stop at the kerb or stop line while the rider is near a
   * crossing, and at the end of a dead end), move on, and draw it where it is, following no faster than its pace.
   */
  _advance(a, net, dt, rider, kind) {
    const K = MOVE[kind];
    let w = net.ways[a.way];
    const len = w.path.length, rem = a.dir > 0 ? len - a.s : a.s;
    const keep = kind === 'car' ? (way, dir) => this._turnOk(way, dir, a.bus) : null;   // (no dead end too tight to turn round in)
    if (a.nx === undefined && rem < K.look + 30) a.nx = net.next(a.way, a.dir > 0, this.rand, keep);
    let stopAt = null, turn = false;
    const x = this._ahead(a, net, K.look);
    if (!x || x.c !== a.go) a.go = x && x.inside ? x.c : null;
    if (x && !x.inside) {
      const kerb = (a.bus ? K.kerb + 4 : K.kerb) + (a.kerbJ || 0) + (a.slot || 0) * 7.5, stopD = x.dist - kerb;
      if (x.wall) { stopAt = kind === 'car' ? Math.max(0, Math.min(stopD, (this._turnRound(w, a.dir, a.bus) - a.s) * a.dir)) : stopD; turn = true; }   // (cars: where they can turn round)
      else if (a.go !== x.c) {
        const t = (x.dist + x.cross + K.body) / Math.max(a.v, a.speed * .6);
        if (this._clear(x.c, rider, t)) { if (stopD < a.v * a.v / (2 * K.dec) + 1) { a.go = x.c; a.slot = 0; } }
        else {
          stopAt = stopD;
          if (kind === 'car' && a.queue !== x.c) { a.queue = x.c; a.slot = (x.c.waiting = (x.c.waiting || 0) + 1) - 1; }
        }
      }
    }
    if (a.queue && stopAt == null) { a.queue.waiting = Math.max(0, (a.queue.waiting || 1) - 1); a.queue = null; a.slot = 0; }
    // a dead end: slow down to turn round where its turning circle keeps off the route's road (_turnRound) [F16]
    if (stopAt == null && a.nx === null && kind === 'car') {
      const d = (this._turnRound(w, a.dir, a.bus) - a.s) * a.dir;
      if (d < K.look + 7) { stopAt = Math.max(0, d); turn = true; }
    }
    let target = a.speed;
    if (stopAt != null) target = stopAt < .05 ? 0 : Math.min(target, Math.sqrt(2 * K.dec * stopAt));
    // [F38] a crossing beyond what _ahead sees (past the next way, or further than `look`: a fast street, short ways
    // in a junction) may not be clear when it comes into view: no faster than it could still stop at its kerb
    else if (!x && rider) {
      const far = this._roadAhead(net, a.way, a.dir, kind === 'car');
      if (far && rem + far.d < 160 && !this._clear(far.c, rider, (rem + far.d) / Math.max(a.v, 1) + 2)) {
        const kerb = (a.bus ? K.kerb + 4 : K.kerb) + 1.2;
        target = Math.min(target, Math.sqrt(2 * K.dec * Math.max(0, rem + far.d - kerb)));
      }
    }
    a.v = Math.max(0, a.v + Math.max(-2 * K.dec * dt, Math.min(K.acc * dt, target - a.v)));
    if (turn && a.v < .05 && stopAt < .3) { a.dir = -a.dir; a.nx = undefined; a.go = null; }   // nowhere to go but back
    a.s += a.dir * a.v * dt;
    if (a.s < 0 || a.s > len) {
      const over = a.s < 0 ? -a.s : a.s - len;
      const nx = a.nx !== undefined ? a.nx : net.next(a.way, a.s > len, this.rand, keep);
      a.nx = undefined;
      if (nx) {
        a.way = nx.i; a.s = nx.s + nx.dir * over; a.dir = nx.dir; w = net.ways[a.way]; a.s = Math.max(0, Math.min(w.path.length, a.s));
        // a walker keeps to the new way's sidewalk (a wide street's offset would put them in a narrow one's carriageway)
        if (kind === 'walk' && !w.trail) { const g = a.lat < 0 ? -1 : 1, m = Math.abs(a.lat); a.lat = g * (w.side ? Math.max(w.side - .6, Math.min(w.side + .6, m)) : Math.min(1.1, m)); }
      }
      else { a.dir = -a.dir; a.s = Math.max(0, Math.min(len, a.s)); }
    }
    // where it is on its way: its own side (on a shared trail a side of its own; cyclists keep the far half from the rider)
    const p = poseOn(w.path, a.s, K.chord, this._tmp || (this._tmp = {}));
    let wl = a.lat * (a.dir > 0 ? 1 : -1);
    if (w.trail) wl = (kind === 'bike' && rider ? -rider.dir : a.wside || -1) * Math.abs(a.lat);
    const tx = p.x - p.tz * wl, tz = p.z + p.tx * wl;
    a.pitch = Math.atan(p.dy || 0) * a.dir;
    if (a.x == null) { a.x = tx; a.z = tz; a.y = p.y; a.yaw = Math.atan2(p.tx * a.dir, p.tz * a.dir); return w; }
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz), max = (a.v * 1.25 + K.catch) * dt, f = d > max ? max / d : 1;
    a.x += dx * f; a.z += dz * f; a.y = p.y;
    if (d * f > .002) {
      let dy = Math.atan2(dx, dz) - a.yaw;
      dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      a.yaw += Math.max(-K.turn * dt, Math.min(K.turn * dt, dy));
    }
    return w;
  }

  _updatePeople(cam, dt, time, rider) {
    const L = this.city.landscape;
    this.crowd.begin(cam);
    for (const a of this.walkers) {
      if (!a.alive || Math.hypot(a.x - cam.x, a.z - cam.z) > 330) this._spawnWalker(a, cam, !this._started);
      if (!a.alive) continue;
      if (a.wander) {
        // strolling about a square: turn away (gently) rather than wander onto the rider's road
        const nx = a.x + Math.sin(a.yaw) * a.speed * dt, nz = a.z + Math.cos(a.yaw) * a.speed * dt, r = L.routeDist(nx, nz);
        if (r && r.d < HALF + 1.5) a.yaw += 2 * dt;
        else { a.yaw += (this.rand() - .5) * dt; a.x = nx; a.z = nz; a.y = L.heightAt(a.x, a.z); }
        a.v = r && r.d < HALF + 1.5 ? 0 : a.speed;
      } else if (!a.stand) this._advance(a, this.walk, dt, rider, 'walk');
      // waiting at the kerb: stand still until moving again
      const still = !a.stand && dt > 0 && a.v < .15;
      this.crowd.add(a.look, a.x, a.y, a.z, a.yaw, still ? (a.clip === CLIP.push || a.clip === CLIP.leash ? a.clip : CLIP.idle) : a.clip, a.phase, still ? (a.clip === CLIP.push || a.clip === CLIP.leash ? 0 : clipRate(CLIP.idle)) : a.rate);
    }
    this.crowd.end();
    this.cyclistCrowd.begin(cam);
    for (const a of this.riders) {
      if (!a.alive || Math.hypot(a.x - cam.x, a.z - cam.z) > 380) this._spawnCyclist(a, cam, !this._started);
      if (!a.alive) continue;
      this._advance(a, this.walk, dt, rider, 'bike');
      this.cyclistCrowd.add(a.look, a.x, a.y, a.z, a.yaw, CLIP.cycle, a.phase, a.v > .3 ? clipRate(CLIP.cycle, a.v) : 0);
    }
    this.cyclistCrowd.end();
  }

  // -------------------------------------------------------------- cars and buses
  _traffic() {
    const n = this.counts.cars, buses = Math.max(4, Math.round(n / 12));
    // every car keeps its model and paint for good (one instanced mesh per model)
    const pickModel = () => { let r = this.rand(); for (const [k, w] of CAR_MIX) { r -= w; if (r <= 0) return k; } return 'sedan'; };
    this.carAgents = Array.from({ length: n }, (_, id) => ({ id, alive: false, model: pickModel(), dist: 0 }));
    this.busAgents = Array.from({ length: buses }, (_, id) => ({ id, alive: false, bus: true, model: 'bus', dist: 0 }));
    this.oncoming = Array.from({ length: 4 }, (_, id) => ({ id: n + id, alive: false, model: ['sedan', 'suv', 'hatch', 'van'][id], dist: 0 }));   // oncoming traffic on the route's streets
    this.carMeshes = {};
    for (const a of [...this.carAgents, ...this.oncoming, ...this.busAgents]) {
      const m = (this.carMeshes[a.model] ||= { list: [] }); a.slot = m.list.length; m.list.push(a);
    }
    for (const [model, m] of Object.entries(this.carMeshes)) {
      m.im = vehicleMesh(model, this.carMat, m.list.length, model === 'bus' ? 'Buses' : `Cars · ${model}`);
      if (model !== 'bus' && model !== 'taxi') m.list.forEach((a) => setPaint(m.im, a.slot, CARS[Math.floor(this.rand() * CARS.length)]));
      this.city.group.add(m.im);
    }
  }

  _spawnCar(a, cam, initial) {
    a.x = null; a.lx = null;
    if (a.queue) { a.queue.waiting = Math.max(0, (a.queue.waiting || 1) - 1); a.queue = null; }
    const R = 420, net = this.drive;
    for (let t = 0; t < 4; t++) {
      const hit = this._spotOn(net, cam, R, R * .55, initial);
      if (!hit) break;
      const w = net.ways[hit[0]];
      if (a.bus && !w.bus) continue;
      const dir = w.oneway ? w.oneway : (this.rand() < .5 ? 1 : -1);
      if (!this._turnOk(w, dir, a.bus)) continue;
      // [F38] not so close before the route's road that it could not stop at the kerb for it (the first frame)
      const room = (w.speed * 1.15) ** 2 / (4 * MOVE.car.dec) + MOVE.car.kerb + 10, rem = dir > 0 ? w.path.length - hit[1] : hit[1];
      if ((w.band || []).some((c) => { const d = dir > 0 ? c.s0 - hit[1] : hit[1] - c.s1; return d > -4 && d < room; })) continue;
      if (rem < room) { const far = this._roadAhead(this.drive, hit[0], dir, true); if (far && rem + far.d < room) continue; }
      Object.assign(a, { alive: true, way: hit[0], s: hit[1], dir, speed: w.speed * (.8 + this.rand() * .35), lat: w.lane || (this.rand() - .5) * 3, gait: 0, nx: undefined, go: null, slot: 0 });
      a.v = a.speed;
      return;
    }
    a.alive = false;
  }

  /**
   * [F18] Where the route rides a one-way street (the mapped street under its centre line, running along it):
   * [{fromM, toM, dir}] outbound metres, dir +1 where its traffic goes the way out, −1 the way back. The route
   * rides every street both ways (a network's edge backwards, the return leg), so on these stretches no oncoming
   * traffic is drawn: whichever way you ride, it would drive against the one-way or meet you head-on in it.
   */
  _oneWays() {
    if (this._ow) return this._ow;
    const c = this.city, L = c.landscape, r = c.route, end = (r.turnIdx || r.dist.length - 1) - 1, ix = c.index;
    const mark = new Int8Array(end + 1), p = {};
    for (const st of c.streets || []) {
      if (!st.oneway || st.pts.length < 2) continue;
      if (!st.pts.some((q) => ix.nearest(q.x, q.z, 60))) continue;   // (most streets are nowhere near the route)
      const path = makePath(st.pts);
      for (let s = 0; s <= path.length; s += 4) {
        poseOn(path, s, 2, p);
        const h = L.routeDist(p.x, p.z);
        if (!h || h.d > 3 || h.i >= end || Math.abs(p.y - h.y) > 3) continue;
        const dx = ix.xs[h.i + 1] - ix.xs[h.i], dz = ix.zs[h.i + 1] - ix.zs[h.i], l = Math.hypot(dx, dz) || 1;
        const cos = (p.tx * dx + p.tz * dz) / l;
        if (Math.abs(cos) > .85) mark[h.i] = Math.sign(cos) * st.oneway;
      }
    }
    // runs of marked samples (gaps under 40 m bridged, runs under 50 m dropped: a side street's mouth, a crossing)
    const out = [];
    let cur = null;
    for (let i = 0; i <= end; i++) {
      if (!mark[i]) continue;
      if (cur && cur.dir === mark[i] && r.dist[i] - cur.toM <= 40) cur.toM = r.dist[i + 1];
      else { if (cur) out.push(cur); cur = { fromM: r.dist[i], toM: r.dist[i + 1], dir: mark[i] }; }
    }
    if (cur) out.push(cur);
    return (this._ow = out.filter((o) => o.toM - o.fromM >= 50));
  }
  _oneWayIn(lo, hi) { return this._oneWays().some((o) => o.toM + 10 > lo && o.fromM - 10 < hi); }

  /** The route's own streets from the rider out to s are all two-way street (no trail, no lenticular bridge, no one-way): oncoming traffic can meet the rider there. */
  _roadTo(from, s) {
    const L = this.city.landscape, lo = Math.min(from, s), hi = Math.max(from, s);
    if (L.routeBridges.some((b) => b.style === 'lenticular' && b.toM + 30 > lo && b.fromM - 30 < hi)) return false;
    if (this._oneWayIn(lo, hi)) return false;
    // (nor across a ghost stretch: a network line's repeat, whose ends can turn sharply where an area's line joins
    // its next piece — PLAN 5.4; oncoming traffic drives the real pass only)
    for (let q = lo; q <= hi; q += 10) if (L.routeKindAt(q) !== 'road' || ghostAt(this.city.route, q)) return false;
    return L.routeKindAt(hi) === 'road';
  }

  _spawnOncoming(a, rider) {
    // oncoming traffic on the route's own streets, in the far lane: it appears far ahead, round a bend or past the
    // view, only where the street runs on unbroken to the rider, so it never has to vanish in front of them
    const r = this.city.route, turn = r.turnS || r.total, p = this._tmpR || (this._tmpR = {});
    const ahead = 260 + this.rand() * 380, s = rider.out + rider.dir * ahead;
    const far = s >= 0 && s <= turn && Math.hypot(this._routeAt(s, p).x - rider.x, p.z - rider.z) > 220;
    const speed = 8 + this.rand() * 4;
    // [network] not to pass the rider just before a U-turn on their path (rider.uturn, out metres): after it, it would be
    // ahead of them in their own lane
    const meet = rider.out + rider.dir * ahead * Math.max(rider.speed || 0, 1) / (Math.max(rider.speed || 0, 1) + speed);
    const uturn = rider.uturn != null && (rider.uturn - meet) * rider.dir < 80;
    if (!far || uturn || !this._roadTo(rider.out, s)) { a.alive = false; a.wait = 1 + this.rand() * 3; return; }
    Object.assign(a, { alive: true, onRoute: true, s, dir: -rider.dir, speed });
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
    for (const m of Object.values(this.carMeshes)) m.n = 0;
    const draw = (a) => {
      const m = this.carMeshes[a.model], i = m.n++;
      this.e.set(-(a.pitch || 0), a.yaw, 0); this.q.setFromEuler(this.e);
      m.im.setMatrixAt(i, this.m.compose(V(a.x, a.y + .02, a.z), this.q, this.one));
      if (a.lx != null) a.dist += Math.hypot(a.x - a.lx, a.z - a.lz);
      a.lx = a.x; a.lz = a.z;
      setMove(m.im, i, a.dist, 0);
    };
    // cars and buses on the city's streets: they keep their lane, and stop at the stop line before the route's
    // road while the rider is near (_advance)
    for (const a of [...this.carAgents, ...this.busAgents]) {
      if (!a.alive || Math.hypot(a.x - cam.x, a.z - cam.z) > 480) this._spawnCar(a, cam, !this._started);
      if (!a.alive) { a.lx = null; continue; }
      this._advance(a, this.drive, dt, rider, 'car');
      draw(a);
    }
    const p = this._tmpR || (this._tmpR = {}), q = this._tmpQ || (this._tmpQ = {});
    for (const a of this.oncoming) {
      if (rider && !a.alive) { a.wait = (a.wait || 0) - dt; if (a.wait <= 0) this._spawnOncoming(a, rider); }
      if (!rider || !a.alive) { a.lx = null; continue; }
      a.s += a.dir * a.speed * dt;
      // gone once well behind the rider (behind the camera); the street ahead of it was checked when it appeared.
      // [network] once the rider has turned off its street at a junction (their place on the base route jumps far
      // from it), it drives on until it is out of sight
      const behind = (rider.out - a.s) * rider.dir, turn = this.city.route.turnS || this.city.route.total;
      const left = Math.abs(rider.out - a.s) > 900;
      if (left ? this._outOfView(a.x, a.z, cam, 160, false) || a.s < 0 || a.s > turn
        : behind > 80 || a.s < 0 || a.s > turn || (behind > 10 && (this.city.landscape.routeKindAt(a.s) !== 'road' || this._oneWayIn(a.s, a.s)))) { a.alive = false; a.wait = 2 + this.rand() * 6; a.lx = null; continue; }
      // its lane: a fixed offset from the centre line, square to the street's smoothed heading (no step at the GPS points)
      this._routeAt(a.s + 5, q); this._routeAt(a.s - 5, p);
      let hx = q.x - p.x, hz = q.z - p.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      const dy = (q.y - p.y) / hl;
      this._routeAt(a.s, p);
      const lane = ROAD_WIDTH * .26 * (a.dir > 0 ? 1 : -1);
      a.x = p.x - hz * lane; a.z = p.z + hx * lane; a.y = p.y + .1;
      a.yaw = Math.atan2(hx * a.dir, hz * a.dir); a.pitch = Math.atan(dy) * a.dir;
      draw(a);
    }
    for (const m of Object.values(this.carMeshes)) { m.im.count = m.n; m.im.instanceMatrix.needsUpdate = true; m.im.geometry.attributes.iMove.needsUpdate = true; }
  }

  // -------------------------------------------------------------- trains
  *_railsJob() {
    const c = this.city, L = c.landscape, byKind = { light_rail: [], rail: [] };
    const tracks = new MeshBuilder();
    for (const r of c.landscape.data.rails || []) {
      if (due()) yield;
      if (r.kind === 'funicular') continue;
      const pts = r.path.map(([a, o]) => c.D.local(a, o));
      if (r.bridge) { const y0 = L.baseHeight(pts[0].x, pts[0].z), y1 = L.baseHeight(pts.at(-1).x, pts.at(-1).z); pts.forEach((p, k) => { p.y = y0 + (y1 - y0) * k / (pts.length - 1) + 1; }); }
      else pts.forEach((p) => { p.y = L.heightAt(p.x, p.z) + .25; });
      (byKind[r.kind === 'tram' ? 'light_rail' : r.kind] || byKind.rail).push(pts);
    }
    for (const lines of Object.values(byKind)) for (const pts of lines) {
      if (due()) yield;
      // ballast bed and two rails as flat ribbons (cheap: two triangles per segment)
      const raised = pts.map((p) => ({ x: p.x, y: p.y - .2, z: p.z }));
      tracks.color('#6b6359'); ribbon(tracks, raised, 3.2, 0, 10);
      tracks.color('#2f2c29');
      for (const side of [-.72, .72]) ribbon(tracks, offsetLine(pts, side), .14, .08, 10);
    }
    yield* tracks.keepOutOfJob(L.inRouteTube);   // rail beds the data lifts into the rider's space
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

  /**
   * Where a train line passes under the route's road with too little room (F59: a short deck over a rail cut the
   * z14 ground fills, so the rails are drawn in the cut's floor ~3 m under the deck): [{s0, s1}] along the line.
   * Cars there aren't drawn — the train runs into the cut under the deck rather than through the road and rider.
   * (At a level crossing the rails are at the road's height: that's `_crossings`.)
   */
  _underpasses(t) {
    if (t.underpasses) return t.underpasses;
    const L = this.city.landscape, out = [], p = {}, reach = t.gap / 2 + 2;
    let cur = null;
    for (let s = 0; s <= t.path.length; s += 2) {
      t.path.at(s, p);
      const r = L.routeDist(p.x, p.z), below = r ? r.y - p.y : 0;
      const on = r && r.d < ROAD_WIDTH / 2 + 2.5 && below > 1.5 && below < 6;
      if (on && !cur) cur = { s0: s - reach, s1: s + reach };
      else if (on) cur.s1 = s + reach;
      else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return (t.underpasses = out);
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
      const under = this._underpasses(t);
      for (let k = 0; k < t.cars; k++) {
        const sk = Math.max(0, Math.min(t.path.length, t.s - t.dir * k * t.gap));
        t.path.at(sk, p);
        this.e.set(-Math.atan(p.dy || 0) * t.dir, Math.atan2(p.dx, p.dz) + (t.dir < 0 ? Math.PI : 0), 0); this.q.setFromEuler(this.e);
        this.m.compose(V(p.x, p.y, p.z), this.q, under.some((u) => sk > u.s0 && sk < u.s1) ? HIDDEN : this.one);
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
      const lights = [];
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
      // the upper station's observation deck: out over the slope beside the track, facing the city
      {
        const yaw = Math.atan2(dir.x, dir.z), dk = b.clone().addScaledVector(right, 7.5).addScaledVector(dir, -3), y = b.y - .2;
        M.color('#b5ab98'); M.box(dk.x, y - .45, dk.z, 7, .45, 9, yaw);
        M.color('#2f3438');
        for (const [u, w] of [[-3.4, 0], [3.4, 0]]) M.box(dk.x + right.x * u, y, dk.z + right.z * u, .08, 1.1, 9, yaw);
        M.box(dk.x - dir.x * 4.4, y, dk.z - dir.z * 4.4, 7, 1.1, .08, yaw);
        M.color('#7d776b');
        for (const u of [-3, 3]) { const q = dk.clone().addScaledVector(right, u).addScaledVector(dir, -4), g = L.baseHeight(q.x, q.z); if (y - g > 1) M.beam(V(q.x, g - .5, q.z), V(q.x, y - .5, q.z), .5, .5); }
        lights.push({ x: dk.x, y: y + 3, z: dk.z, size: 6, color: '#ffe0a8' });
      }
      this.inclines.push({ name, a, b, dir, right, len, period: 190 + this.inclines.length * 23 });
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
    // the Duquesne Incline's cars are varnished red wood; the Mon Incline's are yellow
    if (this.inclineCars) this.inclines.forEach((inc, k) => { for (const j of [0, 1]) setColor(this.inclineCars, 'iA', k * 2 + j, /Monongahela/.test(inc.name) ? '#e2ad1f' : '#8a2a17'); });
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
    for (const b of this.boats) b.latNow = null;   // (set from the lane on the first frame: never spawned in a pier)
    // whatever of the bridges stands in the river (piers, towers, arch feet), as obstacles on an 8 m grid
    const L = c.landscape, obs = new Map();
    c.group.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || !/Bridge/i.test(m.name)) return;
      const P = m.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const y = P.getY(i);
        if (y > L.level + 14) continue;   // piers, towers, arch feet, and decks too low for the riverboat to pass under
        const x = P.getX(i), z = P.getZ(i);
        if (L.waterAt(x, z) < .5) continue;
        const k = `${Math.round(x / 8)},${Math.round(z / 8)}`;
        if (!obs.has(k)) obs.set(k, { x: Math.round(x / 8) * 8, z: Math.round(z / 8) * 8 });
      }
    });
    this.riverObstacles = [...obs.values()];
    // wakes behind moving boats
    const cvs = document.createElement('canvas'); cvs.width = 64; cvs.height = 128; const g = cvs.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, 'rgba(255,255,255,.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(32, 0); g.lineTo(64, 128); g.lineTo(54, 128); g.lineTo(32, 18); g.lineTo(10, 128); g.lineTo(0, 128); g.closePath(); g.fill();
    const wakeGeo = c.own(new THREE.PlaneGeometry(1, 1)); wakeGeo.rotateX(-Math.PI / 2); wakeGeo.translate(0, 0, -.5);
    this.wakes = new THREE.InstancedMesh(wakeGeo, c.own(new THREE.MeshBasicMaterial({ map: c.own(new THREE.CanvasTexture(cvs)), transparent: true, depthWrite: false, opacity: .55 })), this.boats.length);
    this.wakes.frustumCulled = false; this.wakes.renderOrder = 2; c.group.add(this.wakes);
  }

  /**
   * Where a boat should be across the river right now: its own lane, moved toward the middle while any part of
   * its hull would be over land, and round any pier or tower ahead of it with room to spare.
   */
  _boatLane(b, p, side) {
    const L = this.city.landscape, len = { tow: 70, clipper: 46, motor: 9, kayak: 4 }[b.type], beam = { tow: 22, clipper: 12, motor: 3.5, kayak: 1.2 }[b.type];
    const fx = p.dx * b.dir, fz = p.dz * b.dir, nx = -p.dz * side, nz = p.dx * side;
    const wet = (lat) => [[0, 0], [len / 2, 0], [-len / 2, 0], [0, beam / 2 + 1.5], [0, -beam / 2 - 1.5], [len / 2, beam / 2], [-len / 2, -beam / 2]]
      .every(([u, v]) => L.heightAt(p.x + nx * lat + fx * u + nx * v, p.z + nz * lat + fz * u + nz * v) < L.level - .3);   // (the ground itself: a riverside trail's bank can reach out over the mapped water)
    let lat = b.lat;
    for (const o of this.riverObstacles || []) {
      const dx = o.x - p.x, dz = o.z - p.z, along = dx * fx + dz * fz;
      if (along < -len / 2 - 8 || along > len / 2 + 130) continue;
      const across = dx * nx + dz * nz, clear = beam / 2 + 9;
      if (Math.abs(across - lat) < clear) lat = across + (lat >= across ? clear : -clear);
    }
    for (let k = 0; k < 12 && !wet(lat); k++) lat *= .8;
    return lat;
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
      const side = b.dir > 0 ? 1 : -1;
      const lane = this._boatLane(b, p, side);
      b.latNow = b.latNow == null ? lane : b.latNow + Math.max(-5 * dt, Math.min(5 * dt, lane - b.latNow));   // ease sideways, ≤ 5 m/s
      const x = p.x - p.dz * b.latNow * side, z = p.z + p.dx * b.latNow * side;
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
    this._rider = rider;   // (new agents appear out of the rider's sight)
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
    this.crowd.dispose(); this.cyclistCrowd.dispose(); this.carMat.dispose();
    for (const m of Object.values(this.carMeshes)) { m.im.geometry.dispose(); m.im.dispose(); }
    for (const im of [this.inclineCars, this.wakes, this.birds, ...Object.values(this.boatMeshes || {}), ...this.trains.flatMap((t) => [t.im, t.carIm])]) im?.dispose?.();
  }
}
