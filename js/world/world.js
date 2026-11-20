// The 3D ride view: real terrain + aerial imagery, the road, a pedalling rider, sky and cameras.
import { cutRouteRibbon, junctionPlan } from './toolbox/city/junction-mesh.js';   // [junctions] (the road's overlay: city.js)
import * as THREE from '../../vendor/three.module.min.js';
import { makeProjection, makeRouteIndex } from './geo.js';
import { Terrain } from './terrain.js';
import { Weather } from './toolbox/atmosphere/weather.js';
import { PostFX } from './toolbox/atmosphere/post.js';
import { Look, LOOKS } from './toolbox/atmosphere/look.js';
import { StylizedTerrain, SCENERY_QUALITY } from './stylized-terrain.js';
import { riderPose, routePoint, ROAD_WIDTH, CHASE, CHASE_CLOSE, CAMERAS, DEFAULT_CAMERA, PACER_LANE, leanAlong, stepLean } from './pose.js';
import { loadRider } from './rider.js';
import { PerfMonitor } from './perf.js';
import { HAZE, AERIAL, AERIAL_COLOR, installHaze } from './toolbox/atmosphere/haze.js';
import { vistaConfig } from './toolbox/atmosphere/vista.js';
import { decorateRoad, frenchMarkings } from './toolbox/materials/road-surface.js';
import { denseRoad, ribbonSections, apronFades } from './road-align.js';   // [road-align] [smooth-turns] [F133]
import { ghostAt, undergroundAt } from './ghost.js';   // [road-align]
import { BakedLighting } from './toolbox/atmosphere/baked-light.js';   // [baked-light]
import { CourseArches } from './toolbox/roadside/course-arches.js';
import { runSlice, due } from './toolbox/core/jobs.js';   // [F30] areas built in frame slices on the ride

installHaze();   // valley haze in the fog chunks: before any material compiles
import { wrapDist } from '../gpx.js';
export { setGeometryRelease, releaseStats } from './toolbox/core/release.js';   // [F399] (the app turns it on)

