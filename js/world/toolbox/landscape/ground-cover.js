// Toolbox: ground cover on every lawn and field near the rider (fidelity plan, step 6). The verge already has its grass
// (grass-cards.js along the road edges); this is the rest — lawns, parks, yards, pasture — as tufts of the same soft
// picture cards, in fixed cells round the camera:
//   - cells of CELL m; the ones within RADIUS are planted, the rest let go (chunked instancing: one test per cell, no
//     per-tuft culling); each cell's tufts come from a hash of its position, so a cell planted again looks the same
//   - one InstancedMesh for every tuft (one draw call), its instances rewritten only when a cell comes or goes
//   - a tuft fades (scales) to nothing toward RADIUS, so the edge of the field never shows
//   - what grows where is the map's: isGrass(x, z) → 0 (none) … 1 (full), heightAt(x, z) the ground
// Cost (Balanced): ~6–9 k tufts × 8 triangles ≈ 60 k triangles, one draw. Not on Phone.
//
//   const gc = new GroundCover({ parent, material: grassMaterial(...), isGrass, heightAt, density, radius, tint })
//   gc.tick(cameraPosition); gc.dispose()
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { grassCard, CARD } from './grass-cards.js';

const CELL = 12;
const hash = (x, z, k) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

/** The tuft: three crossed pairs of turf cards round a point (a clump, not a single blade). */
function tuftGeometry() {
  const M = new MeshBuilder({ aGlow: 1 });
  for (let k = 0; k < 2; k++) {
    const a = k * 1.1, r = k ? .12 : 0;
    grassCard(M, Math.cos(a) * r, 0, Math.sin(a) * r, CARD.turf, .5, .24 + k * .07, a * 1.7, new THREE.Color(1, 1, 1));
  }
  return M.geometry();
}

export class GroundCover {
  constructor({ parent, material, isGrass, heightAt, density = 1.6, radius = 40, tint = null }) {
    this.tint = tint;   // [evidence 27 Nov] (r, g, b) multiplier for the tufts' colour: the desert's are dry bunchgrass, not lawn
    this.parent = parent; this.isGrass = isGrass; this.heightAt = heightAt; this.radius = radius; this.density = density;
    const per = Math.ceil(CELL * CELL * density), cells = Math.ceil((2 * radius / CELL + 2) ** 2);
    this.capacity = per * cells;
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), material, this.capacity);
    this.mesh.name = 'Ground cover'; this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.userData.dynamic = false; this.mesh.userData.bake = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    parent.add(this.mesh);
    this.cells = new Map(); this._at = null;
  }
  _plant(ci, cj) {
    const out = [], n = Math.round(CELL * CELL * this.density);
    for (let k = 0; k < n; k++) {
      const x = (ci + hash(ci, cj, k)) * CELL, z = (cj + hash(ci, cj, k + 999)) * CELL;
      const g = this.isGrass(x, z);
      if (!(g > 0) || hash(x, z, 3) > g) continue;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      out.push(x, y, z, hash(x, z, 5) * 6.283, .7 + .6 * hash(x, z, 7), hash(x, z, 9));
    }
    return out;
  }
  /** Plant the cells that came within reach, let go of the ones that left; rewrite the instances when either did. */
  tick(cam) {
    const ci0 = Math.floor(cam.x / CELL), cj0 = Math.floor(cam.z / CELL);
    if (this._at && this._at[0] === ci0 && this._at[1] === cj0) return;
    this._at = [ci0, cj0];
    const r = Math.ceil(this.radius / CELL), want = new Set();
    for (let i = ci0 - r; i <= ci0 + r; i++) for (let j = cj0 - r; j <= cj0 + r; j++) {
      const dx = Math.max(0, Math.abs((i + .5) * CELL - cam.x) - CELL / 2), dz = Math.max(0, Math.abs((j + .5) * CELL - cam.z) - CELL / 2);
      if (Math.hypot(dx, dz) > this.radius) continue;
      const key = i * 100003 + j; want.add(key);
      if (!this.cells.has(key)) this.cells.set(key, { i, j, tufts: this._plant(i, j) });
    }
    for (const key of [...this.cells.keys()]) if (!want.has(key)) this.cells.delete(key);
    // the instances: each tuft scaled down toward the edge of reach (no visible edge)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    let n = 0;
    for (const c of this.cells.values()) for (let k = 0; k < c.tufts.length && n < this.capacity; k += 6) {
      const x = c.tufts[k], z = c.tufts[k + 2], d = Math.hypot(x - cam.x, z - cam.z);
      const fade = 1 - THREE.MathUtils.smoothstep(d, this.radius * .7, this.radius);
      if (fade <= .02) continue;
      p.set(x, c.tufts[k + 1], z); q.setFromAxisAngle(Y, c.tufts[k + 3]); s.setScalar(c.tufts[k + 4] * fade);
      this.mesh.setMatrixAt(n, m.compose(p, q, s));
      const t = c.tufts[k + 5], T = this.tint; col.setRGB((.6 + .16 * t) * (T ? T[0] : 1), (.74 + .14 * t) * (T ? T[1] : 1), (.5 + .08 * (1 - t)) * (T ? T[2] : 1)); this.mesh.setColorAt(n, col);   // (a shade darker than the cards' green: tufts sit in the lawn)
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, n * 16); this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.clearUpdateRanges(); this.mesh.instanceColor.addUpdateRange(0, n * 3); this.mesh.instanceColor.needsUpdate = true;
  }
  get stats() { return { tufts: this.mesh.count, cells: this.cells.size }; }
  dispose() { this.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.dispose(); }
}
