// The 3D view of a free-ride road graph (PGH, js/graph.js): every street, trail and bridge of the graph, the
// ground round them, the rivers, the rider and the chase camera. No buildings, traffic, people or courses — the
// point is the road network. It answers the app the way js/world/world.js does (start, stop, setPath, setSource,
// readiness, …), so the ride screen, the turn prompt and the loading screen work unchanged.
//
// Streaming: the graph is cut into TILE-metre tiles (each edge in pieces of at most PIECE samples, each junction
// in the tile it sits in); the tiles within NEAR_M of the camera are built (roads, paint, bridge sides and the
// ground), nearest first within a per-frame budget, and the ones beyond FAR_M released.
//
// Ground: the graph's terrain grid (tools/build_pgh.py → <id>-ground.grid.bin.gz, 20 m) on a 12.8 m mesh, cut
// down beside the roads so a street on a hillside never disappears into it (the road's own height is the truth:
// the ground steps down to just under it and eases back up). Anything below the river level is river bed: one
// water plane at the pool level shows through there.
import * as THREE from '../../vendor/three.module.min.js';
import { makeProjection } from './geo.js';
import { decodeTerrain } from './toolbox/landscape/real-terrain.js';
import { loadTerrainGrid } from '../terrain-grid.js';
import { CAMERAS, CHASE, DEFAULT_CAMERA, leanAlong, stepLean, ROAD_LIFT } from './pose.js';
import { loadRider } from './rider.js';
import { PerfMonitor } from './perf.js';

export const TILE = 400;            // m: a streaming tile
export const PIECE = 32;            // samples: an edge is cut into pieces of at most this many (320 m) for the tiles
export const NEAR_M = 2400;         // tiles whose centre is within this of the camera are built…
export const FAR_M = 3200;          // …and released beyond this
const GROUND_CELL = 12.8;           // m: the ground mesh's spacing (TILE / 31.25)
const BUDGET_MS = 6, PRELOAD_BUDGET_MS = 40;
const RIDER_LANE = 0.22;
const WATER_ABOVE = 0.35;           // the water plane this far above the pool level
const BED_BELOW = 1.2;              // ground this close above the pool (or under it) is pushed down to river bed
const KERB = 0.35;                  // the ground's top this far under the road beside it…
const SHELF = 13;                   // …for this far beyond its edge (a ground cell: no triangle reaches over the road)…
const CUT_EASE = 0.75;              // …then back up at this slope (m per m)
const CLEAR = 7;                    // under a bridge deck the ground is at least this far down (the terrain tiles can hold the deck itself)
const CUT_REACH = 40;               // m from a road's edge: beyond this the ground is left as it is
const FILL_SLOPE = 0.66;            // an embankment's side: down 1 m per 1.5 m out (no skirt hanging over a hollow)
const FILL_REACH = 25;              // m from a road's edge the fill reaches
const ABUT_M = 12;                  // m of a deck from its end that stand on an abutment (the ground filled up to under it)
const BANK_CAP = 22;                // m: a walled bank's promenade, from the wall back
const BANK_SLOPE = 14;
const PIER_STEP = 7;                // samples (70 m) between a deck's piers              // m: a natural bank, from the water's edge to its top
const PAINT_GAP = 9;                // m: no centre or edge lines this close to a junction

const COLORS = {
  primary: '#4c4e52', secondary: '#4c4e52', tertiary: '#4c4e52', residential: '#4c4e52', alley: '#57554f',
  path: '#a08b6a', plaza: '#8e8a83', side: '#7d7a5e', deck: '#8a8780', rail: '#a29e95', under: '#57544f',
};
const PAINTED = { primary: 'double', secondary: 'double', tertiary: 'dash', residential: null, alley: null, path: 'dash-white', plaza: null };

const TIMES = {
  morning: { label: 'Morning', elev: 16, az: 105, sky: '#9cc0e6', fog: '#e8dccb', hemiSky: '#f6eedf', hemiGround: '#8e8a78', sun: '#ffe2b8', sunI: 1.5, hemiI: 1.25, exposure: 1.0 },
  midday: { label: 'Midday', elev: 55, az: 200, sky: '#7fb0e0', fog: '#cfdde8', hemiSky: '#ffffff', hemiGround: '#a39b88', sun: '#ffffff', sunI: 1.7, hemiI: 1.25, exposure: 1.0 },
  golden: { label: 'Golden hour', elev: 8, az: 258, sky: '#7d8fbf', fog: '#f0c290', hemiSky: '#ffe6c8', hemiGround: '#8a7a64', sun: '#ffc27a', sunI: 1.6, hemiI: 1.2, exposure: 1.05 },
  night: { label: 'Night', elev: 40, az: 150, sky: '#0d1730', fog: '#1c2440', hemiSky: '#7d8fbf', hemiGround: '#2b2b35', sun: '#b4c6ea', sunI: 0.35, hemiI: 0.55, exposure: 1.2, night: true },
};

