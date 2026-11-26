// One wind for everything that sways (fidelity plan step 6, "a unified wind field"): the trees' models, the tree
// cards and the verge's grass cards all lean the same way at the same moment — gust fronts rolling downwind across
// the world (~6 m/s, each a few tens of metres deep, wavering across), a light steady push between them — instead of
// each kind on its own sines. Shared uniforms (set once by the world: setWind) and one GLSL function.
//
//   import { WIND, WIND_GLSL, setWind } from '…/atmosphere/wind.js';
//   shader.uniforms.uWindDir = WIND.uWindDir; shader.uniforms.uWindK = WIND.uWindK;   then in GLSL: bfWind(p.xz, uTime)
import * as THREE from '../../../../vendor/three.js';

export const WIND = { uWindDir: { value: new THREE.Vector2(.8, .6) }, uWindK: { value: 1 } };

/** The wind's direction (toward which it blows, x/z) and strength (0 calm … 1 a breezy afternoon … 2 gusty). */
export function setWind(dir = [.8, .6], k = 1) { WIND.uWindDir.value.set(dir[0], dir[1]).normalize(); WIND.uWindK.value = k; }

export const WIND_GLSL = /* glsl */`
  uniform vec2 uWindDir; uniform float uWindK;
  // the push at p (world x, z) at time t: along the wind, 0.35 between the gusts, up to 1 in one
  vec2 bfWind(vec2 p, float t) {
    float along = dot(p, uWindDir), across = dot(p, vec2(-uWindDir.y, uWindDir.x));
    float front = .5 + .5 * sin(along * .05 - t * .3 + sin(across * .013 + t * .05) * 2.);
    return uWindDir * (.35 + .65 * front * front * front) * uWindK;
  }`;
