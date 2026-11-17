// Pooled drawing for the streamed stylized scenery. Ground patches and scattered plants used to be one
// mesh per tile (and per plant kind per tile): hundreds of draw calls. Here every ground patch shares one
// mesh, and the plants share one InstancedMesh per kind and quarter around the camera (the quarters keep
// frustum culling useful: the ones behind you are skipped). Tiles still exist on the CPU, as unrendered
// proxy meshes, for the clipping QC and anything else that inspects them.
import * as THREE from '../../../../vendor/three.module.min.js';

const SECTORS = 12, RING_M = 400;   // sectors around the camera, split again beyond RING_M

/** Matrix4[] → Float32Array of 16 floats each. */
export function packMatrices(list) {
  const out = new Float32Array(list.length * 16);
  for (let i = 0; i < list.length; i++) list[i].toArray(out, i * 16);
  return out;
}

/** One mesh for every ground patch. All patches share a topology, so each gets a fixed slot. */
export class GroundPool {
  /**
   * @param {THREE.Object3D} parent
   * @param {THREE.Material} material
   * @param {{vertices:number, indices:ArrayLike<number>, attributes:{[name:string]:number}}} layout  per-patch layout
   */
  constructor(parent, material, layout, capacity = 64, name = 'Ground') {
    this.parent = parent; this.material = material; this.layout = layout; this.name = name;
    this.slots = new Map();     // key → slot
    this.free = [];
    this.high = 0;              // slots in use up to here
    this._alloc(capacity);
  }

  _alloc(capacity) {
    const { vertices: V, indices: I, attributes } = this.layout;
    const old = this.geometry;
    const geometry = new THREE.BufferGeometry();
    for (const [name, size] of Object.entries(attributes)) {
      const array = new Float32Array(capacity * V * size);
      if (old) array.set(old.attributes[name].array);
      else if (name === 'position') array.fill(0);
      geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    const index = new Uint32Array(capacity * I.length);
    for (let s = 0; s < capacity; s++) for (let k = 0; k < I.length; k++) index[s * I.length + k] = I[k] + s * V;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, this.high * I.length);
    geometry.boundingSphere = old?.boundingSphere?.clone() || new THREE.Sphere(new THREE.Vector3(), 0);
    this.capacity = capacity;
    if (old) old.dispose();
    this.geometry = geometry;
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.name = this.name; this.mesh.userData.pooled = true;
      this.mesh.receiveShadow = true;
      this.parent.add(this.mesh);
    } else this.mesh.geometry = geometry;
  }

  /** Show exactly these patches: key → BufferGeometry with the layout's attributes. */
  set(patches) {
    const { vertices: V, attributes } = this.layout;
    for (const [key, slot] of this.slots) if (!patches.has(key)) { this._clear(slot); this.free.push(slot); this.slots.delete(key); }
    this.free.sort((a, b) => b - a);   // reuse the lowest slots first, so the draw range stays short
    for (const [key, geometry] of patches) {
      if (this.slots.has(key)) continue;
      let slot = this.free.pop();
      if (slot === undefined) { if (this.high >= this.capacity) this._alloc(this.capacity * 2); slot = this.high++; }
      this.slots.set(key, slot);
      for (const [name, size] of Object.entries(attributes)) {
        const dst = this.geometry.attributes[name], src = geometry.attributes[name];
        dst.array.set(src ? src.array : new Float32Array(V * size), slot * V * size);
        dst.addUpdateRange(slot * V * size, V * size); dst.needsUpdate = true;
      }
    }
    // trim the draw range past the last slot in use
    while (this.high > 0 && this.free.includes(this.high - 1)) { this.free.splice(this.free.indexOf(this.high - 1), 1); this.high--; }
    this.geometry.setDrawRange(0, this.high * this.layout.indices.length);
    // culling bounds: every patch's own sphere (which allows for the far-terrain height morph)
    const box = new THREE.Box3(), sphere = new THREE.Sphere();
    for (const geometry of patches.values()) {
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      box.expandByPoint(sphere.copy(geometry.boundingSphere).center.clone().addScalar(-sphere.radius));
      box.expandByPoint(sphere.center.clone().addScalar(sphere.radius));
    }
    if (box.isEmpty()) this.geometry.boundingSphere.set(new THREE.Vector3(), 0); else box.getBoundingSphere(this.geometry.boundingSphere);
    this.mesh.visible = this.high > 0;
  }

  _clear(slot) {
    // collapse a freed slot's triangles to a point: nothing to rasterise
    const { vertices: V } = this.layout, p = this.geometry.attributes.position;
    p.array.fill(0, slot * V * 3, (slot + 1) * V * 3);
    p.addUpdateRange(slot * V * 3, V * 3); p.needsUpdate = true;
  }

  clear() { this.set(new Map()); }

  dispose() { this.parent.remove(this.mesh); this.geometry.dispose(); }
}

/** Ground pools by fixed world blocks, so blocks out of view are culled (a few draw calls, not hundreds). */
export class GroundBlocks {
  constructor(parent, material, layout, blockM = 4608) {
    this.parent = parent; this.material = material; this.layout = layout; this.blockM = blockM;
    this.pools = new Map();
  }

