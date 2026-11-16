// The 3D ride view: real terrain + aerial imagery, the road, a pedalling rider, sky and cameras.
import * as THREE from '../../vendor/three.module.min.js';
import { makeProjection, makeRouteIndex } from './geo.js';
import { Terrain } from './terrain.js';
import { Weather } from './weather.js';
import { PostFX } from './post.js';
import { StylizedTerrain, COASTAL_QUALITY } from './stylized-terrain.js';
import { riderPose, routePoint, ROAD_WIDTH } from './pose.js';
import { loadRider } from './rider.js';
import { PerfMonitor } from './perf.js';
import { wrapDist } from '../gpx.js';

export const TIME_PRESETS = {
  morning: { label: 'Morning', elev: 14, az: 105, top: '#6f9fd8', horizon: '#f2d6b8', hemiSky: '#f6eedf', hemiGround: '#9a917e', sun: '#ffe2b8', sunI: 0.45, hemiI: 1.45, exposure: 1.0 },
  midday: { label: 'Midday', elev: 58, az: 180, top: '#3f7fd0', horizon: '#c6dbef', hemiSky: '#ffffff', hemiGround: '#a39b88', sun: '#ffffff', sunI: 0.55, hemiI: 1.35, exposure: 1.0 },
  golden: { label: 'Golden hour', elev: 7, az: 258, top: '#5c78b4', horizon: '#f7b77d', hemiSky: '#ffe6c8', hemiGround: '#9a8670', sun: '#ffc27a', sunI: 0.45, hemiI: 1.4, exposure: 1.05 },
  // v0.12: moonlight, a deep blue sky with stars, and (in a city) the lights come on
  night: { label: 'Night', elev: 40, az: 150, top: '#0a1226', horizon: '#2a3150', hemiSky: '#7d8fbf', hemiGround: '#2b2b35', sun: '#b4c6ea', sunI: 0.3, hemiI: 0.5, exposure: 1.2, night: true },
};

