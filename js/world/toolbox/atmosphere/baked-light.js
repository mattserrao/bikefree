// Baked lighting: a fixed sun with baked sun shadows and ambient occlusion for the static scenery.
//
// A scene opts in with  "lighting": { "baked": "golden" }  (see BAKE_DEFAULTS for the other keys). Then:
//   - the sun stays at the baked time of day (golden hour); night still works (lights, baked AO, no sun
//     shadows); other times of day fall back to the baked one
//   - the GPU bakes a top-down "shadow height" map of the whole area around the route: for every column
//     (x, z), the height below which the sun is hidden by something up-sun of it (terrain, buildings,
//     bridges, trees). Any point at any height can look itself up, so walls, roofs, the rider and the
//     traffic all get the right baked shadow, and long golden-hour shadows reach as far as they really do
//     (the live shadow map only covered ~100 m around the rider)
//   - from the same height field: ambient occlusion (darker street canyons, wall feet, under decks and
//     crowns), applied to the sky light
//   - the per-frame sun shadow map keeps only the things that move (rider, traffic, people, boats) in a
//     small box round the rider; static meshes stop casting into it
// Every lit material (standard, lambert, phong) in the scene is patched once (onBeforeCompile chained,
// like look.js): the sun's light is scaled by the baked visibility before the lighting model runs (so a
// toon/band look reads it like the shadow map) and the sky light by the AO.
//
// When the bake runs (frame cost, w2-bake):
//   - the FIRST bake happens behind the loader, before the ride starts (World.start → prepare()): the city's
//     chunks are built, the bake's shader programs (and the scene's) are compiled ahead with compileAsync,
//     then the bake runs in ~prepSliceMs slices. The GPU is synced after each step there, which measures
//     what this GPU does per texel and per triangle (the calibration for the re-bakes).
//   - RE-BAKES while riding (the static set changed: a streamed chunk) are time-sliced: at most one GPU
//     step a frame, each sized from the calibration to cost about `stepMs` (full-screen passes in bands of
//     rows, occluders in batches by triangles); the old bake stays in use until the new one is complete.
//   - Tools that draw one frame call bakeNow() (the whole bake at once).
//   - [F32] A city of areas (PLAN 5.4) bakes the area drawn; an area the path reaches soon (built, hidden) is baked
//     ahead in the same time slices once the drawn one is done ("ahead" bakes), and its maps are kept for it, so
//     the swap shows its own light at once (useArea). Each area keeps its bake while it stays built (releaseArea).
//   - Cost per frame: `costLine()` (the I overlay), `history` (one entry per bake), a summary log line per
//     bake, and a console line per frame with bake work when the page has ?bakelog=1 (or localStorage
//     'bikefree.bakelog' = '1').
//
// Scenery that builds itself in later (streamed static detail) is picked up automatically: the bake
// re-runs, in the background, when the set of static meshes changes and has settled. Streamed LOD detail
// that comes and goes with the camera should set `userData.bake = false` (it then neither casts nor
// triggers re-bakes; it still receives the baked shadow and AO). `userData.bake = true` forces a mesh in
// (e.g. thin props that would otherwise be skipped). Moving things: InstancedMesh with DynamicDrawUsage,
// or `userData.dynamic = true`, keep casting into the small live shadow map.
import * as THREE from '../../../../vendor/three.module.min.js';
import { CANOPY, CANOPY_GLSL } from './canopy-shade.js';

export const BAKE_DEFAULTS = {
  cellM: 2.5,           // texel size of the baked maps (m)
  marginM: 500,         // baked area: the route's bounding box plus this
  reachM: 2500,         // how far up-sun occluders are gathered (m); towers 300 m tall at 7° reach ~2.4 km
  groundCellM: 16,      // terrain height samples (the meshes add the detail)
  groundDropM: 1.5,     // the sampled terrain is lowered by this: coarse ground never shadows the real one
  soft: .55,            // shadow edge softness (m of height)
  bias: .35,            // shadow bias (m)
  normalOffset: 1.4,    // surfaces look themselves up this many texels in front of them (no self-shadowing)
  ao: .62,              // ambient occlusion strength
  aoFadeM: 9,           // AO fades out over this height above the surface below
  cover: .45,           // extra sky-light loss under a deck or a crown
  dynamicSpanM: 42,     // half-size of the live shadow box for moving things
  maxTexels: 9e6,       // cap on the working grid (cellM grows to fit)
  stepMs: 2,            // re-bakes while riding: GPU work per frame (ms, from the calibration behind the loader)
  prepSliceMs: 40,      // behind the loader: work per frame
  prepTimeoutS: 120,    // behind the loader at most this long; then the ride starts and the bake goes on in slices
  windowM: 0,           // long routes (Alpe d'Huez, 127 km): bake only this square round the rider, re-bake as it moves
  windowMoveM: 0,       //   re-bake once the rider is this far from the baked centre (default: a quarter of the window)
};

const OCC_LAYER = 30;
const SETTLE_SWEEPS = 2; // the static set must be unchanged this many sweeps before a (re)bake
const SWEEP_EVERY = 20;  // frames between material/caster sweeps
const RIDE_CPU_MS = 3;   // re-bakes: CPU-only steps (terrain samples) per frame
// Before any calibration (bakeNow, or a GPU that never prepared): rates of a slow software GPU, so steps stay small.
const RATE0 = { taps: 4e5, tris: 4e4 };   // per ms
const MIN_UNITS = { taps: 1 << 16, tris: 2000 };

const quadVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;

/** GLSL for lit materials: uniforms + bfBakedLight() giving (sun visibility, sky-light AO). */
const BAKE_PARS = CANOPY_GLSL + /* glsl */`
  uniform sampler2D bfBakeSun;   // R: shadow height from up-sun occluders, G: top of whatever is in this column
  uniform sampler2D bfBakeAO;    // R: ambient occlusion of the top surface
  uniform vec4 bfBakeBox;        // x0, z1, 1/width, 1/depth (m)
  uniform vec4 bfBakeK;          // base height, softness, bias, normal offset (m)
  uniform vec4 bfBakeOn;         // sun-shadow amount, AO amount, AO fade height (m), cover darkening
  vec2 bfBakedLight(vec3 w, vec3 n) {
    vec3 p = w + vec3(n.x, 0., n.z) * bfBakeK.w;
    vec2 uv = vec2((p.x - bfBakeBox.x) * bfBakeBox.z, (bfBakeBox.y - p.z) * bfBakeBox.w);
    if (bfBakeOn.x + bfBakeOn.y < .001 || uv.x <= 0. || uv.y <= 0. || uv.x >= 1. || uv.y >= 1.) return vec2(1.);
    vec2 s = texture2D(bfBakeSun, uv).rg;
    float y = w.y - bfBakeK.x;
    float lit = smoothstep(s.x - bfBakeK.y, s.x + bfBakeK.y, y + bfBakeK.z);
    float cover = smoothstep(1.5, 4., s.y - y);            // under a deck or a crown
    lit *= 1. - cover * .9;
    float ao = mix(texture2D(bfBakeAO, uv).r, 1., smoothstep(0., bfBakeOn.z, y - s.y));
    ao *= 1. - cover * bfBakeOn.w;
    // [zwift-look] under the crowns near the camera the canopy map decides the sun (dappled, sun flecks through the
    // leaves: canopy-shade.js); the bake's crown blobs give way to it there
    vec2 cn = bfCanopy(w);
    lit = mix(lit, cn.x, smoothstep(.03, .25, cn.y));
    return vec2(mix(1., lit, bfBakeOn.x), mix(1., ao, bfBakeOn.y));
  }`;