const _v = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/** Spatial hash of road samples, for shaping the ground: cell → [x, z, top, halfWidth, fill, …] (top: the highest the ground may be at the
 *  road's edge; fill: the lowest — an embankment under a road above the ground, an abutment under a deck's end; NaN: none). */
export function roadHash(edges, widths, cell = 32) {
  const grid = new Map();
  for (const e of edges) {
    const half = (widths[e.kind] || 7) / 2;
    const deck = new Uint8Array(e.n + 1);
    for (const [a, b] of e.bridges) for (let i = a + 1; i < b; i++) deck[i] = 1;
    // a deck sample this near its deck's end stands on the abutment
    const toEnd = new Float32Array(e.n + 1).fill(Infinity);
    for (let i = 0; i <= e.n; i++) if (!deck[i]) toEnd[i] = 0;
    for (let i = 1; i <= e.n; i++) toEnd[i] = Math.min(toEnd[i], toEnd[i - 1] + 10);
    for (let i = e.n - 1; i >= 0; i--) toEnd[i] = Math.min(toEnd[i], toEnd[i + 1] + 10);
    const fillAt = (k) => (!deck[k] ? e.ele[k] - KERB : toEnd[k] <= ABUT_M ? e.ele[k] - 1.2 : NaN);
    for (let i = 0; i <= e.n; i++) {
      // the sample and, between samples, the midpoint (10 m samples: a 5 m cut-off would leave notches)
      const below = (k) => (deck[k] ? CLEAR : KERB);
      const pts = [[e.x[i], e.z[i], e.ele[i] - below(i), fillAt(i)]];
      if (i < e.n) pts.push([(e.x[i] + e.x[i + 1]) / 2, (e.z[i] + e.z[i + 1]) / 2, (e.ele[i] + e.ele[i + 1]) / 2 - Math.max(below(i), below(i + 1)), (fillAt(i) + fillAt(i + 1)) / 2]);
      for (const [x, z, y, f] of pts) {
        const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
        let arr = grid.get(key);
        if (!arr) grid.set(key, (arr = []));
        arr.push(x, z, y, half, f);
      }
    }
  }
  return {
    cell, grid,
    /** The highest the ground may be at (x, z): under every road near it (Infinity: no road near). */
    cap(x, z, reach = CUT_REACH) {
      const r = Math.ceil(reach / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      let cap = Infinity;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const arr = grid.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 5) {
          const d = Math.hypot(arr[k] - x, arr[k + 1] - z) - arr[k + 3];
          if (d > reach) continue;
          const c = arr[k + 2] + Math.max(0, d - SHELF) * CUT_EASE;
          if (c < cap) cap = c;
        }
      }
      return cap;
    },
    /** The lowest the ground may be at (x, z): the embankments and abutments of the roads near it (-Infinity: none). */
    fill(x, z) {
      const r = Math.ceil(FILL_REACH / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      let fill = -Infinity;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const arr = grid.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 5) {
          const f0 = arr[k + 4];
          if (!(f0 > -Infinity)) continue;
          const d = Math.hypot(arr[k] - x, arr[k + 1] - z) - arr[k + 3];
          if (d > FILL_REACH) continue;
          const f = f0 - Math.max(0, d) * FILL_SLOPE;
          if (f > fill) fill = f;
        }
      }
      return fill;
    },
  };
}

