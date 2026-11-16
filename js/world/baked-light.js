// Baked lighting: a fixed sun with baked sun shadows and ambient occlusion for the static scenery.
//
// A scene opts in with  "lighting": { "baked": "golden" }  (see BAKE_DEFAULTS for the other keys). Then:
//   - the sun stays at the baked time of day (golden hour); night still works (lights, baked AO, no sun
//     shadows); other times of day fall back to the baked one
//   - once the static scenery has finished streaming in, the GPU bakes, in a few small steps spread over
//     frames (no hitch), a top-down "shadow height" map of the whole area around the route: for every
//     column (x, z), the height below which the sun is hidden by something up-sun of it (terrain,
//     buildings, bridges, trees). Any point at any height can look itself up, so walls, roofs, the
//     rider and the traffic all get the right baked shadow, and long golden-hour shadows reach as far
//     as they really do (the live shadow map only covered ~100 m around the rider)
//   - from the same height field: ambient occlusion (darker street canyons, wall feet, under decks and
//     crowns), applied to the sky light
//   - the per-frame sun shadow map keeps only the things that move (rider, traffic, people, boats) in a
//     small box round the rider; static meshes stop casting into it
// Every lit material (standard, lambert, phong) in the scene is patched once (onBeforeCompile chained,
// like look.js): the sun's light is scaled by the baked visibility before the lighting model runs (so a
// toon/band look reads it like the shadow map) and the sky light by the AO.
//
// Scenery that builds itself in later (streamed static detail) is picked up automatically: the bake
// re-runs, in the background, when the set of static meshes changes and has settled. Streamed LOD detail
// that comes and goes with the camera should set `userData.bake = false` (it then neither casts nor
// triggers re-bakes; it still receives the baked shadow and AO). `userData.bake = true` forces a mesh in
// (e.g. thin props that would otherwise be skipped). Moving things: InstancedMesh with DynamicDrawUsage,
// or `userData.dynamic = true`, keep casting into the small live shadow map.
import * as THREE from '../../vendor/three.module.min.js';

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
};

const OCC_LAYER = 30;
const STEP_FRAMES = 1;   // GPU passes per frame while baking
const SETTLE_SWEEPS = 2; // the static set must be unchanged this many sweeps before a (re)bake
const SWEEP_EVERY = 20;  // frames between material/caster sweeps
const OCC_BATCH = 48;    // occluder meshes drawn per bake step

const quadVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;

