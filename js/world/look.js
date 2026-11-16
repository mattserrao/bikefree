// Cartoon look test (lean cartoon style guide, 16 Nov 2026).
// Lays the "gentle" or "bold" cartoon look over today's scenery at run time, so it can be compared
// side by side with the current look (?look=gentle|bold in the preview, :gentle / :bold in snap).
// It answers "how far cartoon?" only: no batching or baked light yet, and the live sun and shadow map
// still drive which band a surface falls in.
//   - toon shading: three colour bands (lit, mid, shadow) on every lit scenery material, with cool
//     shadows and warm light, in place of smooth PBR shading
//   - a colour grade (saturation, value) on the albedo
//   - smooth crowns and rocks (the kit is built with { smooth: true })
//   - a flat road: clean grey, crisp paint, no grain or bump
//   - a full-screen outline pass: ink edges where depth jumps, fading with distance
import * as THREE from '../../vendor/three.module.min.js';

export const LOOKS = {
  gentle: {
    sat: 1.14, val: 1.07,                 // albedo grade
    bands: [.22, .62], soft: .08,         // band edges (share of direct sun a surface gets) and their softness
    litK: 1.06, midK: .88, shadeK: .72,   // band brightness
    shadeTint: '#9aa6d6', warmth: .35,    // shadow colour (cool) and how much of the sun's colour the lit band takes
    outline: { px: 1, strength: .5, thresh: .06, fadeM: 160 },
    road: { base: '#666b70', edge: '#ece7d6', centre: '#e7bf55' },
    exposure: 1.0,
  },
  bold: {
    sat: 1.38, val: 1.12,
    bands: [.25, .6], soft: .02,
    litK: 1.1, midK: .86, shadeK: .62,
    shadeTint: '#8189d6', warmth: .5,
    outline: { px: 1.5, strength: .9, thresh: .045, fadeM: 240 },
    road: { base: '#6e7277', edge: '#f4efdc', centre: '#f0c24f' },
    exposure: 1.04,
  },
};

const LUMA = 'vec3(.2126, .7152, .0722)';

export class Look {
  constructor(world, key) {
    this.key = key;
    this.def = LOOKS[key];
    this.world = world;
    this.smooth = true;
    const d = this.def;
    this.uniforms = {
      uToonGrade: { value: new THREE.Vector2(d.sat, d.val) },
      uToonBands: { value: new THREE.Vector3(d.bands[0], d.bands[1], d.soft) },
      uToonSun: { value: 1 },
      uToonLit: { value: new THREE.Color() },
      uToonMid: { value: new THREE.Color() },
      uToonShade: { value: new THREE.Color() },
    };
    this.patched = new WeakSet();
    this.outline = new OutlinePass(world.renderer, d.outline);
    world.renderer.toneMapping = THREE.NeutralToneMapping;
  }

  /** Band colours from the current sun and sky (call when the light changes). */
  applyLight() {
    const w = this.world, d = this.def;
    const sun = w.sun.color.clone(), sky = w.hemi.color.clone();
    // Bands follow the direct sun only (the sky light is mostly even and would flatten them), measured
    // against what flat ground gets, floored so a low golden sun still lights the ground in the mid band.
    const lum = (c) => .2126 * c.r + .7152 * c.g + .0722 * c.b;
    this.uniforms.uToonSun.value = Math.max(1e-3, w.sun.intensity * lum(sun) / Math.PI * Math.max(w.sunDir?.y ?? 1, .35));
    const white = new THREE.Color(1, 1, 1);
    this.uniforms.uToonLit.value.copy(white).lerp(sun, d.warmth).multiplyScalar(d.litK);
    this.uniforms.uToonMid.value.copy(white).lerp(sun, d.warmth * .4).multiplyScalar(d.midK);
    this.uniforms.uToonShade.value.copy(new THREE.Color(d.shadeTint)).lerp(sky, .45).multiplyScalar(d.shadeK);
    w.renderer.toneMappingExposure *= d.exposure;
  }