export const TIME_PRESETS = {
  morning: { label: 'Morning', elev: 14, az: 105, top: '#6f9fd8', horizon: '#f2d6b8', hemiSky: '#f6eedf', hemiGround: '#9a917e', sun: '#ffe2b8', sunI: 0.45, hemiI: 1.45, exposure: 1.0 },
  midday: { label: 'Midday', elev: 58, az: 180, top: '#3f7fd0', horizon: '#c6dbef', hemiSky: '#ffffff', hemiGround: '#a39b88', sun: '#ffffff', sunI: 0.55, hemiI: 1.35, exposure: 1.0 },
  // lean cartoon pass: a candidate signature time for Route 28 (sun high enough to light the road between the trees)
  afternoon: { label: 'Late afternoon', elev: 24, az: 248, top: '#5e93cf', horizon: '#ecd3b0', hemiSky: '#fbeedd', hemiGround: '#9a9179', sun: '#ffdcaa', sunI: 0.5, hemiI: 1.4, exposure: 1.02 },
  golden: { label: 'Golden hour', elev: 7, az: 258, top: '#5c78b4', horizon: '#f7b77d', hemiSky: '#ffe6c8', hemiGround: '#9a8670', sun: '#ffc27a', sunI: 0.45, hemiI: 1.4, exposure: 1.05 },
  // v0.12: moonlight, a deep blue sky with stars, and (in a city) the lights come on
  night: { label: 'Night', elev: 40, az: 150, top: '#0a1226', horizon: '#2a3150', hemiSky: '#7d8fbf', hemiGround: '#2b2b35', sun: '#b4c6ea', sunI: 0.3, hemiI: 0.5, exposure: 1.2, night: true },
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// Stylized foreground → real far terrain hand-off (metres from the camera)
const FAR_INNER = 1500, FAR_BAND = 400;
const TUNNEL_AIR = new THREE.Color('#6b5f4e');   // [subway] the air far down a lit tunnel
const RIDER_LANE = 0.22;   // × road width, right of the centre line
// [F30] main-thread ms a frame for building areas (js/world/toolbox/core/jobs.js slices): the one the swap waits for (behind
// the fade) or the plan's at the start (behind the loader); one the path enters within AREA_SOON_M; one further ahead
const AREA_BUDGET = { urgent: 40, soon: 10, ahead: 4 }, AREA_SOON_M = 500;
// [F220] waiting for an area: after this long under the fade the build gets `rush` ms a frame (behind a "Loading…"
// notice); an area that fails to load or build is tried again after AREA_RETRY_S × tries, at most AREA_TRIES times
const AREA_RUSH_S = 1.5, AREA_RUSH_MS = 250, AREA_RETRY_S = 10, AREA_TRIES = 3;
// [phase 8] behind the loading screen (World.setPreload): nothing to look at yet, so the start builds at a larger budget
// a frame (ground tiles, city chunks, the start's areas), and the view is drawn only every PRELOAD_DRAW_EVERY frames
// (enough to compile its programs before the screen opens). The start is ready once the city within START_NEAR_M is built.
export const PRELOAD_MS = 40, PRELOAD_AREA_MS = 60, PRELOAD_DRAW_EVERY = 4, START_NEAR_M = 450;

/**
 * [F220] What the world does when the path wants area `want` drawn and `current` is drawn: 'swap' (it is built),
 * 'stay' (keep drawing the current one: nothing to swap to — it failed — or the rider is still on streets the
 * current area covers, its apron, while the wanted one is hurried), or 'wait' (the rider has left the current area's
 * streets and the wanted one isn't built: the fade, the last resort).
 */
export function areaChoice({ want, current, ready, failed, covers }) {
  if (want === current) return 'stay';
  if (ready) return 'swap';
  if (failed || covers) return 'stay';
  return 'wait';
}

export class World {
  /**
   * @param {HTMLElement} container
   * @param {object} route  built route (gpx.js) — should be a closed loop
   * @param {{log?:Function, quality?:'low'|'balanced'|'high'}} [opts]
   */
  constructor(container, route, opts = {}) {
    this.container = container;
    this.route = route;
    this.log = opts.log || (() => {});
    this.s = 0;               // displayed position along the route (m)
    // a ride network (js/network.js): the ride's own position is in path metres; the world maps it onto
    // this route (built as usual around the city loop) and follows the path's curves through junctions
    this.path = opts.path || null;
    // a network of areas (PLAN 5.4): { id (this route's area), origin {lat, lon} (the city's frame),
    // load(id) → Promise<route with its scene> }. One area is drawn at a time; the ones the path reaches soon
    // are built hidden; js/network.js NetRide.areaFor says which to draw.
    this.areaSet = opts.areas || null;
    this.p = 0;               // displayed position along the path (m), with a path
    this.crank = 0;
    this.running = false;
    this.source = null;       // () => {pos, speed, cadence, riding, grade, power, ftp} (grade/power/ftp pick the rider's posture)
    this.stylized = route.scene?.style === 'stylized';
    // a new route's placeholder before its scenery: the real ground as contour/grid lines (scene.wire)
    this.wireframe = route.scene?.style === 'wireframe';
    this.qualityKey = Object.hasOwn(SCENERY_QUALITY, opts.quality) ? opts.quality : 'balanced';

    // Projection centred on the route
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < route.lat.length; i++) {
      minLat = Math.min(minLat, route.lat[i]); maxLat = Math.max(maxLat, route.lat[i]);
      minLon = Math.min(minLon, route.lon[i]); maxLon = Math.max(maxLon, route.lon[i]);
    }
    const origin = this.areaSet?.origin || route.scene?.origin;   // a city of areas: every area in the city's own frame (scene "origin")
    this.proj = origin ? makeProjection(origin.lat, origin.lon) : makeProjection((minLat + maxLat) / 2, (minLon + maxLon) / 2);
    this.index = makeRouteIndex(route, this.proj);
    this._hazeEle = route.minEle;   // (the valley haze sits on the first area's lowest point, whichever area is drawn)

    // Renderer
    // Stylized scenery renders through the frame pipeline (post.js): an offscreen HDR target with its own
    // MSAA and a float depth buffer, so the canvas needs no antialiasing of its own, and the renderer can
    // use a reversed depth buffer (the logarithmic one writes depth per pixel, which stops the GPU
    // skipping hidden pixels; it stays only as the fallback without EXT_clip_control).
    const reversed = this.stylized && hasClipControl();
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.stylized, logarithmicDepthBuffer: !reversed,
      reversedDepthBuffer: reversed, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.stylized ? SCENERY_QUALITY[this.qualityKey].pixelRatio : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.prepend(this.renderer.domElement);
    this.renderer.domElement.className = 'world-canvas';
    // cartoon look: the scene's "look" (Route 28: gentle), or ?look=gentle|bold|none in the preview
    const lookKey = opts.look ?? route.scene?.look;
    this.look = this.stylized && Object.hasOwn(LOOKS, lookKey) ? new Look(this, lookKey) : null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 150000);
    this.camTarget = new THREE.Vector3();
    this._camInit = false;

    // Light + sky
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    if (this.stylized) {
      this.renderer.shadowMap.enabled = SCENERY_QUALITY[this.qualityKey].shadows;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap was removed from three.js
      this.sun.castShadow = true;
      const shadowResolution = this.qualityKey === 'high' ? 2048 : 1024;
      this.sun.shadow.mapSize.set(shadowResolution, shadowResolution);
      Object.assign(this.sun.shadow.camera, { near: 10, far: 800, left: -170, right: 170, top: 170, bottom: -170 });
      this.sun.shadow.bias = -.00015; this.sun.shadow.normalBias = .055;
    }
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sky = makeSky();
    this.scene.add(this.sky);
    // per-scene atmosphere (e.g. humid Adirondack air separates the ridges much sooner)
    this.atmosphere = { fogNearM: 2300, fogFarM: 16500, fogFarRealM: 30000, ...(this.stylized || this.wireframe ? route.scene.atmosphere : {}) };
    const sceneFog = this.stylized || this.wireframe;
    this.scene.fog = new THREE.Fog(0xc6dbef, sceneFog ? this.atmosphere.fogNearM : 4000, sceneFog ? this.atmosphere.fogFarM : 70000);

    const TerrainClass = this.stylized ? StylizedTerrain : Terrain;
    this.terrain = new TerrainClass(this.scene, this.proj, this.index, {
      route,
      quality: this.qualityKey,
      wire: this.wireframe ? (route.scene.wire || {}) : null,
      bbox: { minLat, maxLat, minLon, maxLon },
      renderer: this.renderer,
      farInner: FAR_INNER, farBand: FAR_BAND,
      onError: (err) => this.log('3d', `Tile load problem: ${err.message}`, 'debug'),
      look: this.look?.key,
    });
    // v0.11.2 blend: real terrain and aerial photos beyond ~1.5 km behind the stylized foreground,
    // colour-matched to the route's palette. Needs internet; until its base tiles arrive (or offline)
    // the stylized scenery simply carries on to the horizon.
    if (this.stylized && route.scene.realHorizon !== false) {
      this.farTerrain = new Terrain(this.scene, this.proj, this.index, {
        bbox: { minLat, maxLat, minLon, maxLon },
        renderer: this.renderer,
        far: { inner: FAR_INNER, band: FAR_BAND, tint: route.scene.palette?.farTint || route.scene.palette?.grass, rock: route.scene.palette?.cliff || route.scene.palette?.rock, amount: route.scene.palette?.farTintAmount ?? 0.38, maxZ: 14 },
        onError: (err) => this.log('3d', `Far terrain: ${err.message}`, 'debug'),
      });
      this.farTerrain.group.visible = false;   // shown once it covers the whole area
      this.terrain.realHeightAt = (x, z) => this.farTerrain.heightAt(x, z);
    }

    const city = route.scene?.terrain === 'authored-city';
    const widthAt = city ? streetWidthAt(this.terrain.landscape) : null;   // [F133]
    this.shoulder = makeRibbon(route, this.index, ROAD_WIDTH + (city ? 4 : this.stylized ? 1.6 : 3.4), city ? .09 : 0.05, makeGravelTexture(this.stylized, city), 3, { polygonOffsetFactor: city ? -1.8 : -1, polygonOffsetUnits: city ? -1.8 : -1 }, widthAt);
    this.shoulder.visible = !this.wireframe;   // no gravel verge on a wireframe placeholder
    this.scene.add(this.shoulder);
    const junctions = city ? junctionPlan(this.terrain.landscape, this.index, route) : null;   // [junctions]
    if (junctions) cutRouteRibbon(this.shoulder, junctions, denseRoad(route, this.index)[0].dist);   // [junctions] no shoulder inside a junction (its stations: the drawn curve's)
    this.road = makeRoad(route, this.index, { widthAt });
    this.scene.add(this.road);
    // the area drawn (one, unless this is a city of areas: then more are built and swapped in as the path goes)
    this.area = { id: this.areaSet?.id ?? null, route, index: this.index, terrain: this.terrain, road: this.road, shoulder: this.shoulder, ready: true };
    this.areas = new Map([[this.area.id, this.area]]);
    this._indexOf = (id) => (id == null || id === this.area.id ? this.index : this._lineIndex(id));
    // weather: clear / marine layer / clouds / rain (stylized scenery)
    if (this.stylized) this.weather = new Weather(this, this.terrain.uniforms);
    // [baked-light] fixed sun, baked shadows and AO for the static scenery (scene "lighting": {"baked": "golden"})
    if (this.stylized) this.baked = BakedLighting.create(this, route.scene.lighting, TIME_PRESETS);
    // hero scenery: HDR render with soft bloom, a gentle grade and vignette (off on Light detail)
    // every stylized scene goes through it; only hero scenes (scene.post) get the bloom, grade and vignette
    if (this.stylized) this.post = new PostFX(this.renderer, { samples: SCENERY_QUALITY[this.qualityKey].samples });
    this.heroPost = !!(this.stylized && route.scene.post);
    // vista kit: faint outlines on the far ridges (with or without the cartoon look's near outlines)
    this.vista = this.stylized ? vistaConfig(route.scene) : null;
    const ridge = this.vista?.ridgeInk || null;
    if (this.look || ridge) this.post.setInk({ ...(this.look?.ink || { px: 1, strength: 0, thresh: 1, fadeM: 1 }), ridge });
    // Simple stand-in until the Blender model loads
    this.rider = makeRider();
    this.scene.add(this.rider.group);
    this._riderModel = 'loading';   // [phase 8] (the loading screen waits for it: 'ok' or 'failed')
    loadRider().then((r) => {
      this._riderModel = 'ok';
      if (this.disposed) return;
      this.scene.remove(this.rider.group);
      this.rider = r;
      if (this.stylized) r.group.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(r.group);
      this.log('3d', `Rider model loaded (${r.triangles.toLocaleString()} triangles)`, 'debug');
    }).catch((err) => { this._riderModel = 'failed'; this.log('3d', `Using the simple rider: ${err.message}`, 'debug'); });

    this.setTimeOfDay('midday');

    this._resize = () => {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.post?.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(container);
    this._resize();

    this._frame = this._frame.bind(this);
    this._last = performance.now();
  }

  /** Where to draw the rider: a function returning {pos, speed (m/s), cadence (rpm), riding}. */
  setSource(fn) { this.source = fn; }
  /** Follow a network ride's path (js/network.js NetRide), or null for the route itself. */
  setPath(path) { this.path = path || null; this._pacerInit = false; this._resT = 0; }

  // ---------- Areas (PLAN 5.4) ----------
  /** The route index of an area's line (the area's own when it is built, else one made from its line). */
  _lineIndex(id) {
    const a = this.areas.get(id);
    if (a?.index) return a.index;
    const base = this.path?.net?.areas?.get(id)?.base;
    if (!base) return this.index;
    const cache = (this._lineIndexes ||= new Map());
    if (!cache.has(id)) cache.set(id, makeRouteIndex(base, this.proj));
    return cache.get(id);
  }
  /** Is the world a city of areas riding a path across them? */
  get _multi() { return !!(this.areaSet && this.path?.net?.multi); }
  /**
   * Every frame on a network of areas: draw the area the path says (swap when it's built, else fade until it
   * is), keep the areas the path reaches soon built (hidden, streaming round the camera) and release the rest.
   */
  _areaTick(dt) {
    dt = Math.max(0, dt);   // (frames held behind the bake loader can run with a clock behind)
    const want = this.path.areaFor(this.p, this.area.id);
    // [F220] never a blank screen while the rider is still on the drawn area's streets: swap once the wanted area is
    // built; until then keep drawing this one while it covers the rider (its apron; the build runs at the 500 m budget); fade only when
    // the rider has left its streets — and past AREA_RUSH_S, build the rest fast behind a "Loading…" notice. An area
    // that fails to load or build doesn't hold the ride: the drawn one stays (no fade, no endless retry)
    const a = this.areas.get(want);
    const choice = areaChoice({ want, current: this.area.id, ready: !!a?.ready, failed: this._areaFailed(want), covers: this.path.covers(this.area.id, this.p) });
    if (choice === 'swap') this._useArea(a);
    else if (want !== this.area.id && choice !== 'swap' && !this._areaFailed(want)) this._ensureArea(want);
    const waiting = choice === 'wait';
    this._waitS = waiting ? (this._waitS || 0) + dt : 0;
    this._fade(waiting, this._waitS > AREA_RUSH_S);
    // (each wait under the fade, for tools/ride_area_load.mjs: [{id, p, s}])
    const w = (this.areaWaits ||= []).at(-1);
    if (waiting) { if (w?.open) w.s += dt; else this.areaWaits.push({ id: want, p: Math.round(this.p), s: dt, open: true }); }
    else if (w?.open) w.open = false;
    if ((this._resT = (this._resT ?? 0) - dt) <= 0) {
      this._resT = .5;
      const need = this.path.areasNear(this.p);
      // the areas a planned ride (a preset, your own route) goes through are built once, at the start behind the
      // loader, and kept; off the plan (a free ride, a turn of your own) an area is built when the path reaches 1.5 km
      // of it. [F30] Either way the build runs in frame slices (_runAreaJobs): seconds of main-thread work spread thin
      for (const id of this._planAreas()) need.add(id);
      for (const id of this.path.areasReachable?.(this.p) || []) need.add(id);   // [F220] where a choice at the junctions ahead could go
      const pacer = this.pacerSource?.()?.path;
      if (pacer?.own) for (const id of pacer.own.areasNear(this.ps ?? this.p, 300, 0)) need.add(id);   // (the pacer, on its own way)
      need.add(this.area.id);
      for (const id of need) this._ensureArea(id);
      for (const a of [...this.areas.values()]) if (!need.has(a.id) && a !== this.area && (a.ready || a.job)) this._releaseArea(a);
      this._soon = this.path.areasNear(this.p, AREA_SOON_M, 0);   // [F30] (areas the path enters within 500 m: their builds hurry)
      this._near = this.path.areasNear(this.p);   // [F32] (areas the path enters within 1.5 km: baked ahead of their swap)
    }
    this._runAreaJobs(want, waiting, this._waitS > AREA_RUSH_S);   // (on the apron it builds at the 500 m budget: the view is still drawn)
    const c = this.camera.position;
    for (const a of this.areas.values()) if (a !== this.area && a.ready) { const t0 = performance.now(); a.terrain.prepare?.(c.x, c.z, 2); this._areaWork(a.id, 'prepare', performance.now() - t0); }
  }
  /** Main-thread time spent building areas (F30: tools/ride_area_load.mjs reads it): per area and step, and the longest slice. */
  _areaWork(id, step, ms) {
    const w = (this.areaWork ||= {}), a = (w[id] ||= { ms: 0, slices: 0, maxMs: 0, steps: {} });
    a.ms += ms; a.slices++; a.maxMs = Math.max(a.maxMs, ms);
    const s = (a.steps[step] ||= { ms: 0, n: 0, maxMs: 0 }); s.ms += ms; s.n++; s.maxMs = Math.max(s.maxMs, ms);
  }
  /** The areas of the ride's plan (cached per path and plan). */
  _planAreas() {
    const plan = this.path?.plan;
    if (!plan) return [];
    if (this._planFor !== plan) { this._planFor = plan; this._planIds = [...new Set(plan.map((t) => t.e.area))]; }
    return this._planIds;
  }
  /**
   * Load and build an area (hidden) unless it is built or on its way. [F30] The build is a job
   * (js/world/toolbox/core/jobs.js) the world runs a slice at a time each frame (`_runAreaJobs`): the same steps in the
   * same order as building it at once, so the area is the same, but no frame stalls for it.
   */
  _ensureArea(id) {
    if (this.areas.has(id) || !this.areaSet?.load || this._areaFailed(id)) return;
    const rec = { id, ready: false, ms: {} };
    this.areas.set(id, rec);
    const live = () => !this.disposed && this.areas.get(id) === rec;
    rec.t0 = performance.now();
    this.areaSet.load(id).then((route) => {
      if (!live()) return;
      rec.job = this._areaJob(id, route, rec);
    }).catch((err) => { this.log('3d', `Area ${id} could not load: ${err.message}`, 'error'); if (this.areas.get(id) === rec) { this.areas.delete(id); this._areaFail(id); } });
  }
  /** [F220] Area `id` failed to load or build: not tried again for AREA_RETRY_S × tries (after AREA_TRIES, not this ride). */
  _areaFail(id) {
    const f = (this._areaFails ||= new Map()).get(id) || { n: 0 };
    f.n++; f.until = f.n >= AREA_TRIES ? Infinity : performance.now() + AREA_RETRY_S * 1000 * f.n;
    this._areaFails.set(id, f);
  }
  _areaFailed(id) { const f = this._areaFails?.get(id); return !!f && performance.now() < f.until; }
  /** [F30] An area's build as a job: its scenery (landscape, streets, ground, water), road and shoulder, then the city. */
  *_areaJob(id, route, rec) {
    const index = makeRouteIndex(route, this.proj);
    if (due()) yield;
    const terrain = new StylizedTerrain(this.scene, this.proj, index, {
      route, quality: this.qualityKey, renderer: this.renderer, farInner: FAR_INNER, farBand: FAR_BAND, look: this.look?.key,
      uniforms: this.terrain.uniforms,   // one set for every area: the weather and the time drive them all
      onError: (err) => this.log('3d', `Area ${id}: ${err.message}`, 'debug'),
      deferred: true, hidden: true,   // [F30] (built by this job, hidden until drawn)
    });
    rec.parts = { id, route, index, terrain };
    yield* terrain.job;   // the scenery: landscape (streets, junctions), ground, water, clouds, roadside
    yield* this._areaRoadJob(rec.parts);
    yield* terrain.kitJob();   // (waits for the kit's assets) the city: buildings, streets, bridges, trees, life
    Object.assign(rec, rec.parts);
  }
  /** [F30] An area's road and shoulder (built in the city's frame, hidden until it is drawn), as a job. */
  *_areaRoadJob(parts) {
    const { route, index, terrain } = parts;
    const city = route.scene?.terrain === 'authored-city';
    const widthAt = city ? streetWidthAt(terrain.landscape) : null;   // [F133]
    const shoulder = makeRibbon(route, index, ROAD_WIDTH + (city ? 4 : 1.6), city ? .09 : 0.05, makeGravelTexture(true, city), 3, { polygonOffsetFactor: city ? -1.8 : -1, polygonOffsetUnits: city ? -1.8 : -1 }, widthAt);
    parts.shoulder = shoulder;
    if (due()) yield;
    const junctions = city ? junctionPlan(terrain.landscape, index, route) : null;   // [junctions]
    if (junctions) cutRouteRibbon(shoulder, junctions, denseRoad(route, index)[0].dist);
    if (due()) yield;
    const road = makeRoad(route, index, { widthAt });
    shoulder.visible = road.visible = false;
    this.scene.add(shoulder, road);
    parts.road = road;
    this.weather?._wetRoad(road);
    terrain.setTime?.(this.timeKey);
    terrain.setNight?.(this._time?.night ? 1 : 0);
    if (this.farTerrain) terrain.setFar(!!this._farOn);
  }
  /**
   * [F30] Run the area builds a slice each frame: the area the swap waits for (behind the fade) and the plan's areas at
   * the start (behind the loader) get AREA_BUDGET.urgent, an area the path enters within 500 m .soon, the rest .ahead.
   */
  _runAreaJobs(want, waiting, rush = false) {
    let left = null;
    for (const rec of [...this.areas.values()].sort((a, b) => (b.id === want) - (a.id === want))) {
      if (!rec.job || rec.wait) continue;
      const urgent = (waiting && rec.id === want) || (!this._planBuilt && this._planAreas().includes(rec.id));
      const B = this.areaBudget || AREA_BUDGET;   // (tools may set world.areaBudget: Infinity = all at once, the old way)
      let budget = rush && rec.id === want ? Math.max(B.urgent, AREA_RUSH_MS) : urgent ? B.urgent : this._soon?.has(rec.id) ? B.soon : B.ahead;   // [F220] rush
      if (this._preload && (rec.id === want || this._soon?.has(rec.id))) budget = Math.max(budget, PRELOAD_AREA_MS);   // [phase 8] (behind the loading screen)
      left = left == null ? budget : Math.min(left, budget);
      if (left <= .5) break;
      const t0 = performance.now();
      let r;
      try { r = runSlice(rec.job, left); } catch (err) {
        this.log('3d', `Area ${rec.id} could not be built: ${err.message}`, 'error');
        this._releaseArea(rec);
        this._areaFail(rec.id);   // [F220] (not again next frame: the drawn area stays)
        continue;
      }
      const ms = performance.now() - t0;
      left -= ms;
      this._areaWork(rec.id, 'build', ms);
      if (r.wait) { rec.wait = true; r.wait.then(() => { rec.wait = false; }); }
      if (r.done) this._areaBuilt(rec);
    }
    if (!this._planBuilt && this._planAreas().every((id) => this.areas.get(id)?.ready)) this._planBuilt = true;
  }
  _areaBuilt(rec) {
    rec.job = null;
    if (this.disposed || this.areas.get(rec.id) !== rec || !rec.terrain) return;
    rec.ready = true;
    const w = this.areaWork?.[rec.id]?.steps?.build;
    rec.buildMs = Math.round(w?.ms || 0);
    this.log('3d', `Area ${rec.id} ready: ${rec.buildMs} ms of building in ${w?.n || 0} slices (longest ${Math.round(w?.maxMs || 0)} ms), ${Math.round((performance.now() - rec.t0) / 1000)} s after it was asked for`, 'debug');
  }

  /** Draw area `a` instead of the one drawn now (both are the same streets where this happens). */
  _useArea(a) {
    const old = this.area;
    old.terrain.group.visible = false; old.road.visible = false; old.shoulder.visible = false;
    a.terrain.group.visible = true; a.road.visible = true; a.shoulder.visible = !this.wireframe;
    Object.assign(this, { area: a, route: a.route, index: a.index, terrain: a.terrain, road: a.road, shoulder: a.shoulder });
    if (this.farTerrain) a.terrain.realHeightAt = (x, z) => this.farTerrain.heightAt(x, z);
    a.terrain.city?.life?.takeOver?.(old.terrain.city?.life);   // [F31] its life takes over the people and traffic near the camera
    this.baked?.useArea(a.id, old.id);   // [F32] its own bake (baked ahead), if it has one
    const bank = this.weather?.bankUniforms;
    if (bank && a.terrain.shoreTexture) { bank.bfShore.value = a.terrain.shoreTexture; bank.bfShoreBox.value = a.terrain.shoreBox || bank.bfShoreBox.value; }
    (this.areaLog ||= []).push({ id: a.id, p: Math.round(this.p) });
    this.log('3d', `Drawing area ${a.id}`, 'debug');
  }
  _releaseArea(a) {
    const t0 = performance.now();
    this.areas.delete(a.id);
    this.baked?.releaseArea(a.id);   // [F32]
    a.job = null;   // [F30] (a build half done stops here)
    const parts = a.terrain ? a : a.parts || {};
    parts.terrain?.dispose();
    for (const o of [parts.road, parts.shoulder]) {
      if (!o) continue;
      o.removeFromParent();
      o.traverse((m) => {
        if (m.geometry) m.geometry.dispose();
        if (m.material) [].concat(m.material).forEach((mt) => { mt.userData.disposed = true; for (const key of ['map', 'bumpMap']) mt[key]?.dispose(); mt.dispose(); });
      });
    }
    this._areaWork(a.id, 'release', performance.now() - t0);
    this.log('3d', `Released area ${a.id}`, 'debug');
  }
  /**
   * [F32] The areas to bake ahead of their swap (js/world/toolbox/atmosphere/baked-light.js _bakeAhead): built, hidden
   * areas the path enters within 1.5 km, the ones within 500 m (`soon`) first.
   */
  _bakeAhead() {
    if (!this._multi || !this._near) return [];
    const out = [];
    for (const a of this.areas.values()) {
      if (a === this.area || !a.ready || !a.terrain || !this._near.has(a.id)) continue;
      out.push({ id: a.id, terrain: a.terrain, road: a.road, shoulder: a.shoulder, index: a.index, route: a.route, soon: !!this._soon?.has(a.id) });
    }
    return out.sort((p, q) => q.soon - p.soon);
  }
  /** A short fade to the sky while the next area is still being built (the ride carries on underneath). */
  _fade(on, notice = false) {
    if (!on && !this._fadeEl) return;
    if (!this._fadeEl) {
      this._fadeEl = document.createElement('div');
      this._fadeEl.className = 'area-fade';
      Object.assign(this._fadeEl.style, { position: 'absolute', inset: '0', zIndex: 4, pointerEvents: 'none', opacity: '0', transition: 'opacity .3s',
        display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 15px/1.4 system-ui, sans-serif', color: '#3c4a52', letterSpacing: '.02em' });
      this.container.appendChild(this._fadeEl);
    }
    this._fadeEl.textContent = on && notice ? 'Loading the streets ahead…' : '';   // [F220] (a wait past a moment says so)
    if (on) this._fadeEl.style.background = `#${this.scene.fog.color.getHexString()}`;
    this._fadeEl.style.opacity = on ? '1' : '0';
    this._waitingArea = on;
  }

  /**
   * The start and finish arches for the ride that's planned (js/world/toolbox/roadside/course-arches.js):
   * { start: {atM, title, sub} | null, finish: {atM, title, sub} | null }, route metres. Moves them, any time.
   */
  setCourseMarks(marks) {
    // a race-day scene has its own finish gantry (Alpe d'Huez): no second arch on its line
    const race = this.route.scene?.raceDay?.finishM, r = this.route;
    if (marks?.finish && race != null) {
      const x = wrapDist(r, marks.finish.atM), out = r.turnS && x > r.turnS ? r.total - x : x;
      if (Math.abs(out - race) < 60) marks = { ...marks, finish: null };
    }
    if (this.path) {
      // network ride: the marks are path metres; the arches stand where that is on the city loop
      // (a city of areas: on the area drawn where it covers the mark, else on the mark's own area's line)
      const at = (m) => {
        if (!m || !Number.isFinite(m.atM)) return m;
        const w = this.path.worldAt(m.atM, this.area.id), a = this.areas.get(w.area);
        return { ...m, atM: w.s, view: w.area === this.area.id ? null : a?.ready ? a : { route: this.path.net.areas.get(w.area).base, index: this._lineIndex(w.area), terrain: null } };
      };
      marks = marks && { start: at(marks.start), finish: at(marks.finish) };
    }
    if (!marks?.start && !marks?.finish && !this.courseArches) return;
    (this.courseArches ||= new CourseArches(this)).set(marks || {});
  }

  /** The virtual pacer: a function returning {pos, speed, cadence, path?} along the route, or null when off (path: its own PathFollower on a network ride). */
  setPacerSource(fn) { this.pacerSource = fn; this._pacerInit = false; }

  /** Point on the road at distance s, `lane` × road width right of the centre line (with the U-turn drifts). */
  _place(s, lane, out = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() }) {
    // shared with the course QC sweep (js/world/pose.js); `out` lets the frame loop reuse its vectors
    const pose = riderPose(this.route, this.index, s, lane);
    out.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
    out.fwd.set(pose.fwd.x, pose.fwd.y, pose.fwd.z);
    out.flat.set(pose.flat.x, 0, pose.flat.z);
    return out;
  }
  /** The same at path metre p on a network ride (the curves through junctions included); `path`: another rider's own copy of it (the pacer's). */
  _placePath(p, lane, out, path = this.path) {
    const pose = path.pose(p, this._indexOf, lane, this.area.id);   // (on the area drawn, PLAN 5.4)
    out.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
    out.fwd.set(pose.fwd.x, pose.fwd.y, pose.fwd.z);
    out.flat.set(pose.flat.x, 0, pose.flat.z);
    return out;
  }
  /**
   * [7.5] The lean (radians, + right) a rider drawn at s (path metre on a network ride: `path`) in `lane` would hold
   * at `speed` m/s: from the drawn path's curvature round it (pose.js leanAlong). `path` null: the route's own line.
   */
  _leanTarget(s, lane, speed, path) {
    const tmp = this._leanTmp ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
    if (path) return leanAlong((x) => this._placePath(x, lane, tmp, path), s, speed, { minS: 0 });
    return leanAlong((x) => this._place(x, lane, tmp), s, speed);
  }
  /** Ease a displayed path position toward the ride's (no wrapping: a path runs on). */
  _followPath(cur, target, speed, dt) {
    let x = cur + speed * dt;
    const err = target - x;
    if (Math.abs(err) > 60) x = target; else x += err * Math.min(1, dt * 1.5);
    return Math.max(0, x);
  }


  _updatePacer(dt) {
    const src = this.pacerSource ? this.pacerSource() : null;
    if (!src) { if (this.pacer) this.pacer.group.visible = false; return; }
    if (!this.pacer) {
      if (!this._pacerLoading) {
        this._pacerLoading = loadRider({ jersey: 'checker' }).then((r) => {
          if (this.disposed) return;
          if (this.stylized) r.group.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
          this.pacer = r;
          this.scene.add(r.group);
        }).catch((err) => { this._pacerFailed = true; this.log('3d', `Pacer model: ${err.message}`, 'debug'); });
      }
      return;
    }
    const total = this.route.total;
    // Same smoothing as the rider: roll at its speed, ease toward the true position.
    if (!this._pacerInit) { this.ps = src.pos; this.pacerCrank = 0; this._pacerInit = true; }
    this._pacerSpeed = src.speed;   // [6.10] (for the city's riders on the route)
    if (this.path) {
      // (on its own copy of the path, src.path: a turn you change behind it doesn't move it — js/network.js PathFollower)
      this.ps = this._followPath(this.ps, src.pos, src.speed, dt);
      const { pos, fwd } = this._placePath(this.ps, PACER_LANE, this._pacerPose ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() }, src.path || this.path);
      this.pacerCrank += (src.cadence / 60) * Math.PI * 2 * dt;
      this.pacer.group.visible = true;
      this.pacer.update(pos, fwd, this.pacerCrank, src.speed, Math.min(dt, 0.1), src);
      this._pacerLean = stepLean(this._pacerLean, this._leanTarget(this.ps, PACER_LANE, src.speed, src.path || this.path), Math.min(dt, 0.1));   // [7.5]
      this.pacer.setLean?.(this._pacerLean);
      return;
    }
    this.ps += src.speed * dt;
    let err = src.pos - wrapDist(this.route, this.ps);
    if (this.route.closed) { if (err > total / 2) err -= total; if (err < -total / 2) err += total; }
    if (Math.abs(err) > 60) this.ps = src.pos; else this.ps += err * Math.min(1, dt * 1.5);
    this.ps = this.route.closed ? wrapDist(this.route, this.ps) : Math.max(0, Math.min(total, this.ps));
    const { pos, fwd } = this._place(this.ps, PACER_LANE, this._pacerPose ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() });
    this.pacerCrank += (src.cadence / 60) * Math.PI * 2 * dt;
    this.pacer.group.visible = true;
    this.pacer.update(pos, fwd, this.pacerCrank, src.speed, Math.min(dt, 0.1), src);
    this._pacerLean = stepLean(this._pacerLean, this._leanTarget(this.ps, PACER_LANE, src.speed, null), Math.min(dt, 0.1));   // [7.5]
    this.pacer.setLean?.(this._pacerLean);
  }

  /** clear | marine | clouds | rain (eases in over a few seconds). */
  /** The weather presets this route offers (a scene can limit and rename them: Pittsburgh's "River fog"). */
  weatherOptions() {
    if (!this.weather) return [];
    const S = this.route.scene?.weather || {}, keys = S.presets || ['clear', 'marine', 'clouds', 'rain'];
    const names = { clear: 'Clear', marine: 'Marine layer', clouds: 'Clouds', rain: 'Rain', smoke: 'Wildfire smoke', ...(S.labels || {}) };
    return keys.map((key) => ({ key, label: names[key] || key }));
  }
  /** [w2-polish] The times of day this scene really shows: a baked scene has its baked time and night only. */
  timeOptions() {
    const keys = this.baked ? [this.baked.time, 'night'] : ['morning', 'midday', 'golden', 'night'];
    return keys.map((key) => ({ key, label: TIME_PRESETS[key]?.label || key }));
  }
  setWeather(key, immediate = false) {
    const options = this.weatherOptions();
    if (options.length && !options.some((o) => o.key === key)) key = options[0].key;   // not offered here: the route's first
    this.weatherKey = key; this.weather?.set(key, immediate);
  }

  setQuality(key) {
    if (!this.stylized) return;
    this.qualityKey = Object.hasOwn(SCENERY_QUALITY, key) ? key : 'balanced';
    const quality = SCENERY_QUALITY[this.qualityKey];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    this.renderer.shadowMap.enabled = quality.shadows && !(this.baked && this._time?.night);   // [baked-light]
    const resolution = this.qualityKey === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== resolution) {
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(resolution, resolution);
    }
    this.post?.setSamples(quality.samples);
    for (const a of this.areas.values()) a.terrain?.setQuality(this.qualityKey);
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    this._resize?.();
  }

  setTimeOfDay(key) {
    if (key === 'auto' || !key) key = this.route.scene?.timeOfDay || 'midday';   // "Route's default"
    if (this.baked) key = this.baked.timeFor(key);   // [baked-light] the baked time, or night
    let t = TIME_PRESETS[key] || TIME_PRESETS.midday;
    if (this.stylized && key === 'night') t = { ...t, sunI: .55, hemiI: .42 };
    else if (this.stylized) t = { ...t, sunI: key === 'golden' ? 2.5 : 2.1, hemiI: key === 'golden' ? .95 : 1.1,
      ...(key === 'midday' ? { elev: 46, az: 238, top: '#70a9d2', horizon: '#d5e2db', hemiSky: '#e8f0ed', hemiGround: '#9c9d7e', sun: '#fff2d5', exposure: 1.03 } : {}) };
    this.timeKey = key;
    this._time = t;
    this._applyLight();
  }

  /** Time-of-day light, dimmed and greyed by the weather (overcast, rain). */
  _applyLight() {
    const base = this._time;
    if (!base) return;
    const w = this._weatherLight || { overcast: 0, rain: 0, smoke: 0 }, o = w.overcast, sm = w.smoke || 0;
    const grey = (c, to, k) => '#' + new THREE.Color(c).lerp(new THREE.Color(to), k).getHexString();
    let t = o > 0.001 && !base.night ? { ...base,
      sunI: base.sunI * (1 - o * .78), hemiI: base.hemiI * (1 + o * .18), exposure: base.exposure * (1 - o * .06),
      top: grey(base.top, '#8b959c', o * .85), horizon: grey(base.horizon, '#b9c0c3', o * .8), sun: grey(base.sun, '#dfe3e6', o * .6),
      hemiSky: grey(base.hemiSky, '#d4d9dc', o * .7) } : base;
    // wildfire smoke: a red-orange sun, a brown-orange sky, softer light
    if (sm > .001 && !base.night) t = { ...t, sunI: t.sunI * (1 - sm * .4), hemiI: t.hemiI * (1 + sm * .08),
      top: grey(t.top, '#a99a86', sm * .8), horizon: grey(t.horizon, '#d39a66', sm * .75), sun: grey(t.sun, '#ff7a3a', sm * .7),
      hemiSky: grey(t.hemiSky, '#e8c9a4', sm * .6), hemiGround: grey(t.hemiGround, '#8a6c52', sm * .4) };
    // wireframe: a dark sky fading into the fog, whatever the time of day (no sun disc)
    if (this.wireframe) {
      const bg = this.route.scene.wire?.background || '#0c1424';
      t = { ...t, top: bg, horizon: '#' + new THREE.Color(bg).lerp(new THREE.Color('#3d5a80'), 0.35).getHexString(), sun: bg, exposure: 1 };
    }
    const el = THREE.MathUtils.degToRad(t.elev), az = THREE.MathUtils.degToRad(t.az);
    // azimuth from north, clockwise; north is −z, east is +x
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sunDir = dir;
    this.sun.color.set(t.sun);
    this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiI;
    this.renderer.toneMappingExposure = t.exposure;
    const u = this.sky.material.uniforms;
    u.topColor.value.set(t.top);
    u.horizonColor.value.set(t.horizon);
    u.sunColor.value.set(t.sun);
    u.sunDir.value.copy(dir);
    u.uNight.value = t.night ? 1 : 0;
    this.scene.fog.color.set(t.horizon);
    // valley haze (haze.js): low air thickens in the morning, thins at midday; a scene can scale or deepen it
    if (this.stylized) {
      const A = this.atmosphere, strength = { morning: .5, golden: .32, midday: .2, night: .14 }[this.timeKey] ?? .25;
      HAZE.x = (A.hazeBaseM ?? this._hazeEle) - 10;
      HAZE.y = A.hazeM ?? 75;
      HAZE.z = Math.min(.85, strength * (A.haze ?? 1) * (1 + o * .4));
    } else HAZE.z = 0;
    // aerial perspective (vista kit): ridges fade toward a pale sky blue with distance, less on the tops
    const VH = this.vista?.haze;
    if (VH && !t.night) {
      const c = new THREE.Color(t.horizon).lerp(new THREE.Color(t.top), VH.blue);
      AERIAL_COLOR.r = c.r; AERIAL_COLOR.g = c.g; AERIAL_COLOR.b = c.b;
      Object.assign(AERIAL, { x: VH.rangeM, y: VH.strength * (1 - o * .3), z: VH.falloffM, w: VH.baseM ?? this._hazeEle });
    } else AERIAL.y = 0;
    this._fogBase = { near: this._fogBase?.near ?? this.scene.fog.near, far: this._fogBase?.far ?? this.scene.fog.far, color: new THREE.Color(t.horizon) };
    for (const a of this.areas?.values() || [{ terrain: this.terrain }]) { a.terrain?.setTime?.(this.timeKey); a.terrain?.setNight?.(t.night ? 1 : 0); }
    if (t.night && this.stylized && !this.headlight) {
      // a front light on the bike, so the road ahead reads in the dark
      this.headlight = new THREE.SpotLight('#fff1d6', 650, 85, .58, 1, 1.5);
      this.scene.add(this.headlight, this.headlight.target);
    }
    if (this.headlight) this.headlight.visible = !!t.night;
    for (const tu of [this.terrain?.uniforms, this.farTerrain?.uniforms]) {
      if (tu?.uSunDir) { tu.uSunDir.value.copy(dir); tu.uSkyTop.value.set(t.top); tu.uSkyHorizon.value.set(t.horizon); }
    }
    this.baked?.setLight(t);   // [baked-light]
    this.look?.applyLight();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.baked?.prepare();   // [w2-bake] the first bake behind the loader, before the ride
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  /** Point on the route at distance s: local position + forward direction. */
  pointAt(s) {
    const p = routePoint(this.route, this.index, s);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    this._frames = (this._frames || 0) + 1;
    this.perf?.begin(now);
    const dt = Math.min(1.0, (now - this._last) / 1000); // real time (movement must not lag on slow frames)
    this._last = now;

    // Follow the ride position smoothly: advance at the current speed, ease toward the real value.
    const src = this.source ? this.source() : { pos: 0, speed: 0, cadence: 0, riding: false };
    const total = this.route.total;
    const riderOut = this._riderPose ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
    let placed;
    if (this.path) {
      // network ride: follow the path, and stand on the city loop where that is
      this.p = this._followPath(this.p, src.pos, src.speed, dt);
      if (this._multi) this._areaTick(dt);
      this.s = this.path.worldAt(this.p, this.area.id).s;
      placed = this._placePath(this.p, RIDER_LANE, riderOut);
    } else {
      this.s += src.speed * dt;
      let err = src.pos - wrapDist(this.route, this.s);
      if (this.route.closed) { if (err > total / 2) err -= total; if (err < -total / 2) err += total; }
      if (Math.abs(err) > 60) this.s = src.pos; else this.s += err * Math.min(1, dt * 1.5);
      this.s = this.route.closed ? wrapDist(this.route, this.s) : Math.max(0, Math.min(total, this.s));
      // Rider placement: right-hand side of the road
      placed = this._place(this.s, RIDER_LANE, riderOut);
    }
    const { pos: riderPos, fwd, flat } = placed;
    this.crank += (src.cadence / 60) * Math.PI * 2 * dt;
    this.rider.update(riderPos, fwd, this.crank, src.speed, Math.min(dt, 0.1), src);
    // [7.5] the rider and bike lean into the turn (eased; the camera below stays level: it follows riderPos, not the model)
    this._lean = stepLean(this._lean, this._leanTarget(this.path ? this.p : this.s, RIDER_LANE, src.speed || 0, this.path), Math.min(dt, 0.1));
    this.rider.setLean?.(this._lean);   // (not the stand-in before the model loads)
    this._updatePacer(dt);

    this._updateCamera(riderPos, flat, fwd, dt, src.speed || 0);
    this.terrain.uniforms.uTime.value = now / 1000;
    this.weather?.tick(dt);
    this._underground(riderPos, dt);   // [subway]
    this.terrain.update(this.camera.position.x, this.camera.position.z, this._preload ? PRELOAD_MS : this.terrain.quality?.buildMs);
    if (this._preload) this.terrain.city?._stream?.(this.camera.position.x, this.camera.position.z, PRELOAD_MS);   // [phase 8] the start's city, nearest first
    if (this.terrain.tick) {
      const turn = this.route.turnS || total, back = this.route.turnS && this.s > turn;
      const rider = { x: riderPos.x, z: riderPos.z, out: back ? total - this.s : this.s, dir: back ? -1 : 1, speed: src.speed };
      // [network] a U-turn ahead on the path, in the same frame (out metres): oncoming traffic doesn't pass you just before it
      const U = this.path?.uturnAhead?.(this.p);
      if (U != null) { const w = this.path.worldAt(Math.max(0, U - 1), this.area?.id ?? null); if (w.area === (this.area?.id ?? w.area)) rider.uturn = w.s > turn ? total - w.s : w.s; }
      // [6.10] the pacer where it's drawn: the city's riders on the route keep out of its line too
      if (this.pacer?.group.visible && this._pacerPose) rider.pacer = { x: this._pacerPose.pos.x, z: this._pacerPose.pos.z, speed: this._pacerSpeed ?? src.speed };
      this.terrain.tick(this.camera.position, dt, rider);
    }
    if (this.headlight?.visible) {
      this.headlight.position.copy(riderPos).addScaledVector(flat, .6).y += 1.1;
      this.headlight.target.position.copy(riderPos).addScaledVector(flat, 22);
    }
    if (this.farTerrain) {
      this.farTerrain.uniforms.uTime.value = now / 1000;
      this.farTerrain.update(this.camera.position.x, this.camera.position.z);
      const on = this.farTerrain.covered;
      if (on !== this._farOn) {
        this._farOn = on;
        this.farTerrain.uniforms.uFar.value.z = on ? 1 : 0;
        this.farTerrain.group.visible = on;
        for (const a of this.areas.values()) a.terrain?.setFar(on);
        // see further once the real horizon is there
        this.scene.fog.far = on ? this.atmosphere.fogFarRealM : this.atmosphere.fogFarM;
        if (this._fogBase) this._fogBase.far = this.scene.fog.far;
        this.log('3d', on ? 'Far terrain ready: real horizon beyond 1.5 km' : 'Far terrain off', 'debug');
      }
    }

    this.sky.position.copy(this.camera.position);
    this.baked?.tick(dt);   // [baked-light]
    if (this.baked) { this._bakeLoader(); if (this.baked.frame.kind && !this.baked.preparing) this.perf?.flag(); }   // [w2-bake] loader; frames with bake work
    if (this.baked?.preparing) return;   // [w2-bake] nothing drawn behind the loader (the bake has the GPU)
    if (this._preload && this._frames % PRELOAD_DRAW_EVERY) return;   // [phase 8] behind the loading screen: drawn now and then only
    if (this.stylized) this._placeShadows(riderPos, flat);
    else {
      this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, 5000);
      this.sun.target.position.copy(this.camera.position);
    }
    this._render();
  }

  /**
   * The sun's shadow box follows the rider, moved only in whole shadow-map texels (so shadow edges stay
   * still instead of shimmering), and the shadow map is redrawn only when that box moved, or every other
   * frame for the things that move by themselves (wind, traffic, a rider standing still).
   */
  _placeShadows(riderPos, flat) {
    const target = _v1.copy(riderPos).addScaledVector(flat, 40);
    const span = this.baked?.ready ? this.baked.dynamicSpan : 105;   // [baked-light] moving things only
    const sm = this.renderer.shadowMap;
    // light-space axes, then snap the box centre to the texel grid
    const d = this.sunDir, right = _v2.set(0, 1, 0).cross(d);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = _v3.copy(d).cross(right).normalize();
    const texel = (2 * span) / this.sun.shadow.mapSize.x;
    const a = Math.round(target.dot(right) / texel) * texel, b = Math.round(target.dot(up) / texel) * texel, c = target.dot(d);
    target.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(d, c);
    const cam = this.sun.shadow.camera;
    const moved = !this._shadowAt || this._shadowAt.distanceToSquared(target) > 1e-6 || cam.right !== span;
    this.sun.position.copy(target).addScaledVector(d, 350);
    this.sun.target.position.copy(target);
    if (cam.right !== span) { Object.assign(cam, { left: -span, right: span, top: span, bottom: -span }); cam.updateProjectionMatrix(); }
    (this._shadowAt ||= new THREE.Vector3()).copy(target);
    this._shadowFrame = (this._shadowFrame || 0) + 1;
    if (!sm.enabled) return;
    sm.autoUpdate = false;
    sm.needsUpdate = moved || this._shadowFrame % 2 === 0;
  }

  /** Settings → Camera: 'closest' (default, PLAN 6.10), 'close' (speed feel) or 'classic' (the fixed 4.5 m camera). */
  setCamera(key) {
    this.camKey = CAMERAS[key] ? key : DEFAULT_CAMERA;
    this._camInit = false;   // jump straight to the new spot
  }

  // The one camera: chase, behind and above the rider (the drone, scenic, side and eye views were retired).
  // "Close" adds three speed cues (ride-feel-test): the field of view widens with speed (more road streams past
  // the edges), the camera drops back a touch when you accelerate and closes in when you slow, and a faint
  // road buzz grows with speed. "Classic" is the earlier fixed camera.
  _updateCamera(riderPos, flat, fwd, dt, speed = 0) {
    // scratch vectors (no allocations in the frame loop)
    const C = this._cam ||= { pos: new THREE.Vector3(), look: new THREE.Vector3(), v: 0, acc: 0, fov: 0, t: 0 };
    const up = UP, pos = C.pos, look = C.look;
    const K = CAMERAS[this.camKey] || CHASE;
    const step = Math.min(Math.max(dt, 0), 0.1);
    // smoothed acceleration (m/s²) for the pull-back, and smoothed speed for the field of view
    if (step > 0) {
      const a = (speed - C.v) / step;
      C.acc += (a - C.acc) * (1 - Math.exp(-step * 1.5));
      C.v = speed;
      C.t += step;
    }
    const pull = Math.max(-0.5, Math.min(0.7, C.acc * K.pull));
    // [7.2b] underground (a tunnel, an escalator shaft) the far-back chase would sit in the rock: ease toward the
    // "close" camera's spot on an underground stretch (this._camUnder, eased 0 → 1 in _underground)
    const u = Math.max(0, Math.min(1, this._camUnder || 0)), mix = (a, b) => a + (b - a) * u;
    const back = mix(K.back, CHASE_CLOSE.back), camUp = mix(K.up, CHASE_CLOSE.up), lookUp = mix(K.lookUp, CHASE_CLOSE.lookUp), ahead = mix(K.ahead, CHASE_CLOSE.ahead);
    // Aim a little low so the rider sits above the HUD strip at the bottom of the screen.
    pos.copy(riderPos).addScaledVector(flat, -(back + pull)).addScaledVector(up, camUp);
    look.copy(riderPos).addScaledVector(fwd, ahead).addScaledVector(up, lookUp);
    look.y += this.terrain.cameraLookUp?.(riderPos.x, riderPos.z) || 0;   // [F111] e.g. up into a glasshouse's dome
    // Keep the camera above ground (not underground: in a tunnel or an escalator shaft the ground is overhead)
    const g = this._underS ? null : this.terrain.heightAt(pos.x, pos.z);
    if (g != null && pos.y < g + K.ground) pos.y = g + K.ground;

    // field of view: base, widening smoothly to +speedFov by about 50 km/h
    const kph = speed * 3.6;
    const fov = K.fov + K.speedFov * (1 - Math.exp(-kph / 25));
    C.fov = !this._camInit || !C.fov ? fov : C.fov + (fov - C.fov) * (1 - Math.exp(-step * 2));
    if (Math.abs(this.camera.fov - C.fov) > 0.01) { this.camera.fov = C.fov; this.camera.updateProjectionMatrix(); }

    if (!this._camInit) {
      this.camera.position.copy(pos);
      this.camTarget.copy(look);
      this._camInit = true;
    } else {
      this.camera.position.lerp(pos, 1 - Math.exp(-dt * 3.5));
      this.camTarget.lerp(look, 1 - Math.exp(-dt * 5));
    }
    // road buzz: a centimetre or less, two out-of-step frequencies so it never looks like a regular bounce
    if (K.buzz && speed > 1) {
      const amp = K.buzz * Math.min(1, speed / 12);
      this.camera.position.y += amp * (Math.sin(C.t * 71) * 0.6 + Math.sin(C.t * 43.7) * 0.4);
    }
    this.camera.lookAt(this.camTarget);
  }

  /**
   * [subway] Underground (the drawn line's `routeUnderground`, js/world/ghost.js): the camera may go under the ground
   * (no lift over it), and the deeper the rider is under the ground above, the more the air is a lit tunnel's —
   * the fog closes in and warms — so the far end of a tunnel glows instead of showing the sky's haze. Eased.
   */
  _underground(riderPos, dt) {
    const turn = this.route.turnS || this.route.total, out = this.s > turn ? this.route.total - this.s : this.s;
    this._underS = undergroundAt(this.route, out);
    const g = this._underS ? this.terrain.heightAt(riderPos.x, riderPos.z) : null;
    const target = g == null ? 0 : Math.max(0, Math.min(1, (g - riderPos.y - 2) / 4));
    const u = this._under = (this._under || 0) + (target - (this._under || 0)) * Math.min(1, dt * 1.5);
    const nearUnder = this._underS || undergroundAt(this.route, out - 25) || undergroundAt(this.route, out + 25);   // (and its portals: the far camera would sit in the mouth)
    this._camUnder = (this._camUnder || 0) + ((nearUnder ? 1 : 0) - (this._camUnder || 0)) * Math.min(1, dt * 2);   // [7.2b]
    const f = this.scene.fog, b = this._fogBase;
    if (!f || !b) return;
    if (u > .002) {
      if (!this.weather) { f.near = b.near; f.far = b.far; f.color.copy(b.color); }
      f.near += (30 - f.near) * u; f.far += (460 - f.far) * u; f.color.lerp(TUNNEL_AIR, u * .9);
      this._fogTunnel = true;
    } else if (this._fogTunnel) {
      if (!this.weather) { f.near = b.near; f.far = b.far; f.color.copy(b.color); }
      this._fogTunnel = false;
    }
  }

  _render() {
    this.look?.sweep();   // patch any material that arrived since the last frame (new tiles reuse patched ones)
    if (this.post && (!this.heroPost || this.qualityKey === 'low')) this.post.render(this.scene, this.camera, { grade: false });
    else if (this.post) {
      const k = this.timeKey, o = this._weatherLight?.overcast || 0;
      this.post.render(this.scene, this.camera, {
        bloom: (k === 'night' ? .38 : k === 'golden' ? .42 : .26) * (1 - o * .5),
        threshold: k === 'night' ? .7 : 1.15, warm: k === 'golden' || k === 'morning' ? 1 - o : 0 });
    } else this.renderer.render(this.scene, this.camera);
    this.perf?.end(performance.now());
  }

  /** Performance overlay (fps, frame time, draw calls, triangles). Returns a summary line when switched off. */
  togglePerf(on, place) {
    this.perf ||= new PerfMonitor(this.renderer, this.container, () => ({
      route: this.route.scene?.title || this.route.name, quality: this.qualityKey, time: this.timeKey,
      weather: this.weather ? this.weatherKey : null,
      bake: this.baked?.costLine(),   // [w2-bake]
    }), place);
    return this.perf.toggle(on);
  }

  /** Render one frame without the animation loop (used for previews/tests). */
  renderOnce() { const r = this.running; this.running = true; this._frame(performance.now()); this.running = r; cancelAnimationFrame(this._raf); }

  /** [phase 8] The app's loading screen is up: build the start faster (PRELOAD_MS), draw only now and then. */
  setPreload(on) { this._preload = !!on; }
  /** [phase 8] The world is holding the rider while the streets ahead load (the fade): the app holds the clock. */
  get waitingForArea() { return !!this._waitingArea && this.running; }
  /**
   * [phase 8] How far the start is from ready, for the loading screen: { ready, failed, progress 0..1, steps:
   * [{ key, label, p, done }] }. Ready = the start area fully built: the scenery's assets, the ground tiles round the
   * start, the roads and buildings within START_NEAR_M (and an area the path enters within 500 m, on a city of areas),
   * the first bake, the rider (and pacer) models. Further areas still load during the ride.
   */
  readiness() {
    const t = this.terrain, c = this.camera.position, steps = [];
    const add = (key, label, p) => { p = Math.max(0, Math.min(1, p)); steps.push({ key, label, p, done: p >= 1 }); };
    const drawn = (this._frames || 0) > 0;
    const kitIn = drawn && (this.stylized ? (t.stats?.loading ?? 0) === 0 : t.loadingCount === 0);
    add('scenery', 'Scenery', kitIn ? 1 : 0);
    // the ground: the tiles wanted round the start (stylized: the build queue; real terrain: tiles being fetched)
    const q = this.stylized ? (t.stats?.queued ?? 0) + (t._want ? 0 : 1) : t.loadingCount;
    this._q0 = Math.max(this._q0 || 0, q);
    // (and the real horizon, if it's coming: its tiles in flight, then the stylized ground re-made for it — seconds of
    // work best done here than on the first pedal strokes; offline it never arrives and isn't waited for)
    const f = this.farTerrain, farIn = !f || (f.loadingCount === 0 && !!this._farOn === !!f.covered);
    add('ground', 'Ground', !kitIn ? 0 : q === 0 && farIn ? 1 : q === 0 ? .95 : Math.min(.95, 1 - q / this._q0));
    // roads and buildings near the start (and, on a city of areas, an area the path enters within 500 m)
    let n = kitIn ? (t.city?.pendingNear?.(c.x, c.z, START_NEAR_M) ?? 0) : 1;
    if (this._multi) for (const id of [this.area.id, ...(this._soon || [])]) if (!this.areas.get(id)?.ready && !this._areaFailed(id)) n++;
    this._n0 = Math.max(this._n0 || 0, n);
    add('streets', 'Roads & buildings', n === 0 ? 1 : 1 - n / Math.max(1, this._n0));
    // the light: the first bake (behind the loader), if the route bakes its light
    const b = this.baked;
    add('light', 'Light', !b || b.prepMs != null ? 1 : b.preparing ? b.progress * .98 : 0);
    const pacerWanted = !!this.pacerSource?.();
    const riders = (this._riderModel !== 'loading' ? 1 : 0) + (!pacerWanted || this.pacer || this._pacerFailed ? 1 : 0);
    add('riders', 'Riders', riders / 2);
    const failed = (t.stats?.errors ?? 0) > 0 || !!t.failed;
    return { ready: steps.every((s) => s.done), failed, progress: steps.reduce((a, s) => a + s.p, 0) / steps.length, steps };
  }

  get loading() { return this.terrain.loadingCount + (this.baked?.preparing ? 4 : 0) + (this._waitingArea || (this._multi && this._planAreas().some((id) => !this.areas.get(id)?.ready)) ? 4 : 0); }   // [w2-bake] (4: the app's loading bar shows from 4)

  /** [w2-bake] "Preparing scenery" over the view while the first bake runs behind it. */
  _bakeLoader() {
    const on = this.baked.preparing;
    if (!on && !this._bakeEl) return;
    if (!this._bakeEl) {
      this._bakeEl = document.createElement('div');
      this._bakeEl.className = 'bake-loader';
      Object.assign(this._bakeEl.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5,
        font: '600 15px/1.4 system-ui, sans-serif', color: '#e8eef6', background: 'linear-gradient(#24323f, #3c4a52)', pointerEvents: 'none', letterSpacing: '.02em' });
      this.container.appendChild(this._bakeEl);
    }
    this._bakeEl.style.display = on ? 'flex' : 'none';
    if (on) this._bakeEl.textContent = `Preparing scenery… ${Math.round(this.baked.progress * 100)}%`;
  }

  dispose() {
    this.perf?.dispose();
    this.disposed = true;
    this.stop();
    this._ro.disconnect();
    this.weather?.dispose();
    this.baked?.dispose();   // [baked-light]
    this._bakeEl?.remove();   // [w2-bake]
    this.post?.dispose();
    this.courseArches?.dispose();
    for (const a of this.areas.values()) if (a !== this.area) a.terrain?.dispose();
    this._fadeEl?.remove();
    this.terrain.dispose();
    this.farTerrain?.dispose();
    this.sun.shadow.map?.dispose(); this.sun.shadow.mapPass?.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach((m) => { for (const key of ['map', 'bumpMap', 'roughnessMap']) m[key]?.dispose(); m.dispose(); });
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** EXT_clip_control (needed for the reversed depth buffer); checked once on a throwaway context. */
let clipControl = null;
function hasClipControl() {
  if (clipControl === null) {
    const gl = document.createElement('canvas').getContext('webgl2');
    clipControl = !!gl?.getExtension('EXT_clip_control');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return clipControl;
}

// ---------- Sky ----------
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color('#3f7fd0') },
      horizonColor: { value: new THREE.Color('#c6dbef') },
      sunColor: { value: new THREE.Color('#ffffff') },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunColor; uniform vec3 sunDir; uniform float uNight;
      varying vec3 vDir;
      float skyHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.45));
        if (d.y < 0.0) col = horizonColor * 0.92;
        float s = max(dot(d, normalize(sunDir)), 0.0);
        if (uNight > 0.5) {
          // the moon instead of the sun, stars above the haze
          col += sunColor * (smoothstep(.99955, .99975, s) * 1.6 + pow(s, 40.0) * .08);
          vec3 cell = floor(d * 260.);
          float star = step(.9965, skyHash(cell)) * smoothstep(.08, .35, d.y);
          col += vec3(.9, .93, 1.) * star * (.5 + .5 * skyHash(cell + 3.));
          col += vec3(.35, .22, .12) * pow(1. - h, 8.) * .35;   // city glow on the horizon
        } else col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

