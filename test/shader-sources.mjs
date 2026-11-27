// [review 27 Nov] The generated shader source of every toolbox material that constructs in Node: each factory's
// material, its onBeforeCompile run on THREE.ShaderLib's own source (as three does before it compiles), and its
// program cache key. test/shader-sources.test.mjs compares a hash of each with test/shader-sources.snap.json, so a
// mechanical refactor (patchShader at every anchor, shaders moved to their own module) is proved to change nothing.
// `node test/shader-sources.mjs --write` rewrites the snapshot after an intended shader change; `--dump <dir>` writes
// the sources out to diff.
import * as THREE from '../vendor/three.js';
import { createHash } from 'node:crypto';

const LIB = { MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong', MeshBasicMaterial: 'basic', MeshDepthMaterial: 'depth', MeshDistanceMaterial: 'distance', PointsMaterial: 'points', MeshToonMaterial: 'toon', MeshMatcapMaterial: 'matcap', MeshNormalMaterial: 'normal', SpriteMaterial: 'sprite', LineBasicMaterial: 'basic' };
export const renderer = { capabilities: { getMaxAnisotropy: () => 1, isWebGL2: true, maxTextureSize: 4096 }, getContextAttributes: () => ({ antialias: true }), extensions: { has: () => true }, toneMapping: 0, shadowMap: {}, outputColorSpace: 'srgb' };

/** { vertexShader, fragmentShader, key } of m as three would compile it (a ShaderMaterial: its own source). */
export function generated(m) {
  if (m.isShaderMaterial) return { vertexShader: m.vertexShader, fragmentShader: m.fragmentShader, key: m.customProgramCacheKey?.() || '', defines: JSON.stringify(m.defines || {}) };
  const lib = THREE.ShaderLib[LIB[m.type]];
  if (!lib) throw new Error(`no ShaderLib for ${m.type}`);
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms), defines: { ...(m.defines || {}) } };
  m.onBeforeCompile?.(shader, renderer);
  // (three's default program cache key is the onBeforeCompile's own source text: recorded as such, not as that text)
  const key = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? '(default: onBeforeCompile.toString())' : m.customProgramCacheKey?.() || '';
  // (a key chained on a default one — the bake's, the look's — carries that source text: read with each T8 anchor('…')
  //  as the string it stands for, the key three compared before T8)
  return { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader, key: key.replace(/anchor\(('#include <[a-z_0-9]+>')\)/g, '$1'), defines: JSON.stringify(shader.defines), uniforms: Object.keys(shader.uniforms).sort().join(',') };
}

