// [review 27 Nov] W13: the graph world's road, paint, side and ground materials moved out of graph-world.js into
// toolbox/materials/graph-road.js and graph-ground.js. Every variant's generated shader (onBeforeCompile on three's own
// source), uniforms, cache key, defines and settings must match the snapshot taken from the old code
// (test/fixtures/graph-materials.snapshot.json, by test/world-materials-snap.mjs) — the move changed no program.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotGraphMaterials } from './world-materials-snap.mjs';
import * as R from '../js/world/toolbox/materials/graph-road.js';
import * as G from '../js/world/toolbox/materials/graph-ground.js';
import { SURFACE, SURFACE_SUN } from '../js/world/toolbox/materials/surface-detail.js';
import { ROAD_PBR, GROUND_PBR } from '../js/world/toolbox/materials/pbr-sets.js';
import { ROAD_LOOK, GROUND_LOOK } from '../js/world/toolbox/materials/road-look.js';
import { CANOPY } from '../js/world/toolbox/atmosphere/canopy-shade.js';

const SNAP = JSON.parse(readFileSync(new URL('./fixtures/graph-materials.snapshot.json', import.meta.url), 'utf8'));

test('the graph materials, moved to the toolbox, build the same programs as before the move (51 variants)', () => {
  const shared = [R.CLOUD_T, SURFACE, SURFACE_SUN, ROAD_LOOK.tone, ROAD_LOOK.leaves, GROUND_LOOK.litter, ...Object.values(ROAD_PBR), ...Object.values(GROUND_PBR), ...Object.values(CANOPY)];
  const now = snapshotGraphMaterials({ ...R, ...G }, shared);
  assert.deepEqual(Object.keys(now), Object.keys(SNAP));
  for (const k of Object.keys(SNAP)) assert.deepEqual(now[k], SNAP[k], k);
});

test('graph-world and the endless map take the moved materials and the one cloud clock', async () => {
  const W = await import('../js/world/graph-world.js');
  assert.equal(W.CLOUD_T, R.CLOUD_T);
  const src = readFileSync(new URL('../js/world/graph-world.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /NY_ROAD_GLSL|float gwH\(|function groundMaterial|function roadSurfaceMaterial/);
});

test('a missing anchor in the moved materials throws (patchShader), not silently dropped', () => {
  const m = R.wornPaintMaterial();
  assert.throws(() => m.onBeforeCompile({ vertexShader: 'void main() {}', fragmentShader: 'void main() {}', uniforms: {} }), /anchor not found/);
});
