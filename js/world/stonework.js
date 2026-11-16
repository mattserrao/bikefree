// Stonework: procedural rubble masonry for walls, parapets and portals, drawn from world position so it
// never stretches, whatever the size of the box it's on, and stays continuous from one segment to the next.
// Courses of irregular stones in a mix of local colours, light mortar joints, stones darkened at their
// edges so they read rounded, weather streaks down from the top, and moss low down. Every detail fades
// to its average once a stone is a few pixels, so walls don't shimmer far off.
//
//   makeMasonryMaterial({ stones: ['#8a8276', …], mortar: '#a39d90', courseM: .2, moss: '#55603f' })
//   makeParapetGeometry()  → a unit parapet (x across −.5….5, y 0…1, z 0…1): battered sides, a rounded cap
import * as THREE from '../../vendor/three.module.min.js';

const lin = (hex) => new THREE.Color(hex);

export function makeMasonryMaterial(opts = {}) {
  const stones = (opts.stones || ['#8a8276', '#7d766c', '#91877a', '#8d6a5c', '#6f7b68', '#7b7266']).slice(0, 6);
  while (stones.length < 6) stones.push(stones[stones.length % stones.length]);
  const material = new THREE.MeshStandardMaterial({ roughness: .95, metalness: 0 });
  const uniforms = {
    msStones: { value: stones.map(lin) },
    msMortar: { value: lin(opts.mortar || '#a39d90') },
    msMoss: { value: lin(opts.moss || '#56613f') },
    msCourse: { value: opts.courseM || .2 },
    msMossH: { value: opts.mossM ?? .9 },   // moss and damp up to this far above the wall's foot (0 = none)
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMsP; varying vec3 vMsN; varying float vMsFoot;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec4 msP = vec4(transformed, 1.);
          mat3 msM = mat3(modelMatrix);
          vec3 msN = objectNormal;
          #ifdef USE_INSTANCING
            msP = instanceMatrix * msP; msN = mat3(instanceMatrix) * msN;
            vMsFoot = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).y;   // the instance's foot
          #else
            vMsFoot = -1e5;
          #endif
          vMsP = (modelMatrix * msP).xyz;
          vMsN = normalize(msM * msN);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMsP; varying vec3 vMsN; varying float vMsFoot;
        uniform vec3 msStones[6]; uniform vec3 msMortar; uniform vec3 msMoss; uniform float msCourse; uniform float msMossH;
        float msHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float msNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(msHash(i), msHash(i + vec2(1., 0.)), f.x), mix(msHash(i + vec2(0., 1.)), msHash(i + 1.), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vMsN);
          bool top = abs(n.y) > .7;
          // face coordinates in metres: along the face and up it (or across a top)
          vec2 t = normalize(vec2(-n.z, n.x) + 1e-5);
          vec2 uv = top ? vMsP.xz * vec2(1., 1.6) : vec2(dot(vMsP.xz, t), vMsP.y);
          float H = top ? msCourse * 1.8 : msCourse;
          // rubble, not brick: wavy courses, stones of very different lengths, and every other stone
          // split or raised so the courses don't run straight through
          float v = uv.y / H + (msNoise(vec2(uv.x * 1.3, floor(uv.y / H))) - .5) * .6;
          float row = floor(v), fv = fract(v);
          float L = H * (1.2 + msHash(vec2(row, 3.1)) * 1.3);
          float u0 = (uv.x + msHash(vec2(row, 7.7)) * L) / L;
          float id = floor(u0);
          float u = u0 + (msNoise(vec2(fv * 2., id)) - .5) * .35;        // ragged vertical joints
          id = floor(u); float fu = fract(u);
          if (msHash(vec2(id, row) + 5.5) < .3) { fv = fract(v * 2.); }  // two small stones stacked

          // distance to the stone's edge in metres (rounded corners), mortar in the joints
          float eu = min(fu, 1. - fu) * L, ev = min(fv, 1. - fv) * H;
          float edge = min(eu, ev);
          float px = length(fwidth(uv)) + 1e-4;
          float joint = 1. - smoothstep(.018, .018 + px, edge);
          float k = msHash(vec2(id, row) + 11.3);
          int ci = int(k * 5.999);
          vec3 stone = msStones[0];
          for (int i = 1; i < 6; i++) if (i == ci) stone = msStones[i];
          stone *= .84 + msHash(vec2(id, row) + 2.7) * .28;
          stone *= .78 + .22 * smoothstep(0., .05, edge);                // rounded: darker toward the joints
          float small = 1. - smoothstep(.12 * H, .35 * H, px);               // stones still several pixels wide?
          vec3 avg = mix((msStones[0] + msStones[1] + msStones[2] + msStones[3] + msStones[4] + msStones[5]) / 6., msMortar, .25);
          vec3 c = mix(avg, mix(stone, msMortar, joint), small);
          // weather streaks down the faces, moss and damp toward the foot
          float streak = msNoise(vec2(uv.x * 2.3, vMsP.y * .4));
          if (!top) c *= .9 + streak * .14;
          float foot = vMsP.y - vMsFoot;
          if (msMossH > 0. && !top) c = mix(c, msMoss * (.8 + streak * .3), (1. - smoothstep(0., msMossH, foot)) * smoothstep(.45, .65, msNoise(uv * 1.3)) * .7);
          diffuseColor.rgb *= c;   // instance colours are near-white tints
        }`);
  };
  material.customProgramCacheKey = () => 'bf-masonry-1';
  return material;
}

/**
 * A unit parapet: battered sides, a rounded coping and closed ends, x across (−.5….5), y up (0…1), z along
 * (0…1). Instanced with scale (width, height, length), so the cap's roundness follows the wall's size.
 */
export function makeParapetGeometry() {
  // profile across the wall, foot to cap (x, y), mirrored
  const half = [[.5, 0], [.46, .7], [.36, .92], [0, 1]];
  const prof = [...half.map(([x, y]) => [x, y]), ...half.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
  const pos = [], idx = [];
  for (const z of [0, 1]) for (const [x, y] of prof) pos.push(x, y, z);
  const P = prof.length;
  for (let i = 0; i < P - 1; i++) { const a = i, b = i + 1, c = P + i, d = P + i + 1; idx.push(a, b, c, b, d, c); }
  // end caps (a fan from the middle of the foot)
  const cap = (z, flip) => {
    const base = pos.length / 3;
    pos.push(0, 0, z);
    for (const [x, y] of prof) pos.push(x, y, z);
    for (let i = 0; i < P - 1; i++) flip ? idx.push(base, base + 2 + i, base + 1 + i) : idx.push(base, base + 1 + i, base + 2 + i);
  };
  cap(0, true); cap(1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed(); flat.computeVertexNormals(); flat.computeBoundingSphere();
  g.dispose();
  return flat;
}
