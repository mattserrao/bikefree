// Toolbox materials: the night glow, the one copy. A lit material's lamps, windows, lenses and signs come up after
// dark: the host's night uniform (0 by day … 1 at night) as `uNight`, and an emissive term added after three's
// emissive map. [review 27 Nov] Was pasted ~15× (city, glasshouse, heroes, landmarks, coast life, street kit, city
// life, cars, vehicles); promoted from glasshouse.js's nightGlow onto patchShader, so a moved anchor throws.
import { patchShader } from '../core/shader-patch.js';

/**
 * In an onBeforeCompile: binds uNight to `night` (a uniform, or a function giving it at compile time) and adds `glsl` after <emissivemap_fragment>: a vec3 expression
 * (added to totalEmissiveRadiance) or, when it names totalEmissiveRadiance itself, statements put there as they are.
 * opts: { glow: 'float' | 'vec3' (an aGlow vertex attribute, passed to the fragment as vGlow), decl: more fragment
 * declarations (after uNight's) }. Returns the shader.
 */
export function nightGlowShader(shader, night, glsl, { glow = null, decl = '' } = {}) {
  shader.uniforms.uNight = typeof night === 'function' ? night() : night;
  if (glow) {
    shader.vertexShader = patchShader(shader.vertexShader, '#include <common>', `attribute ${glow} aGlow; varying ${glow} vGlow;`);
    shader.vertexShader = patchShader(shader.vertexShader, '#include <begin_vertex>', 'vGlow = aGlow;');
  }
  shader.fragmentShader = patchShader(shader.fragmentShader, '#include <common>', `uniform float uNight;${glow ? ` varying ${glow} vGlow;` : ''}${decl ? `\n${decl}` : ''}`);
  shader.fragmentShader = patchShader(shader.fragmentShader, '#include <emissivemap_fragment>', /totalEmissiveRadiance/.test(glsl) ? glsl : `totalEmissiveRadiance += ${glsl};`);
  return shader;
}

/**
 * material with the night glow chained after its own onBeforeCompile, and `key` as its program cache key (each site
 * keeps its own: two materials with one key would share a program). opts: nightGlowShader's, plus uniforms (more to
 * bind) and patch(shader) (the site's own patching, run before the glow's). Returns the material.
 */
export function withNightGlow(material, night, glsl, key, { uniforms = null, patch = null, ...opts } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    if (uniforms) Object.assign(shader.uniforms, uniforms);
    patch?.(shader, renderer);
    nightGlowShader(shader, night, glsl, opts);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
