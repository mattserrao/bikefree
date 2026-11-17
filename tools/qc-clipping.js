// Clipping and overlap QC — runs inside the real 3D scene (tools/qc-clipping.html, driven by tools/qc_clipping.mjs).
//
// Builds a route's world exactly as the app does, streams in every building chunk, indexes all static geometry
// with a BVH (three-mesh-bvh), then checks what you would see while riding:
//   rider    — anything solid (or another surface) inside the rider's body along the whole ride, both lanes
//   camera   — the chase camera inside geometry, or the rider hidden behind it
//   statics  — street trees and lamp posts inside buildings/bridges; overlapping building footprints;
//              bridges, stadiums, inclines and rail track cutting through buildings
//   surfaces — coplanar surfaces near the route (z-fighting) and the ground covering streets/paths
//   life     — a simulated ride with the city's traffic, people, trains and boats: vehicles through the rider,
//              through each other or through buildings; boats on land or through bridge piers
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { World } from '../js/world/world.js';
import { buildCatalogRoute, loadRouteScene } from '../js/routes.js';
import { riderPose, CHASE } from '../js/world/pose.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------------------------------------------------------------- thresholds (metres)
export const LIMITS = {
  step: 2,                 // ride sweep spacing
  body: { half: [0.32, 0.8, 0.9], lift: 1.1 },   // rider + bike envelope: half width/height/length; centre above the road
  cameraRadius: 0.35,      // ≈ near plane: geometry this close to the camera fills the screen
  zfight: 0.006,           // two surfaces with the same depth offset closer than this flicker
  zfightSpan: 0.6,         // … over a band at least this wide (surfaces crossing at a steeper angle meet in a line)
  groundOverStreet: 0.03,  // drawn ground this far above a street/path/sidewalk hides it
  corridor: 24,            // half-width of the strip beside the route checked for surface problems
  seenBack: [0, 12, 25, 45, 70],   // ground-over-street counts only if the chase camera sees it from this far back
  overlapM2: 4,            // building footprints overlapping by more than this
  lifeSeconds: 0.5,        // life sample interval (simulated)
  lifeSpeed: 9,            // simulated riding speed m/s
  lifeRadius: 220,         // only things this close to the rider (what's on screen and moving)
  staticRange: 150,        // static problems are reported when this close to the route (what you see riding)
};

// ---------------------------------------------------------------- findings
class Findings {
  constructor() { this.list = []; this.open = new Map(); }
  add(f, merge = 25) {
    const key = `${f.check}|${f.label}`;
    const o = this.open.get(key);
    if (o && f.s != null && o.s != null && Math.abs(f.s - o.to) <= merge) {
      o.to = Math.max(o.to, f.s); o.from = Math.min(o.from, f.s); o.count++;
      if (Math.abs(f.value ?? 0) > Math.abs(o.value ?? 0)) { o.value = f.value; o.at = f.s; o.point = f.point; o.extra = f.extra; }
      return;
    }
    const n = { ...f, from: f.s, to: f.s, at: f.s, count: 1 };
    this.list.push(n); this.open.set(key, n);
  }
  close() { this.open.clear(); }
}

// ---------------------------------------------------------------- scene + index
let world, route, city, landscape, F, entries, grid, buildingGrid, streamGrid = new Map(), streamed = new Set();
const CELL = 64;
// city life, plus highway traffic and birds on the real-coast scenes (Big Sur)
const lifeNames = /^(People|Cyclists|Cars|Buses|Light rail|Locomotives|Freight cars|Incline cars|Boats · |Traffic · |Birds · )/;
const surfaceNames = /^(Streets|Sidewalks|Paths|Rivers|Route road|Route shoulder|Sea$|Lakes?\b)|water$/;
const skipNames = /(Glows|lights|Light$|beacons|Clouds|clouds|Sky)/i;

const visible = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
const named = (o) => { for (let x = o; x; x = x.parent) if (x.name && !x.isScene) return x.name; return ''; };

function classify(o) {
  if (o.isSprite || o.isPoints || o.isLine) return null;
  if (!o.isMesh || !visible(o) || o === world.sky) return null;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (mats.every((m) => m.transparent && !m.depthWrite)) return null;          // glows, pools, wakes, decals
  if (skipNames.test(o.name)) return null;
  if (o.userData.qcRider || o.userData.pooled) return null;   // pooled ground/plants: QC reads their tile stand-ins
  if (o.userData.standIn) return null;   // a far stand-in for objects QC checks themselves (crowd cards for the crowd)
  if (o.isInstancedMesh) return lifeNames.test(o.name) ? 'life' : 'instances';
  if (o.material === world.terrain.groundMaterial) return 'ground';
  if (surfaceNames.test(named(o))) return 'surface';
  return 'solid';
}

let assetNames = new Map();   // scenery-kit geometry → asset name (trees, rocks, shrubs scattered by the stylized terrain)
function labelOf(o) {
  if (o.name) return o.name.replace(/ -?\d+,-?\d+$/, '');
  if (assetNames.has(o.geometry)) return `Scenery: ${assetNames.get(o.geometry)}`;
  if (o.isInstancedMesh) return o.geometry.attributes.position.count < 400 ? 'Lamp posts' : 'Instances';
  for (const [, meshes] of city?.chunks || []) if (meshes.includes(o)) return 'Rooftops';
  const n = named(o.parent);
  return n || 'Unnamed mesh';
}

function ensureBVH(geometry) {
  if (!geometry.boundsTree) geometry.boundsTree = new MeshBVH(geometry, { maxLeafSize: 12 });
  return geometry.boundsTree;
}

