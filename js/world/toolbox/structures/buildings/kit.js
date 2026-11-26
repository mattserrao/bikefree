// The building kit (scene field "buildingKit"): map footprints turned into varied, textured buildings.
// It sits on top of structures/footprints.js — the same footprint plan (planFootprints: what is kept off the
// road, the tree clearings) — and replaces only how the buildings are drawn, when a scene opts in.
//
//   "buildingKit": {
//     "detailM": 120,          full outline (wings, balconies, dormers, lean-tos…) within this of the road
//     "dressingM": 70,         ground dressing for buildings within this of the road
//     "chunkM": 1000,          one draw per stretch of road (main), one more for the near detail
//     "reachM": 9000,          main meshes hidden past this
//     "detailReachM": 650,     near detail (canopies, steps, gutters, dressing) hidden past this, built as it nears
//     "detailBudgetMs": 3,     time per frame for building the near detail
//     "styles": [ { "fromM": 0, "toM": 4800, "preset": "provence", …overrides } ]   (presets.js)
//   }
//
// Cost: one draw call per stretch for the buildings, one per stretch for the near detail (Balanced: about
// 10 + 2 in view). Everything uses the one facade material (facade-material.js).
import * as THREE from '../../../../../vendor/three.js';
import { planBuildingsJob, ROAD_HALF } from './recipe.js';
import { drain, due } from '../../core/jobs.js';   // [F30]
import { Writer, NullWriter } from './assemble.js';
import { buildBuilding } from '../building-engine.js';   // [blocks] one front door for every building
import { planDressing } from './dressing.js';
import { makeFacadeMaterial } from './facade-material.js';
import { S } from './presets.js';
import { releaseAfterUpload } from '../../core/release.js';   // [F399]

// colours stay in sRGB here (the shader linearises them): no colour-space conversion
const SRGB = new Map();
const srgb = (hex) => { let c = SRGB.get(hex); if (!c) SRGB.set(hex, c = new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace)); return c.clone(); };
const u8 = (c) => [Math.round(Math.min(1, c.r) * 255), Math.round(Math.min(1, c.g) * 255), Math.round(Math.min(1, c.b) * 255)];

