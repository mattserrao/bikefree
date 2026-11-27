// [review 27 Nov] The graph world's road and ground materials as a fingerprint: for each variant, its onBeforeCompile
// run on THREE.ShaderLib's own source (a fake shader), then sha256 of the generated vertex and fragment source, the
// uniforms' names (and which are the shared objects), the cache key, the defines and the material's own settings.
// test/world-materials.test.mjs compares it to test/fixtures/graph-materials.snapshot.json, taken from the code as it
// was before the materials moved out of graph-world.js (W13): the move must not change a byte of any program.
import { createHash } from 'node:crypto';
import * as THREE from '../vendor/three.js';

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const renderer = { capabilities: { getMaxAnisotropy: () => 1, isWebGL2: true }, getContextAttributes: () => ({ antialias: true }), extensions: { has: () => true } };

function fingerprint(m, shared) {
  const lib = THREE.ShaderLib.standard;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms), defines: {} };
  m.onBeforeCompile?.(shader, renderer);
  const own = Object.keys(shader.uniforms).filter((k) => !(k in lib.uniforms));
  return {
    key: m.customProgramCacheKey?.() ?? '', defines: { ...(m.defines || {}) },
    vs: sha(shader.vertexShader), fs: sha(shader.fragmentShader), vsLen: shader.vertexShader.length, fsLen: shader.fragmentShader.length,
    uniforms: own.map((k) => `${k}${shared.has(shader.uniforms[k]) ? '*' : ''}`),
    mat: { type: m.type, side: m.side, vertexColors: m.vertexColors, polygonOffset: m.polygonOffset, pof: m.polygonOffsetFactor, pou: m.polygonOffsetUnits, roughness: m.roughness, env: m.envMapIntensity },
  };
}

/** F: { roadSurfaceMaterial, wornPaintMaterial, sideMaterial, groundMaterial }; shared: the module-level uniform objects. */
export function snapshotGraphMaterials(F, shared) {
  const S = new Set(shared), out = {};
  for (const low of [false, true]) for (const ny of [false, true]) for (const spill of [false, true]) {
    out[`road:${+low}${+ny}${+spill}`] = fingerprint(F.roadSurfaceMaterial(low, ny, spill), S);
    const m = F.roadSurfaceMaterial(low, ny, spill); m.defines.SHADERPAINT = ''; m.defines.PARKROAD = '';   // (toolbox/effects/road-look.js)
    out[`road+look:${+low}${+ny}${+spill}`] = fingerprint(m, S);
  }
  out.paintWorn = fingerprint(F.wornPaintMaterial(), S);
  for (const low of [false, true]) out[`side:${+low}`] = fingerprint(F.sideMaterial(low), S);
  for (const low of [false, true]) for (const rural of [false, true]) for (const soft of [false, true]) for (const desert of [false, true]) {
    out[`ground:${+low}${+rural}${+soft}${+desert}`] = fingerprint(F.groundMaterial(low, rural, soft, desert), S);
    const m = F.groundMaterial(low, rural, soft, desert); m.defines.LITTER = '';   // (toolbox/effects/leaf-litter.js)
    out[`ground+litter:${+low}${+rural}${+soft}${+desert}`] = fingerprint(m, S);
  }
  return out;
}
