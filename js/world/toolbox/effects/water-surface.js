// The lake surface: wind ripples (a few travelling wave trains, fading with distance so they never shimmer), the sky
// in the water at grazing angles (Fresnel) and the sun's glitter path — on the world's own water material, so every
// water plane (the main level and each pool) gets it. Options: { ripple: 1 (strength), glint: 1, sky: 0.4 (the most of the sky it shows, at grazing angles) }.
import * as THREE from '../../../../vendor/three.js';

export const waterSurface = {
  install(world, opts = {}) {
    const m = world.mats.water;
    const U = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color('#cfdde8') },
      uRipple: { value: opts.ripple ?? 1 },
      uGlint: { value: opts.glint ?? 1 },
      uSkyMix: { value: opts.sky ?? 0.4 },
    };
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey();
    m.onBeforeCompile = (shader, renderer) => {
      prev?.call(m, shader, renderer);
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 bfWaterP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nbfWaterP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 bfWaterP;
uniform float uTime, uRipple, uGlint, uSkyMix;
uniform vec3 uSunDir, uSunCol, uSky;
// a wave train's slope: amplitude a, wave number k (rad/m), along d, at speed c (m/s)
vec2 bfWave(vec2 p, vec2 d, float k, float a, float c) { return d * (a * k * cos(dot(p, d) * k - uTime * c * k)); }`)
        .replace('#include <opaque_fragment>', `{
  vec3 V = cameraPosition - bfWaterP; float dist = length(V); V /= dist;
  vec2 p = bfWaterP.xz;
  // the ripples: a long swell and three wind trains, their slopes summed; small ones fade first with distance
  float near = 1.0 / (1.0 + dist / 220.0), fine = 1.0 / (1.0 + dist / 70.0);
  vec2 g = bfWave(p, vec2(0.81, 0.59), 0.19, 0.045, 1.7) * near
         + bfWave(p, vec2(0.28, 0.96), 0.47, 0.026, 1.2) * near
         + bfWave(p, vec2(0.99, -0.12), 0.83, 0.016, 0.9) * near
         + bfWave(p, vec2(-0.56, 0.83), 1.37, 0.010, 0.7) * fine
         + bfWave(p, vec2(0.70, -0.71), 2.31, 0.006, 0.55) * fine
         + bfWave(p, vec2(-0.12, 0.99), 3.73, 0.004, 0.45) * fine;
  // cat's-paws: gusts that roughen patches of the lake and leave others glassy (breaks the trains' regular stripes)
  float gust = 0.55 + 0.45 * sin(p.x * 0.013 + uTime * 0.11 + sin(p.y * 0.017 - uTime * 0.07) * 2.3) * sin(p.y * 0.011 + p.x * 0.004 + uTime * 0.05);
  g *= gust;
  vec3 N = normalize(vec3(-g.x * uRipple, 1.0, -g.y * uRipple));
  float ndv = max(dot(N, V), 0.0), fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  outgoingLight = mix(outgoingLight, uSky, fres * uSkyMix);
  // the sun's glitter: a sharp highlight broken up by the ripples (wider and softer for a low sun)
  vec3 R = reflect(-V, N);
  float s = max(dot(R, uSunDir), 0.0);
  float sparkle = smoothstep(0.35, 1.0, sin(p.x * 3.1 + uTime * 2.3) * sin(p.y * 2.7 - uTime * 1.9) + 0.4 * sin(p.x * 7.3 - p.y * 5.9 + uTime * 3.1));
  float glint = pow(s, 600.0) * 9.0 * (0.25 + 1.5 * sparkle * fine + 0.3 * near) + pow(s, 60.0) * 0.07;
  outgoingLight += uSunCol * glint * uGlint;
  diffuseColor.a = mix(diffuseColor.a, 1.0, fres * 0.5);
}
#include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => `${prevKey}|bf-water-1`;
    m.needsUpdate = true;
    return {
      tick(t) {
        U.uTime.value = t;
        if (world.sunDir) U.uSunDir.value.copy(world.sunDir);
        if (world.sun) U.uSunCol.value.copy(world.sun.color).multiplyScalar(Math.min(1.4, world.sun.intensity * 0.5));
        // the sky it mirrors: the sky's own colour, a little toward the horizon's haze
        const bg = world.scene?.background;
        if (bg?.isColor) { U.uSky.value.copy(bg); if (world.scene.fog) U.uSky.value.lerp(world.scene.fog.color, 0.3); }
      },
      dispose() { m.onBeforeCompile = prev; m.customProgramCacheKey = () => prevKey; m.needsUpdate = true; },
    };
  },
};