  /** key → {x, z, geometry} */
  set(patches) {
    const parts = new Map();
    for (const [key, p] of patches) {
      const b = `${Math.floor(p.x / this.blockM)},${Math.floor(p.z / this.blockM)}`;
      if (!parts.has(b)) parts.set(b, new Map());
      parts.get(b).set(key, p.geometry);
    }
    for (const [b, pool] of this.pools) if (!parts.has(b)) { pool.dispose(); this.pools.delete(b); }
    for (const [b, part] of parts) {
      if (!this.pools.has(b)) this.pools.set(b, new GroundPool(this.parent, this.material, this.layout, 64, `Ground ${b}`));
      this.pools.get(b).set(part);
    }
  }

  get high() { let n = 0; for (const p of this.pools.values()) n += p.high; return n; }
  clear() { this.set(new Map()); }
  dispose() { for (const p of this.pools.values()) p.dispose(); this.pools.clear(); }
}

/**
 * One InstancedMesh per (asset, sector around the camera, shadow flags): tiles within `nearM` share one
 * bucket, the rest go into 30° sectors (split again at 400 m) so the ones out of view are culled. Tiles are
 * {x, z, size, lists: {name: {matrices: Float32Array, colors: Float32Array|null}}}.
 */
export class InstancePool {
  constructor(parent, name, assetOf, flagsOf) {
    this.parent = parent; this.name = name;
    this.assetOf = assetOf;     // name → {geometry, material}
    this.flagsOf = flagsOf;     // (name, tile) → {cast, receive}
    this.meshes = new Map();
  }

  /** Show exactly these tiles, in sectors around (cx, cz). */
  set(tiles, cx, cz, nearM = 0) {
    const groups = new Map();
    for (const tile of tiles) {
      const dx = tile.x + tile.size / 2 - cx, dz = tile.z + tile.size / 2 - cz;
      const d = Math.hypot(dx, dz), sector = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2)) * SECTORS) % SECTORS;
      const q = d < nearM ? 'n' : `${sector}${d > RING_M ? 'f' : ''}`;
      for (const [name, list] of Object.entries(tile.lists)) {
        const n = list.matrices.length / 16;
        if (!n) continue;
        const f = this.flagsOf(name, tile), key = `${name}|${q}|${f.cast ? 1 : 0}${f.receive ? 1 : 0}`;
        let g = groups.get(key);
        if (!g) groups.set(key, g = { name, flags: f, n: 0, parts: [] });
        g.parts.push(list); g.n += n;
      }
    }
    for (const [key, mesh] of this.meshes) if (!groups.has(key)) { mesh.count = 0; mesh.visible = false; }
    for (const [key, g] of groups) {
      let mesh = this.meshes.get(key);
      const colors = g.parts.some((p) => p.colors);
      if (!mesh || mesh.instanceMatrix.count < g.n || !!mesh.instanceColor !== colors) {
        if (mesh) { this.parent.remove(mesh); mesh.dispose(); }
        const asset = this.assetOf(g.name);
        mesh = new THREE.InstancedMesh(asset.geometry, asset.material, Math.ceil(g.n * 1.3) + 16);
        if (colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3);
        mesh.name = `${this.name} · ${g.name}`; mesh.userData.pooled = true;
        mesh.castShadow = g.flags.cast; mesh.receiveShadow = g.flags.receive;
        this.meshes.set(key, mesh); this.parent.add(mesh);
      }
      let at = 0;
      for (const p of g.parts) {
        const n = p.matrices.length / 16;
        mesh.instanceMatrix.array.set(p.matrices, at * 16);
        if (colors) { if (p.colors) mesh.instanceColor.array.set(p.colors, at * 3); else mesh.instanceColor.array.fill(1, at * 3, (at + n) * 3); }
        at += n;
      }
      mesh.count = g.n; mesh.visible = true;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, g.n * 16); mesh.instanceMatrix.needsUpdate = true;
      if (colors) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, g.n * 3); mesh.instanceColor.needsUpdate = true; }
      mesh.boundingSphere = instanceBounds(mesh.instanceMatrix.array, g.n, mesh.geometry, mesh.boundingSphere || new THREE.Sphere());
    }
  }

  clear() { for (const mesh of this.meshes.values()) { mesh.count = 0; mesh.visible = false; } }

  dispose() { for (const mesh of this.meshes.values()) { this.parent.remove(mesh); mesh.dispose(); } this.meshes.clear(); }
}

/** Culling sphere for n instances: their positions, padded by the model's own radius at the largest scale
 * (cheaper than three's computeBoundingSphere, which transforms a sphere per instance). */
function instanceBounds(m, n, geometry, out = new THREE.Sphere()) {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, k = 0;
  for (let i = 0, o = 0; i < n; i++, o += 16) {
    const x = m[o + 12], y = m[o + 13], z = m[o + 14];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    const sy = m[o + 4] * m[o + 4] + m[o + 5] * m[o + 5] + m[o + 6] * m[o + 6], sx = m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2];
    if (sy > k) k = sy; if (sx > k) k = sx;
  }
  const b = geometry.boundingSphere;
  out.center.set((x0 + x1) / 2 + b.center.x, (y0 + y1) / 2 + b.center.y, (z0 + z1) / 2 + b.center.z);
  out.radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + b.radius * Math.sqrt(k) + b.center.length() * Math.sqrt(k);
  return out;
}

/** An unrendered stand-in for a tile (for QC tools): a Group of InstancedMeshes sharing the tile's arrays. */
export function proxyGroup(lists, assetOf) {
  const group = new THREE.Group();
  for (const [name, list] of Object.entries(lists)) {
    const n = list.matrices.length / 16;
    if (!n) continue;
    const asset = assetOf(name);
    const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, 0);
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(list.matrices, 16);
    mesh.count = n;
    group.add(mesh);
  }
  return group;
}
