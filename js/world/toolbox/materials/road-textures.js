// Additive road/path library. Applied only when an explicitly selected ID is in this catalog.
// Units: pattern dimensions in metres; colours are sRGB converted to linear before reaching GLSL.
import * as THREE from '../../../../vendor/three.module.min.js';

const entry = (name, pattern, color, grainM, paint, description) => Object.freeze({ name, pattern, color, grainM, paint, description,
  family: 'road', consumers: ['road', 'road.trail', 'road.zones'], module: 'materials/road-textures.js' });
export const ROAD_TEXTURES = Object.freeze({
  'asphalt-fine': entry('Fine asphalt', 1, '#555b60', .012, true, 'Dense small aggregate with subtle binder and broad paving variation.'),
  'asphalt-coarse': entry('Coarse asphalt', 1, '#6a6b67', .026, true, 'Larger exposed aggregate for secondary roads and coarse chip surfaces.'),
  'concrete-broom': entry('Broom concrete', 2, '#b5b1a5', .012, true, 'Warm concrete with transverse broom strokes and restrained mottling.'),
  'concrete-slabs': entry('Slab concrete', 3, '#aaa99f', .016, true, 'Three-metre panels with recessed expansion joints and per-panel colour.'),
  'gravel-compacted': entry('Compacted gravel', 4, '#928372', .038, false, 'Mixed aggregate with a finer compacted centre and loose edge stones.'),
  'limestone-path': entry('Limestone path', 4, '#b8b09a', .022, false, 'Pale crushed limestone with subdued variation for greenways and towpaths.'),
  'earth-packed': entry('Packed earth', 5, '#94765a', .025, false, 'Fine soil with longitudinal compaction, scattered grit and broad dry patches.'),
  'stone-setts': entry('Stone setts', 6, '#8c8e8b', .24, false, 'Staggered granite setts with rounded edges, dark joints and varied stone tone.'),
});
export const ROAD_TEXTURE_CONTROLS = Object.freeze({
  seed: { default: 1, min: 0, max: 65535, unit: 'integer' },
  scale: { default: 1, min: .25, max: 4, unit: 'multiplier of physical dimensions' },
  variation: { default: .65, min: 0, max: 1, unit: 'strength' },
});

/** Resolve a catalog ID and optional scene texture controls. Legacy IDs intentionally return null. */
export function roadTextureSpec(surface, controls = {}) {
  const preset = Object.hasOwn(ROAD_TEXTURES, surface) ? ROAD_TEXTURES[surface] : null;
  if (!preset) return null;
  const options = {};
  for (const [key, limits] of Object.entries(ROAD_TEXTURE_CONTROLS)) {
    const n = controls[key] ?? limits.default;
    if (!Number.isFinite(n) || n < limits.min || n > limits.max || (key === 'seed' && !Number.isInteger(n))) {
      throw new RangeError(`texture.${key} must be ${key === 'seed' ? 'an integer' : 'a number'} in ${limits.min}…${limits.max}`);
    }
    options[key] = n;
  }
  return { ...preset, ...options };
}

