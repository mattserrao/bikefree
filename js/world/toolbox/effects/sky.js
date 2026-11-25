// The sky: a dome in place of the flat background colour — the zenith's blue down to the horizon's haze (the fog's
// colour, so distant land melts into it), a glow round the sun (warm, wide at golden hour), and a few clouds drifting
// across it, lit warm on the sun's side and cool-grey under. One draw call, drawn first, never fogged.
// Options: { clouds: 0.42 (cover), glow: 1, speed: 1 }.
import * as THREE from '../../../../vendor/three.module.min.js';
import { NOISE_GLSL } from '../materials/glsl-noise.js';   // [blocks] shared GLSL

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;   // (on the far plane: behind everything)
  }`;
const FRAG = /* glsl */`
  uniform vec3 uZenith, uHorizon, uSunCol, uSunDir;
  uniform float uTime, uCover, uGlow;
  varying vec3 vDir;
  ${NOISE_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    float el = max(d.y, 0.);
    // the gradient: haze at the horizon, the sky's blue overhead (a little deeper at the top)
    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0., .32, el), .55));
    col = mix(col, uZenith * .88, smoothstep(.5, 1., el));
    // the sun's glow: a wide warm halo along the horizon on its side, a tight bright one round the disc
    float sd = max(dot(d, uSunDir), 0.);
    col += uSunCol * uGlow * (pow(sd, 8.) * .16 * (1. - el) + pow(sd, 64.) * .45 + pow(sd, 900.) * 2.5);
    // clouds: a layer seen from below (its texture spread with distance), fading into the haze at the horizon
    if (d.y > .015) {
      vec2 uv = d.xz / (d.y + .08) * 1.6 + vec2(uTime * .004, uTime * .0015);
      float n = fbm(uv * .9) * .75 + fbm(uv * 3.1 + 5.) * .25;
      float c = smoothstep(1. - uCover - .1, 1. - uCover + .22, n) * smoothstep(.015, .16, d.y);
      // lit: warm where they face the sun, a lavender-grey shade beneath; their edges catch the light
      float lit = .45 + .55 * pow(sd, 2.);
      vec3 cc = mix(vec3(.62, .6, .68), mix(vec3(1.), uSunCol, .45), lit) * (.85 + .3 * (n - .5));
      cc += uSunCol * pow(sd, 10.) * (1. - c) * .6;
      col = mix(col, cc, c * .92);
    }
    // below the horizon (seen past the land's edge): the haze
    col = mix(col, uHorizon, smoothstep(0., -.05, d.y));
    gl_FragColor = vec4(col, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export const sky = {
  install(world, opts = {}) {
    const U = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uCover: { value: opts.clouds ?? 0.42 }, uGlow: { value: opts.glow ?? 1 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    dome.name = 'Sky dome'; dome.frustumCulled = false; dome.renderOrder = -10; dome.userData.bake = false;
    // (it follows whichever camera draws it, before it draws)
    dome.onBeforeRender = (r, sc, cam) => { dome.position.copy(cam.position); dome.updateMatrixWorld(); };
    world.scene.add(dome);
    const speed = opts.speed ?? 1;
    return {
      tick(t) {
        U.uTime.value = t * speed;
        const bg = world.scene.background;
        if (bg?.isColor) U.uZenith.value.copy(bg);
        if (world.scene.fog) U.uHorizon.value.copy(world.scene.fog.color);
        if (world.sunDir) U.uSunDir.value.copy(world.sunDir);
        if (world.sun) U.uSunCol.value.copy(world.sun.color);
      },
      dispose() { world.scene.remove(dome); dome.geometry.dispose(); mat.dispose(); },
    };
  },
};
