// Opt-in, world-space materials for kit authors. Existing scene/kit defaults are never replaced.
// Ground patterns project on xz; walls use a dominant-axis projection; bark follows world height.
import * as THREE from '../../../../vendor/three.module.min.js';

const preset = (name, family, kind, color, scaleM, roughness, description, axis = 'face') => Object.freeze({
  name, family, kind, color, scaleM, roughness, description, axis,
  module: 'materials/surface-library.js', consumer: 'makeToolboxSurface(id, options)',
});
export const SURFACE_LIBRARY = Object.freeze({
  'limewash-aged': preset('Aged limewash', 'buildings', 1, '#d9c7a6', .8, .98, 'Soft mineral wash with restrained chalky variation.'),
  'stucco-warm': preset('Warm stucco', 'buildings', 1, '#c19f7b', .28, .98, 'Fine-grained warm plaster for village walls.'),
  'sandstone-courses': preset('Sandstone courses', 'masonry', 2, '#b7a080', .32, .94, 'Warm dressed stone with alternating courses and pale mortar.'),
  'granite-blocks': preset('Granite blocks', 'masonry', 2, '#959a97', .48, .93, 'Cool varied ashlar with flecked stone faces.'),
  'timber-weathered': preset('Weathered timber', 'buildings', 3, '#8d8170', .18, .97, 'Vertical boards with longitudinal grain and faded edges.'),
  'soil-forest': preset('Forest litter', 'terrain', 4, '#62583e', .06, 1, 'Dark humus with small warm leaf fragments and scattered mineral grit.', 'ground'),
  'sand-rippled': preset('Rippled sand', 'terrain', 5, '#c1ad82', .22, .98, 'Gently wandering sand ripples with fine grains.', 'ground'),
  'meadow-turf': preset('Meadow turf', 'terrain', 6, '#79814f', .07, .99, 'Muted grass with directional blade marks and patches of dry growth.', 'ground'),
  'bark-birch': preset('Birch bark', 'vegetation', 7, '#d7d5c6', .16, .96, 'Pale bark with broken horizontal lenticels and occasional dark scars.'),
  'bark-oak': preset('Oak bark', 'vegetation', 8, '#756b59', .12, .99, 'Rough longitudinal fissures with irregular cross breaks.'),
  'metal-galvanized': preset('Galvanized metal', 'details', 9, '#a1adae', .055, .62, 'Subtle zinc spangle for poles, rails and utility furniture.'),
  'paint-weathered': preset('Weathered paint', 'details', 10, '#708e88', .12, .88, 'Faded painted metal with sparse exposed rust and small chips.'),
});