export class GraphWorld {
  /**
   * @param container  the ride view's element
   * @param base       the graph's base route (js/graph.js graphNetwork): `base.graph` is the decoded graph
   * @param opts       { log, quality, path (NetRide) }
   */
  constructor(container, base, opts = {}) {
    this.container = container;
    this.route = base;
    this.G = base.graph;
    this.json = this.G.json;
    this.log = opts.log || (() => {});
    this.path = opts.path || null;
    this.areaSet = null;
    this.graphWorld = true;
    this.p = 0;
    this.crank = 0;
    this.running = false;
    this.source = null;
    this.pacerSource = null;
    this.qualityKey = opts.quality || 'balanced';
    this.weatherKey = 'clear';
    const o = this.json.origin;
    this.proj = makeProjection(o.lat, o.lon);
    this.widths = this.json.widths || {};

    // the base line in the local frame (NetRide.pose places the rider on it: routePoint reads index.xs / zs)
    const n = base.lat.length, xs = new Float64Array(n), zs = new Float64Array(n);
    for (let i = 0; i < n; i++) { const q = this.proj.toLocal(base.lat[i], base.lon[i]); xs[i] = q.x; zs[i] = q.z; }
    this.index = { xs, zs, nearest: () => null };

    // every edge in the local frame, cut into pieces per tile; junctions per tile
    for (const e of this.G.edges) {
      e.x = new Float64Array(e.n + 1); e.z = new Float64Array(e.n + 1);
      for (let i = 0; i <= e.n; i++) { const q = this.proj.toLocal(e.lat[i], e.lon[i]); e.x[i] = q.x; e.z[i] = q.z; }
    }
    this.tiles = new Map();
    const tileOf = (x, z) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    const slot = (key) => { let t = this.tiles.get(key); if (!t) this.tiles.set(key, (t = { key, pieces: [], nodes: [], built: false })); return t; };
    for (const e of this.G.edges) {
      for (let a = 0; a < e.n; a += PIECE) {
        const b = Math.min(e.n, a + PIECE), m = (a + b) >> 1;
        slot(tileOf(e.x[m], e.z[m])).pieces.push({ e, a, b });
      }
    }
    this.nodeWidth = new Map();
    for (const e of this.G.edges) for (const id of [e.from, e.to]) this.nodeWidth.set(id, Math.max(this.nodeWidth.get(id) || 0, this.widths[e.kind] || 7));
    for (const nd of this.G.nodes.values()) {
      const q = this.proj.toLocal(nd.lat, nd.lon);
      slot(tileOf(q.x, q.z)).nodes.push({ id: nd.id, x: q.x, z: q.z, y: nd.ele });
    }
    for (const [key, t] of this.tiles) { const [i, j] = key.split(',').map(Number); t.cx = (i + 0.5) * TILE; t.cz = (j + 0.5) * TILE; t.i = i; t.j = j; }
    this.cut = roadHash(this.G.edges, this.widths);
    this.waterY = (this.json.waterLevelM ?? 216.6) + WATER_ABOVE;
    // upper pools (above a dam: the Allegheny above Lock & Dam 2) — their own water level inside their box
    this.pools = (this.json.pools || []).map((p) => { const a = this.proj.toLocal(p.box[0], p.box[1]), b = this.proj.toLocal(p.box[2], p.box[3]); return { level: p.level, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), west: a.x }; });

