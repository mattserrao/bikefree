// A crowd pool (race-day crowds plan, 27 Nov): one draw for a crowd of impostor cards (life/figures/impostors.js).
// Its owner hands it people in blocks (one Float32Array of 16 floats a person per block, made once and kept); the
// pool draws the blocks it was last given, up to its capacity, and re-uploads only when that set changes.
//
//   const pool = new CrowdPool(parent, { atlas, uTime, near, capacity, farM, name })
//   pool.show([block, …])     the blocks to draw (nearest first: past the capacity the rest are left out)
//   writePerson(arr, i, p)    p: { x, y, z, yaw, look, pose, phase, rate, flag? } into block arr at person i
//   pool.dispose()
import * as THREE from '../../../../vendor/three.js';
import { impostorMaterial, packColor } from './figures/impostors.js';
import { FIT, hairColor } from './figures/people.js';

export const STRIDE = 16;

export function writePerson(arr, i, p) {
  const o = i * STRIDE, L = p.look;
  arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z; arr[o + 3] = p.yaw;
  arr[o + 4] = L.h; arr[o + 5] = L.g; arr[o + 6] = p.pose; arr[o + 7] = p.phase;
  arr[o + 8] = packColor(L.shirt); arr[o + 9] = packColor(L.pants); arr[o + 10] = packColor(L.skin); arr[o + 11] = packColor(hairColor(L));
  arr[o + 12] = p.flag ? packColor(p.flag) : 0; arr[o + 13] = (L.bits & FIT.SLEEVES ? 1 : 0) + (L.bits & FIT.LONG_PANTS ? 2 : 0); arr[o + 14] = p.rate; arr[o + 15] = 0;
}

export class CrowdPool {
  constructor(parent, { atlas, uTime, near, capacity = 4000, farM = 400, name = 'Crowd (cards)' }) {
    this.capacity = capacity; this.blocks = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(capacity * STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE); this.buffer.setUsage(THREE.DynamicDrawUsage);
    ['iPos', 'iLook', 'iCol', 'iExtra'].forEach((k, i) => g.setAttribute(k, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4)));
    g.instanceCount = 0;
    this.geometry = g; this.material = impostorMaterial(atlas, { uTime, near, farM });
    this.mesh = new THREE.Mesh(g, this.material);
    Object.assign(this.mesh, { name, frustumCulled: false, castShadow: false, receiveShadow: true });
    this.mesh.userData.bake = false; this.mesh.userData.dynamic = true;
    parent.add(this.mesh);
  }

  get count() { return this.geometry.instanceCount; }

  /** Draw these blocks (in order, up to the capacity). Returns how many people are drawn. */
  show(blocks) {
    if (blocks.length === this.blocks.length && blocks.every((b, i) => b === this.blocks[i])) return this.count;
    this.blocks = blocks.slice();
    let n = 0;
    for (const b of blocks) {
      const k = Math.min(b.length / STRIDE, this.capacity - n);
      if (k <= 0) break;
      this.data.set(k * STRIDE === b.length ? b : b.subarray(0, k * STRIDE), n * STRIDE); n += k;
    }
    this.geometry.instanceCount = n;
    this.buffer.clearUpdateRanges?.(); this.buffer.addUpdateRange?.(0, n * STRIDE);
    this.buffer.needsUpdate = true;
    return n;
  }

  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