  /** Patch every lit scenery material in the scene (new tiles reuse patched kit materials). */
  sweep() {
    this.world.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of [].concat(o.material)) this._patch(m);
    });
    this._flattenRoad();
  }

  _patch(m) {
    if (this.patched.has(m)) return;
    this.patched.add(m);
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
    if (m.transparent && m.opacity < .99) return;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey();
    const u = this.uniforms;
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec2 uToonGrade; uniform vec3 uToonBands; uniform float uToonSun;
          uniform vec3 uToonLit; uniform vec3 uToonMid; uniform vec3 uToonShade;`)
        .replace('#include <opaque_fragment>', `{
          // cartoon bands: how much direct sun reaches this point (N·L and the shadow map)?
          vec3 tAlb = max(diffuseColor.rgb, vec3(1e-4));
          float tY = dot(tAlb, ${LUMA});
          float tL = dot(reflectedLight.directDiffuse, ${LUMA}) / max(tY, 1e-4) / uToonSun;
          vec3 tA = max(mix(vec3(tY), tAlb, uToonGrade.x), 0.) * uToonGrade.y;
          float tOut = smoothstep(uToonBands.x - uToonBands.z, uToonBands.x + uToonBands.z, tL);
          float tLit = smoothstep(uToonBands.y - uToonBands.z, uToonBands.y + uToonBands.z, tL);
          vec3 tBand = mix(mix(uToonShade, uToonMid, tOut), uToonLit, tLit);
          outgoingLight = tA * tBand + totalEmissiveRadiance;
        }
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => `${prevKey}|look-toon`;
    m.needsUpdate = true;
  }

  _flattenRoad() {
    const road = this.world.road;
    if (!road || road.userData.lookFlat) return;
    road.userData.lookFlat = true;
    const r = this.def.road;
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = r.base; ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = r.edge; ctx.fillRect(8, 0, 4, 512); ctx.fillRect(244, 0, 4, 512);
    ctx.fillStyle = r.centre; ctx.fillRect(123, 0, 3, 512); ctx.fillRect(130, 0, 3, 512);
    for (const mesh of road.isMesh ? [road] : road.children) {
      const m = mesh.material;
      if (!m?.map) continue;
      const tex = new THREE.CanvasTexture(c);
      Object.assign(tex, { wrapS: m.map.wrapS, wrapT: m.map.wrapT, colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
      m.map.dispose(); m.map = tex;
      m.bumpMap?.dispose(); m.bumpMap = null;
      m.needsUpdate = true;
    }
  }

  render(renderer, scene, camera) { this.outline.render(renderer, scene, camera); }

  dispose() { this.outline.dispose(); }
}

/** Full-screen ink outlines from depth: one extra pass over a multisampled scene target. */
class OutlinePass {
  constructor(renderer, opts) {
    this.opts = opts;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.target.depthTexture.type = THREE.FloatType;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture }, tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2() }, uLogFar: { value: 1 },
        uPx: { value: opts.px }, uStrength: { value: opts.strength }, uThresh: { value: opts.thresh }, uFade: { value: opts.fadeM },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel;
        uniform float uLogFar, uPx, uStrength, uThresh, uFade;
        varying vec2 vUv;
        // the scene uses a logarithmic depth buffer: depth = log2(1 + w) / log2(far + 1)
        float viewZ(vec2 uv) { return exp2(texture2D(tDepth, uv).x * uLogFar) - 1.; }
        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          float z = viewZ(vUv);
          vec2 o = uTexel * uPx;
          float zl = viewZ(vUv - vec2(o.x, 0.)), zr = viewZ(vUv + vec2(o.x, 0.));
          float zd = viewZ(vUv - vec2(0., o.y)), zu = viewZ(vUv + vec2(0., o.y));
          float zMin = min(z, min(min(zl, zr), min(zd, zu)));
          // a silhouette: a neighbour at a very different distance, relative to the nearer one
          // (both sides of the edge, so the line is about two samples wide)
          float jump = max(max(abs(z - zl), abs(z - zr)), max(abs(z - zd), abs(z - zu))) / max(zMin, .5);
          float edge = smoothstep(uThresh, uThresh * 2.2, jump);
          edge *= 1. - smoothstep(uFade * .55, uFade, zMin);       // ink only near the rider
          vec3 ink = mix(vec3(.035, .04, .06), col * .3, .4);   // near-black, a little of the local colour
          gl_FragColor = vec4(mix(col, ink, edge * uStrength), 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, this.material);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.size = new THREE.Vector2();
  }

  render(renderer, scene, camera) {
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    const u = this.material.uniforms;
    u.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    u.uLogFar.value = Math.log2(camera.far + 1);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);
  }

  dispose() { this.target.dispose(); this.target.depthTexture.dispose(); this.material.dispose(); this.quad.geometry.dispose(); }
}
