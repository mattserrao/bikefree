// The endless map's 3D world (user, 24 Nov 2026: "use the building blocks to create an endless map … progress through
// different biomes and utilize high quality post processing and lighting effects"; chose all six biomes in a seeded
// sequence, moderate grades, a slow day cycle). Built only from the toolbox's shared blocks:
//   rules      the map profile's defaults (toolbox/map-profile.js: CNY's and SKAN's — worn upstate roads, the verge)
//   road       the graph maps' road surface and worn paint (graph-world.js roadSurfaceMaterial, wornPaintMaterial)
//   trees      the tree engine (one for the game) with the endless kit (upstate + the other biomes' species), planted
//              through the planting API
//   buildings  the building engine (house engine for the farmhouses, the kit for barns and sheds), planned by the
//              kit's recipe planner from footprints laid beside the road
//   sky        the sky dome; the shared effects (water: ripples, sky reflection, glitter; atmosphere: sun beams, mist,
//              motes, birds)
//   light      a live sun that moves through the day (morning → midday → golden hour, then a dusk and a new dawn) with a
//              shadow map round the rider; on desktop High the post pipeline (contact shading, bloom, grade)
// The course (js/endless/course.js) is generated ahead of the rider; a terrain change at a mile mark regenerates the road
// past it, and the tiles out there ease to their new shape over a second and a half.
import * as THREE from '../../vendor/three.js';
import { lockedChase, CAMERAS, CHASE, DEFAULT_CAMERA, leanAlong, stepLean } from './pose.js';
import { loadRider, RIDER_RIM } from './rider.js';
import { makeSkyDome } from './toolbox/atmosphere/sky-dome.js';
import { PostFX } from './toolbox/atmosphere/post.js';
import { installEffects } from './toolbox/effects/index.js';
import { mapProfile } from './toolbox/map-profile.js';
import { TreeEngine } from './toolbox/vegetation/tree-engine.js';
import { treeRecord, plantTile } from './toolbox/vegetation/planting.js';
import { makeEndlessTrees } from './toolbox/vegetation/endless-trees.js';
import { BIOME_DEFS, pickWeighted } from './toolbox/landscape/biomes.js';
import { NOISE_GLSL } from './toolbox/materials/glsl-noise.js';
import { buildBuilding } from './toolbox/structures/building-engine.js';
import { planBuildings } from './toolbox/structures/buildings/recipe.js';
import { Writer, NullWriter } from './toolbox/structures/buildings/assemble.js';
import { makeFacadeMaterial } from './toolbox/structures/buildings/facade-material.js';
import { dress } from './toolbox/structures/buildings/kit.js';
import { SURFACE_SUN, loadSurfaceDetail } from './toolbox/materials/surface-detail.js';
import { roadSurfaceMaterial, wornPaintMaterial, makeStandIn, CLOUD_T } from './graph-world.js';
import { biomeAt, MILE_M, STEP, rng } from '../endless/course.js';

// [zwift-look] the near band (m): trees inside it drawn as their grown models (leaf clusters, limbs), cards beyond
const ENDLESS_NEAR_M = 55;
const MOBILE = (() => { try { const ua = navigator.userAgent || ''; return /iPhone|iPad|iPod|Android|Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); } catch { return false; } })();
const TILE = 256;
const CHUNK = 20;                              // road samples per road mesh (200 m)
const HALF = 3.3, LANE = -1.6;                 // the road's half width; the rider's lane (+ is the course's right normal, which draws on screen left: the rider keeps right)
const PIXEL_RATIO = { low: 1, balanced: 1.5, high: 2 };
// how far things are built, by quality (Low: phones — the memory cap)
const REACH = { low: { near: 520, far: 1700, trees: 520, road: 1800 }, balanced: { near: 760, far: 2600, trees: 800, road: 2800 }, high: { near: 900, far: 3000, trees: 950, road: 3200 } };
const MORPH_S = 1.5;
const CYCLE_S = 100 * 60;                       // a day in 100 minutes
const LAND = { grass: 1, woods: 2, water: 3, crops: 10 };

