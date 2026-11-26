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
      // [reflections] the scene mirrored in the water (High and Ultra on laptops and desktops): tReflect, its projective
      // matrix, on (0/1)
      tReflect: { value: null }, uReflectMat: { value: new THREE.Matrix4() }, uReflectOn: { value: 0 },
    };
    const R = planarReflection(world, m, U, opts);
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
uniform sampler2D tReflect; uniform mat4 uReflectMat; uniform float uReflectOn;
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
  vec3 mirrored = uSky;
  if (uReflectOn > .5) {
    // the mirrored scene, nudged by the ripples' slope (more up close), the sky where it shows nothing
    vec4 rc = uReflectMat * vec4(bfWaterP, 1.0);
    vec2 ruv = rc.xy / rc.w + N.xz * (0.018 * near + 0.004);
    vec4 rs = texture2D(tReflect, clamp(ruv, 0.002, 0.998));
    mirrored = rs.rgb;   // (the target is cleared to the sky's background: alpha-to-coverage leaves read as specks if blended by alpha)
  }
  outgoingLight = mix(outgoingLight, mirrored, fres * mix(uSkyMix, max(uSkyMix, 0.75), uReflectOn));
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
    m.customProgramCacheKey = () => `${prevKey}|bf-water-2`;
    m.needsUpdate = true;
    return {
      tick(t) {
        U.uTime.value = t;
        R?.tick();
        if (world.sunDir) U.uSunDir.value.copy(world.sunDir);
        if (world.sun) U.uSunCol.value.copy(world.sun.color).multiplyScalar(Math.min(1.4, world.sun.intensity * 0.5));
        // the sky it mirrors: the sky's own colour, a little toward the horizon's haze
        const bg = world.scene?.background;
        if (bg?.isColor) { U.uSky.value.copy(bg); if (world.scene.fog) U.uSky.value.lerp(world.scene.fog.color, 0.3); }
      },
      dispose() { R?.dispose(); m.onBeforeCompile = prev; m.customProgramCacheKey = () => prevKey; m.needsUpdate = true; },
    };
  },
};

/**
 * [reflections] (user, 26 Nov — Zwift Ultra reflects the world in water): a mirrored camera renders the scene, water
 * hidden and clipped at the surface, into a reduced target; the water samples it projectively. High and Ultra on
 * laptops and desktops: Ultra every frame at half size, High every other frame at a third. Off on phones and lower.
 */
function planarReflection(world, waterMat, U, opts) {
  const nav = globalThis.navigator, ua = nav?.userAgent || '';
  const mobile = /iPhone|iPad|iPod|Android|Mobile/.test(ua) || (/Macintosh/.test(ua) && nav?.maxTouchPoints > 1);
  const q = world.qualityKey;
  if (opts.reflect === false || mobile || !(q === 'high' || q === 'ultra') || !world.renderer) return null;
  const scale = q === 'ultra' ? .5 : .34, every = q === 'ultra' ? 1 : 2;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q === 'ultra' ? 4 : 2 });   // (MSAA: the trees' alpha-to-coverage edges resolve smooth)
  rt.texture.generateMipmaps = false;
  const cam = new THREE.PerspectiveCamera(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const P = new THREE.Vector3(), N = new THREE.Vector3(0, 1, 0), view = new THREE.Vector3(), target = new THREE.Vector3(),
    look = new THREE.Vector3(), rot = new THREE.Matrix4(), size = new THREE.Vector2();
  const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
  let frame = 0, waters = [], found = -1, clearCol = new THREE.Color();
  U.tReflect.value = rt.texture;
  const surfaceY = () => {
    // the water plane the camera is over or nearest (the river level, or a pool's)
    if (frame - found > 60) { found = frame; waters = []; world.scene.traverse((o) => { if (o.isMesh && o.material === waterMat) waters.push(o); }); }
    const c = world.camera.position; let best = null, bd = Infinity;
    for (const w of waters) {
      if (!w.visible) continue;
      w.geometry.boundingBox || w.geometry.computeBoundingBox();
      const b = w.geometry.boundingBox, wp = w.getWorldPosition(P);
      const dx = Math.max(0, wp.x + b.min.x - c.x, c.x - wp.x - b.max.x), dz = Math.max(0, wp.z + b.min.z - c.z, c.z - wp.z - b.max.z);
      // (a pool — a park lake — before the map-wide river plane under it: the big plane only where no pool is near)
      const big = (b.max.x - b.min.x) > 3000, y = wp.y + b.max.y, d = Math.hypot(dx, dz) + (y > c.y ? 1e6 : 0) + (big ? 400 : 0);
      if (d < bd) { bd = d; best = y; }
    }
    return bd < 900 ? best : null;
  };
  return {
    tick() {
      frame++;
      const r = world.renderer, camera = world.camera;
      if (!camera || frame % every) return;
      const y = surfaceY();
      if (y == null) { U.uReflectOn.value = 0; return; }
      r.getDrawingBufferSize(size);
      const w = Math.max(16, Math.round(size.x * scale)), h = Math.max(16, Math.round(size.y * scale));
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      // the mirrored camera (three's Reflector: the eye and its look-at point reflected in the plane)
      camera.updateMatrixWorld();
      const reflY = y;
      P.set(camera.position.x, reflY, camera.position.z);
      view.copy(P).sub(camera.position);
      if (view.dot(N) > 0) { U.uReflectOn.value = 0; return; }
      view.reflect(N).negate().add(P);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camera.position);
      target.copy(P).sub(look).reflect(N).negate().add(P);
      cam.position.copy(view);
      cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(N);
      cam.lookAt(target);
      cam.near = camera.near; cam.far = camera.far; cam.projectionMatrix.copy(camera.projectionMatrix); cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      U.uReflectMat.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      // draw: the water hidden, everything below the surface clipped, no shadow-map refresh
      plane.constant = -reflY + .02;
      const prevT = r.getRenderTarget(), prevClip = r.clippingPlanes, prevAuto = r.shadowMap.autoUpdate, prevVis = waterMat.visible;
      r.getClearColor(clearCol); const prevA = r.getClearAlpha();
      waterMat.visible = false; r.shadowMap.autoUpdate = false; r.clippingPlanes = [plane];
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear();
      r.render(world.scene, cam);
      r.setRenderTarget(prevT); r.clippingPlanes = prevClip; r.shadowMap.autoUpdate = prevAuto; waterMat.visible = prevVis;
      r.setClearColor(clearCol, prevA);
      U.uReflectOn.value = 1;
    },
    dispose() { rt.dispose(); U.tReflect.value = null; U.uReflectOn.value = 0; },
  };
}
