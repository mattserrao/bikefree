// The frame pipeline for the stylized scenery: the scene renders into an HDR target with its own
// multisampling and a 32-bit float depth buffer (so the renderer can use a reversed depth buffer
// instead of the logarithmic one, which stopped the GPU skipping hidden pixels). The final pass
// tone-maps to the screen. Hero scenery adds a soft bloom on the brightest light (sun glint on the
// sea, the low sun, lamps at night), a gentle grade and a vignette; off on Light detail.
import * as THREE from '../../../../vendor/three.js';
import { HASH_GLSL } from '../materials/glsl-noise.js';   // [review 27 Nov] the shared sin-free hash (the contact shading's tap rotation)

// Cartoon ink outlines (lean cartoon look): darken pixels where the depth jumps, near the rider only.
// Read in the final pass from the scene target's depth, so outlines add no full-screen pass of their own.
const inkChunk = /* glsl */`
  uniform sampler2D tDepth; uniform vec2 uInkTexel; uniform vec4 uInk;   // px, strength, threshold, fade (m)
  uniform vec3 uInkFar;   // vista kit ridge ink: strength, threshold, start (m)
  uniform vec2 uNearFar;
  float inkZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
      return exp2(d * log2(uNearFar.y + 1.)) - 1.;
    #else
      return -perspectiveDepthToViewZ(d, uNearFar.x, uNearFar.y);
    #endif
  }
  vec3 applyInk(vec3 col, vec2 uv) {
    if (uInk.y <= 0. && uInkFar.x <= 0.) return col;
    vec2 o = uInkTexel * uInk.x;
    float z = inkZ(uv), zl = inkZ(uv - vec2(o.x, 0.)), zr = inkZ(uv + vec2(o.x, 0.)), zd = inkZ(uv - vec2(0., o.y)), zu = inkZ(uv + vec2(0., o.y));
    float zMin = min(z, min(min(zl, zr), min(zd, zu)));
    // a silhouette: a neighbour at a very different distance, relative to the nearer one (both sides of the edge)
    float jump = max(max(abs(z - zl), abs(z - zr)), max(abs(z - zd), abs(z - zu))) / max(zMin, .5);
    float edge = smoothstep(uInk.z, uInk.z * 2.2, jump) * (1. - smoothstep(uInk.w * .55, uInk.w, zMin));
    vec3 ink = mix(vec3(.035, .04, .06), col * .3, .4);
    col = mix(col, ink, edge * max(uInk.y, 0.));
    // far ridges: a soft line in the ridge's own colour, darker, where one ridge stands in front of another
    float ridge = smoothstep(uInkFar.y, uInkFar.y * 1.8, jump) * smoothstep(uInkFar.z * .6, uInkFar.z, zMin);
    return mix(col, col * .62, ridge * uInkFar.x);
  }`;
// Contact shading (graph worlds, High on laptops and desktops: user, 24 Nov — Zwift parity): a screen-space ambient
// occlusion from the depth alone — 8 taps in a ring sized to ~0.7 m in the world, a neighbour that stands nearer by
// 0.1–2 m shades the pixel. Read in the final pass (no extra pass); fades out by 160 m.
const aoChunk = /* glsl */`${HASH_GLSL}
  uniform vec2 uAO;   // strength, world radius (m)
  uniform float uFocal;   // the projection's y scale (px per unit at 1 m: × half the target height)
  float contactAO(vec2 uv, float z) {
    if (uAO.x <= 0. || z > 220.) return 1.;
    float r = uAO.y * uFocal / max(z, 1.);   // the radius in uv
    // pairs of opposite taps: 1/z is linear across a plane on screen, so a flat surface (the road seen low) has the
    // centre on the line between them and shades nothing; a crease (the ground meeting a wall, a car, a kerb) has the
    // centre farther than that line: shaded by how much (0.05–1.5 m)
    float occ = 0., rot = hw21(floor(uv / uInkTexel)) * .785;   // [review 27 Nov] the shared sin-free hash, per texel
    for (int i = 0; i < 6; i++) {   // (12 taps in two rings: user 26 Nov — the contact shading was faint)
      float a = float(i) * .523599 + rot;
      for (int j = 1; j <= 2; j++) {
        vec2 o = vec2(cos(a), sin(a) * uInkTexel.x / uInkTexel.y) * r * float(j) * .5;
        float wa = 1. / max(inkZ(uv + o), .1), wb = 1. / max(inkZ(uv - o), .1);
        float dz = z - 1. / max((wa + wb) * .5, 1e-4);
        occ += smoothstep(.04, .3, dz) * (1. - smoothstep(.8, 1.6, dz));
      }
    }
    return 1. - uAO.x * min(1., occ / 12. * 1.25) * (1. - smoothstep(120., 220., z));
  }`;
