// Cartoon look (lean cartoon style guide, 16 Nov 2026; direction chosen: gentle, midday).
// Lays the cartoon look over the scenery at run time. A scene opts in with "look": "gentle" (Route 28);
// ?look=gentle|bold|none in the preview and :gentle / :bold / :current in snap override it. No batching
// or baked light yet: the live sun and shadow map still decide which band a surface falls in.
//   - toon shading: three colour bands (lit, mid, shadow) on every lit scenery material, with cool
//     shadows and warm light, in place of smooth PBR shading
//   - a colour grade (saturation, value) on the albedo
//   - smooth crowns and rocks (the kit is built with { smooth: true })
//   - a flat road: clean grey, crisp paint, no grain or bump
//   - ink outlines where depth jumps, fading with distance (drawn in post.js's final pass)
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
    if (m.userData.keepShading) return;   // the semi-realistic rider keeps its own shading
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

  /** Outline settings for post.js (setInk). */
  get ink() { return this.def.outline; }
}
