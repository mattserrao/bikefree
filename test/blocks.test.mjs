// [blocks] The shared building blocks: map profiles, the effects registry, the building engine and the planting API
// (bikefree Project doc claude/building-blocks-review.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapProfile, PROFILE_PRESETS } from '../js/world/toolbox/map-profile.js';
import { lintGraphMap, SCENE_FIELDS } from '../js/world/toolbox/scene-schema.js';

const graph = (id) => JSON.parse(readFileSync(new URL(`../routes/cities/${id}.json`, import.meta.url)));
const EFFECT_NAMES = Object.fromEntries(SCENE_FIELDS.effects.keys.map((k) => [k, true]));

test('CNY and SKAN rules are the defaults; PGH pins the city preset', () => {
  assert.equal(mapProfile({}).preset, 'upstate');
  assert.deepEqual(mapProfile({}), mapProfile({ profile: 'upstate' }));
  for (const id of ['cny', 'skan']) {
    const p = mapProfile(graph(id));
    assert.equal(p.light, 'golden-upstate'); assert.equal(p.roads, 'worn'); assert.equal(p.dressing, 'country'); assert.equal(p.life, 'cyclists');
  }
  const pgh = mapProfile(graph('pgh'));
  assert.equal(pgh.light, 'free'); assert.equal(pgh.dressing, 'city'); assert.equal(pgh.life, 'none');
  // SKAN pins what it drew before the profiles (no visual change): its lakefront rule, home classes and styles
  const skan = mapProfile(graph('skan'));
  assert.equal(skan.hideInWater, true); assert.equal(skan.classifyHomes, 'by-neighbours');
  assert.equal(skan.buildingStyles[0].preset, 'pittsburgh-rowhouse');
  assert.equal(mapProfile(graph('cny')).buildingStyles[0].preset, 'cny-suburban');
});

test('graph maps lint clean against the shared schema', () => {
  for (const id of ['pgh', 'cny', 'skan']) assert.deepEqual(lintGraphMap(graph(id), { presets: PROFILE_PRESETS, effects: EFFECT_NAMES }), [], id);
  assert.ok(lintGraphMap({ profile: 'nope' }, { presets: PROFILE_PRESETS, effects: EFFECT_NAMES }).length);
  assert.ok(lintGraphMap({ effects: { glitter: {} } }, { presets: PROFILE_PRESETS, effects: EFFECT_NAMES }).length);
});

test('no map rule is keyed by a map id in the graph world', () => {
  for (const f of ['../js/world/graph-world.js', '../js/world/graph-city.js', '../js/world/graph-heroes.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /json\?\.id === '(cny|skan|pgh)'/, f);
    assert.doesNotMatch(src, /RURAL_MAPS\.has/, f);
  }
});

test('the building engine: one front door, every graph code has a kind', async () => {
  const E = await import('../js/world/toolbox/structures/building-engine.js');
  assert.equal(E.kindOfCode(0), 'rowhouse'); assert.equal(E.kindOfCode(20), 'farmhouse-ny'); assert.equal(E.kindOfCode(22), 'freestall'); assert.equal(E.kindOfCode(7), 'other');
  for (const k of ['house', 'village-house', 'farmhouse-ny']) assert.ok(E.GENERATORS['house-engine'].kinds.includes(k));
  assert.equal(E.generatorOf({ house: {} }), 'house-engine'); assert.equal(E.generatorOf({}), 'building-kit');
  // nothing outside the engine draws a building straight through a generator any more
  for (const f of ['../js/world/graph-city.js', '../js/world/toolbox/structures/buildings/kit.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /[^.]\bassemble\(R|buildHouse\(R/, f);
    // (and the front door is imported where it's called)
    if (/buildBuilding\(/.test(src)) assert.match(src, /import \{[^}]*\bbuildBuilding\b[^}]*\} from '[^']*building-engine\.js'/, f);
  }
});

test('the planting API: matrices become engine records (yaw only)', async () => {
  const THREE = await import('../vendor/three.module.min.js');
  const { recordsFromMatrices, treeRecord } = await import('../js/world/toolbox/vegetation/planting.js');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(3, 4, 5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(2, 3, 2));
  const [t] = recordsFromMatrices({ maple: [m], gone: [m] }, (n) => n === 'maple');
  assert.equal(t.sp, 'maple'); assert.ok(Math.abs(t.rot - 0.7) < 1e-6); assert.ok(Math.abs(t.sy - 3) < 1e-6); assert.equal(t.x, 3);
  assert.deepEqual(treeRecord(1, 2, 3, 'oak', { s: 2, farOnly: true }), { x: 1, y: 2, z: 3, sp: 'oak', v: 0, s: 2, sy: 2, rot: 0, farOnly: true });
});