// Aerial perspective (fidelity plan, step 8): the air between the camera and every pixel, from the depth — thicker
// low down (height fog: valleys, water, the canyon floor), lit by the sun when you look toward it (in-scatter: the
// glow round a low sun, hills going pale and warm against it, cool and blue away from it). Replaces the scenes' linear
// fog on the tiers with the frame pipeline; the sky (depth at the far plane) is left to the sky dome.
const atmoChunk = /* glsl */`
  uniform vec4 uAtmo;        // density (1/m), height falloff (1/m), base height (m), strength (0: off)
  uniform vec3 uSunDirW, uSunCol, uHaze, uCamPos;
  uniform mat4 uInvProj, uCamWorld;
  vec3 atmoWorldDir(vec2 uv) {
    vec4 v = uInvProj * vec4(uv * 2. - 1., 1., 1.); v /= v.w;
    return normalize((uCamWorld * vec4(v.xyz, 0.)).xyz);
  }
  vec3 applyAtmo(vec3 col, vec2 uv, float z) {
    if (uAtmo.w <= 0.) return col;
    vec3 dir = atmoWorldDir(uv);
    float dist = z / max(dot(dir, -normalize(uCamWorld[2].xyz)), .05);   // (z is view depth: the ray is longer off-centre)
    // height fog integrated along the ray: exp(-k (y - base)) from the camera's height to the pixel's
    float k = uAtmo.y, y0 = uCamPos.y - uAtmo.z, dy = dir.y * dist;
    float h = abs(dy) > .01 ? (exp(-k * y0) - exp(-k * (y0 + dy))) / (k * dy) : exp(-k * y0);
    float tau = uAtmo.x * dist * clamp(h, 0., 4.);
    float f = (1. - exp(-tau)) * uAtmo.w;
    float mu = max(dot(dir, uSunDirW), 0.);
    vec3 inscatter = uHaze + uSunCol * (pow(mu, 8.) * .55 + pow(mu, 48.) * .9);
    return mix(col, inscatter, f);
  }`;
const inkUniforms = () => ({ uAtmo: { value: new THREE.Vector4() }, uSunDirW: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uCamPos: { value: new THREE.Vector3() }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, tShaft: { value: null }, uShaft: { value: 0 }, uAO: { value: new THREE.Vector2() }, uFocal: { value: 1 }, tDepth: { value: null }, uInkTexel: { value: new THREE.Vector2() }, uInk: { value: new THREE.Vector4() }, uInkFar: { value: new THREE.Vector3() }, uNearFar: { value: new THREE.Vector2() } });

const quadVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;

