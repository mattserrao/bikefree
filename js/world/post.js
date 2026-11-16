// A small post-processing chain for the hero scenery: the scene renders into an HDR target, the
// brightest light (sun glint on the sea, the low sun, lamps at night) blooms softly, and the final
// pass tone-maps with a gentle grade and vignette. About three cheap passes; off on Light detail.
import * as THREE from '../../vendor/three.module.min.js';

const quadVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    const hdr = { type: THREE.HalfFloatType, depthBuffer: true };
    this.scene = new THREE.WebGLRenderTarget(2, 2, { ...hdr, samples: 4 });
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
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: .32 }, uVignette: { value: .22 }, uWarm: { value: 0 } },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */`
        uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uVignette; uniform float uWarm; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
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
    this.quad = new THREE.Mesh(tri, this.bright);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
  }

  setSize(width, height) {
    width = Math.max(2, Math.floor(width)); height = Math.max(2, Math.floor(height));
    this.scene.setSize(width, height);
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

  render(scene, camera, opts = {}) {
    const r = this.renderer;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    this.bright.uniforms.tSrc.value = this.scene.texture;
    this.bright.uniforms.uThreshold.value = opts.threshold ?? 1.1;
    this._pass(this.bright, this.a);
    for (let k = 0; k < 2; k++) {
      this.blur.uniforms.tSrc.value = this.a.texture; this.blur.uniforms.uDir.value.set((1 + k) / this._w, 0); this._pass(this.blur, this.b);
      this.blur.uniforms.tSrc.value = this.b.texture; this.blur.uniforms.uDir.value.set(0, (1 + k) / this._h); this._pass(this.blur, this.a);
    }
    this.composite.uniforms.tScene.value = this.scene.texture;
    this.composite.uniforms.tBloom.value = this.a.texture;
    this.composite.uniforms.uBloom.value = opts.bloom ?? .32;
    this.composite.uniforms.uWarm.value = opts.warm ?? 0;
    this._pass(this.composite, null);
  }

  dispose() {
    for (const t of [this.scene, this.a, this.b]) t.dispose();
    for (const m of [this.bright, this.blur, this.composite]) m.dispose();
    this.geometry.dispose();
  }
}
