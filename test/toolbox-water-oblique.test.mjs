// [review 27 Nov] The water's planar reflection clips what is under the surface with an oblique near plane in the
// mirrored camera's projection (effects/water-surface.js obliqueNear), not renderer.clippingPlanes (in r187 a change of
// numClippingPlanes is a program change: every lit material flipped between two programs twice a frame). Checks that
// points of the original view volume above the plane stay in, those under it go, in both depth conventions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.js';
import { obliqueNear } from '../js/world/toolbox/effects/water-surface.js';

/** A camera under the plane y = 0 looking up across it (as the mirrored camera is), its projection in one convention. */
function setup(reversed) {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, .3, 4000);
  cam._reversedDepth = reversed; cam.updateProjectionMatrix();
  cam.position.set(3, -2.5, 7); cam.lookAt(40, 6, -200); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}
const inside = (c, reversed) => Math.abs(c.x) <= c.w && Math.abs(c.y) <= c.w && (reversed ? c.z >= 0 && c.z <= c.w : c.z >= -c.w && c.z <= c.w);

for (const reversed of [false, true]) {
  test(`obliqueNear keeps the view volume above the water and clips what is under it (${reversed ? 'reversed' : 'OpenGL'} depth)`, () => {
    const cam = setup(reversed), P0 = cam.projectionMatrix.clone();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const P = obliqueNear(cam.projectionMatrix.clone(), plane, cam.matrixWorldInverse, reversed);
    // x, y and w rows untouched (the water's projective lookup uses the same matrix)
    for (const i of [0, 4, 8, 12, 1, 5, 9, 13, 3, 7, 11, 15]) assert.equal(P.elements[i], P0.elements[i], `element ${i}`);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let kept = 0, clipped = 0;
    const v = new THREE.Vector4(), mvp = (M) => M.clone().multiply(cam.matrixWorldInverse);
    const A = mvp(P0), B = mvp(P);
    for (let k = 0; k < 4000; k++) {
      const p = new THREE.Vector3((rnd() - .5) * 3000, (rnd() - .5) * 600, -rnd() * 3500 + 100);
      if (Math.abs(p.y) < .05) continue;
      if (!inside(v.set(p.x, p.y, p.z, 1).applyMatrix4(A), reversed)) continue;   // only points the camera sees
      const c = v.set(p.x, p.y, p.z, 1).applyMatrix4(B);
      if (p.y > 0) { assert.ok(inside(c, reversed), `kept ${p.toArray().map((x) => x.toFixed(1))}`); kept++; }
      else { assert.ok(!inside(c, reversed), `clipped ${p.toArray().map((x) => x.toFixed(1))}`); clipped++; }
    }
    assert.ok(kept > 50 && clipped > 50, `${kept} kept, ${clipped} clipped`);
  });
}

test('the reflection pass sets no renderer clipping planes', () => {
  const src = readFileSync(new URL('../js/world/toolbox/effects/water-surface.js', import.meta.url), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/clippingPlanes\s*=/.test(src));
});
