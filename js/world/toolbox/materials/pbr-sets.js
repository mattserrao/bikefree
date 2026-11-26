// Toolbox: the PBR surface sets (fidelity plan, steps 3 and 5) — KTX2 textures (textures/ktx2, tools/build_textures.mjs)
// loaded once per renderer, compressed on the GPU, and the GLSL the surface shaders sample them with.
//
//   loadPbrSets(renderer, ['asphalt-worn', 'turf', …])  → Promise<{ [set]: { albedo, nra } }> (shared per renderer)
//   PBR_GLSL                hex-tiled sampling (no visible repeat: three offset samples blended per hexagon cell),
//                           the packed normal (x,y in R,G; z rebuilt), roughness (B) and AO (A)
//
// Each set: albedo (sRGB; A = height) and nra (linear: normal x,y · roughness · AO). A map lists its sets in its JSON
// "assets": { "textures": [...] } (map-definition.js), at most MAP_TEXTURE_MB of them.
import * as THREE from '../../../../vendor/three.js';
import { KTX2Loader } from '../../../../vendor/addons/loaders/KTX2Loader.js';

const BASE = new URL('../../../../', import.meta.url);

// neutral stand-ins until a set has loaded (and on Phone, which doesn't load them): mid albedo, flat normal, rough, no AO
const neutral = (rgba, srgb) => { const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; };
/** The road surface's set (shared uniforms: every road material reads them; set once the textures arrive). */
export const ROAD_PBR = { albedo: { value: neutral([128, 128, 128, 128], true) }, nra: { value: neutral([128, 128, 230, 255], false) }, on: { value: 0 } };
/** The road set a map's profile asks for: worn upstate asphalt, or clean city asphalt. */
export const roadSetFor = (profile) => (profile?.roads === 'worn' ? 'asphalt-worn' : 'asphalt-new');
let manifestP = null;
const perRenderer = new WeakMap();

function manifest() {
  return (manifestP ||= fetch(new URL('textures/ktx2/manifest.json', BASE)).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
}

function loaderFor(renderer) {
  let s = perRenderer.get(renderer);
  if (!s) {
    const loader = new KTX2Loader().setTranscoderPath(new URL('vendor/addons/libs/basis/', BASE).href).detectSupport(renderer);
    s = { loader, sets: new Map() };
    perRenderer.set(renderer, s);
  }
  return s;
}

function prep(tex, srgb, renderer) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 1);
  tex.needsUpdate = true;
  return tex;
}

/** The named sets' textures for this renderer (each loaded once; a set missing from the manifest is skipped). */
export async function loadPbrSets(renderer, names) {
  const m = await manifest(), s = loaderFor(renderer), out = {};
  await Promise.all(names.filter((n) => m[n]).map(async (n) => {
    if (!s.sets.has(n)) {
      s.sets.set(n, Promise.all([
        s.loader.loadAsync(new URL(m[n].albedo.file, BASE).href).then((t) => prep(t, true, renderer)),
        s.loader.loadAsync(new URL(m[n].nra.file, BASE).href).then((t) => prep(t, false, renderer)),
      ]).then(([albedo, nra]) => ({ albedo, nra })));
    }
    out[n] = await s.sets.get(n);
  }));
  return out;
}

/**
 * GLSL. hexSample(tex, uv): the texture without visible repetition (Mikkelsen's practical hex tiling, the simple blend:
 * three samples at random offsets per hexagonal cell, weighted by the barycentrics, sharpened). pbrSurface(...) unpacks a
 * set at world uv: albedo (linear), height, normal (tangent space), roughness, ao.
 */
export const PBR_GLSL = /* glsl */`
  vec2 hexHash(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  vec4 hexSample(sampler2D tex, vec2 uv) {
    vec2 st = uv * mat2(1., 0., -.57735027, 1.15470054) * 3.4641016;   // skew onto the hex lattice (cells ≈ 1/2 tile)
    vec2 ip = floor(st), f = fract(st);
    vec3 w; vec2 v1, v2, v3;
    float s = f.x + f.y;
    if (s < 1.) { w = vec3(1. - s, f.x, f.y); v1 = ip; v2 = ip + vec2(1., 0.); v3 = ip + vec2(0., 1.); }
    else { w = vec3(s - 1., 1. - f.y, 1. - f.x); v1 = ip + 1.; v2 = ip + vec2(0., 1.); v3 = ip + vec2(1., 0.); }
    w = pow(w, vec3(6.)); w /= (w.x + w.y + w.z);
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    return textureGrad(tex, uv + hexHash(v1), dx, dy) * w.x + textureGrad(tex, uv + hexHash(v2), dx, dy) * w.y + textureGrad(tex, uv + hexHash(v3), dx, dy) * w.z;
  }
  struct PbrSample { vec3 albedo; float height; vec3 normal; float roughness; float ao; };
  PbrSample pbrSurface(sampler2D albedoTex, sampler2D nraTex, vec2 uv) {
    PbrSample o;
    vec4 a = hexSample(albedoTex, uv), n = hexSample(nraTex, uv);
    o.albedo = a.rgb; o.height = a.a;
    vec2 nxy = n.rg * 2. - 1.;
    o.normal = normalize(vec3(nxy, sqrt(max(0., 1. - dot(nxy, nxy)))));
    o.roughness = n.b; o.ao = n.a;
    return o;
  }`;