// Stylized foreground → real far terrain hand-off (metres from the camera)
const FAR_INNER = 1500, FAR_BAND = 400;
const RIDER_LANE = 0.22;   // × road width, right of the centre line
const PACER_LANE = 0.07;   // a bike-width further in, so you can ride alongside or pass

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
    this.cameraMode = 'chase';
    this.s = 0;               // displayed position along the route (m)
    this.crank = 0;
    this.running = false;
    this.source = null;       // () => {pos, speed, cadence, riding}
    this.stylized = route.scene?.style === 'stylized';
    this.qualityKey = Object.hasOwn(COASTAL_QUALITY, opts.quality) ? opts.quality : 'balanced';

    // Projection centred on the route
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < route.lat.length; i++) {
      minLat = Math.min(minLat, route.lat[i]); maxLat = Math.max(maxLat, route.lat[i]);
      minLon = Math.min(minLon, route.lon[i]); maxLon = Math.max(maxLon, route.lon[i]);
    }
    this.proj = makeProjection((minLat + maxLat) / 2, (minLon + maxLon) / 2);
    this.index = makeRouteIndex(route, this.proj);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.stylized ? COASTAL_QUALITY[this.qualityKey].pixelRatio : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.prepend(this.renderer.domElement);
    this.renderer.domElement.className = 'world-canvas';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 150000);
    this.camTarget = new THREE.Vector3();
    this._camInit = false;

    // Light + sky
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    if (this.stylized) {
      this.renderer.shadowMap.enabled = COASTAL_QUALITY[this.qualityKey].shadows;
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
    this.atmosphere = { fogNearM: 2300, fogFarM: 16500, fogFarRealM: 30000, ...(this.stylized ? route.scene.atmosphere : {}) };
    this.scene.fog = new THREE.Fog(0xc6dbef, this.stylized ? this.atmosphere.fogNearM : 4000, this.stylized ? this.atmosphere.fogFarM : 70000);

    const TerrainClass = this.stylized ? StylizedTerrain : Terrain;
    this.terrain = new TerrainClass(this.scene, this.proj, this.index, {
      route,
      quality: this.qualityKey,
      bbox: { minLat, maxLat, minLon, maxLon },
      renderer: this.renderer,
      farInner: FAR_INNER, farBand: FAR_BAND,
      onError: (err) => this.log('3d', `Tile load problem: ${err.message}`, 'debug'),
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
    this.shoulder = makeRibbon(route, this.index, ROAD_WIDTH + (city ? 4 : this.stylized ? 1.6 : 3.4), city ? .09 : 0.05, makeGravelTexture(this.stylized, city), 3, { polygonOffsetFactor: city ? -1.8 : -1, polygonOffsetUnits: city ? -1.8 : -1 });
    this.scene.add(this.shoulder);
    this.road = makeRoad(route, this.index);
    this.scene.add(this.road);
    // weather: clear / marine layer / clouds / rain (stylized scenery)
    if (this.stylized) this.weather = new Weather(this, this.terrain.uniforms);
    // hero scenery: HDR render with soft bloom, a gentle grade and vignette (off on Light detail)
    if (this.stylized && route.scene.post) this.post = new PostFX(this.renderer);
    // Simple stand-in until the Blender model loads
    this.rider = makeRider();
    this.scene.add(this.rider.group);
    loadRider().then((r) => {
      if (this.disposed) return;
      this.scene.remove(this.rider.group);
      this.rider = r;
      if (this.stylized) r.group.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(r.group);
      this.log('3d', `Rider model loaded (${r.triangles.toLocaleString()} triangles)`, 'debug');
    }).catch((err) => this.log('3d', `Using the simple rider: ${err.message}`, 'debug'));

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

  /** The virtual pacer: a function returning {pos, speed, cadence} along the route, or null when off. */
  setPacerSource(fn) { this.pacerSource = fn; this._pacerInit = false; }

  /** Point on the road at distance s, `lane` × road width right of the centre line (with the U-turn drifts). */
  _place(s, lane) {
    // shared with the course QC sweep (js/world/pose.js)
    const pose = riderPose(this.route, this.index, s, lane);
    return {
      pos: new THREE.Vector3(pose.pos.x, pose.pos.y, pose.pos.z),
      fwd: new THREE.Vector3(pose.fwd.x, pose.fwd.y, pose.fwd.z),
      flat: new THREE.Vector3(pose.flat.x, 0, pose.flat.z),
    };
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
        }).catch((err) => this.log('3d', `Pacer model: ${err.message}`, 'debug'));
      }
      return;
    }
    const total = this.route.total;
    // Same smoothing as the rider: roll at its speed, ease toward the true position.
    if (!this._pacerInit) { this.ps = src.pos; this.pacerCrank = 0; this._pacerInit = true; }
    this.ps += src.speed * dt;
    let err = src.pos - wrapDist(this.route, this.ps);
    if (this.route.closed) { if (err > total / 2) err -= total; if (err < -total / 2) err += total; }
    if (Math.abs(err) > 60) this.ps = src.pos; else this.ps += err * Math.min(1, dt * 1.5);
    this.ps = this.route.closed ? wrapDist(this.route, this.ps) : Math.max(0, Math.min(total, this.ps));
    const { pos, fwd } = this._place(this.ps, PACER_LANE);
    this.pacerCrank += (src.cadence / 60) * Math.PI * 2 * dt;
    this.pacer.group.visible = true;
    this.pacer.update(pos, fwd, this.pacerCrank, src.speed, Math.min(dt, 0.1));
  }

  setCamera(mode) { this.cameraMode = mode; this._camInit = false; }

  /** clear | marine | clouds | rain (eases in over a few seconds). */
  /** The weather presets this route offers (a scene can limit and rename them: Pittsburgh's "River fog"). */
  weatherOptions() {
    if (!this.weather) return [];
    const S = this.route.scene?.weather || {}, keys = S.presets || ['clear', 'marine', 'clouds', 'rain'];
    const names = { clear: 'Clear', marine: 'Marine layer', clouds: 'Clouds', rain: 'Rain', ...(S.labels || {}) };
    return keys.map((key) => ({ key, label: names[key] || key }));
  }
  setWeather(key, immediate = false) {
    const options = this.weatherOptions();
    if (options.length && !options.some((o) => o.key === key)) key = options[0].key;   // not offered here: the route's first
    this.weatherKey = key; this.weather?.set(key, immediate);
  }

  setQuality(key) {
    if (!this.stylized) return;
    this.qualityKey = Object.hasOwn(COASTAL_QUALITY, key) ? key : 'balanced';
    const quality = COASTAL_QUALITY[this.qualityKey];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    this.renderer.shadowMap.enabled = quality.shadows;
    const resolution = this.qualityKey === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== resolution) {
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(resolution, resolution);
    }
    this.terrain.setQuality(this.qualityKey);
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    this._resize?.();
  }

  setTimeOfDay(key) {
    if (key === 'auto' || !key) key = this.route.scene?.timeOfDay || 'midday';   // "Route's default"
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
    const w = this._weatherLight || { overcast: 0, rain: 0 }, o = w.overcast;
    const grey = (c, to, k) => '#' + new THREE.Color(c).lerp(new THREE.Color(to), k).getHexString();
    const t = o > 0.001 && !base.night ? { ...base,
      sunI: base.sunI * (1 - o * .78), hemiI: base.hemiI * (1 + o * .18), exposure: base.exposure * (1 - o * .06),
      top: grey(base.top, '#8b959c', o * .85), horizon: grey(base.horizon, '#b9c0c3', o * .8), sun: grey(base.sun, '#dfe3e6', o * .6),
      hemiSky: grey(base.hemiSky, '#d4d9dc', o * .7) } : base;
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
    this._fogBase = { near: this._fogBase?.near ?? this.scene.fog.near, far: this._fogBase?.far ?? this.scene.fog.far, color: new THREE.Color(t.horizon) };
    this.terrain?.setTime?.(this.timeKey);
    this.terrain?.setNight?.(t.night ? 1 : 0);
    if (t.night && this.stylized && !this.headlight) {
      // a front light on the bike, so the road ahead reads in the dark
      this.headlight = new THREE.SpotLight('#fff1d6', 650, 85, .58, 1, 1.5);
      this.scene.add(this.headlight, this.headlight.target);
    }
    if (this.headlight) this.headlight.visible = !!t.night;
    for (const tu of [this.terrain?.uniforms, this.farTerrain?.uniforms]) {
      if (tu?.uSunDir) { tu.uSunDir.value.copy(dir); tu.uSkyTop.value.set(t.top); tu.uSkyHorizon.value.set(t.horizon); }
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
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
    this.perf?.begin(now);
    const dt = Math.min(1.0, (now - this._last) / 1000); // real time (movement must not lag on slow frames)
    this._last = now;

    // Follow the ride position smoothly: advance at the current speed, ease toward the real value.
    const src = this.source ? this.source() : { pos: 0, speed: 0, cadence: 0, riding: false };
    const total = this.route.total;
    this.s += src.speed * dt;
    let err = src.pos - wrapDist(this.route, this.s);
    if (this.route.closed) { if (err > total / 2) err -= total; if (err < -total / 2) err += total; }
    if (Math.abs(err) > 60) this.s = src.pos; else this.s += err * Math.min(1, dt * 1.5);
    this.s = this.route.closed ? wrapDist(this.route, this.s) : Math.max(0, Math.min(total, this.s));

    // Rider placement: right-hand side of the road
    const { pos: riderPos, fwd, flat } = this._place(this.s, RIDER_LANE);
    this.crank += (src.cadence / 60) * Math.PI * 2 * dt;
    this.rider.update(riderPos, fwd, this.crank, src.speed, Math.min(dt, 0.1));
    this._updatePacer(dt);

    this._updateCamera(riderPos, flat, fwd, dt);
    this.terrain.uniforms.uTime.value = now / 1000;
    this.weather?.tick(dt);
    this.terrain.update(this.camera.position.x, this.camera.position.z);
    if (this.terrain.tick) {
      const turn = this.route.turnS || total, back = this.route.turnS && this.s > turn;
      this.terrain.tick(this.camera.position, dt, { x: riderPos.x, z: riderPos.z, out: back ? total - this.s : this.s, dir: back ? -1 : 1, speed: src.speed });
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
        this.terrain.setFar(on);
        // see further once the real horizon is there
        this.scene.fog.far = on ? this.atmosphere.fogFarRealM : this.atmosphere.fogFarM;
        if (this._fogBase) this._fogBase.far = this.scene.fog.far;
        this.log('3d', on ? 'Far terrain ready: real horizon beyond 1.5 km' : 'Far terrain off', 'debug');
      }
    }

    this.sky.position.copy(this.camera.position);
    if (this.stylized) {
      const target = this.cameraMode === 'vista' ? this.camTarget.clone() : riderPos.clone().addScaledVector(flat, 40);
      this.sun.position.copy(target).addScaledVector(this.sunDir, 350);
      this.sun.target.position.copy(target);
      const span = this.cameraMode === 'vista' ? 170 : 105;
      Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
      this.sun.shadow.camera.updateProjectionMatrix();
    } else {
      this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, 5000);
      this.sun.target.position.copy(this.camera.position);
    }
    this._render();
  }

  _updateCamera(riderPos, flat, fwd, dt) {
    const up = new THREE.Vector3(0, 1, 0);
    let pos, look;
    if (this.cameraMode === 'vista' && this.stylized) {
      const b = this.terrain.landscape.landmarks.reduce((best, l) => (!Number.isFinite(l.s) ? best : !best || Math.abs(this.s - l.s) < Math.abs(this.s - best.s) ? l : best), null);
      const nearby = b && Math.abs(this.s - b.s) < (b.range || 900);
      if (nearby && b.view) {
        // an authored postcard (Grandview Overlook toward the Point, the skyline from the Smithfield Street Bridge)
        pos = b.view.pos.clone(); look = b.view.look.clone(); this._postcard = true;
      } else {
        this._postcard = false;
        const direction = nearby ? new THREE.Vector3(b.fx, 0, b.fz) : flat;
        const right = new THREE.Vector3(-direction.z, 0, direction.x);
        const target = nearby ? new THREE.Vector3(b.x, b.y, b.z) : riderPos;
        pos = target.clone().addScaledVector(right, -245).addScaledVector(direction, -65).addScaledVector(up, 105);
        look = target.clone().addScaledVector(up, -16);
      }
    } else if (this.cameraMode === 'eye') {
      pos = riderPos.clone().addScaledVector(up, 1.55).addScaledVector(flat, 0.35);
      const far = this.pointAt(this.s + 35);
      look = far.addScaledVector(new THREE.Vector3(-flat.z, 0, flat.x), ROAD_WIDTH * 0.22).addScaledVector(up, 1.3);
    } else if (this.cameraMode === 'side') {
      const right = new THREE.Vector3(-flat.z, 0, flat.x);
      pos = riderPos.clone().addScaledVector(right, -3.4).addScaledVector(flat, 0.6).addScaledVector(up, 1.15);
      look = riderPos.clone().addScaledVector(up, 0.35).addScaledVector(flat, 0.15);
    } else if (this.cameraMode === 'drone') {
      pos = riderPos.clone().addScaledVector(flat, -45).addScaledVector(up, 26);
      look = riderPos.clone().addScaledVector(flat, 25);
    } else {
      // Aim a little low so the rider sits above the HUD strip at the bottom of the screen.
      pos = riderPos.clone().addScaledVector(flat, -6.5).addScaledVector(up, 2.7);
      look = riderPos.clone().addScaledVector(fwd, 8).addScaledVector(up, -0.2);
    }
    // Keep the camera above ground
    const g = this.terrain.heightAt(pos.x, pos.z);
    const clearance = this.cameraMode === 'vista' ? (this._postcard ? 1.6 : 25) : 1.6;
    if (g != null && pos.y < g + clearance) pos.y = g + clearance;

    if (!this._camInit) {
      this.camera.position.copy(pos);
      this.camTarget.copy(look);
      this._camInit = true;
    } else {
      const k = this.cameraMode === 'eye' || this.cameraMode === 'side' ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 3.5);
      this.camera.position.lerp(pos, k);
      this.camTarget.lerp(look, 1 - Math.exp(-dt * 5));
    }
    this.camera.lookAt(this.camTarget);
  }

  _render() {
    if (this.post && this.qualityKey !== 'low') {
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
      weather: this.weather ? this.weatherKey : null, camera: this.cameraMode,
    }), place);
    return this.perf.toggle(on);
  }

  /** Render one frame without the animation loop (used for previews/tests). */
  renderOnce() { const r = this.running; this.running = true; this._frame(performance.now()); this.running = r; cancelAnimationFrame(this._raf); }

  get loading() { return this.terrain.loadingCount; }

  dispose() {
    this.perf?.dispose();
    this.disposed = true;
    this.stop();
    this._ro.disconnect();
    this.weather?.dispose();
    this.post?.dispose();
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
function makeRoad(route, index) {
  const stylized = route.scene?.style === 'stylized';
  const n = roadPoints(route);
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = index.xs[b] - index.xs[a], dz = index.zs[b] - index.zs[a];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const rx = -dz, rz = dx; // right
    const y = route.ele[i] + 0.12;
    const hw = ROAD_WIDTH / 2;
    pos.set([index.xs[i] - rx * hw, y, index.zs[i] - rz * hw, index.xs[i] + rx * hw, y, index.zs[i] + rz * hw], i * 6);
    const v = route.dist[i] / 24;
    uv.set([0, v, 1, v], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3; // a,c = left edge; b,d = right edge
    idx.push(a, b, c, b, d, c);
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
    ctx.fillStyle = '#e8e4d0'; ctx.fillRect(8, 0, 3, c.height); ctx.fillRect(245, 0, 3, c.height);
    ctx.fillStyle = '#e4c36a'; ctx.fillRect(124, 0, 2, c.height); ctx.fillRect(130, 0, 2, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const roadOptions = { map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const mat = stylized ? new THREE.MeshStandardMaterial({ ...roadOptions, roughness: .94, metalness: .015 }) : new THREE.MeshLambertMaterial(roadOptions);
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
  const roadIdx = [], trailIdx = [];
  for (let i = 0; i < n - 1; i++) (trail(i) ? trailIdx : roadIdx).push(...idx.slice(i * 6, i * 6 + 6));
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
  const tmesh = new THREE.Mesh(tgeo, new THREE.MeshStandardMaterial({ map: ttex, roughness: .95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  tmesh.frustumCulled = false; tmesh.renderOrder = 2; tmesh.receiveShadow = true;
  const group = new THREE.Group(); group.add(mesh, tmesh);
  return group;
}

// ---------- Shoulders ----------
function makeRibbon(route, index, width, lift, tex, repeatM, offset) {
  const n = roadPoints(route);
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = index.xs[b] - index.xs[a], dz = index.zs[b] - index.zs[a];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const rx = -dz, rz = dx, hw = width / 2, y = route.ele[i] + lift;
    pos.set([index.xs[i] - rx * hw, y, index.zs[i] - rz * hw, index.xs[i] + rx * hw, y, index.zs[i] + rz * hw], i * 6);
    const v = route.dist[i] / repeatM;
    uv.set([0, v, 1, v], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, ...offset });
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