// Uses rsNoise/rsHash from road-surface.js. The alpha channel controls whether lane paint is retained.
const GLSL = /* glsl */`
  vec4 rtSurface(vec3 original, vec2 metres, float pixelM, vec4 settings, vec4 tint, float damp) {
    if (settings.x < .5) return vec4(original, 1.);
    float kind = settings.x, scale = settings.y, seed = settings.z, variation = settings.w;
    vec2 p = metres / scale, offset = vec2(mod(seed, 251.), floor(seed / 251.)) * 7.13;
    vec2 q = p + offset;
    float px = pixelM / scale;
    float broad = rsNoise(q * vec2(.27, .13));
    vec3 c = tint.rgb * (1. + (broad - .5) * .22 * variation);
    if (kind < 1.5 || (kind > 3.5 && kind < 4.5)) {
      // Nearest jittered grain centre: a small Voronoi mosaic, evaluated in real metres.
      float grain = tint.w;
      vec2 g = q / grain, cell = floor(g), f = fract(g);
      float nearest = 10., id = 0.;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 b = vec2(float(i), float(j));
        vec2 centre = b + .18 + .64 * vec2(rsHash(cell + b), rsHash(cell + b + 19.7));
        float d = length(centre - f);
        if (d < nearest) { nearest = d; id = rsHash(cell + b + 41.); }
      }
      float detail = 1. - smoothstep(grain * .25, grain * 1.4, px);
      float stone = 1. - smoothstep(.25, .51, nearest);
      float value = kind < 1.5 ? (stone * (.65 + id * .7) - .65) * .36 : (id - .5) * .6 + (stone - .5) * .16;
      c *= 1. + value * detail * (.45 + variation * .55);
      if (kind > 3.5) {
        float compaction = exp(-pow((metres.x - rsDims.x * .5) / (rsDims.x * .27), 2.));
        c *= 1. - compaction * .07;
      }
    } else if (kind < 3.5) {
      // Broom strokes across the road; fine strokes fade to their mean rather than shimmer.
      float detail = 1. - smoothstep(.003, .025, px);
      float brush = sin(p.y * 620. + rsNoise(vec2(q.x * .8, floor(q.y * 15.))) * 2.);
      c *= 1. + brush * .035 * detail + (rsNoise(q * 3.) - .5) * .07 * variation;
      if (kind > 2.5) {
        vec2 panel = vec2(p.x / 3., p.y / 3.);
        float tone = rsHash(floor(panel) + offset);
        vec2 edge = min(fract(panel), 1. - fract(panel)) * 3.;
        float gap = 1. - smoothstep(.009, .018 + px, min(edge.x, edge.y));
        float visible = 1. - smoothstep(.05, .25, px);
        c *= (1. + (tone - .5) * .12 * variation) * (1. - gap * .48 * visible);
      }
    } else if (kind < 5.5) {
      float fine = 1. - smoothstep(.005, .04, px);
      c *= 1. + (rsNoise(q * 45.) - .5) * .24 * fine;
      c *= 1. + (rsNoise(q * vec2(3., .15)) - .5) * .18 * variation;
      float pebble = smoothstep(.75, .86, rsNoise(q * 26.));
      c = mix(c, tint.rgb * 1.3, pebble * fine * .35);
    } else {
      // 24 × 17 cm staggered setts; seeded course offsets avoid a machine-perfect brick grid.
      float row = floor(p.y / .17), fy = fract(p.y / .17);
      float shift = mod(row, 2.) * .5 + (rsHash(vec2(row, seed)) - .5) * .13;
      float u = p.x / .24 + shift, col = floor(u), fx = fract(u);
      float stone = rsHash(vec2(col, row) + offset);
      float edge = min(min(fx, 1. - fx) * .24, min(fy, 1. - fy) * .17);
      float detail = 1. - smoothstep(.045, .22, px);
      float joint = 1. - smoothstep(.006, .013 + px * .5, edge);
      vec3 block = c * (1. + (stone - .5) * .48 * variation);
      block *= .87 + .13 * smoothstep(.006, .035, edge);
      block *= 1. + (rsNoise(q * 55.) - .5) * .14 * (1. - smoothstep(.005, .03, px));
      block = mix(block, tint.rgb * .35, joint * .9);
      c = mix(c * .91, block, detail);
    }
    c *= 1. - damp * .36;
    return vec4(c, kind < 3.5 ? 1. : 0.);
  }
`;

/** Wrap the existing road shader, leaving its compile path untouched for legacy-only scenes. */
export function decorateRoadTextures(material, road, maxZones = 24) {
  const zones = (road.zones || []).slice(0, maxZones);
  const spec = (z) => roadTextureSpec(z.surface, { ...road.texture, ...z.texture });
  const base = spec({ surface: road.surface });
  const list = zones.map(spec);
  if (!base && !list.some(Boolean)) return material;
  const settings = (s) => new THREE.Vector4(s?.pattern || 0, s?.scale || 1, s?.seed || 0, s?.variation ?? .65);
  const tint = (s) => { const c = new THREE.Color(s?.color || '#000000'); return new THREE.Vector4(c.r, c.g, c.b, s?.grainM || .02); };
  const uniforms = {
    rtBase: { value: settings(base) }, rtTint: { value: tint(base) },
    rtZones: { value: Array.from({ length: maxZones }, (_, i) => settings(list[i])) },
    rtTints: { value: Array.from({ length: maxZones }, (_, i) => tint(list[i])) },
  };
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('// a line of width w', `
      uniform vec4 rtBase; uniform vec4 rtTint;
      uniform vec4 rtZones[${maxZones}]; uniform vec4 rtTints[${maxZones}];
      ${GLSL}
      // a line of width w`)
      .replace('// a narrower paved road:', `
        vec4 rt = rtSurface(asphalt, vec2(x, s), px, rtBase, rtTint, damp);
        for (int i = 0; i < ${maxZones}; i++) {
          vec4 z = rsSpan[i]; if (z.w < .5) break;
          float k = smoothstep(z.x - 20., z.x + 20., s) * (1. - smoothstep(z.y - 20., z.y + 20., s));
          if (k > 0.) rt = mix(rt, rtSurface(asphalt, vec2(x, s), px, rtZones[i], rtTints[i], damp), k);
        }
        asphalt = rt.rgb; paint *= rt.a;
        // a narrower paved road:`)
      .replace('vec3 edgePaint =', 'newEdge *= rt.a;\n          vec3 edgePaint =');
  };
  material.customProgramCacheKey = () => `${key}|road-textures-1`;
  material.needsUpdate = true;
  return material;
}