function addToGrid(e) {
  const b = e.box;
  for (let x = Math.floor(b.min.x / CELL); x <= Math.floor(b.max.x / CELL); x++) for (let z = Math.floor(b.min.z / CELL); z <= Math.floor(b.max.z / CELL); z++) {
    const k = `${x},${z}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e);
  }
}
function near(box, filter) {
  const seen = new Set(), out = [];
  for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++) for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) {
    for (const g of [grid, streamGrid]) for (const e of g.get(`${x},${z}`) || []) if (!seen.has(e) && (!filter || filter(e)) && e.box.intersectsBox(box)) { seen.add(e); out.push(e); }
  }
  return out;
}

/** The stylized terrain scatters vegetation and rocks around the camera as it moves: stream them in at (x, z). */
function streamAt(x, z) {
  world.terrain.update(x, z);
  world.terrain.group.updateMatrixWorld(true);
  const now = new Set();
  for (const g of world.terrain.streamedGroups?.() || []) g.traverse((o) => { if (o.isInstancedMesh) now.add(o); });
  if ([...now].every((o) => streamed.has(o)) && now.size === streamed.size) return;
  const fresh = [...now].filter((o) => !streamed.has(o));
  streamed = now; streamGrid = new Map();
  const m = new THREE.Matrix4();
  for (const o of now) {
    if (classify(o) !== 'instances') continue;
    const geo = o.geometry; if (!geo.boundingBox) geo.computeBoundingBox();
    const bvh = ensureBVH(geo), label = labelOf(o);
    if (/shadow|grass|fern|flowers|poppy|lupine/i.test(label)) continue;   // flat decals and ground cover
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); m.premultiply(o.matrixWorld);
      const box = geo.boundingBox.clone().applyMatrix4(m);
      const e = { kind: 'solid', instance: true, streamed: true, mesh: o, i, matrix: m.clone(), inv: m.clone().invert(), bvh, box, label };
      if (F && fresh.includes(o) && city) {
        const b = V().setFromMatrixPosition(m), on = surfaceUnder(b.x, b.y, b.z, .8), s = routeS(b.x, b.z, LIMITS.staticRange);
        if (on && s != null) F.add({ check: 'scenery-on-street', severity: 'warn', s, label: `${label} on ${on}`, value: 0, point: pt(b), note: `scattered ${label.replace('Scenery: ', '')} placed on a ${on.toLowerCase().replace(/s$/, '')}` }, 0);
      }
      for (let gx = Math.floor(box.min.x / CELL); gx <= Math.floor(box.max.x / CELL); gx++) for (let gz = Math.floor(box.min.z / CELL); gz <= Math.floor(box.max.z / CELL); gz++) {
        const k = `${gx},${gz}`; if (!streamGrid.has(k)) streamGrid.set(k, []); streamGrid.get(k).push(e);
      }
    }
  }
}

/** Index every static mesh (and each static instance) in the scene. Ground patches are handled separately (they stream). */
function indexScene() {
  entries = []; grid = new Map();
  world.scene.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), inv = new THREE.Matrix4();
  world.scene.traverse((o) => {
    if (!o.visible && o !== world.scene) return;
    const kind = classify(o);
    if (!kind || kind === 'ground' || kind === 'life') return;
    const geo = o.geometry; if (!geo.attributes.position?.count) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bvh = ensureBVH(geo);
    if (kind === 'instances') {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld);
        const box = geo.boundingBox.clone().applyMatrix4(m);
        if (!Number.isFinite(box.min.x) || box.isEmpty()) continue;
        const e = { kind: 'solid', instance: true, mesh: o, i, matrix: m.clone(), inv: inv.copy(m).invert().clone(), bvh, box, label: labelOf(o) };
        entries.push(e); addToGrid(e);
      }
      return;
    }
    const e = { kind, mesh: o, matrix: o.matrixWorld.clone(), inv: o.matrixWorld.clone().invert(), bvh, box: geo.boundingBox.clone().applyMatrix4(o.matrixWorld), label: labelOf(o),
      offset: (Array.isArray(o.material) ? o.material[0] : o.material).polygonOffset ? (Array.isArray(o.material) ? o.material[0] : o.material).polygonOffsetFactor : 0 };
    entries.push(e); addToGrid(e);
  });
}

function indexBuildings() {
  buildingGrid = new Map();
  if (!city) return;
  for (const b of city.buildings) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of b.ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    b.qbb = { x0, x1, z0, z1 };
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
      const k = `${x},${z}`; if (!buildingGrid.has(k)) buildingGrid.set(k, []); buildingGrid.get(k).push(b);
    }
  }
}
function inRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function buildingAt(x, z, pad = 2) {
  let best = null, bd = Infinity;
  for (const b of buildingGrid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) || []) {
    if (x < b.qbb.x0 - pad || x > b.qbb.x1 + pad || z < b.qbb.z0 - pad || z > b.qbb.z1 + pad) continue;
    if (inRing(b.ring, x, z)) return b;
    for (let i = 0; i < b.ring.length; i++) {
      const a = b.ring[i], c = b.ring[(i + 1) % b.ring.length], dx = c.x - a.x, dz = c.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d < bd) { bd = d; best = b; }
    }
  }
  return bd <= pad ? best : null;
}
const describeBuilding = (b) => b ? `${b.name || `building #${b.k}`} (${b.h.toFixed(0)} m)` : '';

function routeS(x, z, r = 400) {
  const hit = world.index.nearest(x, z, r);
  return hit ? route.dist[hit.i] : null;
}
const round = (v, k = 2) => Number(v.toFixed(k));
const pt = (p) => [round(p.x, 1), round(p.y, 1), round(p.z, 1)];

// ---------------------------------------------------------------- geometry tests
const _box = new THREE.Box3(), _m = new THREE.Matrix4(), _sphere = new THREE.Sphere(), _ray = new THREE.Ray(), _p = V();

/** Oriented box (centre, right/up/forward axes, half sizes) as a Box3 + matrix. */
function obb(center, right, up, fwd, half) {
  const matrix = new THREE.Matrix4().makeBasis(right, up, fwd).setPosition(center);
  const box = new THREE.Box3(V(-half[0], -half[1], -half[2]), V(half[0], half[1], half[2]));
  const world = box.clone().applyMatrix4(matrix);
  return { matrix, box, world, center, right, up, fwd, half };
}
function hitsOBB(e, o) {
  _m.multiplyMatrices(e.inv, o.matrix);
  return e.bvh.intersectsBox(o.box, _m);
}
function closestTo(e, point) {
  const local = point.clone().applyMatrix4(e.inv);
  const r = e.bvh.closestPointToPoint(local);
  return r ? { point: r.point.clone().applyMatrix4(e.matrix), distance: r.distance } : null;
}
/** 2-D (top-down) rectangle overlap by separating axes, plus vertical overlap. */
function obbOverlap(a, b) {
  if (a.world.max.y < b.world.min.y || b.world.max.y < a.world.min.y) return false;
  const axes = [[a.right.x, a.right.z], [a.fwd.x, a.fwd.z], [b.right.x, b.right.z], [b.fwd.x, b.fwd.z]];
  const dx = b.center.x - a.center.x, dz = b.center.z - a.center.z;
  for (const [ax, az] of axes) {
    const l = Math.hypot(ax, az) || 1, nx = ax / l, nz = az / l;
    const ra = Math.abs(a.right.x * nx + a.right.z * nz) * a.half[0] + Math.abs(a.fwd.x * nx + a.fwd.z * nz) * a.half[2];
    const rb = Math.abs(b.right.x * nx + b.right.z * nz) * b.half[0] + Math.abs(b.fwd.x * nx + b.fwd.z * nz) * b.half[2];
    if (Math.abs(dx * nx + dz * nz) > ra + rb) return false;
  }
  return true;
}

/** The street/sidewalk/path surface right under (x, z) within `dy` of y, or null. */
function surfaceUnder(x, y, z, dy = 1) {
  const probe = new THREE.Box3(V(x - .05, y - dy, z - .05), V(x + .05, y + dy, z + .05));
  for (const o of near(probe, (q) => q.kind === 'surface' && /^(Streets|Sidewalks|Paths)/.test(q.label))) {
    _ray.set(V(x, y + dy, z).applyMatrix4(o.inv), V(0, -1, 0).transformDirection(o.inv));
    const h = o.bvh.raycastFirst(_ray, THREE.DoubleSide);
    if (h && Math.abs(h.point.clone().applyMatrix4(o.matrix).y - y) <= dy) return o.label;
  }
  return null;
}

// ---------------------------------------------------------------- loading
export async function load(park, quality = 'balanced') {
  const catalog = await (await fetch('../routes/parks/index.json')).json();
  const item = catalog.find((p) => p.id === park);
  if (!item) throw new Error(`Unknown route: ${park}`);
  route = buildCatalogRoute(await (await fetch(`../${item.file}`)).text(), item);
  await loadRouteScene(route);
  world = new World(document.getElementById('view'), route, { quality, log: () => {} });
  world._realRender = world.renderer.render.bind(world.renderer);
  world.renderer.render = () => {};                       // analysis needs the scene, not pixels
  world.setSource(() => ({ pos: world.s, speed: 0, cadence: 0, riding: true }));
  world.renderOnce();
  await world.terrain.ready;
  world.renderOnce();
  city = world.terrain.city || null;
  landscape = world.terrain.landscape;
  if (city) while (city._pending.length) city._buildChunk(city._pending.pop());   // every building, not just nearby
  city?.streetKit?.flush();   // [street-kit] its chunk work is deferred while the app streams
  city?.streetKit?.meshes.forEach((m) => { m.visible = true; });   // [finish] every kit mesh, whatever its LOD band from where the camera starts
  if (world.road) world.road.name ||= 'Route road';
  if (world.shoulder) world.shoulder.name ||= 'Route shoulder';
  world.rider?.group?.traverse((o) => { o.userData.qcRider = true; });
  world.pacer?.group?.traverse?.((o) => { o.userData.qcRider = true; });
  world.terrain.landmarkMeshes?.forEach((m) => { m.name ||= 'Landmark'; });
  if (world.terrain.roadside) world.terrain.roadside.traverse((o) => { if (o.isMesh) o.name ||= 'Roadside rails'; });
  for (const [name, a] of Object.entries(world.terrain.kit?.assets || {})) if (a.geometry) assetNames.set(a.geometry, name);
  indexScene(); indexBuildings();
  window.world = world;
  return { name: route.scene?.title || route.name, total: route.total, oneWay: route.turnS || route.total, city: !!city,
    buildings: city?.buildings.length || 0, meshes: entries.filter((e) => !e.instance).length, instances: entries.filter((e) => e.instance).length,
    triangles: entries.filter((e) => !e.instance).reduce((n, e) => n + (e.mesh.geometry.index ? e.mesh.geometry.index.count : e.mesh.geometry.attributes.position.count) / 3, 0) };
}

// ---------------------------------------------------------------- 1. rider and camera along the ride
function checkRide() {
  const L = LIMITS, solidish = (e) => e.kind === 'solid' || (e.kind === 'surface' && !/^Route /.test(e.label));
  let lastStream = -1e9;
  for (let s = 0; s < route.total; s += L.step) {
    const pose = riderPose(route, world.index, s);
    const fwd = V(pose.flat.x, 0, pose.flat.z), right = V(-fwd.z, 0, fwd.x);
    const pos = V(pose.pos.x, pose.pos.y, pose.pos.z);
    if (Math.abs(s - lastStream) > 100) { streamAt(pos.x, pos.z); lastStream = s; }
    const body = obb(pos.clone().addScaledVector(UP, L.body.lift), right, UP, fwd, L.body.half);
    for (const e of near(body.world, solidish)) {
      if (!hitsOBB(e, body)) continue;
      const c = closestTo(e, body.center);
      const b = e.label === 'Buildings' && c ? buildingAt(c.point.x, c.point.z) : null;
      F.add({ check: e.kind === 'surface' ? 'surface-in-rider' : 'rider-clips', severity: 'fail', s, label: e.label,
        value: c ? round(Math.max(0, L.body.half[0] + .3 - c.distance), 2) : 0, point: pt(c?.point || body.center), extra: describeBuilding(b),
        note: e.kind === 'surface' ? 'another street/path surface cuts through the rider' : `the rider rides through ${e.label.toLowerCase()}` });
    }
    // chase camera (world._updateCamera, CHASE in pose.js): behind and up, kept above the ground
    const cam = pos.clone().addScaledVector(fwd, -CHASE.back).addScaledVector(UP, CHASE.up);
    const g = world.terrain.heightAt(cam.x, cam.z); if (g != null && cam.y < g + CHASE.ground) cam.y = g + CHASE.ground;
    _sphere.set(cam, L.cameraRadius);
    let camInside = false;
    const camBox = new THREE.Box3().setFromCenterAndSize(cam, V(1, 1, 1));
    for (const e of near(camBox, (x) => x.kind !== 'ground')) {
      _sphere.center.copy(cam).applyMatrix4(e.inv);
      if (e.bvh.intersectsSphere(_sphere)) {
        const b = e.label === 'Buildings' ? buildingAt(cam.x, cam.z) : null;
        const minor = /^(Buildings|Rooftops|Street trees|Lamp posts|Scenery)/.test(e.label);   // single-sided: it just vanishes
        F.add({ check: 'camera-inside', severity: minor ? 'warn' : 'fail', s, label: e.label, value: 0, point: pt(cam), extra: describeBuilding(b), note: minor ? 'chase camera inside it (it pops out of view)' : 'chase camera inside geometry (the screen fills with it)' });
        camInside = true;
      }
    }
    const target = pos.clone().addScaledVector(UP, 1.0), dir = target.clone().sub(cam), len = dir.length(); dir.normalize();
    const segBox = new THREE.Box3().setFromPoints([cam, target]).expandByScalar(.5);
    if (!camInside) for (const e of near(segBox, (x) => x.kind === 'solid')) {
      _ray.set(cam.clone().applyMatrix4(e.inv), dir.clone().transformDirection(e.inv));
      const scale = V().setFromMatrixScale(e.inv).x || 1;
      const hit = e.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len * scale);
      if (hit && hit.distance / scale < len - .6) {
        const hp = hit.point.clone().applyMatrix4(e.matrix);
        F.add({ check: 'view-blocked', severity: 'warn', s, label: e.label, value: round(len - hit.distance / scale, 1), point: pt(hp),
          extra: describeBuilding(e.label === 'Buildings' ? buildingAt(hp.x, hp.z) : null), note: 'something between the chase camera and the rider' });
      }
    }
  }
  F.close();
}

// ---------------------------------------------------------------- 2. static objects against each other
function checkStatics() {
  // 2a. street trees and lamp posts inside solids (trunk/pole only: the lower 3 m, a narrow core)
  for (const e of entries.filter((x) => x.instance)) {
    const s = routeS(e.matrix.elements[12], e.matrix.elements[14], LIMITS.staticRange);
    if (s == null) continue;
    const base = V().setFromMatrixPosition(e.matrix);
    const r = e.label === 'Lamp posts' ? .1 : e.label === 'Street trees' ? .16 : .18;   // post / trunk radius
    const core = obb(base.clone().addScaledVector(UP, 1.8), V(1, 0, 0), UP, V(0, 0, 1), [r, 1.4, r]);
    for (const o of near(core.world, (x) => x.kind === 'solid' && !x.instance)) {
      if (e.label === 'Sign support' && o.mesh?.userData.sign) continue;   // a sign on its own posts
      if (!hitsOBB(o, core)) continue;
      F.add({ check: e.label === 'Street trees' ? 'tree-in-solid' : 'post-in-solid', severity: 'warn', s, label: `${e.label} ↔ ${o.label}`, value: 0, point: pt(base),
        extra: describeBuilding(o.label === 'Buildings' ? buildingAt(base.x, base.z) : null), note: `${e.label.toLowerCase()} standing inside ${o.label.toLowerCase()}` }, 0);
    }
    // standing on the ground? (not floating, not sunk)
    if (e.label === 'Street trees' || e.label === 'Lamp posts') {
      // what it stands on: the ground, a street/sidewalk/path, or a bridge deck — whichever is nearest below its foot
      let support = world.terrain.heightAt(base.x, base.z) ?? -Infinity;
      const probe = new THREE.Box3(V(base.x - .05, base.y - 20, base.z - .05), V(base.x + .05, base.y + 1.5, base.z + .05));
      for (const o of near(probe, (x) => !x.instance && (x.kind === 'surface' || /^(Bridges|Stadiums|Landmark)/.test(x.label)))) {
        _ray.set(V(base.x, base.y + 1.5, base.z).applyMatrix4(o.inv), V(0, -1, 0).transformDirection(o.inv));
        const h = o.bvh.raycastFirst(_ray, THREE.DoubleSide);
        if (h) support = Math.max(support, h.point.clone().applyMatrix4(o.matrix).y);
      }
      const gap = base.y - support;
      if (surfaceUnder(base.x, base.y, base.z, .6) === 'Streets') F.add({ check: 'post-in-street', severity: 'warn', s, label: e.label, value: 0, point: pt(base), note: `${e.label.toLowerCase().replace(/s$/, '')} standing in a street's carriageway (traffic drives through it)` }, 0);
      if (Number.isFinite(support) && gap > .6) F.add({ check: 'floating', severity: 'warn', s, label: e.label, value: round(gap, 2), point: pt(base), note: 'floating above what it stands on' }, 0);
      else if (Number.isFinite(support) && gap < -.6) F.add({ check: 'sunk', severity: 'info', s, label: e.label, value: round(gap, 2), point: pt(base), note: 'foot buried in the street/sidewalk/ground it stands on' }, 0);
    }
  }
  F.close();
  if (!city) return;
  // 2b. overlapping building footprints (OSM outlines + parts drawn twice → walls and roofs fight)
  const owner = new Map(), pairs = new Map(), A = 1;   // 1 m raster
  for (const b of city.buildings) {
    if (b.kind === 12 || b.hidden || b.hero || b.onRoute || b.crossed) continue;   // only what's drawn
    const r = world.index.nearest((b.qbb.x0 + b.qbb.x1) / 2, (b.qbb.z0 + b.qbb.z1) / 2, LIMITS.staticRange);
    if (!r) continue;                                   // only what you can see from the ride
    for (let x = Math.floor(b.qbb.x0) + .5; x < b.qbb.x1; x += A) for (let z = Math.floor(b.qbb.z0) + .5; z < b.qbb.z1; z += A) {
      if (!inRing(b.ring, x, z)) continue;
      const k = `${Math.floor(x)},${Math.floor(z)}`, o = owner.get(k);
      if (o === undefined) { owner.set(k, b.k); continue; }
      const key = o < b.k ? `${o}|${b.k}` : `${b.k}|${o}`;
      const p = pairs.get(key) || { a: Math.min(o, b.k), b: Math.max(o, b.k), area: 0, x, z };
      p.area += A * A; pairs.set(key, p);
    }
  }
  for (const p of pairs.values()) {
    if (p.area < LIMITS.overlapM2) continue;
    const a = city.buildings[p.a], b = city.buildings[p.b];
    const sameTop = Math.abs(a.h - b.h) < .3 && Math.abs(a.mh - b.mh) < .3;
    F.add({ check: 'buildings-overlap', severity: sameTop ? 'warn' : 'info', s: routeS(p.x, p.z), label: 'Buildings', value: Math.round(p.area), point: [round(p.x, 1), null, round(p.z, 1)],
      extra: `${describeBuilding(a)} + ${describeBuilding(b)}`, note: sameTop ? 'two buildings drawn in the same place at the same height: roofs and walls flicker' : 'building parts overlap (taller part rises through the other)' }, 0);
  }
  F.close();
  // 2c. structures cutting through buildings (triangle against triangle)
  const builds = entries.filter((e) => !e.instance && e.label === 'Buildings');
  for (const e of entries.filter((x) => !x.instance && x.kind === 'solid' && /^(Bridges|Stadiums|Inclines|Rail tracks|Landmark|USS Requin)/.test(x.label))) {
    for (const b of builds) {
      if (!e.box.intersectsBox(b.box)) continue;
      const pts = [];
      _m.multiplyMatrices(e.inv, b.matrix);
      const line = new THREE.Line3();
      e.bvh.bvhcast(b.bvh, _m, { intersectsTriangles(t1, t2) { if (t1.intersectsTriangle(t2, line)) { pts.push(line.getCenter(V()).applyMatrix4(e.matrix)); if (pts.length > 4000) return true; } return false; } });
      // cluster within 20 m
      const clusters = [];
      for (const p of pts) { const c = clusters.find((k) => k.p.distanceTo(p) < 20); if (c) c.n++; else clusters.push({ p, n: 1 }); }
      for (const c of clusters) {
        const bl = buildingAt(c.p.x, c.p.z, 4);
        const sAt = routeS(c.p.x, c.p.z, LIMITS.staticRange); if (sAt == null) continue;
        F.add({ check: 'structure-through-building', severity: 'warn', s: sAt, label: `${e.label} ↔ Buildings`, value: c.n, point: pt(c.p), extra: describeBuilding(bl), note: `${e.label.toLowerCase()} cut through a building` }, 0);
      }
    }
  }
  F.close();
}