// ---------------------------------------------------------------- the bake's GPU programs
const OCC_VERTEX = /* glsl */`
  #include <common>
  #include <batching_pars_vertex>
  uniform float uBase; varying float vY;
  void main() {
    #include <batching_vertex>
    #include <begin_vertex>
    #include <project_vertex>
    vec4 bfP = vec4(transformed, 1.);
    #ifdef USE_BATCHING
      bfP = batchingMatrix * bfP;
    #endif
    #ifdef USE_INSTANCING
      bfP = instanceMatrix * bfP;
    #endif
    vY = (modelMatrix * bfP).y - uBase;
  }`;
const OCC_FRAGMENT = /* glsl */`varying float vY; void main() { gl_FragColor = vec4(vY, 1., 0., 1.); }`;
// combine: the column top O = max(mesh top, terrain); kept for the AO and the cover height
const COMBINE = /* glsl */`
  uniform sampler2D tOcc, tGround; uniform vec2 uGrid; varying vec2 vUv;
  void main() {
    vec2 o = texture2D(tOcc, vUv).rg;
    float g = texture2D(tGround, (vUv * (uGrid - 1.) + .5) / uGrid).r;   // grid nodes on the texel centres
    gl_FragColor = vec4(o.g > .5 ? max(o.r, g) : g, 0., 0., 1.);
  }`;
// opening (erode, then dilate, 2×2): drops anything under a texel wide (cables, rails, sign arms)
// that would otherwise come out as random dots of tall columns, and keeps the rest in place
const morph = (op, sign) => /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
  void main() {
    vec2 o = uTexel * ${sign};
    float a = texture2D(tSrc, vUv).r, b = texture2D(tSrc, vUv + vec2(o.x, 0.)).r, c = texture2D(tSrc, vUv + vec2(0., o.y)).r, d = texture2D(tSrc, vUv + o).r;
    gl_FragColor = vec4(${op}(${op}(a, b), ${op}(c, d)), 0., 0., 1.);
  }`;
const ERODE = morph('min', '1.'), DILATE = morph('max', '-1.');
// the sweep toward the sun: M(p) = max(M(p), M(p + step) - drop)
const SWEEP = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uStep; uniform float uDrop; varying vec2 vUv;
  void main() {
    float a = texture2D(tSrc, vUv).r;
    vec2 q = vUv + uStep;
    float b = (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) ? -1e4 : texture2D(tSrc, q).r - uDrop;
    gl_FragColor = vec4(max(a, b), 0., 0., 1.);
  }`;
// the baked sun map on the view grid: R = shadow height from strictly up-sun (one texel on), G = column top
const SUN = /* glsl */`
  uniform sampler2D tSweep, tTop; uniform vec4 uView; uniform vec2 uStep; uniform float uDrop; varying vec2 vUv;
  void main() {
    vec2 p = uView.xy + vUv * uView.zw;   // the view grid inside the work grid (both: v = 0 on the max-z edge)
    gl_FragColor = vec4(texture2D(tSweep, p + uStep).r - uDrop, texture2D(tTop, p).r, 0., 1.);
  }`;
// ambient occlusion from the column tops: how much of the sky the surface's horizon hides
const AO = /* glsl */`
  uniform sampler2D tTop; uniform vec4 uView; uniform vec2 uTexel; uniform float uCell, uStrength; varying vec2 vUv;
  void main() {
    vec2 p = uView.xy + vUv * uView.zw;
    float h0 = texture2D(tTop, p).r, occ = 0.;
    for (int a = 0; a < 8; a++) {
      float ang = float(a) * .7853982 + .39;
      vec2 dir = vec2(cos(ang), sin(ang));
      float m = 0.;
      for (int s = 0; s < 4; s++) {
        float r = (s == 0 ? 2. : s == 1 ? 5. : s == 2 ? 10. : 18.);
        float h = texture2D(tTop, p + dir * uTexel * (r / uCell)).r - h0;
        m = max(m, h / sqrt(h * h + r * r));
      }
      occ += m;
    }
    gl_FragColor = vec4(1. - uStrength * occ / 8., 0., 0., 1.);
  }`;
// texture reads per texel (the cost unit of a full-screen pass)
const TAPS = new Map([[COMBINE, 2], [ERODE, 4], [DILATE, 4], [SWEEP, 2], [SUN, 2], [AO, 33]]);

/**
 * Wait until the GPU has done everything issued so far, and return how long that took (ms). (gl.finish()
 * doesn't wait in Chrome: it only flushes.) A 1-pixel read from a tiny target of our own does: the
 * read can't return before the work queued ahead of it. Only the read binding is touched, and restored.
 */
export function gpuSync(renderer) {
  const gl = renderer.getContext(), t = performance.now();
  let s = gpuSync.cache.get(gl);
  if (!s) {
    const tex = gl.createTexture(), fb = gl.createFramebuffer(), prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
    gpuSync.cache.set(gl, s = { fb, px: new Uint8Array(4) });
  }
  const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.fb);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, s.px);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
  return performance.now() - t;
}
gpuSync.cache = new WeakMap();

const meshTris = (o) => {
  const g = o.geometry, n = g.index ? g.index.count : (g.attributes.position?.count || 0);
  return Math.ceil(n / 3) * (o.isInstancedMesh ? o.count : 1) + 64;   // + a little per draw
};

