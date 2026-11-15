// Baked real terrain for a scene (tools/build_scene_terrain.py): elevation, signed distance to the
// nearest lake shore and the lake it belongs to, on a regular lat/lon grid. Pure functions (Node + browser).

/** Decode the .terrain.bin into typed grids and attach them to scene.terrainData. */
export function attachTerrainBuffer(scene, buffer) {
  const meta = scene.terrainData;
  if (!meta || meta.format !== 'bikefree-terrain-1') throw new Error('Unsupported terrain data');
  const n = meta.width * meta.height;
  const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (bytes.byteLength !== n * 5) throw new Error('Terrain data has the wrong size');
  Object.defineProperty(meta, 'grid', {
    value: { dem: new Int16Array(bytes, 0, n), sdf: new Int16Array(bytes, n * 2, n), ids: new Uint8Array(bytes, n * 4, n) },
    enumerable: false, configurable: true,
  });
  return scene;
}

/** Samplers in the world's local metre frame. */
export function makeTerrainSampler(meta, proj) {
  const { width: W, height: H, grid } = meta;
  const nw = proj.toLocal(meta.north, meta.west), se = proj.toLocal(meta.south, meta.east);
  const sx = (W - 1) / (se.x - nw.x), sz = (H - 1) / (se.z - nw.z);
  const base = meta.baseM || 0;
  const lakes = new Map((meta.lakes || []).map((l) => [l.id, l]));
  const cell = (x, z) => {
    const fx = Math.max(0, Math.min(W - 1.001, (x - nw.x) * sx)), fz = Math.max(0, Math.min(H - 1.001, (z - nw.z) * sz));
    const i = Math.floor(fx), j = Math.floor(fz);
    return { i, j, u: fx - i, v: fz - j, k: j * W + i };
  };
  const bilinear = (arr, c) => {
    const a = arr[c.k], b = arr[c.k + 1], d = arr[c.k + W], e = arr[c.k + W + 1];
    return ((a * (1 - c.u) + b * c.u) * (1 - c.v) + (d * (1 - c.u) + e * c.u) * c.v) / 10;
  };
  return {
    inside: (x, z) => x >= nw.x && x <= se.x && z >= nw.z && z <= se.z,
    bounds: { minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z },
    height: (x, z) => bilinear(grid.dem, cell(x, z)) + base,
    /** metres to the nearest lake shore, negative on the water; ±sdfMaxM beyond */
    shore: (x, z) => bilinear(grid.sdf, cell(x, z)),
    lake: (x, z) => {
      const c = cell(x, z);
      return lakes.get(grid.ids[c.k + (c.v > .5 ? W : 0) + (c.u > .5 ? 1 : 0)] || grid.ids[c.k]) || null;
    },
    lakes: [...lakes.values()],
    cellM: 1 / sx,
  };
}