// ---------------------------------------------------------------- 3. surfaces beside the route
/** Is the point in plain view of the chase camera somewhere on the approach (either way on a there-and-back)? */
function seenFromRide(s, target, ground) {
  const L = LIMITS, turn = route.turnS, views = [];
  for (const d of L.seenBack) {
    views.push(s - d);
    if (turn) views.push(route.total - s - d);   // the return ride passes the same spot
  }
  for (const v of views) {
    if (v < 0 || v > route.total) continue;
    const pose = riderPose(route, world.index, v);
    const fwd = V(pose.flat.x, 0, pose.flat.z);
    const cam = V(pose.pos.x, pose.pos.y, pose.pos.z).addScaledVector(fwd, -6.5).addScaledVector(UP, 2.7);
    const g = world.terrain.heightAt(cam.x, cam.z); if (g != null && cam.y < g + 1.6) cam.y = g + 1.6;
    const dir = target.clone().sub(cam), len = dir.length() - .4; dir.normalize();
    if (len > L.staticRange) continue;
    if (dir.dot(fwd) < .2) continue;   // behind the camera, or far off to the side: out of the frame
    const box = new THREE.Box3().setFromPoints([cam, target]).expandByScalar(.2);
    let blocked = false;
    for (const e of [...near(box, (q) => !q.instance && (q.kind === 'solid' || q.kind === 'surface')), ...ground.filter((q) => q.box.intersectsBox(box))]) {
      _ray.set(cam.clone().applyMatrix4(e.inv), dir.clone().transformDirection(e.inv));
      const scale = V().setFromMatrixScale(e.inv).x || 1;
      if (e.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len * scale)) { blocked = true; break; }
    }
    if (!blocked) return true;
  }
  return false;
}