export class BakedLighting {
  /** A BakedLighting for the world, or null when the scene doesn't ask for it or the GPU can't bake. */
  static create(world, config, presets = {}) {
    if (!config?.baked) return null;
    const gl = world.renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext) || !world.renderer.extensions.has('EXT_color_buffer_float')) {
      world.log('3d', 'Baked lighting needs float render targets: using live shadows', 'debug');
      return null;
    }
    return new BakedLighting(world, config, presets);
  }

  constructor(world, config, presets = {}) {
    this.world = world;
    this.time = typeof config.baked === 'string' ? config.baked : 'golden';
    this.opts = { ...BAKE_DEFAULTS, ...config };
    // the baked sun: the time's preset (or the scene's own "sun": {elev, az}); azimuth from north, clockwise
    const sun = { ...(presets[this.time] || { elev: 7, az: 258 }), ...(config.sun || {}) };
    const el = THREE.MathUtils.degToRad(sun.elev), az = THREE.MathUtils.degToRad(sun.az);
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const empty = new THREE.DataTexture(new Uint8Array(4), 1, 1); empty.needsUpdate = true;
    this.uniforms = {
      bfBakeSun: { value: empty }, bfBakeAO: { value: empty },
      bfBakeBox: { value: new THREE.Vector4(0, 0, 0, 0) },
      bfBakeK: { value: new THREE.Vector4(0, this.opts.soft, this.opts.bias, 0) },
      bfBakeOn: { value: new THREE.Vector4(0, 0, this.opts.aoFadeM, this.opts.cover) },
    };
    this._empty = empty;
    this.patched = new WeakSet();
    this.target = { sun: 0, ao: 0 };   // what bfBakeOn eases to once a bake is ready
    this.ready = false;                // a bake is in use
    this.preparing = false;            // the first bake is running behind the loader (World.start → prepare)
    this.progress = 0;                 // 0..1 of the bake (or the preparation) under way
    this.bakes = 0;
    this.stats = null;                 // last bake: { ms, cpuMs, texels, cell, passes, occluders, … }
    this.history = [];                 // one entry per bake: { n, mode, ms, frames, steps, worstCpuMs, worstEstMs, … }
    this.rate = null;                  // calibrated GPU rates: { taps, tris } per ms (from the bake behind the loader)
    this.frame = { cpuMs: 0, estMs: 0, kind: '', units: 0 };   // this frame's bake work
    this._frame = 0;
    this._sig = ''; this._settled = 0; this._bakedSig = null;
    this._job = null;
    // [F32] per area (PLAN 5.4): { sig, settled, bakedSig, ground, res (its maps: { sun, ao, box, K, sig }), occluders };
    // the drawn area's sig / settled / bakedSig live in the fields above while it is drawn
    this._active = world.area?.id ?? null;
    this._states = new Map();
    this._shown = null;     // the maps in the uniforms now (the drawn area's, or until its first bake the one drawn before's)
    this.swaps = [];        // one entry per area swap: { id, prebaked, at } (tools/ride_area_load.mjs)
    this.dynamicSpan = this.opts.dynamicSpanM;
    try { this.logFrames = /[?&]bakelog=1\b/.test(location.search) || localStorage.getItem('bikefree.bakelog') === '1'; } catch { this.logFrames = false; }
  }

  /** The time of day to show for a requested one: the baked time, or night. */
  timeFor(key) { return key === 'night' ? 'night' : this.time; }

  /** Called with the light the world just applied (after time of day and weather). */
  setLight(t) {
    this.night = !!t.night;
    this.target.sun = this.night ? 0 : 1;
    this.target.ao = 1;
    // the live map only carries moving things: by day, inside a small box
    const sm = this.world.renderer.shadowMap, q = this.world.terrain?.quality;
    if (this.night) sm.enabled = false;
    else if (q) sm.enabled = !!q.shadows;
  }

  // ------------------------------------------------------------------ materials and casters
  /** Patch a lit material so it reads the bake (idempotent; chains any existing onBeforeCompile). */
  patchMaterial(m) {
    if (!m || this.patched.has(m)) return;
    this.patched.add(m);
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) || m.userData.noBake) return;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey(), u = this.uniforms;
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      Object.assign(shader.uniforms, u, CANOPY);
      const decl = `
          mat3 bfVT = transpose(mat3(viewMatrix));
          vec2 bfBaked = bfBakedLight(bfVT * (-vViewPosition - viewMatrix[3].xyz), normalize(bfVT * normal));`;
      const sunLine = 'getDirectionalLightInfo( directionalLight, directLight );', scaled = `${sunLine}\n\t\tdirectLight.color *= bfBaked.x;`;
      let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${BAKE_PARS}`);
      if (fs.includes('#include <lights_fragment_begin>')) fs = fs.replace('#include <lights_fragment_begin>', `${decl}\n          ${THREE.ShaderChunk.lights_fragment_begin.replace(sunLine, scaled)}`);
      else {
        // [toolbox] another patch already inlined the light chunk (the vista kit's ground: shadows fade on steep
        // faces): declare the bake where the chunk starts and scale the sun where it's read
        const start = 'vec3 geometryPosition = - vViewPosition;';
        fs = fs.replace(start, `${decl}\n${start}`).replace(sunLine, scaled);
      }
      shader.fragmentShader = fs.replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= bfBaked.y; reflectedLight.indirectSpecular *= bfBaked.y;
          #include <aomap_fragment>`);
    };
    m.customProgramCacheKey = () => `${prevKey}|bf-baked-2`;
    m.needsUpdate = true;
  }

  _isDynamic(o) {
    return !!(o.userData.dynamic || (o.isInstancedMesh && o.instanceMatrix.usage === THREE.DynamicDrawUsage) || o.isSkinnedMesh);
  }

  /** Static scenery that goes into the bake (decided once per mesh, from how it was built). */
  _isOccluder(o) {
    if (!o.isMesh || o.userData.bake === false || o.userData.pooled || this._isDynamic(o)) return false;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!(m?.isMeshStandardMaterial || m?.isMeshLambertMaterial || m?.isMeshPhongMaterial) || m.transparent || m.alphaTest > 0) return false;
    if (o.userData.bake === true) return true;
    // thin things (posts, poles, lamp arms) would rasterize as random pillars: they're left out
    // (surfaces that don't cast, like streets and decks, are in: they are the tops that others stand under)
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    return Math.min(s.x, s.z) > .9 || s.y < 1.2;
  }

  /**
   * Patch new materials, take static meshes out of the live shadow map, and watch the static set for
   * changes (a signature of the occluder meshes and their geometry). Cheap: runs every SWEEP_EVERY frames.
   */
  sweep() {
    const w = this.world, roots = [w.terrain.group, w.road, w.shoulder].filter(Boolean);
    const occ = [];
    w.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of [].concat(o.material)) this.patchMaterial(m);
    });
    for (const root of roots) root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.bakeCast === undefined) o.userData.bakeCast = o.castShadow;
      if (o.userData.bakeOcc === undefined) o.userData.bakeOcc = this._isOccluder(o);
      if (o.userData.bakeOcc && o.visible) occ.push(o);
      // only moving things (and streamed plants, which the bake leaves out) keep casting live
      if (this.ready && o.castShadow && !this._isDynamic(o) && !o.userData.pooled) o.castShadow = false;
    });
    let sig = occ.length;
    for (const o of occ) sig = (sig * 31 + o.id * 7 + (o.geometry.id || 0) + (o.count ?? 0)) % 2147483647;
    this.occluders = occ;
    if (String(sig) === this._sig) this._settled++; else { this._sig = String(sig); this._settled = 0; }
  }

  _busy(t = this.world.terrain) {
    return !t?.kit || !!t.city?._pending?.length || (t.stats?.loading ?? 0) > 0;
  }

  // ------------------------------------------------------------------ when the bake runs
  /** Start the first bake behind the loader (World.start). The world skips drawing while `preparing`. */
  prepare() {
    if (this.ready || this.preparing || this._disposed) return;
    this._job?.return(); this._job = null;
    this.preparing = true; this.progress = 0;
    this._prep = this._prepare();
    this._prepT0 = performance.now();
  }

  /** Per frame: the preparation behind the loader, or sweeps and a time-sliced re-bake while riding. */
  tick(dt) {
    this._frame++;
    const f = this.frame; f.cpuMs = 0; f.estMs = 0; f.units = 0; f.kind = '';
    const t0 = performance.now();
    if (this.preparing) this._prepTick();
    else {
      if (!this._job && this._frame % SWEEP_EVERY === 1) {
        this.sweep();
        // a window bake follows the rider: once it has moved far enough, the window is stale
        if (this.opts.windowM && this._bakedCentre) {
          const c = this.world.camera.position, move = this.opts.windowMoveM || this.opts.windowM / 4;
          if (Math.hypot(c.x - this._bakedCentre.x, c.z - this._bakedCentre.z) > move) this._bakedSig = null;
        }
        if (!this._busy() && this._settled >= SETTLE_SWEEPS && this._sig !== this._bakedSig) this._startJob('ride');
        else this._bakeAhead();   // [F32] the drawn area is baked: an area the path reaches soon is baked ahead
      }
      if (this._job) this._rideStep();
    }
    f.cpuMs = performance.now() - t0;
    if (f.kind && this.logFrames) console.debug(`bake frame ${this._frame}: ${f.kind} ${Math.round(f.units).toLocaleString()} → cpu ${f.cpuMs.toFixed(2)} ms, gpu ~${f.estMs.toFixed(2)} ms (${Math.round(this.progress * 100)}%)`);
    // ease the bake in (and the sun shadow out at night)
    const on = this.uniforms.bfBakeOn.value, a = Math.min(1, dt * 2.5);
    const sun = this.ready ? this.target.sun : 0, ao = this.ready ? this.target.ao : 0;
    on.x += (sun - on.x) * a; on.y += (ao - on.y) * a;
    if (Math.abs(on.x - sun) < .002) on.x = sun;
    if (Math.abs(on.y - ao) < .002) on.y = ao;
  }

  _startJob(mode, view = null) {
    this._job = this._bake(view);
    this._jobInfo = { mode, area: view ? view.id : this._active, t0: performance.now(), frames: 0, steps: 0, worstCpuMs: 0, worstEstMs: 0, worstSyncMs: 0 };
  }

  // ------------------------------------------------------------------ [F32] areas
  _state(id) { let st = this._states.get(id); if (!st) this._states.set(id, st = { sig: '', settled: 0, bakedSig: null, ground: null, res: null, occluders: [] }); return st; }
  /** The drawn area as a bake view. */
  _view() { const w = this.world; return { id: this._active, terrain: w.terrain, road: w.road, shoulder: w.shoulder, index: w.index, route: w.route }; }
  /** A hidden area's static set (as sweep() does for the drawn one): its occluders and their signature. */
  _scan(view, st) {
    const occ = [];
    for (const root of [view.terrain?.group, view.road, view.shoulder]) root?.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.bakeCast === undefined) o.userData.bakeCast = o.castShadow;
      if (o.userData.bakeOcc === undefined) o.userData.bakeOcc = this._isOccluder(o);
      if (o.userData.bakeOcc && o.visible) occ.push(o);
    });
    let sig = occ.length;
    for (const o of occ) sig = (sig * 31 + o.id * 7 + (o.geometry.id || 0) + (o.count ?? 0)) % 2147483647;
    st.occluders = occ;
    if (String(sig) === st.sig) st.settled++; else { st.sig = String(sig); st.settled = 0; }
  }
  /**
   * Bake an area ahead of its swap: the world's `_bakeAhead()` lists the built, hidden areas the path reaches soon
   * ([{id, terrain, road, shoulder, index, route, soon}], soonest first). One is baked once its static set has
   * settled — and its city has streamed in, unless the swap is near (`soon`: then what is built is baked, and the
   * rest re-bakes after the swap with this bake in use). Bakes of areas no longer listed are let go.
   */
  _bakeAhead() {
    const list = this.world._bakeAhead?.() || [];
    const keep = new Set([this._active, ...list.map((v) => v.id)]);
    for (const [id, st] of this._states) if (!keep.has(id) && st.res && st.res !== this._shown) { this._free(st.res); st.res = null; st.bakedSig = null; }
    for (const v of list) {
      const st = this._state(v.id);
      this._scan(v, st);
      if (st.settled >= SETTLE_SWEEPS && st.sig !== st.bakedSig && (v.soon || !this._busy(v.terrain))) { this._startJob('ahead', v); return; }
    }
  }
  /** The world draws area `id` now (instead of `from`): its own bake goes in if it has one (else the old one stays until it has). */
  useArea(id, from = this._active) {
    if (id === this._active) return;
    if (this._job && this._jobInfo?.area === from && !this.preparing) { this._job.return(); this._job = null; this._jobInfo = null; }   // (a re-bake of the area left: dropped)
    const old = this._state(from);
    Object.assign(old, { sig: this._sig, settled: this._settled, bakedSig: this._bakedSig });
    this._active = id;
    const st = this._state(id);
    this._sig = st.sig; this._settled = st.settled; this._bakedSig = st.bakedSig;
    if (st.res) this._show(st.res);
    this.swaps.push({ id, from, prebaked: !!st.res, at: Math.round(performance.now()) });
    if (this.swaps.length > 50) this.swaps.shift();
    this.world.log('3d', `Baked lighting: drawing area ${id} with ${st.res ? 'its own bake (baked ahead)' : `area ${from}'s bake until its own is done`}`, 'debug');
  }
  /** Area `id` was released: its bake goes (once it is no longer the one shown). */
  releaseArea(id) {
    const st = this._states.get(id);
    if (!st || id === this._active) return;
    if (this._job && this._jobInfo?.area === id) { this._job.return(); this._job = null; this._jobInfo = null; }
    if (st.res) { if (st.res === this._shown) this._orphan = st.res; else this._free(st.res); }
    this._states.delete(id);
  }
  /** Put a bake's maps in the uniforms. */
  _show(res) {
    this.uniforms.bfBakeSun.value = res.sun.texture;
    this.uniforms.bfBakeAO.value = res.ao.texture;
    this.uniforms.bfBakeBox.value.fromArray(res.box);
    this.uniforms.bfBakeK.value.fromArray(res.K);
    this._shown = res;
    this._bakedCentre = res.centre;
    this.ready = true;
    if (this._orphan && this._orphan !== res) { this._free(this._orphan); this._orphan = null; }
  }
  _free(res) { if (res === this._shown) return; res.sun.dispose(); res.ao.dispose(); }

  /** The budget of one GPU step, in units of its kind. */
  _units(kind, ms) {
    const rate = this.rate?.[kind] ?? RATE0[kind];
    return Math.max(MIN_UNITS[kind], rate * ms);
  }

  /** While riding: CPU slices up to RIDE_CPU_MS, and at most one GPU step, sized to cost ~stepMs. */
  _rideStep() {
    const J = this._jobInfo, f = this.frame, end = performance.now() + RIDE_CPU_MS;
    this._budget = (kind) => this._units(kind, this.opts.stepMs);
    J.frames++;
    for (;;) {
      const t = performance.now(), r = this._job.next();
      const ms = performance.now() - t;
      J.steps++; J.worstCpuMs = Math.max(J.worstCpuMs, ms);
      if (r.done) { this._finishJob(); break; }
      if (r.value?.kind) {
        const est = r.value.units / (this.rate?.[r.value.kind] ?? RATE0[r.value.kind]);
        f.kind = r.value.kind; f.units += r.value.units; f.estMs += est;
        J.worstEstMs = Math.max(J.worstEstMs, f.estMs);
        break;   // one GPU step a frame
      }
      if (performance.now() > end) break;
    }
  }

  /** Behind the loader: steps until prepSliceMs, the GPU synced after each one (and timed: the calibration). */
  _prepTick() {
    const O = this.opts, R = this.world.renderer, end = performance.now() + O.prepSliceMs, f = this.frame;
    this._budget = (kind) => this._units(kind, O.prepSliceMs / 2);
    const cal = this._cal ||= { taps: [0, 0, 0], tris: [0, 0, 0] };   // units, ms, steps
    if (performance.now() - this._prepT0 > O.prepTimeoutS * 1000) {
      // taking too long (a very slow GPU): ride on; the bake carries on in slices
      this.world.log('3d', `Baked lighting: still preparing after ${O.prepTimeoutS} s; finishing it while riding`, 'debug');
      this._endPrep();
      return;
    }
    if (this._jobInfo) this._jobInfo.frames++;
    this._synced = false;
    do {
      if (!this._synced) { gpuSync(R); this._synced = true; }   // start each slice with nothing in flight
      const t = performance.now(), r = this._prep.next();
      if (r.value?.kind) gpuSync(R);
      const ms = performance.now() - t;
      if (this._jobInfo) { this._jobInfo.steps++; this._jobInfo.worstSyncMs = Math.max(this._jobInfo.worstSyncMs, ms); }
      if (r.done) { this._endPrep(); break; }
      if (r.value?.kind) {
        const c = cal[r.value.kind];
        if (r.value.calibrate !== false) {
          c[0] += r.value.units; c[1] += ms; c[2]++;
          if (c[2] >= 3 && c[1] > 2) (this.rate ||= { ...RATE0 })[r.value.kind] = c[0] / c[1];
        }
        f.kind = r.value.kind; f.units += r.value.units; f.estMs += ms;
      }
      if (r.value?.wait) break;   // waiting on something outside (assets, compiling): next frame
    } while (performance.now() < end);
  }

  _endPrep() {
    this.preparing = false;
    this._prep = null;
    // a bake that hadn't finished goes on while riding, in slices
    const on = this.uniforms.bfBakeOn.value;
    if (this.ready) { on.x = this.target.sun; on.y = this.target.ao; }
    this.prepMs = Math.round(performance.now() - this._prepT0);
    if (this.rate) this.world.log('3d', `Baked lighting: ready after ${(this.prepMs / 1000).toFixed(1)} s behind the loader; GPU ${(this.rate.taps / 1e3).toFixed(0)} k texel reads/ms, ${(this.rate.tris / 1e3).toFixed(0)} k triangles/ms → re-bake steps of ${(this._units('taps', this.opts.stepMs) / 1e6).toFixed(2)} M reads / ${(this._units('tris', this.opts.stepMs) / 1e3).toFixed(0)} k triangles`, 'debug');
  }

  _finishJob() {
    const J = this._jobInfo;
    this._job = null;
    if (!J) return;
    const h = { n: this.bakes, mode: J.mode, ms: Math.round(performance.now() - J.t0), frames: J.frames, steps: J.steps,
      worstCpuMs: +J.worstCpuMs.toFixed(2), worstEstMs: +J.worstEstMs.toFixed(2), ...(J.worstSyncMs ? { worstSyncMs: +J.worstSyncMs.toFixed(1) } : {}), occluders: this.stats?.occluders };
    this.history.push(h); if (this.history.length > 50) this.history.shift();
    this._jobInfo = null;
    this.world.log('3d', `Baked lighting: ${J.mode === 'prep' ? 'first bake behind the loader' : `re-bake #${h.n}`}, ${h.steps} steps over ${h.frames} frames (${(h.ms / 1000).toFixed(1)} s), worst step ${h.worstCpuMs} ms CPU${J.mode === 'prep' ? `, ${h.worstSyncMs} ms with the GPU` : `, ~${h.worstEstMs} ms GPU`}`, 'debug');
  }

  /** The preparation behind the loader: the city, the programs, the first bake. */
  *_prepare() {
    const w = this.world, t = w.terrain, R = w.renderer;
    // 1. the scenery assets and the city (every chunk: the bake covers the whole route)
    while (!t.kit) { if (t.stats?.errors) return; yield { wait: true }; }
    const c = t.city;
    if (c?._pending) {
      const all = c._pending.length || 1;
      while (c._pending.length) {
        c._buildChunk(c._pending.pop());
        this.progress = .4 * (1 - c._pending.length / all);
        yield;
      }
    }
    while ((t.stats?.loading ?? 0) > 0) yield { wait: true };
    this.sweep();
    // 2. the programs: the bake's own (occluder draw, full-screen passes) and the scene's (with the bake patch),
    //    compiled in parallel where the GPU can (KHR_parallel_shader_compile), then drawn once tiny so a
    //    driver that compiles at the first draw does it here
    const pr = this._compile();
    let done = false; pr.then(() => { done = true; }, () => { done = true; });
    while (!done) yield { wait: true };
    this.progress = .5;
    this._warmUp();
    yield;
    // 3. the bake, in slices behind the loader (timed: the calibration of the re-bakes)
    this._startJob('prep');
    const job = this._job;
    for (;;) {
      const r = job.next();
      if (r.done) break;
      yield r.value;
    }
    this._finishJob();
    // 4. one frame drawn under the loader: the first frame's own uploads (textures, street kit, shadow map) go here
    w.renderer.shadowMap.needsUpdate = true;
    if (w._render) w._render(); else R.render(w.scene, w.camera);
    yield { wait: true };
  }

  _occMaterial() {
    return this._occMat ||= new THREE.ShaderMaterial({   // kept: re-bakes reuse its programs
      uniforms: { uBase: { value: 0 } }, vertexShader: OCC_VERTEX, fragmentShader: OCC_FRAGMENT, side: THREE.DoubleSide });
  }

  _fullScreen() { return this._fs ||= new FullScreen(this.world.renderer); }

  /** compileAsync for the bake's programs (as they'll be drawn: into a float target, no lights) and the scene's. */
  _compile() {
    const w = this.world, R = w.renderer, occMat = this._occMaterial(), fs = this._fullScreen();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const proxies = new THREE.Scene();
    const kinds = new Set();
    for (const o of this.occluders || []) kinds.add(`${o.isInstancedMesh ? 'i' : o.isBatchedMesh ? 'b' : 'm'}${o.instanceColor ? 'c' : ''}`);
    for (const k of kinds) {
      if (k[0] === 'b') continue;   // batched meshes: compiled at their first draw
      const o = k[0] === 'i' ? new THREE.InstancedMesh(geo, occMat, 1) : new THREE.Mesh(geo, occMat);
      if (k[1] === 'c') o.setColorAt(0, new THREE.Color());
      proxies.add(o);
    }
    for (const src of TAPS.keys()) { const m = new THREE.Mesh(fs.mesh.geometry, fs.material(src)); m.frustumCulled = false; proxies.add(m); }
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._proxy = { scene: proxies, geo, cam };
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGFormat });
    this._proxy.rt = rt;
    const prev = R.getRenderTarget();
    R.setRenderTarget(rt);
    const bake = R.compileAsync(proxies, cam);
    // the scene: as the frame draws it (into the post-processing target where there is one)
    const plain = !(w.heroPost && w.qualityKey !== 'low');
    R.setRenderTarget(w.post?._target ? w.post._target(!plain) : null);
    const scene = R.compileAsync(w.scene, w.camera).catch(() => {});
    R.setRenderTarget(prev);
    return Promise.all([bake, scene]);
  }

  /** Draw each bake program once into a tiny target (drivers that compile at the first draw do it now). */
  _warmUp() {
    const P = this._proxy; if (!P) return;
    const R = this.world.renderer, prev = R.getRenderTarget();
    R.setRenderTarget(P.rt); R.render(P.scene, P.cam); R.setRenderTarget(prev);
    P.rt.dispose(); P.geo.dispose(); this._proxy = null;
  }

  /** Build any static scenery still streaming in, then bake at once (for tools that draw one frame). */
  bakeNow() {
    const c = this.world.terrain?.city;
    if (this.preparing) { this._prep?.return(); this._prep = null; this.preparing = false; }
    this._job?.return(); this._job = null; this._jobInfo = null;
    if (c?._pending) while (c._pending.length) c._buildChunk(c._pending.pop());
    this.sweep();
    const job = this._bake();
    this._budget = () => Infinity;   // whole passes
    let worst = 0;
    for (;;) { const t = performance.now(), r = job.next(); worst = Math.max(worst, performance.now() - t); if (r.done) break; }
    if (this.stats) this.stats.worstStepMs = Math.round(worst);   // the longest step (whole passes)
    const on = this.uniforms.bfBakeOn.value; on.x = this.target.sun; on.y = this.target.ao;
    return this.stats;
  }

  /** A one-line state for the performance overlay. */
  costLine() {
    const f = this.frame, h = this.history.at(-1), r = this.rate;
    const state = this.preparing ? `preparing ${Math.round(this.progress * 100)}%` : this._job ? `re-baking ${Math.round(this.progress * 100)}%` : this.ready ? 'ready' : 'waiting';
    const last = h ? ` · last ${h.mode === 'prep' ? 'first bake' : `re-bake #${h.n}`} ${(h.ms / 1000).toFixed(1)} s/${h.frames} fr, step ≤ ${h.worstCpuMs.toFixed(1)} ms cpu${h.mode === 'prep' ? '' : ` ~${h.worstEstMs.toFixed(1)} gpu`}` : '';
    return `bake ${state}${f.kind ? ` · this frame ${f.cpuMs.toFixed(1)} cpu ~${f.estMs.toFixed(1)} gpu` : ''}${last} · ${this.bakes} bake${this.bakes === 1 ? '' : 's'}${r ? '' : ' · uncalibrated'}`;
  }

  // ------------------------------------------------------------------ the bake
  /**
   * The baking job: a generator, one GPU step (or a slice of CPU work) per next(). A GPU step yields
   * { kind: 'taps' | 'tris', units } (texel reads of a full-screen band, triangles of an occluder batch); its
   * size comes from this._budget(kind). The old maps stay in use until the new ones are complete.
   */
  *_bake(view = null) {
    const t0 = performance.now(); let cpu = 0, c0 = performance.now();
    const w = this.world, R = w.renderer, O = this.opts;
    // [F32] the area baked: the drawn one, or (`view`) a hidden one baked ahead of its swap
    const V = view || this._view(), G = this._state(V.id), sigAtStart = view ? G.sig : this._sig;
    const budget = (kind) => (this._budget ? this._budget(kind) : Infinity);
    const d = this.sunDir.clone();
    const flat = Math.hypot(d.x, d.z) || 1, ux = d.x / flat, uz = d.z / flat, k = Math.max(.02, d.y) / flat;   // rise per metre toward the sun
    // the area: the route's box plus the margin (what is seen), and the work area reaching up-sun
    const ix = V.index.xs, iz = V.index.zs;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ix.length; i++) { x0 = Math.min(x0, ix[i]); x1 = Math.max(x1, ix[i]); z0 = Math.min(z0, iz[i]); z1 = Math.max(z1, iz[i]); }
    x0 -= O.marginM; x1 += O.marginM; z0 -= O.marginM; z1 += O.marginM;
    // a long route bakes a window round the rider (the rest is unshadowed and far off, under the haze)
    let centre = null;
    if (O.windowM) {
      const c = w.camera.position, h = O.windowM / 2;
      centre = { x: c.x, z: c.z };
      x0 = Math.max(x0, c.x - h); x1 = Math.min(x1, c.x + h); z0 = Math.max(z0, c.z - h); z1 = Math.min(z1, c.z + h);
    }
    const reach = O.reachM;
    const ex0 = Math.min(x0, x0 + ux * reach), ex1 = Math.max(x1, x1 + ux * reach), ez0 = Math.min(z0, z0 + uz * reach), ez1 = Math.max(z1, z1 + uz * reach);
    let cell = O.cellM;
    while (((ex1 - ex0) / cell) * ((ez1 - ez0) / cell) > O.maxTexels) cell *= 1.1;
    const maxTex = R.capabilities.maxTextureSize;
    cell = Math.max(cell, (ex1 - ex0) / maxTex, (ez1 - ez0) / maxTex);
    const EW = Math.ceil((ex1 - ex0) / cell), EH = Math.ceil((ez1 - ez0) / cell);
    const EX1 = ex0 + EW * cell, EZ1 = ez0 + EH * cell;   // exact grid edges
    // the view grid: a sub-rectangle of the work grid, on the same texels
    const vi0 = Math.floor((x0 - ex0) / cell), vi1 = Math.ceil((x1 - ex0) / cell);
    const vj0 = Math.floor((EZ1 - z1) / cell), vj1 = Math.ceil((EZ1 - z0) / cell);   // rows count from the max-z edge (v = 0)
    const VW = vi1 - vi0, VH = vj1 - vj0, vx0 = ex0 + vi0 * cell, vz1 = EZ1 - vj0 * cell;
    const base = (V.route.minEle ?? 0) - 40;
    let passes = 0;
    const occluders = ((view ? G.occluders : this.occluders) || []).filter((o) => o.visible);
    const roots = view ? [V.terrain?.group, V.road, V.shoulder].filter(Boolean) : [];   // (a hidden area's: shown for its occluder draws only)
    // progress: GPU units of the whole bake (for the overlay)
    const sweeps = Math.ceil(Math.log2(reach * 1.05 / cell));
    const totalUnits = EW * EH * (2 + 4 + 4 + 2 * sweeps) + VW * VH * (2 + 33) + occluders.reduce((a, o) => a + meshTris(o), 0) * 4;
    let doneUnits = 0;
    const gpuStep = (kind, units, extra) => { doneUnits += kind === 'tris' ? units * 4 : units; this.progress = this.preparing ? .5 + .5 * doneUnits / totalUnits : doneUnits / totalUnits; return { kind, units, ...extra }; };

    const half = THREE.HalfFloatType;
    const rt = (W, H, format, type = half, depth = false) => {
      const r = new THREE.WebGLRenderTarget(W, H, { format, type, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      r.texture.generateMipmaps = false; return r;
    };
    const targets = [];
    const own = (r) => { targets.push(r); return r; };
    let gtex = null, swapped = false;
    try {
      // 1. terrain heights on a coarse grid (CPU, in ~4 ms slices; kept for re-bakes of the same area)
      const ph = {}; let p0 = performance.now();
      const ground = this._groundSampler(V.terrain);
      const GN = Math.max(2, Math.ceil((EX1 - ex0) / O.groundCellM) + 1), GM = Math.max(2, Math.ceil((EZ1 - ez0) / O.groundCellM) + 1);
      const gkey = [ex0, EX1, ez0, EZ1, GN, GM, base].join();
      let gdata = G.ground?.key === gkey ? G.ground.data : null;
      cpu += performance.now() - c0;
      if (!gdata) {
        gdata = new Float32Array(GN * GM);
        c0 = performance.now();
        for (let j = 0; j < GM; j++) {
          const z = EZ1 - (EZ1 - ez0) * j / (GM - 1);   // row 0 = the max-z edge, like the GPU grids (v = (z1 - z) / depth)
          for (let i = 0; i < GN; i++) gdata[j * GN + i] = ground(ex0 + (EX1 - ex0) * i / (GN - 1), z) - O.groundDropM - base;
          if (performance.now() - c0 > 2 && j < GM - 1) { cpu += performance.now() - c0; yield; c0 = performance.now(); }
        }
        cpu += performance.now() - c0;
        G.ground = { key: gkey, data: gdata };
      }
      ph.ground = performance.now() - p0;
      c0 = performance.now();
      gtex = new THREE.DataTexture(gdata, GN, GM, THREE.RedFormat, THREE.FloatType);
      gtex.minFilter = gtex.magFilter = THREE.LinearFilter; gtex.flipY = false; gtex.needsUpdate = true;
      // (the float texture is filtered linearly where OES_texture_float_linear exists; else nearest, still fine)
      if (!R.extensions.has('OES_texture_float_linear')) gtex.minFilter = gtex.magFilter = THREE.NearestFilter;
      cpu += performance.now() - c0;

      // 2. the static meshes from above: the top of whatever stands in each column
      const occRT = own(rt(EW, EH, THREE.RGFormat, half, true));
      const cam = new THREE.OrthographicCamera(-(EX1 - ex0) / 2, (EX1 - ex0) / 2, (EZ1 - ez0) / 2, -(EZ1 - ez0) / 2, 1, 6000);
      cam.position.set((ex0 + EX1) / 2, base + 3000, (ez0 + EZ1) / 2); cam.up.set(0, 0, -1); cam.lookAt((ex0 + EX1) / 2, base, (ez0 + EZ1) / 2);
      cam.updateMatrixWorld(); cam.layers.set(OCC_LAYER);
      const occMat = this._occMaterial();
      occMat.uniforms.uBase.value = base;
      // clear the target (its own step: the first touch of a big new target)
      {
        c0 = performance.now();
        const prev = { target: R.getRenderTarget(), clear: R.getClearColor(new THREE.Color()), alpha: R.getClearAlpha() };
        R.setClearColor(0x000000, 0); R.setRenderTarget(occRT); R.clear(true, true, false);
        R.setRenderTarget(prev.target); R.setClearColor(prev.clear, prev.alpha);
        cpu += performance.now() - c0;
        yield gpuStep('taps', EW * EH, { calibrate: false });
      }
      // in batches by triangles, a step apart (the first bake also uploads every static mesh to the GPU)
      ph.occluders = 0;
      for (let k0 = 0; k0 < occluders.length;) {
        c0 = performance.now();
        const limit = budget('tris'), batch = [];
        let tris = 0;
        while (k0 < occluders.length && (!batch.length || tris + meshTris(occluders[k0]) <= limit)) { tris += meshTris(occluders[k0]); batch.push(occluders[k0++]); }
        for (const o of batch) o.layers.enable(OCC_LAYER);
        const prev = { target: R.getRenderTarget(), override: w.scene.overrideMaterial, sm: R.shadowMap.enabled, autoClear: R.autoClear, fog: w.scene.fog, bg: w.scene.background };
        w.scene.overrideMaterial = occMat; w.scene.fog = null; w.scene.background = null;
        R.shadowMap.enabled = false; R.autoClear = false;   // depth kept: the highest top wins
        const vis = roots.map((o) => o.visible); for (const o of roots) o.visible = true;   // [F32]
        R.setRenderTarget(occRT); R.render(w.scene, cam);
        roots.forEach((o, k) => { o.visible = vis[k]; });
        for (const o of batch) o.layers.disable(OCC_LAYER);
        w.scene.overrideMaterial = prev.override; w.scene.fog = prev.fog; w.scene.background = prev.bg;
        R.shadowMap.enabled = prev.sm; R.autoClear = prev.autoClear; R.setRenderTarget(prev.target);
        cpu += performance.now() - c0; ph.occluders += performance.now() - c0;
        yield gpuStep('tris', tris);
      }

      // 3. full-screen passes on the work grid, in bands of rows sized to the step budget
      const fs = this._fullScreen();
      const bands = function* (target, src, uniforms, W, H) {
        const taps = TAPS.get(src);
        for (let y = 0; y < H;) {
          c0 = performance.now();
          const rows = Math.max(1, Math.min(H - y, Math.floor(budget('taps') / (W * taps))));
          fs.run(target, src, uniforms, y, rows);
          y += rows;
          cpu += performance.now() - c0;
          yield gpuStep('taps', W * rows * taps);
        }
      };
      p0 = performance.now();
      const texel = new THREE.Vector2(1 / EW, 1 / EH);
      const topRT = own(rt(EW, EH, THREE.RedFormat)), tmpRT = own(rt(EW, EH, THREE.RedFormat));
      yield* bands(topRT, COMBINE, { tOcc: occRT.texture, tGround: gtex, uGrid: new THREE.Vector2(GN, GM) }, EW, EH);
      occRT.dispose(); gtex.dispose(); gtex = null;
      yield* bands(tmpRT, ERODE, { tSrc: topRT.texture, uTexel: texel }, EW, EH);
      yield* bands(topRT, DILATE, { tSrc: tmpRT.texture, uTexel: texel }, EW, EH);
      tmpRT.dispose();
      // the sweep toward the sun, doubling the reach each pass: M(p) = max over j of O(p + j·v) - j·cell·k
      // (v = one texel toward the sun; in uv, rows grow southward, so z flips sign)
      const v = new THREE.Vector2(ux * cell / (EX1 - ex0), -uz * cell / (EZ1 - ez0));
      let src = topRT;
      const A = own(rt(EW, EH, THREE.RedFormat)), B = own(rt(EW, EH, THREE.RedFormat));
      for (let n = 1; n * cell < reach * 1.05; n *= 2) {
        const dst = src === A ? B : A;
        yield* bands(dst, SWEEP, { tSrc: src.texture, uStep: v.clone().multiplyScalar(n), uDrop: n * cell * k }, EW, EH);
        src = dst; passes++;
      }
      // 4. the baked maps on the view grid: R = shadow height from strictly up-sun (one texel on), G = column top
      const viewUv = new THREE.Vector4(vi0 / EW, vj0 / EH, VW / EW, VH / EH);
      const sunRT = own(rt(VW, VH, THREE.RGFormat));
      yield* bands(sunRT, SUN, { tSweep: src.texture, tTop: topRT.texture, uView: viewUv, uStep: v, uDrop: cell * k }, VW, VH);
      // 5. ambient occlusion from the column tops
      const aoRT = own(rt(VW, VH, THREE.RedFormat, THREE.UnsignedByteType));
      yield* bands(aoRT, AO, { tTop: topRT.texture, uView: viewUv, uTexel: texel, uCell: cell, uStrength: O.ao }, VW, VH);
      ph.passes = performance.now() - p0;

      // swap in (the area's own maps; shown now if it is the area drawn — [F32] else kept for its swap)
      c0 = performance.now();
      // every grid here has v = 0 on its max-z edge: v = (z1 - z) / depth (the bake camera looks down with north up)
      const res = { sun: sunRT, ao: aoRT, box: [vx0, vz1, 1 / (VW * cell), 1 / (VH * cell)], K: [base, O.soft, O.bias, O.normalOffset * cell], sig: sigAtStart, centre };
      const old = G.res;
      G.res = res; G.bakedSig = sigAtStart;
      swapped = true;
      if (V.id === this._active) { this._show(res); this._bakedSig = sigAtStart; }
      if (old && old !== res) { if (old === this._shown) this._orphan = old; else this._free(old); }
      this.bakes++; this.progress = 1;
      cpu += performance.now() - c0;
      this.stats = { ms: Math.round(performance.now() - t0), cpuMs: Math.round(cpu), work: [EW, EH], view: [VW, VH], cell: +cell.toFixed(2), passes, occluders: occluders.length, groundSamples: GN * GM,
        phases: Object.fromEntries(Object.entries(ph).map(([key, val]) => [key, Math.round(val)])),
        gpuMB: +((VW * VH * (4 + 1)) / 1048576).toFixed(1) };
      w.log('3d', `Baked lighting: ${VW}×${VH} at ${cell.toFixed(1)} m, ${occluders.length} meshes, ${this.stats.ms} ms (${this.stats.cpuMs} ms on the CPU)${view ? ` (area ${V.id}, ahead of its swap)` : ''}`, 'debug');
      // static meshes leave the live shadow map now that the bake has them
      if (V.id === this._active) this.sweep();
    } finally {
      // the work targets (and, for a bake abandoned half way, its own outputs)
      for (const r of targets) if (!swapped || (r !== G.res?.sun && r !== G.res?.ao)) r.dispose();
      gtex?.dispose();
    }
  }

  /** Terrain height for the bake: the scene's base ground (no street grading), else the terrain's own. */
  _groundSampler(t = this.world.terrain) {
    const L = t.landscape;
    if (this.opts.groundAt) return this.opts.groundAt;
    if (L?.baseHeight) return L.baseHeight;
    return (x, z) => t.heightAt(x, z);
  }

  dispose() {
    this._disposed = true;
    this._job?.return(); this._job = null;
    this._prep?.return(); this._prep = null; this.preparing = false;
    const all = new Set([this._shown, this._orphan, ...[...this._states.values()].map((st) => st.res)].filter(Boolean));   // [F32] every area's bake
    for (const r of all) { r.sun.dispose(); r.ao.dispose(); }
    this._occMat?.dispose();
    this._fs?.dispose();
    this._proxy?.rt.dispose(); this._proxy?.geo.dispose();
    this._empty.dispose();
  }
}

