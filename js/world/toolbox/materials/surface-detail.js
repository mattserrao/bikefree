// The scenery's surface detail texture (user, 24 Nov — Zwift parity, item 4: "allow small textures"): one 512 px
// RGBA tile, textures/surface-detail.png (tools/make_surface_textures.py), each channel a grey detail map around 0.5 —
// R asphalt aggregate, G gravel and stone dust, B grass turf, A clapboard siding. The road, path and ground shaders
// multiply their own colour by it near the camera (the palettes stay) and light its slopes from the sun, so the
// surfaces catch the light. A blank (no effect) until the image has loaded; on Light it's never loaded.
import * as THREE from '../../../../vendor/three.module.min.js';

const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, THREE.RGBAFormat); blank.needsUpdate = true;
/** The detail texture (shared uniform) and the sun's direction for its relief (set by the world). */
export const SURFACE = { value: blank };
export const SURFACE_SUN = { value: new THREE.Vector3(.3, .8, .2) };
let loading = false;
/** Load the tile (once), with mipmaps and some anisotropy so it doesn't swim at a glancing angle. */
export function loadSurfaceDetail(renderer) {
  if (loading) return; loading = true;
  new THREE.TextureLoader().load(new URL('../../../../textures/surface-detail.png', import.meta.url).href, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
    SURFACE.value = t;
  });
}

/**
 * GLSL: surfaceDetail(world xz, channel 0–3, tile size m, sun xz, camera distance) → a colour factor around 1:
 * the channel × 2, its relief lit from the sun, faded out by 110 m (its mipmaps would only be mush there).
 */
export const SURFACE_GLSL = /* glsl */`
  uniform sampler2D uSurf; uniform vec3 uSurfSun;
  float sdCh(vec4 t, int ch) { return ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a; }
  float surfaceDetail(vec2 xz, int ch, float tile, float dist, float k) {
    float f = (1. - smoothstep(40., 140., dist)) * k;
    if (f <= 0.) return 1.;
    vec2 uv = xz / tile, e = vec2(1.5 / 512., 0.);
    float h = sdCh(texture2D(uSurf, uv), ch), hx = sdCh(texture2D(uSurf, uv + e.xy), ch), hz = sdCh(texture2D(uSurf, uv + e.yx), ch);
    float relief = clamp(1. + ((h - hx) * uSurfSun.x + (h - hz) * uSurfSun.z) * 3.5, .75, 1.25);
    return mix(1., (.3 + h * 1.4) * relief, f);
  }`;

/**
 * Patch a vertex-coloured lit material with the surface texture (chaining any onBeforeCompile it has): turf where the
 * colour's green, grit and gravel where it isn't. For verges, ditches, shoulders and banks.
 */
export function withSurfaceDetail(m, key = 'sd') {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.() || '';
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uSurf = SURFACE; shader.uniforms.uSurfSun = SURFACE_SUN;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;\n' + SURFACE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { bool green = diffuseColor.g > diffuseColor.r * 1.12 && diffuseColor.g > diffuseColor.b * 1.3;
          diffuseColor.rgb *= surfaceDetail(vSW.xz + vSW.y * .7, green ? 2 : 1, 3., length(vSW - cameraPosition), green ? .85 : .7); }`);
  };
  m.customProgramCacheKey = () => `${prevKey}|${key}-surf1`;
  return m;
}