function checkSurfaces() {
  const L = LIMITS, end = route.turnS || route.total;
  const groundBVH = new Map();
  const groundEntries = () => {
    const out = [];
    for (const mesh of world.terrain.patches.values()) {
      if (!groundBVH.has(mesh)) { mesh.geometry.computeBoundingBox(); groundBVH.set(mesh, { kind: 'ground', mesh, bvh: ensureBVH(mesh.geometry), matrix: mesh.matrixWorld, inv: mesh.matrixWorld.clone().invert(), box: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld), label: 'Ground', offset: 0 }); }
      out.push(groundBVH.get(mesh));
    }
    return out;
  };
  let lastUpdate = -1e9, ground = [];
  for (let s = 0; s < end; s += 4) {
    const pose = riderPose(route, world.index, s);
    if (s - lastUpdate > 60) { world.terrain.update(pose.pos.x, pose.pos.z); world.scene.updateMatrixWorld(); ground = groundEntries(); lastUpdate = s; }
    const fwd = V(pose.flat.x, 0, pose.flat.z), right = V(-fwd.z, 0, fwd.x);
    for (let off = -L.corridor; off <= L.corridor; off += 3) {
      const x = pose.centre.x + right.x * off, z = pose.centre.z + right.z * off;
      const top = pose.centre.y + 60, box = new THREE.Box3(V(x - .1, -1e4, z - .1), V(x + .1, 1e4, z + .1));
      const hits = [];
      for (const e of [...near(box, (q) => q.kind === 'surface'), ...ground.filter((q) => q.box.intersectsBox(box))]) {
        _ray.set(V(x, top, z).applyMatrix4(e.inv), V(0, -1, 0).transformDirection(e.inv));
        for (const h of e.bvh.raycast(_ray, THREE.DoubleSide)) hits.push({ y: h.point.clone().applyMatrix4(e.matrix).y, e, face: h.faceIndex, n: h.face.normal.clone().transformDirection(e.matrix) });
      }
      hits.sort((a, b) => b.y - a.y);
      // z-fighting: two different surfaces (or two ribbons of one mesh) almost coplanar with the same depth offset
      for (let i = 0; i + 1 < hits.length; i++) {
        const a = hits[i], b = hits[i + 1];
        if (a.e === b.e && Math.abs(a.face - b.face) <= 1) continue;          // the same strip (shared edge)
        if (a.e.label === 'Ground' && b.e.label === 'Ground') continue;        // overlapping patch skirts
        if ((a.e.offset || 0) !== (b.e.offset || 0)) continue;
        // streets settle overlaps in the depth test by their height slot (aSlot): different slots never flicker
        const slotOf = (h) => { const g = h.e.mesh.geometry, at = g.attributes.aSlot; return at && h.e.mesh.material.userData?.slotDepthBias ? at.getX(g.index ? g.index.getX(h.face * 3) : h.face * 3) : null; };
        { const sa = slotOf(a), sb = slotOf(b); if (sa != null && sb != null && sa !== sb) continue; }
        const ma = a.e.mesh.material, mb = b.e.mesh.material;
        if (ma === mb && !ma.map && !ma.vertexColors) continue;   // one flat colour: nothing to see flicker
        // two surfaces that cross (a bank running down into the water, a ramp through a flat deck) meet in a crisp
        // line, not a flicker: they stay within `zfight` of each other only for a few centimetres. Coplanar means
        // near-parallel too: within `zfight` of each other across a band at least `zfightSpan` wide.
        if (a.n.clone().cross(b.n).length() > 2 * L.zfight / L.zfightSpan) continue;
        if (a.y - b.y < L.zfight) F.add({ check: 'z-fight', severity: 'warn', s, label: a.e === b.e ? `${a.e.label} (overlapping ribbons)` : `${a.e.label} ↔ ${b.e.label}`, value: round(a.y - b.y, 4), point: [round(x, 1), round(a.y, 2), round(z, 1)], note: 'coplanar surfaces: they flicker as you move' }, 40);
      }
      // ground drawn over a street, path or sidewalk (it disappears under the grass); a lake's water running on
      // under its shore is hidden by design
      const gTop = hits.find((h) => h.e.label === 'Ground');
      const covered = hits.find((h) => h.e.kind === 'surface' && !/^(Route |Rivers|Sea$|Lake$)|water$/.test(h.e.label) && gTop && gTop.y - h.y > L.groundOverStreet && gTop.y - h.y < 3);
      const hidden = gTop && hits.slice(0, hits.indexOf(gTop)).some((h) => h.e.kind === 'surface' && h.y - gTop.y < 1.5);   // [street-kit] the ground is itself under a slab or the road here: nothing it covers can show
      if (gTop && covered && !hidden && hits.indexOf(gTop) < hits.indexOf(covered)) {
        // can the ride see it? Under the route's own deck, beneath an overpass or behind a wall the covered strip
        // never shows: reported as info only
        const seen = seenFromRide(s, V(x, gTop.y + .05, z), ground);
        F.add({ check: seen ? 'ground-over-street' : 'ground-over-street-hidden', severity: seen ? 'warn' : 'info', s, label: covered.e.label, value: round(gTop.y - covered.y, 2), point: [round(x, 1), round(covered.y, 2), round(z, 1)],
          note: seen ? 'the ground covers part of a street/path beside the route' : 'the ground covers part of a street/path, out of sight of the ride (under a deck or behind something solid)' }, 40);
      }
    }
  }
  F.close();
}