/** Plan the kit (pure): recipes and dressing for every footprint. Used by BuildingKit and the tests. */
export function planBuildingKit(...args) { return drain(planBuildingKitJob(...args)); }
export function* planBuildingKitJob(footprintPlan, config, index, tierIndex = null) {
  const plan = yield* planBuildingsJob(footprintPlan, config, index, config.buildingKit || {}, tierIndex);
  // a 20 m grid of footprints for "is this spot inside a building"
  const G = 20, grid = new Map();
  for (const n of footprintPlan.neighbours || []) if (!n.bb) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of n.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } n.bb = [x0, x1, z0, z1]; }
  for (const R of [...plan.buildings, ...(footprintPlan.neighbours || [])]) {
    if (due()) yield;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of R.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    R.bb = [x0, x1, z0, z1];
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
      const k = `${i},${j}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(R);
    }
  }
  const pip = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const blocked = (x, z, rr, self) => {
    for (let i = Math.floor((x - rr - 2) / G); i <= Math.floor((x + rr + 2) / G); i++) for (let j = Math.floor((z - rr - 2) / G); j <= Math.floor((z + rr + 2) / G); j++) {
      for (const R of grid.get(`${i},${j}`) || []) {
        if (x < R.bb[0] - rr - .5 || x > R.bb[1] + rr + .5 || z < R.bb[2] - rr - .5 || z > R.bb[3] + rr + .5) continue;
        // inside (or within rr of) another footprint; one's own: inside only
        if (pip(x, z, R.pts)) return true;
        if (R !== self) for (const [dx, dz] of [[rr, 0], [-rr, 0], [0, rr], [0, -rr]]) if (pip(x + dx, z + dz, R.pts)) return true;
      }
    }
    return false;
  };
  const troughs = [];
  const claimTrough = (x, z) => { if (troughs.some((t) => Math.hypot(t[0] - x, t[1] - z) < 90)) return false; troughs.push([x, z]); return true; };
  const ctx = { index, blocked, claimTrough };
  for (const R of plan.buildings) { R.dressing = planDressing(R, ctx); if (due()) yield; }
  return plan;
}

export class BuildingKit {
  constructor(parent, footprintPlan, landscape, config, uniforms, index) {
    const t0 = performance.now();
    this.group = new THREE.Group(); this.group.name = 'Buildings (building kit)'; parent.add(this.group);
    const opts = { chunkM: 1000, reachM: 9000, detailReachM: 650, ...(config.buildingKit || {}) };
    this.reach = opts.reachM; this.detailReach = opts.detailReachM;
    this.L = landscape;
    this.material = makeFacadeMaterial(uniforms);
    this.plan = planBuildingKit(footprintPlan, config, index);
    const tPlan = performance.now() - t0;
    // main meshes now (they go into the baked shadows); the near detail per stretch later, as the rider nears it
    const chunks = new Map();
    const nul = new NullWriter();
    for (const R of this.plan.buildings) {
      const key = Math.floor(R.s / opts.chunkM);
      if (!chunks.has(key)) chunks.set(key, { key, w: new Writer(8192), list: [], box: { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }, n: 0 });
      const ch = chunks.get(key);
      buildBuilding(R, ch.w, nul, nul, landscape);   // [blocks] the building engine's front door
      ch.list.push(R);
      const b = ch.box; b.x0 = Math.min(b.x0, R.x - R.r - 6); b.x1 = Math.max(b.x1, R.x + R.r + 6); b.z0 = Math.min(b.z0, R.z - R.r - 6); b.z1 = Math.max(b.z1, R.z + R.r + 6); ch.n++;
    }
    this.chunks = [...chunks.values()];
    this.meshes = []; this.details = [];
    let tris = 0;
    for (const ch of this.chunks) {
      ch.km = `${(ch.key * opts.chunkM / 1000).toFixed(0)}–${((ch.key + 1) * opts.chunkM / 1000).toFixed(0)} km`;
      const mesh = new THREE.Mesh(ch.w.geometry(), this.material);
      mesh.name = `Buildings ${ch.km} (${ch.n})`;
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.box = ch.box;
      this.group.add(mesh); this.meshes.push(mesh); tris += ch.w.triangles;
      ch.w = null; ch.detail = null;
    }
    this.count = this.plan.buildings.length;
    this.stats = { buildings: this.count, chunks: this.chunks.length, tris, detailTris: 0, ms: Math.round(performance.now() - t0), planMs: Math.round(tPlan),
      duplicates: this.plan.duplicates, archetypes: countBy(this.plan.buildings, (R) => R.archetype), dressing: countBy(this.plan.buildings.flatMap((R) => R.dressing || []), (d) => d.kind) };
    this._job = null;
    this.budgetMs = opts.detailBudgetMs ?? 3;
  }

  /** Build one stretch's near detail (canopies, steps, gutters, ridge caps, dressing), in slices: a generator. */
  *_detail(ch) {
    const d = new Writer(4096), nul = new NullWriter();
    for (const R of ch.list) {
      const res = buildBuilding(R, nul, d, nul, this.L);
      if (R.dressing?.length) for (const it of R.dressing) dress(d, it, R, this.L, res);
      yield;
    }
    if (d.n) {
      const dm = new THREE.Mesh(d.geometry(), this.material);
      dm.name = `Building detail ${ch.km}`;
      dm.castShadow = false; dm.receiveShadow = true;
      dm.userData.box = ch.box; dm.userData.bake = false;   // small things: not in the baked shadows
      this.group.add(dm); this.details.push(dm); ch.detail = dm;
      this.stats.detailTris += d.triangles;
    } else ch.detail = true;
  }

  /** Show the stretches within reach of the camera; build the near detail of the ones coming into reach. */
  cull(cx, cz) {
    const dist = (b) => Math.hypot(Math.max(b.x0 - cx, 0, cx - b.x1), Math.max(b.z0 - cz, 0, cz - b.z1));
    for (const m of this.meshes) m.visible = dist(m.userData.box) < this.reach;
    for (const m of this.details) m.visible = dist(m.userData.box) < this.detailReach;
    // the first time: everything in reach at once (the first frame and headless snapshots see it all)
    const want = this.chunks.filter((ch) => !ch.detail && dist(ch.box) < this.detailReach + 250).sort((a, b) => dist(a.box) - dist(b.box));
    if (!this._warm) { this._warm = true; for (const ch of want) { const g = this._detail(ch); while (!g.next().done); } this.cull(cx, cz); return; }
    if (!this._job && want.length) { this._jobCh = want[0]; this._job = this._detail(want[0]); }
    if (this._job) {
      const t0 = performance.now();
      while (performance.now() - t0 < this.budgetMs) if (this._job.next().done) { this._job = null; break; }
    }
  }

  dispose() { this._job?.return(); for (const m of [...this.meshes, ...this.details]) m.geometry.dispose(); this.material.dispose(); this.group.removeFromParent(); }
}


// -------------------------------------------------------------------------------------------------
/**
 * A spatial index of road centre lines that answers like the route index (nearest(x, z, maxR) → { d, i }, xs, zs), with
 * d measured as if every road were the route's 7 m wide: d = distance to the centre − half width + 3.5. So the
 * planner's clearances ("3.5 m + margin from the road") keep off a wide street (and its sidewalk) too.
 */
export function makeStreetIndex(lines, cell = 40) {
  const xs = [], zs = [], hw = [], grid = new Map();
  let maxHalf = 0;
  for (const l of lines) for (const p of l.pts) {
    const i = xs.length; xs.push(p.x); zs.push(p.z); hw.push(l.half); maxHalf = Math.max(maxHalf, l.half);
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
  }
  function nearest(x, z, maxR = cell) {
    const reach = maxR + maxHalf, r = Math.ceil(reach / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = -1, bd = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const i of grid.get(`${cx + dx},${cz + dz}`) || []) {
      const d = Math.hypot(xs[i] - x, zs[i] - z) - hw[i] + ROAD_HALF;
      if (d < bd) { bd = d; best = i; }
    }
    return best < 0 || bd > maxR ? null : { d: Math.max(0, bd), i: best };
  }
  return { xs, zs, nearest, cell };
}

/**
 * The building kit inside a city (city.js): homes — row houses (city kind 0) and houses (kind 1) — that the street kit
 * doesn't dress are drawn by the kit (shapes, roofs, porches, dressing); everything else keeps the city's own geometry.
 * Chunks come from the city's streaming (take() while a chunk is built, chunkBuilt() after it); main meshes fold into
 * the city's 960 m sectors like its own buildings, the near detail stays per chunk and is shown near the camera.
 */

/**
 * Plan a city's homes (pure: also used by the tests): row houses (city kind 0) and houses (kind 1) as footprints,
 * every other building as a neighbour, fronts toward the nearest street, detail tiers by distance to the route.
 * `city` needs buildings (decoded: { k, ring, h, kind, name, hero, hidden }), streets (cityStreets), index, route.
 */
export function planCityHomes(...args) { return drain(planCityHomesJob(...args)); }
export function* planCityHomesJob(city, cfg) {
  const kinds = { 0: 'rowhouse', 1: 'house', 13: 'barn', 14: 'shed' };
  const homes = [], neighbours = [];
  for (const b of city.buildings) {
    if (b.kind === 12 || b.hidden) continue;
    const pts = b.ring.map((p) => [p.x, p.z]);
    let x = 0, z = 0; for (const [px, pz] of pts) { x += px; z += pz; } x /= pts.length; z /= pts.length;
    let r = 0; for (const [px, pz] of pts) r = Math.max(r, Math.hypot(px - x, pz - z));
    const e = { x, z, pts, levels: 0, kind: kinds[b.kind] || 'other', roof: -1, height: b.h, s: 0, r, name: b.name || '', key: b.k };
    (kinds[b.kind] && !b.hero ? homes : neighbours).push(e);
  }
  // fronts face the nearest street (or the route); clearances keep off streets and their sidewalks
  const lines = city.streets.filter((st) => !st.bridge).map((st) => ({ pts: st.pts, half: st.width / 2 + 1.5 }));
  const ix = city.index; lines.push({ pts: Array.from(ix.xs, (x, i) => ({ x, z: ix.zs[i] })), half: 3.5 + 1.5 });
  const streets = makeStreetIndex(lines);
  const scene = { ...city.route.scene, buildingKit: cfg };
  return { plan: yield* planBuildingKitJob({ buildings: homes, neighbours }, scene, streets, city.index), streets };
}

export class CityBuildingKit {
  /** `deferred` ([F30]): `this.job` builds it (the same steps), for the caller to run in frame slices. */
  constructor(city, cfg = {}, deferred = false) {
    const job = this._buildJob(city, cfg);
    if (deferred) { this.job = job; return; }
    drain(job);
  }

  *_buildJob(city, cfg) {
    const t0 = performance.now();
    this.city = city;
    this.cfg = { detailM: 150, dressingM: 80, detailReachM: 550, ...cfg };
    this.L = city.landscape;
    this.group = new THREE.Group(); this.group.name = 'Buildings (building kit)'; city.group.add(this.group);
    this.material = city.own(makeFacadeMaterial(city.uniforms));
    const { plan, streets } = yield* planCityHomesJob(city, this.cfg);
    this.plan = plan; this.streets = streets;
    this.byKey = new Map(this.plan.buildings.map((R) => [R.key, R]));
    // what the kit adds outside the footprints (eaves, porches, steps, dressing), for the city's lamps and trees
    this.extents = new Map();
    const add = (e) => { for (let i = Math.floor((e.x - e.r) / 20); i <= Math.floor((e.x + e.r) / 20); i++) for (let j = Math.floor((e.z - e.r) / 20); j <= Math.floor((e.z + e.r) / 20); j++) { const k = i * 100003 + j; let a = this.extents.get(k); if (!a) this.extents.set(k, (a = [])); a.push(e); } };
    for (const R of this.plan.buildings) {
      for (const [k, r] of R.rects.entries()) {
        const front = k === 0 ? R.front : -1, porch = R.parts.frontPorch ? R.parts.frontPorch.depth + .3 : R.parts.porch || R.dress ? 1.2 : 0;
        const ea = R.form === 'flat' ? .3 : (R.form === 'hip' ? R.eave : R.rake) + .2, eb = R.form === 'flat' ? .3 : R.eave + .2;
        const ext = [eb + (front === 0 ? porch : 0), ea + (front === 1 ? porch : 0), eb + (front === 2 ? porch : 0), ea + (front === 3 ? porch : 0)];
        add({ rect: r, ext, x: r.cx, z: r.cz, r: Math.hypot(r.hu, r.hv) + Math.max(...ext) });
      }
      for (const it of R.dressing || []) add({ x: it.x, z: it.z, r: Math.max(...it.size.slice(0, 2)) * .6 + .2, item: true });
    }
    this.chunks = new Map(); this.sectors = new Map(); this.details = [];
    this.stats = { homes: this.plan.buildings.length, planMs: Math.round(performance.now() - t0), drawn: 0, tris: 0, detailTris: 0,
      archetypes: countBy(this.plan.buildings, (R) => R.archetype) };
  }

  /** Is (x, z) under something the kit adds outside its footprints (within `pad`)? */
  occupied(x, z, pad = 0) {
    for (const e of this.extents.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20)) || []) {
      if (Math.hypot(e.x - x, e.z - z) > e.r + pad) continue;
      if (e.item) return true;
      const r = e.rect, dx = x - r.cx, dz = z - r.cz, a = dx * r.ux + dz * r.uz, b = dx * r.vx + dz * r.vz;
      if (a > -r.hu - e.ext[3] - pad && a < r.hu + e.ext[1] + pad && b > -r.hv - e.ext[0] - pad && b < r.hv + e.ext[2] + pad) return true;
    }
    return false;
  }

  /** While the city builds chunk `key`: is this footprint the kit's? (Then the city leaves it out.) */
  take(b, key) {
    const R = this.byKey.get(b.k); if (!R) return false;
    let l = this.chunks.get(key); if (!l) this.chunks.set(key, (l = [])); l.push(R);
    return true;
  }

  /** After the city built chunk `key`: draw its homes; fold the main meshes into the sector once it is complete. */
  chunkBuilt(...args) { drain(this.chunkBuiltJob(...args)); }
  /** chunkBuilt as a job ([F30]): pauses between homes when its slice is used up. */
  *chunkBuiltJob(key, sk, S) {
    const list = this.chunks.get(key);
    let T = this.sectors.get(sk); if (!T) this.sectors.set(sk, (T = { parts: [], mesh: null, sk }));
    if (list?.length) {
      const w = new Writer(8192), d = new Writer(4096);
      for (const R of list) { if (due()) yield; const res = buildBuilding(R, w, d, new NullWriter(), this.L); if (R.dressing?.length) for (const it of R.dressing) dress(d, it, R, this.L, res); }
      if (w.n) {
        const m = new THREE.Mesh(this.city.own(w.geometry()), this.material);
        m.name = `Buildings ${key}`; m.castShadow = m.receiveShadow = true;
        this.group.add(m); T.parts.push(m); this.stats.tris += w.triangles;
      }
      if (d.n) {
        const dm = new THREE.Mesh(this.city.own(d.geometry()), this.material);
        dm.name = `Building detail ${key}`; dm.castShadow = false; dm.receiveShadow = true; dm.userData.bake = false;
        dm.userData.box = dm.geometry.boundingBox; dm.visible = this._near(dm);
        this.group.add(dm); T.dparts = T.dparts || []; T.dparts.push(dm); this.details.push(dm); this.stats.detailTris += d.triangles;
      }
      this.stats.drawn += list.length;
      this.chunks.delete(key);
    }
    if (!S || !S.left.size) this._completeSector(T);
  }

  /**
   * A sector's chunks are all in: fold its near detail into one mesh and its main meshes into one (or keep the one).
   * [F399] The meshes that result are final: their CPU copy goes once the GPU has them. finishAll() does this for
   * sectors whose chunk list never empties (a chunk with only street-kit content never reports in).
   */
  _completeSector(T) {
    if (T.done) return;
    if (T.dparts?.length) {
      // the sector's near detail: one mesh, shown near the camera
      const parts = T.dparts;
      const geo = releaseAfterUpload(parts.length > 1 ? this.city.own(mergeKit(parts.map((m) => m.geometry))) : parts[0].geometry);   // [F399] (final)
      if (parts.length > 1) for (const m of parts) { this.group.remove(m); m.geometry.dispose(); this.city.disposables.delete(m.geometry); this.details.splice(this.details.indexOf(m), 1); }
      const dm = parts.length > 1 ? new THREE.Mesh(geo, this.material) : parts[0];
      if (parts.length > 1) { dm.name = `Building detail ${T.sk}`; dm.castShadow = false; dm.receiveShadow = true; dm.userData.bake = false; this.group.add(dm); }
      if (!geo.boundingBox) geo.computeBoundingBox();
      dm.userData.box = geo.boundingBox; dm.visible = this._near(dm); if (parts.length > 1) this.details.push(dm); T.dparts = null;
    }
    if (T.parts.length > 1) {
      const geo = this.city.own(releaseAfterUpload(mergeKit(T.parts.map((m) => m.geometry))));   // [F399] (final)
      for (const m of T.parts) { this.group.remove(m); m.geometry.dispose(); this.city.disposables.delete(m.geometry); }
      const sm = new THREE.Mesh(geo, this.material);
      sm.name = `Buildings ${T.sk}`; sm.castShadow = sm.receiveShadow = true; sm.matrixAutoUpdate = false; sm.updateMatrix();
      this.group.add(sm); T.parts = [sm]; T.mesh = sm;
    } else if (T.parts.length === 1) releaseAfterUpload(T.parts[0].geometry);   // [F399] (a sector of one chunk: final as it is)
    T.done = true;
  }
  finishAll() { for (const T of this.sectors.values()) this._completeSector(T); }

  /** Near detail (canopies, steps, porches' rails, dressing) only near the camera. */
  tick(camera) {
    this._cam = this._cam || new THREE.Vector3(); this._cam.set(camera.x, camera.y, camera.z);
    if ((this._f = (this._f || 0) + 1) % 10 !== 1) return;
    for (const m of this.details) m.visible = this._near(m);
  }

  _near(m) { return !this._cam || m.userData.box.distanceToPoint(this._cam) < this.cfg.detailReachM; }
}

/** One geometry from several kit geometries (same attributes; 32-bit index). */
function mergeKit(list) {
  const out = new THREE.BufferGeometry();
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  for (const name of Object.keys(list[0].attributes)) {
    const a0 = list[0].attributes[name], arr = new a0.array.constructor(nv * a0.itemSize);
    let o = 0; for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = new Uint32Array(ni);
  let o = 0, base = 0;
  for (const g of list) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[o + k] = a[k] + base; o += a.length; base += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

const countBy = (arr, f) => { const o = {}; for (const a of arr) { const k = f(a); o[k] = (o[k] || 0) + 1; } return o; };

// -------------------------------------------------------------------------------------------------
// dressing geometry
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const L = Math.hypot(...p); return p.map((c) => c / L); });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();
function blob(d, x, y, z, rx, ry, rz) {
  for (const [a, b, c] of ICO.f) {
    const P = [a, b, c].map((i) => [x + ICO.v[i][0] * rx, y + ICO.v[i][1] * ry, z + ICO.v[i][2] * rz]);
    d.poly(P, P.map((p) => [p[0] + p[2], p[1]]));
  }
}
function cylinder(d, f, a0, a1, r, yc, seg = 8) {
  // lying along a (the frame's u), centred at b = 0, axis height yc
  const ring = (a) => { const o = []; for (let k = 0; k < seg; k++) { const t = k / seg * Math.PI * 2; const b = Math.cos(t) * r, y = yc + Math.sin(t) * r; o.push([f.cx + f.ux * a + f.vx * b, y, f.cz + f.uz * a + f.vz * b]); } return o; };
  const A = ring(a0), B = ring(a1);
  for (let k = 0; k < seg; k++) {
    const q = [A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]];
    const n = cr(q); const mid = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
    const ax = [f.cx + f.ux * (a0 + a1) / 2, yc, f.cz + f.uz * (a0 + a1) / 2];
    if (n[0] * (mid[0] - ax[0]) + n[1] * (mid[1] - ax[1]) + n[2] * (mid[2] - ax[2]) < 0) q.reverse();
    d.poly(q, q.map((p, j) => [k * .4 + (j === 1 || j === 2 ? .4 : 0), j > 1 ? Math.abs(a1 - a0) : 0]));
  }
  for (const [R, s] of [[A, -1], [B, 1]]) {
    const P = R.slice(); const n = cr(P); if ((n[0] * f.ux + n[2] * f.uz) * s < 0) P.reverse();
    d.poly(P, P.map((p) => [p[0] * f.vx + p[2] * f.vz, p[1]]));
  }
}
const cr = (t) => { const [a, b, c] = t; return [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]; };

export function dress(d, it, R, L, res) {
  const g = it.porch && res?.gv != null ? res.gv - .08 : L.heightAt(it.x, it.z);
  const f = { cx: it.x, cz: it.z, ux: Math.cos(it.yaw), uz: Math.sin(it.yaw), vx: -Math.sin(it.yaw), vz: Math.cos(it.yaw) };
  const [len, dep, hgt] = it.size;
  const none = [0, 0, 0, 0];
  const set = (code, hex, extra = {}) => d.set({ code, col: u8(typeof hex === 'string' ? srgb(hex) : hex), win: none, ...extra });
  switch (it.kind) {
    case 'pot': {
      set(S.POT, it.tone > .5 ? '#b0623e' : '#9a8f80'); d.box(f, -len / 2, len / 2, -dep / 2, dep / 2, g - .1, g + hgt);
      set(S.LEAF, it.tone > .3 ? '#3f6a2c' : '#4f7a35', { b: [it.tone, 0] }); blob(d, it.x, g + hgt + .18, it.z, .3, .26, .3);
      break;
    }
    case 'bench': {
      set(S.BENCH, '#7a5838');
      d.box(f, -len / 2, len / 2, -dep / 2, dep / 2, g + .42, g + .48);
      d.box(f, -len / 2, len / 2, dep / 2 - .05, dep / 2, g + .48, g + .9);
      for (const a of [-len / 2 + .1, len / 2 - .15]) d.box(f, a, a + .06, -dep / 2 + .05, dep / 2 - .05, g - .05, g + .42);
      break;
    }
    case 'bins': {
      const cols = ['#3f6b3e', '#4c4f53', '#c9a227', '#3f5f7a'];
      for (const [k, a] of [[0, -.33], [1, .33]]) {
        set(S.PLAIN, cols[(Math.floor(it.tone * 4) + k) % 4]);
        d.box(f, a - .28, a + .28, -.3, .3, g - .05, g + .95);
        set(S.PLAIN, '#2b2d30'); d.box(f, a - .3, a + .3, -.33, .32, g + .95, g + 1.02);
      }
      break;
    }
    case 'shrub': {
      const greens = ['#3d6a2e', '#4f7d38', '#2f5a2c', '#5d7a3a'];
      set(S.LEAF, greens[Math.floor(it.tone * 4)], { b: [it.tone, 0] });
      blob(d, it.x, g + hgt * .45, it.z, len / 2, hgt * .55, dep / 2);
      break;
    }
    case 'woodpile': {
      set(S.LOGEND, '#b08a5e'); d.box(f, -len / 2, len / 2, -dep / 2, dep / 2, g - .1, g + hgt, { topState: { code: S.WOOD, col: u8(srgb('#6b5038')) } });
      break;
    }
    case 'hay': {
      set(S.PLAIN, '#c9ad62'); cylinder(d, f, -len / 2, len / 2, .62, g + .55);
      break;
    }
    case 'garden': {
      set(S.SOIL, '#5a4532'); d.box(f, -len / 2, len / 2, -dep / 2, dep / 2, g - .1, g + .14, { topState: { code: S.SOIL, col: u8(srgb('#5a4532')) } });
      set(S.WOOD, '#7a5c3c');
      for (const b of [-dep / 2, dep / 2]) d.box(f, -len / 2, len / 2, b - .04, b + .04, g - .1, g + .22);
      if (it.fence) {
        for (let a = -len / 2; a <= len / 2 + .01; a += len / Math.ceil(len / 1.2)) for (const b of [-dep / 2 - .3, dep / 2 + .3]) d.box(f, a - .04, a + .04, b - .04, b + .04, g - .1, g + .85);
        for (const b of [-dep / 2 - .3, dep / 2 + .3]) d.box(f, -len / 2, len / 2, b - .02, b + .02, g + .55, g + .65);
      }
      break;
    }
    case 'laundry': {
      set(S.STEEL, '#8a8d90');
      for (const a of [-len / 2, len / 2]) d.box(f, a - .04, a + .04, -.04, .04, g - .1, g + 1.85);
      d.box(f, -len / 2, len / 2, -.01, .01, g + 1.78, g + 1.8);
      const cl = ['#e8e4dc', '#c0392b', '#3a6ea5', '#f1c40f', '#8e9aa6', '#e8a0b4'];
      for (let k = 0; k < 4; k++) {
        const a = -len / 2 + .4 + k * (len - .8) / 3.5, w = .45 + (k % 2) * .25, h = .5 + (k % 3) * .15;
        set(S.PLAIN, cl[(Math.floor(it.tone * 6) + k) % 6]);
        const P = [[a, 0, 1.78 - h], [a + w, 0, 1.78 - h], [a + w, 0, 1.78], [a, 0, 1.78]].map(([aa, bb, y]) => [f.cx + f.ux * aa + f.vx * bb, g + y, f.cz + f.uz * aa + f.vz * bb]);
        d.poly(P, P.map(() => [0, 0])); d.poly(P.slice().reverse(), P.map(() => [0, 0]));
      }
      break;
    }
    case 'dish': {
      const y = (res?.gv ?? g) + (it.y || 4);
      set(S.PLAIN, '#e4e2dc'); d.box(f, -.05, .05, -.3, .3, y - .3, y + .3, { bottom: true });
      set(S.STEEL, '#777a7d'); d.box(f, -.03, .03, -.03, .03, y - .5, y);
      break;
    }
    case 'trough': {
      set(S.ASHLAR, '#b9b2a4'); d.box(f, -len / 2, len / 2, -dep / 2, dep / 2, g - .1, g + hgt, { topState: { code: S.ASHLAR, col: u8(srgb('#c6bfb1')) } });
      set(S.PLAIN, '#4d7f93'); d.box(f, -len / 2 + .1, len / 2 - .1, -dep / 2 + .1, dep / 2 - .1, g + hgt - .01, g + hgt + .005);
      set(S.ASHLAR, '#a8a192'); d.box(f, -len / 2 - .05, -len / 2 + .25, -.15, .15, g - .1, g + hgt + .9);
      set(S.STEEL, '#5a5c5e'); d.box(f, -len / 2 + .2, -len / 2 + .5, -.03, .03, g + hgt + .55, g + hgt + .6);
      break;
    }
    default: break;
  }
}
