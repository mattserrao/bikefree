// A sky for the graph worlds (CNY, SKAN, Pittsburgh): a dome that follows the camera, its colour running from the
// fog's at the horizon (so the land fades into it without a seam) up to a deeper blue overhead; a glow round the sun;
// and a layer of soft fair-weather cumulus painted in the shader (fbm on a plane at cloud height), drifting slowly
// on the breeze and lit warm on their sun side. One draw call, no textures. (User, 24 Nov: Zwift parity, item 2 —
// "the sky is one flat colour".)
import * as THREE from '../../../../vendor/three.module.min.js';
import { NOISE_GLSL } from '../materials/glsl-noise.js';   // [blocks] shared GLSL

/** The sky's colours, for things that reflect it (the canal): the horizon's and overhead (linear), the sun's. */
export const SKY_REFLECT = { horizon: { value: new THREE.Color('#cfdde8') }, zenith: { value: new THREE.Color('#5d8fd0') }, sun: { value: new THREE.Color('#ffffff') }, sunDir: { value: new THREE.Vector3(0, 1, 0) } };
export function makeSkyDome({ radius = 8000 } = {}) {
  const uniforms = {
    uZenith: { value: new THREE.Color('#5d8fd0') },
    uHorizon: { value: new THREE.Color('#cfdde8') },
    uSunCol: { value: new THREE.Color('#ffffff') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
    uCloud: { value: .5 },     // cloud cover 0–1
    uNight: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,   // (as the flat background was: not tone-mapped)
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        gl_Position = p.xyww;   // (on the far plane: behind everything)
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith, uHorizon, uSunCol, uSunDir; uniform float uTime, uCloud, uNight;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.);
        // the gradient: the haze at the horizon, the deep blue higher up (a quick rise, then gentle)
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0., .55, up), .7));
        col = mix(col, uHorizon * .9, smoothstep(0., -.08, d.y));   // (below the horizon: the haze, a shade darker)
        // the sun: a bright disc, a tight glow and a broad warm one
        float s = max(dot(d, uSunDir), 0.);
        col += uSunCol * (pow(s, 900.) * 6. + pow(s, 64.) * .35 + pow(s, 6.) * .18) * (1. - uNight * .9);
        // clouds: fair-weather cumulus on a plane ~1.5 km up, seen from beneath; thinning to the horizon
        if (d.y > .015) {
          vec2 q = d.xz / (d.y + .05) * 1.6 + uTime * vec2(.006, .0025);
          float n = fbm(q * .9), detail = fbm(q * 3.1 + 5.);
          float cov = smoothstep(1. - uCloud * .75, 1.05 - uCloud * .55, n + detail * .22);
          cov *= smoothstep(.015, .16, d.y);
          // lit: brighter and warm toward the sun, grey-blue on their shaded bellies
          float lit = .55 + .45 * smoothstep(.35, .75, detail) ;
          vec3 cc = mix(mix(uHorizon, vec3(.62, .66, .74), .5), vec3(1.), lit) * (1. + uSunCol * pow(s, 8.) * .45);
          cc = mix(cc, cc * vec3(.35, .38, .5), uNight);
          col = mix(col, cc, cov * .92);
        }
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  // centred on whichever camera draws it (the world's, a snapshot's)
  mesh.onBeforeRender = (r, sc, cam) => { mesh.position.copy(cam.position); mesh.updateMatrixWorld(); };
  mesh.name = 'Sky'; mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.userData.bake = false;
  return {
    mesh,
    /** A time of day's colours: { sky, fog, sun, night } and the sun's direction. */
    set(t, sunDir, cloud = .5) {
      uniforms.uHorizon.value.set(t.fog);
      // overhead: the time's sky colour, deepened (the old flat colour sat between the two)
      uniforms.uZenith.value.set(t.sky).multiplyScalar(t.night ? .8 : .82);
      uniforms.uSunCol.value.set(t.sun);
      uniforms.uSunDir.value.copy(sunDir);
      uniforms.uNight.value = t.night ? 1 : 0;
      uniforms.uCloud.value = cloud;
      SKY_REFLECT.horizon.value.copy(uniforms.uHorizon.value); SKY_REFLECT.zenith.value.copy(uniforms.uZenith.value); SKY_REFLECT.sun.value.copy(uniforms.uSunCol.value); SKY_REFLECT.sunDir.value.copy(sunDir);
    },
    tick(cam, seconds) { uniforms.uTime.value = seconds; },
    dispose() { mesh.geometry.dispose(); material.dispose(); },
  };
}