// ---------------------------------------------------------------- 4. a simulated ride with the city's life
function checkLife(seconds) {
  const L = LIMITS, life = city?.life, dt = .1;
  const meshes = [];
  (city?.group || world.terrain.group).traverse((o) => { if (o.isInstancedMesh && lifeNames.test(o.name)) { o.geometry.computeBoundingBox(); meshes.push(o); } });
  if (!meshes.length) return { simulated: 0 };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(), p = V();
  const group = (name) => /^(Cars|Buses|Traffic · )/.test(name) ? 'vehicle' : /^Birds · /.test(name) ? 'bird' : /^(Light rail|Locomotives|Freight cars|Incline cars)/.test(name) ? 'train' : /^Boats/.test(name) ? 'boat' : 'person';
  const total = Math.min(seconds ?? route.total / L.lifeSpeed, route.total / L.lifeSpeed);
  let t = 0, s = 0, next = 0;
  const level = landscape.level ?? landscape.data?.waterLevelM;
  while (t < total) {
    const pose = riderPose(route, world.index, s);
    const fwd = V(pose.flat.x, 0, pose.flat.z);
    const cam = V(pose.pos.x, pose.pos.y, pose.pos.z).addScaledVector(fwd, -CHASE.back).addScaledVector(UP, CHASE.up);
    const back = route.turnS && s > route.turnS;
    world.terrain.tick(cam, dt, { x: pose.pos.x, z: pose.pos.z, out: back ? route.total - s : s, dir: back ? -1 : 1, speed: L.lifeSpeed });
    world.terrain.uniforms.uTime.value += dt;
    t += dt; s = (s + L.lifeSpeed * dt) % route.total;
    if (t < next) continue;
    next = t + L.lifeSeconds;
    const right = V(-fwd.z, 0, fwd.x), riderPos = V(pose.pos.x, pose.pos.y, pose.pos.z);
    const rider = obb(riderPos.clone().addScaledVector(UP, L.body.lift), right, UP, fwd, [L.body.half[0], L.body.half[1], L.body.half[2]]);
    const movers = [];
    for (const im of meshes) {
      const bb = im.geometry.boundingBox, g = group(im.name);
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m); m.premultiply(im.matrixWorld); m.decompose(p, q, sc);
        if (sc.x < 1e-3 || p.distanceTo(riderPos) > L.lifeRadius) continue;
        const f = V(0, 0, 1).applyQuaternion(q); f.y = 0; f.normalize(); const r = V(-f.z, 0, f.x);
        const size = bb.getSize(V()).multiply(sc), cl = bb.getCenter(V()).multiply(sc);
        const center = p.clone().addScaledVector(r, -cl.x).addScaledVector(UP, cl.y).addScaledVector(f, cl.z);
        movers.push({ im, i, g, label: im.name, p: p.clone(), o: obb(center, r, UP, f, [size.x / 2, size.y / 2, size.z / 2]) });
      }
    }
    for (const a of movers) {
      // through the rider
      if (a.g !== 'boat' && obbOverlap(a.o, rider)) F.add({ check: `${a.g === 'train' ? 'vehicle' : a.g}-through-rider`, severity: a.g === 'vehicle' || a.g === 'train' ? 'fail' : 'warn', s, label: a.label, value: round(t, 1), point: pt(a.p), note: `${a.label.toLowerCase()} passes through the rider` }, 30);
      // through buildings and structures (lifted off the road so wheels/feet don't count)
      const shrink = obb(a.o.center.clone().addScaledVector(UP, .2), a.o.right, UP, a.o.fwd, [a.o.half[0] * .85, Math.max(.1, a.o.half[1] - .3), a.o.half[2] * .9]);
      for (const e of near(shrink.world, (x) => x.kind === 'solid')) {
        if (a.g === 'train' && /^(Rail tracks|Inclines|Bridges)/.test(e.label)) continue;
        if (a.g === 'boat' && e.label !== 'Bridges') continue;
        if (!hitsOBB(e, shrink)) continue;
        // background life brushing past posts and trees is accepted (info); vehicles into buildings/bridges are not
        const background = a.g === 'person' || (a.g !== 'boat' && /^(Lamp posts|Street trees|Scenery)/.test(e.label));
        F.add({ check: a.g === 'boat' ? 'boat-clips-bridge' : `${a.g}-clips-solid`, severity: background ? 'info' : 'warn', s, label: `${a.label} ↔ ${e.label}`, value: round(t, 1), point: pt(a.p),
          extra: describeBuilding(e.label === 'Buildings' ? buildingAt(a.p.x, a.p.z) : null), note: `${a.label.toLowerCase()} pass through ${e.label.toLowerCase()}` }, 60);
      }
      if (a.g === 'boat' && level != null) {
        for (const k of [-1, 0, 1]) {
          const q2 = a.o.center.clone().addScaledVector(a.o.fwd, k * a.o.half[2] * .9);
          const gh = world.terrain.heightAt(q2.x, q2.z);
          if (gh != null && gh > level + .3) { F.add({ check: 'boat-on-land', severity: 'warn', s, label: a.label, value: round(gh - level, 1), point: pt(q2), note: 'boat hull over land' }, 60); break; }
        }
      }
      if ((a.g === 'vehicle' || a.g === 'person') && level != null && a.p.y < level + .3 && world.terrain.heightAt(a.p.x, a.p.z) < level) F.add({ check: `${a.g}-in-water`, severity: 'warn', s, label: a.label, value: round(a.p.y - level, 2), point: pt(a.p), note: 'in the river' }, 60);
    }
    // vehicles through vehicles
    const vs = movers.filter((x) => x.g === 'vehicle' || x.g === 'train');
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j];
      if (a.g === 'train' && b.g === 'train' && a.label !== b.label) continue;     // coupled consists
      if (a.label === b.label && a.g === 'train') continue;
      if (a.p.distanceToSquared(b.p) > 900) continue;
      const sa = obb(a.o.center, a.o.right, UP, a.o.fwd, [a.o.half[0] * .9, a.o.half[1], a.o.half[2] * .9]);
      const sb = obb(b.o.center, b.o.right, UP, b.o.fwd, [b.o.half[0] * .9, b.o.half[1], b.o.half[2] * .9]);
      if (obbOverlap(sa, sb)) F.add({ check: 'vehicles-overlap', severity: 'info', s, label: `${a.label} ↔ ${b.label}`, value: round(t, 1), point: pt(a.p), note: 'two vehicles drawn through each other' }, 60);
    }
  }
  F.close();
  return { simulated: round(t, 0) };
}