/** GLSL for lit materials: uniforms + bfBakedLight() giving (sun visibility, sky-light AO). */
const BAKE_PARS = /* glsl */`
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
    return vec2(mix(1., lit, bfBakeOn.x), mix(1., ao, bfBakeOn.y));
  }`;

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
    this.bakes = 0;
    this.stats = null;                 // last bake: { ms, cpuMs, texels, cell, passes, occluders }
    this._frame = 0;
    this._sig = ''; this._settled = 0; this._bakedSig = null;
    this._job = null;
    this.dynamicSpan = this.opts.dynamicSpanM;
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
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${BAKE_PARS}`)
        .replace('#include <lights_fragment_begin>', `
          mat3 bfVT = transpose(mat3(viewMatrix));
          vec2 bfBaked = bfBakedLight(bfVT * (-vViewPosition - viewMatrix[3].xyz), normalize(bfVT * normal));
          ${THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
            'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= bfBaked.x;')}`)
        .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= bfBaked.y; reflectedLight.indirectSpecular *= bfBaked.y;
          #include <aomap_fragment>`);
    };
    m.customProgramCacheKey = () => `${prevKey}|bf-baked-1`;
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

  _busy() {
    const t = this.world.terrain;
    return !t?.kit || !!t.city?._pending?.length || (t.stats?.loading ?? 0) > 0;
  }

  /** Per frame: sweeps, starts a bake when the static scenery settles, runs the bake a step at a time. */
  tick(dt) {
    this._frame++;
    if (!this._job && this._frame % SWEEP_EVERY === 1) {
      this.sweep();
      if (!this._busy() && this._settled >= SETTLE_SWEEPS && this._sig !== this._bakedSig) this._job = this._bake();
    }
    if (this._job) {
      for (let k = 0; k < STEP_FRAMES; k++) { if (this._job.next().done) { this._job = null; break; } }
    }
    // ease the bake in (and the sun shadow out at night)
    const on = this.uniforms.bfBakeOn.value, a = Math.min(1, dt * 2.5);
    const sun = this.ready ? this.target.sun : 0, ao = this.ready ? this.target.ao : 0;
    on.x += (sun - on.x) * a; on.y += (ao - on.y) * a;
    if (Math.abs(on.x - sun) < .002) on.x = sun;
    if (Math.abs(on.y - ao) < .002) on.y = ao;
  }

  /** Build any static scenery still streaming in, then bake at once (for tools that draw one frame). */
  bakeNow() {
    const c = this.world.terrain?.city;
    if (c?._pending) while (c._pending.length) c._buildChunk(c._pending.pop());
    this.sweep();
    const job = this._bake();
    let worst = 0;
    for (;;) { const t = performance.now(), r = job.next(); worst = Math.max(worst, performance.now() - t); if (r.done) break; }
    this._job = null;
    if (this.stats) this.stats.worstStepMs = Math.round(worst);   // the longest step: what one ride frame would carry
    const on = this.uniforms.bfBakeOn.value; on.x = this.target.sun; on.y = this.target.ao;
    return this.stats;
  }

  // ------------------------------------------------------------------ the bake
  /** The baking job: a generator, one GPU pass (or a slice of CPU work) per step. */
  *_bake() {
    const t0 = performance.now(); let cpu = 0, c0 = performance.now();
    const w = this.world, R = w.renderer, O = this.opts, sigAtStart = this._sig;
    const d = this.sunDir.clone();
    const flat = Math.hypot(d.x, d.z) || 1, ux = d.x / flat, uz = d.z / flat, k = Math.max(.02, d.y) / flat;   // rise per metre toward the sun
    // the area: the route's box plus the margin (what is seen), and the work area reaching up-sun
    const ix = w.index.xs, iz = w.index.zs;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ix.length; i++) { x0 = Math.min(x0, ix[i]); x1 = Math.max(x1, ix[i]); z0 = Math.min(z0, iz[i]); z1 = Math.max(z1, iz[i]); }
    x0 -= O.marginM; x1 += O.marginM; z0 -= O.marginM; z1 += O.marginM;
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
    const base = (w.route.minEle ?? 0) - 40;

    // 1. terrain heights on a coarse grid (CPU, in ~4 ms slices; kept for re-bakes of the same area)
    const ph = {}; let p0 = performance.now();
    const ground = this._groundSampler();
    const GN = Math.max(2, Math.ceil((EX1 - ex0) / O.groundCellM) + 1), GM = Math.max(2, Math.ceil((EZ1 - ez0) / O.groundCellM) + 1);
    const gkey = [ex0, EX1, ez0, EZ1, GN, GM, base].join();
    let gdata = this._ground?.key === gkey ? this._ground.data : null;
    cpu += performance.now() - c0;
    if (!gdata) {
      gdata = new Float32Array(GN * GM);
      c0 = performance.now();
      for (let j = 0; j < GM; j++) {
        const z = EZ1 - (EZ1 - ez0) * j / (GM - 1);   // row 0 = the max-z edge, like the GPU grids (v = (z1 - z) / depth)
        for (let i = 0; i < GN; i++) gdata[j * GN + i] = ground(ex0 + (EX1 - ex0) * i / (GN - 1), z) - O.groundDropM - base;
        if (performance.now() - c0 > 4 && j < GM - 1) { cpu += performance.now() - c0; yield; c0 = performance.now(); }
      }
      cpu += performance.now() - c0;
      this._ground = { key: gkey, data: gdata };
    }
    ph.ground = performance.now() - p0;
    c0 = performance.now();
    const gtex = new THREE.DataTexture(gdata, GN, GM, THREE.RedFormat, THREE.FloatType);
    gtex.minFilter = gtex.magFilter = THREE.LinearFilter; gtex.flipY = false; gtex.needsUpdate = true;
    // (the float texture is filtered linearly where OES_texture_float_linear exists; else nearest, still fine)
    if (!R.extensions.has('OES_texture_float_linear')) gtex.minFilter = gtex.magFilter = THREE.NearestFilter;

    // 2. the static meshes from above: the top of whatever stands in each column
    const half = THREE.HalfFloatType;
    const rt = (W, H, format, type = half, depth = false) => {
      const r = new THREE.WebGLRenderTarget(W, H, { format, type, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      r.texture.generateMipmaps = false; return r;
    };
    const occRT = rt(EW, EH, THREE.RGFormat, half, true);
    const cam = new THREE.OrthographicCamera(-(EX1 - ex0) / 2, (EX1 - ex0) / 2, (EZ1 - ez0) / 2, -(EZ1 - ez0) / 2, 1, 6000);
    cam.position.set((ex0 + EX1) / 2, base + 3000, (ez0 + EZ1) / 2); cam.up.set(0, 0, -1); cam.lookAt((ex0 + EX1) / 2, base, (ez0 + EZ1) / 2);
    cam.updateMatrixWorld(); cam.layers.set(OCC_LAYER);
    const occMat = this._occMat ||= new THREE.ShaderMaterial({   // kept: re-bakes reuse its programs
      uniforms: { uBase: { value: base } },
      vertexShader: /* glsl */`
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
        }`,
      fragmentShader: /* glsl */`varying float vY; void main() { gl_FragColor = vec4(vY, 1., 0., 1.); }`,
      side: THREE.DoubleSide,
    });
    occMat.uniforms.uBase.value = base;
    const occluders = (this.occluders || []).filter((o) => o.visible);
    // in batches, a frame apart: the first bake also uploads every static mesh of the route to the GPU
    ph.occluders = 0;
    for (let k0 = 0; k0 < Math.max(1, occluders.length); k0 += OCC_BATCH) {
      c0 = performance.now();
      const batch = occluders.slice(k0, k0 + OCC_BATCH);
      for (const o of batch) o.layers.enable(OCC_LAYER);
      const prev = { target: R.getRenderTarget(), override: w.scene.overrideMaterial, sm: R.shadowMap.enabled, clear: R.getClearColor(new THREE.Color()), alpha: R.getClearAlpha(), autoClear: R.autoClear, fog: w.scene.fog, bg: w.scene.background };
      w.scene.overrideMaterial = occMat; w.scene.fog = null; w.scene.background = null;
      R.shadowMap.enabled = false; R.setClearColor(0x000000, 0); R.autoClear = k0 === 0;   // depth kept: the highest top wins
      R.setRenderTarget(occRT); R.render(w.scene, cam);
      for (const o of batch) o.layers.disable(OCC_LAYER);
      w.scene.overrideMaterial = prev.override; w.scene.fog = prev.fog; w.scene.background = prev.bg;
      R.shadowMap.enabled = prev.sm; R.setClearColor(prev.clear, prev.alpha); R.autoClear = prev.autoClear; R.setRenderTarget(prev.target);
      cpu += performance.now() - c0; ph.occluders += performance.now() - c0;
      yield;
    }

    // 3. full-screen passes on the work grid
    c0 = performance.now(); p0 = c0;
    const pass = new FullScreen(R);
    const texel = new THREE.Vector2(1 / EW, 1 / EH);
    // combine: the column top O = max(mesh top, terrain); kept for the AO and the cover height
    const topRT = rt(EW, EH, THREE.RedFormat), tmpRT = rt(EW, EH, THREE.RedFormat);
    pass.run(topRT, /* glsl */`
      uniform sampler2D tOcc, tGround; uniform vec2 uGrid; varying vec2 vUv;
      void main() {
        vec2 o = texture2D(tOcc, vUv).rg;
        float g = texture2D(tGround, (vUv * (uGrid - 1.) + .5) / uGrid).r;   // grid nodes on the texel centres
        gl_FragColor = vec4(o.g > .5 ? max(o.r, g) : g, 0., 0., 1.);
      }`, { tOcc: occRT.texture, tGround: gtex, uGrid: new THREE.Vector2(GN, GM) });
    occRT.dispose(); gtex.dispose();
    // opening (erode, then dilate, 2×2): drops anything under a texel wide (cables, rails, sign arms)
    // that would otherwise come out as random dots of tall columns, and keeps the rest in place
    const morph = (op, sign) => /* glsl */`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec2 o = uTexel * ${sign};
        float a = texture2D(tSrc, vUv).r, b = texture2D(tSrc, vUv + vec2(o.x, 0.)).r, c = texture2D(tSrc, vUv + vec2(0., o.y)).r, d = texture2D(tSrc, vUv + o).r;
        gl_FragColor = vec4(${op}(${op}(a, b), ${op}(c, d)), 0., 0., 1.);
      }`;
    pass.run(tmpRT, morph('min', '1.'), { tSrc: topRT.texture, uTexel: texel });
    pass.run(topRT, morph('max', '-1.'), { tSrc: tmpRT.texture, uTexel: texel });
    tmpRT.dispose();
    cpu += performance.now() - c0;
    yield;
    // the sweep toward the sun, doubling the reach each pass: M(p) = max over j of O(p + j·v) - j·cell·k
    // (v = one texel toward the sun; in uv, rows grow southward, so z flips sign)
    const v = new THREE.Vector2(ux * cell / (EX1 - ex0), -uz * cell / (EZ1 - ez0));
    const sweepSrc = /* glsl */`
      uniform sampler2D tSrc; uniform vec2 uStep; uniform float uDrop; varying vec2 vUv;
      void main() {
        float a = texture2D(tSrc, vUv).r;
        vec2 q = vUv + uStep;
        float b = (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) ? -1e4 : texture2D(tSrc, q).r - uDrop;
        gl_FragColor = vec4(max(a, b), 0., 0., 1.);
      }`;
    let src = topRT, A = rt(EW, EH, THREE.RedFormat), B = rt(EW, EH, THREE.RedFormat), passes = 0;
    for (let n = 1; n * cell < reach * 1.05; n *= 2) {
      c0 = performance.now();
      const dst = src === A ? B : A;
      pass.run(dst, sweepSrc, { tSrc: src.texture, uStep: v.clone().multiplyScalar(n), uDrop: n * cell * k });
      src = dst; passes++;
      cpu += performance.now() - c0;
      yield;
    }
    // 4. the baked maps on the view grid: R = shadow height from strictly up-sun (one texel on), G = column top
    c0 = performance.now();
    const viewUv = new THREE.Vector4(vi0 / EW, vj0 / EH, VW / EW, VH / EH);
    const sunRT = rt(VW, VH, THREE.RGFormat);
    pass.run(sunRT, /* glsl */`
      uniform sampler2D tSweep, tTop; uniform vec4 uView; uniform vec2 uStep; uniform float uDrop; varying vec2 vUv;
      void main() {
        vec2 p = uView.xy + vUv * uView.zw;   // the view grid inside the work grid (both: v = 0 on the max-z edge)
        gl_FragColor = vec4(texture2D(tSweep, p + uStep).r - uDrop, texture2D(tTop, p).r, 0., 1.);
      }`, { tSweep: src.texture, tTop: topRT.texture, uView: viewUv, uStep: v, uDrop: cell * k });
    cpu += performance.now() - c0;
    yield;
    // 5. ambient occlusion from the column tops: how much of the sky the surface's horizon hides
    c0 = performance.now();
    const aoRT = rt(VW, VH, THREE.RedFormat, THREE.UnsignedByteType);
    pass.run(aoRT, /* glsl */`
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
      }`, { tTop: topRT.texture, uView: viewUv, uTexel: texel, uCell: cell, uStrength: O.ao });
    pass.dispose(); topRT.dispose(); A.dispose(); B.dispose();
    cpu += performance.now() - c0;
    ph.passes = performance.now() - p0;

    // swap in
    const old = this._maps;
    this._maps = { sun: sunRT, ao: aoRT };
    this.uniforms.bfBakeSun.value = sunRT.texture;
    this.uniforms.bfBakeAO.value = aoRT.texture;
    // every grid here has v = 0 on its max-z edge: v = (z1 - z) / depth (the bake camera looks down with north up)
    this.uniforms.bfBakeBox.value.set(vx0, vz1, 1 / (VW * cell), 1 / (VH * cell));
    this.uniforms.bfBakeK.value.set(base, O.soft, O.bias, O.normalOffset * cell);
    old?.sun.dispose(); old?.ao.dispose();
    this._bakedSig = sigAtStart;
    this.ready = true; this.bakes++;
    this.stats = { ms: Math.round(performance.now() - t0), cpuMs: Math.round(cpu), work: [EW, EH], view: [VW, VH], cell: +cell.toFixed(2), passes, occluders: occluders.length, groundSamples: GN * GM,
      phases: Object.fromEntries(Object.entries(ph).map(([k, v]) => [k, Math.round(v)])),
      gpuMB: +((VW * VH * (4 + 1)) / 1048576).toFixed(1) };
    w.log('3d', `Baked lighting: ${VW}×${VH} at ${cell.toFixed(1)} m, ${occluders.length} meshes, ${this.stats.ms} ms (${this.stats.cpuMs} ms on the CPU)`, 'debug');
    // static meshes leave the live shadow map now that the bake has them
    this.sweep();
  }

  /** Terrain height for the bake: the scene's base ground (no street grading), else the terrain's own. */
  _groundSampler() {
    const t = this.world.terrain, L = t.landscape;
    if (this.opts.groundAt) return this.opts.groundAt;
    if (L?.baseHeight) return L.baseHeight;
    return (x, z) => t.heightAt(x, z);
  }

  dispose() {
    this._job = null;
    this._maps?.sun.dispose(); this._maps?.ao.dispose();
    this._occMat?.dispose();
    this._empty.dispose();
  }
}

/** A full-screen triangle pass into a render target. */
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

  run(target, fragmentShader, uniforms) {
    let m = this.materials.get(fragmentShader);
    if (!m) {
      m = new THREE.ShaderMaterial({ uniforms: Object.fromEntries(Object.keys(uniforms).map((k) => [k, { value: null }])), vertexShader: quadVertex, fragmentShader, depthTest: false, depthWrite: false });
      this.materials.set(fragmentShader, m);
    }
    for (const [k, v] of Object.entries(uniforms)) m.uniforms[k].value = v;
    this.mesh.material = m;
    const R = this.renderer, prev = R.getRenderTarget(), auto = R.autoClear;
    R.autoClear = false; R.setRenderTarget(target); R.render(this.scene, this.camera);
    R.setRenderTarget(prev); R.autoClear = auto;
  }

  dispose() { this.mesh.geometry.dispose(); for (const m of this.materials.values()) m.dispose(); }
}
