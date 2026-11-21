// Park surfaces: procedural ground materials drawn from world position (they never stretch, and run on from one
// patch to the next), for the dressed places of a free-ride graph (js/world/graph-world.js: Point State Park).
//
//   makeParkMaterial('lawn' | 'plaza' | 'granite' | 'walk' | 'garden' | 'wood' | 'scrub')
//
//   lawn     mown grass: two greens in broad mowing stripes, fine speckle, a little wear
//   plaza    concrete pavers, 0.6 m squares in a running bond, dark joints, each paver its own shade
//   granite  granite slabs (a riverfront promenade, a fountain's rim), 1.2 × 0.6 m, warm grey, flecked
//   walk     brushed concrete walkway, expansion joints every 1.5 m both ways
//   garden   mulched beds with low planting
//   wood     woodland floor: leaf litter and moss
//   scrub    rough grass and low brush
// Each detail fades to its average with distance, so far ground doesn't shimmer.
import * as THREE from '../../../../vendor/three.module.min.js';

const BASE = {
  lawn: ['#5f8f43', '#6e9d4c'], plaza: ['#b8b2a6', '#a9a397'], granite: ['#9b958a', '#8a847a'], walk: ['#c2bdb2', '#b5afa3'],
  garden: ['#5b4434', '#5e7a3c'], wood: ['#4d5a33', '#5c4b35'], scrub: ['#7a8a4c', '#6b7a43'],
};
const PATTERN = { lawn: 0, plaza: 1, granite: 2, walk: 3, garden: 4, wood: 5, scrub: 5 };

const GLSL = `
float pkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pkNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(pkHash(i), pkHash(i + vec2(1., 0.)), f.x), mix(pkHash(i + vec2(0., 1.)), pkHash(i + vec2(1., 1.)), f.x), f.y); }
// joints of a grid of w × h cells (rows offset by half a cell when bond = 1): 1 inside a cell, 0 on a joint
float pkJoint(vec2 p, vec2 size, float bond, float jw, out vec2 cell) {
  float row = floor(p.y / size.y);
  vec2 q = vec2(p.x / size.x + bond * .5 * mod(row, 2.), p.y / size.y);
  cell = floor(q);
  vec2 f = fract(q), e = min(f, 1. - f) * size;
  return smoothstep(0., jw, min(e.x, e.y));
}`;

export function makeParkMaterial(kind) {
  const [a, b] = BASE[kind] || BASE.lawn;
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const uniforms = { pkA: { value: new THREE.Color(a) }, pkB: { value: new THREE.Color(b) }, pkKind: { value: PATTERN[kind] ?? 0 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPkW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPkW = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPkW;\nuniform vec3 pkA; uniform vec3 pkB; uniform int pkKind;\n${GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 p = vPkW.xz;
        float far = clamp(length(vPkW - cameraPosition) / 140., 0., 1.);   // detail fades with distance
        float n = pkNoise(p * 1.7) * .6 + pkNoise(p * 7.3) * .4;
        vec3 c = mix(pkA, pkB, .5);
        vec2 cell;
        if (pkKind == 0) {          // lawn: mowing stripes + speckle + wear
          float stripe = step(.5, fract((p.x * .7 + p.y * .7) / 6.));
          c = mix(pkA, pkB, mix(stripe, .5, far * .7));
          c *= .92 + .16 * mix(n, .5, far);
          c = mix(c, vec3(.55, .5, .36), smoothstep(.78, .95, pkNoise(p * .35)) * .25);
        } else if (pkKind == 1) {   // concrete pavers
          float j = pkJoint(p, vec2(.6, .6), 1., .025, cell);
          c = mix(pkA, pkB, pkHash(cell)) * (.95 + .1 * n);
          c = mix(c * .62, c, mix(j, 1., far));
        } else if (pkKind == 2) {   // granite slabs
          float j = pkJoint(p, vec2(1.2, .6), 1., .02, cell);
          c = mix(pkA, pkB, pkHash(cell)) * (.9 + .2 * pkNoise(p * 23.));
          c = mix(c * .7, c, mix(j, 1., far));
        } else if (pkKind == 3) {   // concrete walkway
          float j = pkJoint(p, vec2(1.5, 1.5), 0., .015, cell);
          c = mix(pkA, pkB, pkHash(cell) * .5 + n * .5);
          c = mix(c * .75, c, mix(j, 1., far));
        } else if (pkKind == 4) {   // garden beds: mulch with clumps of planting
          float plant = smoothstep(.45, .6, pkNoise(p * .9));
          c = mix(pkA * (.85 + .3 * n), pkB * (.85 + .3 * n), plant);
        } else {                    // woodland floor / scrub
          c = mix(pkA, pkB, pkNoise(p * .5)) * (.85 + .3 * n);
        }
        diffuseColor.rgb *= c;
      }`);
  };
  material.customProgramCacheKey = () => `park-${kind}`;
  return material;
}