export class PostFX {
  constructor(renderer, { samples = 4 } = {}) {
    this.renderer = renderer;
    this.samples = samples;
    // hero scenery: linear HDR, tone-mapped by the composite pass
    this.scene = null;
    // everything else (and Light detail): 8-bit, with the materials tone-mapping and encoding sRGB
    // themselves exactly as they would drawing straight to the canvas (three does that for an XR target),
    // so the look is unchanged and the copy to the screen is a plain blit
    this.plain = null;
    this._size = [2, 2];
    // [review 27 Nov] the quarter-size half-float targets (a, b: bloom; c, d: sun shafts) made on first use (_q): the
    // plain path never draws into them; and only the path in use keeps its full-size target (_target drops the other)
    this.a = this.b = this.c = this.d = null;
    this._w = this._h = 2;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry = tri;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bright = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThreshold: { value: 1.1 }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform float uThreshold; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          // 4-tap downsample, keep only what is brighter than the threshold (soft knee)
          vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., -1.)).rgb
                  + texture2D(tSrc, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., 1.)).rgb) * .25;
          float l = max(c.r, max(c.g, c.b));
          float k = smoothstep(uThreshold * .7, uThreshold * 1.4, l);
          gl_FragColor = vec4(min(c * k, vec3(8.)), 1.);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * .227;
          c += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * .316;
          c += (texture2D(tSrc, vUv + uDir * 3.231).rgb + texture2D(tSrc, vUv - uDir * 3.231).rgb) * .07;
          gl_FragColor = vec4(c, 1.);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: .32 }, uVignette: { value: .22 }, uWarm: { value: 0 }, ...inkUniforms() },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uVignette; uniform float uWarm; varying vec2 vUv;
        ${inkChunk}
        ${aoChunk}
        ${atmoChunk}
        uniform sampler2D tShaft; uniform float uShaft;
        void main() {
          vec3 c = texture2D(tScene, vUv).rgb;
          if (uAO.x > 0.) c *= contactAO(vUv, inkZ(vUv));
          if (uAtmo.w > 0. && texture2D(tDepth, vUv).x < .99999) c = applyAtmo(c, vUv, inkZ(vUv));
          if (uShaft > 0.) c += texture2D(tShaft, vUv).rgb * uShaft;
          c = applyInk(c, vUv) + texture2D(tBloom, vUv).rgb * uBloom;
          // grade: a touch more contrast and colour, warm highlights in low sun
          float l = dot(c, vec3(.2126, .7152, .0722));
          c = mix(vec3(l), c, 1.08);
          c *= mix(vec3(1.), vec3(1.04, 1., .95), uWarm * smoothstep(.2, 1.2, l));
          vec2 d = vUv - .5;
          c *= 1. - uVignette * smoothstep(.25, .85, dot(d, d) * 2.2);
          gl_FragColor = vec4(c, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: true,
    });
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, ...inkUniforms() },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tSrc; varying vec2 vUv;
        ${inkChunk}
        ${aoChunk}
        void main() { vec4 c = texture2D(tSrc, vUv); vec3 o = applyInk(c.rgb, vUv); if (uAO.x > 0.) o *= contactAO(vUv, inkZ(vUv)); gl_FragColor = vec4(o, c.a); }`,   // (Balanced's lite pass: the contact shading on the plain picture)
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    // sun shafts (step 8): the sky's bright pixels near the sun, smeared toward it (radial blur at a quarter size)
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(.5, .5) }, uSunCol: { value: new THREE.Color() }, uFirst: { value: 1 } },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc, tDepth; uniform vec2 uSun; uniform vec3 uSunCol; uniform float uFirst; varying vec2 vUv;
        float src(vec2 uv) {
          if (uFirst < .5) return texture2D(tSrc, uv).r;
          float sky = step(.99999, texture2D(tDepth, uv).x);
          return sky * max(0., 1. - distance(uv, uSun) * 2.2);
        }
        void main() {
          vec2 d = (vUv - uSun) * (uFirst > .5 ? .55 : .3) / 16.;
          float acc = 0., w = 1.;
          vec2 uv = vUv;
          for (int i = 0; i < 16; i++) { acc += src(uv) * w; w *= .94; uv -= d; }
          acc /= 9.;
          gl_FragColor = uFirst > .5 ? vec4(vec3(acc), 1.) : vec4(uSunCol * acc, 1.);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.atmo = null;
    this.quad = new THREE.Mesh(tri, this.bright);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
  }

  /** A quarter-size half-float target (a–d), made the first time it's drawn into. */
  _q(key) { return (this[key] ||= new THREE.WebGLRenderTarget(this._w, this._h, { type: THREE.HalfFloatType, depthBuffer: false })); }
  _drop(keys) { for (const key of keys) if (this[key]) { this[key].depthTexture?.dispose(); this[key].dispose(); this[key] = null; } }

  _target(hdr) {
    const key = hdr ? 'scene' : 'plain';
    if (!this[key]) {
      // [review 27 Nov] the path changed (a detail level, a hero scene): the other path's target (full size, MSAA,
      // float depth) freed, and the quarter-size ones with the graded path
      this._drop([hdr ? 'plain' : 'scene']); if (!hdr) { this._drop(['a', 'b', 'c', 'd']); this.composite.uniforms.tShaft.value = null; }
      const t = new THREE.WebGLRenderTarget(this._size[0], this._size[1], {
        type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, samples: this.samples,
        // 32-bit float depth: what makes the reversed depth buffer precise out to the horizon
        depthTexture: new THREE.DepthTexture(this._size[0], this._size[1], THREE.FloatType) });
      t.resolveDepthBuffer = !!this.ink || !!this.ao || !!this.atmo;   // read back only for the cartoon outlines and the contact shading
      if (!hdr) {
        t.isXRRenderTarget = true; t.texture.colorSpace = THREE.SRGBColorSpace;
        t.texture.internalFormat = 'RGBA8';   // holds the already-encoded values as they are: no decode on the blit
      }
      this[key] = t;
    }
    return this[key];
  }

  /**
   * Cartoon ink outlines: { px, strength, thresh, fadeM }, or null for none. Drawn in the final pass from
   * the scene's depth (which is then resolved from the multisampled target, the only extra cost).
   */
  setInk(ink) {
    if (!!ink !== !!this.ink) this._drop(['scene', 'plain']);
    this.ink = ink || null;
  }

  /** Aerial perspective and sun shafts: { density, falloff, baseY, strength, haze, shafts }, or null (off). The world's
   *  scene fog should stand back when this is on (the post pass is the air then). Needs the scene's depth (resolved). */
  setAtmosphere(a) {
    if (!!a !== !!this.atmo) this._drop(['scene', 'plain']);
    this.atmo = a || null;
  }

  /** Contact shading: { strength, radiusM }, or null. */
  setAO(ao) {
    if (!!ao !== !!this.ao) this._drop(['scene', 'plain']);
    this.ao = ao || null;
  }

  _inkUniforms(material, target, camera) {
    const u = material.uniforms, ink = this.ink;
    if (this.atmo && u.uAtmo) {
      const a = this.atmo;
      u.tDepth.value = target.depthTexture; u.uNearFar.value.set(camera.near, camera.far);
      u.uAtmo.value.set(a.density, a.falloff, a.baseY, a.strength ?? 1);
      u.uSunDirW.value.copy(a.sunDir); u.uSunCol.value.copy(a.sunColor); u.uHaze.value.copy(a.haze); u.uCamPos.value.copy(camera.position);
      u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    } else if (u.uAtmo) u.uAtmo.value.set(0, 0, 0, 0);
    if (this.ao) {
      u.tDepth.value = target.depthTexture; u.uInkTexel.value.set(1 / this._size[0], 1 / this._size[1]); u.uNearFar.value.set(camera.near, camera.far);
      u.uAO.value.set(this.ao.strength, this.ao.radiusM); u.uFocal.value = camera.projectionMatrix.elements[5] * .5;
    } else u.uAO.value.set(0, 1);
    if (!ink) { u.uInk.value.set(0, 0, 1, 1); u.uInkFar.value.set(0, 1, 1); return; }
    const ratio = this.renderer.getPixelRatio();
    u.tDepth.value = target.depthTexture;
    u.uInkTexel.value.set(1 / this._size[0], 1 / this._size[1]);
    u.uInk.value.set(ink.px * ratio, ink.strength, ink.thresh, ink.fadeM);
    if (ink.ridge) u.uInkFar.value.set(ink.ridge.strength, ink.ridge.thresh, ink.ridge.startM); else u.uInkFar.value.set(0, 1, 1);
    u.uNearFar.value.set(camera.near, camera.far);
  }

  /** MSAA samples for the scene pass (by detail level). */
  setSamples(samples) {
    if (this.samples === samples) return;
    this.samples = samples;
    this._drop(['scene', 'plain']);
  }

  setSize(width, height) {
    width = Math.max(2, Math.floor(width)); height = Math.max(2, Math.floor(height));
    this._size = [width, height];
    this.scene?.setSize(width, height); this.plain?.setSize(width, height);
    const w = Math.max(2, Math.floor(width / 4)), h = Math.max(2, Math.floor(height / 4));
    for (const t of [this.a, this.b, this.c, this.d]) t?.setSize(w, h);
    this.bright.uniforms.uTexel.value.set(1 / width, 1 / height);
    this._w = w; this._h = h;
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.camera);
  }

  /** opts.grade false: just the scene, exactly as drawn to the canvas (no bloom, grade or vignette). */
  render(scene, camera, opts = {}) {
    const r = this.renderer, plain = opts.grade === false, target = this._target(!plain);
    r.setRenderTarget(target);
    r.render(scene, camera);
    if (plain) {
      this.copy.uniforms.tSrc.value = target.texture;
      this._inkUniforms(this.copy, target, camera);
      this._pass(this.copy, null);
      return;
    }
    this.bright.uniforms.tSrc.value = target.texture;
    this.bright.uniforms.uThreshold.value = opts.threshold ?? 1.1;
    const A = this._q('a'), B = this._q('b');
    this._pass(this.bright, A);
    for (let k = 0; k < 2; k++) {
      this.blur.uniforms.tSrc.value = A.texture; this.blur.uniforms.uDir.value.set((1 + k) / this._w, 0); this._pass(this.blur, B);
      this.blur.uniforms.tSrc.value = B.texture; this.blur.uniforms.uDir.value.set(0, (1 + k) / this._h); this._pass(this.blur, A);
    }
    const cu = this.composite.uniforms;
    cu.uShaft.value = 0;
    if (this.atmo?.shafts > 0) {
      // the sun on screen (only when it's in front of the camera and near the frame)
      const sp = this._sunScreen ||= new THREE.Vector3();
      sp.copy(this.atmo.sunDir).multiplyScalar(10000).add(camera.position).project(camera);
      const inFront = this.atmo.sunDir.dot(camera.getWorldDirection(this._fwd ||= new THREE.Vector3())) > 0;
      if (inFront && Math.abs(sp.x) < 1.6 && Math.abs(sp.y) < 1.6) {
        const S = this.shaftMat.uniforms;
        S.uSun.value.set(sp.x * .5 + .5, sp.y * .5 + .5); S.uSunCol.value.copy(this.atmo.sunColor); S.tDepth.value = target.depthTexture;
        const C = this._q('c'), D = this._q('d');
        S.uFirst.value = 1; this._pass(this.shaftMat, C);
        S.uFirst.value = 0; S.tSrc.value = C.texture; this._pass(this.shaftMat, D);
        const edge = 1 - Math.min(1, Math.max(0, Math.hypot(sp.x, sp.y) - .6) / 1);
        cu.tShaft.value = D.texture; cu.uShaft.value = this.atmo.shafts * edge;
      }
    }
    this.composite.uniforms.tScene.value = target.texture;
    this.composite.uniforms.tBloom.value = A.texture;
    this.composite.uniforms.uBloom.value = opts.bloom ?? .32;
    this.composite.uniforms.uWarm.value = opts.warm ?? 0;
    this._inkUniforms(this.composite, target, camera);
    this._pass(this.composite, null);
  }

  dispose() {
    this._drop(['scene', 'plain', 'a', 'b', 'c', 'd']);
    for (const m of [this.bright, this.blur, this.composite, this.copy, this.shaftMat]) m.dispose();
    this.geometry.dispose();
  }
}
