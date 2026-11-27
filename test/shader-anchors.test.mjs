// [review 27 Nov] Every '#include <…>' a toolbox material's onBeforeCompile patches at is really in three's shader for
// that material type (a String.replace whose anchor is missing does nothing: the patch is lost without a word — the
// street slot bias sat under a define r187 renamed). Builds the factories that construct in Node, runs each
// onBeforeCompile on THREE.ShaderLib's own source with String.prototype.replace watched, and lists any anchor missing.
// Also: patchShader (toolbox/core/shader-patch.js) throws on a missing anchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.js';
import { patchShader } from '../js/world/toolbox/core/shader-patch.js';

const LIB = { MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong', MeshBasicMaterial: 'basic', MeshDepthMaterial: 'depth', MeshDistanceMaterial: 'distance', PointsMaterial: 'points', MeshToonMaterial: 'toon' };
const renderer = { capabilities: { getMaxAnisotropy: () => 1, isWebGL2: true }, getContextAttributes: () => ({ antialias: true }), extensions: { has: () => true } };

/** The anchors m's onBeforeCompile looks for and doesn't find: ['vertex|fragment: #include <x>', …]. */
function missingAnchors(m) {
  const lib = THREE.ShaderLib[LIB[m.type]];
  if (!lib || !m.onBeforeCompile) return [];
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms), defines: {} };
  const miss = [], replace = String.prototype.replace;
  String.prototype.replace = function (a, b) {
    if (typeof a === 'string' && a.startsWith('#include <') && !String(this).includes(a)) miss.push(a);
    return replace.call(this, a, b);
  };
  try { m.onBeforeCompile(shader, renderer); } finally { String.prototype.replace = replace; }
  return miss;
}

test('patchShader puts code at its anchor and throws when the anchor is missing', () => {
  assert.equal(patchShader('a\n#include <x>\nb', '#include <x>', 'c'), 'a\n#include <x>\nc\nb');
  assert.equal(patchShader('#include <x>', '#include <x>', 'c', 'before'), 'c\n#include <x>');
  assert.equal(patchShader('a $& b', '$&', '$1', 'replace'), 'a $1 b');   // (no String.replace $-patterns)
  assert.throws(() => patchShader('void main() {}', '#include <logdepthbuf_fragment>', 'x'), /anchor not found/);
});

test('the bake and the vista kit patch exact lines that are in three\'s lights_fragment_begin', () => {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  assert.ok(chunk.includes('getDirectionalLightInfo( directionalLight, directLight );'), 'baked-light.js sunLine');
  assert.ok(chunk.includes('vec3 geometryPosition = - vViewPosition;'), 'baked-light.js start');
  assert.ok(chunk.includes('directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;'), 'surfaces.js vista line');
});

test('the street slot bias uses defines three r187 emits', async () => {
  const { SLOT_BIAS_VERTEX } = await import('../js/world/toolbox/city/city.js');
  for (const d of SLOT_BIAS_VERTEX.match(/USE_[A-Z_]+/g)) assert.ok(['USE_LOGARITHMIC_DEPTH_BUFFER', 'USE_REVERSED_DEPTH_BUFFER'].includes(d), d);
  const src = THREE.ShaderChunk.logdepthbuf_fragment + THREE.ShaderChunk.logdepthbuf_vertex;
  assert.ok(src.includes('USE_LOGARITHMIC_DEPTH_BUFFER') && !src.includes('USE_LOGDEPTHBUF'));
});

test('the anchor checker catches a patch at an include the shader lacks', () => {
  const m = new THREE.MeshBasicMaterial();
  m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_begin>', 'x').replace('#include <map_fragment>', '#include <map_fragment>\n'); };
  assert.deepEqual(missingAnchors(m), ['#include <lights_fragment_begin>']);
});