export function toolboxSurfaceSpec(id, options = {}) {
  const p = Object.hasOwn(SURFACE_LIBRARY, id) ? SURFACE_LIBRARY[id] : null;
  if (!p) throw new RangeError(`Unknown toolbox surface "${id}". Available: ${Object.keys(SURFACE_LIBRARY).join(', ')}`);
  const scale = options.scale ?? 1, seed = options.seed ?? 1, variation = options.variation ?? .65;
  if (!Number.isFinite(scale) || scale < .25 || scale > 4) throw new RangeError('surface scale must be .25…4');
  if (!Number.isInteger(seed) || seed < 0 || seed > 65535) throw new RangeError('surface seed must be an integer in 0…65535');
  if (!Number.isFinite(variation) || variation < 0 || variation > 1) throw new RangeError('surface variation must be 0…1');
  if (options.color !== undefined && !/^#[0-9a-f]{6}$/i.test(options.color)) throw new RangeError('surface color must be #rrggbb');
  return { ...p, scale, seed, variation, color: options.color ?? p.color };
}

const GLSL = /* glsl */`
  varying vec3 vTsP; varying vec3 vTsN;
  uniform vec4 tsParams; uniform vec3 tsColor; uniform float tsGround;
  float tsH(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float tsN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(tsH(i),tsH(i+vec2(1,0)),f.x),mix(tsH(i+vec2(0,1)),tsH(i+1.),f.x),f.y); }
  vec3 tsSurface(vec2 metres, float pixelM) {
    float kind = tsParams.x, scale = tsParams.y, seed = tsParams.z, variation = tsParams.w;
    vec2 p = metres / scale, offset = vec2(mod(seed,251.),floor(seed/251.))*5.31, q = p+offset;
    float px = pixelM / scale;
    float broad = tsN(q*.55), fine = 1.-smoothstep(.003,.025,px);
    vec3 c = tsColor * (1.+(broad-.5)*.26*variation);
    if (kind < 1.5) {
      c *= 1.+(tsN(q*31.)-.5)*.1*fine;
      c = mix(c,tsColor*1.08,smoothstep(.6,.82,tsN(q*2.))*variation*.35);
    } else if (kind < 2.5) {
      float row = floor(p.y), u = p.x/1.65+mod(row,2.)*.5;
      float tone = tsH(vec2(floor(u),row)+offset);
      vec2 f = vec2(fract(u)*1.65,fract(p.y));
      float edge = min(min(f.x,1.65-f.x),min(f.y,1.-f.y));
      float joint = 1.-smoothstep(.018,.04+px,edge);
      float det = 1.-smoothstep(.1,.7,px);
      c *= 1.+(tone-.5)*.35*variation*det;
      c *= 1.+(tsN(q*50.)-.5)*.18*fine;
      c = mix(c,tsColor*1.19,joint*.65*det);
      c *= 1.-(1.-smoothstep(.03,.1,edge))*.12*det;
    } else if (kind < 3.5) {
      float board = floor(p.x), f = fract(p.x), tone = tsH(vec2(board,seed));
      float det = 1.-smoothstep(.08,.8,px);
      float edge = min(f,1.-f);
      c *= 1.+(tone-.5)*.3*variation*det;
      float grain = tsN(vec2(q.x*16.+sin(q.y*.4),q.y*.8));
      c *= 1.+(grain-.5)*.23*det;
      c *= 1.-(1.-smoothstep(.01,.035+px,edge))*.52*det;
    } else if (kind < 4.5) {
      float det = 1.-smoothstep(.25,1.2,px);
      vec2 cell = floor(q), f = fract(q);
      float h = tsH(cell), angle = h*6.28;
      vec2 a = mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*(f-.5);
      float leaf = (1.-smoothstep(.2,.32,abs(a.x)))*(1.-smoothstep(.09,.16,abs(a.y)))*step(.55,h)*det;
      c = mix(c,tsColor*vec3(1.6,1.2,.7),leaf*.55*variation);
      c *= 1.+(tsN(q*4.)-.5)*.2*det;
    } else if (kind < 5.5) {
      float ripple = sin(p.y*6.283+tsN(vec2(q.x*.18,q.y*.06))*2.);
      float det = 1.-smoothstep(.15,.9,px);
      c *= 1.+ripple*.09*det;
      c *= 1.+(tsN(q*70.)-.5)*.1*fine;
    } else if (kind < 6.5) {
      float det = 1.-smoothstep(.12,.8,px);
      float blade = smoothstep(.68,.84,tsN(vec2(q.x*3.,q.y*.35)));
      c = mix(c,tsColor*vec3(1.18,1.1,.77),blade*variation*.65*det);
      c *= 1.+(tsN(q*vec2(8.,2.))-.5)*.22*det;
    } else if (kind < 7.5) {
      vec2 cell = floor(vec2(p.x*.8,p.y*2.));
      float h = tsH(cell+offset), y = fract(p.y*2.);
      float scar = (1.-smoothstep(.025,.08+px,abs(y-.5)))*smoothstep(.4,.52,tsN(vec2(p.x*4.,cell.y)+offset));
      float det = 1.-smoothstep(.18,.9,px);
      c = mix(c,tsColor*vec3(.22,.23,.22),scar*det);
      c *= 1.-smoothstep(.88,.97,h)*.25*det;
    } else if (kind < 8.5) {
      float grain = tsN(vec2(q.x*2.+tsN(q*.4)*.5,q.y*.18));
      float det = 1.-smoothstep(.1,.7,px);
      float fissure = smoothstep(.56,.7,grain);
      c *= 1.-fissure*.48*det;
      c *= 1.+(tsN(q*vec2(8.,2.))-.5)*.2*det;
    } else if (kind < 9.5) {
      vec2 cell = floor(q); float det = 1.-smoothstep(.25,1.2,px);
      c *= 1.+(tsH(cell)-.5)*.2*variation*det;
      c *= 1.+(tsN(q*3.)-.5)*.1*det;
    } else {
      float det = 1.-smoothstep(.1,.8,px);
      float chip = smoothstep(.73,.85,tsN(q*2.)*.65+tsN(q*7.)*.35);
      c = mix(c,vec3(.17,.075,.035),chip*variation*det);
      c *= 1.+(tsN(q*vec2(.3,2.))-.5)*.18*variation;
    }
    return c;
  }
`;

/** Standalone factory: opt in per mesh; no external images, UVs or geometry attributes required.
 * Apply to static, unskinned kit meshes. Metre projection follows world axes; translate geometry into place
 * before rendering. Not a replacement for facade windows/doors, tree wind, or animated water shaders. */
export function makeToolboxSurface(id, options = {}) {
  const spec = toolboxSurfaceSpec(id, options);
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: spec.roughness,
    metalness: spec.family === 'details' ? .25 : 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tsParams: { value: new THREE.Vector4(spec.kind,spec.scaleM*spec.scale,spec.seed,spec.variation) },
      tsColor: { value: new THREE.Color(spec.color) }, tsGround: { value: spec.axis === 'ground' ? 1 : 0 },
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTsP; varying vec3 vTsN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 tsWorld = vec4(transformed,1.); vec3 tsNormal = objectNormal;
        #ifdef USE_INSTANCING
          tsWorld = instanceMatrix * tsWorld; tsNormal = mat3(instanceMatrix) * tsNormal;
        #endif
        vTsP = (modelMatrix * tsWorld).xyz; vTsN = normalize(mat3(modelMatrix) * tsNormal);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n'+GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tsNrm = abs(normalize(vTsN));
        vec2 tsUV = tsGround > .5 || tsNrm.y > .7 ? vTsP.xz : tsNrm.x > tsNrm.z ? vTsP.zy : vTsP.xy;
        float tsPx = max(length(dFdx(tsUV)),length(dFdy(tsUV)))+1e-5;
        diffuseColor.rgb *= tsSurface(tsUV,tsPx);`);
  };
  material.customProgramCacheKey = () => 'toolbox-surface-1'; // presets share source; only their uniforms differ
  material.userData.toolboxSurface = { id, ...spec };
  return material;
}