    // renderer, scene, light
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualityKey === 'low' ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.prepend(this.renderer.domElement);
    this.renderer.domElement.className = 'world-canvas';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 20000);
    this.camTarget = new THREE.Vector3();
    this._camInit = false;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xcfdde8, 900, NEAR_M + 200);
    this.mats = {
      road: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      paint: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      ground: new THREE.MeshLambertMaterial({ vertexColors: true }),
      water: new THREE.MeshLambertMaterial({ color: '#4f7f97', transparent: true, opacity: 0.92 }),
    };
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(2 * FAR_M + 4000, 2 * FAR_M + 4000).rotateX(-Math.PI / 2), this.mats.water);
    this.water.position.y = this.waterY;
    this.scene.add(this.water);
    for (const p of this.pools) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0).rotateX(-Math.PI / 2), this.mats.water);
      w.position.set((p.x0 + p.x1) / 2, p.level + WATER_ABOVE, (p.z0 + p.z1) / 2);
      this.scene.add(w);
      // the dam: a concrete face across the box's downstream edge, from the lower pool's bed to the upper water
      const lowY = this.waterY - WATER_ABOVE - 3, topY = p.level + WATER_ABOVE + 0.6;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.west, lowY, p.z0), new THREE.Vector3(p.west, lowY, p.z1), new THREE.Vector3(p.west, topY, p.z1), new THREE.Vector3(p.west, topY, p.z0)]);
      g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
      this.scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#a09c92', side: THREE.DoubleSide })));
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // the ground grid (fetched; the roads stream without it and the ground follows)
    this.ground = null;
    this.groundFailed = false;
    const url = new URL(`../../${this.json.ground}`, import.meta.url);
    const shoreUrl = this.json.shore ? new URL(`../../${this.json.shore}`, import.meta.url) : null;
    const shoreP = shoreUrl ? fetch(shoreUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
    fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} for ${this.json.ground}`); return r.arrayBuffer(); })
      .then((buf) => Promise.all([loadTerrainGrid(buf), shoreP])).then(([grid, shore]) => {
        if (this.disposed) return;
        this.shore = shore ? decodeShore(shore, this.proj) : null;
        this.ground = decodeTerrain(grid, this.proj);
        for (const t of this.tiles.values()) if (t.built && !t.groundMesh) t.needsGround = true;
        this.log('3d', 'PGH ground loaded', 'debug');
      }).catch((err) => { this.groundFailed = true; this.log('3d', `PGH ground: ${err.message}`, 'error'); });

    // rider: a stand-in until the model loads
    this.rider = makeStandIn();
    this.scene.add(this.rider.group);
    this._riderModel = 'loading';
    loadRider().then((r) => {
      this._riderModel = 'ok';
      if (this.disposed) return;
      this.scene.remove(this.rider.group);
      this.rider = r;
      this.scene.add(r.group);
    }).catch((err) => { this._riderModel = 'failed'; this.log('3d', `Using the simple rider: ${err.message}`, 'debug'); });

    this.setTimeOfDay('midday');
    this._resize = () => {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(container);
    this._resize();
    this._frame = this._frame.bind(this);
    this._last = performance.now();
  }

  // ---------- the app's World API ----------
  setSource(fn) { this.source = fn; }
  setPacerSource(fn) { this.pacerSource = fn; }   // (no pacer drawn on a graph yet)
  setPath(path) { this.path = path || null; }
  setCourseMarks() {}                             // (no arches on a free ride)
  setPreload(on) { this._preload = !!on; }
  get waitingForArea() { return false; }
  weatherOptions() { return []; }
  setWeather(key) { this.weatherKey = key; }
  timeOptions() { return Object.entries(TIMES).map(([key, t]) => ({ key, label: t.label })); }
  setQuality(key) {
    this.qualityKey = key || 'balanced';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualityKey === 'low' ? 1 : 2));
    this._resize();
  }
  setCamera(key) { this.camKey = CAMERAS[key] ? key : DEFAULT_CAMERA; this._camInit = false; }
  setTimeOfDay(key) {
    if (!TIMES[key]) key = 'midday';
    const t = TIMES[key];
    this.timeKey = key;
    const el = THREE.MathUtils.degToRad(t.elev), az = THREE.MathUtils.degToRad(t.az);
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sun.color.set(t.sun); this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround); this.hemi.intensity = t.hemiI;
    this.renderer.toneMappingExposure = t.exposure;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog.color.set(t.fog);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
  renderOnce() { const r = this.running; this.running = true; this._frame(performance.now()); this.running = r; cancelAnimationFrame(this._raf); }

  togglePerf(on, place) {
    this.perf ||= new PerfMonitor(this.renderer, this.container, () => ({ route: this.json.name, quality: this.qualityKey, time: this.timeKey }), place);
    return this.perf.toggle(on);
  }

  /** The loading screen: ground, roads round the start, the rider. */
  readiness() {
    const steps = [], add = (key, label, p) => { p = Math.max(0, Math.min(1, p)); steps.push({ key, label, p, done: p >= 1 }); };
    const near = this._nearTiles || [];
    const roads = near.length ? near.filter((t) => t.built).length / near.length : 0;
    const ground = this.groundFailed ? 1 : !this.ground ? 0 : near.length ? near.filter((t) => t.groundMesh || !t.built).length / near.length * roads : 0;
    add('streets', 'Roads', (this._frames || 0) > 0 ? roads : 0);
    add('ground', 'Ground', ground);
    add('riders', 'Rider', this._riderModel !== 'loading' ? 1 : 0);
    return { ready: steps.every((s) => s.done), failed: this.groundFailed, progress: steps.reduce((a, s) => a + s.p, 0) / steps.length, steps };
  }
  get loading() { return (this._queued || 0) > 6 ? 4 : 0; }

  dispose() {
    this.stop();
    this.disposed = true;
    this._ro?.disconnect();
    for (const t of this.tiles.values()) this._release(t);
    for (const m of Object.values(this.mats)) m.dispose();
    this.water.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.perf?.dispose?.();
  }

  // ---------- the frame ----------
  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    this._frames = (this._frames || 0) + 1;
    this.perf?.begin(now);
    const dt = Math.min(1.0, (now - this._last) / 1000);
    this._last = now;
    const src = this.source ? this.source() : { pos: 0, speed: 0, cadence: 0, riding: false };
    const out = this._pose ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
    if (this.path) {
      let x = this.p + (src.speed || 0) * dt;
      const err = src.pos - x;
      x = Math.abs(err) > 60 ? src.pos : x + err * Math.min(1, dt * 1.5);
      this.p = Math.max(0, x);
      this._place(this.p, RIDER_LANE, out);
    }
    this.crank += ((src.cadence || 0) / 60) * Math.PI * 2 * dt;
    this.rider.update(out.pos, out.fwd, this.crank, src.speed || 0, Math.min(dt, 0.1), src);
    if (this.path) {
      const tmp = this._leanTmp ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
      this._lean = stepLean(this._lean, leanAlong((s) => this._place(s, RIDER_LANE, tmp), this.p, src.speed || 0, { minS: 0 }), Math.min(dt, 0.1));
      this.rider.setLean?.(this._lean);
    }
    this._updateCamera(out.pos, out.flat, out.fwd, dt);
    this._stream(this.camera.position.x, this.camera.position.z, this._preload ? PRELOAD_BUDGET_MS : BUDGET_MS);
    this.water.position.x = Math.round(this.camera.position.x / 100) * 100;
    this.water.position.z = Math.round(this.camera.position.z / 100) * 100;
    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, 5000);
    this.sun.target.position.copy(this.camera.position);
    if (this._preload && this._frames % 4) return;
    this.renderer.render(this.scene, this.camera);
    this.perf?.end(performance.now());
  }

  _place(p, lane, out) {
    const pose = this.path.pose(p, this.index, lane);
    out.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
    out.fwd.set(pose.fwd.x, pose.fwd.y, pose.fwd.z);
    out.flat.set(pose.flat.x, 0, pose.flat.z);
    return out;
  }

  /** Ground height at (x, z) as drawn (the grid, cut under the roads, river bed under the water), or null before it loads. */
  heightAt(x, z) {
    if (!this.ground) return null;
    return this._groundH(x, z);
  }
  /** The pool level at (x, z): an upper pool inside its box, else the main one. */
  poolAt(x, z) {
    for (const p of this.pools || []) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return p.level;
    return this.waterY - WATER_ABOVE;
  }
  _groundH(x, z) {
    const raw = this.ground.at(x, z);
    let h = raw;
    const pool = this.poolAt(x, z);
    const f = this.cut.fill(x, z);
    if (f > h) h = f;   // under a road above the ground: its embankment, a deck's abutment
    const sh = this.shore ? this.shore.at(x, z) : null;
    if (sh && sh.s > -16 && sh.s < (sh.walled ? BANK_CAP + 12 : BANK_SLOPE)) {
      // the riverbank (tools/pgh_shore.mjs): drawn by the bank mesh; the ground keeps out of its way
      if (sh.walled) {
        if (sh.s < 2) h = pool - 20;                                              // in front of the wall: deep (no sliver of slope pokes out)
        else if (raw > sh.top && sh.s > 8) h = Math.max(h, raw);                  // a hill right behind the promenade stays
        else if (sh.s <= BANK_CAP) h = sh.top - 0.15;                             // the promenade (filled up or cut down to it)
        else { const t = (sh.s - BANK_CAP) / 12; h = (sh.top - 0.15) * (1 - t) + Math.max(h, pool + BED_BELOW) * t; }
      } else if (sh.s < 0) h = Math.min(h, pool - 2.5);
      else h = bankProfile(sh.s, sh.top, sh.pool + WATER_ABOVE, sh.pool) - 0.15;
    } else if (h < pool + BED_BELOW) h = Math.min(h, pool - 2.5);
    return Math.min(h, this.cut.cap(x, z));
  }

  _updateCamera(riderPos, flat, fwd, dt) {
    const K = CAMERAS[this.camKey] || CHASE;
    const pos = _v.copy(riderPos).addScaledVector(flat, -K.back).addScaledVector(UP, K.up);
    const look = (this._look ||= new THREE.Vector3()).copy(riderPos).addScaledVector(fwd, K.ahead).addScaledVector(UP, K.lookUp);
    const g = this.heightAt(pos.x, pos.z);
    if (g != null && pos.y < g + K.ground) pos.y = g + K.ground;
    if (Math.abs(this.camera.fov - K.fov) > 0.01) { this.camera.fov = K.fov; this.camera.updateProjectionMatrix(); }
    if (!this._camInit) { this.camera.position.copy(pos); this.camTarget.copy(look); this._camInit = true; }
    else { this.camera.position.lerp(pos, 1 - Math.exp(-dt * 3.5)); this.camTarget.lerp(look, 1 - Math.exp(-dt * 5)); }
    this.camera.lookAt(this.camTarget);
  }

  // ---------- streaming ----------
  _stream(cx, cz, budgetMs) {
    const t0 = performance.now();
    const ci = Math.floor(cx / TILE), cj = Math.floor(cz / TILE), r = Math.ceil(NEAR_M / TILE);
    const want = [];
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const d = Math.hypot((i + 0.5) * TILE - cx, (j + 0.5) * TILE - cz);
      if (d > NEAR_M) continue;
      const key = `${i},${j}`;
      let t = this.tiles.get(key);
      if (!t) this.tiles.set(key, (t = { key, pieces: [], nodes: [], built: false, cx: (i + 0.5) * TILE, cz: (j + 0.5) * TILE, i, j }));
      want.push({ t, d });
    }
    want.sort((a, b) => a.d - b.d);
    this._nearTiles = want.filter((w) => w.d < 700).map((w) => w.t);
    let queued = 0;
    for (const { t } of want) {
      const todo = !t.built || (this.ground && !t.groundMesh);
      if (!todo) continue;
      if (performance.now() - t0 > budgetMs) { queued++; continue; }
      if (!t.built) this._buildRoads(t);
      if (this.ground && !t.groundMesh) this._buildGround(t);
    }
    this._queued = queued;
    // release far tiles (a few a frame)
    if (this._frames % 30 === 0) for (const t of this.tiles.values()) {
      if (t.built && Math.hypot(t.cx - cx, t.cz - cz) > FAR_M) this._release(t);
    }
  }

  _release(t) {
    for (const m of [t.roadMesh, t.paintMesh, t.groundMesh, t.bankMesh]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    t.roadMesh = t.paintMesh = t.groundMesh = t.bankMesh = null;
    t.built = false;
  }

  _buildRoads(t) {
    t.built = true;
    if (!t.pieces.length && !t.nodes.length) return;
    const R = new Mesher(), P = new Mesher();
    const col = (k) => new THREE.Color(COLORS[k] || COLORS.residential);
    for (const { e, a, b } of t.pieces) {
      const half = (this.widths[e.kind] || 7) / 2, c = col(e.kind), lift = ROAD_LIFT + (e.kind === 'path' ? -0.03 : 0);
      const deck = new Uint8Array(e.n + 1);
      for (const [p, q] of e.bridges) for (let i = p; i <= q; i++) deck[i] = 1;
      const L = [], Rt = [];
      for (let i = a; i <= b; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(e.n, i + 1);
        let dx = e.x[i1] - e.x[i0], dz = e.z[i1] - e.z[i0];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const y = e.ele[i] + lift;
        L.push([e.x[i] + dz * half, y, e.z[i] - dx * half]);
        Rt.push([e.x[i] - dz * half, y, e.z[i] + dx * half]);
      }
      R.strip(L, Rt, c);
      // sides: down to the ground on an embankment (a skirt), a deck with parapets on a bridge
      const side = col('side'), deckC = col('deck'), rail = col('rail'), under = col('under');
      for (let i = a; i < b; i++) {
        const k = i - a, br = deck[i] && deck[i + 1];
        const drop = br ? 1.0 : 3.5;
        for (const [S, flip] of [[L, false], [Rt, true]]) {
          const p0 = S[k], p1 = S[k + 1];
          R.wall(p0, p1, -drop, 0, br ? deckC : side, flip);
          if (br) R.wall(p0, p1, 0, 0.9, rail, flip);
        }
        if (br) R.quad([L[k][0], L[k][1] - 1, L[k][2]], [Rt[k][0], Rt[k][1] - 1, Rt[k][2]], [Rt[k + 1][0], Rt[k + 1][1] - 1, Rt[k + 1][2]], [L[k + 1][0], L[k + 1][1] - 1, L[k + 1][2]], under, true);
      }
      // paint: centre lines and trail centre dashes, not near a junction
      const style = PAINTED[e.kind];
      if (style) {
        const lenM = e.n * 10;
        for (let i = a; i < b; i++) {
          const s0 = i * 10, s1 = s0 + 10;
          if (s0 < PAINT_GAP || s1 > lenM - PAINT_GAP) continue;
          if (style !== 'double' && i % 2) continue;   // dashes: every other 10 m
          const yellow = style !== 'dash-white', c2 = new THREE.Color(yellow ? '#e3b53a' : '#f2efe6');
          const offs = style === 'double' ? [-0.18, 0.18] : [0];
          for (const off of offs) {
            const p = (s) => {
              const k = s - a, i0 = Math.max(0, s - 1), i1 = Math.min(e.n, s + 1);
              let dx = e.x[i1] - e.x[i0], dz = e.z[i1] - e.z[i0]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
              return { x: (L[k][0] + Rt[k][0]) / 2 - dz * off, y: L[k][1] + 0.02, z: (L[k][2] + Rt[k][2]) / 2 + dx * off, dx, dz };
            };
            const A = p(i), B = p(i + 1), w = 0.07;
            P.quad([A.x + A.dz * w, A.y, A.z - A.dx * w], [A.x - A.dz * w, A.y, A.z + A.dx * w], [B.x - B.dz * w, B.y, B.z + B.dx * w], [B.x + B.dz * w, B.y, B.z - B.dx * w], c2);
          }
        }
      }
    }
    // junctions: a disc as wide as the widest way into it, a hair above the roads (one colour: no seams)
    for (const nd of t.nodes) {
      const w = this.nodeWidth.get(nd.id) || 7, r = w / 2 * 1.15, y = nd.y + ROAD_LIFT + 0.01;
      R.disc(nd.x, y, nd.z, r, col('residential'));
    }
    t.roadMesh = R.mesh(this.mats.road);
    if (t.roadMesh) this.group.add(t.roadMesh);
    t.paintMesh = P.mesh(this.mats.paint);
    if (t.paintMesh) this.group.add(t.paintMesh);
  }

  _buildGround(t) {
    const nx = Math.round(TILE / GROUND_CELL), x0 = t.i * TILE, z0 = t.j * TILE, cell = TILE / nx, n1 = nx + 1;
    const pos = new Float32Array(n1 * n1 * 3), color = new Float32Array(n1 * n1 * 3);
    const grass = new THREE.Color('#89a868'), dry = new THREE.Color('#a7a27a'), bed = new THREE.Color('#6f6a58'), tmp = new THREE.Color();
    for (let j = 0, k = 0; j <= nx; j++) for (let i = 0; i <= nx; i++, k++) {
      const x = x0 + i * cell, z = z0 + j * cell, h = this._groundH(x, z), pool = this.poolAt(x, z);
      pos[3 * k] = x; pos[3 * k + 1] = h; pos[3 * k + 2] = z;
      const raw = this.ground.at(x, z), cutDepth = Math.max(0, raw - h);
      tmp.copy(h < pool ? bed : grass).lerp(dry, Math.min(1, cutDepth / 6));
      const v = 0.94 + 0.06 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(x * 0.007 - z * 0.011);
      color[3 * k] = tmp.r * v; color[3 * k + 1] = tmp.g * v; color[3 * k + 2] = tmp.b * v;
    }
    const idx = new Uint32Array(nx * nx * 6);
    for (let j = 0, q = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    t.groundMesh = new THREE.Mesh(g, this.mats.ground);
    this.group.add(t.groundMesh);
    this._buildBank(t);
  }

  /** The riverbank along the shore lines in this tile: a stone face and a promenade where walled, a firm slope elsewhere. */
  _buildBank(t) {
    const x0 = t.i * TILE, z0 = t.j * TILE, M = new Mesher();
    const grass = new THREE.Color('#89a868'), stone = new THREE.Color('#8f8a80'), bed = new THREE.Color('#6f6a58');
    const capY = (x, z, y) => Math.min(y, this.cut.cap(x, z) + 0.12);   // (under a road's cut: just over the ground there, under the road)
    for (const L of this.shore ? this.shore.lines : []) {
      const pool = L.pool, waterY = pool + WATER_ABOVE;
      for (let i = 0; i + 1 < L.n; i++) {
        const mx = (L.x[i] + L.x[i + 1]) / 2, mz = (L.z[i] + L.z[i + 1]) / 2;
        if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue;
        const row = (k, s, y) => { const x = L.x[k] + L.nx[k] * s, z = L.z[k] + L.nz[k] * s; return [x, capY(x, z, y), z]; };
        if (L.walled[i] && L.walled[i + 1]) {
          const a = [L.x[i], pool - 4, L.z[i]], b = [L.x[i + 1], pool - 4, L.z[i + 1]];
          const ta = row(i, 0, L.top[i] + 0.03), tb = row(i + 1, 0, L.top[i + 1] + 0.03);
          M.quad(a, b, tb, ta, stone);                                               // the wall's face
          M.quad(ta, tb, row(i + 1, BANK_CAP, L.top[i + 1] + 0.03), row(i, BANK_CAP, L.top[i] + 0.03), grass);   // the promenade
        } else {
          const S = [-4, 0, 5, BANK_SLOPE];
          for (let q = 0; q + 1 < S.length; q++) {
            const y = (k, s) => bankProfile(s, L.top[k], waterY, pool) + 0.03;
            M.quad(row(i, S[q], y(i, S[q])), row(i + 1, S[q], y(i + 1, S[q])), row(i + 1, S[q + 1], y(i + 1, S[q + 1])), row(i, S[q + 1], y(i, S[q + 1])), q === 0 ? bed : grass);
          }
        }
      }
    }
    // bridge piers: under every deck that stands over a hollow or the water, one every PIER_M (not within 20 m of the
    // deck's ends — the abutments hold those), a slab as wide as the road, from the deck's underside to the ground
    const pier = new THREE.Color('#9a968c');
    for (const { e, a, b } of t.pieces) {
      if (!e.bridges.length) continue;
      const deck = new Uint8Array(e.n + 1);
      for (const [p, q] of e.bridges) for (let i = p + 1; i < q; i++) deck[i] = 1;
      const toEnd = new Float32Array(e.n + 1).fill(Infinity);
      for (let i = 0; i <= e.n; i++) if (!deck[i]) toEnd[i] = 0;
      for (let i = 1; i <= e.n; i++) toEnd[i] = Math.min(toEnd[i], toEnd[i - 1] + 10);
      for (let i = e.n - 1; i >= 0; i--) toEnd[i] = Math.min(toEnd[i], toEnd[i + 1] + 10);
      const half = (this.widths[e.kind] || 7) / 2 - 0.4;
      for (let i = Math.max(a, 1); i <= Math.min(b, e.n - 1); i++) {
        if (!deck[i] || toEnd[i] < 20 || i % PIER_STEP) continue;
        const gy = this._groundH(e.x[i], e.z[i]), top = e.ele[i] - 1.0;
        if (top - gy < 3) continue;   // (low over the ground: the fill and the abutments are enough)
        let dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = -dz, nz = dx, t2 = 0.9, bot = Math.min(gy, this.poolAt(e.x[i], e.z[i]) - 1) - 0.5;
        const c = (u, v, y) => [e.x[i] + dx * u + nx * v, y, e.z[i] + dz * u + nz * v];
        for (const [u0, v0, u1, v1] of [[-t2, -half, t2, -half], [t2, -half, t2, half], [t2, half, -t2, half], [-t2, half, -t2, -half]])
          M.quad(c(u0, v0, bot), c(u1, v1, bot), c(u1, v1, top), c(u0, v0, top), pier);
      }
    }
    t.bankMesh = M.mesh(this.mats.road);
    if (t.bankMesh) this.group.add(t.bankMesh);
  }
}

/** Triangles with flat colours, gathered then made one mesh. */
class Mesher {
  constructor() { this.pos = []; this.col = []; this.nrm = []; }
  _tri(a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(color.r, color.g, color.b); this.nrm.push(nx, ny, nz); }
  }
  quad(a, b, c, d, color, flip = false) {
    if (flip) { this._tri(a, c, b, color); this._tri(a, d, c, color); }
    else { this._tri(a, b, c, color); this._tri(a, c, d, color); }
  }
  /** A ribbon between a left and a right edge (as ridden: forward along the lists), facing up. */
  strip(L, R, color) {
    for (let k = 0; k + 1 < L.length; k++) this.quad(L[k], R[k], R[k + 1], L[k + 1], color);
  }
  /** A vertical wall under/over the edge p0 → p1, from y + y0 to y + y1. */
  wall(p0, p1, y0, y1, color, flip) {
    this.quad([p0[0], p0[1] + y0, p0[2]], [p1[0], p1[1] + y0, p1[2]], [p1[0], p1[1] + y1, p1[2]], [p0[0], p0[1] + y1, p0[2]], color, flip);
  }
  disc(x, y, z, r, color, seg = 14) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this._tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], color);
    }
  }
  mesh(material) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

/** A simple rider until the model loads. */
function makeStandIn() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 1.6), new THREE.MeshLambertMaterial({ color: '#ff7a1a' }));
  body.position.y = 0.75;
  group.add(body);
  return {
    group,
    update(pos, fwd) { group.position.copy(pos); group.lookAt(_v.copy(pos).add(new THREE.Vector3(fwd.x, 0, fwd.z))); },
  };
}

/** A natural bank's height s metres in from the water's edge (− out in the river): under the water to the edge, then
 *  ≥ 1.5 m up within 5 m (no mud ramp), easing to the bank's top by BANK_SLOPE. */
export function bankProfile(s, top, waterY, pool) {
  const T = Math.max(top, waterY + 1.6), y5 = waterY + Math.max(1.5, 0.5 * (T - waterY));
  if (s <= -4) return pool - 2;
  if (s <= 0) return pool - 2 + ((waterY - 0.05 - (pool - 2)) * (s + 4)) / 4;
  if (s <= 5) return waterY - 0.05 + ((y5 - waterY + 0.05) * s) / 5;
  if (s <= BANK_SLOPE) { const u = (s - 5) / (BANK_SLOPE - 5); return y5 + (T - y5) * u * u * (3 - 2 * u); }
  return T;
}

/** The shore lines (tools/pgh_shore.mjs → <id>-shore.json) in the local frame, and the nearest one to a spot. */
export function decodeShore(json, proj) {
  const kl = json.unit?.latlon ?? 1e-6, kt = json.unit?.top ?? 0.1, ks = json.unit?.side ?? 0.001;
  const und = (a, k) => { const o = new Float64Array(a.length); let acc = 0; for (let i = 0; i < a.length; i++) { acc += a[i]; o[i] = acc * k; } return o; };
  const lines = json.lines.map((l) => {
    const la = und(l.lat, kl), lo = und(l.lon, kl), top = und(l.top, kt), side = und(l.side, ks), n = la.length;
    const x = new Float64Array(n), z = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n), walled = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const q = proj.toLocal(la[i], lo[i]); x[i] = q.x; z[i] = q.z; nx[i] = Math.cos(side[i]); nz[i] = Math.sin(side[i]); }
    for (const [a, b] of l.walled) for (let i = a; i <= b; i++) walled[i] = 1;
    return { n, x, z, nx, nz, top, walled, pool: l.pool ?? json.pool };
  });
  // NB: the builder's x/z come from the same projection (the graph's origin), so its sides hold here
  const C = 25, grid = new Map();
  lines.forEach((L, li) => { for (let i = 0; i + 1 < L.n; i++) { const k = `${Math.floor((L.x[i] + L.x[i + 1]) / 2 / C)},${Math.floor((L.z[i] + L.z[i + 1]) / 2 / C)}`; (grid.get(k) || grid.set(k, []).get(k)).push(li, i); } });
  return {
    lines,
    /** { s (m: + land, − river), top, walled, d } of the nearest shore within 30 m, or null. */
    at(x, z) {
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      let best = null, bd = 30;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const arr = grid.get(`${cx + a},${cz + b}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const L = lines[arr[k]], i = arr[k + 1];
          const ax = L.x[i], az = L.z[i], bx = L.x[i + 1], bz = L.z[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
          if (d < bd) {
            bd = d;
            const nx = L.nx[i] * (1 - t) + L.nx[i + 1] * t, nz = L.nz[i] * (1 - t) + L.nz[i + 1] * t;
            best = { s: (x - px) * nx + (z - pz) * nz, top: L.top[i] * (1 - t) + L.top[i + 1] * t, walled: L.walled[i] && L.walled[i + 1], d, pool: L.pool };
          }
        }
      }
      return best;
    },
  };
}