// An out-and-back route rides the same road twice: draw it once (outbound half only).
const roadPoints = (route) => (route.turnIdx ? route.turnIdx + 1 : route.dist.length);

// ---------- Road ----------
function makeRoad(route, index, opts = {}) {
  [route, index] = denseRoad(route, index);   // [road-align] the curved centre line, when the scene asks for it
  const stylized = route.scene?.style === 'stylized';
  const n = roadPoints(route);
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const E = ribbonSections(index, n, ROAD_WIDTH / 2);   // [smooth-turns] left/right edges (no folds with roadAlign.turns)
  const fade = roadFades(route, index, n, opts.widthAt);   // [F133] an apron's road ending mid-street: its last 50 m fade into the street
  if (fade) taperSections(E, index, n, fade.half, ROAD_WIDTH / 2);
  for (let i = 0; i < n; i++) {
    const y = route.ele[i] + 0.12;
    pos.set([E[i * 4], y, E[i * 4 + 1], E[i * 4 + 2], y, E[i * 4 + 3]], i * 6);
    const v = route.dist[i] / 24;
    uv.set([0, v, 1, v], i * 4);
  }
  const idx = [], quadAt = [];   // quadAt: the sample each quad starts at (ghost quads are left out, so idx isn't 6 per sample)
  for (let i = 0; i < n - 1; i++) {
    if (ghostAt(route, (route.dist[i] + route.dist[i + 1]) / 2)) continue;   // a network tour's repeat: drawn once, on its real pass
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3; // a,c = left edge; b,d = right edge
    idx.push(a, b, c, b, d, c);
    quadAt.push(i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Asphalt with edge lines and a dashed yellow centre line
  const c = document.createElement('canvas');
  c.width = stylized ? 256 : 64; c.height = stylized ? 512 : 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = stylized ? '#555c60' : '#4d5054'; ctx.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 900; k++) { // grain
    const g = stylized ? 80 + Math.random() * 8 : 62 + Math.random() * 28;
    ctx.fillStyle = `rgb(${g},${g},${g + 2})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1);
  }
  ctx.fillStyle = '#d9d9d2'; ctx.fillRect(2, 0, 2, 256); ctx.fillRect(60, 0, 2, 256);
  ctx.fillStyle = '#d8b23a'; ctx.fillRect(30, 0, 1.5, 150); ctx.fillRect(32.5, 0, 1.5, 150);
  if (stylized) {
    // Crisp, restrained paint and grain suit the sculpted scenery.
    ctx.fillStyle = '#555c60'; ctx.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < 13000; k++) {
      const g = 69 + Math.random() * 24;
      ctx.fillStyle = `rgba(${g},${g + 3},${g + 5},.3)`;
      ctx.fillRect(Math.random() * c.width, Math.random() * c.height, .6, 1);
    }
    if (route.scene?.road?.markings === 'fr') {
      // French roads: no paint in the texture; road-surface.js draws it in metres by the French rules
    } else if (route.scene?.road?.markings === 'eu') {
      // European roads (Alpe d'Huez): a white dashed centre line (3 m on, 9 m off) and dashed white edges (3 m / 3 m)
      ctx.fillStyle = '#ece9de';
      for (let y = 0; y < c.height; y += 256) ctx.fillRect(126, y, 4, 64);
      for (let y = 0; y < c.height; y += 128) { ctx.fillRect(8, y, 3, 64); ctx.fillRect(245, y, 3, 64); }
    } else {
      ctx.fillStyle = '#e8e4d0'; ctx.fillRect(8, 0, 3, c.height); ctx.fillRect(245, 0, 3, c.height);
      ctx.fillStyle = '#e4c36a'; ctx.fillRect(124, 0, 2, c.height); ctx.fillRect(130, 0, 2, c.height);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const roadOptions = { map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const mat = stylized ? new THREE.MeshStandardMaterial({ ...roadOptions, roughness: .94, metalness: .015 }) : new THREE.MeshLambertMaterial(roadOptions);
  // road surface by area and condition (js/world/toolbox/materials/road-surface.js): the scene's "road" block
  const marks = stylized && route.scene.road?.markings === 'fr' ? frenchMarkings(route.scene.road, route, index, { widthM: ROAD_WIDTH, boards: route.scene.boards || [] }) : null;
  if (stylized && route.scene.road) decorateRoad(mat, route.scene.road, { widthM: ROAD_WIDTH, repeatM: 24, marks });
  if (stylized) {
    const data = new Uint8Array(128 * 128 * 4);
    for (let k = 0; k < data.length; k += 4) { const v = 105 + Math.random() * 45; data.set([v, v, v, 255], k); }
    const bump = new THREE.DataTexture(data, 128, 128); bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(5, 10); bump.generateMipmaps = true; bump.minFilter = THREE.LinearMipmapLinearFilter; bump.needsUpdate = true;
    mat.bumpMap = bump; mat.bumpScale = .003;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.receiveShadow = stylized;
  const kinds = route.scene?.city?.routeKinds;
  if (!kinds) return mesh;
  // A city route: streets keep the lane paint; riverfront trails and park paths get a plain,
  // lighter surface with a dashed white centre line.
  const trail = (i) => (kinds.find((k) => route.dist[i] >= k.fromM && route.dist[i] < k.toM) || {}).kind === 'trail';
  const roadIdx = [], trailIdx = [], fadeRoadIdx = [], fadeTrailIdx = [];
  // [F133] the quads of a fading end go to their own transparent meshes (the street shows through as they fade)
  const fading = (i) => fade && (fade.alpha[i] < .999 || fade.alpha[i + 1] < .999);
  // (by the quad's own sample: after a ghost stretch, slicing idx by sample shifted every later stretch's paint
  // by the ghost's length — F45: road paint on the South Side Trail at S, the Homestead riverfront)
  quadAt.forEach((i, q) => (trail(i) ? (fading(i) ? fadeTrailIdx : trailIdx) : (fading(i) ? fadeRoadIdx : roadIdx)).push(...idx.slice(q * 6, q * 6 + 6)));
  geo.setIndex(roadIdx);
  const tc = document.createElement('canvas'); tc.width = 64; tc.height = 256;
  const t = tc.getContext('2d');
  t.fillStyle = '#6d6a64'; t.fillRect(0, 0, 64, 256);
  for (let k = 0; k < 2200; k++) { const g = 92 + Math.random() * 30; t.fillStyle = `rgba(${g},${g - 2},${g - 6},.5)`; t.fillRect(Math.random() * 64, Math.random() * 256, 1, 1); }
  t.fillStyle = '#e9e6da'; t.fillRect(31, 0, 2, 110);
  const ttex = new THREE.CanvasTexture(tc); ttex.wrapT = THREE.RepeatWrapping; ttex.colorSpace = THREE.SRGBColorSpace; ttex.anisotropy = 8;
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', geo.attributes.position); tgeo.setAttribute('uv', geo.attributes.uv); tgeo.setAttribute('normal', geo.attributes.normal);
  tgeo.setIndex(trailIdx);
  const tmat = new THREE.MeshStandardMaterial({ map: ttex, roughness: .95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // [finish] the trails' own surface by stretch (road-surface.js): the scene's "road": { "trail": { surface, zones } }
  if (stylized && route.scene.road?.trail) decorateRoad(tmat, route.scene.road.trail, { widthM: ROAD_WIDTH, repeatM: 24 });
  const tmesh = new THREE.Mesh(tgeo, tmat);
  tmesh.frustumCulled = false; tmesh.renderOrder = 2; tmesh.receiveShadow = true;
  const group = new THREE.Group(); group.add(mesh, tmesh);
  // [F133] the fading ends: the same surface (a copy of the material, decorated alike), its alpha per vertex
  if (fade) {
    const alpha = new THREE.BufferAttribute(fadeColors(fade.alpha, n), 4);
    const fadeMesh = (src, list, decorate, name) => {
      if (!list.length) return;
      const g = new THREE.BufferGeometry();
      for (const k of ['position', 'uv', 'normal']) g.setAttribute(k, geo.attributes[k]);
      g.setAttribute('color', alpha); g.setIndex(list);
      const m = src.material.clone();
      Object.assign(m, { transparent: true, depthWrite: false, vertexColors: true });
      decorate?.(m);
      const fm = new THREE.Mesh(g, m);
      fm.frustumCulled = false; fm.renderOrder = 2; fm.receiveShadow = src.receiveShadow; fm.name = name;
      fm.userData.fadeOf = src.name || (src === mesh ? 'road' : 'trail');
      group.add(fm);
    };
    fadeMesh(mesh, fadeRoadIdx, stylized && route.scene.road ? (m) => decorateRoad(m, route.scene.road, { widthM: ROAD_WIDTH, repeatM: 24, marks }) : null, 'Route road fade');
    fadeMesh(tmesh, fadeTrailIdx, stylized && route.scene.road?.trail ? (m) => decorateRoad(m, route.scene.road.trail, { widthM: ROAD_WIDTH, repeatM: 24 }) : null, 'Route trail fade');
    group.userData.fades = fade.ends;
  }
  return group;
}

/**
 * [F133] The width of the street a route runs on, from the city landscape: the street under most of the points
 * (its centre line within its own carriageway), a path only where no street is. Null where none is found.
 */
export function streetWidthAt(L) {
  if (!L?.streetAt) return null;
  return (pts) => {
    const seen = new Map();
    for (const p of pts) {
      const h = L.streetAt(p.x, p.z, 0);
      if (!h || h.d > h.st.width / 2) continue;
      const o = seen.get(h.k) || { n: 0, st: h.st }; o.n++; seen.set(h.k, o);
    }
    const best = [...seen.values()].sort((a, b) => b.n - a.n || (a.st.cls === 8) - (b.st.cls === 8))[0];
    return best && best.n >= Math.min(2, pts.length) ? best.st.width : null;
  };
}

/** [F133] The apron ends of a city route whose road fades into the street (js/world/road-align.js apronFades), cached on the dense route. */
function roadFades(route, index, n, widthAt) {
  if (!route.scene?.city?.routeAprons?.length) return null;
  if (route._fades?.index !== index) Object.defineProperty(route, '_fades', { value: { index, fade: apronFades(route, index, n, { roadWidth: ROAD_WIDTH, widthAt }) }, enumerable: false, configurable: true, writable: true });
  return route._fades.fade;
}
/** Narrow ribbon cross-sections to `half` per sample (about the centre line), where it is under `full`. */
function taperSections(E, index, n, half, full) {
  for (let i = 0; i < n; i++) {
    const k = half[i] / full;
    if (k >= .999) continue;
    const cx = index.xs[i], cz = index.zs[i];
    for (const o of [0, 2]) { E[i * 4 + o] = cx + (E[i * 4 + o] - cx) * k; E[i * 4 + o + 1] = cz + (E[i * 4 + o + 1] - cz) * k; }
  }
}
/** White RGBA per ribbon vertex (two a sample), the alpha the fade's. */
function fadeColors(alpha, n) {
  const c = new Float32Array(n * 2 * 4).fill(1);
  for (let i = 0; i < n; i++) { c[i * 8 + 3] = alpha[i]; c[i * 8 + 7] = alpha[i]; }
  return c;
}

// ---------- Shoulders ----------
function makeRibbon(route, index, width, lift, tex, repeatM, offset, widthAt = null) {
  [route, index] = denseRoad(route, index);   // [road-align]
  const n = roadPoints(route);
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
  const E = ribbonSections(index, n, width / 2);   // [smooth-turns]
  // [F133] where an apron's road fades into the street, its shoulder narrows with it and fades too
  const fade = roadFades(route, index, n, widthAt);
  if (fade) taperSections(E, index, n, Float32Array.from(fade.half, (h) => width / 2 - (ROAD_WIDTH / 2 - h)), width / 2);
  for (let i = 0; i < n; i++) {
    const y = route.ele[i] + lift;
    pos.set([E[i * 4], y, E[i * 4 + 1], E[i * 4 + 2], y, E[i * 4 + 3]], i * 6);
    const v = route.dist[i] / repeatM;
    uv.set([0, v, 1, v], i * 4);
  }
  // a hairpin's apex: the ribbon's cross-sections swing round faster than it can follow, so its quads there
  // would sweep a sliver across the road; leave them out (the road itself covers the apex)
  const sharp = (i) => {
    const h = (k) => Math.atan2(index.zs[Math.min(n - 1, k + 1)] - index.zs[Math.max(0, k - 1)], index.xs[Math.min(n - 1, k + 1)] - index.xs[Math.max(0, k - 1)]);
    let d = Math.abs(h(i + 1) - h(i)); if (d > Math.PI) d = 2 * Math.PI - d;
    return d > .6;
  };
  const idx = [];
  for (let i = 0; i < n - 1; i++) { if (route.scene?.switchbacks && sharp(i)) continue; if (ghostAt(route, (route.dist[i] + route.dist[i + 1]) / 2)) continue; const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (fade) geo.setAttribute('color', new THREE.BufferAttribute(fadeColors(fade.alpha, n), 4));
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, vertexColors: !!fade, ...offset });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

/** Gravel/dirt shoulder that fades into the ground at its outer edges. */
function makeGravelTexture(stylized = false, city = false) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const k = (y * 64 + x) * 4;
      const g = city ? 168 + Math.random() * 8 : stylized ? 162 + Math.random() * 12 : 105 + Math.random() * 60;
      if (city) { img.data[k] = g; img.data[k + 1] = g * .98; img.data[k + 2] = g * .94; }
      else { img.data[k] = g * 1.02; img.data[k + 1] = g * 0.96; img.data[k + 2] = g * 0.86; }
      const edge = Math.min(x, 63 - x) / 63;          // 0 at the outside, 0.5 at the centre
      img.data[k + 3] = city ? 255 * Math.min(1, Math.max(0, (edge - .005) / .02)) : 255 * Math.min(1, Math.max(0, (edge - 0.02) / 0.14)) * (0.75 + Math.random() * 0.25);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Rider ----------
function makeRider() {
  const group = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const jersey = mat('#ff7a1a'), shorts = mat('#1d1f24'), skin = mat('#d9a882'), frameM = mat('#22252b'),
    tyre = mat('#111111'), helmet = mat('#f2f2f2'), shoe = mat('#f2f2f2');

  const cyl = (m, r = 0.03) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), m); group.add(g); return g; };
  const place = (mesh, a, b) => {
    const d = b.clone().sub(a);
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.scale.set(1, d.length(), 1);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // Bike (forward is +z in the model)
  const wheels = [];
  for (const z of [-0.52, 0.52]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.022, 8, 28), tyre);
    w.rotation.y = Math.PI / 2;
    w.position.set(0, 0.34, z);
    group.add(w);
    wheels.push(w);
  }
  const crankC = V(0, 0.29, 0.02), seat = V(0, 0.98, -0.2), head = V(0, 0.92, 0.42), bar = V(0, 1.0, 0.47);
  for (const [a, b] of [[V(0, 0.34, -0.52), crankC], [crankC, seat], [seat, head], [crankC, head], [V(0, 0.34, -0.52), seat], [head, V(0, 0.34, 0.52)]]) {
    place(cyl(frameM, 0.018), a, b);
  }
  place(cyl(frameM, 0.016), V(-0.2, 1.0, 0.47), V(0.2, 1.0, 0.47));

  // Rider body
  const hip = V(0, 1.02, -0.18), shoulder = V(0, 1.42, 0.22), headC = V(0, 1.57, 0.32);
  const torso = cyl(jersey, 0.13); place(torso, hip, shoulder);
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), skin);
  headM.position.copy(headC); group.add(headM);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
  helm.position.copy(headC).add(V(0, 0.02, -0.01)); group.add(helm);
  for (const x of [-0.17, 0.17]) {
    const sh = shoulder.clone().setX(x * 0.9), hand = V(x, 1.0, 0.47);
    const elbow = sh.clone().lerp(hand, 0.5).add(V(0, -0.06, -0.05));
    place(cyl(jersey, 0.045), sh, elbow);
    place(cyl(skin, 0.035), elbow, hand);
  }
  const legs = [-0.1, 0.1].map((x) => ({ x, thigh: cyl(shorts, 0.06), shin: cyl(skin, 0.045), foot: (() => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.2), shoe); group.add(f); return f;
  })() }));

  const THIGH = 0.47, SHIN = 0.46, CRANK = 0.17;
  function update(pos, fwd, crank, speed, dt) {
    group.position.copy(pos);
    group.lookAt(pos.clone().add(fwd));
    for (const w of wheels) w.rotation.x -= (speed / 0.34) * dt;
    legs.forEach((leg, i) => {
      const a = crank + i * Math.PI;
      const pedal = V(leg.x, crankC.y + Math.cos(a) * CRANK, crankC.z + Math.sin(a) * CRANK);
      const h = V(leg.x, hip.y, hip.z);
      // two-bone IK in the y/z plane, knee forward
      const d = Math.min(THIGH + SHIN - 0.001, h.distanceTo(pedal));
      const ang = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d));
      const dir = pedal.clone().sub(h).normalize();
      const base = Math.atan2(dir.z, -dir.y);
      const knee = V(leg.x, h.y - Math.cos(base + ang) * THIGH, h.z + Math.sin(base + ang) * THIGH);
      place(leg.thigh, h, knee);
      place(leg.shin, knee, pedal);
      leg.foot.position.copy(pedal).add(V(0, -0.02, 0.03));
    });
  }
  return { group, update };
}
