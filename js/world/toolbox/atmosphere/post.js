// The frame pipeline for the stylized scenery: the scene renders into an HDR target with its own
// multisampling and a 32-bit float depth buffer (so the renderer can use a reversed depth buffer
// instead of the logarithmic one, which stopped the GPU skipping hidden pixels). The final pass
// tone-maps to the screen. Hero scenery adds a soft bloom on the brightest light (sun glint on the
// sea, the low sun, lamps at night), a gentle grade and a vignette; off on Light detail.
import * as THREE from '../../../../vendor/three.module.min.js';

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
const inkUniforms = () => ({ tDepth: { value: null }, uInkTexel: { value: new THREE.Vector2() }, uInk: { value: new THREE.Vector4() }, uInkFar: { value: new THREE.Vector3() }, uNearFar: { value: new THREE.Vector2() } });

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
    this.a = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    this.b = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
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
        void main() {
          vec3 c = applyInk(texture2D(tScene, vUv).rgb, vUv) + texture2D(tBloom, vUv).rgb * uBloom;
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
        void main() { vec4 c = texture2D(tSrc, vUv); gl_FragColor = vec4(applyInk(c.rgb, vUv), c.a); }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new THREE.Mesh(tri, this.bright);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
  }

  _target(hdr) {
    const key = hdr ? 'scene' : 'plain';
    if (!this[key]) {
      const t = new THREE.WebGLRenderTarget(this._size[0], this._size[1], {
        type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, samples: this.samples,
        // 32-bit float depth: what makes the reversed depth buffer precise out to the horizon
        depthTexture: new THREE.DepthTexture(this._size[0], this._size[1], THREE.FloatType) });
      t.resolveDepthBuffer = !!this.ink;   // read back only for the cartoon outlines
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
    if (!!ink !== !!this.ink) for (const key of ['scene', 'plain']) if (this[key]) { this[key].depthTexture?.dispose(); this[key].dispose(); this[key] = null; }
    this.ink = ink || null;
  }

  _inkUniforms(material, target, camera) {
    const u = material.uniforms, ink = this.ink;
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
    for (const key of ['scene', 'plain']) if (this[key]) { this[key].depthTexture?.dispose(); this[key].dispose(); this[key] = null; }
  }

  setSize(width, height) {
    width = Math.max(2, Math.floor(width)); height = Math.max(2, Math.floor(height));
    this._size = [width, height];
    this.scene?.setSize(width, height); this.plain?.setSize(width, height);
    const w = Math.max(2, Math.floor(width / 4)), h = Math.max(2, Math.floor(height / 4));
    this.a.setSize(w, h); this.b.setSize(w, h);
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
    this._pass(this.bright, this.a);
    for (let k = 0; k < 2; k++) {
      this.blur.uniforms.tSrc.value = this.a.texture; this.blur.uniforms.uDir.value.set((1 + k) / this._w, 0); this._pass(this.blur, this.b);
      this.blur.uniforms.tSrc.value = this.b.texture; this.blur.uniforms.uDir.value.set(0, (1 + k) / this._h); this._pass(this.blur, this.a);
    }
    this.composite.uniforms.tScene.value = target.texture;
    this.composite.uniforms.tBloom.value = this.a.texture;
    this.composite.uniforms.uBloom.value = opts.bloom ?? .32;
    this.composite.uniforms.uWarm.value = opts.warm ?? 0;
    this._inkUniforms(this.composite, target, camera);
    this._pass(this.composite, null);
  }

  dispose() {
    for (const t of [this.scene, this.plain]) if (t) { t.depthTexture?.dispose(); t.dispose(); }
    for (const t of [this.a, this.b]) t.dispose();
    for (const m of [this.bright, this.blur, this.composite, this.copy]) m.dispose();
    this.geometry.dispose();
  }
}