// the day: keyframes through the cycle (0–1): the sun's height and bearing, and the light's colours
const DAY = [
  { at: 0.00, elev: 3, az: 92, sky: '#9fb3cf', fog: '#e6c9b0', hemiSky: '#f1dcc6', hemiGround: '#7f7768', sun: '#ffc48a', sunI: 1.1, hemiI: 1.0, exposure: 0.95 },
  { at: 0.10, elev: 16, az: 105, sky: '#9cc0e6', fog: '#e8dccb', hemiSky: '#f6eedf', hemiGround: '#8e8a78', sun: '#ffe2b8', sunI: 1.6, hemiI: 1.2, exposure: 1.0 },
  { at: 0.40, elev: 55, az: 185, sky: '#7fb0e0', fog: '#cfdde8', hemiSky: '#ffffff', hemiGround: '#a39b88', sun: '#ffffff', sunI: 1.8, hemiI: 1.25, exposure: 1.0 },
  { at: 0.65, elev: 34, az: 232, sky: '#86afdb', fog: '#d6dbe0', hemiSky: '#fff6ea', hemiGround: '#9c9280', sun: '#fff0d8', sunI: 1.75, hemiI: 1.2, exposure: 1.0 },
  { at: 0.86, elev: 14, az: 252, sky: '#a3b6d6', fog: '#e7cfb2', hemiSky: '#ffe8cf', hemiGround: '#7d725e', sun: '#ffcf92', sunI: 2.2, hemiI: 1.1, exposure: 1.1 },   // golden hour (CNY's)
  { at: 0.94, elev: 2, az: 262, sky: '#7d86ad', fog: '#d9a988', hemiSky: '#e7c3b0', hemiGround: '#5e5650', sun: '#ff9e6a', sunI: 1.0, hemiI: 0.85, exposure: 1.05 },  // sunset
  { at: 0.97, elev: -6, az: 270, sky: '#2d3a5c', fog: '#55607a', hemiSky: '#7c88a8', hemiGround: '#34343d', sun: '#9aa8d0', sunI: 0.2, hemiI: 0.6, exposure: 1.15 },   // dusk (the new day begins)
  { at: 1.00, elev: 3, az: 92, sky: '#9fb3cf', fog: '#e6c9b0', hemiSky: '#f1dcc6', hemiGround: '#7f7768', sun: '#ffc48a', sunI: 1.1, hemiI: 1.0, exposure: 0.95 },
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
function dayAt(f) {
  let i = 0; while (i < DAY.length - 2 && DAY[i + 1].at <= f) i++;
  const A = DAY[i], B = DAY[i + 1], t = Math.max(0, Math.min(1, (f - A.at) / (B.at - A.at || 1))), k = t * t * (3 - 2 * t);
  const L = (a, b) => a + (b - a) * k, C = (a, b) => '#' + _ca.set(a).lerp(_cb.set(b), k).getHexString();
  // the bearing goes the short way round (dusk → dawn: through the north, out of sight)
  let az = B.az - A.az; if (az > 180) az -= 360; if (az < -180) az += 360;
  return { elev: L(A.elev, B.elev), az: A.az + az * k, sky: C(A.sky, B.sky), fog: C(A.fog, B.fog), hemiSky: C(A.hemiSky, B.hemiSky), hemiGround: C(A.hemiGround, B.hemiGround),
    sun: C(A.sun, B.sun), sunI: L(A.sunI, B.sunI), hemiI: L(A.hemiI, B.hemiI), exposure: L(A.exposure, B.exposure), golden: f > .78 && f < .95 };
}

// value noise on the CPU (the same shape as the shader's: NOISE_GLSL)
const fract = (x) => x - Math.floor(x);
const h21 = (x, y) => { let px = fract(x * 123.34), py = fract(y * 456.21); const d = px * (px + 45.32) + py * (py + 45.32); px += d; py += d; return fract(px * py); };
function vn(x, y) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }
function fbm(x, y, o = 4) { let a = .5, s = 0; for (let k = 0; k < o; k++) { s += a * vn(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= .5; } return s; }
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export class EndlessWorld {
  constructor(container, base, opts = {}) {
    this.container = container;
    this.route = base; this.ride = base.endlessRide;   // (the course: this.route.course — a reset replaces it)
    this.log = opts.log || (() => {});
    this.path = null; this.areaSet = null; this.endlessWorld = true;
    this.qualityKey = ['low', 'balanced', 'high'].includes(opts.quality) ? opts.quality : MOBILE ? 'low' : 'balanced';
    this.startQuality = this.qualityKey;
    this.weatherKey = 'clear'; this.timeKey = 'cycle';
    this.p = 0; this.crank = 0; this.running = false; this.source = null; this.pacerSource = null;
    this.gfx = {};
    // the rules: the map profile's defaults — CNY's and SKAN's
    this.profile = mapProfile({});
    this.R = REACH[this.qualityKey];

    this.renderer = new THREE.WebGLRenderer({ antialias: this.qualityKey !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.qualityKey]));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = this.qualityKey !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(this.renderer.domElement);
    this.renderer.domElement.className = 'world-canvas';
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#cfdde8', 400, this.R.far * 0.95);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 7000);
    this.camTarget = new THREE.Vector3(); this._camInit = false; this.camKey = DEFAULT_CAMERA;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    if (this.renderer.shadowMap.enabled) {
      this.sun.castShadow = true;
      const sz = this.qualityKey === 'high' && !MOBILE ? 2048 : 1024, sh = this.sun.shadow;
      sh.mapSize.set(sz, sz); sh.bias = -0.0005; sh.normalBias = 0.04;
      Object.assign(sh.camera, { near: 1, far: 3000, left: -60, right: 60, top: 60, bottom: -60 }); sh.camera.updateProjectionMatrix();
    }
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sky = makeSkyDome({ radius: 6000 }); this.scene.add(this.sky.mesh);
    this.group = new THREE.Group(); this.group.name = 'Endless'; this.scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uSunDir: SURFACE_SUN };
    this.treeTime = { value: 0 };
    const low = this.qualityKey === 'low';
    this.mats = {
      ground: groundMaterial(low),
      road: roadSurfaceMaterial(low, this.profile.roads === 'worn'),
      paint: this.profile.roads === 'worn' ? wornPaintMaterial() : new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      water: new THREE.MeshLambertMaterial({ color: '#3f6f86', transparent: true, opacity: 0.93 }),
      ice: new THREE.MeshLambertMaterial({ color: '#dfeaf0' }),
      facade: makeFacadeMaterial(this.uniforms),
    };
    if (!low) loadSurfaceDetail(this.renderer);
    // the sea (the coast's): a plane at sea level that follows the camera
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), this.mats.water);
    this.sea.name = 'Sea'; this.sea.position.y = 0; this.sea.visible = false; this.scene.add(this.sea);
    // the shared effects (the same registry the free-ride maps use)
    this.city = { forest: null, landAt: (x, z) => this._landAt(x, z) };
    this.effects = installEffects(this, { water: {}, atmosphere: {}, grade: { saturation: 1.1, contrast: .1, warm: .3, lift: .02, sun: 1.12, sky: .9 } });   // ([zwift-look] the grade)

    this.tiles = new Map(); this.roads = new Map(); this.homes = new Map(); this.morphs = [];
    this._lakeCache = new Map();
    this.ride.addEventListener('change', this._onChange = (e) => this._invalidate(e.fromS ?? 0, !!e.grown));

    // the trees: the endless kit, grown once (a second or two) behind the loader
    this._treesState = 'loading';
    setTimeout(() => {
      if (this.disposed) return;
      try {
        this.kit = makeEndlessTrees();
        this.forest = new TreeEngine({ renderer: this.renderer, parent: this.group, quality: this.qualityKey, uTime: this.treeTime, lights: { hemi: this.hemi, sun: this.sun }, kit: this.kit, near: (MOBILE ? .6 : 1) * ENDLESS_NEAR_M });
        this.city.forest = this.forest;
        this._treesState = 'ok';
        for (const t of this.tiles.values()) t.planted = false;
      } catch (err) { this._treesState = 'failed'; this.log('3d', `Endless trees: ${err.message}`, 'error'); }
    }, 30);

    this.rider = makeStandIn(); this.scene.add(this.rider.group); this._riderModel = 'loading';
    loadRider().then((r) => { this._riderModel = 'ok'; if (this.disposed) return; this.scene.remove(this.rider.group); this.rider = r; this.scene.add(r.group); })
      .catch((err) => { this._riderModel = 'failed'; this.log('3d', `Using the simple rider: ${err.message}`, 'debug'); });

    this._t0 = performance.now();
    this.dayAt = 0.12;   // (a ride starts in the morning)
    this._applyDay(this.dayAt);
    this._resize = () => {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.post?.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    };
    this._ro = new ResizeObserver(this._resize); this._ro.observe(container);
    this._resize();
    this._frame = this._frame.bind(this);
    this._last = performance.now();
  }

  get course() { return this.route.course; }

  // ---------- the app's World API ----------
  setSource(fn) { this.source = fn; }
  setPacerSource(fn) { this.pacerSource = fn; }
  setPath() {}
  setCourseMarks() {}
  setPreload(on) { this._preload = !!on; }
  get waitingForArea() { return false; }
  weatherOptions() { return [{ key: 'clear', label: 'Clear' }]; }
  setWeather(key) { this.weatherKey = key; }
  timeOptions() { return [{ key: 'cycle', label: 'Day cycle' }]; }
  setTimeOfDay() { this.timeKey = 'cycle'; }
  setQuality(key) { this.qualityKey = key || this.qualityKey; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.qualityKey] ?? 1.5)); this._resize(); }
  setGfx(g = {}) { this.gfx = { ...g }; this._leafy = null; }
  setCamera(key) { this.camKey = CAMERAS[key] ? key : DEFAULT_CAMERA; this._camInit = false; }
  togglePerf() {}
  start() { if (this.running || this.disposed) return; this.running = true; this._last = performance.now(); this._raf = requestAnimationFrame(this._frame); }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
  renderOnce() { const r = this.running; this.running = true; this._frame(performance.now()); this.running = r; cancelAnimationFrame(this._raf); }
  readiness() {
    const steps = [], add = (key, label, p) => { p = Math.max(0, Math.min(1, p)); steps.push({ key, label, p, done: p >= 1 }); };
    const near = this._nearKeys || [], roads = this._nearRoads || [];
    add('streets', 'Road', roads.length ? roads.filter((k) => this.roads.get(k)?.mesh).length / roads.length : 0);
    add('ground', 'Ground', near.length ? near.filter((k) => this.tiles.get(k)?.mesh).length / near.length : 0);
    add('trees', 'Trees', this._treesState === 'loading' ? 0 : near.length ? near.filter((k) => this.tiles.get(k)?.planted || this._treesState !== 'ok').length / near.length : 1);
    add('riders', 'Rider', this._riderModel !== 'loading' ? 1 : 0);
    return { ready: steps.every((s) => s.done), failed: false, progress: steps.reduce((a, s) => a + s.p, 0) / steps.length, steps };
  }
  get loading() { return this._queued > 4 ? 4 : 0; }

  // ---------- the land ----------
  /** The nearest road sample to (x, z): { i, d (m, + right of the road), s }. The road only goes forward (course.js). */
  _near(x, z) {
    const C = this.course, n = C.n;
    let i = Math.min(n - 1, C.indexAtZ(z));
    const w = Math.min(600, Math.ceil(Math.abs(x - C.x[i]) * 0.95 / STEP) + 3), step = w > 40 ? 4 : 1;
    let best = i, bd = Infinity;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k += step) { const dx = x - C.x[k], dz = z - C.z[k], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = k; } }
    if (step > 1) for (let k = Math.max(0, best - step); k <= Math.min(n - 1, best + step); k++) { const dx = x - C.x[k], dz = z - C.z[k], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = k; } }
    const h = C.heading[best];
    return { i: best, s: best * STEP, d: (x - C.x[best]) * Math.cos(h) - (z - C.z[best]) * Math.sin(h) };
  }
  _biome(s) { const b = biomeAt(this.course.plan, s); return { A: BIOME_DEFS[b.a], B: BIOME_DEFS[b.b], t: b.t, a: b.a, b: b.b }; }
  /** The coast's sea side for a stretch (+1 right, −1 left): seeded per biome stint. */
  _seaSide(s) { const P = this.course.plan; let i = 0; while (i < P.length - 1 && P[i].to <= s) i++; return h21(i * 3.1 + this.course.seed, 7.7) < .5 ? -1 : 1; }
  /** The lakes beside the road near s: [{ x, z, r, level, frozen }], seeded per 400 m block. */
  _lakesNear(s) {
    const out = [], b0 = Math.floor(s / 400);
    for (let b = b0 - 2; b <= b0 + 2; b++) { const L = this._lake(b); if (L) out.push(L); }
    return out;
  }
  _lake(b) {
    if (b < 2) return null;
    if (this._lakeCache.has(b)) return this._lakeCache.get(b);
    const r = rng(this.course.seed * 9301 + b * 49297), sc = (b + .2 + r() * .6) * 400, i = Math.round(sc / STEP);
    let L = null;
    if (i < this.course.n) {
      const bi = this._biome(sc), def = bi.t < .5 ? bi.A : bi.B;
      if (r() < def.lakes * .5 && def.lakeR) {
        const side = r() < .5 ? -1 : 1, R = def.lakeR * (.6 + r() * .7), C = this.course, h = C.heading[i], off = R + 26 + r() * 30;
        const x = C.x[i] + Math.cos(h) * off * side, z = C.z[i] - Math.sin(h) * off * side;
        // (its level 2.2 m under the road wherever the road passes near its water — the disc reaches 1.25 r — not just at
        //  its own station: a road dipping or bending toward it ran under the water, the map QC's sweep, 25 Nov)
        //  — a lake that would have to sit over a metre lower than that for it is left out: its bowl would cut a cliff
        //  beside the road's high side)
        let level = C.ele[i] - 2.2;
        const reach = R * 1.25 + 14, k = Math.ceil((off + reach) / STEP);
        for (let j = Math.max(0, i - k); j <= Math.min(C.n - 1, i + k); j++) if (Math.hypot(C.x[j] - x, C.z[j] - z) < reach) level = Math.min(level, C.ele[j] - 2.2);
        if (C.ele[i] - 2.2 - level <= 1) L = { x, z, r: R, level, frozen: !!def.frozen, s: sc, side };
      }
    }
    this._lakeCache.set(b, L);
    return L;
  }
  /** Ground height and what it is at (x, z). */
  _ground(x, z, nr = this._near(x, z)) {
    const C = this.course, e = C.ele[nr.i], ad = Math.abs(nr.d), bi = this._biome(nr.s);
    const rel = (def) => this._relief(def, x, z, nr.d, ad, e, nr.s);
    let h = bi.t <= 0 ? rel(bi.A) : bi.t >= 1 ? rel(bi.B) : lerp(rel(bi.A), rel(bi.B), bi.t);
    // the road's bed: flat under the road and its shoulder, a shallow ditch, then the land
    h *= sm(5.2, 13, ad);
    h -= 0.55 * sm(4.8, 6.5, ad) * (1 - sm(7.5, 10.5, ad));
    let y = e + h - (ad < 5.2 ? 0.22 : 0);
    let water = null;
    for (const L of this._lakesNear(nr.s)) {
      const dl = Math.hypot(x - L.x, z - L.z) / (L.r * (1 + .18 * (vn(x / 60, z / 60) - .5)));
      if (dl < 1.6) {
        const bottom = L.level - 1 - 5 * (1 - Math.min(1, dl));
        const k = 1 - sm(.85, 1.55, dl);
        y = lerp(y, Math.min(y, bottom), k * sm(8, 20, ad));
        if (dl < 1.05) water = L;
      }
    }
    return { y, e, d: nr.d, ad, s: nr.s, water, bi };
  }
  _relief(def, x, z, d, ad, e, s) {
    const R = def.relief;
    let h = R.near * (fbm(x / 230, z / 230, 3) - .42) * 2 * sm(8, 150, ad);
    if (R.far) {
      const n = fbm(x / 820 + 3.3, z / 820 + 1.7, 4);
      const ridge = R.peaks ? Math.pow(1 - Math.abs(2 * n - 1), 2.2) : n;
      h += R.far * ridge * sm(220, R.farW, ad);
    }
    if (R.walls) {
      const w = sm(R.wallAt, R.wallAt + 45, ad) * (.75 + .5 * fbm(x / 300, z / 300, 2));
      const raw = R.walls * w;
      h += Math.floor(raw / 14) * 14 * .7 + raw * .3;   // ledges: the mesas' layers
    }
    if (R.sea) {
      const side = this._seaSide(s), sd = d * side;
      // the sea side: the hills give way to a bluff falling toward the water, then the cliff
      if (sd > 10) { const k = sm(10, R.seaAt, sd); h = h * (1 - k) - 8 * k; }
      if (sd > R.seaAt) h = lerp(h, this.course.seaLevel(s) - 12 - e, sm(R.seaAt, R.seaAt + 140 + 60 * vn(x / 90, z / 90), sd));
    }
    return h;
  }
  surfaceH(x, z) { return this._ground(x, z).y; }
  heightAt(x, z) { return this._ground(x, z).y; }
  poolAt(x, z) { const g = this._ground(x, z); return g.water ? g.water.level : -1e9; }
  waterTop(x, z) { return this.poolAt(x, z); }
  _landAt(x, z) {
    const g = this._ground(x, z);
    if (g.water) return LAND.water;
    const def = g.bi.t < .5 ? g.bi.A : g.bi.B;
    if (def.fields && g.ad > 30 && fbm(x / 260, z / 260, 2) > .45) return LAND.crops;
    return fbm(x / 180 + 9, z / 180 + 9, 3) < def.trees.cover ? LAND.woods : LAND.grass;
  }

  // ---------- streaming ----------
  _wanted(cam) {
    const R = this.R, out = [], i0 = Math.floor((cam.x - R.far) / TILE), i1 = Math.floor((cam.x + R.far) / TILE), j0 = Math.floor((cam.z - R.far) / TILE), j1 = Math.floor((cam.z + R.far) / TILE);
    const zMax = this.course.z[this.course.n - 1] - 150;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cx = (i + .5) * TILE, cz = (j + .5) * TILE, dc = Math.hypot(cx - cam.x, cz - cam.z);
      if (dc > R.far + TILE * .7 || cz - TILE / 2 > zMax) continue;
      const nr = this._near(cx, cz);
      if (Math.abs(nr.d) > R.far * .9) continue;
      out.push({ key: `${i},${j}`, i, j, dc, fine: dc < R.near + TILE * .5 });
    }
    return out.sort((a, b) => a.dc - b.dc);
  }
  _stream(cam, budgetMs) {
    const t0 = performance.now(), want = this._wanted(cam), keep = new Set(want.map((w) => w.key));
    this._nearKeys = want.filter((w) => w.dc < this.R.near * .6).map((w) => w.key);
    for (const [k, t] of this.tiles) if (!keep.has(k)) this._releaseTile(t);
    // the road ahead and behind
    const s = this.p, c0 = Math.max(0, Math.floor((s - 600) / (CHUNK * STEP))), c1 = Math.floor(Math.min(this.course.length - 1, s + this.R.road) / (CHUNK * STEP));
    this._nearRoads = [];
    for (let c = c0; c <= c1; c++) if (c * CHUNK * STEP < s + 700) this._nearRoads.push(c);
    for (const [c, r] of this.roads) if (c < c0 - 1 || c > c1 + 1) this._releaseRoad(c, r);
    let queued = 0;
    for (let c = Math.max(0, Math.floor(s / (CHUNK * STEP)) - 1); c <= c1; c++) {
      const r = this.roads.get(c);
      if (r?.mesh && !r.dirty) continue;
      queued++;
      if (performance.now() - t0 < budgetMs) this._buildRoad(c);
    }
    for (let c = c0; c <= c1; c++) if (!this.roads.get(c)?.mesh && performance.now() - t0 < budgetMs) this._buildRoad(c);
    for (const w of want) {
      let t = this.tiles.get(w.key);
      const need = !t || !t.mesh || t.dirty || t.fine !== w.fine;
      if (need) { queued++; if (performance.now() - t0 < budgetMs) { t = this._buildTile(w, t); } }
      if (t?.mesh && !t.planted && this.forest && w.dc < this.R.trees + TILE && performance.now() - t0 < budgetMs) this._plant(t);
      if (t?.mesh && t.planted && t.unplantFar && w.dc > this.R.trees + TILE * 1.5) { plantTile(this.forest, t.key, []); t.planted = false; t.unplantFar = false; }
    }
    // homes beside the road (per road chunk)
    for (const c of this._nearRoads.concat(this._aheadRoads(c1))) if (!this.homes.has(c) && performance.now() - t0 < budgetMs) this._buildHomes(c);
    for (const [c, h] of this.homes) if (c < c0 - 2 || c > c1 + 2) { h.mesh?.removeFromParent(); h.mesh?.geometry.dispose(); h.detail?.removeFromParent(); h.detail?.geometry.dispose(); this.homes.delete(c); }
    this._queued = queued;
  }
  _aheadRoads(c1) { const out = []; for (let c = Math.floor(this.p / (CHUNK * STEP)); c <= Math.min(c1, Math.floor((this.p + this.R.near) / (CHUNK * STEP))); c++) out.push(c); return out; }

  /** The course changed past fromS (a terrain choice), or grew: what lies past it is rebuilt (and eased into). */
  _invalidate(fromS, grown) {
    if (grown) return;   // (growth only adds road ahead: nothing built changes)
    this._lakeCache.clear();
    for (const [c, r] of this.roads) if ((c + 1) * CHUNK * STEP >= fromS) r.dirty = true;
    for (const t of this.tiles.values()) if (t.sMax >= fromS - 40) t.dirty = true;
    for (const [c, h] of this.homes) if ((c + 1) * CHUNK * STEP >= fromS) { h.mesh?.removeFromParent(); h.mesh?.geometry.dispose(); h.detail?.removeFromParent(); h.detail?.geometry.dispose(); this.homes.delete(c); }
  }

  // ---------- the road ----------
  _buildRoad(c) {
    const C = this.course, a = c * CHUNK, b = Math.min(C.n - 1, a + CHUNK);
    if (b <= a) return;
    const pos = [], col = [], nrm = [], rd = [], idx = [];
    const asphalt = new THREE.Color('#57595c');
    const P = [], Q = [];   // paint
    for (let i = a; i <= b; i++) {
      const h = C.heading[i], rx = Math.cos(h), rz = -Math.sin(h), y = C.ele[i] + .06, s = i * STEP;
      for (const side of [-1, 1]) { pos.push(C.x[i] + rx * HALF * side, y, C.z[i] + rz * HALF * side); col.push(asphalt.r, asphalt.g, asphalt.b); nrm.push(0, 1, 0); rd.push(0, HALF * side, s, HALF); }
    }
    for (let k = 0; k < b - a; k++) { const o = k * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aRd', new THREE.Float32BufferAttribute(rd, 4)); g.setIndex(idx);
    g.computeBoundingSphere();
    // the paint: a yellow centre line (dashed where you may pass), white edge lines
    const yellow = new THREE.Color('#d9b13a'), white = new THREE.Color('#e9e7df');
    const strip = (off, w, color, dash) => {
      for (let i = a; i < b; i++) {
        const s = i * STEP;
        if (dash && (s % 12) >= 4) continue;
        const pts = [i, i + 1].map((j) => { const h = C.heading[j], rx = Math.cos(h), rz = -Math.sin(h), y = C.ele[j] + .075; return [[C.x[j] + rx * (off - w), y, C.z[j] + rz * (off - w)], [C.x[j] + rx * (off + w), y, C.z[j] + rz * (off + w)]]; });
        const o = P.length / 3;
        for (const p of [pts[0][0], pts[0][1], pts[1][0], pts[1][1]]) { P.push(...p); Q.push(color.r, color.g, color.b); }
        idxP.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
      }
    };
    const idxP = [];
    const mile = Math.floor((a * STEP) / MILE_M), passing = this.course.mode(mile) !== 'climb' && this.course.mode(mile) !== 'descend';
    strip(0, .06, yellow, passing); if (!passing) { strip(-.14, .05, yellow, false); strip(.14, .05, yellow, false); }
    strip(-HALF + .25, .06, white, false); strip(HALF - .25, .06, white, false);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); pg.setAttribute('color', new THREE.Float32BufferAttribute(Q, 3)); pg.setIndex(idxP); pg.computeVertexNormals(); pg.computeBoundingSphere();
    const old = this.roads.get(c);
    if (old?.mesh && old.mesh.geometry.attributes.position.count === g.attributes.position.count && this._visibleSoon(old.mesh)) {
      this._morphTo(old.mesh, g); this._morphTo(old.paint, pg, true); old.dirty = false; return;
    }
    if (old) this._releaseRoad(c, old);
    const mesh = new THREE.Mesh(g, this.mats.road); mesh.receiveShadow = true; mesh.name = `Road ${c}`;
    const paint = new THREE.Mesh(pg, this.mats.paint); paint.receiveShadow = true;
    this.group.add(mesh, paint);
    this.roads.set(c, { mesh, paint, dirty: false });
  }
  _releaseRoad(c, r) { for (const m of [r.mesh, r.paint]) { if (!m) continue; m.removeFromParent(); m.geometry.dispose(); } this.roads.delete(c); }
  _visibleSoon(mesh) { const b = mesh.geometry.boundingSphere; return !!b && b.center.distanceTo(this.camera.position) < this.R.far; }
  /** Ease a mesh to a new geometry with the same vertices (a terrain choice reshaping what's already in view). */
  _morphTo(mesh, g, swapOnly = false) {
    if (!mesh) return;
    if (swapOnly || mesh.geometry.attributes.position.count !== g.attributes.position.count) { const old = mesh.geometry; mesh.geometry = g; old.dispose(); return; }
    const from = mesh.geometry.attributes.position.array.slice(), to = g.attributes.position.array;
    const old = mesh.geometry; mesh.geometry = g; old.dispose();
    const cur = g.attributes.position.array; cur.set(from); g.attributes.position.needsUpdate = true;
    this.morphs = this.morphs.filter((m) => m.g !== old);
    this.morphs.push({ g, from, to: to.slice(), t: 0 });
  }
  _tickMorphs(dt) {
    if (!this.morphs.length) return;
    for (const m of this.morphs) {
      m.t = Math.min(1, m.t + dt / MORPH_S);
      const k = m.t * m.t * (3 - 2 * m.t), a = m.g.attributes.position.array;
      for (let i = 1; i < a.length; i += 3) a[i] = m.from[i] + (m.to[i] - m.from[i]) * k;
      for (let i = 0; i < a.length; i += 3) { a[i] = m.to[i]; a[i + 2] = m.to[i + 2]; }
      m.g.attributes.position.needsUpdate = true;
      if (m.t >= 1) { m.g.computeVertexNormals?.(); m.g.computeBoundingSphere(); }
    }
    const done = this.morphs.filter((m) => m.t >= 1);
    this.morphs = this.morphs.filter((m) => m.t < 1);
    if (done.length) for (const t of this.tiles.values()) if (t.replant) { t.replant = false; t.planted = false; }
  }

  // ---------- the ground ----------
  _buildTile(w, t) {
    const n = w.fine ? (this.qualityKey === 'low' ? 25 : 33) : 13, cell = TILE / (n - 1), x0 = w.i * TILE, z0 = w.j * TILE;
    const verts = (n + 4) * n, pos = new Float32Array((n * n + 4 * n) * 3), col = new Float32Array((n * n + 4 * n) * 3), idx = [];
    let sMin = Infinity, sMax = -Infinity, k = 0;
    const water = new Map();
    const tmp = new THREE.Color();
    for (let jz = 0; jz < n; jz++) for (let ix = 0; ix < n; ix++) {
      const x = x0 + ix * cell, z = z0 + jz * cell, G = this._ground(x, z);
      sMin = Math.min(sMin, G.s); sMax = Math.max(sMax, G.s);
      pos[k * 3] = x; pos[k * 3 + 1] = G.y; pos[k * 3 + 2] = z;
      this._groundColor(x, z, G, tmp); col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      if (G.water) water.set(G.water, G.water);
      k++;
    }
    for (let jz = 0; jz < n - 1; jz++) for (let ix = 0; ix < n - 1; ix++) { const a = jz * n + ix, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    // skirts: a curtain down from each edge (no cracks where a fine tile meets a coarse one)
    const edges = [[...Array(n).keys()].map((i) => i), [...Array(n).keys()].map((i) => (n - 1) * n + i), [...Array(n).keys()].map((i) => i * n), [...Array(n).keys()].map((i) => i * n + n - 1)];
    for (const E of edges) {
      const base = k;
      for (const v of E) { pos[k * 3] = pos[v * 3]; pos[k * 3 + 1] = pos[v * 3 + 1] - 14; pos[k * 3 + 2] = pos[v * 3 + 2]; col[k * 3] = col[v * 3]; col[k * 3 + 1] = col[v * 3 + 1]; col[k * 3 + 2] = col[v * 3 + 2]; k++; }
      for (let q = 0; q < n - 1; q++) { const a = E[q], b = E[q + 1], c = base + q, d = base + q + 1; idx.push(a, b, c, b, d, c, a, c, b, b, c, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    g.computeVertexNormals(); g.computeBoundingSphere();
    if (!t) { t = { key: w.key, i: w.i, j: w.j }; this.tiles.set(w.key, t); }
    const morph = t.mesh && t.fine === w.fine && t.dirty && t.mesh.geometry.attributes.position.count === g.attributes.position.count && w.dc < this.R.far;
    if (morph) { this._morphTo(t.mesh, g); t.replant = !!t.planted; }
    else {
      if (t.mesh) { t.mesh.removeFromParent(); t.mesh.geometry.dispose(); }
      t.mesh = new THREE.Mesh(g, this.mats.ground); t.mesh.receiveShadow = true; t.mesh.name = `Ground ${w.key}`; this.group.add(t.mesh);
      if (t.planted) t.planted = false;
    }
    for (const m of t.water || []) { m.removeFromParent(); m.geometry.dispose(); }
    t.water = [];
    for (const L of water.values()) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(L.r * 1.25, 40).rotateX(-Math.PI / 2), L.frozen ? this.mats.ice : this.mats.water);
      m.position.set(L.x, L.level, L.z); m.name = 'Lake'; m.receiveShadow = true; this.group.add(m); t.water.push(m);
    }
    t.fine = w.fine; t.sMin = sMin; t.sMax = sMax; t.dirty = false; t.unplantFar = false;
    return t;
  }
  _groundColor(x, z, G, out) {
    const mix = (def) => {
      const P = def.ground, c = _cA;
      const n1 = fbm(x / 90, z / 90, 3), n2 = vn(x / 17, z / 17);
      c.set(P.grass).lerp(_cB.set(P.dry), sm(.45, .75, n1) * .8);
      if (def.fields && G.ad > 28) {
        // the patchwork: fields along the land's grain — corn gone tan, soybeans gold, hay green, a ploughed one brown
        const u = Math.floor((x * .8 + z * .6) / 150), v = Math.floor((-x * .6 + z * .8) / 95), f = h21(u, v);
        const crop = f < .3 ? '#c4ad62' : f < .5 ? '#d1b45a' : f < .75 ? '#8aa156' : f < .85 ? '#7a5e45' : null;
        if (crop) c.lerp(_cB.set(crop), .85 * sm(28, 45, G.ad));
      }
      // under the woods: the forest floor (litter, moss, needles), darker and browner than the open grass
      const cover = fbm(x / 180 + 9, z / 180 + 9, 3), wood = sm(def.trees.cover + .04, def.trees.cover - .06, cover) * sm(def.trees.edge, def.trees.edge + 14, G.ad);
      if (wood > 0) c.lerp(_cB.set(P.floor || '#4f4a33'), wood * (.65 + .2 * n2));
      const relH = G.y - G.e;
      if (def.relief.walls) c.lerp(_cB.set(P.rock), sm(def.relief.wallAt * .8, def.relief.wallAt + 30, G.ad) * (.75 + .25 * n2));
      if (def.relief.peaks) c.lerp(_cB.set(P.rock), sm(120, 320, relH) * .8);
      if (def.snowAbove != null) c.lerp(_cB.set(P.snow), def.snowAbove === 0 ? .93 - .12 * n2 * sm(.5, .7, n1) : sm(def.snowAbove, def.snowAbove + 120, relH + 40 * n1));
      if (def.relief.sea) { const sl = this.course.seaLevel(G.s); if (G.y < sl + 6) c.lerp(_cB.set(P.sand), sm(sl + 6, sl + 1, G.y)); }
      return c;
    };
    const A = mix(G.bi.A);
    if (G.bi.t > 0) { const a = _cC.copy(A); out.copy(a).lerp(mix(G.bi.B), G.bi.t); } else out.copy(A);
    // the road's edge: a sandy lip, then the mown verge (the profile's colour), as CNY's
    if (G.ad < 12) { const vA = G.bi.A.verge || this.profile.verge, vB = G.bi.B.verge || this.profile.verge; out.lerp(_cB.set(vA).lerp(_cD.set(vB), G.bi.t), sm(12, 7, G.ad) * .7); }
    if (G.ad < 5.4) out.lerp(_cB.set('#9d927c'), .9);
    if (G.water) out.lerp(_cB.set('#6b6450'), .6);
  }
  _releaseTile(t) {
    if (t.mesh) { t.mesh.removeFromParent(); t.mesh.geometry.dispose(); }
    for (const m of t.water || []) { m.removeFromParent(); m.geometry.dispose(); }
    if (this.forest && t.planted) plantTile(this.forest, t.key, []);
    this.tiles.delete(t.key);
  }

  // ---------- the trees (the planting API → the tree engine) ----------
  _plant(t) {
    const out = [], x0 = t.i * TILE, z0 = t.j * TILE, r = rng((t.i * 73856093) ^ (t.j * 19349663) ^ this.course.seed), gap = this.qualityKey === 'low' ? 13 : 10;
    const has = (sp) => this.forest.index.has(`${sp}:0`);
    for (let gz = 0; gz < TILE; gz += gap) for (let gx = 0; gx < TILE; gx += gap) {
      const x = x0 + gx + r() * gap, z = z0 + gz + r() * gap, u = r(), u2 = r(), u3 = r();
      const nr = this._near(x, z), ad = Math.abs(nr.d);
      if (ad < 5) continue;
      const bi = this._biome(nr.s), def = u < bi.t ? bi.B : bi.A, T = def.trees;
      if (ad < T.edge) continue;
      const cover = fbm(x / 180 + 9, z / 180 + 9, 3);
      // woods where the noise says; a hedgerow along the fields' edges (farmland); lone trees in the open now and then
      let wooded = cover < T.cover;
      if (def.fields && !wooded) { const fu = (x * .8 + z * .6) / 150, fv = (-x * .6 + z * .8) / 95; wooded = (Math.abs(fract(fu) - .5) > .47 || Math.abs(fract(fv) - .5) > .46) && u2 < .55; }
      if (!wooded && u2 > .015) continue;
      if (ad < T.edge + 12 && u3 < .5) continue;   // (a graded edge: thinner toward the road)
      const G = this._ground(x, z, nr);
      if (G.water || (def.relief.sea && G.y < this.course.seaLevel(nr.s) + 1)) continue;
      if (def.snowAbove != null && def.snowAbove > 0 && G.y - G.e > def.snowAbove + 40) continue;   // (the treeline)
      if (this._nearHome(x, z)) continue;
      const sp = pickWeighted(T.species, u3);
      if (!has(sp)) continue;
      const S = this.kit.species[sp], v = Math.min(S.variants.length - 1, Math.floor(r() * S.variants.length));
      const s = .7 + r() * .45;
      out.push(treeRecord(x, G.y - .1, z, sp, { v, s, sy: s * (.9 + r() * .2), rot: r() * 6.283 }));
    }
    // the understory near the road
    const T0 = this.course.indexAtZ(z0), T1 = this.course.indexAtZ(z0 + TILE);
    for (let i = T0; i < T1; i += 10) {
      const s = i * STEP, bi = this._biome(s), def = r() < bi.t ? bi.B : bi.A, U = def.under, C = this.course;
      for (let q = 0; q < U.per100; q++) {
        const side = r() < .5 ? -1 : 1, d = (7 + r() * 22) * side, h = C.heading[i], along = (r() - .5) * 100;
        const x = C.x[i] + Math.cos(h) * d + Math.sin(h) * along, z = C.z[i] - Math.sin(h) * d + Math.cos(h) * along;
        if (x < x0 || x >= x0 + TILE || z < z0 || z >= z0 + TILE) continue;
        const sp = pickWeighted(U.kinds, r()), G = this._ground(x, z);
        if (G.water || !has(sp) || this._nearHome(x, z)) continue;
        const sc = .7 + r() * .6;
        out.push(treeRecord(x, G.y - .05, z, sp, { s: sc, sy: sc, rot: r() * 6.283 }));
      }
    }
    plantTile(this.forest, t.key, out);
    t.planted = true; t.unplantFar = true;
  }

  // ---------- homes (the building engine) ----------
  _nearHome(x, z) {
    for (const h of this.homes.values()) for (const p of h.spots || []) if (Math.abs(p.x - x) < p.r && Math.abs(p.z - z) < p.r) return true;
    return false;
  }
  _buildHomes(c) {
    const C = this.course, a = c * CHUNK, rec = { spots: [], mesh: null, detail: null };
    this.homes.set(c, rec);
    if (a + CHUNK >= C.n) return;
    const r = rng(c * 2654435761 + this.course.seed), s = a * STEP + 100, bi = this._biome(s), def = bi.t < .5 ? bi.A : bi.B;
    if (r() > def.homes.perMile / 8) return;
    const i = a + 4 + Math.floor(r() * 12), h = C.heading[i], side = r() < .5 ? -1 : 1, rx = Math.cos(h) * side, rz = -Math.sin(h) * side, fx = Math.sin(h), fz = Math.cos(h);
    const at = (d, along) => ({ x: C.x[i] + rx * d + fx * along, z: C.z[i] + rz * d + fz * along });
    const rect = (c0, w, dep) => {   // a footprint facing the road: w along it, dep back from it
      const pts = [[-w / 2, 0], [w / 2, 0], [w / 2, dep], [-w / 2, dep]].map(([u, v]) => [c0.x + fx * u + rx * v, c0.z + fz * u + rz * v]);
      const x = pts.reduce((q, p) => q + p[0], 0) / 4, z = pts.reduce((q, p) => q + p[1], 0) / 4;
      return { x, z, pts, r: Math.hypot(w, dep) / 2 };
    };
    const kind = pickWeighted(def.homes.kinds, r());
    const lot = [];
    const houseKind = kind === 'barn' || kind === 'shed' ? 'farmhouse-ny' : kind;
    lot.push({ ...rect(at(16 + r() * 8, 0), 11 + r() * 4, 8 + r() * 3), kind: houseKind });
    if (def.fields || kind === 'barn') lot.push({ ...rect(at(40 + r() * 10, (r() < .5 ? -1 : 1) * (18 + r() * 8)), 26 + r() * 8, 14 + r() * 4), kind: 'barn' });
    if (r() < .6) lot.push({ ...rect(at(30 + r() * 6, (r() < .5 ? -1 : 1) * (12 + r() * 4)), 5 + r() * 2, 4 + r()), kind: 'shed' });
    for (const L of lot) {
      const G = this._ground(L.x, L.z);
      if (G.water || (def.relief.sea && G.y < this.course.seaLevel(G.s) + 2)) return;
      rec.spots.push({ x: L.x, z: L.z, r: L.r + 6 });
    }
    // the kit's planner: recipes from the footprints (styles: CNY's farmhouses and houses), drawn by the building engine
    const index = this._roadIndex(a, a + CHUNK);
    const plan = { buildings: lot.map((L, k) => ({ x: L.x, z: L.z, pts: L.pts, kind: L.kind, s: i * STEP, r: L.r, name: '', key: `e${c}-${k}`, levels: 0, roof: -1, height: L.kind === 'barn' ? 9 : 7 })), neighbours: [] };
    let recipes;
    try { recipes = planBuildings(plan, { seed: this.course.seed + c }, index, { detailM: 140, dressingM: 70, styles: [{ preset: 'cny-farmhouse', kinds: ['farmhouse-ny', 'barn', 'shed'] }, { preset: 'cny-suburban', kinds: ['house'] }] }).buildings; }
    catch (err) { this.log('3d', `Endless homes: ${err.message}`, 'debug'); return; }
    const land = { heightAt: (x, z) => this._ground(x, z).y };
    const w = new Writer(8192), d = new Writer(4096), nul = new NullWriter();
    for (const R of recipes) { const res = buildBuilding(R, w, d, nul, land); if (R.dressing?.length) for (const it of R.dressing) dress(d, it, R, land, res); }
    if (w.n) { rec.mesh = new THREE.Mesh(w.geometry(), this.mats.facade); rec.mesh.castShadow = rec.mesh.receiveShadow = true; rec.mesh.name = `Homestead ${c}`; this.group.add(rec.mesh); }
    if (d.n) { rec.detail = new THREE.Mesh(d.geometry(), this.mats.facade); rec.detail.receiveShadow = true; this.group.add(rec.detail); }
    // the trees already planted round it make way
    for (const t of this.tiles.values()) if (t.planted && rec.spots.some((p) => p.x > t.i * TILE - 40 && p.x < (t.i + 1) * TILE + 40 && p.z > t.j * TILE - 40 && p.z < (t.j + 1) * TILE + 40)) t.planted = false;
  }
  /** A road index the kit's planner reads (nearest road sample; xs / zs). */
  _roadIndex(a, b) {
    const C = this.course, lo = Math.max(0, a - 30), hi = Math.min(C.n - 1, b + 30), xs = C.x.slice(lo, hi + 1), zs = C.z.slice(lo, hi + 1);
    return { xs, zs, nearest(x, z, max = Infinity) { let bi = -1, bd = max * max; for (let k = 0; k < xs.length; k++) { const dx = xs[k] - x, dz = zs[k] - z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; bi = k; } } return bi < 0 ? null : { i: bi, d: Math.sqrt(bd) }; } };
  }

  // ---------- the day ----------
  _applyDay(f) {
    const t = dayAt(f), el = THREE.MathUtils.degToRad(t.elev), az = THREE.MathUtils.degToRad(t.az);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const LT = t.elev > 0 && this.lightTune ? this.lightTune : { sun: 1, sky: 1, exposure: 1 };   // ([zwift-look] the grade's key light)
    this.sun.color.set(t.sun); this.sun.intensity = t.sunI * sm(-4, 3, t.elev) * LT.sun;
    this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround); this.hemi.intensity = t.hemiI * LT.sky;
    this.renderer.toneMappingExposure = t.exposure * LT.exposure;
    RIDER_RIM.value.set(t.sun);
    // the biome's own tint on the haze and the clouds
    const bi = this._biome(this.p), fogB = _cA.set(bi.A.sky.fog).lerp(_cB.set(bi.B.sky.fog), bi.t);
    const fog = _cC.set(t.fog).lerp(fogB, .35);
    this.scene.fog.color.copy(fog);
    this.scene.background = new THREE.Color(t.sky);
    this.sky.set({ sky: t.sky, fog: '#' + fog.getHexString(), sun: t.sun, night: t.elev < -3 }, this.sunDir, lerp(bi.A.sky.clouds, bi.B.sky.clouds, bi.t));
    SURFACE_SUN.value.copy(this.sunDir);
    this.uniforms.uSunDir = SURFACE_SUN;
    this.golden = t.golden;
    this.sea.visible = [bi.a, bi.b].includes('coast');
    // the atmosphere's drifting leaves, beams and mist belong to the woods: on in the farmland and the forest only
    const leafy = ['farmland', 'forest'].includes(bi.t < .5 ? bi.a : bi.b) && (this.gfx?.atmosphere ?? true);
    if (leafy !== this._leafy) { this._leafy = leafy; this.effects?.set?.('atmosphere', leafy); }
    this.sea.position.y = this.course.seaLevel(this.p);
  }

  // ---------- the frame ----------
  _place(s, lane, out) {
    const a = this.course.at(s), h = a.heading, g = a.grade / 100;
    out.flat.set(Math.sin(h), 0, Math.cos(h));
    out.fwd.set(Math.sin(h), g, Math.cos(h)).normalize();
    out.pos.set(a.x + Math.cos(h) * lane, a.ele + .06, a.z - Math.sin(h) * lane);
    return out;
  }
  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    const cap = this.gfx?.fps || 0;
    if (cap && now - (this._lastDraw || 0) < 1000 / cap - 2) return;
    this._lastDraw = now; this._frames = (this._frames || 0) + 1;
    const dt = Math.min(1, (now - this._last) / 1000); this._last = now;
    const src = this.source ? this.source() : { pos: 0, speed: 0, cadence: 0 };
    let x = this.p + (src.speed || 0) * dt; const err = (src.pos || 0) - x;
    x = Math.abs(err) > 60 ? src.pos || 0 : x + err * Math.min(1, dt * 1.5);
    this.p = Math.max(0, Math.min(this.course.length - 1, x));
    const out = this._pose ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
    this._place(this.p, LANE, out);
    this.crank += ((src.cadence || 0) / 60) * Math.PI * 2 * dt;
    // the day moves on (100 minutes from dawn to dawn), the biome's tint with it
    this.dayAt = (0.12 + (now - this._t0) / 1000 / CYCLE_S) % 1;
    if ((this._frames & 7) === 0 || this._frames < 3) this._applyDay(this.dayAt);
    CLOUD_T.value = now / 1000; this.treeTime.value = now / 1000; this.uniforms.uTime.value = now / 1000;
    this.sky.tick(this.camera, now / 1000);
    this.effects.tick(now / 1000, dt);
    this.rider.update(out.pos, out.fwd, this.crank, src.speed || 0, Math.min(dt, .1), src);
    const tmp = this._leanTmp ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
    this._lean = stepLean(this._lean || 0, leanAlong((s) => this._place(s, LANE, tmp), this.p, src.speed || 0, { minS: 0 }), Math.min(dt, .1));
    this.rider.setLean?.(this._lean);
    this._updateCamera(out.pos, out.flat, out.fwd, dt);
    this._stream(this.camera.position, this._preload ? 40 : this.qualityKey === 'low' ? 4 : 7);
    this._tickMorphs(dt);
    this.forest?.tick(this.camera);
    this.sea.position.x = Math.round(this.camera.position.x / 100) * 100; this.sea.position.z = Math.round(this.camera.position.z / 100) * 100;
    const rp = this.rider.group.position;
    this.sun.position.copy(rp).addScaledVector(this.sunDir, 1500); this.sun.target.position.copy(rp); this.sun.target.updateMatrixWorld();
    if ((this._frames % 120) === 7) this.forest?.castShadows(this._postOn() && (this.gfx?.shadows ?? true));
    if (this._preload && this._frames % 4) return;
    this._draw();
  }
  _updateCamera(riderPos, flat, fwd, dt) {
    const K = CAMERAS[this.camKey] || CHASE, _v = this._cv ||= new THREE.Vector3(), UP = this._up ||= new THREE.Vector3(0, 1, 0);
    const pos = _v.copy(riderPos).addScaledVector(flat, -K.back).addScaledVector(UP, K.up);
    const look = (this._look ||= new THREE.Vector3()).copy(riderPos).addScaledVector(fwd, K.ahead).addScaledVector(UP, K.lookUp);
    const g = this.heightAt(pos.x, pos.z);
    if (pos.y < g + K.ground) pos.y = g + K.ground;
    if (Math.abs(this.camera.fov - K.fov) > .01) { this.camera.fov = K.fov; this.camera.updateProjectionMatrix(); }
    if (!this._camInit) { this.camera.position.copy(pos); this.camTarget.copy(look); this._camInit = true; this._chaseOff = null; }
    else lockedChase(this, riderPos, pos, look, dt, K.back, (x, z) => this.heightAt(x, z) + K.ground);
    this.camera.lookAt(this.camTarget);
  }
  /** Post-processing: desktop High (contact shading, bloom, grade), as the free-ride maps; elsewhere straight to the canvas. */
  _postOn() { return this.qualityKey === 'high' && !MOBILE && (this.gfx?.post ?? true); }
  _draw() {
    if (this._postOn()) {
      if (!this.post) {
        this.post = new PostFX(this.renderer, { samples: 4 });
        this.post.setAO({ strength: .75, radiusM: .8 });
        const w = this.container?.clientWidth || 1, h = this.container?.clientHeight || 1;
        this.post.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
      }
      this.post.render(this.scene, this.camera, { bloom: .25, threshold: 1.1, warm: this.golden ? 1 : 0 });
    } else {
      if (this.post) { this.post.dispose(); this.post = null; }
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.stop(); this.disposed = true;
    this.ride.removeEventListener('change', this._onChange);
    this._ro?.disconnect();
    this.post?.dispose(); this.sky?.dispose(); this.effects?.dispose(); this.forest?.dispose?.();
    for (const t of [...this.tiles.values()]) this._releaseTile(t);
    for (const [c, r] of [...this.roads]) this._releaseRoad(c, r);
    for (const h of this.homes.values()) { h.mesh?.geometry.dispose(); h.detail?.geometry.dispose(); }
    for (const m of Object.values(this.mats)) m.dispose?.();
    this.sea.geometry.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
const _cA = new THREE.Color(), _cB = new THREE.Color(), _cC = new THREE.Color(), _cD = new THREE.Color();

/** The ground: vertex colours (the biomes' blend, computed per vertex) with fine noise detail near and a broad mottle. */
function groundMaterial(low) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEW = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vEW;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float broad = fbm(vEW.xz * .012), fine = ${low ? '.5' : 'vn(vEW.xz * .9) * .6 + vn(vEW.xz * 3.7) * .4'};
          float near = 1. - smoothstep(40., 140., distance(vEW, cameraPosition));
          diffuseColor.rgb *= .88 + .2 * broad + (fine - .5) * .16 * near;
        }`);
  };
  m.customProgramCacheKey = () => `endless-ground-1${low ? '-low' : ''}`;
  return m;
}