/** A full-screen triangle pass into a render target (optionally a band of rows: a scissor). */
class FullScreen {
  constructor(renderer) {
    this.renderer = renderer;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(g, null); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.materials = new Map();
  }

  material(fragmentShader) {
    let m = this.materials.get(fragmentShader);
    if (!m) {
      // every uniform with a value of its type (the programs are compiled and drawn once before any pass runs)
      const empty = { sampler2D: () => null, float: () => 0, vec2: () => new THREE.Vector2(), vec4: () => new THREE.Vector4() };
      const uniforms = {};
      for (const [, type, list] of fragmentShader.matchAll(/uniform\s+(sampler2D|float|vec2|vec4)\s+([^;]+);/g)) for (const k of list.split(',')) uniforms[k.trim()] = { value: empty[type]() };
      m = new THREE.ShaderMaterial({ uniforms, vertexShader: quadVertex, fragmentShader, depthTest: false, depthWrite: false });
      this.materials.set(fragmentShader, m);
    }
    return m;
  }

  run(target, fragmentShader, uniforms, y0 = 0, rows = target.height) {
    const m = this.material(fragmentShader);
    for (const [k, v] of Object.entries(uniforms)) (m.uniforms[k] ||= { value: v }).value = v;
    this.mesh.material = m;
    const R = this.renderer, prev = R.getRenderTarget(), auto = R.autoClear;
    const band = y0 > 0 || rows < target.height;
    if (band) { target.scissor.set(0, y0, target.width, rows); target.scissorTest = true; }
    R.autoClear = false; R.setRenderTarget(target); R.render(this.scene, this.camera);
    if (band) { target.scissorTest = false; target.scissor.set(0, 0, target.width, target.height); }
    R.setRenderTarget(prev); R.autoClear = auto;
  }

  dispose() { this.mesh.geometry.dispose(); for (const m of this.materials.values()) m.dispose(); }
}
