import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { ROAD_TEXTURES, roadTextureSpec, decorateRoadTextures } from '../js/world/toolbox/materials/road-textures.js';
import { decorateRoad } from '../js/world/toolbox/materials/road-surface.js';
import { lintScene } from '../tools/lint_scene.mjs';

test('texture controls have stable defaults and reject invalid physical scales or seeds', () => {
  for (const id of Object.keys(ROAD_TEXTURES)) {
    const first = roadTextureSpec(id);
    assert.deepEqual(first, roadTextureSpec(id));
    assert.equal(first.scale, 1); assert.equal(first.seed, 1);
    assert.equal(roadTextureSpec(id, { seed: 42, scale: 2 }).scale, 2);
  }
  for (const controls of [{ scale: 0 }, { scale: Infinity }, { seed: 1.5 }, { seed: -1 }, { variation: 2 }]) assert.throws(() => roadTextureSpec('asphalt-fine', controls), RangeError);
  assert.equal(roadTextureSpec('worn'), null);
});

test('legacy-only road and zone selections retain their original compiler and cache key', () => {
  const material = new THREE.MeshStandardMaterial();
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  decorateRoadTextures(material, { surface: 'worn', zones: [{ surface: 'brick', fromM: 0, toM: 100 }] });
  assert.equal(material.onBeforeCompile, compile);
  assert.equal(material.customProgramCacheKey(), key);
});

test('road and trail layers inherit controls while individual zones can override them', () => {
  const material = decorateRoad(new THREE.MeshStandardMaterial(), {
    surface: 'asphalt-fine', texture: { seed: 17, scale: 2 },
    zones: [{ surface: 'stone-setts', fromM: 100, toM: 300, texture: { seed: 29 } }, { surface: 'worn', fromM: 400, toM: 600 }],
  });
  const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <map_fragment>' };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.rtBase.value.z, 17);
  assert.equal(shader.uniforms.rtZones.value[0].z, 29);
  assert.equal(shader.uniforms.rtZones.value[0].y, 2);
  assert.equal(shader.uniforms.rtZones.value[1].x, 0, 'legacy zones select the original surface');
  assert.equal(shader.uniforms.rtZones.value.length, 24);
  assert.match(shader.fragmentShader, /paint \*= rt.a/);
});

test('scene linter validates texture controls in roads, trails and their zones', () => {
  const scene = { format: 'bikefree-scene-1', style: 'stylized', palette: {}, terrain: 'authored-region', road: {
    surface: 'asphalt-fine', texture: { seed: 12, scale: 1, variation: .5 },
    zones: [{ surface: 'concrete-slabs', fromM: 100, toM: 200 }],
    trail: { surface: 'limestone-path', zones: [{ surface: 'earth-packed', fromM: 0, toM: 100, texture: { variation: .2 } }] },
  } };
  assert.deepEqual(lintScene(scene).errors, []);
  scene.road.trail.zones[0].texture.variation = 2;
  assert.ok(lintScene(scene).errors.some((e) => e.includes('road.trail.zones[0]') && e.includes('variation')));
  scene.road.texture = { scall: 2 };
  assert.ok(lintScene(scene).errors.some((e) => e.includes('scall')));
});
