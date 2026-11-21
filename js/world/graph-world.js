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
import { makeParkMaterial } from './toolbox/materials/park-surfaces.js';
import { makeMasonryMaterial } from './toolbox/materials/stonework.js';

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
const PIER_STEP = 7;
const PROM_M = 6;                   // m of granite paving along the top of a river wall                // samples (70 m) between a deck's piers              // m: a natural bank, from the water's edge to its top
const PAINT_GAP = 9;
const LAND_PAVED = 0;
const ZERO4 = [0, 0, 0, 3];
const SUB = 3;                      // a drawn way: each 10 m sample span in this many pieces (a Catmull-Rom curve through the samples)
const SURF_CODE = { asphalt: 0, brick: 1, sett: 2, concrete: 3, paving: 4, gravel: 5, dirt: 6, wood: 7 };                // m: no centre or edge lines this close to a junction

const COLORS = {
  primary: '#4c4e52', secondary: '#4c4e52', tertiary: '#4c4e52', residential: '#4c4e52', alley: '#57554f',
  path: '#5f5d59', plaza: '#8e8a83', side: '#7d7a5e', deck: '#8a8780', rail: '#a29e95', under: '#57544f',
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
  const grid = new Map(), wf = typeof widths === 'function' ? widths : (e) => widths[e.kind] || 7;
  for (const e of edges) {
    const half = wf(e) / 2 + (e._walk ? e._walk : 0);   // (a sidewalk: the ground keeps under it too)
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
    // per edge (js/world/graph-city.js sets them once the city data is in: trail and riverwalk widths, sidewalks)
    this.wOf = (e) => e._w ?? (this.widths[e.kind] || 7);
    this.walkOf = (e) => e._walk || 0;
    this.isRiverwalk = (e) => !!e._rw;

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
    this._nodeWidths();
    // the ways into each junction (crosswalks)
    this.arms = new Map();
    for (const e of this.G.edges) for (const [id, end] of [[e.from, 0], [e.to, 1]]) { if (!this.arms.has(id)) this.arms.set(id, []); this.arms.get(id).push({ e, end }); }
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
      ground: groundMaterial(),
      roadSurface: roadSurfaceMaterial(),
      water: new THREE.MeshLambertMaterial({ color: '#4f7f97', transparent: true, opacity: 0.92 }),
      // the dressed places and the river walls: textured from world position (toolbox/materials)
      park: Object.fromEntries(['lawn', 'plaza', 'granite', 'walk', 'garden', 'wood', 'scrub'].map((k) => [k, makeParkMaterial(k)])),
      riverWall: makeMasonryMaterial({ stones: ['#8f897d', '#9b9487', '#857f74', '#a29b8e', '#8a8376', '#7f796f'], mortar: '#b3ada1', courseM: 0.45, moss: '#4f5a3c', mossM: 1.2 }),
      parkWall: makeMasonryMaterial({ stones: ['#a39a8a', '#958c7c', '#ab9f8c', '#8f8576', '#9c9282', '#b0a693'], mortar: '#c2b9a8', courseM: 0.3, mossM: 0.4 }),
      fountainWater: new THREE.MeshLambertMaterial({ color: '#5d93ad', transparent: true, opacity: 0.88 }),
      spray: new THREE.MeshLambertMaterial({ color: '#f4f8fb', transparent: true, opacity: 0.55, depthWrite: false }),
      trunk: new THREE.MeshLambertMaterial({ color: '#5b4636' }),
      crown: new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
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
    const dressUrl = this.json.dressing ? new URL(`../../${this.json.dressing}`, import.meta.url) : null;
    const dressP = dressUrl ? fetch(dressUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
    const shoreUrl = this.json.shore ? new URL(`../../${this.json.shore}`, import.meta.url) : null;
    const shoreP = shoreUrl ? fetch(shoreUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
    fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} for ${this.json.ground}`); return r.arrayBuffer(); })
      .then((buf) => Promise.all([loadTerrainGrid(buf), shoreP, dressP])).then(([grid, shore, dressing]) => {
        if (this.disposed) return;
        this.shore = shore ? decodeShore(shore, this.proj) : null;
        this.dressing = dressing ? decodeDressing(dressing, this.proj, TILE) : null;
        this.ground = decodeTerrain(grid, this.proj);
        // the landmarks (the Pittsburgh map's hero models: js/world/graph-heroes.js), once the ground is there to stand on
        if (this.json.heroes) {
          this._heroesState = 'loading';
          fetch(new URL(`../../${this.json.heroes}`, import.meta.url)).then((r) => r.json())
            .then((hj) => import('./graph-heroes.js').then(({ buildGraphHeroes }) => buildGraphHeroes(this, hj)))
            .then((h) => { if (this.disposed) { h.dispose(); return; } this.heroes = h; this.scene.add(h.group); h.setNight(this.timeKey === 'night' ? 1 : 0); this._heroesState = 'ok'; this._loadBridges(); this._loadCity(); })
            .catch((err) => { this._heroesState = 'failed'; this.log('3d', `PGH landmarks: ${err.message} ${(err.stack || '').split('\n').slice(0, 4).join(' | ')}`, 'error'); });
        }
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
    this.heroes?.setNight(t.night ? 1 : 0);
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
    if (this.json.heroes) add('landmarks', 'Landmarks', this._heroesState && this._heroesState !== 'loading' ? 1 : 0);
    if (this.json.bridges && this._heroesState === 'ok') add('bridges', 'Bridges', this._bridgesState && this._bridgesState !== 'loading' ? 1 : 0);
    if (this.json.city && this._heroesState === 'ok') {
      const c = this.city, p = this._cityState === 'failed' ? 1 : !c ? 0 : !c.ready ? 0.3 : c.pendingNear(this.camera.position.x, this.camera.position.z, 900) ? 0.7 : 1;
      add('city', 'Buildings and trees', p);
    }
    return { ready: steps.every((s) => s.done), failed: this.groundFailed, progress: steps.reduce((a, s) => a + s.p, 0) / steps.length, steps };
  }
  get loading() { return (this._queued || 0) > 6 ? 4 : 0; }

  dispose() {
    this.stop();
    this.disposed = true;
    this._ro?.disconnect();
    for (const t of this.tiles.values()) this._release(t);
    for (const m of Object.values(this.mats)) { if (m.dispose) m.dispose(); else for (const x of Object.values(m)) x.dispose?.(); }
    this.heroes?.dispose();
    this.bridges?.dispose();
    this.city?.dispose();
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
    this.heroes?.tick(now / 1000, dt);
    this.city?.tick(this.camera.position, now / 1000);
    this.rider.update(out.pos, out.fwd, this.crank, src.speed || 0, Math.min(dt, 0.1), src);
    if (this.path) {
      const tmp = this._leanTmp ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
      this._lean = stepLean(this._lean, leanAlong((s) => this._place(s, RIDER_LANE, tmp), this.p, src.speed || 0, { minS: 0 }), Math.min(dt, 0.1));
      this.rider.setLean?.(this._lean);
    }
    this._updateCamera(out.pos, out.flat, out.fwd, dt);
    this._stream(this.camera.position.x, this.camera.position.z, this._preload ? PRELOAD_BUDGET_MS : BUDGET_MS);
    this.city?.stream(this.camera.position.x, this.camera.position.z, this._preload ? 30 : 4);
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
  _nodeWidths() {
    this.nodeWidth = new Map();
    for (const e of this.G.edges) for (const id of [e.from, e.to]) this.nodeWidth.set(id, Math.max(this.nodeWidth.get(id) || 0, this.wOf(e)));
  }

  /** PGH's city (js/world/graph-city.js, tools/pgh_city.py): buildings, trees, furniture, the land cover and what each
   *  edge is made of. Once it's in, the edges take their widths and sidewalks and the tiles are rebuilt. */
  _loadCity() {
    if (!this.json.city || this._cityState || !this.heroes) return;
    this._cityState = 'loading';
    fetch(new URL(`../../${this.json.city}`, import.meta.url)).then((r) => r.json())
      .then((cj) => import('./graph-city.js').then(({ GraphCity }) => {
        if (this.disposed) return;
        const c = new GraphCity(this, this.heroes, cj);
        this.city = c;
        this._classify(c);
        this.cut = roadHash(this.G.edges, this.wOf);
        this._nodeWidths();
        const b = c.landBox, U = this.mats.ground.userData.land;
        if (U) { U.uLand.value = c.landTexture; U.uLandBox.value.set(b.x0, b.z0, b.x1, b.z1); U.uLandOn.value = 1; }
        for (const t of this.tiles.values()) if (t.built) this._release(t);
        this._cityState = 'ok';
        this.log('3d', `PGH city: ${c.buildings.length} buildings`, 'debug');
      }))
      .catch((err) => { this._cityState = 'failed'; this.log('3d', `PGH city: ${err.message} ${(err.stack || '').split('\n').slice(0, 3).join(' | ')}`, 'error'); });
  }

  /**
   * What each edge is (from the city data): a trail's width (a main trail 3.6 m, a park path 2.6 m), a riverwalk (a
   * paved walk along the water: 5.5 m of concrete or pavers), a street's sidewalks (in built-up places: 3.2 m on the
   * main streets among shops, 2.4 m elsewhere on them, 1.8 m on residential streets; none where OSM says none), and
   * its surface sample by sample (OSM's, plus the Pittsburgh map's rule: a residential street of 7 % or more,
   * 25 m or longer, among the houses, is red brick).
   */
  _classify(c) {
    const MAIN_TRAIL = /Heritage|Allegheny Passage|Eliza Furnace|North Shore Trail|South Side Trail|Station Square Trail|Strip District Trail|Hot Metal|Mon Wharf|^Trail$|Riverwalk|Riverfront/i;
    const wet = (x, z) => this.ground.at(x, z) < this.poolAt(x, z) + 0.5;
    for (const e of this.G.edges) {
      const info = c.edgeInfo(e), half = (this.widths[e.kind] || 7) / 2;
      e._surf = new Array(e.n + 1);
      for (let i = 0; i <= e.n; i++) e._surf[i] = info.surf(i);
      if (e.kind === 'path') {
        let river = 0, n = 0, paved = 0;
        for (let i = 0; i <= e.n; i += 2) {
          const i0 = Math.max(0, i - 1), i1 = Math.min(e.n, i + 1), dx = e.x[i1] - e.x[i0], dz = e.z[i1] - e.z[i0], l = Math.hypot(dx, dz) || 1;
          n++; if ([-22, -12, 12, 22].some((o) => wet(e.x[i] - dz / l * o, e.z[i] + dx / l * o))) river++;
          if (e._surf[i] === 'concrete' || e._surf[i] === 'paving') paved++;
        }
        const onDeck = e.bridges.reduce((a, [p, q]) => a + q - p, 0) > e.n * 0.5;
        const riverside = river / n > 0.4 && !onDeck;
        if (riverside && (paved / n > 0.5 || /Riverwalk|Riverfront/i.test(e.name || ''))) { e._w = 5.5; e._rw = true; }
        else if (riverside || MAIN_TRAIL.test(e.name || '')) e._w = 3.6;
        else e._w = 2.6;
        continue;
      }
      if (e.kind === 'plaza' || e.kind === 'alley') continue;
      // sidewalks: in built-up places (land cover and buildings near), unless OSM says none
      let urban = 0, shops = 0, n = 0;
      for (let i = 0; i <= e.n; i += 2) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(e.n, i + 1), dx = e.x[i1] - e.x[i0], dz = e.z[i1] - e.z[i0], l = Math.hypot(dx, dz) || 1;
        for (const sd of [-1, 1]) {
          const x = e.x[i] - dz / l * (half + 6) * sd, z = e.z[i] + dx / l * (half + 6) * sd;
          n++;
          const b = c.host.buildingNear(x, z, 18);
          if (b && c.urban(x, z)) { urban++; if (b.kind === 2 || b.kind === 4 || b.kind === 5) shops++; }
        }
      }
      if (info.walk !== 0 && !e.bridges.some(([a, b]) => b - a > e.n * 0.8) && urban / n > 0.45) {
        e._walk = e.kind === 'residential' ? 1.8 : shops / n > 0.3 ? 3.2 : 2.4;
      }
      // brick: a steep residential street among houses
      if (e.kind === 'residential') {
        let run = 0;
        for (let i = 0; i <= e.n; i++) {
          const i0 = Math.max(0, i - 1), i1 = Math.min(e.n, i + 1), g = Math.abs(e.ele[i1] - e.ele[i0]) / ((i1 - i0) * 10 || 1);
          const steep = g >= 0.07 && c.landAt(e.x[i], e.z[i]) !== LAND_PAVED;
          run = steep ? run + 1 : 0;
          if (run >= 3) for (let k = i - run + 1; k <= i; k++) if (e._surf[k] === 'asphalt') e._surf[k] = 'brick';
        }
      }
    }
  }

  /** PGH's bridge models (js/world/graph-bridges.js, tools/pgh_bridges.mjs): built once; the tiles they stand in are
   *  rebuilt without the world's plain piers (and a ridden roadway's parapets) where a model stands. */
  _loadBridges() {
    if (!this.json.bridges || this._bridgesState) return;
    this._bridgesState = 'loading';
    fetch(new URL(`../../${this.json.bridges}`, import.meta.url)).then((r) => r.json())
      .then((bj) => import('./graph-bridges.js').then(({ buildGraphBridges }) => buildGraphBridges(this, bj)))
      .then((b) => {
        if (this.disposed) { b.dispose(); return; }
        this.bridges = b; this.bridgeMask = b.mask; this.scene.add(b.group);
        this.heroes?.addGlows?.(b.glows, 'Bridge lamps');
        for (const t of this.tiles.values()) if (t.built) this._release(t);
        this._bridgesState = 'ok';
        this.log('3d', `PGH bridges: ${b.count} models`, 'debug');
      })
      .catch((err) => { this._bridgesState = 'failed'; this.log('3d', `PGH bridges: ${err.message} ${(err.stack || '').split('\n').slice(0, 3).join(' | ')}`, 'error'); });
  }

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
    for (const m of [t.roadMesh, t.paintMesh, t.groundMesh, t.bankMesh, ...(t.extra || []), ...(t.extraRoad || [])]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    t.roadMesh = t.paintMesh = t.groundMesh = t.bankMesh = null; t.extra = []; t.extraRoad = [];
    t.built = false;
  }

  /** A way drawn smooth: a Catmull-Rom curve through its samples from a to b, SUB points a span:
   *  [{x, z, y, i (the sample, fractional), s (m from a), dx, dz}]. */
  _curve(e, a, b) {
    const out = [], P = (k) => Math.max(0, Math.min(e.n, k));
    let s = 0, px = null, pz = null;
    for (let i = a; i < b || (i === b && true); i++) {
      for (let q = 0; q < (i === b ? 1 : SUB); q++) {
        const t = q / SUB, i0 = P(i - 1), i1 = i, i2 = P(i + 1), i3 = P(i + 2);
        const cr = (v) => { const p0 = v[i0], p1 = v[i1], p2 = v[i2], p3 = v[i3]; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); };
        const x = i === b ? e.x[b] : cr(e.x), z = i === b ? e.z[b] : cr(e.z), y = i === b ? e.ele[b] : e.ele[i1] + (e.ele[i2] - e.ele[i1]) * t;
        if (px !== null) s += Math.hypot(x - px, z - pz);
        out.push({ x, z, y, i: i + t, s }); px = x; pz = z;
      }
      if (i === b) break;
    }
    for (let k = 0; k < out.length; k++) {
      const p0 = out[Math.max(0, k - 1)], p1 = out[Math.min(out.length - 1, k + 1)];
      let dx = p1.x - p0.x, dz = p1.z - p0.z; const l = Math.hypot(dx, dz) || 1; out[k].dx = dx / l; out[k].dz = dz / l;
    }
    return out;
  }

  /** How a way is painted: centre line, lane lines, edge lines (one-ways and lanes from the city data). */
  _paintOf(e) {
    const ow = this.city?.edgeInfo(e).ow || 0, lanes = this.city?.edgeInfo(e).lanes || 0;
    if (e.kind === 'path') return { centre: !e._rw && (e._w || 3) >= 3.4 ? 'dash-yellow' : null, edges: false, lanes: 0 };
    if (e.kind === 'plaza' || e.kind === 'alley') return { centre: null, edges: false, lanes: 0 };
    if (ow) return { centre: null, edges: e.kind !== 'residential', lanes: Math.max(1, lanes), oneway: true };
    if (e.kind === 'primary' || e.kind === 'secondary') return { centre: 'double', edges: true, lanes: 0 };
    if (e.kind === 'tertiary') return { centre: 'dash-yellow', edges: false, lanes: 0 };
    return { centre: null, edges: false, lanes: 0 };
  }

  _buildRoads(t) {
    t.built = true;
    if (!t.pieces.length && !t.nodes.length) return;
    const R = new Mesher(true), P = new Mesher(), W = new Mesher();
    const col = (k) => new THREE.Color(COLORS[k] || COLORS.residential);
    const side = col('side'), deckC = col('deck'), rail = col('rail'), under = col('under');
    const verge = new THREE.Color('#7b8556'), gravelC = new THREE.Color('#a59b84'), walkC = new THREE.Color('#b4afa4'), curbC = new THREE.Color('#c3beb3'), walkSide = new THREE.Color('#9d988e');
    for (const { e, a, b } of t.pieces) {
      const half = this.wOf(e) / 2, path = e.kind === 'path', walk = this.walkOf(e);
      const base = e._rw ? new THREE.Color('#a9a59c') : col(e.kind), lift = ROAD_LIFT + (path ? -0.03 : 0);
      const deck = new Uint8Array(e.n + 1);
      for (const [p, q] of e.bridges) for (let i = p; i <= q; i++) deck[i] = 1;
      const bm = this.bridgeMask?.get(e.id);
      const C = this._curve(e, a, b), n = C.length;
      // the ends at a junction: no sidewalk, paint or shoulder inside the junction's disc
      const lenM = e.n * 10, r0 = (this.nodeWidth.get(e.from) || 7) / 2 * 1.15 + 0.6, r1 = (this.nodeWidth.get(e.to) || 7) / 2 * 1.15 + 0.6;
      const atS = (c) => c.i * 10;
      const L = [], Rt = [], cols = [], ext = [];
      for (const c of C) {
        const y = c.y + lift;
        L.push([c.x + c.dz * half, y, c.z - c.dx * half]);
        Rt.push([c.x - c.dz * half, y, c.z + c.dx * half]);
        const si = Math.round(c.i), surf = SURF_CODE[e._surf?.[si] || (e._rw ? 'concrete' : 'asphalt')] ?? 0;
        cols.push(surf === 0 || surf === 5 || surf === 6 ? base : surf === 3 ? new THREE.Color('#a7a399') : surf === 4 ? new THREE.Color('#a49c8f') : base);
        ext.push(surf);
      }
      for (let k = 0; k + 1 < n; k++) {
        const uv = (c, x) => [ext[k], x, c.s, half];
        R.quadX(L[k], Rt[k], Rt[k + 1], L[k + 1], cols[k], [uv(C[k], -half), uv(C[k], half), uv(C[k + 1], half), uv(C[k + 1], -half)]);
      }
      // the sides: a deck's slab and parapets; on the ground a curb and sidewalk, or a shoulder down to the ground
      for (let k = 0; k + 1 < n; k++) {
        const c0 = C[k], c1 = C[k + 1], i0 = Math.floor(c0.i), i1 = Math.min(e.n, Math.ceil(c1.i));
        const br = deck[i0] && deck[i1];
        const inJn = atS(c0) < r0 || atS(c1) > lenM - r1;
        for (const [S, flip, sgn] of [[L, false, 1], [Rt, true, -1]]) {
          const p0 = S[k], p1 = S[k + 1];
          const o0 = [c0.dz * sgn, -c0.dx * sgn], o1 = [c1.dz * sgn, -c1.dx * sgn];   // outward
          const out = (p, o, d, dy) => [p[0] + o[0] * d, p[1] + dy, p[2] + o[1] * d];
          if (br) {
            W.wall(p0, p1, -1.0, 0, deckC, flip);
            if (!(bm && (bm[i0] & 2) && (bm[i1] & 2))) W.wall(p0, p1, 0, 0.9, rail, flip);
            continue;
          }
          if (walk && !inJn) {
            W.wall(p0, p1, -0.05, 0.15, curbC, flip);                                                            // the curb's face
            W.quad(out(p0, o0, 0, 0.15), out(p1, o1, 0, 0.15), out(p1, o1, walk, 0.15), out(p0, o0, walk, 0.15), walkC, !flip);   // the sidewalk
            W.quad(out(p0, o0, walk, 0.15), out(p1, o1, walk, 0.15), out(p1, o1, walk, -1.4), out(p0, o0, walk, -1.4), walkSide, flip);
            continue;
          }
          // a shoulder: a gravel edge on a trail, then the verge sloping down to the ground, then a short face
          const band = path ? 0.35 : 0.2;
          W.quad(out(p0, o0, 0, -0.01), out(p1, o1, 0, -0.01), out(p1, o1, band, -0.06), out(p0, o0, band, -0.06), path ? gravelC : verge, !flip);
          W.quad(out(p0, o0, band, -0.06), out(p1, o1, band, -0.06), out(p1, o1, 1.6, -0.9), out(p0, o0, 1.6, -0.9), verge, !flip);
          // on an embankment, the slope runs on down (1 : 1.5) to meet the ground, then a short face below it
          const toe = (p, o) => { const q = out(p, o, 1.6, -0.9), gy = this.ground ? this._groundH(q[0], q[2]) : q[1] - 2; const drop = Math.max(0, q[1] - 0.2 - gy); const d = Math.min(9, drop * 1.5); return [out(p, o, 1.6 + d, -0.9 - d / 1.5), gy]; };
          const [ta, ga] = toe(p0, o0), [tb, gb] = toe(p1, o1);
          W.quad(out(p0, o0, 1.6, -0.9), out(p1, o1, 1.6, -0.9), tb, ta, verge, !flip);
          W.quad(ta, tb, [tb[0], Math.min(tb[1], gb) - 1.5, tb[2]], [ta[0], Math.min(ta[1], ga) - 1.5, ta[2]], verge, flip);
          W.wall(p0, p1, -0.6, -0.01, side, flip);
        }
        if (br) W.quad([L[k][0], L[k][1] - 1, L[k][2]], [Rt[k][0], Rt[k][1] - 1, Rt[k][2]], [Rt[k + 1][0], Rt[k + 1][1] - 1, Rt[k + 1][2]], [L[k + 1][0], L[k + 1][1] - 1, L[k + 1][2]], under, true);
      }
      // paint, clear of the junctions
      const paint = this._paintOf(e), yellow = new THREE.Color('#e3b53a'), white = new THREE.Color('#f2efe6');
      const line = (off, w, dashM, gapM, color) => {
        for (let k = 0; k + 1 < n; k++) {
          const c0 = C[k], c1 = C[k + 1], s0 = atS(c0), s1 = atS(c1);
          if (s0 < Math.max(PAINT_GAP, r0 + 1) || s1 > lenM - Math.max(PAINT_GAP, r1 + 1)) continue;
          if (ext[k] === 1 || ext[k] === 2) continue;   // (no paint on brick or setts)
          if (dashM && (c0.s % (dashM + gapM)) > dashM) continue;
          const A = { x: c0.x - c0.dz * off, y: c0.y + lift + 0.02, z: c0.z + c0.dx * off }, B = { x: c1.x - c1.dz * off, y: c1.y + lift + 0.02, z: c1.z + c1.dx * off };
          P.quad([A.x + c0.dz * w, A.y, A.z - c0.dx * w], [A.x - c0.dz * w, A.y, A.z + c0.dx * w], [B.x - c1.dz * w, B.y, B.z + c1.dx * w], [B.x + c1.dz * w, B.y, B.z - c1.dx * w], color);
        }
      };
      if (paint.centre === 'double') { line(-0.18, 0.06, 0, 0, yellow); line(0.18, 0.06, 0, 0, yellow); }
      else if (paint.centre === 'dash-yellow') line(0, path ? 0.05 : 0.07, path ? 3 : 3.3, path ? 6 : 6.7, yellow);
      if (paint.edges) { line(half - 0.35, 0.07, 0, 0, white); line(-(half - 0.35), 0.07, 0, 0, paint.oneway ? yellow : white); }
      if (paint.oneway && paint.lanes >= 2) for (let q = 1; q < paint.lanes; q++) line(-half + (2 * half) * q / paint.lanes, 0.06, 3, 9, white);
    }
    // junctions: a disc as wide as the widest way into it, a hair above the roads (one colour: no seams); crosswalks
    // where a main street meets two or more others among the buildings
    const white = new THREE.Color('#ece9de');
    for (const nd of t.nodes) {
      const w = this.nodeWidth.get(nd.id) || 7, r = w / 2 * 1.15, y = nd.y + ROAD_LIFT + 0.01;
      R.discX(nd.x, y, nd.z, r, col('residential'));
      const arms = (this.arms.get(nd.id) || []).filter((a) => a.e.kind !== 'path' && a.e.kind !== 'plaza');
      if (arms.length < 3 || !arms.some((a) => a.e.kind === 'primary' || a.e.kind === 'secondary' || a.e.kind === 'tertiary') || !arms.some((a) => a.e._walk)) continue;
      for (const { e, end } of arms) {
        const i0 = end ? e.n : 0, i1 = end ? e.n - 1 : 1, dx = e.x[i1] - e.x[i0], dz = e.z[i1] - e.z[i0], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
        const half = this.wOf(e) / 2, d = r + 1.6, cx = nd.x + ux * d, cz = nd.z + uz * d, yy = y + 0.015;
        for (let v = -half + 0.4; v < half - 0.3; v += 1.1) {
          const px = cx - uz * v, pz = cz + ux * v, qx = px - uz * 0.55, qz = pz + ux * 0.55;
          P.quad([px - ux * 1.4, yy, pz - uz * 1.4], [px + ux * 1.4, yy, pz + uz * 1.4], [qx + ux * 1.4, yy, qz + uz * 1.4], [qx - ux * 1.4, yy, qz - uz * 1.4], white);
        }
      }
    }
    t.roadMesh = R.mesh(this.mats.roadSurface);
    if (t.roadMesh) this.group.add(t.roadMesh);
    t.paintMesh = P.mesh(this.mats.paint);
    if (t.paintMesh) this.group.add(t.paintMesh);
    const sm = W.mesh(this.mats.road);
    if (sm) { this.group.add(sm); (t.extraRoad ||= []).push(sm); }
  }

  _buildGround(t) {
    const nx = Math.round(TILE / GROUND_CELL), x0 = t.i * TILE, z0 = t.j * TILE, cell = TILE / nx, n1 = nx + 1;
    const pos = new Float32Array(n1 * n1 * 3), color = new Float32Array(n1 * n1 * 3), landW = new Float32Array(n1 * n1);
    const grass = new THREE.Color('#89a868'), dry = new THREE.Color('#a7a27a'), bed = new THREE.Color('#6f6a58'), tmp = new THREE.Color();
    for (let j = 0, k = 0; j <= nx; j++) for (let i = 0; i <= nx; i++, k++) {
      const x = x0 + i * cell, z = z0 + j * cell, h = this._groundH(x, z), pool = this.poolAt(x, z);
      pos[3 * k] = x; pos[3 * k + 1] = h; pos[3 * k + 2] = z;
      const raw = this.ground.at(x, z), cutDepth = Math.max(0, raw - h);
      tmp.copy(h < pool ? bed : grass).lerp(dry, Math.min(1, cutDepth / 6));
      landW[k] = h < pool + 0.2 ? 0 : 1 - Math.min(1, cutDepth / 6) * 0.7;   // (the land cover's colour: not on the river bed, less on a cut)
      const v = 0.94 + 0.06 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(x * 0.007 - z * 0.011);
      color[3 * k] = tmp.r * v; color[3 * k + 1] = tmp.g * v; color[3 * k + 2] = tmp.b * v;
    }
    t.gridH = new Float32Array(n1 * n1); for (let k = 0; k < n1 * n1; k++) t.gridH[k] = pos[3 * k + 1];
    t.gridCell = cell;
    const idx = new Uint32Array(nx * nx * 6);
    for (let j = 0, q = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aLandW', new THREE.BufferAttribute(landW, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    t.groundMesh = new THREE.Mesh(g, this.mats.ground);
    this.group.add(t.groundMesh);
    this._buildBank(t);
  }

  /** The dressed places' ground in this tile (toolbox/materials/park-surfaces.js): lawns, beds, woods, plazas and walks
   *  draped on the ground; the fountain and pools; retaining walls and low walls in dressed stone; the trees. */
  _buildDressing(t) {
    const D = this.dressing, key = `${t.i},${t.j}`;
    const areas = D.areas.get(key) || [], lines = D.lines.get(key) || [], trees = D.trees.get(key) || [];
    if (!areas.length && !lines.length && !trees.length) return;
    const by = new Map(), grey = new THREE.Color('#ffffff');
    const mesher = (k) => { if (!by.has(k)) by.set(k, new Mesher()); return by.get(k); };
    // the surface here: the ground, or a walled bank's promenade over it
    // the ground as its mesh draws it (the 12.8 m grid's triangles, a → c → b, b → c → d), so a drape lies on it everywhere
    const meshH = (x, z) => {
      const tt = this.tiles.get(`${Math.floor(x / TILE)},${Math.floor(z / TILE)}`);
      if (!tt || !tt.gridH) return this._groundH(x, z);
      const c = tt.gridCell, n1 = Math.round(TILE / c) + 1, u = (x - tt.i * TILE) / c, v = (z - tt.j * TILE) / c;
      const i = Math.min(n1 - 2, Math.max(0, Math.floor(u))), j = Math.min(n1 - 2, Math.max(0, Math.floor(v))), fu = u - i, fv = v - j;
      const H = tt.gridH, a0 = H[j * n1 + i], b0 = H[j * n1 + i + 1], c0 = H[(j + 1) * n1 + i], d0 = H[(j + 1) * n1 + i + 1];
      return fu + fv <= 1 ? a0 + (b0 - a0) * fu + (c0 - a0) * fv : d0 + (c0 - d0) * (1 - fu) + (b0 - d0) * (1 - fv);
    };
    const surf = (x, z) => { const h = Math.max(this._groundH(x, z), meshH(x, z)), sh = this.shore?.at(x, z); return sh && sh.walled && sh.s >= 0 && sh.s <= BANK_CAP ? Math.max(h, sh.top + 0.03) : h; };
    const under = (x, z, y) => Math.min(y, this.cut.cap(x, z) + 0.2);   // (never over a road: its surface is ≥ 0.35 m over its cut)
    const drape = (M, tri, lift) => {
      const split = (a, b, c, depth) => {
        const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), bc = Math.hypot(b[0] - c[0], b[1] - c[1]), ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const m = Math.max(ab, bc, ca);
        if (m <= 4 || depth > 9) { const v = (p) => [p[0], under(p[0], p[1], surf(p[0], p[1]) + lift), p[1]]; M._tri(v(a), v(c), v(b), grey); return; }
        if (m === ab) { const d = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; split(a, d, c, depth + 1); split(d, b, c, depth + 1); }
        else if (m === bc) { const d = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; split(a, b, d, depth + 1); split(a, d, c, depth + 1); }
        else { const d = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; split(a, b, d, depth + 1); split(d, b, c, depth + 1); }
      };
      split(tri[0], tri[1], tri[2], 0);
    };
    const LIFT = { park: 0.22, wood: 0.25, scrub: 0.25, lawn: 0.28, garden: 0.31, plaza: 0.34 };   // (over the 12.8 m ground mesh's facets)
    for (const A of areas) {
      if (A.kind === 'fountain' || A.kind === 'pool') {
        // a basin: water a little under its granite rim, the rim a low dressed-stone kerb round it
        const h = Math.max(...A.pts.map(([x, z]) => surf(x, z))) + 0.2;   // (over the lawns draped round it)
        for (const tri of A.tris) mesher('water')._tri(...tri.map((p) => [p[0], h + 0.25, p[1]]).reverse(), grey);
        const R = mesher('rim'), F = mesher('rimFace');
        for (let i = 0; i + 1 < A.pts.length; i++) {
          const [p, q] = [A.pts[i], A.pts[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * A.wind, nz = dx / l * A.wind;
          const yi = h + 0.55, o = (pt, s) => [pt[0] + nx * s, yi, pt[1] + nz * s];
          R.quad(o(p, 0), o(q, 0), o(q, 1.4), o(p, 1.4), grey);
          F.quad([p[0], h - 0.2, p[1]], [q[0], h - 0.2, q[1]], [q[0], yi, q[1]], [p[0], yi, p[1]], grey);
        }
        if (A.kind === 'fountain') {   // the Point's jet: up to ~45 m on a summer day
          const [cx, cz] = A.centre, sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.2, 40, 14, 1, true), this.mats.spray);
          sp.position.set(cx, h + 20, cz); (t.extra ||= []).push(sp); this.group.add(sp);
        }
        continue;
      }
      const mat = A.kind === 'park' ? 'lawn' : A.kind;
      for (const tri of A.tris) drape(mesher(mat), tri, LIFT[A.kind] ?? 0.06);
    }
    for (const Ln of lines) {
      const P = Ln.pts;
      if (Ln.kind === 'walk' || Ln.kind === 'steps') {
        const half = Ln.width / 2, M = mesher(Ln.kind === 'steps' ? 'granite' : 'walk');
        for (let i = 0; i + 1 < P.length; i++) {
          const [p, q] = [P[i], P[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * half, nz = dx / l * half;
          drape(M, [[p[0] + nx, p[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz]], 0.38);
          drape(M, [[p[0] + nx, p[1] + nz], [q[0] - nx, q[1] - nz], [p[0] - nx, p[1] - nz]], 0.38);
        }
      } else {
        // a retaining wall from the low side's ground to a 0.4 m parapet over the high side; a low wall 0.9 m
        const W = mesher('wall');
        for (let i = 0; i + 1 < P.length; i++) {
          const [p, q] = [P[i], P[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
          if (l < 0.3) continue;
          const nx = -dz / l, nz = dx / l, side = (pt, s) => surf(pt[0] + nx * s, pt[1] + nz * s);
          const lowP = Math.min(side(p, 2.5), side(p, -2.5)), lowQ = Math.min(side(q, 2.5), side(q, -2.5));
          const topP = Ln.kind === 'wall' ? surf(p[0], p[1]) + 0.9 : Math.max(side(p, 2.5), side(p, -2.5)) + 0.4;
          const topQ = Ln.kind === 'wall' ? surf(q[0], q[1]) + 0.9 : Math.max(side(q, 2.5), side(q, -2.5)) + 0.4;
          const th = 0.2;
          for (const s of [th, -th]) W.quad([p[0] + nx * s, lowP - 0.2, p[1] + nz * s], [q[0] + nx * s, lowQ - 0.2, q[1] + nz * s], [q[0] + nx * s, topQ, q[1] + nz * s], [p[0] + nx * s, topP, p[1] + nz * s], grey);
          W.quad([p[0] + nx * th, topP, p[1] + nz * th], [q[0] + nx * th, topQ, q[1] + nz * th], [q[0] - nx * th, topQ, q[1] - nz * th], [p[0] - nx * th, topP, p[1] - nz * th], grey);
        }
      }
    }
    const mats = { water: this.mats.fountainWater, rim: this.mats.park.granite, rimFace: this.mats.parkWall, wall: this.mats.parkWall };
    for (const [k, M] of by) {
      const m = M.mesh(mats[k] || this.mats.park[k]);
      if (!m) continue;
      m.material.side = THREE.DoubleSide;
      if (this.mats.park[k] && k !== 'granite' || k === 'water') { const n = m.geometry.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); }   // (draped: lit as the flat ground it lies on, not facet by facet)
      (t.extra ||= []).push(m); this.group.add(m);
    }
    if (trees.length) {
      // the park's trees: a trunk and a broad crown each (the Point's planes, oaks and lindens), sized and tinted by seed
      const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0), crownG = new THREE.IcosahedronGeometry(1, 1);
      const T1 = new THREE.InstancedMesh(trunkG, this.mats.trunk, trees.length), T2 = new THREE.InstancedMesh(crownG, this.mats.crown, trees.length);
      const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), c = new THREE.Color();
      trees.forEach(([x, z], k) => {
        const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1, h = this._groundH(x, z), H = 5 + r * 5, R = 3 + r * 2.5;
        m4.compose(new THREE.Vector3(x, h, z), q4, new THREE.Vector3(1, H * 0.55, 1)); T1.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(x, h + H * 0.55 + R * 0.7, z), q4.setFromAxisAngle(UP, r * 6), new THREE.Vector3(R, R * 0.85, R)); T2.setMatrixAt(k, m4);
        T2.setColorAt(k, c.set('#4f7a35').offsetHSL((r - 0.5) * 0.04, 0, (r - 0.5) * 0.12));
      });
      for (const m of [T1, T2]) { (t.extra ||= []).push(m); this.group.add(m); }
    }
  }

  /** The riverbank along the shore lines in this tile: a stone face and a promenade where walled, a firm slope elsewhere. */
  _buildBank(t) {
    const x0 = t.i * TILE, z0 = t.j * TILE, M = new Mesher(), Face = new Mesher(), Prom = new Mesher(), Rail = new Mesher(), iron = new THREE.Color('#202325');
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
          Face.quad(a, b, tb, ta, stone);                                            // the wall's face (dressed stone)
          const pa = row(i, PROM_M, L.top[i] + 0.03), pb = row(i + 1, PROM_M, L.top[i + 1] + 0.03);
          Prom.quad(ta, tb, pb, pa, stone);                                          // the promenade's paving along the wall
          // the railing on the wall's edge: black iron, posts every 2.4 m, top and bottom rails, pickets
          {
            const ra = row(i, 0.25, L.top[i] + 0.03), rb = row(i + 1, 0.25, L.top[i + 1] + 0.03), seg = Math.hypot(rb[0] - ra[0], rb[2] - ra[2]);
            const at = (f, dy) => [ra[0] + (rb[0] - ra[0]) * f, ra[1] + (rb[1] - ra[1]) * f + dy, ra[2] + (rb[2] - ra[2]) * f];
            Rail.wall(at(0, 0), at(1, 0), 1.02, 1.1, iron, false); Rail.wall(at(0, 0), at(1, 0), 0.08, 0.14, iron, false);
            const np = Math.max(1, Math.round(seg / 0.32));
            for (let q = 0; q < np; q++) { const f0 = q / np, f1 = f0 + 0.04 / Math.max(seg, 0.1); Rail.quad(at(f0, 0.08), at(f1, 0.08), at(f1, 1.05), at(f0, 1.05), iron); }
            const nPost = Math.max(1, Math.round(seg / 2.4));
            for (let q = 0; q < nPost; q++) { const f0 = q / nPost, f1 = f0 + 0.09 / Math.max(seg, 0.1); Rail.quad(at(f0, 0), at(f1, 0), at(f1, 1.18), at(f0, 1.18), iron); }
          }
          if (!this.dressing?.inside(mx, mz)) M.quad(pa, pb, row(i + 1, BANK_CAP, L.top[i + 1] + 0.03), row(i, BANK_CAP, L.top[i] + 0.03), grass);   // then grass (a dressed place has its own)
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
      const half = this.wOf(e) / 2 - 0.4, pm = this.bridgeMask?.get(e.id);
      for (let i = Math.max(a, 1); i <= Math.min(b, e.n - 1); i++) {
        if (!deck[i] || toEnd[i] < 20 || i % PIER_STEP) continue;
        if (pm && pm[i] & 1) continue;   // a bridge model stands here (its own piers)
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
    t.extra = [Face.mesh(this.mats.riverWall), Prom.mesh(this.mats.park.granite), Rail.mesh(this.mats.road)].filter(Boolean);
    for (const m of t.extra) this.group.add(m);
    if (this.dressing) this._buildDressing(t);
  }
}

/** Triangles with flat colours, gathered then made one mesh. */
class Mesher {
  /** `road`: the road surface's attribute too (aRd: surface code, metres across from the centre, metres along, half width). */
  constructor(road = false) { this.pos = []; this.col = []; this.nrm = []; this.rd = road ? [] : null; }
  _tri(a, b, c, color, ra = null, rb = null, rc = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(color.r, color.g, color.b); this.nrm.push(nx, ny, nz); }
    if (this.rd) for (const r of [ra, rb, rc]) this.rd.push(...(r || ZERO4));
  }
  /** A road quad with its aRd per corner. */
  quadX(a, b, c, d, color, r) { this._tri(a, b, c, color, r[0], r[1], r[2]); this._tri(a, c, d, color, r[0], r[2], r[3]); }
  discX(x, y, z, r, color, seg = 14) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this._tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], color, [0, 0, 0, r], [0, 0, 0, r], [0, 0, 0, r]);
    }
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
    if (this.rd) g.setAttribute('aRd', new THREE.Float32BufferAttribute(this.rd, 4));
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

/** The dressed places (tools/pgh_dressing.mjs → <id>-dressing.json) in the local frame, by tile: areas triangulated, lines,
 *  trees. An area goes to every tile its box touches (each tile draws its own copy of it, clipped by nothing: a big
 *  lawn is drawn once, in the tile of its centre). */
export function decodeDressing(json, proj, tile) {
  const P = (p) => { const q = proj.toLocal(p[0], p[1]); return [q.x, q.z]; };
  const put = (map, x, z, item) => { const k = `${Math.floor(x / tile)},${Math.floor(z / tile)}`; (map.get(k) || map.set(k, []).get(k)).push(item); };
  const ORDER = ['park', 'wood', 'scrub', 'lawn', 'garden', 'plaza', 'pool', 'fountain'];
  const areas = new Map(), lines = new Map(), trees = new Map();
  for (const a of [...json.areas].sort((p, q) => ORDER.indexOf(p.kind) - ORDER.indexOf(q.kind))) {
    let pts = a.pts.map(P);
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts = pts.slice(0, -1);
    if (pts.length < 3) continue;
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []).map((t3) => t3.map((k) => pts[k]));
    const area2 = pts.reduce((s2, p, i) => { const q = pts[(i + 1) % pts.length]; return s2 + p[0] * q[1] - q[0] * p[1]; }, 0);
    const cx = pts.reduce((s2, p) => s2 + p[0], 0) / pts.length, cz = pts.reduce((s2, p) => s2 + p[1], 0) / pts.length;
    put(areas, cx, cz, { kind: a.kind, name: a.name, pts: [...pts, pts[0]], tris, centre: [cx, cz], wind: area2 > 0 ? 1 : -1 });
  }
  for (const l of json.lines) { const pts = l.pts.map(P), m = pts[Math.floor(pts.length / 2)]; put(lines, m[0], m[1], { ...l, pts }); }
  for (const p of json.trees) { const [x, z] = P(p); put(trees, x, z, [x, z]); }
  // the dressed places' extent (their 'park' areas): the bank's plain grass gives way to the dressing there
  const parks = json.areas.filter((a) => a.kind === 'park').map((a) => a.pts.map(P));
  const inside = (x, z) => parks.some((pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; });
  return { areas, lines, trees, inside };
}

// ---------------------------------------------------------------- surfaces
const NOISE_GLSL = /* glsl */`
  float gwH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gwN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(gwH(i), gwH(i + vec2(1., 0.)), f.x), mix(gwH(i + vec2(0., 1.)), gwH(i + vec2(1., 1.)), f.x), f.y); }
`;

/**
 * The roads' surface (aRd: surface code, metres across, metres along, half width): asphalt with grain, polished wheel
 * tracks, patches and sealed cracks that come and go by place (the Pittsburgh map's road-surface look); red paving
 * brick in running bond laid across the street; granite setts (Belgian block); concrete slabs with joints; pavers;
 * gravel and dirt. Patterns fade to their average when a brick is a few pixels, so nothing shimmers far off.
 */
function roadSurfaceMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aRd; varying vec4 vRd; varying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRd = aRd; vGW = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vRd; varying vec3 vGW;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 c = diffuseColor.rgb;
          int sf = int(vRd.x + .5);
          vec2 q = vRd.yz;
          float px = max(fwidth(q.y), fwidth(q.x)) + 1e-4, det = 1. - smoothstep(.015, .07, px);
          float wear = .25 + .65 * gwN(vGW.xz * .004 + 3.1);
          float track = 1. - smoothstep(0., .45, abs(abs(abs(q.x) - vRd.w * .5) - .85));
          if (sf == 1) {           // red paving brick, running bond, laid across
            float row = floor(q.y / .105), u = q.x / .215 + .5 * mod(row, 2.);
            vec2 cell = vec2(floor(u), row), f = vec2(fract(u), fract(q.y / .105));
            vec3 br = mix(vec3(.36, .16, .12), vec3(.5, .25, .18), gwH(cell)) * (.82 + .25 * gwH(cell + 7.));
            float mortar = max(1. - smoothstep(.0, .07, f.x) * smoothstep(.0, .07, 1. - f.x), 1. - smoothstep(.0, .12, f.y) * smoothstep(.0, .12, 1. - f.y));
            vec3 pat = mix(br, vec3(.16, .14, .13), mortar * .8);
            c = mix(vec3(.38, .2, .15), pat, det) * (1. - .14 * track);
            c = mix(c, vec3(.27, .28, .29), step(.9, gwN(vGW.xz * .3 + 5.)) * .85);   // an asphalt patch
            c = pow(c, vec3(2.2));
          } else if (sf == 2) {    // granite setts
            float row = floor(q.y / .16), u = q.x / .26 + .37 * mod(row, 3.);
            vec2 cell = vec2(floor(u), row), f = vec2(fract(u), fract(q.y / .16));
            vec3 st = vec3(.44, .43, .42) * (.78 + .32 * gwH(cell));
            float jt = max(1. - smoothstep(.0, .09, f.x) * smoothstep(.0, .09, 1. - f.x), 1. - smoothstep(.0, .12, f.y) * smoothstep(.0, .12, 1. - f.y));
            c = pow(mix(vec3(.4), mix(st, vec3(.2, .2, .19), jt * .8), det), vec3(2.2));
          } else if (sf == 3) {    // concrete slabs, joints every 4.5 m and down the middle
            float slab = floor(q.y / 4.5);
            c = c * (.94 + .1 * gwH(vec2(slab, floor(q.x / 3.)))) * (.95 + .08 * gwN(vGW.xz * 2.));
            float j = max(1. - smoothstep(0., .035, abs(fract(q.y / 4.5) - .5) * 4.5 - 2.22), 1. - smoothstep(0., .03, abs(q.x)));
            c *= 1. - .35 * j * det;
          } else if (sf == 4) {    // pavers
            vec2 cell = floor(vec2(q.x, q.y) / .6), f = fract(vec2(q.x, q.y) / .6);
            float jt = max(1. - smoothstep(0., .06, f.x) * smoothstep(0., .06, 1. - f.x), 1. - smoothstep(0., .06, f.y) * smoothstep(0., .06, 1. - f.y));
            c = mix(c, c * (.82 + .3 * gwH(cell)) * (1. - .4 * jt), det);
          } else if (sf == 5 || sf == 6) {   // gravel, dirt
            vec3 g = sf == 5 ? vec3(.55, .51, .44) : vec3(.43, .36, .27);
            c = pow(g * (.8 + .35 * gwH(floor(vGW.xz * 14.)) * det + .15 * gwN(vGW.xz * 1.3)), vec3(2.2));
          } else {                 // asphalt
            float g = gwN(vGW.xz * 4.1) * .5 + gwN(vGW.xz * 19.) * .5;
            c *= .9 + .2 * mix(.5, g, det);
            c *= 1. - wear * .1 * track;                                                     // polished wheel tracks
            float pa = gwN(vGW.xz * .09 + 7.3);
            c = mix(c, c * 1.16, step(.74 - wear * .12, pa) * .7);                           // patches
            float cr = abs(gwN(vGW.xz * .55 + 11.) - .5);
            c *= 1. - wear * .22 * step(.62, gwN(vGW.xz * .05 + 2.)) * (1. - smoothstep(.0, .01, cr)) * det;   // sealed cracks (in the worn places)
            c *= 1. - .08 * (1. - smoothstep(0., .5, vRd.w - abs(q.x)));                     // the edge, darker
          }
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => 'pgh-road-surface-1';
  return m;
}

/**
 * The ground: its vertex colour (grass, cut slopes, river bed), and over it the city's land cover (aLandW: how much)
 * from a texture of codes (js/world/graph-city.js LAND): paved lots and yards, lawns and parks, the woods' floor,
 * plazas, sand — with a little noise in the edges so they aren't the grid's.
 */
function groundMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const blank = new THREE.DataTexture(new Uint8Array([1]), 1, 1, THREE.RedFormat); blank.needsUpdate = true;
  const U = { uLand: { value: blank }, uLandBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uLandOn: { value: 0 } };
  m.userData.land = U;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLandW; varying float vLandW; varying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandW = aLandW; vGW = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uLand; uniform vec4 uLandBox; uniform float uLandOn; varying float vLandW; varying vec3 vGW;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uLandOn > .5 && vLandW > .01) {
          vec2 size = uLandBox.zw - uLandBox.xy;
          vec2 uv = (vGW.xz - uLandBox.xy) / size + (vec2(gwN(vGW.xz * .21), gwN(vGW.xz * .21 + 19.)) - .5) * 4. / size;
          float k = floor(texture2D(uLand, uv).r * 255. + .5);
          float n = gwN(vGW.xz * .35) * .6 + gwN(vGW.xz * 2.3) * .4;
          vec3 lc = vec3(-1.);
          if (k < .5) lc = mix(vec3(.43, .42, .4), vec3(.52, .5, .47), n);                   // paved: lots, yards of the works
          else if (k < 1.5) lc = mix(vec3(.38, .52, .24), vec3(.47, .6, .3), n);             // grass, parks
          else if (k < 2.5) lc = mix(vec3(.25, .3, .17), vec3(.36, .35, .22), n);            // the woods' floor
          else if (k < 4.5 && k > 3.5) lc = vec3(.42, .4, .36);                               // under a building
          else if (k < 5.5 && k > 4.5) lc = vec3(.66, .6, .46);                               // sand, bare rock
          else if (k < 6.5 && k > 5.5) lc = mix(vec3(.62, .59, .54), vec3(.68, .65, .6), n);  // plaza
          else if (k < 7.5 && k > 6.5) lc = mix(vec3(.3, .42, .22), vec3(.38, .44, .25), n);  // beyond: suburbs and hills
          else if (k > 7.5) lc = mix(vec3(.4, .54, .27), vec3(.5, .58, .33), n);             // yards: lawns
          if (lc.x >= 0.) diffuseColor.rgb = mix(diffuseColor.rgb, pow(lc, vec3(2.2)) * clamp(diffuseColor.rgb / vec3(.25, .39, .14), .6, 1.4), vLandW * .85);
        }`);
  };
  m.customProgramCacheKey = () => 'pgh-ground-land-1';
  return m;
}