test('every toolbox material factory patches only anchors its three.js shader has', async () => {
  const U = () => ({ uTime: { value: 0 } });
  const S = await import('../js/world/toolbox/materials/surfaces.js');
  const { litMaterial } = await import('../js/world/toolbox/materials/lit.js');
  const { decorateTreeMaterial } = await import('../js/world/toolbox/packs/northern-rockies.js');
  const { BakedLighting } = await import('../js/world/toolbox/atmosphere/baked-light.js');
  const { Look } = await import('../js/world/toolbox/atmosphere/look.js');
  const palette = { low: '#6f8f4a', mid: '#7d8a55', high: '#8a8a80', rock: '#7a756c', snow: '#f4f4f4' };
  const made = {
    ground: () => S.makeGroundMaterial(palette, {}, null, null, U()),
    groundVista: () => S.makeGroundMaterial(palette, {}, null, null, U(), { rock: { ribs: 1, ledges: 1, scree: 1, ribWidthM: 30, ribLengthM: 170, reliefM: 4, ledgeM: 32 }, snow: { gullies: 1, ledges: 1 } }),
    lakeWater: () => S.makeLakeWaterMaterial(U(), '#3c6f86', '#5f9aa8', '#2f4a2a'),
    lakeMist: () => S.makeLakeMistMaterial(U(), .5),
    scenery: () => S.decorateSceneryMaterial(new THREE.MeshStandardMaterial(), 'tree', U()),
    lit: () => litMaterial({ vertexColors: true }),
    tree: () => decorateTreeMaterial(new THREE.MeshStandardMaterial(), U()),
  };
  const optional = {
    flare: async () => (await import('../js/world/toolbox/vegetation/near-trunks.js')).flareMaterial(),
    animal: async () => (await import('../js/world/toolbox/life/figures/animals.js')).animalMaterial('deer', { value: 0 }),
    crop: async () => (await import('../js/world/toolbox/landscape/farm-kit.js')).cropMaterial({ value: 0 }),
    redRock: async () => (await import('../js/world/toolbox/landscape/redrock.js')).redRockMaterial(),
    facade: async () => (await import('../js/world/toolbox/structures/buildings/facade-material.js')).makeFacadeMaterial(),
    vehicle: async () => (await import('../js/world/toolbox/life/figures/vehicles.js')).vehicleMaterial(),
    car: async () => (await import('../js/world/toolbox/life/figures/cars.js')).carMaterial(),
    figure: async () => (await import('../js/world/toolbox/life/figures/people.js')).figureMaterial({ value: 0 }),
    canal: async () => (await import('../js/world/toolbox/city/cny-landmarks.js')).canalWaterMaterial({ value: 0 }),
  };
  const mats = {};
  for (const [k, f] of Object.entries(made)) mats[k] = f();
  const skipped = [];
  for (const [k, f] of Object.entries(optional)) { try { mats[k] = await f(); } catch (e) { skipped.push(`${k} (${e.message.slice(0, 40)})`); } }
  // the bake and the look on top, chained as the worlds chain them (each on its own copy)
  const world = { renderer: { toneMapping: 0, shadowMap: {} }, area: null, scene: { traverse() {} } };
  const bake = new BakedLighting(world, { baked: 'midday', sun: { elev: 40, az: 180 } }), look = new Look(world, 'gentle');
  for (const k of ['ground', 'groundVista', 'scenery', 'lit', 'tree']) { const m = made[k](); bake.patchMaterial(m); mats[`${k}+bake`] = m; const n = made[k](); look._patch(n); mats[`${k}+look`] = n; }
  const bad = [];
  for (const [k, m] of Object.entries(mats)) for (const a of [].concat(m)) for (const miss of missingAnchors(a)) bad.push(`${k}: ${miss}`);
  if (skipped.length) console.log(`(not constructible in Node: ${skipped.join(', ')})`);
  assert.ok(Object.keys(mats).length >= 10, 'at least ten materials checked');
  assert.deepEqual(bad, []);
});