// ---------------------------------------------------------------- run + screenshots
export async function run(opts = {}) {
  F = new Findings();
  const timing = {};
  let t0 = performance.now();
  checkRide(); timing.ride = round((performance.now() - t0) / 1000, 1); t0 = performance.now();
  checkStatics(); timing.statics = round((performance.now() - t0) / 1000, 1); t0 = performance.now();
  checkSurfaces(); timing.surfaces = round((performance.now() - t0) / 1000, 1); t0 = performance.now();
  const life = opts.life === false ? { simulated: 0 } : checkLife(opts.lifeSeconds); timing.life = round((performance.now() - t0) / 1000, 1);
  // A there-and-back ride passes each spot twice: report it once, at its one-way distance, noting both directions.
  const turn = route.turnS, oneWay = (x) => (x == null || !turn ? x : x <= turn ? x : route.total - x);
  const merged = [];
  const groups = new Map();
  for (const f of F.list) {
    const a = oneWay(f.from), b = oneWay(f.to);
    const g = { ...f, from: a == null ? null : Math.min(a, b), to: a == null ? null : Math.max(a, b), at: oneWay(f.at), atRide: f.at, dirs: new Set([f.from == null || !turn ? 'both' : f.from <= turn ? 'out' : 'back']) };
    const key = `${f.check}|${f.label}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  for (const list of groups.values()) {
    list.sort((x, y) => (x.from ?? -1) - (y.from ?? -1));
    for (const g of list) {
      const last = merged.length && merged[merged.length - 1];
      if (last && last.check === g.check && last.label === g.label && g.from != null && last.to != null && g.from - last.to <= 25 && (g.check !== 'buildings-overlap')) {
        last.to = Math.max(last.to, g.to); last.count += g.count; g.dirs.forEach((d) => last.dirs.add(d));
        if (Math.abs(g.value ?? 0) > Math.abs(last.value ?? 0)) { last.value = g.value; last.at = g.at; last.atRide = g.atRide; last.point = g.point; last.extra = g.extra || last.extra; }
      } else merged.push(g);
    }
  }
  for (const g of merged) g.dirs = g.dirs.has('both') || (g.dirs.has('out') && g.dirs.has('back')) ? 'both ways' : g.dirs.has('out') ? 'outbound' : 'return';
  F.list = merged;
  const rank = { fail: 0, warn: 1, info: 2 };
  F.list.sort((a, b) => rank[a.severity] - rank[b.severity] || a.check.localeCompare(b.check) || (a.at ?? 0) - (b.at ?? 0));
  return { findings: F.list, timing, life, limits: LIMITS, oneWay: turn || route.total };
}

/** A picture of a finding: the rider's own view for ride checks, otherwise a close camera aimed at the spot. */
export async function shot(f, w = 640, h = 384) {
  world.renderer.render = world._realRender;
  world.renderer.setPixelRatio(1); world.renderer.setSize(w, h, false); world.camera.aspect = w / h; world.camera.updateProjectionMatrix();
  const riderView = /^(rider-clips|surface-in-rider|camera-inside|view-blocked|vehicle-through-rider|person-through-rider)$/.test(f.check);
  const s = f.atRide ?? f.at ?? 0;
  world.s = s; world._camInit = false;
  for (let k = 0; k < 4; k++) world.renderOnce();
  if (!riderView && f.point) {
    const [x, y0, z] = f.point, y = y0 ?? (world.terrain.heightAt(x, z) ?? 0);
    const target = V(x, y + 1, z);
    const pose = riderPose(route, world.index, s);
    const away = V(pose.flat.x, 0, pose.flat.z);
    const cam = new THREE.PerspectiveCamera(55, w / h, .3, 20000);
    cam.position.copy(target).addScaledVector(away, -22).addScaledVector(UP, 11);
    const g = world.terrain.heightAt(cam.position.x, cam.position.z); if (g != null && cam.position.y < g + 3) cam.position.y = g + 3;
    cam.lookAt(target);
    world.terrain.update(x, z);
    world._realRender(world.scene, cam);
  } else world._realRender(world.scene, world.camera);
  const url = world.renderer.domElement.toDataURL('image/jpeg', .78);
  world.renderer.render = () => {};
  return url;
}

window.qc = { load, run, shot, LIMITS };
// internals, for poking at one finding from a devtools console or a driver script
window.qcDebug = () => ({ world, route, city, landscape, entries, grid, near, surfaceUnder, routeS, riderPose, THREE, ensureBVH, F });
