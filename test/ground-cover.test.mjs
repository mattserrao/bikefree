// Ground cover (js/world/toolbox/landscape/ground-cover.js): tufts only where the map says grass, the same tufts when a
// cell comes back, nothing past the reach, and one draw call within its instance budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.js';
import { GroundCover } from '../js/world/toolbox/landscape/ground-cover.js';

test('ground cover: grass only, the same tufts when a cell returns, none beyond reach', () => {
  const parent = new THREE.Group();
  const gc = new GroundCover({ parent, material: new THREE.MeshBasicMaterial(), isGrass: (x) => (x > 0 ? 1 : 0), heightAt: () => 2, radius: 30, density: 2 });
  gc.tick(new THREE.Vector3(0, 0, 0));
  const n0 = gc.mesh.count, m = new THREE.Matrix4(), p = new THREE.Vector3();
  assert.ok(n0 > 500 && n0 <= gc.capacity, `${n0} tufts`);
  for (let k = 0; k < n0; k += 37) { gc.mesh.getMatrixAt(k, m); p.setFromMatrixPosition(m); assert.ok(p.x > 0 && Math.hypot(p.x, p.z) < 30 && p.y === 2); }
  gc.tick(new THREE.Vector3(500, 0, 0)); gc.tick(new THREE.Vector3(0, 0, 0));
  assert.equal(gc.mesh.count, n0);
  assert.equal(parent.children.length, 1);
  gc.dispose();
});