// (a canvas that draws nothing, for the factories that paint a texture first: only their shaders are read here)
const noop = new Proxy(function () {}, { get: (t, k) => (k === 'data' ? new Uint8ClampedArray(4) : k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
const el = () => ({ width: 1, height: 1, style: {}, getContext: () => noop, toDataURL: () => '', addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: el, createElementNS: el };
const U = () => ({ uTime: { value: 0 } });
const palette = { low: '#6f8f4a', mid: '#7d8a55', high: '#8a8a80', rock: '#7a756c', snow: '#f4f4f4' };
const T = () => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; };

/** name → () => material (or array of materials). Each a fresh material. */
export async function factories() {
  const tb = '../js/world/toolbox/';
  const S = await import(`${tb}materials/surfaces.js`);
  const { litMaterial } = await import(`${tb}materials/lit.js`);
  const { decorateTreeMaterial } = await import(`${tb}packs/northern-rockies.js`);
  const { BakedLighting } = await import(`${tb}atmosphere/baked-light.js`);
  const { Look } = await import(`${tb}atmosphere/look.js`);
  const { withNightGlow } = await import(`${tb}materials/night-glow.js`);
  const f = {
    ground: () => S.makeGroundMaterial(palette, {}, null, null, U()),
    groundVista: () => S.makeGroundMaterial(palette, {}, null, null, U(), { rock: { ribs: 1, ledges: 1, scree: 1, ribWidthM: 30, ribLengthM: 170, reliefM: 4, ledgeM: 32 }, snow: { gullies: 1, ledges: 1 } }),
    lakeWater: () => S.makeLakeWaterMaterial(U(), '#3c6f86', '#5f9aa8', '#2f4a2a'),
    lakeMist: () => S.makeLakeMistMaterial(U(), .5),
    sceneryTree: () => S.decorateSceneryMaterial(new THREE.MeshStandardMaterial(), 'tree', U()),
    sceneryGrass: () => S.decorateSceneryMaterial(new THREE.MeshStandardMaterial(), 'grass', U()),
    sceneryConcrete: () => S.decorateSceneryMaterial(new THREE.MeshStandardMaterial(), 'concrete', U()),
    lit: () => litMaterial({ vertexColors: true }),
    tree: () => decorateTreeMaterial(new THREE.MeshStandardMaterial(), U()),
    glow: () => withNightGlow(new THREE.MeshStandardMaterial({ vertexColors: true }), { value: 0 }, 'vColor.rgb * uNight', 'glow-test', { glow: 'float' }),
    glowPhysical: () => withNightGlow(new THREE.MeshPhysicalMaterial(), { value: 0 }, 'vec3(1.) * uNight', 'glow-test-p'),
  };
  const opt = {
    flare: async () => (await import(`${tb}vegetation/near-trunks.js`)).flareMaterial(),
    barkDetail: async () => (await import(`${tb}vegetation/near-trunks.js`)).withBarkDetail(decorateTreeMaterial(new THREE.MeshStandardMaterial(), U())),
    animal: async () => (await import(`${tb}life/figures/animals.js`)).animalMaterial('deer', { value: 0 }),
    crop: async () => (await import(`${tb}landscape/farm-kit.js`)).cropMaterial({ value: 0 }),
    redRock: async () => (await import(`${tb}landscape/redrock.js`)).redRockMaterial(),
    facade: async () => (await import(`${tb}structures/buildings/facade-material.js`)).makeFacadeMaterial(),
    vehicle: async () => (await import(`${tb}life/figures/vehicles.js`)).vehicleMaterial(),
    car: async () => (await import(`${tb}life/figures/cars.js`)).carMaterial(),
    figure: async () => (await import(`${tb}life/figures/people.js`)).figureMaterial({ value: 0 }),
    canal: async () => (await import(`${tb}city/cny-landmarks.js`)).canalWaterMaterial({ value: 0 }),
    surfaceDetail: async () => (await import(`${tb}materials/surface-detail.js`)).withSurfaceDetail(litMaterial({ vertexColors: true })),
    parkPath: async () => (await import(`${tb}materials/park-surfaces.js`)).makeParkMaterial('path'),
    parkLawn: async () => (await import(`${tb}materials/park-surfaces.js`)).makeParkMaterial('lawn'),
    leaves: async () => (await import(`${tb}vegetation/leaf-cards.js`)).billboardLeaves(new THREE.MeshStandardMaterial({ map: T(), alphaTest: .5 })),
    masonry: async () => (await import(`${tb}materials/stonework.js`)).makeMasonryMaterial(),
    roadWorn: async () => (await import(`${tb}materials/road-surface.js`)).decorateRoad(new THREE.MeshStandardMaterial(), { surface: 'worn', zones: [{ fromM: 0, toM: 500, surface: 'brick' }] }),
    treeCards: async () => { const c = (await import(`${tb}vegetation/tree-cards.js`)).makeTreeCards(U()); return [c.conifer.material, c.broadleaf.material]; },
    grass: async () => (await import(`${tb}landscape/grass-cards.js`)).grassMaterial(null, { value: 0 }),
    bird: async () => (await import(`${tb}life/coast-life.js`)).birdMaterial(U(), 1),
  };
  // [review 27 Nov] T14: the city's materials (city/materials.js) and the tree engine's impostor cards
  const C = await import(`${tb}city/materials.js`), cu = () => ({ uSkyTop: { value: new THREE.Color() }, uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3() }, uSkyHorizon: { value: new THREE.Color() } });
  const own = (x) => x, dt = () => new THREE.DataTexture(new Uint8Array(64), 4, 4);
  Object.assign(opt, {
    cityBuildings: () => C.cityBuildingMaterial(cu(), () => ({ value: 0 }), false),
    cityBuildingsFacades: () => C.cityBuildingMaterial(cu(), () => ({ value: 0 }), true),
    cityStreets: () => { const m = C.cityStreetMaterials(own, true); return [m.streetMaterial, m.brickMaterial]; },
    cityGlow: () => C.cityGlowMaterial({ value: 0 }),
    cityRiver: () => C.cityRiverMaterial(cu(), { value: 0 }, dt(), [0, 0, 10, 10]),
    cityRiverBeyond: () => C.cityRiverMaterial(cu(), { value: 0 }, dt(), [0, 0, 10, 10], [1, 2, 3, 4], dt()),
    cityLamp: () => C.cityLampMaterial({ value: 0 }),
    impostor: async () => { const { impostorMaterial } = await import(`${tb}vegetation/impostor-material.js`); return [true, false].map((msaa) => impostorMaterial(new THREE.Texture(), 5, 1536, 640, { ft: msaa ? .9 : .2, tileIn: msaa ? 1.5 : .35, msaa, normAtlas: null })); },
  });
  for (const [k, g] of Object.entries(opt)) f[k] = g;
  // the bake and the look on top, chained as the worlds chain them
  const world = { renderer: { toneMapping: 0, shadowMap: {} }, area: null, scene: { traverse() {} } };
  for (const k of ['ground', 'groundVista', 'sceneryTree', 'lit', 'tree']) {
    f[`${k}+bake`] = () => { const bake = new BakedLighting(world, { baked: 'midday', sun: { elev: 40, az: 180 } }); const m = f[k](); bake.patchMaterial(m); return m; };
    f[`${k}+look`] = () => { const look = new Look(world, 'gentle'); const m = f[k](); look._patch(m); return m; };
  }
  return f;
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** name → { vs, fs, key } hashes (and the full sources when full), plus the names that didn't construct. */
export async function snapshot({ full = false } = {}) {
  const out = {}, skipped = [];
  for (const [k, f] of Object.entries(await factories())) {
    let mats;
    try { mats = [].concat(await f()); } catch (e) { skipped.push(`${k} (${String(e.message).slice(0, 60)})`); continue; }
    mats.forEach((m, i) => {
      const name = mats.length > 1 ? `${k}#${i}` : k;
      let g;
      try { g = generated(m); } catch (e) { skipped.push(`${name} (${String(e.message).slice(0, 60)})`); return; }
      out[name] = full ? g : { vs: hash(g.vertexShader), fs: hash(g.fragmentShader), key: hash(`${g.key}|${g.defines}|${g.uniforms || ''}`) };
    });
  }
  return { out, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const arg = process.argv[2];
  if (arg === '--write') {
    const { out, skipped } = await snapshot();
    fs.writeFileSync(new URL('./shader-sources.snap.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
    console.log(`wrote ${Object.keys(out).length} materials${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}`);
  } else if (arg === '--dump') {
    const dir = process.argv[3]; fs.mkdirSync(dir, { recursive: true });
    const { out, skipped } = await snapshot({ full: true });
    for (const [k, g] of Object.entries(out)) fs.writeFileSync(`${dir}/${k}.glsl`, `// key ${g.key} defines ${g.defines} uniforms ${g.uniforms}\n// ---- vertex\n${g.vertexShader}\n// ---- fragment\n${g.fragmentShader}\n`);
    console.log(`dumped ${Object.keys(out).length}; skipped ${skipped.join(', ')}`);
  }
}
